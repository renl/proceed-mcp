// Delivery worker: reconciles the persisted decision outbox against the exact
// originating session and admits the stable prompt ID when it is absent
// (design section 6). A resolution is never re-decided, a new prompt ID is
// never allocated, and "admitted" is never reported as delivered.
import { OriginError } from '../opencode/client.js';
import { isReviewedHostVersion } from '../opencode/support-data.js';
import { utcTimestamp } from '../util/values.js';

export const ADMITTED_POLL_MS = 2_000;
export const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const BLOCK_AFTER_MS = 15 * 60 * 1000;
const TICK_MS = 250;

function backoffFor(attempts) {
  return (
    RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length) - 1] ?? RETRY_BACKOFF_MS.at(-1)
  );
}

export function classifyOriginFailure(error) {
  if (!(error instanceof OriginError)) {
    return {
      retry: true,
      error: {
        code: 'ORIGIN_UNAVAILABLE',
        message: 'the origin could not be reached',
        retryable: true,
      },
    };
  }
  switch (error.code) {
    case 'AUTH_REQUIRED':
      return {
        block: {
          code: 'AUTH_REQUIRED',
          message: 'the origin rejected its configured credentials',
          retryable: false,
        },
      };
    case 'SESSION_NOT_FOUND':
      return {
        block: {
          code: 'SESSION_NOT_FOUND',
          message: 'the exact session is no longer available',
          retryable: false,
        },
      };
    case 'LOCATION_NOT_FOUND':
      return {
        block: {
          code: 'LOCATION_NOT_FOUND',
          message: 'the session location is not loaded',
          retryable: false,
        },
      };
    case 'UNSUPPORTED_RESPONSE':
      return {
        block: {
          code: 'UNSUPPORTED_RESPONSE',
          message: 'the origin returned an unsupported response; this host version is not admitted',
          retryable: false,
        },
      };
    default:
      return {
        retry: true,
        error: {
          code: 'ORIGIN_UNAVAILABLE',
          message: 'the origin is temporarily unavailable',
          retryable: true,
        },
      };
  }
}

