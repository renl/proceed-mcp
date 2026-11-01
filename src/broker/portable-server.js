// Portable broker loopback HTTP API (design sections 2-4). Every route requires
// a protected 256-bit Bearer credential read from the state directory; the
// control credential and the independent per-owner credentials authorize
// disjoint route groups, and an owner is derived from the presented credential,
// never from a body field or session metadata. Browser origins are refused
// before authentication, so no CORS allowance exists on any route. Creation and
// read act on the whole reviewed public request binding: caller fields are
// validated before authority, the credential-derived owner, the path identity and
// the header capability must name one committed reservation, and every failed
// binding is the same nondisclosing denial. Pairing and retry stay honest
// temporary unavailability (design section 3), and cancel/acknowledge verify
// authority only to deny because their producers are not enabled here. Adapter
// registration is an ephemeral reachability lease and never touches approval
// state.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  BrokerError,
  CliError,
  EXIT_CODE,
  authRequired,
  forbidden,
  invalidRequest,
  notFound,
  unavailable,
} from '../errors.js';
import { isPlainObject } from '../util/values.js';
import { createRegistrationRegistry } from './registration.js';

export const MAX_BODY_BYTES = 64 * 1024;

const PAIRING_UNAVAILABLE = 'pairing is not implemented in this setup checkpoint';
const RETRY_UNAVAILABLE = 'request retry is not implemented in this setup checkpoint';
const REQUEST_CAPABILITY_HEADER = 'x-proceed-request-capability';
const REGISTRATION_HEADER = 'x-proceed-registration';
// One denial for every rejected registration authentication: missing, malformed,
// wrong, foreign, unknown and expired all stay indistinguishable here.
const REGISTRATION_DENIAL = 'registration authentication required';
// One denial for every owner-bound request outcome that cannot be served: an
// unused reservation, an unknown request, and a missing, malformed, foreign or
// mismatched handle/capability must be indistinguishable here.
const RESERVED_DENIAL = 'no such request';
// Creation accepts exactly the reviewed caller fields; any other key is an
// argument error rather than a silently ignored private permission.
const CREATION_FIELDS = new Set([
  'request_handle',
  'client_request_id',
  'action',
  'context',
  'expires_in_seconds',
]);

const STORAGE_ENVELOPE = Object.freeze({
  schema_version: 1,
  error: {
    code: 'STORAGE_FAILURE',
    message: 'the broker could not complete the request',
    retryable: false,
  },
});

// Recognized management routes only. A different method, an extra segment or any
// other suffix stays an unknown route, so route recognition itself never passes
// for an authorized lookup.
function reservedRoute(method, segments) {
  if (segments.length !== 4 || method !== 'POST') return false;
  return segments[3] === 'cancel' || segments[3] === 'acknowledge';
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(left ?? '', 'utf8');
  const b = Buffer.from(right ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function send(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', String(Buffer.byteLength(payload)));
  response.end(payload);
}

// Lifecycle successes carry no representation at all.
function sendNoContent(response) {
  response.statusCode = 204;
  response.end();
}

// A validation or blocked-prerequisite message is safe to return; a storage
// failure may name protected paths, so its detail stays in the operator log.
function failure(error) {
  if (error instanceof BrokerError) return { status: error.status, body: error.toEnvelope() };
  if (error instanceof CliError) {
    if (error.exitCode === EXIT_CODE.STORAGE) return { status: 500, body: STORAGE_ENVELOPE };
    const status = error.exitCode === EXIT_CODE.INVALID ? 400 : 503;
    return {
      status,
      body: {
        schema_version: 1,
        error: { code: error.code, message: error.message, retryable: false },
      },
    };
  }
  return { status: 500, body: STORAGE_ENVELOPE };
}

// The whole body is drained so a rejected request still receives its response,
// while only the admitted prefix is retained in memory.
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) throw invalidRequest('request body exceeds 64 KiB of UTF-8 JSON');
  if (size === 0) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalidRequest('request body must be JSON');
  }
  if (!isPlainObject(value)) throw invalidRequest('request body must be a JSON object');
  return value;
}

