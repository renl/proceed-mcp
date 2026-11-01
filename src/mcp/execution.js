// MCP tool execution boundary (design section 3). Only a valid implemented
// operation asks the broker for admission, so a catalog-only adapter never
// contacts it, and the first such operation establishes this adapter's private
// registration before any business route is forwarded. Preparation then forwards
// to the authenticated reservation route, so the private capability is returned
// only after a real durable reservation, and the reserved management calls forward
// their authority so the broker can deny them honestly. The waiting call creates or
// replays its request once per invocation and then keeps that one invocation waiting
// on the broker's bounded poll, claiming neither human presentation nor a returned write.
import { LocalRequestError } from '../http/local-client.js';
import { REGISTRATION_HEADER, RegistrationError } from './registration.js';
import {
  CLIENT_REQUEST_ID_PATTERN,
  DECISION_ID_PATTERN,
  REQUEST_CAPABILITY_PATTERN,
  REQUEST_HANDLE_PATTERN,
  REQUEST_ID_PATTERN,
  isPlainObject,
  scalarLength,
} from '../util/values.js';

// Design section 3 carries the capability in its own header, never in the URL or
// an ordinary body field.
const CAPABILITY_HEADER = 'X-Proceed-Request-Capability';
const MAX_LABEL_SCALARS = 128;
const MAX_ACTION_SCALARS = 1000;
const MAX_CONTEXT_SCALARS = 1000;
// The same ceiling the human Respond prompt accepts: nonempty text up to 4096 scalars.
const MAX_RESPONSE_SCALARS = 4096;
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 86400;

// A lone surrogate cannot round-trip through UTF-8, so caller text carrying one is
// rejected, and only a lost transport delays a repeat: 1, 2, 4, 8, 16, then 30
// seconds, with no attempt cutoff while the invocation lives and no re-creation.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const WAIT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

// An overlapping invocation of one prepared handle is this adapter's own conflict.
const CONFLICT = envelope(
  'WAIT_ALREADY_ACTIVE',
  'this request already has an active waiter',
  false,
);
const CANCELLED = new LocalRequestError('BROKER_UNAVAILABLE', 'the local request was cancelled');

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
  request_approval: {
    required: ['request_handle', 'request_capability', 'client_request_id', 'action', 'context'],
    optional: ['expires_in_seconds'],
  },
  get_approval: { required: ['request_id', 'request_capability'], optional: [] },
  cancel_approval: { required: ['request_id', 'request_capability'], optional: [] },
  acknowledge_approval: {
    required: ['request_id', 'request_capability', 'decision_id'],
    optional: [],
  },
};

const PATTERNS = {
  client_request_id: CLIENT_REQUEST_ID_PATTERN,
  request_handle: REQUEST_HANDLE_PATTERN,
  request_id: REQUEST_ID_PATTERN,
  request_capability: REQUEST_CAPABILITY_PATTERN,
  decision_id: DECISION_ID_PATTERN,
};

