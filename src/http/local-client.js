// Minimal local HTTP client for the public CLI and the stdio MCP adapter. It
// speaks only to the configured loopback broker port with a protected local
// credential and never follows a redirect or consults a proxy. A caller may add
// route-specific authority headers, such as a request capability, but never
// replace the protected transport credential.
//
// Secure local mode admits every connection over the per-instance TLS-PSK
// channel in design section 4 before any HTTP authority is sent. The key comes
// only from the stable protected ownership record, the negotiated profile and
// client authorization are required, and the record is compared again before the
// Authorization header and after a readiness response.
import { constants } from 'node:crypto';
import http from 'node:http';
import tls from 'node:tls';
import { readSecureOwnership } from '../state/ownership.js';

export class LocalRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalRequestError';
    this.code = code;
  }
}

// A failed secure admission is not an ordinary transport error: the caller must
// distinguish a not-yet-listening broker from an endpoint that cannot prove the
// expected channel.
export class SecureChannelError extends LocalRequestError {
  constructor(code, message) {
    super(code, message);
    this.name = 'SecureChannelError';
  }
}

export const LOCAL_CHANNEL_IDENTITY = 'proceed-mcp-local-v1';
export const LOCAL_CHANNEL_PROTOCOL = 'TLSv1.2';
export const LOCAL_CHANNEL_CIPHER = 'PSK-AES256-GCM-SHA384';
export const LOCAL_HANDSHAKE_TIMEOUT_MS = 1000;
export const LOCAL_LIFECYCLE_BYTES = 16384;

export const LOCAL_REQUEST_TIMEOUT_MS = 10_000;

// A waiting exchange outlives the broker's bounded poll turnover, so it has its own deadline.
export const LOCAL_WAIT_TIMEOUT_MS = 32_000;

export function createLocalClient({ port, token, timeoutMs = LOCAL_REQUEST_TIMEOUT_MS }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LocalRequestError('BROKER_UNAVAILABLE', 'the configured broker port is not usable');
  }
  if (typeof token !== 'string' || token === '') {
    throw new LocalRequestError('CREDENTIAL_UNAVAILABLE', 'a local credential is missing');
  }

  return {
    request(method, path, body, extraHeaders = {}, options = {}) {
      return new Promise((resolve, reject) => {
        // A signal that is already aborted must not open anything at all: the
        // caller cancelled before the exchange existed.
        const signal = options?.signal;
        if (signal?.aborted === true) {
          reject(new LocalRequestError('BROKER_UNAVAILABLE', 'the local request was cancelled'));
          return;
        }
        if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
          reject(new LocalRequestError('INVALID_REQUEST', 'local request path must be absolute'));
          return;
        }
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
        const headers = {
          ...extraHeaders,
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        };
        if (bytes !== undefined) {
          headers['content-type'] = 'application/json';
          headers['content-length'] = String(bytes.length);
        }

        let settled = false;
        let request = null;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (signal !== undefined && signal !== null) signal.removeEventListener('abort', cancel);
          if (error) reject(error);
          else resolve(value);
        };
        // Abort is transport cancellation: it destroys the live request and its
        // socket, so a stalled exchange cannot outlive the caller's decision and
        // no promise timeout has to stand in for real teardown.
        const cancel = () => {
          if (settled) return;
          request?.destroy();
          finish(new LocalRequestError('BROKER_UNAVAILABLE', 'the local request was cancelled'));
        };

        // The address is built as one fixed loopback URL: no configured hostname,
        // redirect or environment proxy can redirect this call elsewhere.
        const address = new URL(`http://127.0.0.1:${port}${path}`);
        request = http.request(address, { method, headers, agent: false }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', () =>
            finish(new LocalRequestError('BROKER_UNAVAILABLE', 'the broker connection failed')),
          );
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            if (text !== '') {
              try {
                parsed = JSON.parse(text);
              } catch {
                finish(
                  new LocalRequestError(
                    'BROKER_RESPONSE_INVALID',
                    'the broker returned an unreadable response',
                  ),
                );
                return;
              }
            }
            finish(null, { status: response.statusCode, body: parsed });
          });
        });
        // Registered after the request exists, so an abort can always destroy a
        // real transport, and detached on every settlement so a caller's signal
        // never accumulates listeners.
        if (signal !== undefined && signal !== null) {
          signal.addEventListener('abort', cancel, { once: true });
        }

        request.setTimeout(timeoutMs, () => {
          request.destroy();
          finish(new LocalRequestError('BROKER_UNAVAILABLE', 'the broker did not answer in time'));
        });
        request.on('error', () =>
          finish(new LocalRequestError('BROKER_UNAVAILABLE', 'the broker is not reachable')),
        );
        request.end(bytes);
      });
    },
  };
}

