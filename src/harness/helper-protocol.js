// Private TUI/helper byte-stream contract (design section 2). This is an
// application-internal pipe protocol, not a public CLI, MCP tool, decision RPC or
// broker transport change.
//
// One parent-created child serves exactly one exchange. Slots 3 and 4 are byte
// streams, so every frame is a 4-byte unsigned big-endian byte length followed by
// strict UTF-8 JSON. Lengths are checked before allocation, duplicate keys and a
// BOM are refused, and each direction is bounded. Both sides use this one module
// so the encoder and the admission rules cannot drift apart.
import { isPlainObject } from '../util/values.js';

export const PROTOCOL_SCHEMA_VERSION = 1;
export const FRAME_PREFIX_BYTES = 4;
export const MIN_FRAME_BYTES = 1;
export const MAX_FRAME_BYTES = 81920;
export const MAX_DIRECTION_BYTES = 98304;
export const MAX_NODE_VERSION_CHARS = 32;
// One exchange, including resolution, spawn, handoff, TLS, body and cleanup.
export const MAX_EXCHANGE_BUDGET_MS = 10000;

export const EXCHANGE_ID_PATTERN = /^[a-f0-9]{32}$/;
export const NODE_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

// The closed local error vocabulary. Valid broker refusals stay a `response`
// with their unchanged HTTP status and envelope, never a renamed helper error.
export const LOCAL_ERROR_CODES = Object.freeze([
  'NODE_UNAVAILABLE',
  'NODE_UNSUPPORTED',
  'HELPER_PROTOCOL_INVALID',
  'HELPER_LIMIT_EXCEEDED',
  'EXCHANGE_CANCELLED',
  'EXCHANGE_DEADLINE',
  'BROKER_UNAVAILABLE',
  'BROKER_INSTANCE_CONFLICT',
  'BROKER_RESPONSE_INVALID',
]);

export const LOWEST_STATUS = 200;
export const HIGHEST_STATUS = 599;

// A malformed, out-of-order or oversized stream is a protocol failure. Callers
// map the code to one fixed nonsecret message rather than echoing raw bytes.
export class FrameError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FrameError';
    this.code = code;
  }
}

export function protocolInvalid() {
  return new FrameError('HELPER_PROTOCOL_INVALID');
}

export function limitExceeded() {
  return new FrameError('HELPER_LIMIT_EXCEEDED');
}

// Exact field sets, not merely required keys: an extra field is an attempt to
// widen the contract and is refused before its value is read.
export function exactFieldsProblem(value, fields) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length) return 'the frame has an unexpected field set';
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) return 'the frame is missing a required field';
  }
  return null;
}

// JSON.parse silently keeps the last of duplicated keys, so the text is scanned
// first. Object keys are the only strings directly after `{` or `,`, and every
// such token is decoded before comparison so escaped spellings collide.
function assertNoDuplicateKeys(text) {
  const stack = [];
  let expectKey = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index += 1;
        index += 1;
      }
      if (index >= text.length) throw protocolInvalid();
      const current = stack[stack.length - 1];
      if (current !== undefined && current !== null && expectKey) {
        let key;
        try {
          key = JSON.parse(text.slice(start, index + 1));
        } catch {
          throw protocolInvalid();
        }
        if (current.has(key)) throw protocolInvalid();
        current.add(key);
        expectKey = false;
      }
      continue;
    }
    if (char === '{') {
      stack.push(new Set());
      expectKey = true;
      continue;
    }
    if (char === '[') {
      stack.push(null);
      expectKey = false;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      expectKey = false;
      continue;
    }
    if (char === ',') {
      expectKey = stack[stack.length - 1] !== null && stack[stack.length - 1] !== undefined;
    }
  }
}

export function parseStrictJson(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw protocolInvalid();
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw protocolInvalid();
  }
  if (text === '' || text.charCodeAt(0) === 0xfeff) throw protocolInvalid();
  assertNoDuplicateKeys(text);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw protocolInvalid();
  }
  if (!isPlainObject(value)) throw protocolInvalid();
  return value;
}

export function encodeFrame(value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length < MIN_FRAME_BYTES) throw protocolInvalid();
  if (bytes.length > MAX_FRAME_BYTES) throw limitExceeded();
  const prefix = Buffer.alloc(FRAME_PREFIX_BYTES);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

// Incremental reader: partial frames wait, complete frames are parsed and
// surfaced, and any traffic beyond the directional limit fails closed before more
// is buffered.
export class FrameReader {
  #buffer = Buffer.alloc(0);
  #total = 0;

