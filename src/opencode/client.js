// Client for one immutable, authenticated loopback OpenCode V2 origin
// (design section 6). Requests go directly to the configured socket with Basic
// auth, a fixed deadline and no redirect, proxy or DNS indirection. This is the
// client-side transport seam a verification preload may instrument; the
// production module keeps all admission and reconciliation decisions.
import http from 'node:http';

export const OPENCODE_USERNAME = 'opencode';
export const OPENCODE_HTTP_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class OriginError extends Error {
  constructor(code, message, { retryable = false, status = null, tag = null } = {}) {
    super(message);
    this.name = 'OriginError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.tag = tag;
  }
}

// One JSON exchange. Resolves with the parsed body or throws OriginError with a
// redacted classification; raw URLs and payloads never enter the message.
function exchange({ url, method, body, authorization, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = { authorization, accept: 'application/json' };
    if (bytes !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(bytes.length);
    }

    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const request = http.request(url, { method, headers, agent: false }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(
            new OriginError('UNSUPPORTED_RESPONSE', 'origin response exceeded the size budget'),
          );
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error) => finish(transportError(error)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (text !== '') {
          try {
            parsed = JSON.parse(text);
          } catch {
            finish(
              new OriginError('UNSUPPORTED_RESPONSE', 'origin response was not JSON', {
                status: response.statusCode,
              }),
            );
            return;
          }
        }
        finish(null, { status: response.statusCode, body: parsed });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        Object.assign(new Error('origin request exceeded its deadline'), { code: 'ETIMEDOUT' }),
      );
    });
    request.on('error', (error) => finish(transportError(error)));
    request.end(bytes);
  });
}

function transportError(error) {
  if (error instanceof OriginError) return error;
  return new OriginError('ORIGIN_UNAVAILABLE', 'the configured origin could not be reached', {
    retryable: true,
  });
}

function statusError(status, body) {
  const tag = typeof body?._tag === 'string' ? body._tag : null;
  const message =
    typeof body?.message === 'string' ? body.message.slice(0, 200) : 'origin rejected the request';

  if (status === 401 || status === 403) {
    return new OriginError('AUTH_REQUIRED', 'the origin rejected its configured credentials', {
      status,
      tag,
    });
  }
  if (status === 404) {
    const code = tag === 'LocationNotFoundError' ? 'LOCATION_NOT_FOUND' : 'SESSION_NOT_FOUND';
    return new OriginError(code, 'the origin does not know this session or location', {
      status,
      tag,
    });
  }
  if (status === 409) {
    // Documented conflict, undocumented condition: stay pending and reconcile.
    return new OriginError('CONFLICT', 'the origin reported a conflict for this input', {
      retryable: true,
      status,
      tag,
    });
  }
  if (status >= 500) {
    return new OriginError('ORIGIN_UNAVAILABLE', 'the origin is temporarily unavailable', {
      retryable: true,
      status,
      tag,
    });
  }
  return new OriginError('UNSUPPORTED_RESPONSE', message, { status, tag });
}

const SESSION_ID_PATTERN = /^ses/;

export function createOriginClient({ url, password, timeoutMs = OPENCODE_HTTP_TIMEOUT_MS }) {
  const authorization = `Basic ${Buffer.from(`${OPENCODE_USERNAME}:${password}`, 'utf8').toString('base64')}`;
  const base = new URL(url);

  const call = async (method, path, body) => {
    const target = new URL(path, base);
    if (target.origin !== base.origin) {
      throw new OriginError('UNSUPPORTED_RESPONSE', 'request path escaped the configured origin');
    }
    const response = await exchange({
      url: target.href,
      method,
      body,
      authorization,
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300)
      throw statusError(response.status, response.body);
    return response.body;
  };

  const segment = (value) => {
    if (typeof value !== 'string' || value === '' || value.length > 512) {
      throw new OriginError('UNSUPPORTED_RESPONSE', 'invalid origin identifier');
    }
    return encodeURIComponent(value);
  };

  return {
    // GET /api/info -> unwrapped ServerInfo (version, pid, urls, paths).
    async info() {
      const body = await call('GET', '/api/info');
      if (typeof body?.version !== 'string' || !Number.isInteger(body?.pid)) {
        throw new OriginError('UNSUPPORTED_RESPONSE', 'origin ServerInfo has an unexpected shape');
      }
      return body;
    },

    // GET /api/session/{sessionID} -> { data: Session.Info }.
    async session(sessionId) {
      const body = await call('GET', `/api/session/${segment(sessionId)}`);
      const session = body?.data;
      if (typeof session?.id !== 'string' || session.id !== sessionId) {
        throw new OriginError('UNSUPPORTED_RESPONSE', 'origin returned a different session');
      }
      return session;
    },

    // POST /api/session/{sessionID}/prompt -> { data: Session.Inbox.User }.
    async prompt(sessionId, { id, text }) {
      if (typeof id !== 'string' || !id.startsWith('msg_')) {
        throw new OriginError('UNSUPPORTED_RESPONSE', 'prompt id must be a msg_ identifier');
      }
      return call('POST', `/api/session/${segment(sessionId)}/prompt`, {
        id,
        text,
        delivery: 'steer',
        resume: true,
      });
    },

    // GET /api/session/{sessionID}/inbox -> Session.Inbox.Info[] (listed envelope).
    async inbox(sessionId) {
      const body = await call('GET', `/api/session/${segment(sessionId)}/inbox`);
      if (!Array.isArray(body?.data)) {
        throw new OriginError('UNSUPPORTED_RESPONSE', 'inbox response is not a data array');
      }
      return body.data;
    },

    // GET /api/session/{sessionID}/message/{messageID} -> { data: Session.Message.Info }.
    // A documented MessageNotFoundError is reported as null: absence of a
    // projected message is an observation, not a failure.
    async messageOrNull(sessionId, messageId) {
      try {
        const body = await call(
          'GET',
          `/api/session/${segment(sessionId)}/message/${segment(messageId)}`,
        );
        if (typeof body?.data?.id !== 'string') {
          throw new OriginError('UNSUPPORTED_RESPONSE', 'message response has no data record');
        }
        return body.data;
      } catch (error) {
        if (error instanceof OriginError && error.tag === 'MessageNotFoundError') return null;
        throw error;
      }
    },
  };
}

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value) && value.length <= 512;
}