function unavailableChannel(message) {
  return new SecureChannelError('BROKER_UNAVAILABLE', message);
}

function conflictingChannel(message) {
  return new SecureChannelError('BROKER_INSTANCE_CONFLICT', message);
}

// A connection that never reached TCP is one the broker has not started yet; an
// established connection that cannot complete the expected handshake is an
// endpoint this product cannot authenticate.
function handshakeFailure(error, tcpConnected) {
  const code = error?.code;
  if (
    !tcpConnected &&
    (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
  ) {
    return unavailableChannel('the broker is not reachable');
  }
  return conflictingChannel('the listener could not prove the expected secure channel');
}

function profileProblem(socket) {
  if (socket.authorized !== true) return 'the secure channel was not authorized';
  if (socket.authorizationError) return 'the secure channel reported a verification error';
  if (socket.getProtocol() !== LOCAL_CHANNEL_PROTOCOL) return 'the negotiated TLS version differs';
  if (socket.getCipher()?.name !== LOCAL_CHANNEL_CIPHER) return 'the negotiated cipher differs';
  if (socket.isSessionReused()) return 'a resumed TLS session was offered';
  return null;
}

// One TLS-PSK connection using only the protected record key. No certificate is
// presented or accepted, strict client validation stays on, and the callbacks
// select the fixed public identity rather than a peer-supplied key.
function openSecureSocket({ port, psk, timeoutMs = LOCAL_HANDSHAKE_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let tcpConnected = false;
    let settled = false;
    const key = Buffer.from(psk, 'hex');
    const socket = tls.connect({
      host: '127.0.0.1',
      port,
      minVersion: LOCAL_CHANNEL_PROTOCOL,
      maxVersion: LOCAL_CHANNEL_PROTOCOL,
      ciphers: LOCAL_CHANNEL_CIPHER,
      secureOptions: constants.SSL_OP_NO_TICKET,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
      pskCallback: () => ({ identity: LOCAL_CHANNEL_IDENTITY, psk: key }),
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== null) {
        socket.destroy();
        reject(error);
        return;
      }
      resolve(value);
    };
    const timer = setTimeout(
      () => {
        finish(
          tcpConnected
            ? conflictingChannel('the secure channel did not establish in time')
            : unavailableChannel('the broker is not reachable'),
        );
      },
      Math.max(1, timeoutMs),
    );
    socket.once('connect', () => {
      tcpConnected = true;
    });
    socket.once('secureConnect', () => {
      const problem = profileProblem(socket);
      if (problem !== null) {
        finish(conflictingChannel(problem));
        return;
      }
      socket.disableRenegotiation();
      finish(null, socket);
    });
    socket.once('error', (error) => finish(handshakeFailure(error, tcpConnected)));
  });
}

async function stableRecord(lock) {
  if (lock.path === undefined) return null;
  const current = await readSecureOwnership(lock.path);
  if (current.absent === true || current.schemaVersion !== 2) {
    throw conflictingChannel('the broker ownership record is no longer usable');
  }
  if (!current.bytes.equals(lock.bytes)) {
    throw conflictingChannel('the broker ownership record changed during admission');
  }
  return current;
}

// One exchange owns one absolute budget. The protected-record comparisons, TLS
// establishment and the HTTP exchange all spend that same remaining time instead
// of each starting a fresh timer, so a slow handshake cannot buy a slow response
// extra time beyond the caller's deadline.
function exchangeDeadline(budgetMs) {
  const endsAt = performance.now() + Math.max(1, budgetMs);
  return () => endsAt - performance.now();
}

