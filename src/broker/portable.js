// Portable request authority over a caller-owned journal (design sections 3-4).
//
// A preparation call reserves a durable handle, an independently random
// request ID and a one-time request capability. Later calls authenticate with
// that capability; the handle, the reserved request ID and the display label
// grant nothing on their own, so sharing a connection or a label never widens
// access. Only the SHA-256 verifier of the capability is persisted, so replaying
// the journal cannot reconstruct the key or recover a capability the caller
// lost. A key holder of the same principal may use the reservation: authority
// follows the key, not the preparing invocation.
//
// The journal stays caller-owned. This module never opens, replaces or closes
// it, and no reservation result becomes visible before its serialized append
// has completed the journal's own file flush.
import { timingSafeEqual } from 'node:crypto';
import { invalidArgument, storageFailure } from '../errors.js';
import {
  REQUEST_CAPABILITY_PATTERN,
  REQUEST_HANDLE_PATTERN,
  REQUEST_ID_PATTERN,
  isPlainObject,
  randomRequestCapability,
  randomRequestHandle,
  randomRequestId,
  scalarLength,
  sha256Hex,
  utcTimestamp,
} from '../util/values.js';

export const PORTABLE_REPRESENTATION_SCHEMA_VERSION = 1;

const RESERVE_OP = 'handle.reserve';
const MAX_LABEL_SCALARS = 128;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESERVATION_FIELDS = [
  'capability_hash',
  'op',
  'owner_id',
  'prepared_at',
  'request_handle',
  'request_id',
  'session_label',
];
// A lone surrogate is not a Unicode scalar value and cannot round-trip through
// UTF-8, so it is rejected rather than silently replaced.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ignore = () => {};

// The label is display only: 1-128 Unicode scalar values are preserved exactly
// and are never treated as a verified session identity.
function labelProblem(value) {
  if (typeof value !== 'string' || value.length === 0)
    return 'session_label must be non-empty text';
  if (LONE_SURROGATE.test(value)) return 'session_label must be well-formed text';
  if (scalarLength(value) > MAX_LABEL_SCALARS) {
    return 'session_label must be 1-128 Unicode scalar values';
  }
  return null;
}

function reservationView(record) {
  return {
    owner_id: record.owner_id,
    request_handle: record.request_handle,
    request_id: record.request_id,
    session_label: record.session_label,
    prepared_at: record.prepared_at,
  };
}

function integrity(message) {
  return storageFailure(`journal replay failed: ${message}`, 'JOURNAL_STATE_INVALID');
}

