// Minimal local HTTP client for the public CLI and the stdio MCP adapter. It
// speaks only to the configured loopback broker port with a protected local
// credential and never follows a redirect or consults a proxy. A caller may add
// route-specific authority headers, such as a request capability, but never
// replace the protected transport credential.
import http from 'node:http';

export class LocalRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalRequestError';
    this.code = code;
  }
}

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