function httpOverSocket({
  socket,
  port,
  token,
  method,
  path,
  body,
  headers,
  timeoutMs,
  maxBytes,
  signal,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const merged = {
      ...headers,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    };
    if (bytes !== undefined) {
      merged['content-type'] = 'application/json';
      merged['content-length'] = String(bytes.length);
    }
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (_options, done) => {
      done(null, socket);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      agent.destroy();
      if (error !== null) {
        socket.destroy();
        reject(error);
        return;
      }
      resolve(value);
    };
    const cancel = () => finish(unavailableChannel('the local request was cancelled'));
    const timer = setTimeout(
      () => finish(unavailableChannel('the secure broker did not answer in time')),
      Math.max(1, timeoutMs),
    );
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
    }
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent,
        headers: merged,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(unavailableChannel('the broker response exceeded its bound'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () => finish(unavailableChannel('the broker connection failed')));
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          if (text !== '') {
            try {
              parsed = JSON.parse(text);
            } catch {
              finish(unavailableChannel('the broker returned an unreadable response'));
              return;
            }
          }
          finish(null, { status: response.statusCode, body: parsed });
        });
      },
    );
    request.once('error', () => finish(unavailableChannel('the broker is not reachable')));
    request.end(bytes);
  });
}

// One authenticated exchange over a fresh channel. The stable protected record
// is compared before the Authorization header and again after a readiness
// response, so a later substitution never inherits an earlier success. A single
// absolute budget covers every phase, and the actual socket is aborted when it
// expires: a phase that starts, or a response that settles, after the deadline
// never authorizes a later exchange or adoption.
export async function secureExchange({
  lock,
  token,
  method,
  path,
  body,
  headers = {},
  timeoutMs = LOCAL_REQUEST_TIMEOUT_MS,
  maxBytes = LOCAL_LIFECYCLE_BYTES * 64,
  signal,
}) {
  if (lock === undefined || lock.schemaVersion !== 2) {
    throw conflictingChannel('the broker ownership record is not a secure publication');
  }
  if (signal?.aborted === true) {
    throw unavailableChannel('the local request was cancelled');
  }
  const remainingTime = exchangeDeadline(timeoutMs);
  // Check remaining budget before starting any phase. A protected-record read
  // cannot be cancelled, so its result only authorizes the next phase while time
  // remains.
  const expired = () => {
    if (signal?.aborted === true) {
      throw unavailableChannel('the local request was cancelled');
    }
    if (remainingTime() <= 0) {
      throw unavailableChannel('the secure broker did not answer in time');
    }
  };
  expired();
  if (lock.path !== undefined) await stableRecord(lock);
  expired();
  const socket = await openSecureSocket({
    port: lock.port,
    psk: lock.channel.psk,
    timeoutMs: Math.min(LOCAL_HANDSHAKE_TIMEOUT_MS, remainingTime()),
  });
  try {
    expired();
    await stableRecord(lock);
    // No Authorization byte leaves for a phase the remaining budget cannot cover.
    expired();
    const response = await httpOverSocket({
      socket,
      port: lock.port,
      token,
      method,
      path,
      body,
      headers,
      timeoutMs: remainingTime(),
      maxBytes,
      signal,
    });
    if (path === '/v1/ready' && lock.path !== undefined) {
      await stableRecord(lock);
      // Adoption is authority, not an observation: a readiness response that
      // settled at or after the absolute deadline is refused rather than reused.
      expired();
    }
    return response;
  } finally {
    socket.destroy();
  }
}

// Per-request secure client: each new business, wait or lifecycle exchange
// performs its own handshake and stable-record comparison. A successful check on
// an earlier socket never authorizes a later one.
export function createSecureLocalClient({
  port,
  lockFile,
  token,
  timeoutMs = LOCAL_REQUEST_TIMEOUT_MS,
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LocalRequestError('BROKER_UNAVAILABLE', 'the configured broker port is not usable');
  }
  if (typeof token !== 'string' || token === '') {
    throw new LocalRequestError('CREDENTIAL_UNAVAILABLE', 'a local credential is missing');
  }
  return {
    async request(method, path, body, extraHeaders = {}, options = {}) {
      let lock;
      try {
        lock = await readSecureOwnership(lockFile);
      } catch (error) {
        throw new LocalRequestError(
          error?.code ?? 'BROKER_UNAVAILABLE',
          'the broker ownership record is not usable',
        );
      }
      if (lock.absent === true) {
        throw new LocalRequestError('BROKER_UNAVAILABLE', 'the broker is not running');
      }
      if (lock.schemaVersion !== 2) {
        throw new LocalRequestError(
          'BROKER_INSTANCE_CONFLICT',
          'the broker uses the legacy channel; stop it and restart with secure mode',
        );
      }
      return secureExchange({
        lock,
        token,
        method,
        path,
        body,
        headers: extraHeaders,
        timeoutMs,
        signal: options?.signal,
      });
    },
  };
}
