// Portable Telegram update consumption (design section 5, C1-C3). The only
// production poller: it reads the fixed-origin client, admits one exact private
// update through the journal-2 core, and mints no approval authority. Every durable
// effect belongs to the core turn for that update, so a reply or acknowledgement
// follows its flushed transaction, a failed UI call never replays it, and every copy
// below is selected from the committed result.
import { admitCallbackUpdate, admitTextUpdate } from './portable-admission.js';
import { renderPortableHumanOutcome } from './portable-render.js';
import { enrollmentNoticeKeyboard, renderEnrollmentNotice } from '../harness/render.js';

const PAIR = /^\/pair ([0-9a-f]{32})$/;
// `/harness <enrollment_id>` is the one enrollment command. It is a
// command-position classification of the whole raw message, exactly like
// `/pair`, so trailing data or a later line stays ordinary content.
const HARNESS = /^\/harness (hen_[a-f0-9]{32})$/;
// Pairing intent is a command-position classification of the whole raw message, not a
// search for `/pair` anywhere in its content: after any initial Unicode White_Space the
// first delimited token must be exactly `/pair` or begin `/pair@`. A doubled space,
// trailing data or newline, bot suffix or uppercase code still reads as intent and stays
// silent, while a later line, path, prefix or near token stays ordinary content.
const FIRST_TOKEN = /^\p{White_Space}*([^\p{White_Space}]*)/u;
const pairIntent = (text) => {
  if (typeof text !== 'string') return false;
  const token = FIRST_TOKEN.exec(text)[1];
  return token === '/pair' || token.startsWith('/pair@');
};
const harnessIntent = (text) => {
  if (typeof text !== 'string') return false;
  const token = FIRST_TOKEN.exec(text)[1];
  return token === '/harness' || token.startsWith('/harness@');
};
const START = '/start';
// Exact product copy (proposal C3 Product-Copy Annex) for this surface.
const PAIRED =
  'Paired. Approval questions can be sent to this chat. Select Approve, Reject or Respond on a request. Respond text is instructions, not approval.';
const REFUSED = 'Pairing was not accepted. Ask the operator for a fresh code.';
const ONBOARD =
  'To pair, ask the operator for a pairing code. Send /pair <code> here before it expires.';
const ONBOARD_PAIRED =
  'You are paired with this local broker. Select Approve, Reject or Respond on an approval request. Respond text is instructions, not approval.';
// A refusal discloses nothing about any request, and never a private outcome.
const UNAVAILABLE = 'This request is not available.';
const EXPIRED =
  'This request expired. No new choice was recorded. A new request is needed if approval is still required.';
const CANCELLED =
  'This request was cancelled. No new choice was recorded. A new request is needed if approval is still required.';
const RESOLVED = 'This request is already resolved. The recorded outcome is unchanged.';
const GUIDANCE =
  'No response was recorded. Select Respond on the intended request, then reply to its prompt or send /respond <request_id> <text>. Text is instructions, not approval.';

// The fixed ladder repeats its last step; a platform retry_after is honoured
// when it is longer.
const LADDER = [1000, 2000, 4000, 8000, 16000, 30000];
// Fixed allowlisted diagnostics, one redacted argument each: no token, URL,
// update text, identity, code or exception message can reach them.
const HANDLER_STOPPED = 'Telegram update processing stopped; stop and restart serve';
const STORAGE_STOPPED =
  'Telegram update processing stopped on a storage failure; stop and restart serve';
const BATCH_REJECTED =
  'Telegram returned an unusable update batch; retrying from the committed cursor';

// The cursor is a raw platform position, so an id is admitted only when its own
// successor stays safe. The same predicate guards the raw batch envelope.
const usableId = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;

