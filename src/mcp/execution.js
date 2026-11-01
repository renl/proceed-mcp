// MCP tool execution boundary (design section 3). Only a valid implemented
// operation asks the broker for admission, so a catalog-only adapter never
// contacts it, and the first such operation establishes this adapter's private
// registration before any business route is forwarded. Preparation then forwards
// to the authenticated reservation route, so the private capability is returned
// only after a real durable reservation, and the reserved management calls forward
// their authority so the broker can deny them honestly. The waiting call stays
// unavailable until its own unit exists: a prepared reservation is never an
// approval and cannot stand in for a human decision.
import { LocalRequestError } from '../http/local-client.js';
import { RegistrationError } from './registration.js';
import {
  DECISION_ID_PATTERN,
  REQUEST_CAPABILITY_PATTERN,
  REQUEST_ID_PATTERN,
  isPlainObject,
  scalarLength,
} from '../util/values.js';

// Design section 3 carries the capability in its own header, never in the URL or
// an ordinary body field.
const CAPABILITY_HEADER = 'X-Proceed-Request-Capability';
const MAX_LABEL_SCALARS = 128;

// The waiting call is the one effect this build does not implement: it says so
// instead of returning a pending-looking receipt or a fabricated outcome.
const WAITING_UNAVAILABLE = Object.freeze({
  schema_version: 1,
  error: {
    code: 'ENHANCEMENT_UNAVAILABLE',
    message:
      'request_approval is not implemented in this build, so a prepared reservation cannot wait for a human decision or return an outcome yet',
    retryable: false,
  },
});

function envelope(code, message, retryable) {
  return { schema_version: 1, error: { code, message, retryable } };
}

// Tool success and tool failure carry the same JSON in structuredContent and a
// text block, so a client reading either one cannot mistake a denial for an
// approval or a human response.
function complete(value, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  };
}

const invalid = (message) => complete(envelope('INVALID_ARGUMENT', message, false), true);

