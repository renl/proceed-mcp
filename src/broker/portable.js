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
// Challenge issuance is the only writer of a new pairing code: one generated
// code is hashed inside the serialized turn, one UTC instant fixes its exact
// five-minute deadline, and the plaintext leaves only through the caller's
// return value. The Telegram update cursor is the other durable position
// replayed from history: a raw nonnegative update id that strictly increases,
// never a derived next offset and never a recovery-time computation.
//
// Request replay decodes creation, expiry and cancellation from committed
// history: creation binds to an already committed reservation and pairing, a
// closure resolves one pending request, and the whole history is staged before
// anything is installed. Observations are fresh copies of the committed
// representation. Expiry and cancellation are written here, and awaited status
// captures its view in one serialized turn.
//
// Creation is the single writer for a pending request: an authorized handle
// creates at most one request, an identical retry observes it through that same
// expiry path, and changed fields are refused before any time is sampled. A
// retained capability may also close its own pending request as cancelled; at or
// after the deadline the existing expiry writer wins instead, and one resolution
// is kept.
//
// Delivery evidence is separate from resolution: a capability-authorized
// acknowledgement confirms the holder received the matching terminal outcome,
// and a returned report records an adapter's claim of a successful result write.
// Each keeps its own first timestamp, neither allocates a decision or changes the
// outcome, repeats never append, and a returned report never downgrades a
// confirmation. Both are ledger assertions, never proof of a written response.
//
// A wait is an attached, non-durable observation of one request: admission,
// duplicate refusal and the deadline check share the serialized turn, but the
// turn is released before a future outcome is awaited. Every terminal writer
// selects its initial delivery state from live waiters inside that turn, installs
// the committed closure before waking, and never treats a wake, a turnover or a
// detached transport as receipt.
//
// Pairing consumption is the single writer for a first pairing (design sections
// 4, 5 and 7). One serialized turn rechecks the committed update cursor, the
// lossless sender/chat strings, a per-sender rolling attempt window, the absence
// of a pairing and one known unconsumed challenge, then samples the single
// instant that both validates `created_at <= now < expires_at` and stamps the
// persisted consume/set/cursor frame. Success installs nothing before that frame
// has flushed, and a canonical newer refusal commits only its own cursor.
//
// The journal stays caller-owned. This module never opens, replaces or closes
// it, and no reservation result becomes visible before its serialized append
// has completed the journal's own file flush.
//
// A rejected append or a failed whole-history recovery leaves the file in an
// uncertain state, so the instance fences itself: every later turn, queued or
// fresh, is refused before it samples the clock, allocates an identity, appends
// or reports success. Nothing is retried, compensated, rolled back or cleared in
// place; recovery of the file is an ordinary close and reopen with a fresh
// instance.
import { timingSafeEqual } from 'node:crypto';
import { conflict, invalidArgument, storageFailure, unavailable } from '../errors.js';
import { MAX_TELEGRAM_TEXT, measurePortablePresentation } from '../telegram/portable-render.js';
import {
  CLIENT_REQUEST_ID_PATTERN,
  DECISION_ID_PATTERN,
  PAIRING_CODE_PATTERN,
  REQUEST_CAPABILITY_PATTERN,
  REQUEST_HANDLE_PATTERN,
  REQUEST_ID_PATTERN,
  isPlainObject,
  randomDecisionId,
  randomPairingCode,
  randomRequestCapability,
  randomRequestHandle,
  randomRequestId,
  scalarLength,
  sha256Hex,
  utcTimestamp,
} from '../util/values.js';
import { WAIT_CONFLICT, WAIT_DETACHED, createWaiterRegistry } from './waiters.js';

export const PORTABLE_REPRESENTATION_SCHEMA_VERSION = 1;

const RESERVE_OP = 'handle.reserve';
const CHALLENGE_OP = 'pairing.challenge';
const CONSUME_OP = 'pairing.challenge.consume';
const SET_OP = 'pairing.set';
const CURSOR_OP = 'telegram.cursor';
const CREATE_OP = 'request.create';
const EXPIRE_OP = 'request.expire';
const CANCEL_OP = 'request.cancel';
const ACKNOWLEDGE_OP = 'request.acknowledge';
const RETURNED_OP = 'request.returned';
const PAIRING_TTL_SECONDS = 300n;
// At most five verification attempts per sender in any rolling 60-second
// interval. The limiter is process-local, so a restart resets it and no failure
// counter, plaintext code or challenge detail is ever journaled.
const PAIRING_ATTEMPT_LIMIT = 5;
const PAIRING_ATTEMPT_WINDOW_MS = 60000;
const MAX_LABEL_SCALARS = 128;
const MIN_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 86400;
const DEFAULT_DURATION_SECONDS = 3600;
const MAX_ACTION_SCALARS = 1000;
const MAX_CONTEXT_SCALARS = 1000;
// The one refusal that names an actionable operator step; it is disclosed only
// after authority succeeds and is never used to hide an authority failure.
const PAIRING_REQUIRED_MESSAGE =
  'No human is paired; run proceed-mcp pair and complete private-chat pairing';
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
const CURSOR_FIELDS = ['last_update_id', 'op'];
const PAIRING_FIELDS = ['chat_id', 'paired_at', 'user_id'];
const CREATE_FIELDS = [
  'action',
  'client_request_id',
  'context',
  'created_at',
  'expires_at',
  'expires_in_seconds',
  'op',
  'pairing_snapshot',
  'request_handle',
];
// Expiry and cancellation persist the same five closure fields: one mutation
// establishes the terminal resolution, its identity and its initial delivery.
const CLOSURE_FIELDS = ['decision_id', 'delivery_state', 'op', 'request_id', 'resolved_at'];
// First delivery evidence persists exactly five fields too; the two kinds differ
// only in the name of their independent timestamp.
const EVIDENCE_FIELDS = Object.freeze({
  acknowledge: ['acknowledged_at', 'decision_id', 'delivery_state', 'op', 'request_id'],
  returned: ['decision_id', 'delivery_state', 'op', 'request_id', 'returned_at'],
});
const EVIDENCE_OPS = Object.freeze({ acknowledge: ACKNOWLEDGE_OP, returned: RETURNED_OP });
const EVIDENCE_TIME = Object.freeze({
  acknowledge: 'acknowledged_at',
  returned: 'returned_at',
});
// A first evidence kind can only establish a `returned` report or a
// `confirmed` acknowledgement; a returned report on already confirmed state
// retains confirmation.
const EVIDENCE_STATES = new Set(['confirmed', 'returned']);
// Initial delivery for a terminal closure: an attached admitted waiter whose
// captured registration is still valid selects `pending`, anything else
// `unavailable`. Neither value is receipt evidence.
const DELIVERY_STATES = new Set(['pending', 'unavailable']);
const EVENT_CAPABILITY = Object.freeze({
  status: 'unverified',
  revision: null,
  reason: 'No verified Events contract or host support',
});
// A sweep commits one bounded transaction per group; grouping is an internal
// batching choice, not an ordering promise to the caller.
const SWEEP_GROUP_SIZE = 100;
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

// Caller-supplied text is type-, well-formedness- and length-checked before any
// rendering measurement or comparison can consume it.
function textProblem(value, name, min, max) {
  if (typeof value !== 'string') return `${name} must be text`;
  if (LONE_SURROGATE.test(value)) return `${name} must be well-formed text`;
  const length = scalarLength(value);
  if (length < min || length > max) return `${name} must be ${min}-${max} Unicode scalar values`;
  return null;
}