// Caller text is counted in Unicode scalar values, exactly as the broker counts it.
function textProblem(value, name, min, max) {
  if (typeof value !== 'string') return `${name} must be text`;
  if (LONE_SURROGATE.test(value)) return `${name} must be well-formed text`;
  const length = scalarLength(value);
  if (length < min || length > max) return `${name} must be ${min}-${max} Unicode scalars`;
  return null;
}

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
  // The waiting arguments are validated before any registration or creation.
  if (name === 'request_approval') {
    const actionProblem = textProblem(args.action, 'action', 1, MAX_ACTION_SCALARS);
    if (actionProblem !== null) return actionProblem;
    const contextProblem = textProblem(args.context, 'context', 0, MAX_CONTEXT_SCALARS);
    if (contextProblem !== null) return contextProblem;
    // Only an omitted duration takes the broker default; no value is coerced.
    const expires = args.expires_in_seconds;
    const ranged =
      Number.isInteger(expires) && expires >= MIN_EXPIRY_SECONDS && expires <= MAX_EXPIRY_SECONDS;
    if (expires !== undefined && !ranged) {
      return `expires_in_seconds must be an integer ${MIN_EXPIRY_SECONDS}-${MAX_EXPIRY_SECONDS}`;
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

// Design section 3's common representation is the only usable request body: every
// documented field carrying a public value, with its resolution and the values that
// resolution allows. A missing, invented or nullable-in-the-wrong-place field is not
// a smaller representation, so it is never promoted and never enters a transport retry.
const RESOLUTIONS = new Set([
  'pending',
  'approved',
  'rejected',
  'responded',
  'expired',
  'cancelled',
]);
const TELEGRAM_STATES = new Set(['pending', 'sent', 'failed']);
const DELIVERY_STATES = new Set([
  'not_applicable',
  'pending',
  'returned',
  'confirmed',
  'unavailable',
  'blocked',
]);
const EVENT_STATES = new Set(['unverified', 'unsupported', 'verified']);
// Design section 3 "Response fields and authority privacy": a representation exposes
// only these fields, and the two nested objects expose only their documented members.
// Additional broker metadata is additive detail, so it is omitted rather than rejected
// or given the meaning of an extension to schema version 1.
const COMMON_FIELDS = [
  'schema_version',
  'request_handle',
  'request_id',
  'client_request_id',
  'owner_id',
  'session_label',
  'action',
  'context',
  'created_at',
  'expires_at',
  'resolution',
  'resolved_at',
  'response_text',
  'decision_id',
  'telegram_state',
  'delivery_state',
  'delivery_error',
  'event_capability',
];
const DIAGNOSTIC_FIELDS = ['code', 'message', 'retryable'];
const EVENT_FIELDS = ['status', 'revision', 'reason'];
// Request authority is issued to the caller, never echoed by a request representation,
// so its name at the top level is a malformed disclosure whatever the value is. The
// same words quoted inside caller or human text are that text and stay exactly.
const AUTHORITY_FIELDS = ['request_capability', 'registration_secret'];

function admitted(body, fields) {
  const value = {};
  for (const field of fields) value[field] = body[field];
  return value;
}

function projection(body) {
  const value = admitted(body, COMMON_FIELDS);
  value.delivery_error =
    body.delivery_error === null ? null : admitted(body.delivery_error, DIAGNOSTIC_FIELDS);
  value.event_capability = admitted(body.event_capability, EVENT_FIELDS);
  return value;
}

// A request instant is UTC RFC 3339: `-00:00` states that the offset is unknown, so
// only `Z` and `+00:00` carry UTC, and the calendar must be its own round-trip.
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/;

function instant(value) {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value)) return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

// The nested delivery diagnostic and Events handshake are the documented shapes:
// absent evidence is null, and neither is invented by this adapter.
function diagnostic(value) {
  if (value === null) return true;
  return (
    isPlainObject(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  );
}

function events(value) {
  if (!isPlainObject(value) || !EVENT_STATES.has(value.status)) return false;
  const pinned = (field) => value[field] === null || typeof value[field] === 'string';
  return pinned('revision') && pinned('reason');
}

// A request representation is this outcome only when it names the prepared handle,
// the committed request and its complete common view; a pending or invented shape is
// never promoted, and a terminal one names exactly one decision. What survives is the
// documented projection, so additive metadata never reaches an MCP result channel.
function requestView(body, handle, requestId) {
  if (!isPlainObject(body) || body.schema_version !== 1) return null;
  // A disclosed authority field makes the whole representation unusable, before any
  // of it is promoted or reported, and nothing from it is echoed.
  if (AUTHORITY_FIELDS.some((field) => Object.hasOwn(body, field))) return null;
  if (body.request_handle !== handle) return null;
  if (typeof body.request_id !== 'string' || !REQUEST_ID_PATTERN.test(body.request_id)) return null;
  if (requestId !== null && body.request_id !== requestId) return null;
  if (
    typeof body.client_request_id !== 'string' ||
    !CLIENT_REQUEST_ID_PATTERN.test(body.client_request_id) ||
    typeof body.owner_id !== 'string' ||
    body.owner_id.length === 0 ||
    textProblem(body.session_label, 'session_label', 1, MAX_LABEL_SCALARS) !== null ||
    textProblem(body.action, 'action', 1, MAX_ACTION_SCALARS) !== null ||
    textProblem(body.context, 'context', 0, MAX_CONTEXT_SCALARS) !== null ||
    !instant(body.created_at) ||
    !instant(body.expires_at) ||
    !TELEGRAM_STATES.has(body.telegram_state) ||
    !DELIVERY_STATES.has(body.delivery_state) ||
    !diagnostic(body.delivery_error) ||
    !events(body.event_capability)
  ) {
    return null;
  }
  // A live request carries no outcome and no delivery standing yet, and its nullable
  // outcome fields are present.
  if (body.resolution === 'pending') {
    return body.delivery_state === 'not_applicable' &&
      body.delivery_error === null &&
      body.resolved_at === null &&
      body.response_text === null &&
      body.decision_id === null
      ? projection(body)
      : null;
  }
  if (!RESOLUTIONS.has(body.resolution) || !instant(body.resolved_at)) return null;
  // Only a live request has no delivery standing at all.
  if (body.delivery_state === 'not_applicable') return null;
  // Acknowledgement and a successful write are evidence that clears the current
  // diagnostic, so a non-null one contradicts the standing it accompanies.
  if (
    (body.delivery_state === 'confirmed' || body.delivery_state === 'returned') &&
    body.delivery_error !== null
  ) {
    return null;
  }
  if (typeof body.decision_id !== 'string' || !DECISION_ID_PATTERN.test(body.decision_id)) {
    return null;
  }
  // Respond is the one outcome that carries text, bounded and well-formed exactly as
  // the broker accepts it; every other closure keeps it null.
  if (body.resolution !== 'responded') {
    return body.response_text === null ? projection(body) : null;
  }
  return textProblem(body.response_text, 'response_text', 1, MAX_RESPONSE_SCALARS) === null
    ? projection(body)
    : null;
}

function creationBody(args) {
  const { request_handle, client_request_id, action, context, expires_in_seconds } = args;
  const body = { request_handle, client_request_id, action, context };
  if (expires_in_seconds !== undefined) body.expires_in_seconds = expires_in_seconds;
  return body;
}

// A cancelled invocation is a transport decision, not a business outcome: it
// stops waiting, closes only its own exchange and reports the same redacted
// unavailable prerequisite, which the adapter then suppresses for that call. An
// unusable success reply proves no outcome either, so it reports exactly that.
const ABANDONED = Symbol('cancelled invocation');

function unusable() {
  return complete(closedEnvelope('BROKER_UNAVAILABLE', UNAVAILABLE_MESSAGE, true), true);
}

const abandoned = unusable;

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

// The delay between failed wait transports belongs to its invocation: abort settles it.
function hold(ms, signals) {
  const active = signals.filter((signal) => signal !== undefined && signal !== null);
  return new Promise((resolve) => {
    let timer;
    const settle = (elapsed) => {
      clearTimeout(timer);
      for (const signal of active) signal.removeEventListener('abort', stop);
      resolve(elapsed);
    };
    const stop = () => settle(false);
    timer = setTimeout(() => settle(true), ms);
    timer.unref?.();
    for (const signal of active) signal.addEventListener('abort', stop, { once: true });
    if (active.some((signal) => signal.aborted)) stop();
  });
}

export function createToolExecutor({ client, waitClient, registration }) {
  // Ordinary broker exchanges are cancelled as one unit when the adapter closes;
  // the registration binding cancels its own lifecycle traffic, and both stay
  // inside the single shutdown budget.
  const ordinary = new AbortController();
  let closing = null;
  // One live waiting invocation per prepared handle, held across turnovers and reconnects.
  const waiting = new Set();

  // Each exchange is its own transport, so one invocation's cancel never aborts another's.
  const transmit = async (which, method, path, body, headers, signal) => {
    const transport = new AbortController();
    const unlinks = [combine(signal, transport), combine(ordinary.signal, transport)];
    try {
      if (transport.signal.aborted) return { error: CANCELLED, aborted: true };
      return {
        response: await which.request(method, path, body, headers, { signal: transport.signal }),
      };
    } catch (error) {
      return { error, aborted: transport.signal.aborted };
    } finally {
      for (const unlink of unlinks) unlink();
    }
  };

  // A cancelled, closed or unreadable exchange never becomes a decision.
  const localFailure = (sent) => {
    if (sent.aborted) return abandoned();
    if (!(sent.error instanceof LocalRequestError)) throw sent.error;
    const { code, message } = sent.error;
    return complete(closedEnvelope(code, message, code === 'BROKER_UNAVAILABLE'), true);
  };

  // Shared registration authority: a cancelled awaiter stops, a recognized error travels.
  const registrationFailure = (error) => {
    if (error === ABANDONED) return abandoned();
    if (!(error instanceof RegistrationError)) throw error;
    return complete(closedEnvelope(error.code, error.message, error.retryable), true);
  };

  const send = async (method, path, body, headers, signal) => {
    const sent = await transmit(client, method, path, body, headers, signal);
    if (sent.error !== undefined) return localFailure(sent);
    return outcomeOf(sent.response);
  };

  // One creation per invocation, then that same invocation waits on the broker's bounded
  // poll; a pending receipt is not its result and no returned write is reported.
  async function requestApproval(args, signal) {
    if (waiting.has(args.request_handle)) return complete(CONFLICT, true);
    if (signal?.aborted === true) return abandoned();
    waiting.add(args.request_handle);
    try {
      const authority = await untilCancelled(registration.ensure(), signal);
      const capability = { [CAPABILITY_HEADER]: args.request_capability };
      const created = await transmit(
        client,
        'POST',
        '/v1/requests',
        creationBody(args),
        capability,
        signal,
      );
      if (created.error !== undefined) return localFailure(created);
      // Only the documented creation statuses carry a request, and only its complete
      // common view may be waited on. Any other success is unusable, never a generic
      // object result, and it neither waits nor repeats this creation.
      const { status } = created.response;
      const receipt =
        status === 201 || status === 200
          ? requestView(created.response.body, args.request_handle, null)
          : null;
      if (receipt === null) {
        return status >= 200 && status < 300 ? unusable() : outcomeOf(created.response);
      }
      // A terminal replay is this invocation's result now; a pending receipt is not.
      if (receipt.resolution !== 'pending') return complete(receipt, false);
      return await waitForDecision(args, receipt.request_id, authority, capability, signal);
    } catch (error) {
      return registrationFailure(error);
    } finally {
      waiting.delete(args.request_handle);
    }
  }

  async function waitForDecision(args, requestId, captured, capability, signal) {
    const path = `/v1/requests/${encodeURIComponent(requestId)}/wait`;
    let authority = captured;
    let retries = 0;
    for (;;) {
      // Closing fences new work: no exchange or delay starts after one ended.
      if (signal?.aborted === true || ordinary.signal.aborted) return abandoned();
      const body = { registration_id: authority.registration_id };
      const headers = { ...capability, [REGISTRATION_HEADER]: authority.registration_secret };
      const sent = await transmit(waitClient, 'POST', path, body, headers, signal);
      if (sent.error !== undefined) {
        if (sent.aborted) return abandoned();
        // Only transport loss delays a repeat: the captured identity and ladder stay.
        const lost =
          sent.error instanceof LocalRequestError && sent.error.code === 'BROKER_UNAVAILABLE';
        if (!lost) return localFailure(sent);
        const delay = WAIT_RETRY_DELAYS_MS[Math.min(retries, WAIT_RETRY_DELAYS_MS.length - 1)];
        retries += 1;
        if (!(await hold(delay, [signal, ordinary.signal]))) return abandoned();
        continue;
      }
      retries = 0;
      // Still pending: only this bounded exchange ended; this invocation repeats.
      if (sent.response.status === 204) continue;
      // The captured incarnation is gone; refresh shares the authenticated replacement.
      if (sent.response.status === 401) {
        authority = await untilCancelled(registration.refresh(authority), signal);
        continue;
      }
      const { status } = sent.response;
      // This poll is a result only as the complete terminal representation bound to the
      // originating handle and committed request. A pending or invented 200, and every
      // other success status, is unusable rather than a generic object result.
      if (status === 200) {
        const terminal = requestView(sent.response.body, args.request_handle, requestId);
        if (terminal !== null && terminal.resolution !== 'pending') {
          return complete(terminal, false);
        }
        return unusable();
      }
      if (status >= 200 && status < 300) return unusable();
      // A recognized conflict or failure ends this invocation: no re-creation, no
      // reconnected or transferred waiter.
      return outcomeOf(sent.response);
    }
  }

  // Admission precedes the first implemented operation and never the catalog:
  // initialize, discovery and invalid arguments reach no broker, while a duplicate
  // live owner surfaces as its own tool error without forwarding or mutating
  // anything.
  async function execute(name, args, context = {}) {
    const problem = argumentProblem(name, args);
    if (problem !== null) return invalid(problem);

    const signal = context?.signal ?? null;
    if (signal?.aborted === true) return abandoned();

    if (name === 'request_approval') return requestApproval(args, signal);

    try {
      await untilCancelled(registration.ensure(), signal);
    } catch (error) {
      return registrationFailure(error);
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