// Design section 3's tool-code list is closed: a broker value outside it is never
// reported as a new private outcome, and a transport abort, an unreadable reply or
// an unrecognized envelope is one redacted, retryable unavailable prerequisite.
const TOOL_CODES = new Set([
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
const UNAVAILABLE_MESSAGE = 'the broker did not return a usable result';

function closedEnvelope(code, message, retryable) {
  if (typeof message !== 'string' || typeof retryable !== 'boolean' || !TOOL_CODES.has(code)) {
    return envelope('BROKER_UNAVAILABLE', UNAVAILABLE_MESSAGE, true);
  }
  return envelope(code, message, retryable);
}

// Shape rules mirror the advertised inputSchema: one object, no additional
// properties, exactly the documented fields and their identifier formats.
const INPUTS = {
  prepare_approval: { required: [], optional: ['session_label'] },
  get_approval: { required: ['request_id', 'request_capability'], optional: [] },
  cancel_approval: { required: ['request_id', 'request_capability'], optional: [] },
  acknowledge_approval: {
    required: ['request_id', 'request_capability', 'decision_id'],
    optional: [],
  },
};

const PATTERNS = {
  request_id: REQUEST_ID_PATTERN,
  request_capability: REQUEST_CAPABILITY_PATTERN,
  decision_id: DECISION_ID_PATTERN,
};

function argumentProblem(name, args) {
  const input = INPUTS[name];
  if (!isPlainObject(args)) return `${name} arguments must be one object`;
  const allowed = [...input.required, ...input.optional];
  const unexpected = Object.keys(args).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) return `${name} does not accept ${unexpected}`;
  const missing = input.required.find((key) => !Object.hasOwn(args, key));
  if (missing !== undefined) return `${name} requires ${missing}`;
  for (const key of Object.keys(args)) {
    const pattern = PATTERNS[key];
    if (pattern !== undefined && (typeof args[key] !== 'string' || !pattern.test(args[key]))) {
      return `${name} received a malformed ${key}`;
    }
  }
  // The label is display only; its exact length and text rules stay with the
  // broker, which validates them again before reserving anything.
  if (name === 'prepare_approval' && args.session_label !== undefined) {
    if (
      typeof args.session_label !== 'string' ||
      args.session_label.length === 0 ||
      scalarLength(args.session_label) > MAX_LABEL_SCALARS
    ) {
      return 'session_label must be 1-128 Unicode scalar values';
    }
  }
  return null;
}

// One recognized broker error travels unchanged: its versioned envelope already
// names the tool error code and whether repeating the call can help. A status or
// body outside that documented shape proves nothing, so it is redacted.
function outcomeOf(response) {
  if (response.status >= 200 && response.status < 300 && isPlainObject(response.body)) {
    return complete(response.body, false);
  }
  const error =
    isPlainObject(response.body) &&
    response.body.schema_version === 1 &&
    isPlainObject(response.body.error)
      ? response.body.error
      : {};
  return complete(closedEnvelope(error.code, error.message, error.retryable), true);
}

// A cancelled invocation is a transport decision, not a business outcome: it
// stops waiting, closes only its own exchange and reports the same redacted
// unavailable prerequisite, which the adapter then suppresses for that call.
const ABANDONED = Symbol('cancelled invocation');

function abandoned() {
  return complete(closedEnvelope('BROKER_UNAVAILABLE', UNAVAILABLE_MESSAGE, true), true);
}

// Registration is shared work: a cancelled awaiter stops waiting on it, while the
// single-flight ensure still completes for every other invocation that needs it.
function untilCancelled(work, signal) {
  if (signal === undefined || signal === null) return work;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', stop);
      action(value);
    };
    const stop = () => finish(reject, ABANDONED);
    work.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

// Each exchange is its own transport, so cancelling or closing one invocation can
// never abort another call's in-flight broker work.
function combine(signal, controller) {
  if (signal === undefined || signal === null) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const forward = () => controller.abort();
  signal.addEventListener('abort', forward, { once: true });
  return () => signal.removeEventListener('abort', forward);
}

export function createToolExecutor({ client, registration }) {
  // Ordinary broker exchanges are cancelled as one unit when the adapter closes;
  // the registration binding cancels its own lifecycle traffic, and both stay
  // inside the single shutdown budget.
  const ordinary = new AbortController();
  let closing = null;

  const send = async (method, path, body, headers, signal) => {
    const transport = new AbortController();
    const unlinks = [combine(signal, transport), combine(ordinary.signal, transport)];
    let response;
    try {
      response = await client.request(method, path, body, headers, { signal: transport.signal });
    } catch (error) {
      // A cancelled or closed exchange reports the same redacted prerequisite; the
      // cancellation itself is not a request decision and never becomes one.
      if (transport.signal.aborted) return abandoned();
      // A missing or unreachable broker is a temporary prerequisite, not a
      // decision and not a reason to invent request authority.
      if (error instanceof LocalRequestError) {
        return complete(
          closedEnvelope(error.code, error.message, error.code === 'BROKER_UNAVAILABLE'),
          true,
        );
      }
      throw error;
    } finally {
      for (const unlink of unlinks) unlink();
    }
    return outcomeOf(response);
  };

  // Admission precedes the first implemented operation and never the catalog:
  // initialize, discovery, invalid arguments and the unimplemented waiting call
  // reach no broker, while a duplicate live owner surfaces as its own tool error
  // without forwarding or mutating anything.
  async function execute(name, args, context = {}) {
    if (name === 'request_approval') return complete(WAITING_UNAVAILABLE, true);
    const problem = argumentProblem(name, args);
    if (problem !== null) return invalid(problem);

    const signal = context?.signal ?? null;
    if (signal?.aborted === true) return abandoned();

    try {
      await untilCancelled(registration.ensure(), signal);
    } catch (error) {
      if (error === ABANDONED) return abandoned();
      if (error instanceof RegistrationError) {
        return complete(closedEnvelope(error.code, error.message, error.retryable), true);
      }
      throw error;
    }
    // Cancellation can arrive while a shared ensure settles for other awaiters;
    // this invocation still forwards nothing.
    if (signal?.aborted === true) return abandoned();

    // Registration admits this adapter to the broker; it never authenticates an
    // agent session and never replaces a request capability, so the reserved
    // routes keep their owner-plus-capability authority exactly as before.
    if (name === 'prepare_approval') {
      const body = args.session_label === undefined ? {} : { session_label: args.session_label };
      return send('POST', '/v1/handles', body, undefined, signal);
    }

    // The request ID was matched against its format above, so the path cannot
    // carry an unexpected segment.
    const path = `/v1/requests/${encodeURIComponent(args.request_id)}`;
    const headers = { [CAPABILITY_HEADER]: args.request_capability };
    if (name === 'get_approval') return send('GET', path, undefined, headers, signal);
    if (name === 'cancel_approval') return send('POST', `${path}/cancel`, {}, headers, signal);
    return send('POST', `${path}/acknowledge`, { decision_id: args.decision_id }, headers, signal);
  }

  return {
    execute,
    // Terminal and idempotent: fence new and queued ordinary exchanges first, then
    // let the binding release only its captured registration. Repeated close shares
    // this one shutdown instead of starting another budget.
    close() {
      closing ??= (async () => {
        ordinary.abort();
        await registration.close();
      })();
      return closing;
    },
  };
}
