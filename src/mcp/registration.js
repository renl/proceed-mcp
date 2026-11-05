// Private adapter registration binding (design sections 2, 3 and 7).
//
// One adapter process holds one ephemeral broker registration: a lazy
// single-flight create, a heartbeat lease renewal and a terminal close. The
// secret stays in memory, is presented only on registration-bound routes and
// never enters a log line or an error message. A local generation serial fences
// every completion, so a create, heartbeat or release that settles after close
// (or after the authority it described was invalidated) cannot install a
// registration, restyle a timer or remove another incarnation. The same binding
// answers from retained state only whether a captured incarnation is still the one
// it holds, so a caller can refuse a stale capture without refreshing or taking over.
import {
  REGISTRATION_ID_PATTERN,
  REGISTRATION_SECRET_PATTERN,
  isPlainObject,
} from '../util/values.js';

export const REGISTRATION_HEARTBEAT_MS = 10000;
export const REGISTRATION_SHUTDOWN_BUDGET_MS = 2000;
export const REGISTRATION_HEADER = 'X-Proceed-Registration';

const ADAPTER_PATH = '/v1/adapter';
// The tool-code list is closed. A broker value outside it is unrecognized, so it
// is reported as an unavailable prerequisite instead of a new private outcome.
const KNOWN_CODES = new Set([
  'INVALID_ARGUMENT',
  'NOT_PAIRED',
  'BROKER_UNAVAILABLE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'OWNER_IN_USE',
  'WAIT_ALREADY_ACTIVE',
  'IDEMPOTENCY_CONFLICT',
  'DECISION_MISMATCH',
  'NOT_FOUND',
  'ENHANCEMENT_UNAVAILABLE',
  'STORAGE_FAILURE',
  'UNSUPPORTED_SCHEMA',
]);
const UNAVAILABLE_MESSAGE = 'the broker registration service is unavailable';

export class RegistrationError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.retryable = retryable;
  }
}

function unavailable() {
  return new RegistrationError('BROKER_UNAVAILABLE', UNAVAILABLE_MESSAGE, { retryable: true });
}

// A recognized versioned envelope travels unchanged. Anything else is redacted,
// so a proxy or malformed reply cannot inject an unlisted code or a secret-bearing
// diagnostic into a caller.
function propagated(response) {
  const error = response.body?.error;
  if (!isPlainObject(response.body) || response.body.schema_version !== 1) return null;
  if (!isPlainObject(error)) return null;
  if (typeof error.code !== 'string' || !KNOWN_CODES.has(error.code)) return null;
  if (typeof error.message !== 'string' || typeof error.retryable !== 'boolean') return null;
  return new RegistrationError(error.code, error.message, { retryable: error.retryable });
}

// Only `201` with both documented encodings is registration authority. Every
// other success fails closed without guessing an ID or a secret.
function registered(response) {
  if (response?.status !== 201 || !isPlainObject(response.body)) return null;
  const { registration_id: id, registration_secret: secret } = response.body;
  if (typeof id !== 'string' || !REGISTRATION_ID_PATTERN.test(id)) return null;
  if (typeof secret !== 'string' || !REGISTRATION_SECRET_PATTERN.test(secret)) return null;
  return { registration_id: id, registration_secret: secret };
}

class RegistrationBinding {
  #client;
  #heartbeatMs;
  #shutdownBudgetMs;
  #logger;
  #authority = null;
  #pending = null;
  #timer = null;
  #beating = false;
  #generation = 0;
  #closed = false;
  #closing = null;
  #lifecycle = new AbortController();

  constructor({ client, heartbeatMs, shutdownBudgetMs, logger }) {
    this.#client = client;
    this.#heartbeatMs = heartbeatMs;
    this.#shutdownBudgetMs = shutdownBudgetMs;
    this.#logger = logger;
  }

