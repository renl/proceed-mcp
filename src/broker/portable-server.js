// Portable broker loopback HTTP API (design sections 2-4). Every route requires
// a protected 256-bit Bearer credential read from the state directory; the
// control credential and the independent per-owner credentials authorize
// disjoint route groups, and an owner is derived from the presented credential,
// never from a body field or session metadata. Browser origins are refused
// before authentication, so no CORS allowance exists on any route. Creation and
// read act on the whole reviewed public request binding: caller fields are
// validated before authority, the credential-derived owner, the path identity and
// the header capability must name one committed reservation, and every failed
// binding is the same nondisclosing denial. Cancellation resolves the same
// authorized request. Acknowledgement records capability-holder receipt, and
// returned records an authenticated adapter's report of its own successful
// terminal-result write; both are ledger evidence that resolves nothing, and
// returned additionally requires the live registration it renews only after the
// whole operation succeeds. A wait holds one request's attachment across a bounded
// turnover without holding the serialized turn, and only an attached settlement of
// the still-current registration renews it. Pairing issuance is the one control
// operation this cut enables; retry stays honest temporary unavailability (design
// section 3). Adapter registration is an ephemeral reachability lease and never
// touches approval state.
import { createServer } from 'node:http';
import { constants, timingSafeEqual } from 'node:crypto';
import tls from 'node:tls';
import {
  BrokerError,
  CliError,
  EXIT_CODE,
  authRequired,
  conflict,
  forbidden,
  invalidRequest,
  notFound,
  unavailable,
} from '../errors.js';
import { DECISION_ID_PATTERN, isPlainObject } from '../util/values.js';
import { createRegistrationRegistry } from './registration.js';

export const MAX_BODY_BYTES = 64 * 1024;