// Caller-supplied creation fields are validated before authority is consulted:
// a malformed value stays a caller error even when its key could never be used,
// and only an omitted duration takes the default, so no other value is coerced.
function creationFields(input) {
  if (!isPlainObject(input)) {
    throw invalidArgument('createRequest expects an argument object');
  }
  const { clientRequestId, action, context, expiresInSeconds } = input;
  if (typeof clientRequestId !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw invalidArgument('client_request_id must be 1-128 ASCII letters, digits, "_" or "-"');
  }
  const actionProblem = textProblem(action, 'action', 1, MAX_ACTION_SCALARS);
  if (actionProblem !== null) throw invalidArgument(actionProblem);
  const contextProblem = textProblem(context, 'context', 0, MAX_CONTEXT_SCALARS);
  if (contextProblem !== null) throw invalidArgument(contextProblem);
  if (expiresInSeconds === undefined) {
    return { clientRequestId, action, context, duration: DEFAULT_DURATION_SECONDS };
  }
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_DURATION_SECONDS ||
    expiresInSeconds > MAX_DURATION_SECONDS
  ) {
    throw invalidArgument(
      `expires_in_seconds must be whole seconds from ${MIN_DURATION_SECONDS} to ${MAX_DURATION_SECONDS}`,
    );
  }
  return { clientRequestId, action, context, duration: expiresInSeconds };
}

// An existing creation is compared exactly: the committed instants supply the
// effective duration, and the caller's key, action and context are never
// normalized, trimmed or rounded into an accidental match.
function sameCreation(request, fields) {
  return (
    request.client_request_id === fields.clientRequestId &&
    request.action === fields.action &&
    request.context === fields.context &&
    request.expiresAt.seconds - request.createdAt.seconds === BigInt(fields.duration)
  );
}

// The common request representation of design section 3, rebuilt as a fresh
// copy on every observation: the nested event capability is included and the
// pairing snapshot, capability verifier and requested duration are not.
function requestView(request) {
  return {
    schema_version: PORTABLE_REPRESENTATION_SCHEMA_VERSION,
    request_handle: request.request_handle,
    request_id: request.request_id,
    client_request_id: request.client_request_id,
    owner_id: request.owner_id,
    session_label: request.session_label,
    action: request.action,
    context: request.context,
    created_at: request.created_at,
    expires_at: request.expires_at,
    resolution: request.resolution,
    resolved_at: request.resolved_at,
    response_text: request.response_text,
    decision_id: request.decision_id,
    telegram_state: request.telegram_state,
    delivery_state: request.delivery_state,
    delivery_error: request.delivery_error,
    event_capability: { ...EVENT_CAPABILITY },
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

// A clock reading becomes an exact instant: the stored deadline keeps its
// fractional spelling, so a submillisecond deadline is never rounded into the
// past and a sample that reaches only the whole second is not yet due.
function clockInstant(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const fraction = String(milliseconds - seconds * 1000).padStart(3, '0');
  return { seconds: BigInt(seconds), fraction: fraction.replace(/0+$/, '') };
}

function isDue(request, milliseconds) {
  return compareInstants(clockInstant(milliseconds), request.expiresAt) >= 0;
}

// Creation samples the clock exactly once. An unusable reading or an instant
// that cannot be represented is a storage failure, not a caller error, and it is
// refused before any append, so it never fences the journal. Challenge issuance
// reuses the same rule with its own five-minute duration and action name.
function creationTimes(clock, duration, action = 'creating a request') {
  let milliseconds;
  try {
    milliseconds = clock();
  } catch (cause) {
    throw storageFailure(`the broker clock failed while ${action}`, 'STORAGE_FAILURE', cause);
  }
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    throw storageFailure('the broker clock did not return a usable instant', 'STORAGE_FAILURE');
  }
  let createdText;
  let expiresText;
  try {
    createdText = utcTimestamp(milliseconds);
    expiresText = utcTimestamp(milliseconds + duration * 1000);
  } catch (cause) {
    throw storageFailure(
      'the creation time cannot be represented in UTC',
      'STORAGE_FAILURE',
      cause,
    );
  }
  const createdAt = readInstant(createdText);
  const expiresAt = readInstant(expiresText);
  if (createdAt === null || expiresAt === null) {
    throw storageFailure(
      'the creation time is outside the representable UTC range',
      'STORAGE_FAILURE',
    );
  }
  return { created_at: createdText, expires_at: expiresText, createdAt, expiresAt };
}

// Cancellation and delivery evidence each record one broker time inside their
// serialized turn. An unusable reading or an instant that cannot be represented
// is the existing storage failure, refused before any append, so it never fences
// the journal.
function turnTime(clock, action, noun) {
  let milliseconds;
  try {
    milliseconds = clock();
  } catch (cause) {
    throw storageFailure(`the broker clock failed while ${action}`, 'STORAGE_FAILURE', cause);
  }
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    throw storageFailure('the broker clock did not return a usable instant', 'STORAGE_FAILURE');
  }
  let text;
  try {
    text = utcTimestamp(milliseconds);
  } catch (cause) {
    throw storageFailure(`the ${noun} time cannot be represented in UTC`, 'STORAGE_FAILURE', cause);
  }
  const instant = readInstant(text);
  if (instant === null) {
    throw storageFailure(
      `the ${noun} time is outside the representable UTC range`,
      'STORAGE_FAILURE',
    );
  }
  return { milliseconds, text, instant };
}

function cancellationTime(clock) {
  return turnTime(clock, 'cancelling a request', 'cancellation');
}

