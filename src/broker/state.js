// Replayed broker state and the durable mutation vocabulary (design section 4).
//
// Every mutation below is a complete, self-describing operation: replay applies
// the same values the writer committed, never a value recomputed from the
// current clock or environment. The journal stores transactions, not a snapshot.
import { storageFailure } from '../errors.js';
import { isPlainObject } from '../util/values.js';

export const HUMAN_RESOLUTIONS = new Set(['approved', 'rejected', 'responded']);
export const TERMINAL_RESOLUTIONS = new Set([
  'approved',
  'rejected',
  'responded',
  'expired',
  'cancelled',
]);

export function createBrokerState() {
  return {
    pairing: null,
    challenges: new Map(),
    requests: new Map(),
    idempotency: new Map(),
    outbox: new Map(),
    lastUpdateId: null,
  };
}

export function idempotencyKey({ originId, sessionId, clientRequestId }) {
  return `${originId}\u0000${sessionId}\u0000${clientRequestId}`;
}

function integrity(message) {
  return storageFailure(`journal replay failed: ${message}`, 'JOURNAL_STATE_INVALID');
}

function requireRequest(state, requestId) {
  const request = state.requests.get(requestId);
  if (request === undefined) throw integrity(`mutation targets unknown request ${requestId}`);
  return request;
}

export function applyMutations(state, mutations) {
  for (const mutation of mutations) {
    if (!isPlainObject(mutation) || typeof mutation.op !== 'string') {
      throw integrity('mutation is not a tagged object');
    }
    applyMutation(state, mutation);
  }
  return state;
}

function applyMutation(state, mutation) {
  switch (mutation.op) {
    case 'pairing.set': {
      const { pairing } = mutation;
      if (!isPlainObject(pairing) || typeof pairing.user_id !== 'string') {
        throw integrity('pairing.set requires a pairing record');
      }
      state.pairing = {
        user_id: pairing.user_id,
        chat_id: pairing.chat_id,
        paired_at: pairing.paired_at,
      };
      return;
    }
    case 'pairing.challenge': {
      const { hash, created_at: createdAt, expires_at: expiresAt } = mutation;
      if (typeof hash !== 'string') {
        throw integrity('pairing.challenge requires a hash');
      }
      state.challenges.set(hash, {
        hash,
        created_at: createdAt,
        expires_at: expiresAt,
        consumed_at: null,
      });
      return;
    }
    case 'pairing.challenge.consume': {
      const challenge = state.challenges.get(mutation.hash);
      if (challenge === undefined)
        throw integrity('pairing.challenge.consume targets an unknown challenge');
      challenge.consumed_at = mutation.consumed_at;
      return;
    }
    case 'request.create': {
      const { request } = mutation;
      if (!isPlainObject(request) || typeof request.request_id !== 'string') {
        throw integrity('request.create requires a request record');
      }
      if (state.requests.has(request.request_id)) {
        throw integrity(`request.create repeats ${request.request_id}`);
      }
      state.requests.set(request.request_id, structuredClone(request));
      state.idempotency.set(
        idempotencyKey({
          originId: request.origin_id,
          sessionId: request.session_id,
          clientRequestId: request.client_request_id,
        }),
        request.request_id,
      );
      return;
    }
    case 'request.presentation': {
      const request = requireRequest(state, mutation.request_id);
      if (!isPlainObject(mutation.presentation)) {
        throw integrity('request.presentation requires a presentation record');
      }
      request.presentation = structuredClone(mutation.presentation);
      if (mutation.telegram_state !== undefined) request.telegram_state = mutation.telegram_state;
      return;
    }
    case 'request.resolve': {
      const request = requireRequest(state, mutation.request_id);
      if (request.resolution !== 'pending') {
        throw integrity(`request.resolve repeats a resolution for ${mutation.request_id}`);
      }
      if (!TERMINAL_RESOLUTIONS.has(mutation.resolution)) {
        throw integrity(`request.resolve has unsupported resolution ${mutation.resolution}`);
      }
      request.resolution = mutation.resolution;
      request.resolved_at = mutation.resolved_at;
      request.decided_by = mutation.decided_by ?? null;
      request.source_update_id = mutation.source_update_id ?? null;
      request.response_text = mutation.response_text ?? null;
      if (mutation.outbox === null || mutation.outbox === undefined) {
        request.delivery_state = 'not_applicable';
        return;
      }
      if (!HUMAN_RESOLUTIONS.has(mutation.resolution)) {
        throw integrity('only human resolutions may create a delivery outbox');
      }
      state.outbox.set(mutation.request_id, structuredClone(mutation.outbox));
      request.delivery_state = 'pending';
      return;
    }
    case 'request.delivery': {
      const request = requireRequest(state, mutation.request_id);
      const outbox = state.outbox.get(mutation.request_id);
      if (outbox === undefined)
        throw integrity('request.delivery targets a request without an outbox');
      request.delivery_state = mutation.delivery_state;
      request.delivery_error = mutation.delivery_error ?? null;
      Object.assign(outbox, structuredClone(mutation.outbox));
      return;
    }
    case 'request.telegram': {
      const request = requireRequest(state, mutation.request_id);
      request.telegram_state = mutation.telegram_state;
      return;
    }
    case 'telegram.cursor': {
      if (!Number.isInteger(mutation.last_update_id) || mutation.last_update_id < 0) {
        throw integrity('telegram.cursor requires a non-negative update id');
      }
      state.lastUpdateId = mutation.last_update_id;
      return;
    }
    default:
      throw integrity(`unknown mutation op ${JSON.stringify(mutation.op)}`);
  }
}

// The public request representation of design section 3. Fields are fixed: the
// same object is returned by creation, owned reads and the MCP receipt.
export function requestView(request) {
  return {
    schema_version: 1,
    request_id: request.request_id,
    client_request_id: request.client_request_id,
    origin_id: request.origin_id,
    session_id: request.session_id,
    session_label: request.session_label,
    action: request.action,
    context: request.context,
    created_at: request.created_at,
    expires_at: request.expires_at,
    resolution: request.resolution,
    resolved_at: request.resolved_at,
    response_text: request.response_text,
    telegram_state: request.telegram_state,
    delivery_state: request.delivery_state,
    delivery_error: request.delivery_error,
  };
}

export function outboxFor(state, requestId) {
  return state.outbox.get(requestId) ?? null;
}

// Requests whose resolution is a human decision and whose delivery is still
// being reconciled. The delivery worker owns the ordering per request.
export function deliveryCandidates(state) {
  const candidates = [];
  for (const request of state.requests.values()) {
    if (!HUMAN_RESOLUTIONS.has(request.resolution)) continue;
    if (request.delivery_state !== 'pending' && request.delivery_state !== 'admitted') continue;
    candidates.push(request);
  }
  return candidates;
}

export function pendingRequests(state) {
  return [...state.requests.values()].filter((request) => request.resolution === 'pending');
}