// Raw Bot API identities are admitted only as positive safe integers, so the
// stored decimal string is lossless and nothing widens the approved storage
// domain. Sender and chat are validated independently, and no check requires
// the two to be equal.
function privateIdentity(message) {
  const from = message?.from;
  const chat = message?.chat;
  if (from?.is_bot !== false || chat?.type !== 'private') return null;
  if (!Number.isSafeInteger(from.id) || from.id <= 0) return null;
  if (!Number.isSafeInteger(chat.id) || chat.id <= 0) return null;
  return { userId: String(from.id), chatId: String(chat.id) };
}

// The whole envelope is validated before any member is processed, so one unsafe
// identifier cannot leave a partially consumed batch behind.
function orderedBatch(value) {
  if (!Array.isArray(value)) return null;
  const usable = value.every(
    (update) =>
      update !== null &&
      typeof update === 'object' &&
      !Array.isArray(update) &&
      usableId(update.update_id),
  );
  return usable ? [...value].sort((left, right) => left.update_id - right.update_id) : null;
}

// The client's closed classification vocabulary. A code outside this list is
// reported as the private generic fallback, so an arbitrary code string can
// never carry exception content into a log, a diagnostic or a stop reason.
const CODES = new Set([
  'TELEGRAM_UNAVAILABLE',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_RATE_LIMITED',
  'TELEGRAM_REJECTED',
  'TOKEN_REJECTED',
  'TOKEN_MISSING',
  'POLLER_CONFLICT',
  'CANCELLED',
]);
const codeOf = (error) => (CODES.has(error?.code) ? error.code : 'UNKNOWN');
const transient = (error) =>
  ['TELEGRAM_UNAVAILABLE', 'TELEGRAM_TIMEOUT', 'TELEGRAM_RATE_LIMITED'].includes(error?.code);
const rejectedCredential = (error) => ['TOKEN_REJECTED', 'POLLER_CONFLICT'].includes(error?.code);
const retryAfterMs = (error) =>
  Number.isInteger(error?.retryAfter) && error.retryAfter > 0 ? error.retryAfter * 1000 : 0;

