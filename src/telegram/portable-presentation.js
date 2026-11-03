// Portable Telegram approval-question presentation (design section 5, C2). This
// worker displays one eligible pending request per mapped question and records
// only presentation receipts: it never records a human decision, never edits a
// message and grants no new authority. Every send uses a freshly serialized
// preparation for the identity the scan selected, never other snapshot data.
import { renderPortableRequestMessage } from './portable-render.js';

const SCAN_INTERVAL_MS = 1000;
// The fixed ladder repeats its last step; a platform retry_after is only a floor.
const LADDER_MS = [1000, 2000, 4000, 8000, 16000, 30000];
// Fixed allowlisted diagnostics, one redacted argument each: no platform
// description, request data, URL or credential can reach them.
const PROCESSING_STOPPED = 'Telegram presentation processing stopped; stop and restart serve';
const INVALID_RESPONSE =
  'Telegram question presentation blocked after an invalid response; stop and restart serve';
const REJECTION_BLOCKED =
  'Telegram question presentation blocked after rejection; repair Telegram access and restart serve';
const CREDENTIAL_STOPPED =
  'Telegram presentation stopped after credential rejection; repair configuration and restart serve';
const STORAGE_STOPPED =
  'Telegram presentation stopped after a storage failure; stop and restart serve';

// The accepted portable renderer's exact three opaque controls. No parse_mode,
// entity, capability or other authority field belongs in this payload.
const keyboard = (token) => ({
  inline_keyboard: [
    [
      { text: 'Approve', callback_data: `a:${token}`, style: 'success' },
      { text: 'Reject', callback_data: `r:${token}`, style: 'danger' },
      { text: 'Respond', callback_data: `t:${token}`, style: 'primary' },
    ],
  ],
});

const positive = (value) => Number.isSafeInteger(value) && value > 0;

// A send result is admitted only as a complete accessible Message whose private
// numeric chat equals the snapshot chat; extra fields carry no authority.
function accessibleMessage(value, chatId) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!positive(value.message_id) || !positive(value.date)) return false;
  const chat = value.chat;
  if (chat === null || typeof chat !== 'object' || Array.isArray(chat)) return false;
  return chat.type === 'private' && positive(chat.id) && String(chat.id) === chatId;
}

