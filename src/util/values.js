// Small value helpers shared by the journal, broker and adapters: identifier
// formats, RFC 3339 UTC timestamps, scalar lengths and redaction of secrets.
import { createHash, randomBytes } from 'node:crypto';

export const REQUEST_ID_PATTERN = /^req_[a-f0-9]{32}$/;
export const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const CALLBACK_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
export const PAIRING_CODE_PATTERN = /^[a-f0-9]{32}$/;

// Ephemeral adapter registration (design sections 3 and 7): one identifier and
// one protected 256-bit secret, both held only in memory.
export const REGISTRATION_ID_PATTERN = /^reg_[a-f0-9]{32}$/;
export const REGISTRATION_SECRET_PATTERN = /^[a-f0-9]{64}$/;

// Request authority (design section 3): a handle is stable correlation, the
// capability is the private key and a decision ID names one resolution.
export const REQUEST_HANDLE_PATTERN = /^hdl_[a-f0-9]{32}$/;
export const REQUEST_CAPABILITY_PATTERN = /^cap_[a-f0-9]{64}$/;
export const DECISION_ID_PATTERN = /^dec_[a-f0-9]{32}$/;

export function randomRequestId() {
  return `req_${randomBytes(16).toString('hex')}`;
}

// 128-bit handle and 256-bit capability, allocated independently on every
// preparation; only the capability's SHA-256 verifier is ever persisted.
export function randomRequestHandle() {
  return `hdl_${randomBytes(16).toString('hex')}`;
}

export function randomRequestCapability() {
  return `cap_${randomBytes(32).toString('hex')}`;
}

// One 128-bit identity per resolution, so no decision can be spent twice.
export function randomDecisionId() {
  return `dec_${randomBytes(16).toString('hex')}`;
}

export function randomCallbackToken() {
  return randomBytes(16).toString('hex');
}

// 128-bit one-use pairing code; only a hash of it is persisted.
export function randomPairingCode() {
  return randomBytes(16).toString('hex');
}

// The prompt ID is derived from the request ID, so every retry, restart and
// replay reuses one stable admission ID (design section 6).
export function promptIdForRequest(requestId) {
  return `msg_${requestId.slice(4)}`;
}

export function utcTimestamp(milliseconds = Date.now()) {
  return new Date(milliseconds).toISOString();
}

export function parseTimestamp(text) {
  const value = Date.parse(text);
  return Number.isFinite(value) ? value : null;
}

// A stored or broker-issued instant is admitted only in the UTC RFC 3339 spelling
// the journal's own decoder accepts; a permissive date parser would accept and
// silently normalize an instant (a rolled-over day, a leap second, a non-UTC
// offset) that the durable record would never contain.
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|\+00:00)$/;

export function isUtcTimestamp(text) {
  if (typeof text !== 'string') return false;
  const match = UTC_TIMESTAMP.exec(text);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Telegram limits and the design's argument limits are counted in Unicode
// scalar values, so a string with surrogate pairs must not double-count.
export function scalarLength(value) {
  return [...value].length;
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Routine logs never carry credentials, full Telegram URLs or request text.
export function redactError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNEXPECTED';
  const message = String(error?.message ?? 'unexpected failure')
    .replace(/bot[0-9A-Za-z:_.-]+/g, 'bot<redacted>')
    .slice(0, 300);
  return { code, message };
}
