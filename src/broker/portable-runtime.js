// Portable broker process assembly (design sections 2-4). Production state is
// opened in a fixed order: protected state and credentials are verified, this
// invocation acquires exclusive state-directory ownership, and only then is the
// journal opened for recovery, replay and tail truncation. Recovery completes
// and the exact configured loopback port is bound before the authenticated API
// becomes ready, so no public mutation is exposed from a partially recovered
// state. A partial start closes its own listener, journal and ownership record;
// a graceful stop drains accepted commits before releasing that record.
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { Journal } from '../journal/journal.js';
import { readLocalCredential } from '../state/credentials.js';
import { readOwnerCredential } from '../state/owner-credentials.js';
import { acquireStateOwnership } from '../state/ownership.js';
import { verifyOwnerOnly } from '../state/protection.js';
import { startExpirySchedule } from './expiry-schedule.js';
import { createPortableBroker } from './portable.js';
import { createPortableServer } from './portable-server.js';
import { createPortableTelegramPoller } from '../telegram/portable-poller.js';
import { createPortablePresentationWorker } from '../telegram/portable-presentation.js';
import { createPortablePromptWorker } from '../telegram/portable-prompt.js';

// One private, process-local Telegram traffic fence shared by the three owned
// consumers. A rejected credential observed by any of them stops all outbound
// Telegram traffic; the local broker, its readiness, status, cancellation, waiting
// and expiry are deliberately outside this fence. All three admission fences run
// synchronously inside stop(), so a held drain on one side never leaves another
// side admitting scans, polls, sends, replies, prompts, acknowledgements or retries.
function createTelegramTrafficFence() {
  const listeners = new Set();
  let stopped = false;
  return {
    // One way only: the first credential rejection fences every current worker, and
    // a worker created afterwards is fenced on registration instead of starting.
    stop() {
      if (stopped) return;
      stopped = true;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
    add(listener) {
      if (stopped) listener();
      else listeners.add(listener);
    },
    remove(listener) {
      listeners.delete(listener);
    },
  };
}

// One token-backed poller exists only when the assembly supplies a Telegram
// client. Its absence is local-only operation, not a degraded readiness state.
export async function startPortableRuntime({
  paths,
  config,
  clock = () => Date.now(),
  logger = () => {},
  telegram = null,
  secure = false,
} = {}) {
  const protectedTargets = [paths.stateDir, paths.credentialsDir, paths.configFile];
  if ((await stat(paths.journalFile).catch(() => null)) !== null) {
    protectedTargets.push(paths.journalFile);
  }
  await verifyOwnerOnly(protectedTargets);

  // Secure local mode publishes an independent random channel key inside the
  // exclusively created schema-2 record. The key exists only in this process's
  // memory and that protected record; no endpoint or key is learned from the
  // network, and legacy serving publishes nothing.
  const channelKey = secure ? randomBytes(32) : null;
  const ownership = await acquireStateOwnership({
    lockFile: paths.brokerLockFile,
    port: config.broker.port,
    channel:
      channelKey === null ? undefined : { protocol: 'tls-psk-v1', psk: channelKey.toString('hex') },
  });

  // Observed local transport state, distinct from local readiness. Only the
  // poller's own poll results are reflected, so readiness never implies Telegram
  // availability and no exception message becomes a public value.
  const telegramState = {
    state: telegram === null ? 'disabled' : 'starting',
    code: null,
  };
  const observedTelegram = telegram === null ? null : observeTelegramState(telegram, telegramState);

  let journal = null;
  let broker = null;
  let server = null;
  let schedule = null;
  let poller = null;
  let presentation = null;
  let prompt = null;
  let requestStop = () => {};
  try {
    const control = await readLocalCredential(
      paths.controlCredentialFile,
      'the control credential',
    );
    const owners = new Map();
    for (const owner of config.owners) {
      owners.set(
        owner.owner_id,
        await readOwnerCredential(paths.ownerCredentialFile(owner.owner_id), owner.owner_id),
      );
    }

    // A journal declaring another format is refused by its own reader; nothing
    // in this path migrates, truncates or resets it.
    journal = await Journal.open(paths.journalFile);
    broker = createPortableBroker({
      journal,
      owners: config.owners,
      port: config.broker.port,
      clock,
      logger,
    });
    await broker.recover();
    // The serialized startup expiry flushes before the port binds, so overdue work
    // never waits for an observation call.
    await broker.sweepExpired();

    server = createPortableServer({
      broker,
      credentials: { control, owners },
      port: config.broker.port,
      // One clock drives lease expiry in production; the listener creates its
      // registry from it, so nothing selects a test-only route or interval.
      clock,
      logger,
      secure: channelKey === null ? null : { key: channelKey, instance: ownership.instance },
      lifecycle:
        channelKey === null
          ? null
          : {
              instance: ownership.instance,
              paired: () => broker.pairing() !== null,
              telegram: () => ({ state: telegramState.state, code: telegramState.code }),
              health: () => (schedule?.failed ? 'STORAGE_FAILURE' : null),
              onShutdown: () => requestStop(),
            },
    });
    try {
      await server.listen();
    } catch (cause) {
      if (cause?.code === 'EADDRINUSE' || cause?.code === 'EACCES') {
        throw blockedPrerequisite(
          `the broker port ${config.broker.port} is owned by another process; stop it first`,
          'BROKER_PORT_UNAVAILABLE',
        );
      }
      throw storageFailure('the broker could not bind its loopback port', 'STORAGE_FAILURE', cause);
    }
    await verifyOwnerOnly([paths.stateDir, paths.credentialsDir, paths.journalFile]);
    server.markReady();
    schedule = startExpirySchedule({ broker, logger });
    // Exactly one update consumer starts after recovery, startup expiry,
    // listener setup and local readiness, so no poll races an unready broker.
    if (observedTelegram !== null) {
      const traffic = createTelegramTrafficFence();
      poller = createPortableTelegramPoller({
        broker,
        telegram: observedTelegram,
        logger,
        traffic,
      });
      poller.start();
      // Question display is equally a private transport concern: it starts after
      // the same local readiness and only when the client can actually send and
      // perform both terminal edits. Its own failures never withdraw local readiness,
      // and an incomplete UI client leaves the broker in local-only operation.
      if (
        typeof observedTelegram.sendMessage === 'function' &&
        typeof observedTelegram.editMessageReplyMarkup === 'function' &&
        typeof observedTelegram.editMessageText === 'function'
      ) {
        presentation = createPortablePresentationWorker({
          broker,
          telegram: observedTelegram,
          logger,
          traffic,
        });
        presentation.start();
      }
      // A response prompt is one plain-text send with a ForceReply affordance, so
      // this third consumer depends on sendMessage alone and not on the two-edit
      // presentation gate above. Its own failures never withdraw local readiness.
      if (typeof observedTelegram.sendMessage === 'function') {
        prompt = createPortablePromptWorker({
          broker,
          telegram: observedTelegram,
          logger,
          traffic,
        });
        prompt.start();
      }
    }
  } catch (error) {
    // Nothing may outlive a failed start: all three owned Telegram consumers are
    // fenced synchronously first, then only this invocation's own listener, journal
    // activity and ownership record are closed before the cause is reported.
    const pollerDrain = poller?.stop();
    const presentationDrain = presentation?.stop();
    const promptDrain = prompt?.stop();
    await promptDrain?.catch(() => {});
    await presentationDrain?.catch(() => {});
    await pollerDrain?.catch(() => {});
    await schedule?.stop().catch(() => {});
    await server?.close().catch(() => {});
    await broker?.close().catch(() => {});
    await journal?.close().catch(() => {});
    await ownership.release().catch(() => {});
    throw error;
  }

  let stopping = false;
  let stopPromise = null;
  let resolveStopped;
  // Resolves after the complete graceful drain, so a foreground `serve` can end
  // exactly when an authenticated stop finishes instead of waiting for a signal.
  const stopped = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const runtime = {
    broker,
    port: config.broker.port,
    instance: ownership.instance,
    journalSequence: journal.sequence,
    stopped,
    // Operational health, never the listener's transport admission alone.
    get ready() {
      return !stopping && !schedule.failed;
    },
    stop() {
      if (stopPromise !== null) return stopPromise;
      stopping = true;
      telegramState.state = 'stopped';
      // All three owned Telegram consumers are fenced synchronously, before either
      // drain is awaited: a held poll turn cannot admit a later scan or send, and a
      // held receipt write cannot admit a later poll, reply, prompt or acknowledgement.
      const pollerDrain = poller?.stop();
      const presentationDrain = presentation?.stop();
      const promptDrain = prompt?.stop();
      stopPromise = (async () => {
        // Update consumption drains first: it fences new sends, aborts actual
        // in-flight poll/reply transport and drains its admitted core turn
        // before the authority closes, while scheduling keeps its own drain.
        await pollerDrain?.catch(() => {});
        // Question display drains next, so an already-admitted send completes and
        // its receipt installs before the authority closes.
        await presentationDrain?.catch(() => {});
        // Response prompts drain next, so an already-admitted prompt send still
        // records its valid late result before the authority closes.
        await promptDrain?.catch(() => {});
        // Scheduling stops next, so a queued attempt settles before any close.
        await schedule.stop();
        await server.close().catch(() => {});
        // The authority drains accepted commits before its journal and record close.
        await broker.close().catch(() => {});
        await journal.close().catch(() => {});
        await ownership.release().catch((error) => {
          logger(
            `the ownership record was not released: ${error?.message ?? 'unknown error'}; remove it only after verifying this broker has stopped`,
          );
        });
        resolveStopped();
      })();
      return stopPromise;
    },
  };
  requestStop = () => {
    void runtime.stop();
  };
  return runtime;
}

// Reflects only what this process actually observes: a completed poll is active,
// a transient transport failure is retrying, and a terminal fence is stopped.
// Codes are the documented closed set; anything else becomes UNKNOWN.
const TELEGRAM_FAILURE_CODES = new Set([
  'TOKEN_MISSING',
  'TOKEN_REJECTED',
  'POLLER_CONFLICT',
  'TELEGRAM_UNAVAILABLE',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_RATE_LIMITED',
  'TELEGRAM_REJECTED',
  'STORAGE_FAILURE',
]);

function telegramFailureCode(error) {
  const code = error?.code;
  if (code === 'JOURNAL_STATE_INVALID') return 'STORAGE_FAILURE';
  if (typeof code === 'string' && TELEGRAM_FAILURE_CODES.has(code)) return code;
  return 'UNKNOWN';
}

function observeTelegramState(telegram, state) {
  return {
    ...telegram,
    async updates(offset, options) {
      try {
        const value = await telegram.updates(offset, options);
        state.state = 'active';
        state.code = null;
        return value;
      } catch (error) {
        const code = telegramFailureCode(error);
        state.state =
          code === 'TOKEN_REJECTED' || code === 'POLLER_CONFLICT' || code === 'STORAGE_FAILURE'
            ? 'stopped'
            : 'retrying';
        state.code = code;
        throw error;
      }
    },
  };
}
