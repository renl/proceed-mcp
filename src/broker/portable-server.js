// Portable broker loopback HTTP API (design sections 2-4). Every route requires
// a protected 256-bit Bearer credential read from the state directory; the
// control credential and the independent per-owner credentials authorize
// disjoint route groups, and an owner is derived from the presented credential,
// never from a body field or session metadata. Browser origins are refused
// before authentication, so no CORS allowance exists on any route. Only a
// completed durable reservation is acknowledged here: pairing and retry are
// honest temporary unavailability in this setup checkpoint (design section 3),
// and the reserved request routes verify authority only to deny, because a
// reservation is not yet an actionable request. Adapter registration is an
// ephemeral reachability lease here and never touches approval state.
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
// One denial for every reserved outcome: an unknown request, a reservation with
// no committed approval, and a missing, malformed, foreign or mismatched
// capability must be indistinguishable here.
const RESERVED_DENIAL = 'no such request';

const STORAGE_ENVELOPE = Object.freeze({
  schema_version: 1,
  error: {
    code: 'STORAGE_FAILURE',
    message: 'the broker could not complete the request',
    retryable: false,
  },
});

// Recognized reserved routes only. A different method, an extra segment or any
// other suffix stays an unknown route, so route recognition itself never passes
// for an authorized lookup.
function reservedRoute(method, segments) {
  if (segments.length === 3 && method === 'GET') return 'read';
  if (segments.length !== 4 || method !== 'POST') return null;
  if (segments[3] === 'cancel' || segments[3] === 'acknowledge') return segments[3];
  return null;
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

  // A reserved handle has no committed approval, so nothing is readable yet and
  // every owner outcome below is the same nondisclosing denial. The lookup still
  // runs, binding the credential-derived owner, the exact path request ID and the
  // header capability together; an absent route can never produce this denial.
  const reserved = async (request, response, principal, segments) => {
    if (!requireRole(response, principal, 'owner')) return;
    // Malformed input is reported before any lookup, so validation does not
    // depend on whether the named request exists.
    if (request.method === 'POST') await readJsonBody(request);
    // The result is intentionally not used: a reservation has no committed
    // approval, so a valid capability and a wrong one deny identically here.
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
      if (requireRole(response, principal, 'control')) send(response, 200, broker.status());
      return;
    }

    if (requestsPath && reservedRoute(request.method, segments) !== null) {
      await reserved(request, response, principal, segments);
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
