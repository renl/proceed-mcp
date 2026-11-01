// MCP tool execution boundary (design section 3). Preparation forwards to the
// authenticated broker reservation route, so the private capability is returned
// only after a real durable reservation, and the reserved management calls
// forward their authority so the broker can deny them honestly. The waiting call
// stays unavailable until its own unit exists: a prepared reservation is never an
// approval and cannot stand in for a human decision.
import { LocalRequestError } from '../http/local-client.js';
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

// One broker error travels unchanged: its versioned envelope already names the
// tool error code and whether repeating the call can help.
function outcomeOf(response) {
  if (response.status >= 200 && response.status < 300 && isPlainObject(response.body)) {
    return complete(response.body, false);
  }
  const error = isPlainObject(response.body?.error) ? response.body.error : {};
  const code = typeof error.code === 'string' ? error.code : 'BROKER_REJECTED';
  const message =
    typeof error.message === 'string' ? error.message : 'the broker rejected the call';
  return complete(envelope(code, message, error.retryable === true), true);
}

export function createToolExecutor({ client }) {
  const send = async (method, path, body, headers) => {
    try {
      return outcomeOf(await client.request(method, path, body, headers));
    } catch (error) {
      // A missing or unreachable broker is a temporary prerequisite, not a
      // decision and not a reason to invent request authority.
      if (error instanceof LocalRequestError) {
        return complete(
          envelope(error.code, error.message, error.code === 'BROKER_UNAVAILABLE'),
          true,
        );
      }
      throw error;
    }
  };

  return async function execute(name, args) {
    if (name === 'request_approval') return complete(WAITING_UNAVAILABLE, true);
    const problem = argumentProblem(name, args);
    if (problem !== null) return invalid(problem);

    if (name === 'prepare_approval') {
      const body = args.session_label === undefined ? {} : { session_label: args.session_label };
      return send('POST', '/v1/handles', body);
    }

    // The request ID was matched against its format above, so the path cannot
    // carry an unexpected segment.
    const path = `/v1/requests/${encodeURIComponent(args.request_id)}`;
    const headers = { [CAPABILITY_HEADER]: args.request_capability };
    if (name === 'get_approval') return send('GET', path, undefined, headers);
    if (name === 'cancel_approval') return send('POST', `${path}/cancel`, {}, headers);
    return send('POST', `${path}/acknowledge`, { decision_id: args.decision_id }, headers);
  };
}