  push(chunk) {
    this.#total += chunk.length;
    if (this.#total > MAX_DIRECTION_BYTES) throw limitExceeded();
    this.#buffer =
      this.#buffer.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const frames = [];
    while (this.#buffer.length >= FRAME_PREFIX_BYTES) {
      const length = this.#buffer.readUInt32BE(0);
      if (length < MIN_FRAME_BYTES) throw protocolInvalid();
      if (length > MAX_FRAME_BYTES) throw limitExceeded();
      if (this.#buffer.length < FRAME_PREFIX_BYTES + length) break;
      const body = this.#buffer.subarray(FRAME_PREFIX_BYTES, FRAME_PREFIX_BYTES + length);
      frames.push(parseStrictJson(body));
      this.#buffer = this.#buffer.subarray(FRAME_PREFIX_BYTES + length);
    }
    return frames;
  }

  get pendingBytes() {
    return this.#buffer.length;
  }
}

// A stream-to-frame queue that never rejects: a waiter learns about a frame, end
// of stream or a protocol failure, and a late completion is simply ignored.
export function createFrameChannel(stream) {
  const reader = new FrameReader();
  const queue = [];
  const waiters = [];
  let ended = false;
  let failure = null;
  const settle = () => {
    while (waiters.length > 0) {
      if (failure !== null) waiters.shift()({ failure });
      else if (queue.length > 0) waiters.shift()({ frame: queue.shift() });
      else if (ended) waiters.shift()({ eof: true });
      else return;
    }
  };
  stream.on('data', (chunk) => {
    if (failure !== null || ended) return;
    try {
      queue.push(...reader.push(chunk));
    } catch (error) {
      failure = error instanceof FrameError ? error.code : 'HELPER_PROTOCOL_INVALID';
    }
    settle();
  });
  stream.on('end', () => {
    ended = true;
    settle();
  });
  stream.on('close', () => {
    ended = true;
    settle();
  });
  stream.on('error', () => {
    if (failure === null) failure = 'HELPER_PROTOCOL_INVALID';
    settle();
  });
  return {
    take() {
      if (failure !== null) return Promise.resolve({ failure });
      if (queue.length > 0) return Promise.resolve({ frame: queue.shift() });
      if (ended) return Promise.resolve({ eof: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
    get ended() {
      return ended;
    },
    // Success admission after a caller consumed its one frame. A queued extra
    // frame, a partial trailing frame or a late protocol failure means the stream
    // carried more than the contract allows, and an open stream means closure was
    // never observed. Each case fails closed instead of being ignored.
    admissionProblem() {
      if (failure !== null) return failure;
      if (queue.length > 0 || reader.pendingBytes > 0) return 'HELPER_PROTOCOL_INVALID';
      if (!ended) return 'HELPER_PROTOCOL_INVALID';
      return null;
    },
  };
}

// Parent `hello`: an absolute UNIX millisecond deadline at most one full exchange
// budget away, and no secret. A stale or extended budget is refused so the parent
// cannot grant itself extra time through the pipe.
export function helloProblem(value) {
  const fields = exactFieldsProblem(value, [
    'schema_version',
    'type',
    'exchange_id',
    'deadline_unix_ms',
  ]);
  if (fields !== null) return fields;
  if (value.schema_version !== PROTOCOL_SCHEMA_VERSION) return 'the frame version is unsupported';
  if (value.type !== 'hello') return 'the first frame must be hello';
  if (typeof value.exchange_id !== 'string' || !EXCHANGE_ID_PATTERN.test(value.exchange_id)) {
    return 'exchange_id must be 32 lowercase hexadecimal characters';
  }
  if (!Number.isSafeInteger(value.deadline_unix_ms)) return 'deadline_unix_ms must be an integer';
  const remaining = value.deadline_unix_ms - Date.now();
  if (remaining <= 0) return 'the exchange deadline has already passed';
  if (remaining > MAX_EXCHANGE_BUDGET_MS) return 'the exchange deadline exceeds one budget';
  return null;
}

// Child `ready`: emitted only after the runtime and both private descriptors were
// checked, so the parent validates a genuine Node identity before any authority
// handoff.
export function readyProblem(value, expectedExchangeId) {
  const fields = exactFieldsProblem(value, [
    'schema_version',
    'type',
    'exchange_id',
    'runtime',
    'node_version',
  ]);
  if (fields !== null) return fields;
  if (value.schema_version !== PROTOCOL_SCHEMA_VERSION) return 'the frame version is unsupported';
  if (value.type !== 'ready') return 'the child did not announce readiness';
  if (typeof value.exchange_id !== 'string' || value.exchange_id !== expectedExchangeId) {
    return 'the child announced a different exchange';
  }
  if (value.runtime !== 'node') return 'the child is not a genuine Node runtime';
  const version = value.node_version;
  if (typeof version !== 'string' || version.length > MAX_NODE_VERSION_CHARS) {
    return 'node_version must be a bounded release version';
  }
  if (!NODE_VERSION_PATTERN.test(version)) return 'node_version must be a numeric release version';
  if (Number(version.split('.')[0]) < 24) return 'node_version must be 24 or newer';
  return null;
}

export function responseProblem(value, expectedExchangeId) {
  const fields = exactFieldsProblem(value, [
    'schema_version',
    'type',
    'exchange_id',
    'status',
    'body',
  ]);
  if (fields !== null) return fields;
  if (value.schema_version !== PROTOCOL_SCHEMA_VERSION) return 'the frame version is unsupported';
  if (value.type !== 'response') return 'the child returned no broker response';
  if (typeof value.exchange_id !== 'string' || value.exchange_id !== expectedExchangeId) {
    return 'the child answered a different exchange';
  }
  if (
    !Number.isInteger(value.status) ||
    value.status < LOWEST_STATUS ||
    value.status > HIGHEST_STATUS
  ) {
    return 'status must be an HTTP status code';
  }
  if (!isPlainObject(value.body)) return 'the response body must be an object';
  return null;
}

export function errorProblem(value, expectedExchangeId) {
  const fields = exactFieldsProblem(value, ['schema_version', 'type', 'exchange_id', 'code']);
  if (fields !== null) return fields;
  if (value.schema_version !== PROTOCOL_SCHEMA_VERSION) return 'the frame version is unsupported';
  if (value.type !== 'error') return 'the child returned neither a response nor a local error';
  if (typeof value.exchange_id !== 'string' || value.exchange_id !== expectedExchangeId) {
    return 'the child reported a different exchange';
  }
  if (typeof value.code !== 'string' || !LOCAL_ERROR_CODES.includes(value.code)) {
    return 'the local error code is not in the closed vocabulary';
  }
  return null;
}
