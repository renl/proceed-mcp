// The broker's authenticated loopback HTTP API (design section 3). Every route
// requires a Bearer credential from a protected state file; the control
// credential and per-origin credentials authorize disjoint route groups.
// Responses are written only after the durable commit that backs them.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { BrokerError } from '../errors.js';

export const MAX_BODY_BYTES = 64 * 1024;

function constantTimeEquals(left, right) {
  const a = Buffer.from(left ?? '', 'utf8');
  const b = Buffer.from(right ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function send(response, status, body) {
  const payload = body === undefined ? '' : `${JSON.stringify(body)}\n`;
  response.statusCode = status;
  if (payload !== '') {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('content-length', String(Buffer.byteLength(payload)));
  }
  response.end(payload);
}

function errorBody(error) {
  if (error instanceof BrokerError) return { status: error.status, body: error.toEnvelope() };
  return {
    status: 500,
    body: {
      schema_version: 1,
      error: {
        code: 'STORAGE_FAILURE',
        message: 'the broker could not complete the request',
        retryable: false,
      },
    },
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new BrokerError('INVALID_ARGUMENT', 400, 'request body exceeds 64 KiB');
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new BrokerError('INVALID_ARGUMENT', 400, 'request body must be JSON');
  }
}

export function createBrokerServer({ broker, credentials, port, logger = () => {} }) {
  let ready = false;
  let server = null;

  const authorize = (request) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length);
    if (constantTimeEquals(token, credentials.control)) return { role: 'control' };
    for (const [originId, credential] of credentials.origins) {
      if (constantTimeEquals(token, credential)) return { role: 'origin', originId };
    }
    return null;
  };

  const requireRole = (response, principal, role) => {
    if (principal.role !== role) {
      send(response, 401, { schema_version: 1 });
      return false;
    }
    return true;
  };

  const rejectUnknownQuery = (response, url, allowed) => {
    for (const key of url.searchParams.keys()) {
      if (!allowed.includes(key)) {
        send(response, 400, {
          schema_version: 1,
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'unsupported query parameters',
            retryable: false,
          },
        });
        return false;
      }
    }
    return true;
  };

  const route = async (request, response, principal, url) => {
    const { pathname } = url;
    const segments = pathname.split('/').filter((segment) => segment !== '');

    if (request.method === 'POST' && pathname === '/v1/requests') {
      if (!requireRole(response, principal, 'origin')) return;
      if (!rejectUnknownQuery(response, url, [])) return;
      const body = await readJsonBody(request);
      const result = await broker.createRequest(principal.originId, body);
      return send(response, result.status, result.request);
    }

    if (segments.length >= 3 && segments[0] === 'v1' && segments[1] === 'requests') {
      const requestId = segments[2];
      const tail = segments[3];

      if (request.method === 'GET' && tail === undefined) {
        if (!requireRole(response, principal, 'origin')) return;
        if (!rejectUnknownQuery(response, url, ['session_id'])) return;
        const view = await broker.readRequest(requestId, url.searchParams.get('session_id'));
        return send(response, 200, view);
      }

      if (request.method === 'POST' && tail === 'cancel') {
        if (!requireRole(response, principal, 'origin')) return;
        if (!rejectUnknownQuery(response, url, [])) return;
        const body = await readJsonBody(request);
        const view = await broker.cancelRequest(requestId, body.session_id);
        return send(response, 200, view);
      }

      if (request.method === 'POST' && tail === 'retry') {
        if (!requireRole(response, principal, 'control')) return;
        if (!rejectUnknownQuery(response, url, [])) return;
        const result = await broker.retryRequest(requestId);
        return send(response, result.status, result.request);
      }
    }

    if (request.method === 'POST' && pathname === '/v1/pairing') {
      if (!requireRole(response, principal, 'control')) return;
      if (!rejectUnknownQuery(response, url, [])) return;
      await readJsonBody(request);
      const challenge = await broker.createPairingChallenge();
      return send(response, 201, challenge);
    }

    if (request.method === 'GET' && pathname === '/v1/status') {
      if (!requireRole(response, principal, 'control')) return;
      if (!rejectUnknownQuery(response, url, [])) return;
      return send(response, 200, broker.status());
    }

    return send(response, 404, { schema_version: 1 });
  };

  const handler = async (request, response) => {
    try {
      if (typeof request.headers.origin === 'string') {
        send(response, 401, { schema_version: 1 });
        return;
      }
      if (!ready) {
        send(response, 503, {
          schema_version: 1,
          error: {
            code: 'BROKER_NOT_READY',
            message: 'the broker is still recovering state',
            retryable: true,
          },
        });
        return;
      }
      const principal = authorize(request);
      if (principal === null) {
        send(response, 401, { schema_version: 1 });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      await route(request, response, principal, url);
    } catch (error) {
      const { status, body } = errorBody(error);
      if (status === 500) logger('broker request failed; see status diagnostics');
      if (!response.headersSent) send(response, status, body);
      else response.end();
    }
  };

  return {
    // Binds the configured loopback port. Exclusive ownership of this port is
    // what prevents a second broker from sharing the state directory.
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
      await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}