// `traffic` is the process-local Telegram traffic fence shared with the update
// consumer. A credential rejection observed here, or there, stops all outbound
// Telegram traffic; local readiness, status, cancellation, waiting and expiry are
// never part of that fence.
export function createPortablePresentationWorker({
  broker,
  telegram,
  logger = () => {},
  traffic = null,
} = {}) {
  const needed = [
    'presentationWork',
    'preparePresentation',
    'recordPresentationSent',
    'recordPresentationFailed',
  ];
  if (needed.some((name) => typeof broker?.[name] !== 'function')) {
    throw new TypeError('a presentation worker needs a recovered portable broker');
  }
  if (typeof telegram?.sendMessage !== 'function') {
    throw new TypeError('a presentation worker needs a Telegram client');
  }
  if (typeof logger !== 'function') {
    throw new TypeError('a presentation worker needs a logger function');
  }

  const controller = new AbortController();
  const { signal } = controller;
  const waiting = new Map(); // request id -> one scheduled retry
  const ladder = new Map(); // request id -> transient failures already completed
  const blocked = new Set(); // request id -> definitive rejection for this process
  let stopped = false;
  let diagnostic = null;
  let pass = null;
  let rescan = false;
  let ticker = null;
  let stopPromise = null;

  // One fixed diagnostic per stopped/blocked condition, logged at most once and
  // never with an exception argument. A failing log callback never changes that
  // failure scope and never prevents the drain. Reporting is not fencing: a
  // request-scoped rejection reports without withdrawing this worker.
  const report = (line) => {
    if (diagnostic !== null) return;
    diagnostic = line;
    try {
      logger(line);
    } catch {
      // A diagnostic callback fault is not a presentation or storage fault.
    }
  };

  // Terminal fence: no later scan, preparation, send or retry may be admitted.
  const end = (line) => {
    stopped = true;
    clearSchedule();
    controller.abort();
    report(line);
  };

  // A rejected credential is wider than one request, so it also fences the shared
  // Telegram traffic: no question, reply or acknowledgement leaves this process
  // until the operator repairs the configuration and restarts.
  const ceaseCredential = () => {
    end(CREDENTIAL_STOPPED);
    traffic?.stop();
  };

  const fault = (error) =>
    error?.code === 'STORAGE_FAILURE' ? STORAGE_STOPPED : PROCESSING_STOPPED;

  function clearSchedule() {
    for (const timer of waiting.values()) clearTimeout(timer);
    waiting.clear();
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  // The closed redacted classification of one failed send attempt. A code outside
  // the client's own vocabulary is an unexpected presentation-only failure, and a
  // cancelled attempt is an abandoned send that supplies no receipt at all. Only a
  // rejected credential is Telegram-wide: a definitive method rejection concerns
  // the single request it names.
  const FAILURES = new Map([
    ['TELEGRAM_UNAVAILABLE', { code: 'unavailable' }],
    ['TELEGRAM_TIMEOUT', { code: 'unavailable' }],
    ['TELEGRAM_RATE_LIMITED', { code: 'rate_limited' }],
    ['TELEGRAM_REJECTED', { code: 'rejected', blocked: REJECTION_BLOCKED }],
    ['TOKEN_REJECTED', { code: 'rejected', credential: true }],
  ]);

  // One actual failed attempt: the receipt records only the classification, a
  // definitive rejection blocks its own request until restart, and a classified
  // transient failure joins the per-request ladder.
  const failed = async (requestId, callbackToken, error) => {
    if (error?.code === 'CANCELLED') return;
    const classification = FAILURES.get(error?.code);
    if (classification === undefined) {
      end(PROCESSING_STOPPED);
      return;
    }
    try {
      await broker.recordPresentationFailed({
        requestId,
        callbackToken,
        errorCode: classification.code,
      });
    } catch (cause) {
      end(fault(cause));
      return;
    }
    // The admitted failure write always drains, but a stop taken while it was held
    // still fences it: no new timer, scan or send follows that completion.
    if (stopped) return;
    if (classification.credential === true) {
      ceaseCredential();
      return;
    }
    if (classification.blocked !== undefined) {
      // This request stays blocked for this process while its siblings, in this
      // pass and in later scans, remain eligible for their own attempts.
      blocked.add(requestId);
      report(classification.blocked);
      return;
    }
    const completed = ladder.get(requestId) ?? 0;
    ladder.set(requestId, completed + 1);
    const rung = LADDER_MS[Math.min(completed, LADDER_MS.length - 1)];
    const floor =
      Number.isInteger(error?.retryAfter) && error.retryAfter >= 0 ? error.retryAfter * 1000 : 0;
    const timer = setTimeout(
      () => {
        waiting.delete(requestId);
        scan();
      },
      Math.max(rung, floor),
    );
    waiting.set(requestId, timer);
  };

  // One admitted attempt for one selected request: a fresh serialized preparation
  // supplies the actual target, token and rendered request, and nothing is sent
  // after a stop or when the target is reserved, due or terminal.
  const send = async (requestId) => {
    let prepared;
    try {
      prepared = await broker.preparePresentation({ requestId });
    } catch (error) {
      end(fault(error));
      return;
    }
    if (prepared === null || prepared === undefined) return;
    const { chat_id: chatId, callback_token: callbackToken, request } = prepared;
    // The broker's own private view is the only source of a target, so a value
    // outside that shape is an unexpected presentation failure, not a send; a
    // request that cannot be rendered fails the same way through the pass guard.
    if (typeof chatId !== 'string' || typeof callbackToken !== 'string') {
      end(PROCESSING_STOPPED);
      return;
    }
    if (stopped) return;
    let message;
    try {
      message = await telegram.sendMessage(
        {
          chat_id: chatId,
          text: renderPortableRequestMessage(request),
          reply_markup: keyboard(callbackToken),
        },
        { signal },
      );
    } catch (error) {
      await failed(requestId, callbackToken, error);
      return;
    }
    const errorCode = accessibleMessage(message, chatId) ? null : 'invalid_response';
    try {
      if (errorCode === null) {
        await broker.recordPresentationSent({
          requestId,
          callbackToken,
          chatId,
          messageId: message.message_id,
        });
      } else {
        await broker.recordPresentationFailed({ requestId, callbackToken, errorCode });
      }
    } catch (error) {
      end(fault(error));
      return;
    }
    if (errorCode !== null) end(INVALID_RESPONSE);
  };

  // One sequential pass over one work snapshot: only the request identity is taken
  // from it, and a request with a scheduled retry or a definitive rejection of its
  // own is skipped until it is eligible again.
  const drain = async () => {
    const work = broker.presentationWork();
    for (const entry of Array.isArray(work?.sends) ? work.sends : []) {
      const requestId = entry?.request_id;
      if (stopped) return;
      if (typeof requestId !== 'string' || blocked.has(requestId) || waiting.has(requestId)) {
        continue;
      }
      await send(requestId);
    }
  };

  // One pass at a time. A request that arrives while a pass is already running is
  // not dropped: it re-examines the same work once that pass has released, so an
  // eligible retry is never lost to an overlapping tick.
  function scan() {
    if (stopped) return;
    if (pass !== null) {
      rescan = true;
      return;
    }
    pass = (async () => {
      try {
        await drain();
      } catch {
        end(PROCESSING_STOPPED);
      } finally {
        pass = null;
        if (rescan && !stopped) {
          rescan = false;
          scan();
        }
      }
    })();
  }

  // A peer consumer's credential rejection reaches this worker as one synchronous
  // admission fence, exactly like its own; a healthy peer never calls it.
  const fence = () => ceaseCredential();
  traffic?.add(fence);

  return {
    // Idempotent, and it initiates the first pass immediately.
    start() {
      if (ticker !== null || stopped) return;
      scan();
      ticker = setInterval(scan, SCAN_INTERVAL_MS);
    },

    // Fences admission synchronously, clears owned scheduling, aborts in-flight
    // transport, and returns one shared promise draining the admitted pass,
    // including a late valid receipt that entered serialization before the close.
    stop() {
      if (stopPromise !== null) return stopPromise;
      stopped = true;
      clearSchedule();
      controller.abort();
      traffic?.remove(fence);
      stopPromise = Promise.resolve(pass).then(() => {});
      return stopPromise;
    },

    diagnostic() {
      return diagnostic;
    },

    // Reported a stopped or blocked presentation condition. It is not a claim that
    // local authority, waiting or cancellation changed.
    get failed() {
      return diagnostic !== null;
    },
  };
}