  // Lazy and single-flight: concurrent callers share one create attempt, and a
  // settled binding keeps returning its captured authority without new traffic.
  ensure() {
    if (this.#closed) return Promise.reject(unavailable());
    if (this.#authority !== null) return Promise.resolve({ ...this.#authority });
    return this.#begin();
  }

  // A rejected captured incarnation is replaced through the same single-flight create the
  // heartbeat uses, so a stale or concurrent rejection never destroys fresh authority.
  refresh(captured) {
    if (this.#closed) return Promise.reject(unavailable());
    const authority = this.#authority;
    if (authority === null) return this.#pending ?? this.#begin();
    const current =
      captured?.registration_id === authority.registration_id &&
      captured?.registration_secret === authority.registration_secret;
    if (!current) return Promise.resolve({ ...authority });
    this.#invalidate();
    return this.#pending ?? this.#begin();
  }

  // Terminal and idempotent: repeated calls share one shutdown and one budget.
  close() {
    this.#closing ??= this.#shutdown();
    return this.#closing;
  }

  // Minimum local identity check for a captured incarnation: does this binding still
  // hold exactly that authority? It reads retained state only, so it never refreshes,
  // retries, takes over or exchanges a stale capture for the current credential.
  holds(authority) {
    const current = this.#authority;
    return (
      !this.#closed &&
      current !== null &&
      authority?.registration_id === current.registration_id &&
      authority?.registration_secret === current.registration_secret
    );
  }

  #begin() {
    if (this.#pending !== null) return this.#pending;
    const generation = this.#generation;
    const pending = this.#create(generation).finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    // A heartbeat-initiated replacement may start without a caller awaiting it.
    pending.catch(() => {});
    this.#pending = pending;
    return pending;
  }

  async #create(generation) {
    const response = await this.#send('POST', ADAPTER_PATH, {});
    if (this.#stale(generation)) throw unavailable();
    const authority = registered(response);
    if (authority !== null) {
      this.#install(authority);
      return { ...authority };
    }
    // A duplicate owner is never stolen or retried, and an unreadable success is
    // never turned into guessed authority: both surface honestly.
    throw propagated(response) ?? unavailable();
  }

  async #heartbeat(generation) {
    const authority = this.#authority;
    if (authority === null || this.#beating || this.#stale(generation)) return;
    this.#beating = true;
    try {
      const response = await this.#send(
        'POST',
        `${ADAPTER_PATH}/${authority.registration_id}/heartbeat`,
        {},
        { [REGISTRATION_HEADER]: authority.registration_secret },
      );
      if (this.#stale(generation)) return;
      if (response.status === 401) {
        // The lease is gone. Drop the old authority and allow exactly one
        // replacement attempt, shared with any concurrent ensure().
        this.#invalidate();
        void this.#begin();
      }
      // Any other unrecognized outcome retains the known authority: only a
      // validated renewal or an explicit denial may change what we hold.
    } finally {
      this.#beating = false;
    }
  }

  async #shutdown() {
    this.#closed = true;
    this.#generation += 1;
    this.#stopHeartbeat();
    this.#pending = null;
    // Fence and cancel every lifecycle exchange still open, including a create
    // whose response was lost; that remote registration expires on its lease.
    this.#lifecycle.abort();
    const authority = this.#authority;
    this.#authority = null;
    if (authority === null) return;
    await this.#release(authority);
  }

  // Release names the captured incarnation only, so it can never remove a
  // replacement. A stalled exchange is destroyed at the shared deadline rather
  // than left to a promise timeout, and its remote expiry is not claimed.
  async #release(authority) {
    const controller = new AbortController();
    let deadline;
    const budget = new Promise((resolve) => {
      deadline = setTimeout(resolve, this.#shutdownBudgetMs);
      deadline.unref?.();
    });
    const release = this.#send(
      'DELETE',
      `${ADAPTER_PATH}/${authority.registration_id}`,
      undefined,
      { [REGISTRATION_HEADER]: authority.registration_secret },
      controller.signal,
    )
      .then((response) => {
        if (response.status === 204) this.#logger('portable.adapter.registration.released');
      })
      .catch(() => {});
    await Promise.race([release, budget]);
    clearTimeout(deadline);
    controller.abort();
  }

  #install(authority) {
    this.#stopHeartbeat();
    this.#authority = authority;
    this.#logger('portable.adapter.registration.created');
    const generation = this.#generation;
    const timer = setInterval(() => {
      void this.#heartbeat(generation).catch(() => {});
    }, this.#heartbeatMs);
    // A renewal timer never keeps the adapter process alive by itself.
    timer.unref?.();
    this.#timer = timer;
  }

  #invalidate() {
    this.#stopHeartbeat();
    this.#authority = null;
    this.#generation += 1;
    this.#logger('portable.adapter.registration.replaced');
  }

  #stopHeartbeat() {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #stale(generation) {
    return this.#closed || generation !== this.#generation;
  }

  async #send(method, path, body, headers = {}, signal = this.#lifecycle.signal) {
    try {
      return await this.#client.request(method, path, body, headers, { signal });
    } catch {
      // Transport failure, abort and local client errors carry no authority
      // claim, so they stay one redacted unavailable prerequisite.
      throw unavailable();
    }
  }
}

export function createRegistrationBinding({
  client,
  heartbeatMs = REGISTRATION_HEARTBEAT_MS,
  shutdownBudgetMs = REGISTRATION_SHUTDOWN_BUDGET_MS,
  logger = () => {},
} = {}) {
  if (client === null || typeof client?.request !== 'function') {
    throw new RegistrationError('INVALID_ARGUMENT', 'a local broker client is required');
  }
  if (!Number.isInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new RegistrationError('INVALID_ARGUMENT', 'the heartbeat cadence must be positive');
  }
  if (!Number.isInteger(shutdownBudgetMs) || shutdownBudgetMs <= 0) {
    throw new RegistrationError('INVALID_ARGUMENT', 'the shutdown budget must be positive');
  }
  if (typeof logger !== 'function') {
    throw new RegistrationError('INVALID_ARGUMENT', 'the logger must be a function');
  }
  return new RegistrationBinding({ client, heartbeatMs, shutdownBudgetMs, logger });
}