export function createPortableTelegramPoller({
  broker,
  telegram,
  logger = () => {},
  traffic = null,
} = {}) {
  if (
    typeof broker?.telegramCursor !== 'function' ||
    typeof broker?.completePairing !== 'function'
  ) {
    throw new TypeError('a portable poller needs a recovered portable broker');
  }
  if (typeof telegram?.updates !== 'function') {
    throw new TypeError('a portable poller needs a Telegram client');
  }

  const controller = new AbortController();
  const { signal } = controller;
  let started = false;
  let stopped = false;
  let diagnostic = null;
  let attempt = 0;
  let loop = null;
  let stopPromise = null;

  // A diagnostic is evidence, never authority. A failing log callback is not a
  // storage, processing, refusal or business outcome of its own, so it can neither
  // widen the failure scope nor withdraw the termination it accompanies.
  const log = (line) => {
    try {
      logger(line);
    } catch {
      // A diagnostic callback fault is contained here and is never reclassified.
    }
  };

  // One shared abort covers the long poll, the retry wait and every external UI
  // call. Every termination is terminal and fixed: a later start cannot undo it. A
  // rejected credential is not just this consumer's problem, so it also fences the
  // shared Telegram traffic (question display, replies and acknowledgements) while
  // the local broker keeps serving. The terminal state and the shared fence are
  // installed before the diagnostic runs, so a throwing or slow log callback cannot
  // leave this consumer admitting a later poll, reply or acknowledgement.
  const end = (line, reason) => {
    diagnostic ??= reason;
    stopped = true;
    controller.abort();
    if (reason === 'TOKEN_REJECTED') traffic?.stop();
    log(line);
  };

  // A retry wait shares the poll's abortable lifetime, so stop reaches it too.
  const pause = (milliseconds) =>
    new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      signal.addEventListener('abort', done, { once: true });
    });

  // The rung is chosen by the count of failures already completed, so the last
  // rung repeats for as long as the outage lasts. A platform retry_after replaces
  // the rung only when it asks for a longer wait.
  const backoff = async (error) => {
    const rung = LADDER[Math.min(attempt, LADDER.length - 1)];
    attempt += 1;
    await pause(Math.max(retryAfterMs(error), rung));
  };

  // One external UI operation. A committed update is never replayed because its
  // reply failed, and only a rejected credential or poller conflict ends
  // consumption; every other UI failure stays diagnostic-only and redacted.
  const deliver = async (operation) => {
    if (stopped) return true;
    try {
      await operation(signal);
      return true;
    } catch (error) {
      if (rejectedCredential(error)) {
        const code = codeOf(error);
        end(`Telegram updates stopped: ${code}; restart serve after repairing the bot`, code);
        return false;
      }
      log(`Telegram reply was not delivered: ${codeOf(error)}`);
      return true;
    }
  };

  const reply = (chatId, text) =>
    deliver((options) => telegram.sendMessage({ chat_id: chatId, text }, { signal: options }));

  // One best-effort answer for an admitted callback, always after the relevant core
  // commit. An omitted text is the neutral dismissal: it claims no decision, no
  // pairing state and no outcome, and never replays the handler.
  const answer = (callbackQueryId, text) => {
    const payload = { callback_query_id: callbackQueryId };
    if (text !== null) payload.text = text;
    return deliver((options) => telegram.answerCallbackQuery(payload, { signal: options }));
  };

  // Exact copy for one committed core result, or null when nothing new was recorded:
  // the prefix follows the committed resolution and the suffix the committed ledger.
  const copyFor = (result) => {
    if (result.result === 'recorded') {
      return renderPortableHumanOutcome(result.request.resolution, result.request.delivery_state);
    }
    if (result.result === 'expired') return EXPIRED;
    if (result.result !== 'retained') return null;
    if (result.request.resolution === 'expired') return EXPIRED;
    return result.request.resolution === 'cancelled' ? CANCELLED : RESOLVED;
  };

  // One admitted enrollment control. The token is correlation only; the broker
  // rechecks the current paired private sender, the pending proposal and its
  // expiry in one serialized turn, so a foreign or replayed press changes
  // nothing and still consumes only its own update.
  const enrollmentCallback = async (admitted, id) => {
    const result = await broker.resolveEnrollmentCallback({
      kind: admitted.kind,
      token: admitted.token,
      userId: admitted.userId,
      chatId: admitted.chatId,
      updateId: id,
    });
    if (result.result === 'confirmed') {
      return answer(admitted.callbackQueryId, 'Operator enrollment confirmed.');
    }
    if (result.result === 'denied') return answer(admitted.callbackQueryId, 'Enrollment denied.');
    return answer(admitted.callbackQueryId, UNAVAILABLE);
  };

  // One admitted callback. The raw token is correlation only: the core rechecks the
  // whole binding in its own serialized turn, so this consumer never derives a
  // target from text, ordering, a label or a displayed id. A refusal owns exactly
  // one cursor commit here, and every answer is one best-effort attempt.
  const callback = async (update, id) => {
    const admitted = admitCallbackUpdate(update);
    if (admitted.status === 'enrollment') return enrollmentCallback(admitted, id);
    const target =
      admitted.status === 'callback'
        ? broker.correlateCallbackToken({ callbackToken: admitted.token })
        : null;
    if (target === null) {
      await broker.advanceCursor(id);
      return typeof admitted.callbackQueryId === 'string'
        ? answer(admitted.callbackQueryId, UNAVAILABLE)
        : true;
    }
    // The admitted fields are copied verbatim; the admission tag and the raw token
    // name are inert extras the core validates against stored state, never trust.
    const binding = { ...admitted, callbackToken: admitted.token, requestId: target.request_id };
    const result =
      admitted.kind === 'respond'
        ? await broker.openResponse(binding)
        : await broker.resolveCallback({
            ...binding,
            resolution: admitted.kind === 'approve' ? 'approved' : 'rejected',
          });
    if (result.result === 'refused') {
      await broker.advanceCursor(id);
      return answer(admitted.callbackQueryId, UNAVAILABLE);
    }
    // Stale input and an already open window record nothing and are dismissed
    // neutrally; every other result already owns its cursor.
    return answer(admitted.callbackQueryId, copyFor(result));
  };

  // One admitted paired response. Raw parsing and the reply/command split stay with
  // admission, so this consumer copies the admitted fields verbatim and owns the
  // cursor only for input that recorded nothing.
  const respond = async (update, id, identity) => {
    const admitted = admitTextUpdate(update);
    if (admitted.status !== 'reply' && admitted.status !== 'command') {
      // Non-text input records nothing and stays silent; a paired human's refused
      // or uncorrelated text is answered only after its own cursor commit.
      await broker.advanceCursor(id);
      return admitted.status === 'ignored' ? true : reply(identity.chatId, GUIDANCE);
    }
    const result =
      admitted.status === 'reply'
        ? await broker.resolveReply(admitted)
        : await broker.resolveCommand(admitted);
    if (result.result === 'refused') {
      await broker.advanceCursor(id);
      return reply(identity.chatId, GUIDANCE);
    }
    const text = copyFor(result);
    return text === null ? true : reply(identity.chatId, text);
  };

  // One update at a time: its commit is awaited before the next member is read,
  // so no later position can outrun a held or failed append.
  const accept = async (update) => {
    const id = update.update_id;
    const cursor = broker.telegramCursor();
    // At or below the committed position there is no new mutation and no new
    // decision, so a replayed member is skipped rather than re-consumed.
    if (cursor !== null && id <= cursor) return true;

    if (update.callback_query !== undefined && update.callback_query !== null) {
      return callback(update, id);
    }

    const identity = privateIdentity(update.message);
    // Raw admission refused: silent and quota-free, with no pairing status and
    // no code verification, so this position is consumed alone.
    if (identity === null) {
      await broker.advanceCursor(id);
      return true;
    }

    const text = update.message.text;
    if (text === START) {
      await broker.advanceCursor(id);
      const stored = broker.pairing();
      const own =
        stored !== null && stored.user_id === identity.userId && stored.chat_id === identity.chatId;
      // The onboarding text is identical for a foreign or absent pairing except
      // for the exactly matching tuple, which is told only about itself.
      return reply(identity.chatId, own ? ONBOARD_PAIRED : ONBOARD);
    }

    const grammar = typeof text === 'string' ? PAIR.exec(text) : null;
    // A command-position pairing attempt that fails the exact grammar still keeps its
    // own state undisclosed and never falls through as response text, even when the
    // message carries a valid response-prompt mapping, so it is consumed alone.
    if (grammar === null && pairIntent(text)) {
      await broker.advanceCursor(id);
      return true;
    }

    const stored = broker.pairing();
    const own =
      stored !== null && stored.user_id === identity.userId && stored.chat_id === identity.chatId;

    // `/harness <enrollment_id>` shows the proposed fingerprint and the explicit
    // Confirm/Deny controls. The broker commits the control tokens and this
    // update's cursor together; only the exact paired private sender reaches it.
    const harnessCommand = typeof text === 'string' ? HARNESS.exec(text) : null;
    if (harnessCommand !== null) {
      if (!own) {
        await broker.advanceCursor(id);
        return true;
      }
      const notice = await broker.enrollmentNotice({
        enrollmentId: harnessCommand[1],
        userId: identity.userId,
        chatId: identity.chatId,
        updateId: id,
      });
      if (notice === null) return true;
      return deliver((options) =>
        telegram.sendMessage(
          {
            chat_id: notice.chat_id,
            text: renderEnrollmentNotice({
              enrollmentId: notice.enrollment_id,
              harnessId: notice.harness_id,
              ownerId: notice.owner_id,
              keyId: notice.key_id,
              expiresAt: notice.expires_at,
            }),
            reply_markup: enrollmentNoticeKeyboard({
              confirmToken: notice.confirm_token,
              denyToken: notice.deny_token,
            }),
          },
          { signal: options },
        ),
      );
    }
    // A command-position enrollment attempt that fails the exact grammar keeps its
    // own state undisclosed and never falls through as response text.
    if (harnessIntent(text)) {
      await broker.advanceCursor(id);
      return true;
    }

    if (grammar === null) {
      // Only the independently matching paired tuple may reach a text writer.
      // Unpaired and foreign text stays silent and cursor-only.
      if (!own) {
        await broker.advanceCursor(id);
        return true;
      }
      return respond(update, id, identity);
    }

    if (stored !== null && !own) {
      // A foreign tuple stays silent even for valid syntax: it learns nothing
      // about whether a human is paired.
      await broker.advanceCursor(id);
      return true;
    }

    // Exactly one admitted attempt per update. The core owns the rolling quota,
    // the sampled instant, the challenge and the atomic consume/set/cursor
    // commit, so no second cursor is appended here.
    const result = await broker.completePairing({
      code: grammar[1],
      userId: identity.userId,
      chatId: identity.chatId,
      updateId: id,
    });
    return reply(identity.chatId, result?.paired === true ? PAIRED : REFUSED);
  };

  const run = async () => {
    while (!stopped) {
      const cursor = broker.telegramCursor();
      let batch;
      try {
        // No cursor means no offset at all; a cursor is confirmed as its exact
        // successor, never as a batch end or a negative value.
        batch = await telegram.updates(cursor === null ? null : cursor + 1, { signal });
      } catch (error) {
        if (stopped || error?.code === 'CANCELLED') return;
        if (!transient(error)) {
          const code = codeOf(error);
          end(`Telegram updates stopped: ${code}; restart serve`, code);
          return;
        }
        await backoff(error);
        continue;
      }
      if (stopped) return;

      const updates = orderedBatch(batch);
      if (updates === null) {
        // A malformed envelope fails this poll attempt without advancing any
        // cursor and without becoming an empty successful batch.
        log(BATCH_REJECTED);
        await backoff(null);
        continue;
      }

      for (const update of updates) {
        if (stopped) return;
        try {
          if (!(await accept(update))) return;
        } catch (error) {
          // A storage failure keeps the core's own journal fence and is never
          // treated as a refusal that may be skipped; any other exception stops
          // this loop instead of retrying the update or skipping ahead.
          end(error?.code === 'STORAGE_FAILURE' ? STORAGE_STOPPED : HANDLER_STOPPED, 'stopped');
          return;
        }
      }
      // A successful batch, including an empty one, restarts the ladder. An
      // empty batch appends nothing.
      attempt = 0;
    }
  };

  // A peer consumer's credential rejection fences this loop synchronously through
  // the same fixed termination, so the in-flight poll and every later reply or
  // acknowledgement are aborted at once and nothing new is admitted.
  const fence = () =>
    end(
      'Telegram updates stopped: TOKEN_REJECTED; restart serve after repairing the bot',
      'TOKEN_REJECTED',
    );
  traffic?.add(fence);

  return {
    // Idempotent, and refused once stopped or ended.
    start() {
      if (started || stopped) return;
      started = true;
      loop = run();
    },

    // Fences admission synchronously, aborts in-flight transport, and returns
    // one shared promise that drains the already-admitted core turn.
    stop() {
      if (stopPromise !== null) return stopPromise;
      stopped = true;
      controller.abort();
      traffic?.remove(fence);
      stopPromise = (async () => {
        await loop;
      })();
      return stopPromise;
    },

    diagnostic() {
      return diagnostic;
    },
  };
}