function sameVerifier(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Replay trusts only what the writer committed: the mutation carries exactly
// the persisted fields, and any deviation, unknown operation or reused
// identifier stops recovery before a byte is rewritten.
function readReservation(mutation) {
  if (!isPlainObject(mutation) || typeof mutation.op !== 'string') {
    throw integrity('mutation is not a tagged object');
  }
  if (mutation.op !== RESERVE_OP) {
    throw integrity(`unknown mutation op ${JSON.stringify(mutation.op)}`);
  }
  const keys = Object.keys(mutation).sort();
  const exact = keys.length === RESERVATION_FIELDS.length;
  if (!exact || keys.some((key, index) => key !== RESERVATION_FIELDS[index])) {
    throw integrity(`${RESERVE_OP} must persist exactly ${RESERVATION_FIELDS.join(', ')}`);
  }
  if (typeof mutation.owner_id !== 'string' || mutation.owner_id.length === 0) {
    throw integrity(`${RESERVE_OP} requires an owner`);
  }
  if (!REQUEST_HANDLE_PATTERN.test(mutation.request_handle)) {
    throw integrity(`${RESERVE_OP} has a malformed request handle`);
  }
  if (!REQUEST_ID_PATTERN.test(mutation.request_id)) {
    throw integrity(`${RESERVE_OP} has a malformed reserved request id`);
  }
  if (!HASH_PATTERN.test(mutation.capability_hash)) {
    throw integrity(`${RESERVE_OP} has a malformed capability verifier`);
  }
  const problem = labelProblem(mutation.session_label);
  if (problem !== null) throw integrity(problem);
  if (
    typeof mutation.prepared_at !== 'string' ||
    !Number.isFinite(Date.parse(mutation.prepared_at))
  ) {
    throw integrity(`${RESERVE_OP} has a malformed preparation time`);
  }
  return {
    owner_id: mutation.owner_id,
    request_handle: mutation.request_handle,
    request_id: mutation.request_id,
    capability_hash: mutation.capability_hash,
    session_label: mutation.session_label,
    prepared_at: mutation.prepared_at,
  };
}

class PortableBroker {
  #journal;

  #owners;

  #port;

  #clock;

  #logger;

  #startedAt;

  #byHandle = new Map();

  #byRequestId = new Map();

  #byVerifier = new Map();

  #queue = Promise.resolve();

  #recovered = false;

  #closing = false;

  #closed = false;

  #closingPromise = null;

  constructor({ journal, owners, port, clock, logger }) {
    this.#journal = journal;
    this.#owners = new Map();
    for (const owner of owners) {
      if (typeof owner?.owner_id !== 'string' || owner.owner_id.length === 0) {
        throw invalidArgument('each configured owner needs an owner_id');
      }
      const problem = labelProblem(owner.label);
      if (problem !== null) throw invalidArgument(`owner ${owner.owner_id}: ${problem}`);
      if (this.#owners.has(owner.owner_id)) {
        throw invalidArgument(`owner ${owner.owner_id} is configured twice`);
      }
      this.#owners.set(owner.owner_id, { label: owner.label });
    }
    this.#port = port;
    this.#clock = clock;
    this.#logger = logger;
    this.#startedAt = utcTimestamp(clock());
  }

  // Rebuilds reservations from committed transactions. A replay failure leaves
  // the previous state untouched, and the journal is never written here.
  async recover() {
    if (this.#closed) throw storageFailure('the portable broker is closed', 'STORAGE_FAILURE');
    const { transactions } = await this.#journal.recover();
    const byHandle = new Map();
    const byRequestId = new Map();
    const byVerifier = new Map();
    for (const transaction of transactions) {
      for (const mutation of transaction?.mutations ?? []) {
        const record = readReservation(mutation);
        if (byHandle.has(record.request_handle)) {
          throw integrity(`request handle ${record.request_handle} is reserved twice`);
        }
        if (byRequestId.has(record.request_id)) {
          throw integrity(`reserved request id ${record.request_id} is used twice`);
        }
        if (byVerifier.has(record.capability_hash)) {
          throw integrity(`capability verifier for ${record.request_handle} is reused`);
        }
        byHandle.set(record.request_handle, record);
        byRequestId.set(record.request_id, record);
        byVerifier.set(record.capability_hash, record);
      }
    }
    this.#byHandle = byHandle;
    this.#byRequestId = byRequestId;
    this.#byVerifier = byVerifier;
    this.#recovered = true;
    return { records: transactions.length };
  }

  // Reserves fresh authority for one preparation call. Validated up front, then
  // serialized so one journal append per call is ordered with every other
  // mutation this broker performs.
  reserveHandle({ ownerId, sessionLabel } = {}) {
    if (this.#closing) {
      return Promise.reject(storageFailure('the portable broker is closed', 'STORAGE_FAILURE'));
    }
    if (!this.#recovered) {
      return Promise.reject(
        storageFailure('the portable broker has not recovered the journal', 'STORAGE_FAILURE'),
      );
    }
    const owner = this.#owners.get(ownerId);
    if (owner === undefined) return Promise.reject(invalidArgument('unknown owner'));
    const label = sessionLabel === undefined ? owner.label : sessionLabel;
    const problem = labelProblem(label);
    if (problem !== null) return Promise.reject(invalidArgument(problem));
    return this.#enqueue(() => this.#reserve(ownerId, label));
  }

  // Authenticates a reservation with its capability. Missing, malformed,
  // foreign or mismatched keys return null without disclosing whether the
  // handle or request exists. A recovered historical reservation keeps its
  // immutable owner and grants authority only while that principal is still
  // present in the current configuration; removing it revokes new authority
  // without rewriting history.
  authorize({ ownerId, capability, requestHandle, requestId } = {}) {
    if (typeof capability !== 'string' || !REQUEST_CAPABILITY_PATTERN.test(capability)) return null;
    const verifier = sha256Hex(capability);
    const record = this.#byVerifier.get(verifier);
    if (record === undefined || !sameVerifier(record.capability_hash, verifier)) return null;
    if (record.owner_id !== ownerId || !this.#owners.has(record.owner_id)) return null;
    if (requestHandle !== undefined && record.request_handle !== requestHandle) return null;
    if (requestId !== undefined && record.request_id !== requestId) return null;
    return reservationView(record);
  }

  // Redacted view: the capability verifier stays journal-internal.
  snapshot() {
    return { prepared: [...this.#byHandle.values()].map(reservationView), requests: [] };
  }

  status() {
    return {
      schema_version: PORTABLE_REPRESENTATION_SCHEMA_VERSION,
      broker: { pid: process.pid, port: this.#port, started_at: this.#startedAt },
      requests: [],
    };
  }

  // Drains accepted commits, then refuses further mutation. The caller's
  // journal is deliberately left open for its owner to close.
  close() {
    if (this.#closingPromise !== null) return this.#closingPromise;
    this.#closing = true;
    this.#closingPromise = (async () => {
      await this.#queue;
      this.#closed = true;
    })();
    return this.#closingPromise;
  }

  async #reserve(ownerId, sessionLabel) {
    const requestHandle = randomRequestHandle();
    const requestId = randomRequestId();
    const requestCapability = randomRequestCapability();
    const capabilityHash = sha256Hex(requestCapability);
    if (
      this.#byHandle.has(requestHandle) ||
      this.#byRequestId.has(requestId) ||
      this.#byVerifier.has(capabilityHash)
    ) {
      // Fresh randomness collided with reserved authority: refuse rather than
      // reassign an immutable identifier.
      throw storageFailure(
        'fresh request authority collided with a reserved identifier',
        'JOURNAL_IDENTIFIER_COLLISION',
      );
    }
    const record = {
      op: RESERVE_OP,
      owner_id: ownerId,
      request_handle: requestHandle,
      request_id: requestId,
      capability_hash: capabilityHash,
      session_label: sessionLabel,
      prepared_at: utcTimestamp(this.#clock()),
    };
    // The result exists only after the append has completed its file flush, so
    // a lost result cannot leave a key that was issued but never committed.
    await this.#journal.append([record]);
    this.#remember(record);
    this.#logger('portable.handle.reserved', { owner_id: ownerId, request_id: requestId });
    return {
      schema_version: PORTABLE_REPRESENTATION_SCHEMA_VERSION,
      request_handle: requestHandle,
      request_id: requestId,
      request_capability: requestCapability,
    };
  }

  #remember(record) {
    this.#byHandle.set(record.request_handle, record);
    this.#byRequestId.set(record.request_id, record);
    this.#byVerifier.set(record.capability_hash, record);
  }

  #enqueue(task) {
    const run = this.#queue.then(task);
    this.#queue = run.then(ignore, ignore);
    return run;
  }
}

export function createPortableBroker({
  journal,
  owners,
  port,
  clock = () => Date.now(),
  logger = () => {},
} = {}) {
  if (typeof journal?.append !== 'function' || typeof journal?.recover !== 'function') {
    throw invalidArgument('a portable broker needs a caller-owned journal');
  }
  if (!Array.isArray(owners)) throw invalidArgument('owners must be the configured owner list');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw invalidArgument('port must be a TCP port number');
  }
  if (typeof clock !== 'function') throw invalidArgument('clock must be a function');
  if (typeof logger !== 'function') throw invalidArgument('logger must be a function');
  return new PortableBroker({ journal, owners, port, clock, logger });
}