export function createPortableServer({
  broker,
  credentials,
  port,
  clock = () => Date.now(),
  logger = () => {},
} = {}) {
  let ready = false;
  let server = null;
  // Registrations belong to this process, so the listener that admits them also
  // owns closing them.
  const registrations = createRegistrationRegistry({ clock, logger });

  const authorize = (request) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length);
    if (constantTimeEquals(token, credentials.control)) return { role: 'control' };
    for (const [ownerId, ownerToken] of credentials.owners) {
      if (constantTimeEquals(token, ownerToken)) return { role: 'owner', ownerId };
    }
    return null;
  };

  // Role separation is checked before any unavailable outcome, so a valid owner
  // credential never learns whether a control operation would be available.
  const requireRole = (response, principal, role) => {
    if (principal.role === role) return true;
    send(response, 403, forbidden('this credential cannot use that route').toEnvelope());
    return false;
  };

  const reserve = async (request, response, principal) => {
    const body = await readJsonBody(request);
    for (const key of Object.keys(body)) {
      if (key !== 'session_label') {
        throw invalidRequest('request body must contain only session_label');
      }
    }
    const reservation = await broker.reserveHandle({
      ownerId: principal.ownerId,
      sessionLabel: body.session_label,
    });
    send(response, 201, reservation);
  };

  const requestCapability = (request) => {
    const value = request.headers[REQUEST_CAPABILITY_HEADER];
    return typeof value === 'string' ? value : undefined;
  };

  const registrationSecret = (request) => {
    const value = request.headers[REGISTRATION_HEADER];
    return typeof value === 'string' ? value : undefined;
  };

  // Registration bodies carry no fields. This runs after the caller's identity
  // is established and, on heartbeat, before the lease can renew.
  const requireEmptyBody = (body) => {
    if (Object.keys(body).length > 0) throw invalidRequest('request body must contain no fields');
  };

  // Creates the ephemeral incarnation of the credential-derived owner. The body
  // is validated before admission, so a malformed create never collides.
  const registerAdapter = async (request, response, principal) => {
    const body = await readJsonBody(request);
    requireEmptyBody(body);
    send(response, 201, await registrations.register({ ownerId: principal.ownerId }));
  };

  // Parsing precedes registration authentication, so a malformed body is invalid
  // arguments while every rejected identifier or secret is the same denial.
  const heartbeatAdapter = async (request, response, principal, segments) => {
    const body = await readJsonBody(request);
    const identity = {
      ownerId: principal.ownerId,
      registrationId: segments[2],
      secret: registrationSecret(request),
    };
    if (!registrations.authenticate(identity)) throw authRequired(REGISTRATION_DENIAL);
    requireEmptyBody(body);
    if (!registrations.heartbeat(identity)) throw authRequired(REGISTRATION_DENIAL);
    sendNoContent(response);
  };

  // Release addresses the captured incarnation only; a stale one removes nothing.
  const releaseAdapter = (request, response, principal, segments) => {
    const released = registrations.release({
      ownerId: principal.ownerId,
      registrationId: segments[2],
      secret: registrationSecret(request),
    });
    if (!released) throw authRequired(REGISTRATION_DENIAL);
    sendNoContent(response);
  };

  // Creation binds the credential-derived owner, the caller-supplied handle and
  // the header capability to one committed reservation (design section 3). Caller
  // fields are validated by the creator before that binding, so a malformed value
  // stays a caller error even when its handle could never be used, and every
  // failed binding is the same denial rather than an existence disclosure.
  const createApproval = async (request, response, principal) => {
    const body = await readJsonBody(request);
    const unexpected = Object.keys(body).find((key) => !CREATION_FIELDS.has(key));
    if (unexpected !== undefined) {
      throw invalidRequest(`request body must not contain ${unexpected}`);
    }
    const created = await broker.createRequest({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestHandle: body.request_handle,
      clientRequestId: body.client_request_id,
      action: body.action,
      context: body.context,
      expiresInSeconds: body.expires_in_seconds,
    });
    // A usable reservation without a committed creation is never a success: it
    // maps to the same denial as unknown or foreign authority.
    if (created === null) throw notFound(RESERVED_DENIAL);
    send(response, created.created === true ? 201 : 200, created.request);
  };

  // Read is the one observation this cut enables. Only an authorized actual
  // request enters target expiry, and a denial returns before the queue, so a
  // rejected read cannot expire or append anything.
  const readApproval = async (request, response, principal, segments) => {
    const value = await broker.readRequest({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestId: segments[2],
    });
    if (value === null) throw notFound(RESERVED_DENIAL);
    send(response, 200, value);
  };

  // Cancellation and acknowledgement gain no success path here: the lookup still
  // binds the credential-derived owner, the exact path request ID and the header
  // capability together, and an absent route can never produce this denial.
  const reservedManagement = async (request, response, principal, segments) => {
    // Malformed input is reported before any lookup, so validation does not
    // depend on whether the named request exists.
    await readJsonBody(request);
    // The result is intentionally not used: these producers are not enabled, so
    // a valid capability and a wrong one deny identically.
    void broker.authorize({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestId: segments[2],
    });
    throw notFound(RESERVED_DENIAL);
  };

  const route = async (request, response, principal, url) => {
    const { pathname } = url;
    const segments = pathname.split('/').filter((segment) => segment !== '');
    const requestsPath = segments[0] === 'v1' && segments[1] === 'requests';
    const adapterPath = segments[0] === 'v1' && segments[1] === 'adapter';
    const requestRoute = requestsPath && segments.length === 4;

    // Route shape precedes the role check, so an unknown adapter path stays 404.
    if (adapterPath && request.method === 'POST' && segments.length === 2) {
      if (requireRole(response, principal, 'owner')) {
        await registerAdapter(request, response, principal);
      }
      return;
    }

    if (adapterPath && request.method === 'DELETE' && segments.length === 3) {
      if (requireRole(response, principal, 'owner')) {
        releaseAdapter(request, response, principal, segments);
      }
      return;
    }

    if (
      adapterPath &&
      request.method === 'POST' &&
      segments.length === 4 &&
      segments[3] === 'heartbeat'
    ) {
      if (requireRole(response, principal, 'owner')) {
        await heartbeatAdapter(request, response, principal, segments);
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/v1/handles') {
      if (requireRole(response, principal, 'owner')) await reserve(request, response, principal);
      return;
    }

    if (request.method === 'GET' && pathname === '/v1/status') {
      if (!requireRole(response, principal, 'control')) return;
      send(response, 200, await broker.status());
      return;
    }

    // Creation and read are separate shapes: the collection takes a POST and one
    // request path takes a GET, so neither method on the other shape is admitted.
    if (requestsPath && segments.length === 2 && request.method === 'POST') {
      if (requireRole(response, principal, 'owner')) {
        await createApproval(request, response, principal);
      }
      return;
    }

    if (requestsPath && segments.length === 3 && request.method === 'GET') {
      if (requireRole(response, principal, 'owner')) {
        await readApproval(request, response, principal, segments);
      }
      return;
    }

    if (requestsPath && reservedRoute(request.method, segments)) {
      if (requireRole(response, principal, 'owner')) {
        await reservedManagement(request, response, principal, segments);
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/v1/pairing') {
      if (!requireRole(response, principal, 'control')) return;
      await readJsonBody(request);
      throw unavailable(PAIRING_UNAVAILABLE, 'ENHANCEMENT_UNAVAILABLE', { retryable: false });
    }

    if (request.method === 'POST' && requestRoute && segments[3] === 'retry') {
      if (!requireRole(response, principal, 'control')) return;
      await readJsonBody(request);
      // Reported before any request lookup, so an unknown ID is not disclosed.
      throw unavailable(RETRY_UNAVAILABLE, 'ENHANCEMENT_UNAVAILABLE', { retryable: false });
    }

    throw notFound('no such broker route');
  };

  const handler = async (request, response) => {
    try {
      if (typeof request.headers.origin === 'string') {
        throw forbidden('browser origins cannot use the local broker API');
      }
      if (!ready) {
        throw unavailable('the broker is still recovering state', 'BROKER_NOT_READY', {
          retryable: true,
        });
      }
      const principal = authorize(request);
      if (principal === null) throw authRequired();
      await route(request, response, principal, new URL(request.url ?? '/', 'http://127.0.0.1'));
    } catch (error) {
      const { status, body } = failure(error);
      if (status >= 500) logger(`broker request failed: ${error?.code ?? 'UNEXPECTED'}`);
      if (!response.headersSent) send(response, status, body);
      else response.end();
    }
  };

  return {
    // Binds exactly the configured loopback port: the address is fixed, no
    // automatic port selection is attempted, and a busy port is a refusal.
    async listen() {
      server = createServer((request, response) => {
        handler(request, response);
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
      return { port, pid: process.pid };
    },
    markReady() {
      ready = true;
    },
    async close() {
      ready = false;
      // Closing the registry is terminal: no late completion may re-admit,
      // renew or release a registration once the listener stops.
      registrations.close();
      if (server === null) return;
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    },
  };
}
