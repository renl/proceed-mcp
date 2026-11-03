// Portable Telegram update consumption (design section 5, C1). The only
// production poller: it reads the fixed-origin client, admits one exact private
// pairing attempt through the journal-2 core, and mints no approval authority.
// Every durable effect belongs to the core turn for that update, so a reply is
// sent only after the transaction that justifies it has flushed, a failed reply
// never replays it, and a callback is dismissed neutrally, never resolved.

const PAIR = /^\/pair ([0-9a-f]{32})$/;
const START = '/start';
const PAIRED =
  'Paired. Approval questions can be sent to this chat. Approve, Reject and Respond are not recorded in this setup stage yet.';
const REFUSED = 'Pairing was not accepted. Ask the operator for a fresh code.';
const ONBOARD =
  'To pair, ask the operator for a pairing code. Send /pair <code> here before it expires.';
const ONBOARD_PAIRED =
  'You are paired with this local broker. Approval questions can be sent to this chat. Approve, Reject and Respond are not recorded in this setup stage yet.';
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

export function createPortableTelegramPoller({ broker, telegram, logger = () => {} } = {}) {
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

  // One shared abort covers the long poll, the retry wait and every external UI
  // call. Every termination is terminal and fixed: a later start cannot undo it.
  const end = (line, reason) => {
    logger(line);
    diagnostic ??= reason;
    stopped = true;
    controller.abort();
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
      logger(`Telegram reply was not delivered: ${codeOf(error)}`);
      return true;
    }
  };

  const reply = (chatId, text) =>
    deliver((options) => telegram.sendMessage({ chat_id: chatId, text }, { signal: options }));

  // One update at a time: its commit is awaited before the next member is read,
  // so no later position can outrun a held or failed append.
  const accept = async (update) => {
    const id = update.update_id;
    const cursor = broker.telegramCursor();
    // At or below the committed position there is no new mutation and no new
    // decision, so a replayed member is skipped rather than re-consumed.
    if (cursor !== null && id <= cursor) return true;

    const callback = update.callback_query;
    if (callback !== null && typeof callback === 'object') {
      await broker.advanceCursor(id);
      if (stopped || typeof callback.id !== 'string' || callback.id === '') return true;
      // Neutral spinner dismissal only, and only after the cursor commit: no
      // text, no pairing claim and no decision may be acknowledged in C1.
      return deliver((options) =>
        telegram.answerCallbackQuery({ callback_query_id: callback.id }, { signal: options }),
      );
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
    // Malformed grammar, other text and unsupported types are cursor-only and
    // never reach code verification.
    if (grammar === null) {
      await broker.advanceCursor(id);
      return true;
    }

    const stored = broker.pairing();
    if (
      stored !== null &&
      (stored.user_id !== identity.userId || stored.chat_id !== identity.chatId)
    ) {
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
        logger(BATCH_REJECTED);
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
