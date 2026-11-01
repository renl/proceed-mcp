// Portable broker process assembly (design sections 2-4). Production state is
// opened in a fixed order: protected state and credentials are verified, this
// invocation acquires exclusive state-directory ownership, and only then is the
// journal opened for recovery, replay and tail truncation. Recovery completes
// and the exact configured loopback port is bound before the authenticated API
// becomes ready, so no public mutation is exposed from a partially recovered
// state. A partial start closes its own listener, journal and ownership record;
// a graceful stop drains accepted commits before releasing that record.
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

export async function startPortableRuntime({
  paths,
  config,
  clock = () => Date.now(),
  logger = () => {},
} = {}) {
  const protectedTargets = [paths.stateDir, paths.credentialsDir, paths.configFile];
  if ((await stat(paths.journalFile).catch(() => null)) !== null) {
    protectedTargets.push(paths.journalFile);
  }
  await verifyOwnerOnly(protectedTargets);

  // Ownership is independent of the port and precedes journal recovery, so a
  // foreign, stale or uncertain record refuses startup without touching the
  // journal. Startup never replaces, repairs or deletes an existing record.
  const ownership = await acquireStateOwnership({
    lockFile: paths.brokerLockFile,
    port: config.broker.port,
  });

  let journal = null;
  let broker = null;
  let server = null;
  let schedule = null;
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
  } catch (error) {
    // Nothing may outlive a failed start: close only this invocation's own
    // listener, journal activity and ownership record, then report the cause.
    await schedule?.stop().catch(() => {});
    await server?.close().catch(() => {});
    await broker?.close().catch(() => {});
    await journal?.close().catch(() => {});
    await ownership.release().catch(() => {});
    throw error;
  }

  let stopping = false;
  let stopPromise = null;
  return {
    broker,
    port: config.broker.port,
    journalSequence: journal.sequence,
    // Operational health, never the listener's transport admission alone.
    get ready() {
      return !stopping && !schedule.failed;
    },
    stop() {
      if (stopPromise !== null) return stopPromise;
      stopping = true;
      stopPromise = (async () => {
        // Scheduling stops first, so a queued attempt settles before any close.
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
      })();
      return stopPromise;
    },
  };
}
