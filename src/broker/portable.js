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
// Recovery also replays the pairing vocabulary of design section 4, because
// creation consumes paired state. Pairing is validated from committed history
// alone, so no transport owner, token or recovery clock can grant, remove or
// invalidate it, and the private getter below never exposes challenges.
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
const CHALLENGE_OP = 'pairing.challenge';
const CONSUME_OP = 'pairing.challenge.consume';
const SET_OP = 'pairing.set';
const PAIRING_TTL_SECONDS = 300n;
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
const CHALLENGE_FIELDS = ['created_at', 'expires_at', 'hash', 'op'];
const CONSUME_FIELDS = ['consumed_at', 'hash', 'op'];
const SET_FIELDS = ['op', 'pairing'];
const PAIRING_FIELDS = ['chat_id', 'paired_at', 'user_id'];
// Pairing timestamps are UTC RFC 3339 instants. The offset is `Z` or `+00:00`
// only: `-00:00` states that the offset is unknown, so it is not UTC here.
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|\+00:00)$/;
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

// Every committed mutation carries exactly the fields its op defines, so an
// added, missing or misspelled field is refused instead of quietly ignored.
function exactFields(value, fields) {
  const keys = Object.keys(value).sort();
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
    throw integrity(`mutation must persist exactly ${fields.join(', ')}`);
  }
}

// Replay trusts only what the writer committed: the mutation carries exactly
// the persisted fields, and any deviation, unknown operation or reused
// identifier stops recovery before a byte is rewritten.
function readReservation(mutation) {
  exactFields(mutation, RESERVATION_FIELDS);
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

// A stored instant keeps its exact second and its fraction as written, so an
// arbitrary fractional spelling compares as the value it represents and no
// rounding can turn a refusal into an acceptance.
function readInstant(text) {
  if (typeof text !== 'string') return null;
  const match = UTC_TIMESTAMP.exec(text);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  const fraction = match[7] ?? '';
  return { seconds: BigInt(date.getTime() / 1000), fraction: fraction.replace(/0+$/, '') };
}

function compareInstants(left, right) {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftDigits = left.fraction.padEnd(width, '0');
  const rightDigits = right.fraction.padEnd(width, '0');
  if (leftDigits === rightDigits) return 0;
  return leftDigits < rightDigits ? -1 : 1;
}

// Telegram IDs are stored losslessly as decimal strings: no numeric conversion,
// no digit-count ceiling, exact spelling kept, and an all-zero string names
// nobody. Actual sender/private-chat checking belongs to the Telegram boundary.
function identityProblem(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'a pairing identity must be a non-empty decimal string';
  }
  let nonzero = false;
  for (const character of value) {
    if (character < '0' || character > '9') return 'a pairing identity must use ASCII digits only';
    nonzero ||= character !== '0';
  }
  return nonzero ? null : 'a pairing identity must contain a nonzero digit';
}

function readChallenge(mutation) {
  exactFields(mutation, CHALLENGE_FIELDS);
  if (typeof mutation.hash !== 'string' || !HASH_PATTERN.test(mutation.hash)) {
    throw integrity('pairing.challenge has a malformed code hash');
  }
  const createdAt = readInstant(mutation.created_at);
  const expiresAt = readInstant(mutation.expires_at);
  if (createdAt === null) throw integrity('pairing.challenge has a malformed creation time');
  if (expiresAt === null) throw integrity('pairing.challenge has a malformed expiry');
  if (
    expiresAt.seconds - createdAt.seconds !== PAIRING_TTL_SECONDS ||
    expiresAt.fraction !== createdAt.fraction
  ) {
    throw integrity('pairing.challenge must expire exactly five minutes after creation');
  }
  return { kind: 'challenge', hash: mutation.hash, createdAt, expiresAt, consumedAt: null };
}

function readConsume(mutation) {
  exactFields(mutation, CONSUME_FIELDS);
  if (typeof mutation.hash !== 'string' || !HASH_PATTERN.test(mutation.hash)) {
    throw integrity('pairing.challenge.consume has a malformed code hash');
  }
  const consumedAt = readInstant(mutation.consumed_at);
  if (consumedAt === null) {
    throw integrity('pairing.challenge.consume has a malformed consumption time');
  }
  return { kind: 'consume', hash: mutation.hash, consumedAt };
}

