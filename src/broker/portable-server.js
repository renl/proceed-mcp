// Portable broker loopback HTTP API (design sections 2-4). Every route requires
// a protected 256-bit Bearer credential read from the state directory; the
// control credential and the independent per-owner credentials authorize
// disjoint route groups, and an owner is derived from the presented credential,
// never from a body field or session metadata. Browser origins are refused
// before authentication, so no CORS allowance exists on any route. Only a
// completed durable reservation is acknowledged here: pairing and retry are
// honest temporary unavailability in this setup checkpoint (design section 3),
// and no request, wait or delivery route exists yet.
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

export const MAX_BODY_BYTES = 64 * 1024;

const PAIRING_UNAVAILABLE = 'pairing is not implemented in this setup checkpoint';
const RETRY_UNAVAILABLE = 'request retry is not implemented in this setup checkpoint';

const STORAGE_ENVELOPE = Object.freeze({
  schema_version: 1,
  error: {
    code: 'STORAGE_FAILURE',
    message: 'the broker could not complete the request',
    retryable: false,
  },
});

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

export function createPortableServer({ broker, credentials, port, logger = () => {} } = {}) {
  let ready = false;
  let server = null;

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

  const route = async (request, response, principal, url) => {
    const { pathname } = url;
    const segments = pathname.split('/').filter((segment) => segment !== '');
    const requestRoute =
      segments.length === 4 && segments[0] === 'v1' && segments[1] === 'requests';

    if (request.method === 'POST' && pathname === '/v1/handles') {
      if (requireRole(response, principal, 'owner')) await reserve(request, response, principal);
      return;
    }

    if (request.method === 'GET' && pathname === '/v1/status') {
      if (requireRole(response, principal, 'control')) send(response, 200, broker.status());
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
      if (server === null) return;
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    },
  };
}