function evidenceTime(clock) {
  return turnTime(clock, 'recording delivery evidence', 'delivery evidence');
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

// Every request field is type-guarded before a pattern, comparison or lookup sees
// it, so an array- or object-shaped value can never be coerced into a valid one.
function readCreate(mutation) {
  exactFields(mutation, CREATE_FIELDS);
  const handle = mutation.request_handle;
  if (typeof handle !== 'string') throw integrity(`${CREATE_OP} needs a text handle`);
  if (!REQUEST_HANDLE_PATTERN.test(handle)) throw integrity(`${CREATE_OP} has a malformed handle`);
  const key = mutation.client_request_id;
  if (typeof key !== 'string') throw integrity(`${CREATE_OP} needs a text idempotency key`);
  if (!CLIENT_REQUEST_ID_PATTERN.test(key)) throw integrity(`${CREATE_OP} has a malformed key`);
  const actionProblem = textProblem(mutation.action, 'action', 1, MAX_ACTION_SCALARS);
  if (actionProblem !== null) throw integrity(`${CREATE_OP} ${actionProblem}`);
  const contextProblem = textProblem(mutation.context, 'context', 0, MAX_CONTEXT_SCALARS);
  if (contextProblem !== null) throw integrity(`${CREATE_OP} ${contextProblem}`);
  const duration = mutation.expires_in_seconds;
  if (!Number.isInteger(duration)) throw integrity(`${CREATE_OP} needs whole seconds`);
  if (duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
    throw integrity(`${CREATE_OP} duration is outside the admitted range`);
  }
  const createdAt = readInstant(mutation.created_at);
  if (createdAt === null) throw integrity(`${CREATE_OP} has a malformed creation time`);
  const expiresAt = readInstant(mutation.expires_at);
  if (expiresAt === null) throw integrity(`${CREATE_OP} has a malformed expiry`);
  // The deadline is exactly one duration after creation, compared as represented
  // instants so an arbitrary fractional spelling cannot start a rounding drift.
  const deadline = { seconds: createdAt.seconds + BigInt(duration), fraction: createdAt.fraction };
  if (compareInstants(expiresAt, deadline) !== 0) {
    throw integrity(`${CREATE_OP} expiry is not its duration after creation`);
  }
  // The snapshot repeats the three stored pairing values, so it is compared with
  // them exactly and supplies the pairing instant for the creation lower bound.
  const snapshot = mutation.pairing_snapshot;
  if (!isPlainObject(snapshot)) throw integrity(`${CREATE_OP} needs a pairing snapshot`);
  exactFields(snapshot, PAIRING_FIELDS);
  const problem = identityProblem(snapshot.user_id) ?? identityProblem(snapshot.chat_id);
  if (problem !== null) throw integrity(`${CREATE_OP} snapshot: ${problem}`);
  const pairedAt = readInstant(snapshot.paired_at);
  if (pairedAt === null) throw integrity(`${CREATE_OP} snapshot time is malformed`);
  return {
    kind: 'create',
    record: {
      request_handle: handle,
      client_request_id: key,
      action: mutation.action,
      context: mutation.context,
      created_at: mutation.created_at,
      expires_at: mutation.expires_at,
      createdAt,
      expiresAt,
      pairedAt,
      snapshot,
    },
  };
}

// A closure decodes from exactly its five persisted fields: only the window and
// the installed resolution differ between expiry and cancellation.
function readClosure(mutation, op) {
  exactFields(mutation, CLOSURE_FIELDS);
  const requestId = mutation.request_id;
  if (typeof requestId !== 'string') throw integrity(`${op} needs a text request id`);
  if (!REQUEST_ID_PATTERN.test(requestId)) throw integrity(`${op} has a malformed request id`);
  const decisionId = mutation.decision_id;
  if (typeof decisionId !== 'string') throw integrity(`${op} needs a text decision id`);
  if (!DECISION_ID_PATTERN.test(decisionId)) {
    throw integrity(`${op} has a malformed decision id`);
  }
  const resolvedAt = readInstant(mutation.resolved_at);
  if (resolvedAt === null) throw integrity(`${op} has a malformed resolution time`);
  const delivery = mutation.delivery_state;
  if (typeof delivery !== 'string' || !DELIVERY_STATES.has(delivery)) {
    throw integrity(`${op} has an unsupported initial delivery state`);
  }
  return {
    kind: op === CANCEL_OP ? 'cancel' : 'expire',
    record: {
      request_id: requestId,
      decision_id: decisionId,
      resolved_at: mutation.resolved_at,
      delivery_state: delivery,
      resolvedAt,
    },
  };
}

// Delivery evidence decodes from exactly its five persisted fields: the target,
// the already recorded decision identity, the first time of this kind and the
// delivery state it must establish.
function readEvidence(mutation, kind) {
  const op = EVIDENCE_OPS[kind];
  exactFields(mutation, EVIDENCE_FIELDS[kind]);
  const requestId = mutation.request_id;
  if (typeof requestId !== 'string') throw integrity(`${op} needs a text request id`);
  if (!REQUEST_ID_PATTERN.test(requestId)) throw integrity(`${op} has a malformed request id`);
  const decisionId = mutation.decision_id;
  if (typeof decisionId !== 'string') throw integrity(`${op} needs a text decision id`);
  if (!DECISION_ID_PATTERN.test(decisionId)) throw integrity(`${op} has a malformed decision id`);
  const text = mutation[EVIDENCE_TIME[kind]];
  const recordedAt = readInstant(text);
  if (recordedAt === null) throw integrity(`${op} has a malformed evidence time`);
  const delivery = mutation.delivery_state;
  if (typeof delivery !== 'string') throw integrity(`${op} has an unsupported delivery state`);
  if (kind === 'acknowledge' ? delivery !== 'confirmed' : !EVIDENCE_STATES.has(delivery)) {
    throw integrity(`${op} has an unsupported delivery state`);
  }
  return {
    kind,
    record: {
      request_id: requestId,
      decision_id: decisionId,
      recorded_at: text,
      recordedAt,
      delivery_state: delivery,
    },
  };
}

// One Telegram update id is stored exactly as delivered: a raw nonnegative safe
// integer whose next offset is also safe, so no string, fraction or coercion can
// become an offset. The same predicate guards the writer and the replay decoder,
// so a value this instance would never append is also never accepted from history.
function usableUpdateId(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

// The cursor decodes from exactly its two persisted fields: the last fully
// processed update id, with no derived offset and no implicit default.
function readCursor(mutation) {
  exactFields(mutation, CURSOR_FIELDS);
  if (!usableUpdateId(mutation.last_update_id)) {
    throw integrity(`${CURSOR_OP} needs a raw nonnegative update id with a safe next offset`);
  }
  return { kind: 'cursor', last_update_id: mutation.last_update_id };
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
    case CURSOR_OP:
      return readCursor(mutation);
    case CREATE_OP:
      return readCreate(mutation);
    case EXPIRE_OP:
      return readClosure(mutation, EXPIRE_OP);
    case CANCEL_OP:
      return readClosure(mutation, CANCEL_OP);
    case ACKNOWLEDGE_OP:
      return readEvidence(mutation, 'acknowledge');
    case RETURNED_OP:
      return readEvidence(mutation, 'returned');
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

// One transaction advances the cursor at most once, and the committed cursor is
// strictly increasing across the whole history. Gaps stay valid because Telegram
// update ids are not contiguous, so no adjacency or sequence assumption is made.
function applyCursor(records, cursor) {
  if (records.length === 0) return cursor;
  if (records.length > 1) throw integrity('a transaction advances the telegram cursor twice');
  const next = records[0].last_update_id;
  if (cursor !== null && next <= cursor) {
    throw integrity(`${CURSOR_OP} must strictly increase`);
  }
  return next;
}

// A refusal is exactly `{paired:false,reason}` and a successful consumption is
// exactly `{paired:true}`: neither carries a challenge, identity, cursor or
// clock detail, so no refusal can become a disclosure.
function pairingRefusal(reason) {
  return { paired: false, reason };
}

// A reservation is installed immediately for uniqueness, but a creation naming
// one reserved in its own transaction still fails in every array order.
function stageReservation(record, staged, reservedNow) {
  if (staged.byHandle.has(record.request_handle)) {
    throw integrity(`request handle ${record.request_handle} is reserved twice`);
  }
  if (staged.byRequestId.has(record.request_id)) {
    throw integrity(`reserved request id ${record.request_id} is used twice`);
  }
  if (staged.byVerifier.has(record.capability_hash)) {
    throw integrity(`capability verifier for ${record.request_handle} is reused`);
  }
  staged.byHandle.set(record.request_handle, record);
  staged.byRequestId.set(record.request_id, record);
  staged.byVerifier.set(record.capability_hash, record);
  reservedNow.add(record.request_handle);
}

// Creation inherits the committed reservation and copies the committed pairing
// without normalization; the complete presentation is measured before install.
function stageCreate(record, staged, pairing, reservedNow) {
  if (reservedNow.has(record.request_handle)) {
    throw integrity(`${CREATE_OP} cannot bind a reservation of its own transaction`);
  }
  const reservation = staged.byHandle.get(record.request_handle);
  if (reservation === undefined) {
    throw integrity(`${CREATE_OP} names no committed reservation`);
  }
  if (staged.created.has(record.request_handle)) {
    throw integrity(`request handle ${record.request_handle} is created twice`);
  }
  if (pairing === null) throw integrity(`${CREATE_OP} requires a committed pairing`);
  if (
    record.snapshot.user_id !== pairing.user_id ||
    record.snapshot.chat_id !== pairing.chat_id ||
    record.snapshot.paired_at !== pairing.paired_at
  ) {
    throw integrity(`${CREATE_OP} snapshot does not match the committed pairing`);
  }
  const preparedAt = readInstant(reservation.prepared_at);
  if (preparedAt === null) {
    throw integrity(`${CREATE_OP} cannot compare the reservation preparation time`);
  }
  if (compareInstants(record.createdAt, preparedAt) < 0) {
    throw integrity(`${CREATE_OP} precedes its reservation`);
  }
  if (compareInstants(record.createdAt, record.pairedAt) < 0) {
    throw integrity(`${CREATE_OP} precedes the committed pairing`);
  }
  const request = {
    request_handle: reservation.request_handle,
    request_id: reservation.request_id,
    client_request_id: record.client_request_id,
    owner_id: reservation.owner_id,
    session_label: reservation.session_label,
    action: record.action,
    context: record.context,
    created_at: record.created_at,
    expires_at: record.expires_at,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    resolution: 'pending',
    resolved_at: null,
    resolvedAt: null,
    response_text: null,
    acknowledgedAt: null,
    returnedAt: null,
    decision_id: null,
    telegram_state: 'pending',
    delivery_state: 'not_applicable',
    delivery_error: null,
  };
  if (measurePortablePresentation(requestView(request)).worst.length > MAX_TELEGRAM_TEXT) {
    throw integrity(`${CREATE_OP} cannot be presented within ${MAX_TELEGRAM_TEXT} characters`);
  }
  staged.created.add(request.request_handle);
  staged.requests.set(request.request_id, request);
}

// A closure resolves one pending request and spends its decision identity once
// across the whole journal: expiry must be at or after the recorded deadline, and
// a cancellation must fall inside the request lifetime.
function stageClosure(record, staged, resolution) {
  const op = resolution === 'cancelled' ? CANCEL_OP : EXPIRE_OP;
  const request = staged.requests.get(record.request_id);
  if (request === undefined) throw integrity(`${op} names no committed request`);
  if (request.resolution !== 'pending') {
    throw integrity(`${op} targets an already resolved request`);
  }
  if (resolution === 'cancelled') {
    if (
      compareInstants(record.resolvedAt, request.createdAt) < 0 ||
      compareInstants(record.resolvedAt, request.expiresAt) >= 0
    ) {
      throw integrity(`${CANCEL_OP} lies outside the request lifetime`);
    }
  } else if (compareInstants(record.resolvedAt, request.expiresAt) < 0) {
    throw integrity(`${EXPIRE_OP} precedes the request deadline`);
  }
  if (staged.decisions.has(record.decision_id)) {
    throw integrity(`decision id ${record.decision_id} is used twice`);
  }
  staged.decisions.add(record.decision_id);
  request.resolution = resolution;
  request.resolved_at = record.resolved_at;
  request.resolvedAt = record.resolvedAt;
  request.decision_id = record.decision_id;
  request.delivery_state = record.delivery_state;
}

// First evidence is recorded once per kind against one known terminal request
// and its already recorded decision identity: it never resolves or re-identifies
// anything. The recorded time is bounded only by the resolution, and the two
// kinds are independent, so neither implies the other. A returned report may set
// `returned` or retain `confirmed`, never downgrade it.
function stageEvidence(record, staged) {
  const op = EVIDENCE_OPS[record.kind];
  const {
    request_id: requestId,
    decision_id: decisionId,
    recordedAt,
    delivery_state: delivery,
  } = record.record;
  const request = staged.requests.get(requestId);
  if (request === undefined) throw integrity(`${op} names no committed request`);
  if (request.resolution === 'pending') throw integrity(`${op} targets a pending request`);
  if (request.decision_id !== decisionId) {
    throw integrity(`${op} does not match the recorded decision`);
  }
  if (request.resolvedAt === null || compareInstants(recordedAt, request.resolvedAt) < 0) {
    throw integrity(`${op} precedes the resolution`);
  }
  const field = record.kind === 'acknowledge' ? 'acknowledgedAt' : 'returnedAt';
  if (request[field] !== null) throw integrity(`${op} is recorded twice`);
  const required =
    record.kind === 'acknowledge' || request.delivery_state === 'confirmed'
      ? 'confirmed'
      : 'returned';
  if (delivery !== required) throw integrity(`${op} has an unsupported delivery state`);
  request[field] = recordedAt;
  request.delivery_state = delivery;
  request.delivery_error = null;
}

class PortableBroker {
  #journal;

  #owners;

  #port;

  #clock;

  #logger;

  #generateDecisionId;

  #generatePairingCode;

  #startedAt;

  #byHandle = new Map();

  #byRequestId = new Map();

  #byVerifier = new Map();

  #pairing = null;

  #challenges = new Map();

  #attempts = new Map();

  #cursor = null;

  #requests = new Map();

  #decisions = new Set();

  #queue = Promise.resolve();

  #recovered = false;

  #fence = null;

  #deadlineFailure = null;

  #closing = false;

  #closed = false;

  #closingPromise = null;

  #waiters;

  constructor({
    journal,
    owners,
    port,
    clock,
    logger,
    generateDecisionId,
    generatePairingCode,
    waitTurnoverMs,
  }) {
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
    this.#generateDecisionId = generateDecisionId;
    this.#generatePairingCode = generatePairingCode;
    this.#startedAt = utcTimestamp(clock());
    // The turnover is a private observation window, never public configuration.
    this.#waiters = createWaiterRegistry({ timeoutMs: waitTurnoverMs });
  }

  // Rebuilds reservations, pairing, challenges, the Telegram cursor and requests
  // from committed transactions. The whole history is staged first: a replay
  // failure installs nothing and leaves the previous state untouched, and the
  // journal is never written here. Recovery shares the mutation queue, so it can
  // neither race an admitted append nor acknowledge history that a held writer
  // has not committed, and a failed recovery fences the instance like any other
  // uncertain storage state.
  recover() {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(async () => {
      try {
        return await this.#replay();
      } catch (error) {
        throw this.#fenceJournal(error);
      }
    });
  }

  // The whole history is staged first: a replay failure installs nothing and
  // leaves the previous state untouched, and the journal is never written here.
  // Tolerant framing reports a shorter valid length for an interrupted final
  // frame; only an ordinary reopen may remove that tail, so an unrepaired one is
  // refused instead of read as a ready history.
  async #replay() {
    const { transactions, validLength, fileBytes } = await this.#journal.recover();
    if (!Array.isArray(transactions) || !Number.isInteger(validLength)) {
      throw storageFailure('journal recovery reported no usable history', 'STORAGE_FAILURE');
    }
    if (fileBytes !== validLength) {
      throw storageFailure(
        'the journal must be reopened to remove an unrepaired incomplete final record',
        'STORAGE_FAILURE',
      );
    }
    const staged = {
      byHandle: new Map(),
      byRequestId: new Map(),
      byVerifier: new Map(),
      requests: new Map(),
      created: new Set(),
      decisions: new Set(),
    };
    const challenges = new Map();
    let pairing = null;
    let cursor = null;
    for (const transaction of transactions) {
      const records = (transaction?.mutations ?? []).map(readMutation);
      // Committed authority only: this transaction's own reservations and
      // pairing mutations are deliberately not visible to its creations.
      const reservedNow = new Set();
      const pairingRecords = [];
      const cursorRecords = [];
      for (const record of records) {
        if (record.kind === 'reservation') stageReservation(record.record, staged, reservedNow);
        else if (record.kind === 'create') stageCreate(record.record, staged, pairing, reservedNow);
        else if (record.kind === 'expire') stageClosure(record.record, staged, 'expired');
        else if (record.kind === 'cancel') stageClosure(record.record, staged, 'cancelled');
        else if (record.kind === 'acknowledge' || record.kind === 'returned') {
          stageEvidence(record, staged);
        } else if (record.kind === 'cursor') cursorRecords.push(record);
        else pairingRecords.push(record);
      }
      pairing = applyPairing(pairingRecords, challenges, pairing);
      cursor = applyCursor(cursorRecords, cursor);
    }
    this.#byHandle = staged.byHandle;
    this.#byRequestId = staged.byRequestId;
    this.#byVerifier = staged.byVerifier;
    this.#requests = staged.requests;
    this.#decisions = staged.decisions;
    this.#pairing = pairing;
    // Challenge state stays retained after the staging maps are installed: a
    // later issuance cannot reuse a hash that history already committed, and a
    // consumption is validated against the recorded creation, expiry and burn
    // that committed history established, never against recovery time.
    this.#challenges = challenges;
    this.#cursor = cursor;
    this.#recovered = true;
    return { records: transactions.length };
  }

  // Private copied view (design section 4): the stored values only, never a
  // challenge, hash or consumption, and mutating the result cannot alter state.
  pairing() {
    return this.#pairing === null ? null : { ...this.#pairing };
  }

  // Issues one durable pairing challenge (design section 5, C1). Admission is
  // settled before the queue, so a closed or fenced broker appends nothing; the
  // remaining conditions and every allocation happen inside the serialized turn,
  // and the plaintext code exists only in this promise's value.
  pairingChallenge() {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(() => this.#issueChallenge());
  }

  // Private copied cursor (design sections 4-5): the last fully processed update
  // id, never a derived next offset, and never part of a shared representation.
  telegramCursor() {
    return this.#cursor;
  }

  // Records one processed update id (design section 5, C1). The value is validated
  // before the queue, so no string, fraction or object is coerced into an offset
  // and nothing is sampled or appended for a malformed one. A stale or repeated id
  // appends nothing and reports the committed cursor; a newer one appends exactly
  // one cursor frame inside the serialized turn and reports it only after its
  // flush, so no offset is ever exposed ahead of its committed history.
  advanceCursor(updateId) {
    return Promise.resolve().then(() => {
      if (!usableUpdateId(updateId)) {
        throw invalidArgument(
          'last_update_id must be a nonnegative safe integer whose next offset is safe',
        );
      }
      const refusal = this.#admissionRefusal();
      if (refusal !== null) throw refusal;
      return this.#enqueue(() => this.#advance(updateId));
    });
  }

  // Completes one private pairing attempt from an already parsed update (design
  // sections 4, 5 and 7; C1). The update id is validated before the queue, so a
  // malformed one rejects without sampling time, spending a quota slot or
  // touching the journal. Staleness, sender/chat admission, one sampled instant,
  // the rate window and the challenge are all decided inside the serialized turn.
  // This is the selected private seam for a future poller: the raw Telegram
  // envelope, sender/chat validation and command parsing stay that owner's.
  completePairing(input = {}) {
    return Promise.resolve().then(() => {
      if (!isPlainObject(input)) throw invalidArgument('a pairing completion needs an object');
      const { code, userId, chatId, updateId } = input;
      if (!usableUpdateId(updateId)) {
        throw invalidArgument(
          'updateId must be a nonnegative safe integer whose next offset is safe',
        );
      }
      const refusal = this.#admissionRefusal();
      if (refusal !== null) throw refusal;
      return this.#enqueue(() => this.#consumePairing({ code, userId, chatId, updateId }));
    });
  }

  // Reserves fresh authority for one preparation call. Validated up front, then
  // serialized so one journal append per call is ordered with every other
  // mutation this broker performs.
  reserveHandle({ ownerId, sessionLabel } = {}) {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
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

  // Creates at most one durable request under an authorized reservation (design
  // section 4, A1a-ii). Caller fields are validated before authority and
  // authority before the queue, so a held append never delays a denial, while
  // every decision that names stored state is taken inside the serialized turn.
  createRequest(input = {}) {
    return Promise.resolve().then(() => {
      const fields = creationFields(input);
      const reservation = this.#creationBinding(input);
      if (reservation === null) return null;
      const refusal = this.#admissionRefusal();
      if (refusal !== null) throw refusal;
      if (!this.#recovered) {
        throw storageFailure(
          'the portable broker has not recovered the journal',
          'STORAGE_FAILURE',
        );
      }
      return this.#enqueue(() => this.#create(reservation, fields));
    });
  }

  // Redacted view: the capability verifier and pairing snapshot stay
  // journal-internal, and every request is copied fresh, nested state included.
  snapshot() {
    return {
      prepared: [...this.#byHandle.values()].map(reservationView),
      requests: [...this.#requests.values()].map(requestView),
    };
  }

  // Authorized target read (design sections 3-4). The configured principal, one
  // explicit exact request id and the capability must name one committed
  // reservation before anything is queued, so any missing, malformed, foreign or
  // mismatched binding is denied without sampling time, appending or mutating
  // state.
  readRequest(input) {
    const target = this.#readBinding(input);
    if (target === null) return Promise.resolve(null);
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(() => this.#expireTarget(target.request_id));
  }

  // Authorized cancellation (design section 4, A2a). The same target binding as a
  // read is resolved before the queue, so missing, malformed, foreign or
  // mismatched authority is a non-disclosing null that samples no time, and an
  // unknown request or unused reservation is null before any clock reading.
  cancelRequest(input) {
    const target = this.#readBinding(input);
    if (target === null) return Promise.resolve(null);
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(() => this.#cancel(target.request_id));
  }

  // Attached wait for one committed request's outcome (design sections 3, 4 and 7,
  // G1/G3). Authority, the unused-reservation denial and the request lookup are
  // settled before the queue, so a denial samples no clock and appends nothing. The
  // admitted turn returns a plain envelope holding the future observation, so the
  // serialized transaction is released long before that observation settles.
  waitRequest(input = {}) {
    return Promise.resolve()
      .then(() => {
        if (!isPlainObject(input)) throw invalidArgument('waitRequest expects an argument object');
        const signal = input.signal;
        if (signal !== undefined && typeof signal?.addEventListener !== 'function') {
          throw invalidArgument('waitRequest needs an AbortSignal');
        }
        const target = this.#waitBinding(input);
        if (target === null) return null;
        if (signal?.aborted === true) return WAIT_DETACHED;
        const refusal = this.#admissionRefusal();
        if (refusal !== null) throw refusal;
        if (!this.#recovered) {
          throw storageFailure(
            'the portable broker has not recovered the journal',
            'STORAGE_FAILURE',
          );
        }
        return this.#enqueue(() => this.#admitWait(target.request_id, input));
      })
      .then((result) => (result?.wait === undefined ? result : result.wait));
  }

  // Capability-authorized acknowledgement (design sections 4 and 6, A2b): the
  // first evidence that the request-capability holder received the matching
  // terminal outcome. It resolves nothing, allocates no decision and schedules no
  // continuation; a repeat is observation, not a new effect.
  acknowledgeRequest(input = {}) {
    return this.#evidence('acknowledge', input);
  }

  // Capability-authorized returned report (design sections 4 and 6, A2b): the
  // first evidence of a successful terminal-result write, as asserted by the
  // adapter. It never downgrades a confirmation and never proves client receipt.
  returnedRequest(input = {}) {
    return this.#evidence('returned', input);
  }

  // Bounded sweep (design section 7): each nonempty pending group samples its own
  // fresh time inside the serialized turn and commits at most SWEEP_GROUP_SIZE
  // closures in one append. A group is installed only after that flush returns, so
  // an earlier flushed group survives a later refusal, which rejects instead of
  // reporting a partial success count.
  sweepExpired() {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(async () => ({ expired: await this.#sweepDue() }));
  }

  // Ordinary periodic deadline processing (design sections 4 and 7): the same
  // bounded sweep, but a failure installs the operational latch inside the
  // serialized turn, before the queue releases, so a follower released after the
  // failed attempt cannot sample time, allocate an identity, append or succeed.
  scheduledSweep() {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(async () => {
      try {
        return { expired: await this.#sweepDue() };
      } catch (error) {
        this.latchDeadlineFailure();
        throw error;
      }
    });
  }

  // Idempotent, append-free, never cleared: the fence above stays separate.
  latchDeadlineFailure() {
    this.#deadlineFailure ??= storageFailure(
      'deadline processing failed; stop and restart the portable broker',
      'STORAGE_FAILURE',
    );
    return this.#deadlineFailure;
  }

  // Awaited status (design sections 3 and 7): expiry and the response view are
  // captured inside one serialized turn, so the reported requests are exactly the
  // committed state this call observed, never a stale pending or empty success.
  status() {
    const refusal = this.#admissionRefusal();
    if (refusal !== null) return Promise.reject(refusal);
    return this.#enqueue(async () => {
      await this.#sweepDue();
      return {
        schema_version: PORTABLE_REPRESENTATION_SCHEMA_VERSION,
        broker: { pid: process.pid, port: this.#port, started_at: this.#startedAt },
        requests: [...this.#requests.values()].map(requestView),
      };
    });
  }

  // Drains accepted commits, then refuses further mutation. Admitted waits are
  // transport-bound observations, so close detaches them and removes their timers
  // and listeners before the drain; the caller's journal is deliberately left open
  // for its owner to close.
  close() {
    if (this.#closingPromise !== null) return this.#closingPromise;
    this.#closing = true;
    this.#waiters.close();
    this.#closingPromise = (async () => {
      await this.#queue;
      this.#closed = true;
    })();
    return this.#closingPromise;
  }

  // One serialized challenge issuance (design section 5, C1). Recovered, open,
  // healthy storage and the absence of a pairing are rechecked here; the code is
  // generated and hashed, its verifier must be unused across committed history,
  // and one UTC instant fixes the exact five-minute deadline. Everything is
  // decided before the append, so a generator, clock or uniqueness refusal
  // appends nothing and never fences the journal. The plaintext code leaves only
  // through the returned value: it is never logged, persisted or diagnosed.
  async #issueChallenge() {
    if (!this.#recovered) {
      throw storageFailure('the portable broker has not recovered the journal', 'STORAGE_FAILURE');
    }
    if (this.#pairing !== null) {
      throw conflict('A human is already paired; pairing cannot be replaced');
    }
    let code;
    try {
      code = this.#generatePairingCode();
    } catch {
      // The cause is deliberately dropped: a broken generator may have put the
      // generated value in its message, and a refusal must not disclose it.
      throw storageFailure('the pairing code generator failed', 'STORAGE_FAILURE');
    }
    if (typeof code !== 'string' || !PAIRING_CODE_PATTERN.test(code)) {
      throw storageFailure(
        'the pairing code generator produced an invalid code',
        'STORAGE_FAILURE',
      );
    }
    const hash = sha256Hex(code);
    if (this.#challenges.has(hash)) {
      throw storageFailure(
        'the pairing code verifier is already used by a committed challenge',
        'STORAGE_FAILURE',
      );
    }
    const times = creationTimes(
      this.#clock,
      Number(PAIRING_TTL_SECONDS),
      'issuing a pairing challenge',
    );
    await this.#append([
      {
        op: CHALLENGE_OP,
        hash,
        created_at: times.created_at,
        expires_at: times.expires_at,
      },
    ]);
    this.#challenges.set(hash, {
      hash,
      createdAt: times.createdAt,
      expiresAt: times.expiresAt,
      consumedAt: null,
    });
    this.#logger('portable.pairing.challenge', { expires_at: times.expires_at });
    return { code, expires_at: times.expires_at };
  }

  // One serialized cursor turn (design section 5, C1). Only a newer id writes: a
  // stale or repeated one reports the committed cursor without appending, so a
  // replayed update batch can never move the position backwards or duplicate a
  // frame. No clock is sampled, because the cursor is a platform position.
  async #advance(updateId) {
    if (!this.#recovered) {
      throw storageFailure('the portable broker has not recovered the journal', 'STORAGE_FAILURE');
    }
    if (this.#cursor !== null && updateId <= this.#cursor) return this.#cursor;
    await this.#append([{ op: CURSOR_OP, last_update_id: updateId }]);
    this.#cursor = updateId;
    return updateId;
  }

  // One serialized consumption turn (design sections 4, 5 and 7; C1). A stale
  // update samples no clock, spends no verification quota and appends nothing. An
  // invalid sender/chat string cannot be attributed to a sender, so it is a
  // cursor-only refusal. Everything after that shares one sampled instant: the
  // rolling attempt window, challenge validity and both persisted pairing times.
  // Nothing is installed for the challenge, pairing or cursor until the single
  // consume/set/cursor frame has flushed.
  async #consumePairing({ code, userId, chatId, updateId }) {
    if (!this.#recovered) {
      throw storageFailure('the portable broker has not recovered the journal', 'STORAGE_FAILURE');
    }
    if (this.#cursor !== null && updateId <= this.#cursor) return pairingRefusal('stale');
    if (identityProblem(userId) !== null || identityProblem(chatId) !== null) {
      return this.#refusePairing(updateId, 'invalid');
    }
    const times = turnTime(this.#clock, 'consuming a pairing challenge', 'pairing consumption');
    const attempts = this.#recentAttempts(userId, times.milliseconds);
    if (attempts.length >= PAIRING_ATTEMPT_LIMIT)
      return this.#refusePairing(updateId, 'rate_limited');
    // The single-pairing rule is checked before any code verification, so a
    // repeated message can neither replace the stored identity nor burn another
    // challenge.
    if (this.#pairing !== null) return this.#refusePairing(updateId, 'already_paired');
    // Every verification attempt spends one slot, including an invalid or expired
    // code: the ceiling bounds guesses, never successes.
    attempts.push(times.milliseconds);
    this.#attempts.set(userId, attempts);
    if (typeof code !== 'string' || !PAIRING_CODE_PATTERN.test(code)) {
      return this.#refusePairing(updateId, 'invalid');
    }
    const hash = sha256Hex(code);
    const challenge = this.#challenges.get(hash);
    if (challenge === undefined || challenge.consumedAt !== null) {
      return this.#refusePairing(updateId, 'invalid');
    }
    // Validity is tested against the sampled instant, not recovery time and not
    // declaration order: a sample outside `created_at <= now < expires_at` is a
    // refusal that leaves the challenge unconsumed.
    if (
      compareInstants(times.instant, challenge.createdAt) < 0 ||
      compareInstants(times.instant, challenge.expiresAt) >= 0
    ) {
      return this.#refusePairing(updateId, 'expired');
    }
    await this.#appendPairing([
      { op: CONSUME_OP, hash, consumed_at: times.text },
      { op: SET_OP, pairing: { user_id: userId, chat_id: chatId, paired_at: times.text } },
      { op: CURSOR_OP, last_update_id: updateId },
    ]);
    challenge.consumedAt = times.instant;
    this.#pairing = { user_id: userId, chat_id: chatId, paired_at: times.text };
    this.#cursor = updateId;
    // The logged view carries no code, verifier, identity or cursor: a success is
    // reported only through the returned value.
    this.#logger('portable.pairing.set', { paired_at: times.text });
    return { paired: true };
  }

  // A per-sender rolling window: only attempts strictly newer than 60 seconds
  // before this sample remain, so the released slot is admitted exactly at the
  // 60000 ms boundary and a fixed-minute bucket cannot widen it. Changing chat or
  // code keeps the same sender key, so neither bypasses the ceiling, and another
  // sender starts with its own empty window.
  #recentAttempts(userId, now) {
    const cutoff = now - PAIRING_ATTEMPT_WINDOW_MS;
    const retained = (this.#attempts.get(userId) ?? []).filter(
      (attempt) => attempt > cutoff && attempt <= now,
    );
    this.#attempts.set(userId, retained);
    return retained;
  }

  // A canonical newer refusal commits only its own update cursor: the challenge,
  // the pairing and every other position stay untouched, so a refusal can never
  // be replayed as a verification or a recorded decision.
  async #refusePairing(updateId, reason) {
    if (this.#cursor === null || updateId > this.#cursor) {
      await this.#appendPairing([{ op: CURSOR_OP, last_update_id: updateId }]);
      this.#cursor = updateId;
    }
    return pairingRefusal(reason);
  }

  // The consumption turn's only write path. A rejected append has already fenced
  // the instance through #append; a failure that did not carry the storage
  // classification is wrapped here, because no caller may mistake a storage
  // failure for a refusal it is allowed to skip.
  async #appendPairing(mutations) {
    try {
      await this.#append(mutations);
    } catch (error) {
      if (error?.code === 'STORAGE_FAILURE') throw error;
      throw storageFailure(
        'the pairing consumption could not be committed',
        'STORAGE_FAILURE',
        error,
      );
    }
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
    await this.#append([record]);
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

  // Authority binding for a target read, resolved before the queue: the principal
  // must still be configured, the request id must be an explicitly supplied
  // well-formed identifier, and the capability must verify against that reservation.
  #readBinding(input) {
    if (!isPlainObject(input)) return null;
    const { ownerId, capability, requestId } = input;
    if (typeof ownerId !== 'string' || !this.#owners.has(ownerId)) return null;
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null;
    return this.authorize({ ownerId, capability, requestId });
  }

  // Authority binding for creation, resolved before the queue: the principal
  // must still be configured, the handle must be an explicitly supplied
  // well-formed identifier, and the capability must verify that exact
  // reservation/principal/handle tuple. Any other outcome is a non-disclosing
  // denial rather than an argument error.
  #creationBinding(input) {
    const { ownerId, capability, requestHandle } = input;
    if (typeof ownerId !== 'string' || !this.#owners.has(ownerId)) return null;
    if (typeof requestHandle !== 'string' || !REQUEST_HANDLE_PATTERN.test(requestHandle))
      return null;
    if (typeof capability !== 'string' || !REQUEST_CAPABILITY_PATTERN.test(capability)) return null;
    return this.authorize({ ownerId, capability, requestHandle });
  }

  // Wait authority: the read binding plus one actual committed request, so an
  // unused reservation stays the same non-disclosing denial as an unknown one.
  #waitBinding(input) {
    const target = this.#readBinding(input);
    if (target === null || !this.#requests.has(target.request_id)) return null;
    return target;
  }

  // Ledger admission in design order: the argument object and the raw decision
  // identity are validated before authority, authority before admission, and a
  // reservation without a committed request is not an evidence target. So a
  // denial or a malformed decision is settled without queueing, sampling time or
  // disclosing whether the target exists.
  #evidence(kind, input) {
    return Promise.resolve().then(() => {
      if (!isPlainObject(input)) throw invalidArgument(`${EVIDENCE_OPS[kind]} needs an object`);
      const decisionId = input.decisionId;
      if (typeof decisionId !== 'string' || !DECISION_ID_PATTERN.test(decisionId)) {
        throw invalidArgument(`${EVIDENCE_OPS[kind]} needs a well-formed decision id`);
      }
      const target = this.#readBinding(input);
      if (target === null || !this.#requests.has(target.request_id)) return null;
      const refusal = this.#admissionRefusal();
      if (refusal !== null) throw refusal;
      if (!this.#recovered) {
        throw storageFailure(
          'the portable broker has not recovered the journal',
          'STORAGE_FAILURE',
        );
      }
      return this.#enqueue(() => this.#recordEvidence(kind, target.request_id, decisionId));
    });
  }

  // One serialized creation turn: an existing creation is compared with the
  // requested fields before any time is sampled or a deadline is derived, an
  // identical retry returns it through the accepted target-only expiry path,
  // and a new creation samples once, measures the complete presentation,
  // appends and only then installs the pending state it reports.
  async #create(reservation, fields) {
    const existing = this.#requests.get(reservation.request_id);
    if (existing !== undefined) {
      if (!sameCreation(existing, fields)) {
        throw conflict('this handle already has a request with different creation fields');
      }
      return { created: false, request: await this.#expireTarget(reservation.request_id) };
    }
    if (this.#pairing === null) {
      throw unavailable(PAIRING_REQUIRED_MESSAGE, 'NOT_PAIRED', { retryable: false });
    }
    const times = creationTimes(this.#clock, fields.duration);
    const preparedAt = readInstant(reservation.prepared_at);
    if (preparedAt === null) {
      throw storageFailure(
        `${CREATE_OP} cannot compare the reservation preparation time`,
        'JOURNAL_STATE_INVALID',
      );
    }
    if (compareInstants(times.createdAt, preparedAt) < 0) {
      throw storageFailure(
        `${CREATE_OP} would precede its committed reservation`,
        'STORAGE_FAILURE',
      );
    }
    const pairedAt = readInstant(this.#pairing.paired_at);
    if (pairedAt === null) {
      throw storageFailure(
        `${CREATE_OP} cannot compare the committed pairing time`,
        'JOURNAL_STATE_INVALID',
      );
    }
    if (compareInstants(times.createdAt, pairedAt) < 0) {
      throw storageFailure(`${CREATE_OP} would precede the committed pairing`, 'STORAGE_FAILURE');
    }
    const request = {
      request_handle: reservation.request_handle,
      request_id: reservation.request_id,
      client_request_id: fields.clientRequestId,
      owner_id: reservation.owner_id,
      session_label: reservation.session_label,
      action: fields.action,
      context: fields.context,
      created_at: times.created_at,
      expires_at: times.expires_at,
      createdAt: times.createdAt,
      expiresAt: times.expiresAt,
      resolution: 'pending',
      resolved_at: null,
      resolvedAt: null,
      response_text: null,
      acknowledgedAt: null,
      returnedAt: null,
      decision_id: null,
      telegram_state: 'pending',
      delivery_state: 'not_applicable',
      delivery_error: null,
    };
    // The complete plain-text presentation is measured before the append, so a
    // request that could not be shown within the platform limit is refused while
    // journal bytes, sequence and installed state are still untouched.
    if (measurePortablePresentation(requestView(request)).worst.length > MAX_TELEGRAM_TEXT) {
      throw invalidArgument(
        `the complete request presentation must fit within ${MAX_TELEGRAM_TEXT} characters`,
      );
    }
    await this.#append([
      {
        op: CREATE_OP,
        request_handle: request.request_handle,
        client_request_id: request.client_request_id,
        action: request.action,
        context: request.context,
        expires_in_seconds: fields.duration,
        created_at: request.created_at,
        expires_at: request.expires_at,
        pairing_snapshot: { ...this.#pairing },
      },
    ]);
    this.#requests.set(request.request_id, request);
    this.#logger('portable.request.created', { request_id: request.request_id });
    return { created: true, request: requestView(request) };
  }

  // Closes at most this one target and reports the committed representation: a
  // pending request is sampled once, and a terminal or absent one is not sampled.
  async #expireTarget(requestId) {
    const request = this.#requests.get(requestId);
    if (request === undefined) return null;
    if (request.resolution === 'pending') {
      const now = this.#clock();
      if (isDue(request, now)) await this.#commitExpiry(now, [request]);
    }
    return requestView(request);
  }

  // Closes at most this one target as cancelled and reports the committed
  // representation (design section 4, A2a). A terminal or absent target is
  // returned without sampling; a pending target is sampled once, and at or after
  // its deadline the existing expiry writer commits instead, so exactly one
  // resolution wins either way.
  async #cancel(requestId) {
    const request = this.#requests.get(requestId);
    if (request === undefined) return null;
    if (request.resolution !== 'pending') return requestView(request);
    const sampled = cancellationTime(this.#clock);
    if (isDue(request, sampled.milliseconds)) {
      await this.#commitExpiry(sampled.milliseconds, [request]);
      return requestView(request);
    }
    // A recorded time before creation cannot describe this request's lifetime, so
    // it is the existing storage failure rather than a caller error.
    if (compareInstants(sampled.instant, request.createdAt) < 0) {
      throw storageFailure(`${CANCEL_OP} would precede its request creation`, 'STORAGE_FAILURE');
    }
    const mutation = {
      op: CANCEL_OP,
      request_id: request.request_id,
      decision_id: this.#nextDecisionId(new Set()),
      resolved_at: sampled.text,
      delivery_state: this.#waiters.live(request.request_id) ? 'pending' : 'unavailable',
    };
    await this.#commitFor([mutation], [request.request_id]);
    this.#installClosure(mutation, 'cancelled');
    this.#waiters.wake(request.request_id, { state: 'terminal', request: requestView(request) });
    this.#logger('portable.request.cancelled', { request_id: request.request_id });
    return requestView(request);
  }

  // One serialized wait admission (design section 3, G3). A queued call whose
  // transport is already gone performs no deadline work; an existing waiter or a
  // terminal target is settled without sampling. Otherwise this waiter's
  // observation is installed before the deadline is applied, so an expiry this
  // same turn commits selects the live-waiter delivery state, and the turn returns
  // the envelope before the future outcome arrives.
  async #admitWait(requestId, { signal, registration }) {
    if (this.#closing || signal?.aborted === true) return WAIT_DETACHED;
    const request = this.#requests.get(requestId);
    if (request === undefined) return null;
    if (this.#waiters.has(requestId)) return WAIT_CONFLICT;
    if (request.resolution !== 'pending')
      return { state: 'terminal', request: requestView(request) };
    const entry = this.#waiters.enter({
      requestId,
      signal,
      registration,
      turnover: () => this.#enqueue(() => this.#checkDeadline(requestId)),
    });
    try {
      const { milliseconds } = turnTime(this.#clock, 'checking a wait deadline', 'wait');
      if (!isDue(request, milliseconds)) return { wait: entry.wait };
      await this.#commitExpiry(milliseconds, [request]);
      return { state: 'terminal', request: requestView(request) };
    } catch (error) {
      // A refused admission releases its slot, timer and listener without fencing.
      entry.release();
      throw error;
    }
  }

  // Turnover re-inspects the target inside the serialized turn, so a wait that
  // outlives its poll never returns a stale pending view for a due request. A wait
  // detached in the meantime settles nothing and commits nothing.
  async #checkDeadline(requestId) {
    if (this.#closing || !this.#waiters.has(requestId)) return WAIT_DETACHED;
    const request = this.#requests.get(requestId);
    if (request === undefined) return WAIT_DETACHED;
    if (request.resolution !== 'pending')
      return { state: 'terminal', request: requestView(request) };
    const { milliseconds } = turnTime(this.#clock, 'checking a wait deadline', 'wait');
    if (isDue(request, milliseconds)) await this.#commitExpiry(milliseconds, [request]);
    if (request.resolution === 'pending') return { state: 'pending' };
    return { state: 'terminal', request: requestView(request) };
  }

  // One serialized first-evidence turn (design sections 4 and 6, A2b). A pending
  // target or a different decision identity is the documented conflict and never
  // expires, samples or appends, even when the pending target is due. Already
  // recorded evidence of this kind is returned as the current copied view without
  // replacing its first time or appending again. Otherwise the clock is sampled
  // once, bounded by the recorded resolution, and the evidence is installed only
  // after its flush, so a repeat report can never downgrade a confirmation.
  async #recordEvidence(kind, requestId, decisionId) {
    const request = this.#requests.get(requestId);
    if (request === undefined) return null;
    const op = EVIDENCE_OPS[kind];
    if (request.resolution === 'pending' || request.decision_id !== decisionId) {
      throw conflict(
        `${op} needs a terminal request with its recorded decision`,
        'DECISION_MISMATCH',
      );
    }
    const field = kind === 'acknowledge' ? 'acknowledgedAt' : 'returnedAt';
    if (request[field] !== null) return requestView(request);
    const sampled = evidenceTime(this.#clock);
    if (request.resolvedAt === null || compareInstants(sampled.instant, request.resolvedAt) < 0) {
      throw storageFailure(`${op} would precede its resolution`, 'STORAGE_FAILURE');
    }
    // Only a returned report observes the current state; an acknowledgement is
    // always `confirmed` because it is the strongest recorded evidence.
    const delivery =
      kind === 'returned' && request.delivery_state !== 'confirmed' ? 'returned' : 'confirmed';
    const mutation = {
      op,
      request_id: request.request_id,
      decision_id: decisionId,
      [EVIDENCE_TIME[kind]]: sampled.text,
      delivery_state: delivery,
    };
    await this.#append([mutation]);
    request[field] = sampled.instant;
    request.delivery_state = delivery;
    // No producer records a delivery error yet; clearing the current problem is
    // what first evidence means, and it never invents an error or a repair.
    request.delivery_error = null;
    this.#logger(`portable.request.${kind}`, { request_id: request.request_id });
    return requestView(request);
  }

  // Expiry work for one serialized turn: pending requests are grouped, and only a
  // group with a reached deadline samples time, generates identities or appends.
  // An empty or terminal-only journal samples nothing at all.
  async #sweepDue() {
    const pending = [...this.#requests.values()].filter(
      (request) => request.resolution === 'pending',
    );
    let expired = 0;
    for (let start = 0; start < pending.length; start += SWEEP_GROUP_SIZE) {
      const now = this.#clock();
      const group = pending.slice(start, start + SWEEP_GROUP_SIZE);
      const due = group.filter((request) => isDue(request, now));
      if (due.length === 0) continue;
      await this.#commitExpiry(now, due);
      expired += due.length;
    }
    return expired;
  }

  // One transaction of closures: every identity is generated and checked first, so
  // a malformed, throwing or colliding generator refuses the whole group before a
  // byte is written, and the closures become visible only after the flush. Each
  // initial delivery state is selected from live reachability before the append, so
  // a later registration loss changes no committed mutation, and every matching
  // waiter is woken only after the whole group is installed.
  async #commitExpiry(now, due) {
    const resolvedAt = utcTimestamp(now);
    const issued = new Set();
    const mutations = due.map((request) => ({
      op: EXPIRE_OP,
      request_id: request.request_id,
      decision_id: this.#nextDecisionId(issued),
      resolved_at: resolvedAt,
      delivery_state: this.#waiters.live(request.request_id) ? 'pending' : 'unavailable',
    }));
    await this.#commitFor(
      mutations,
      due.map((request) => request.request_id),
    );
    for (const mutation of mutations) this.#installClosure(mutation, 'expired');
    for (const mutation of mutations) {
      const request = this.#requests.get(mutation.request_id);
      this.#waiters.wake(mutation.request_id, { state: 'terminal', request: requestView(request) });
    }
    this.#logger('portable.request.expired', { count: mutations.length });
  }

  // An uncertain append is not an outcome: the affected waits settle as that
  // storage failure instead of a synthesized terminal result, and the existing
  // journal-wide fence is what refuses every later turn.
  async #commitFor(mutations, requestIds) {
    try {
      await this.#append(mutations);
    } catch (error) {
      this.#waiters.fail(requestIds, error);
      throw error;
    }
  }

  // A decision identity is spent once across recovered history and the pending
  // batch, and only its exact persisted spelling is accepted.
  #nextDecisionId(issued) {
    let value;
    try {
      value = this.#generateDecisionId();
    } catch (cause) {
      throw storageFailure('the decision identity generator failed', 'STORAGE_FAILURE', cause);
    }
    if (typeof value !== 'string' || !DECISION_ID_PATTERN.test(value)) {
      throw storageFailure('the decision identity generator produced an invalid identifier');
    }
    if (issued.has(value) || this.#decisions.has(value)) {
      throw storageFailure('a decision identity is already spent', 'JOURNAL_IDENTIFIER_COLLISION');
    }
    issued.add(value);
    return value;
  }

  #installClosure(mutation, resolution) {
    const request = this.#requests.get(mutation.request_id);
    request.resolution = resolution;
    request.resolved_at = mutation.resolved_at;
    // The decoded instant is kept exactly as persisted, so a later evidence
    // lower bound compares against the closure spelling, not a rounded one.
    request.resolvedAt = readInstant(mutation.resolved_at);
    request.decision_id = mutation.decision_id;
    request.delivery_state = mutation.delivery_state;
    this.#decisions.add(mutation.decision_id);
  }

  // Serialization point and fence gate in one place: a turn runs only while the
  // journal is trustworthy, so a refusal installed by an earlier turn is
  // observed before this one samples time, allocates an identity, appends or
  // returns a success view.
  #enqueue(task) {
    const run = this.#queue.then(() => this.#admitted(task));
    this.#queue = run.then(ignore, ignore);
    return run;
  }

  async #admitted(task) {
    if (this.#fence !== null) throw this.#fence;
    if (this.#deadlineFailure !== null) throw this.#deadlineFailure;
    return task();
  }

  // Pre-queue admission: a fenced journal and a closing/closed instance accept no
  // new turns. Turns admitted before close still run, so close drains the work it
  // already accepted instead of abandoning it.
  #admissionRefusal() {
    if (this.#fence !== null) return this.#fence;
    if (this.#closing || this.#closed) {
      return storageFailure('the portable broker is closed', 'STORAGE_FAILURE');
    }
    return null;
  }

  // The only write path. A rejected append leaves the file in an uncertain state,
  // so the instance is fenced before serialization is released; the original
  // refusal is what the caller sees, and nothing is installed for it.
  async #append(mutations) {
    try {
      return await this.#journal.append(mutations);
    } catch (error) {
      throw this.#fenceJournal(error);
    }
  }

  // Terminal for this instance until an ordinary close and reopen: no retry, no
  // compensating write, no in-place clearing and no automatic restart. The
  // causing refusal is preserved for its own caller; later turns receive the
  // generic fence refusal.
  #fenceJournal(cause) {
    if (this.#fence === null) {
      this.#fence = storageFailure(
        'the journal is fenced after an uncertain storage failure; close and reopen it',
        'STORAGE_FAILURE',
        cause,
      );
    }
    return cause;
  }
}

export function createPortableBroker({
  journal,
  owners,
  port,
  clock = () => Date.now(),
  logger = () => {},
  generateDecisionId = randomDecisionId,
  generatePairingCode = randomPairingCode,
  waitTurnoverMs,
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
  return new PortableBroker({
    journal,
    owners,
    port,
    clock,
    logger,
    generateDecisionId,
    generatePairingCode,
    waitTurnoverMs,
  });
}
