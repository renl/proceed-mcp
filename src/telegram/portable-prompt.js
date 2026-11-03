// Portable Telegram response-prompt worker (design section 5, C3 G1). This inert
// unit sends one ForceReply prompt for an opened request that still needs one and
// records only prompt evidence. It grants no authority: it never resolves a
// request, opens a response window, allocates a decision or cursor, or changes
// public Telegram or delivery state, and no runtime imports it yet.
import { renderPortableReplyPrompt } from './portable-render.js';

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

const positive = (value) => Number.isSafeInteger(value) && value > 0;

// A platform object is plain data: an array, a Date or any other prototype-bearing
// instance is not a Message or a chat, whatever fields it happens to carry.
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// A send result is admitted only as a complete accessible Message whose private
// numeric chat equals the freshly prepared snapshot chat; extra fields carry no
// authority, and nothing is coerced or taken from the result as a new target.
function accessibleMessage(value, chatId) {
  if (!plain(value) || !plain(value.chat)) return false;
  if (!positive(value.message_id) || !positive(value.date)) return false;
  return (
    value.chat.type === 'private' && positive(value.chat.id) && String(value.chat.id) === chatId
  );
}

// `traffic` is the process-local Telegram traffic fence shared with the update
// consumer and the presentation worker. A credential rejection observed by any of
// them stops all outbound Telegram traffic; broker readiness, status, waiting,
// cancellation and expiry are never part of that fence.
export function createPortablePromptWorker({
  broker,
  telegram,
  logger = () => {},
  traffic = null,
} = {}) {
  // Both selected receipt writers plus the admission seam are construction
  // requirements: a worker that could not prepare, record success or record a
  // failure would send prompts it can never correlate.
  const needed = [
    'responseWork',
    'prepareResponsePrompt',
    'recordPromptSent',
    'recordPromptFailed',
  ];
  if (needed.some((name) => typeof broker?.[name] !== 'function')) {
    throw new TypeError('a prompt worker needs a recovered portable broker');
  }
  if (typeof telegram?.sendMessage !== 'function') {
    throw new TypeError('a prompt worker needs a Telegram client');
  }
  if (typeof logger !== 'function') {
    throw new TypeError('a prompt worker needs a logger function');
  }

  const controller = new AbortController();
  const { signal } = controller;
  const waiting = new Map(); // request id -> one scheduled retry
  const ladder = new Map(); // request id -> transient failures already completed
  const blocked = new Set(); // request id -> definitive block for this process
  let stopped = false;
  let diagnostic = null;
  let pass = null;
  let rescan = false;
  let ticker = null;
  let stopPromise = null;

  // One fixed diagnostic per stopped or blocked condition, logged at most once and
  // never with an exception argument. A failing log callback never changes that
  // failure scope and never prevents the drain.
  const report = (line) => {
    if (diagnostic !== null) return;
    diagnostic = line;
    try {
      logger(line);
    } catch {
      // A diagnostic callback fault is not a prompt or storage fault.
    }
  };

  function clearSchedule() {
    for (const timer of waiting.values()) clearTimeout(timer);
    waiting.clear();
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  // Fence this worker only: no later scan, admission, send or retry may start.
  const halt = () => {
    stopped = true;
    clearSchedule();
    controller.abort();
  };

  const end = (line) => {
    halt();
    report(line);
  };

  // A rejected credential is wider than one prompt, so the shared traffic fence is
  // pulled synchronously here, before the fallible diagnostic log and independently
  // of whether the failure receipt can be recorded. Local service is preserved.
  const ceaseCredential = () => {
    halt();
    traffic?.stop();
    report(CREDENTIAL_STOPPED);
  };

  const fault = (error) =>
    error?.code === 'STORAGE_FAILURE' ? STORAGE_STOPPED : PROCESSING_STOPPED;

  // The closed redacted classification of one failed send attempt. A code outside
  // the client's own vocabulary is an unexpected prompt-only failure, and a
  // cancelled attempt is an abandoned send that supplies no receipt at all.
  const FAILURES = new Map([
    ['TELEGRAM_UNAVAILABLE', { code: 'unavailable' }],
    ['TELEGRAM_TIMEOUT', { code: 'unavailable' }],
    ['TELEGRAM_RATE_LIMITED', { code: 'rate_limited' }],
    ['TELEGRAM_REJECTED', { code: 'rejected', blocked: REJECTION_BLOCKED }],
    ['TOKEN_REJECTED', { code: 'rejected', credential: true }],
  ]);

  // One actual failed attempt for one request. The credential fence has already run
  // before this point, so a throwing or refusing receipt cannot resurrect traffic. A
  // definitive method rejection blocks only its own request until restart and a
  // classified transient failure joins that request's ladder, so siblings stay
  // independently eligible for their own attempts.
  const failed = async (requestId, error) => {
    if (error?.code === 'CANCELLED') return;
    const classification = FAILURES.get(error?.code);
    if (classification === undefined) {
      end(PROCESSING_STOPPED);
      return;
    }
    if (classification.credential === true) ceaseCredential();
    try {
      await broker.recordPromptFailed({ requestId, errorCode: classification.code });
    } catch (cause) {
      end(fault(cause));
      return;
    }
    // A stop taken while the receipt was held still fences it: no new timer follows.
    if (stopped) return;
    if (classification.blocked !== undefined) {
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

  // One admitted attempt for one selected request. Only the request id comes from
  // the candidate view; the target and the rendered request come from the fresh
  // serialized admission, which is released before transport. A stop or shared
  // cessation taken while it was held still fences the wire.
  const send = async (requestId) => {
    let prepared;
    try {
      prepared = await broker.prepareResponsePrompt({ requestId });
    } catch (error) {
      end(fault(error));
      return;
    }
    if (prepared === null || prepared === undefined) return;
    const chatId = prepared.chat_id;
    if (typeof chatId !== 'string') {
      end(PROCESSING_STOPPED);
      return;
    }
    if (stopped) return;
    let message;
    try {
      message = await telegram.sendMessage(
        {
          chat_id: chatId,
          text: renderPortableReplyPrompt(prepared.request),
          reply_markup: { force_reply: true },
        },
        { signal },
      );
    } catch (error) {
      await failed(requestId, error);
      return;
    }
    // No trustworthy result tuple exists, so the whole prompt worker stops until
    // restart while the actual attempt is still recorded under the storage rules.
    if (!accessibleMessage(message, chatId)) {
      let refusal = null;
      try {
        await broker.recordPromptFailed({ requestId, errorCode: 'invalid_response' });
      } catch (error) {
        refusal = error;
      }
      end(refusal === null ? INVALID_RESPONSE : fault(refusal));
      return;
    }
    let receipt;
    try {
      receipt = await broker.recordPromptSent({ requestId, chatId, messageId: message.message_id });
    } catch (error) {
      end(fault(error));
      return;
    }
    // A valid late result drains here even after stop or a terminal resolution. A
    // repeated same-prompt {sent:false} is idempotent success, while a null
    // admission means the core refused this tuple or role: the mappings stay
    // unchanged and only this request's prompt attempts are blocked for this
    // process, with siblings and their own scans unaffected.
    if (receipt === null || receipt === undefined) {
      let refusal = null;
      try {
        await broker.recordPromptFailed({ requestId, errorCode: 'invalid_response' });
      } catch (error) {
        refusal = error;
      }
      if (refusal !== null) {
        end(fault(refusal));
        return;
      }
      blocked.add(requestId);
      report(INVALID_RESPONSE);
    }
  };

  // One sequential pass over one work snapshot: only the request id of each
  // candidate is taken from it, and a request with a scheduled retry or a
  // definitive block is skipped until it is eligible again.
  const drain = async () => {
    const work = broker.responseWork();
    const prompts = Array.isArray(work?.prompts) ? work.prompts : [];
    for (const entry of prompts) {
      if (stopped) return;
      const requestId = entry?.request_id;
      if (typeof requestId !== 'string') continue;
      if (blocked.has(requestId) || waiting.has(requestId)) continue;
      await send(requestId);
    }
  };

  // One pass at a time. A tick that arrives while a pass is running is not dropped:
  // it re-examines the same work once that pass has released, so an eligible retry
  // is never lost to an overlapping scan.
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

    // Reported a stopped or blocked prompt condition. It is not a claim that local
    // authority, waiting, cancellation or a request outcome changed.
    get failed() {
      return diagnostic !== null;
    },
  };
}
