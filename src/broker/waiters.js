// Portable waiter registry (design sections 3, 4 and 7, G1-G3).
//
// A waiter is an in-process observation that one attached transport is waiting for
// one request's committed outcome. Nothing here is durable: the registry holds only
// the pending wake observation, its turnover timer and the transport's abort
// listener, so a restart, a listener close or a lost transport leaves no authority,
// no fabricated outcome and no ledger evidence behind.
//
// A terminal producer installs its committed closure before waking, so a wake never
// carries an uncommitted result; a failed or uncertain append settles the affected
// waits as that storage failure instead. An attached waiter is also the
// reachability signal a terminal writer selects its initial delivery state from, so
// a captured registration is revalidated at selection and settlement instead of
// being trusted from admission.
import { invalidArgument } from '../errors.js';

export const WAIT_TURNOVER_MS = 25000;

// The two non-terminal settlements. Both are frozen because no caller copies them.
export const WAIT_DETACHED = Object.freeze({ state: 'detached' });
export const WAIT_CONFLICT = Object.freeze({ state: 'conflict' });
// A core wait has no registration to capture; a transport-bound one supplies its
// own predicate, so reachability is never assumed from a cached admission result.
const ALWAYS_REACHABLE = Object.freeze({ valid: () => true });
const ignore = () => {};

class WaiterRegistry {
  #timeoutMs;

  #entries = new Map();

  #closed = false;

  constructor({ timeoutMs }) {
    this.#timeoutMs = timeoutMs;
  }

  // An attached waiter for this request; the admission turn refuses a duplicate.
  has(requestId) {
    return this.#entries.has(requestId);
  }

  // Live reachability for a terminal writer's delivery selection: an attached
  // waiter whose captured registration is still valid at this moment.
  live(requestId) {
    const entry = this.#entries.get(requestId);
    return entry !== undefined && entry.registration.valid();
  }

  // Installs one wake observation before the caller samples the target's deadline.
  // The returned envelope is not thenable, so a serialization point may return it
  // without adopting the future settlement; `release` abandons only this slot after
  // an admission refusal.
  enter({ requestId, signal, registration, turnover }) {
    if (this.#closed) return { wait: Promise.resolve(WAIT_DETACHED), release: ignore };
    let settle;
    const wait = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A refused admission may abandon this promise before a consumer attaches,
    // while every real consumer still observes the rejection.
    wait.catch(ignore);
    const entry = {
      requestId,
      registration: registration ?? ALWAYS_REACHABLE,
      settle,
      timer: null,
      signal,
      onAbort: null,
      turnover,
      done: false,
    };
    this.#entries.set(requestId, entry);
    if (signal !== undefined) {
      entry.onAbort = () => this.#settle(entry, WAIT_DETACHED);
      signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.#turn(entry);
    }, this.#timeoutMs);
    return { wait, release: () => this.#settle(entry, WAIT_DETACHED) };
  }

  // Settles the matching attached waiter with an installed terminal representation
  // or a turnover result. An absent, closed or already settled exchange is a no-op,
  // so a late producer cannot revive, renew or re-create anything.
  wake(requestId, value) {
    const entry = this.#entries.get(requestId);
    if (entry === undefined) return false;
    this.#settle(entry, value);
    return true;
  }

  // A failed or uncertain append is not an outcome: affected waits settle as that
  // storage failure rather than a synthesized terminal result.
  fail(requestIds, error) {
    for (const requestId of requestIds) {
      const entry = this.#entries.get(requestId);
      if (entry !== undefined) this.#settle(entry, undefined, error);
    }
  }

  // Terminal and idempotent: close detaches every admitted wait and removes its
  // timer and listener, so no poll turnover is needed to settle it.
  close() {
    this.#closed = true;
    for (const entry of [...this.#entries.values()]) this.#settle(entry, WAIT_DETACHED);
  }

  // Turnover runs the caller's serialized deadline inspection, then settles with
  // whatever that check produced; an abandoned exchange settles nothing.
  async #turn(entry) {
    if (entry.done) return;
    let value;
    try {
      value = await entry.turnover();
    } catch (error) {
      this.#settle(entry, undefined, error);
      return;
    }
    this.#settle(entry, value);
  }

  #settle(entry, value, error) {
    if (entry.done) return;
    entry.done = true;
    if (this.#entries.get(entry.requestId) === entry) this.#entries.delete(entry.requestId);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.onAbort !== null) {
      entry.signal.removeEventListener('abort', entry.onAbort);
      entry.onAbort = null;
    }
    if (error === undefined) entry.settle.resolve(value);
    else entry.settle.reject(error);
  }
}

export function createWaiterRegistry({ timeoutMs = WAIT_TURNOVER_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw invalidArgument('the wait turnover must be a positive whole number of milliseconds');
  }
  return new WaiterRegistry({ timeoutMs });
}
