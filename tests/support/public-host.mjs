// TEST ONLY. Sources: active design section 6; assistant-schema-research sections 2, 6, 7.
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

export class BoundaryError extends Error {
  constructor(kind, code) { super(`${kind}: ${code}`); this.kind = kind; this.code = code; }
}

// No redirects, DNS, proxy discovery, body/credential logging or substitute origin.
export function publicHTTP(origin, authorization) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.ok(Number(origin.split(':').at(-1)) <= 65535);
  assert.match(authorization, /^(Basic|Bearer) \S+$/);
  return (method, path, body, signal) => new Promise((resolve, reject) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('#'));
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request(`${origin}${path}`, { method,
      headers: { authorization, ...(bytes ? { 'content-type': 'application/json',
        'content-length': bytes.length } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    }, (response) => {
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) response.destroy(new BoundaryError('BEHAVIOR', 'BODY_BUDGET'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const status = response.statusCode;
        if (status < 200 || status >= 300) {
          reject(new BoundaryError([401, 403, 503].includes(status) ? 'ENVIRONMENT' : 'BEHAVIOR', `HTTP_${status}`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new BoundaryError('BEHAVIOR', 'JSON_SHAPE')); }
      });
    });
    request.on('error', (error) => reject(error instanceof BoundaryError ? error :
      new BoundaryError('ENVIRONMENT', error.code ?? error.name)));
    request.end(bytes);
  });
}

export async function poll(read, predicate, signal, code, ms = 15000) {
  const deadline = performance.now() + ms;
  do {
    signal.throwIfAborted();
    const value = await read();
    if (predicate(value)) return value;
    await sleep(100, undefined, { signal });
  } while (performance.now() < deadline);
  throw new BoundaryError('BEHAVIOR', code);
}

export function hostAdapters(exchange, session) {
  const base = `/api/session/${encodeURIComponent(session)}`;
  return {
    info: (signal) => exchange('GET', '/api/info', undefined, signal),
    session: (signal) => exchange('GET', base, undefined, signal),
    invoke: (id, text, signal) => exchange('POST', `${base}/prompt`,
      { id, text, delivery: 'steer', resume: true }, signal),
    async assistant(signal) {
      const messages = []; const seen = new Set(); let cursor;
      do {
        const query = new URLSearchParams({ type: 'assistant', limit: '100' });
        if (cursor) query.set('cursor', cursor); else query.set('order', 'desc');
        const page = await exchange('GET', `${base}/message?${query}`, undefined, signal);
        assert.ok(Array.isArray(page.data) && page.cursor, 'BEHAVIOR: assistant envelope');
        for (const message of page.data) {
          assert.equal(message.type, 'assistant');
          assert.ok(Array.isArray(message.content));
          messages.push(message);
        }
        cursor = page.cursor.next;
        assert.ok(!cursor || (!seen.has(cursor) && seen.size < 100), 'BEHAVIOR: pagination');
        seen.add(cursor);
      } while (cursor);
      return messages;
    },
    async tools(signal) {
      return (await this.assistant(signal)).flatMap((message) => message.content.filter((part) => part.type === 'tool'));
    },
  };
}

export function exactTool(parts, toolName, clientRequestId) {
  return parts.filter((part) => part.name === toolName &&
    part.state?.input?.client_request_id === clientRequestId);
}

// Timeout error literals are NOT specified by OpenAPI. Environment preparation
// must pin an independently calibrated host timeout, not match any tool error.
export function assertTimeout(part, calibration) {
  assert.equal(part.state.status, 'error', 'BEHAVIOR: tool did not error');
  assert.equal(part.state.error?.type, calibration.type, 'BEHAVIOR: not calibrated timeout type');
  assert.equal(part.state.error?.message, calibration.message, 'BEHAVIOR: not calibrated timeout message');
}