function readSet(mutation) {
  exactFields(mutation, SET_FIELDS);
  const pairing = mutation.pairing;
  if (!isPlainObject(pairing)) throw integrity('pairing.set requires a pairing record');
  exactFields(pairing, PAIRING_FIELDS);
  const problem = identityProblem(pairing.user_id) ?? identityProblem(pairing.chat_id);
  if (problem !== null) throw integrity(problem);
  const pairedAt = readInstant(pairing.paired_at);
  if (pairedAt === null) throw integrity('pairing.set has a malformed pairing time');
  return {
    kind: 'set',
    pairedAt,
    record: { user_id: pairing.user_id, chat_id: pairing.chat_id, paired_at: pairing.paired_at },
  };
}

// Pairing joins the reservation vocabulary of committed history. An unfamiliar
// operation stays fatal rather than skipped.
function readMutation(mutation) {
  if (!isPlainObject(mutation) || typeof mutation.op !== 'string') {
    throw integrity('mutation is not a tagged object');
  }
  switch (mutation.op) {
    case RESERVE_OP:
      return { kind: 'reservation', record: readReservation(mutation) };
    case CHALLENGE_OP:
      return readChallenge(mutation);
    case CONSUME_OP:
      return readConsume(mutation);
    case SET_OP:
      return readSet(mutation);
    default:
      throw integrity(`unknown mutation op ${JSON.stringify(mutation.op)}`);
  }
}

// One transaction is applied all-or-none, and its array order cannot matter:
// its declarations, consumptions and binding are resolved together against the
// history before it. A consumption burns a challenge permanently; a pairing set
// needs exactly one consumption in the same transaction.
function applyPairing(records, challenges, pairing) {
  const declarations = records.filter((record) => record.kind === 'challenge');
  const consumptions = records.filter((record) => record.kind === 'consume');
  const sets = records.filter((record) => record.kind === 'set');
  for (const declaration of declarations) {
    if (challenges.has(declaration.hash)) throw integrity('a pairing challenge is declared twice');
    challenges.set(declaration.hash, declaration);
  }
  for (const consumption of consumptions) {
    const challenge = challenges.get(consumption.hash);
    if (challenge === undefined) throw integrity('a consumption names no declared challenge');
    if (challenge.consumedAt !== null) throw integrity('a pairing challenge is consumed twice');
    if (compareInstants(consumption.consumedAt, challenge.createdAt) < 0) {
      throw integrity('a consumption precedes its challenge');
    }
    if (compareInstants(consumption.consumedAt, challenge.expiresAt) >= 0) {
      throw integrity('a consumption must precede challenge expiry');
    }
    challenge.consumedAt = consumption.consumedAt;
  }
  if (sets.length === 0) return pairing;
  if (sets.length > 1) throw integrity('a transaction sets more than one pairing');
  if (pairing !== null) throw integrity('a pairing already exists');
  if (consumptions.length !== 1) throw integrity('a pairing set needs exactly one consumption');
  if (compareInstants(sets[0].pairedAt, consumptions[0].consumedAt) !== 0) {
    throw integrity('paired_at must equal the same transaction consumption');
  }
  return sets[0].record;
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

  #pairing = null;

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

  // Rebuilds reservations and pairing from committed transactions. The whole
  // history is staged first: a replay failure installs nothing and leaves the
  // previous state untouched, and the journal is never written here.
  async recover() {
    if (this.#closed) throw storageFailure('the portable broker is closed', 'STORAGE_FAILURE');
    const { transactions } = await this.#journal.recover();
    const byHandle = new Map();
    const byRequestId = new Map();
    const byVerifier = new Map();
    const challenges = new Map();
    let pairing = null;
    for (const transaction of transactions) {
      const records = (transaction?.mutations ?? []).map(readMutation);
      for (const { kind, record } of records) {
        if (kind !== 'reservation') continue;
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
      pairing = applyPairing(records, challenges, pairing);
    }
    this.#byHandle = byHandle;
    this.#byRequestId = byRequestId;
    this.#byVerifier = byVerifier;
    this.#pairing = pairing;
    this.#recovered = true;
    return { records: transactions.length };
  }

  // Private copied view (design section 4): the stored values only, never a
  // challenge, hash or consumption, and mutating the result cannot alter state.
  pairing() {
    return this.#pairing === null ? null : { ...this.#pairing };
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