export function createDeliveryWorker({ broker, clock = () => Date.now(), logger = () => {} }) {
  const inflight = new Set();
  let timer = null;
  let stopped = false;

  const now = () => clock();
  const nowIso = () => utcTimestamp(clock());

  const plan = (outbox, overrides) => ({
    ...outbox,
    error: null,
    ...overrides,
  });

  const record = async (request, outbox, deliveryState, deliveryError, overrides) => {
    await broker.recordDelivery({
      requestId: request.request_id,
      deliveryState,
      deliveryError,
      outbox: plan(outbox, { state: deliveryState, ...overrides }),
    });
  };

  const schedule = (delayMs) => utcTimestamp(now() + delayMs);

  const block = async (request, outbox, attempts, error) => {
    logger(`delivery for ${request.request_id} blocked (${error.code})`);
    await record(request, outbox, 'blocked', error, {
      attempts,
      next_attempt_at: null,
      error,
    });
  };

  const markDelivered = async (request, outbox, attempts) => {
    logger(`delivery for ${request.request_id} confirmed in session history`);
    await record(request, outbox, 'delivered', null, {
      attempts,
      next_attempt_at: null,
      delivered_at: nowIso(),
      error: null,
    });
  };

  const markAdmitted = async (request, outbox, attempts) => {
    await record(request, outbox, 'admitted', null, {
      attempts,
      admitted_at: outbox.admitted_at ?? nowIso(),
      next_attempt_at: schedule(ADMITTED_POLL_MS),
      error: null,
    });
  };

  const retryLater = async (request, outbox, attempts, error) => {
    await record(
      request,
      outbox,
      request.delivery_state === 'admitted' ? 'admitted' : 'pending',
      error,
      {
        attempts,
        next_attempt_at: schedule(backoffFor(attempts)),
        error,
      },
    );
  };

  const unconfirmed = async (request, outbox, attempts) => {
    const age = now() - Date.parse(outbox.created_at);
    if (age > BLOCK_AFTER_MS) {
      return block(request, outbox, attempts, {
        code: 'DELIVERY_UNCONFIRMED',
        message:
          'delivery could not be confirmed; run "proceed-mcp retry <request_id>" after repair',
        retryable: true,
      });
    }
    return retryLater(request, outbox, attempts, {
      code: 'DELIVERY_UNCONFIRMED',
      message: 'delivery is not yet confirmed',
      retryable: true,
    });
  };

  const verifyIdentity = async (request) => {
    const client = broker.client(request.origin_id);
    const info = await client.info();
    // Ordinary admission before any decision prompt is admitted or retried
    // (design section 6): no reviewed entry means no supported session.
    if (!isReviewedHostVersion(info.version)) {
      return {
        code: 'UNSUPPORTED_HOST',
        message: 'the origin host version has no reviewed support entry in this release',
        retryable: false,
      };
    }
    if (info.pid !== request.origin_pid || info.version !== request.origin_version) {
      return {
        code: 'ORIGIN_CHANGED',
        message: 'the origin process or version changed',
        retryable: false,
      };
    }
    const session = await client.session(request.session_id);
    if (
      request.session_created_at !== null &&
      session?.time?.created !== request.session_created_at
    ) {
      return { code: 'ORIGIN_CHANGED', message: 'the session identity changed', retryable: false };
    }
    return null;
  };

  const runAttempt = async (request) => {
    const outbox = broker.outboxFor(request.request_id);
    if (outbox === null) return;
    const attempts = outbox.attempts + 1;
    const client = broker.client(request.origin_id);

    let changed;
    try {
      changed = await verifyIdentity(request);
    } catch (error) {
      const classified = classifyOriginFailure(error);
      if (classified.block) return block(request, outbox, attempts, classified.block);
      return retryLater(request, outbox, attempts, classified.error);
    }
    if (changed !== null) return block(request, outbox, attempts, changed);

    // Reconcile before any retry: history presence proves the stable ID was
    // admitted earlier, even when the admission response was lost.
    let projected;
    try {
      projected = await client.messageOrNull(request.session_id, outbox.prompt_id);
    } catch (error) {
      const classified = classifyOriginFailure(error);
      if (classified.block) return block(request, outbox, attempts, classified.block);
      return retryLater(request, outbox, attempts, classified.error);
    }

    if (projected !== null) {
      if (projected.type !== 'user' || projected.text !== outbox.text) {
        return block(request, outbox, attempts, {
          code: 'PAYLOAD_MISMATCH',
          message: 'the projected input does not match the persisted decision',
          retryable: false,
        });
      }
      return markDelivered(request, outbox, attempts);
    }

    let inbox;
    try {
      inbox = await client.inbox(request.session_id);
    } catch (error) {
      const classified = classifyOriginFailure(error);
      if (classified.block) return block(request, outbox, attempts, classified.block);
      return retryLater(request, outbox, attempts, classified.error);
    }

    const queued = inbox.some((item) => item?.id === outbox.prompt_id);
    if (queued) return markAdmitted(request, outbox, attempts);
    if (request.delivery_state === 'admitted') return unconfirmed(request, outbox, attempts);

    let admission;
    try {
      admission = await client.prompt(request.session_id, {
        id: outbox.prompt_id,
        text: outbox.text,
      });
    } catch (error) {
      const classified = classifyOriginFailure(error);
      if (classified.block) return block(request, outbox, attempts, classified.block);
      return retryLater(request, outbox, attempts, classified.error);
    }

    const admitted = admission?.data;
    if (
      admitted === null ||
      typeof admitted !== 'object' ||
      admitted.id !== outbox.prompt_id ||
      admitted.sessionID !== request.session_id ||
      admitted.type !== 'user' ||
      admitted.delivery !== 'steer'
    ) {
      return block(request, outbox, attempts, {
        code: 'PAYLOAD_MISMATCH',
        message: 'the origin admitted a different input than the persisted decision',
        retryable: false,
      });
    }
    if (admitted.payload?.text !== outbox.text) {
      return block(request, outbox, attempts, {
        code: 'PAYLOAD_MISMATCH',
        message: 'the admitted input text differs from the persisted decision',
        retryable: false,
      });
    }
    return markAdmitted(request, outbox, attempts);
  };

  const tick = async () => {
    if (stopped) return;
    for (const request of broker.deliveryCandidates()) {
      if (stopped) return;
      if (inflight.has(request.request_id)) continue;
      const outbox = broker.outboxFor(request.request_id);
      if (outbox === null) continue;
      if (outbox.next_attempt_at !== null && now() < Date.parse(outbox.next_attempt_at)) continue;
      inflight.add(request.request_id);
      try {
        await runAttempt(request);
      } catch (error) {
        logger(`delivery attempt failed unexpectedly for ${request.request_id}`);
      } finally {
        inflight.delete(request.request_id);
      }
    }
  };

  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        tick().catch(() => {});
      }, TICK_MS);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