// The fixed public selector and the sole authorized negotiation profile of the
// per-instance confidential local channel (design section 4).
export const LOCAL_CHANNEL_IDENTITY = 'proceed-mcp-local-v1';
export const LOCAL_CHANNEL_CIPHER = 'PSK-AES256-GCM-SHA384';
const INSTANCE_PATTERN = /^[a-f0-9]{32}$/;
const LIFECYCLE_VERSION = 1;
const LIFECYCLE_SERVICE = 'proceed-mcp';

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
// The two evidence routes accept exactly their reviewed caller fields. The
// decision identity stays a raw string, so a near-miss is a caller error rather
// than a coerced lookup, and a capability in the body is never admitted.
const ACKNOWLEDGEMENT_FIELDS = new Set(['decision_id']);
const RETURNED_FIELDS = new Set(['registration_id', 'decision_id']);
// The wait body is exactly the captured incarnation; the request target stays in
// the path identity and the capability header.
const WAIT_FIELDS = new Set(['registration_id']);

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
  secure = null,
  lifecycle = null,
} = {}) {
  let ready = false;
  let closing = false;
  let draining = false;
  let stoppingInstance = null;
  let server = null;
  let parser = null;
  // Registrations belong to this process, so the listener that admits them also
  // owns closing them.
  const registrations = createRegistrationRegistry({ clock, logger });
  // One entry per open wait exchange: shutdown detaches exactly these, never an
  // admitted ordinary request whose committed result is still being written.
  const waitExchanges = new Set();

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

  // Cancellation is registration-free: it acts on the same owner-plus-capability
  // binding as read and needs no live adapter, so a detached principal may still
  // close its own pending request. An unused reservation and an unauthorized
  // request are the same denial.
  const cancelApproval = async (request, response, principal, segments) => {
    const body = await readJsonBody(request);
    requireEmptyBody(body);
    const value = await broker.cancelRequest({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestId: segments[2],
    });
    if (value === null) throw notFound(RESERVED_DENIAL);
    send(response, 200, value);
  };

  // An evidence body is exactly the reviewed caller fields; anything else is a
  // caller error rather than an ignored private permission.
  const rejectUnlistedFields = (body, fields) => {
    const unexpected = Object.keys(body).find((key) => !fields.has(key));
    if (unexpected !== undefined) {
      throw invalidRequest(`request body must not contain ${unexpected}`);
    }
  };

  // The decision identity is the raw documented encoding; a number, an array or
  // any other near-miss is invalid arguments, never a coerced comparison.
  const requireDecisionId = (value) => {
    if (typeof value !== 'string' || !DECISION_ID_PATTERN.test(value)) {
      throw invalidRequest('decision_id must be dec_ plus 32 lowercase hexadecimal characters');
    }
  };

  // Acknowledgement needs no registration: it binds the same credential-derived
  // owner, path identity and header capability as a read, and an irrelevant
  // registration header grants no authority here. The body is settled before
  // that lookup, so malformed input never depends on whether the target exists,
  // and the broker answers a pending or mismatched decision without sampling
  // time, expiring, allocating an identity or appending.
  const acknowledgeApproval = async (request, response, principal, segments) => {
    const body = await readJsonBody(request);
    rejectUnlistedFields(body, ACKNOWLEDGEMENT_FIELDS);
    requireDecisionId(body.decision_id);
    const value = await broker.acknowledgeRequest({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestId: segments[2],
      decisionId: body.decision_id,
    });
    if (value === null) throw notFound(RESERVED_DENIAL);
    send(response, 200, value);
  };

  // Returned is the one registration-bound evidence route, so the authenticated
  // incarnation is admitted before the remaining fields and a rejected
  // registration keeps its own denial even when those fields are also invalid.
  // Renewal is the last step and never conditions committed evidence: an expired
  // or replaced incarnation stays denied instead of reviving, and a false
  // renewal cannot undo or fail a report whose write already completed.
  const returnedApproval = async (request, response, principal, segments) => {
    const body = await readJsonBody(request);
    const identity = {
      ownerId: principal.ownerId,
      registrationId: body.registration_id,
      secret: registrationSecret(request),
    };
    if (!registrations.authenticate(identity)) throw authRequired(REGISTRATION_DENIAL);
    rejectUnlistedFields(body, RETURNED_FIELDS);
    requireDecisionId(body.decision_id);
    const value = await broker.returnedRequest({
      ownerId: principal.ownerId,
      capability: requestCapability(request),
      requestId: segments[2],
      decisionId: body.decision_id,
    });
    if (value === null) throw notFound(RESERVED_DENIAL);
    registrations.heartbeat(identity);
    send(response, 200, value);
  };

  // The wait is the one exchange that stays open (design sections 3 and 7, G1-G3).
  // The captured incarnation is authenticated before the remaining fields, its
  // current validity guides the terminal writer's delivery selection and the
  // settlement recheck, and a gone transport or closing listener leaves no reply:
  // no fabricated `200`/`204`, no renewal, no business cancellation.
  const waitApproval = async (request, response, principal, segments) => {
    const body = await readJsonBody(request);
    const identity = {
      ownerId: principal.ownerId,
      registrationId: body.registration_id,
      secret: registrationSecret(request),
    };
    if (!registrations.authenticate(identity)) throw authRequired(REGISTRATION_DENIAL);
    rejectUnlistedFields(body, WAIT_FIELDS);
    const exchange = { controller: new AbortController() };
    const detached = () => exchange.controller.abort();
    waitExchanges.add(exchange);
    response.once('close', detached);
    try {
      const value = await broker.waitRequest({
        ownerId: principal.ownerId,
        capability: requestCapability(request),
        requestId: segments[2],
        signal: exchange.controller.signal,
        registration: { valid: () => registrations.authenticate(identity) },
      });
      if (value === null) throw notFound(RESERVED_DENIAL);
      if (value.state === 'detached' || exchange.controller.signal.aborted) {
        response.destroy();
        return;
      }
      // Only an attached settlement of a still-current incarnation renews, and a
      // lapsed or replaced one keeps the existing denial instead of reviving.
      if (!registrations.authenticate(identity)) throw authRequired(REGISTRATION_DENIAL);
      if (value.state === 'conflict') {
        throw conflict('this request already has an active waiter', 'WAIT_ALREADY_ACTIVE');
      }
      registrations.heartbeat(identity);
      if (value.state === 'pending') sendNoContent(response);
      else send(response, 200, value.request);
    } finally {
      waitExchanges.delete(exchange);
      response.off('close', detached);
    }
  };

  // Authenticated readiness (design section 4). The payload is exactly the
  // documented lifecycle envelope and is published only after the caller proves
  // the secure channel and a local credential; `local_ready` describes the local
  // broker alone, never Telegram availability or human receipt.
  const readyRoute = (response) => {
    const health = lifecycle.health();
    if (health !== null) {
      send(response, 503, {
        schema_version: 1,
        error: {
          code: health,
          message: 'the broker cannot confirm local readiness',
          retryable: false,
        },
      });
      return;
    }
    if (!ready) {
      send(
        response,
        503,
        unavailable('the broker is still recovering state', 'BROKER_NOT_READY', {
          retryable: true,
        }).toEnvelope(),
      );
      return;
    }
    send(response, 200, {
      schema_version: 1,
      service: LIFECYCLE_SERVICE,
      lifecycle_version: LIFECYCLE_VERSION,
      instance: lifecycle.instance,
      pid: process.pid,
      port,
      local_ready: true,
      paired: lifecycle.paired() === true,
      telegram: lifecycle.telegram(),
    });
  };

  // Control-only graceful stop (design section 6). New admission is fenced before
  // the 202 is acknowledged, the exact acquired instance must match, and the same
  // stopping instance stays idempotent while this endpoint can still answer.
  const shutdownRoute = async (request, response) => {
    const body = await readJsonBody(request);
    const keys = Object.keys(body);
    if (
      keys.length !== 1 ||
      keys[0] !== 'instance' ||
      typeof body.instance !== 'string' ||
      !INSTANCE_PATTERN.test(body.instance)
    ) {
      throw invalidRequest('the shutdown body must be exactly {instance}');
    }
    if (body.instance !== lifecycle.instance) {
      throw conflict('the broker instance does not match', 'BROKER_INSTANCE_CONFLICT');
    }
    closing = true;
    stoppingInstance = lifecycle.instance;
    ready = false;
    send(response, 202, {
      schema_version: 1,
      instance: lifecycle.instance,
      stopping: true,
    });
    // Drain starts only after the accepted response is written; the caller's 202
    // means stop accepted, not complete.
    setImmediate(() => {
      try {
        lifecycle.onShutdown();
      } catch (error) {
        logger(`broker stop was not requested: ${error?.code ?? 'UNEXPECTED'}`);
      }
    });
  };

  const route = async (request, response, principal, url) => {
    const { pathname } = url;
    const segments = pathname.split('/').filter((segment) => segment !== '');
    const requestsPath = segments[0] === 'v1' && segments[1] === 'requests';
    const adapterPath = segments[0] === 'v1' && segments[1] === 'adapter';
    const requestRoute = requestsPath && segments.length === 4;

    // Authenticated lifecycle routes exist only on the secure listener: legacy
    // foreground HTTP gains no route that could invite a secure caller to
    // downgrade. Both are admitted before the business routes.
    if (secure !== null && pathname === '/v1/ready' && request.method === 'GET') {
      readyRoute(response);
      return;
    }

    if (secure !== null && pathname === '/v1/shutdown' && request.method === 'POST') {
      if (!requireRole(response, principal, 'control')) return;
      await shutdownRoute(request, response);
      return;
    }

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

    // The three recognized management shapes on one request path: any other
    // method or suffix falls through to the unknown-route refusal.
    if (requestsPath && segments.length === 4 && request.method === 'POST') {
      if (segments[3] === 'cancel') {
        if (requireRole(response, principal, 'owner')) {
          await cancelApproval(request, response, principal, segments);
        }
        return;
      }
      if (segments[3] === 'acknowledge') {
        if (requireRole(response, principal, 'owner')) {
          await acknowledgeApproval(request, response, principal, segments);
        }
        return;
      }
      if (segments[3] === 'returned') {
        if (requireRole(response, principal, 'owner')) {
          await returnedApproval(request, response, principal, segments);
        }
        return;
      }
      if (segments[3] === 'wait') {
        if (requireRole(response, principal, 'owner')) {
          await waitApproval(request, response, principal, segments);
        }
        return;
      }
    }

    // Pairing issuance is a control setup operation, not an approval outcome: the
    // body is settled before the serialized turn, and the challenge is returned
    // only after its committed append, so no code exists ahead of durable history.
    if (request.method === 'POST' && pathname === '/v1/pairing') {
      if (!requireRole(response, principal, 'control')) return;
      const body = await readJsonBody(request);
      requireEmptyBody(body);
      send(response, 201, await broker.pairingChallenge());
      return;
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
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const lifecycleRoute =
        secure !== null && (url.pathname === '/v1/ready' || url.pathname === '/v1/shutdown');
      // The legacy listener keeps its original ordering; the secure listener
      // authenticates before reporting either readiness outcome.
      if (secure === null && !ready) {
        throw unavailable('the broker is still recovering state', 'BROKER_NOT_READY', {
          retryable: true,
        });
      }
      const principal = authorize(request);
      if (principal === null) throw authRequired();
      if (secure !== null && !ready && !(stoppingInstance !== null && lifecycleRoute)) {
        throw unavailable('the broker is still recovering state', 'BROKER_NOT_READY', {
          retryable: true,
        });
      }
      await route(request, response, principal, url);
    } catch (error) {
      const { status, body } = failure(error);
      if (status >= 500) logger(`broker request failed: ${error?.code ?? 'UNEXPECTED'}`);
      if (!response.headersSent) send(response, status, body);
      else response.end();
    }
  };

  const onRequest = (request, response) => {
    // A completed ordinary exchange must not keep its now-idle keep-alive
    // socket open once the listener is closing: only idle transports are
    // released, so an in-flight request is still drained by its own response.
    response.on('finish', () => {
      if (closing) setImmediate(() => parser?.closeIdleConnections?.());
    });
    handler(request, response);
  };

  // The secure listener serves the same HTTP application inside one TLS 1.2
  // PSK-only channel. The server admits a connection only after the expected key
  // callback and exact negotiated profile; a completed handshake is the
  // admission oracle, not the client-certificate `authorized` flag.
  const buildServer = () => {
    if (secure === null) {
      parser = createServer(onRequest);
      return parser;
    }
    parser = createServer(onRequest);
    const instance = tls.createServer(
      {
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        ciphers: LOCAL_CHANNEL_CIPHER,
        secureOptions: constants.SSL_OP_NO_TICKET,
        requestCert: false,
        handshakeTimeout: 1000,
        pskCallback: (_socket, selected) =>
          selected === LOCAL_CHANNEL_IDENTITY ? secure.key : null,
      },
      (socket) => {
        if (
          socket.getProtocol() !== 'TLSv1.2' ||
          socket.getCipher()?.name !== LOCAL_CHANNEL_CIPHER ||
          socket.isSessionReused()
        ) {
          socket.destroy();
          return;
        }
        socket.disableRenegotiation();
        socket.on('error', () => {});
        parser.emit('connection', socket);
      },
    );
    instance.on('tlsClientError', () => {});
    return instance;
  };

  return {
    // Binds exactly the configured loopback port: the address is fixed, no
    // automatic port selection is attempted, and a busy port is a refusal.
    async listen() {
      server = buildServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
      return { port, pid: process.pid };
    },
    markReady() {
      ready = true;
    },
    // Withdraw local readiness and fence new business admission while the listener
    // stays up, so authenticated control can still observe the draining instance
    // and idempotently match an accepted stop (design section 6). Only the final
    // close releases the listener itself.
    beginDrain() {
      if (draining) return;
      draining = true;
      ready = false;
      closing = true;
      registrations.close();
      for (const exchange of [...waitExchanges]) exchange.controller.abort();
    },
    async close() {
      ready = false;
      closing = true;
      // Closing the registry is terminal: no late completion may re-admit,
      // renew or release a registration once the listener stops.
      registrations.close();
      // Detach only live wait exchanges: their transports are destroyed to settle
      // them without waiting for a poll turnover, while every already-admitted
      // ordinary operation keeps its flush and committed-result response.
      for (const exchange of [...waitExchanges]) exchange.controller.abort();
      if (server === null) return;
      parser?.closeIdleConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    },
  };
}
