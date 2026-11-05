// TEST ONLY. External measurement, never production admission/support authority.
// Wire authority: active design 6/7, research 2.3-2.5, assistant-schema-research.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { assistantSchemaHash } from './assistant-extraction.mjs';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, code) => assert.ok(condition, `CALIBRATION: ${code}`);
export function prerequisites(binding) {
  requireThat(binding, 'PREREQUISITE_PROTECTED_BINDING_MISSING');
  requireThat(binding.ready === true, 'PREREQUISITE_ENVIRONMENT_NOT_READY');
  requireThat(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(binding.origin ?? '') &&
    Number(binding.origin.split(':').at(-1)) <= 65535, 'FIXED_NUMERIC_ORIGIN');
  requireThat(/^Basic [A-Za-z0-9+/]+={0,2}$/.test(binding.authorization ?? '') &&
    /^opencode:.+$/s.test(Buffer.from(binding.authorization.slice(6), 'base64').toString('utf8')),
  'PREREQUISITE_BASIC_AUTH');
  requireThat(Array.isArray(binding.sessions) && binding.sessions.length === 2 &&
    new Set(binding.sessions.map((s) => s.id)).size === 2 && binding.sessions.every((s) =>
      /^ses/.test(s.id) && Number.isFinite(s.created)), 'PREREQUISITE_TWO_DISPOSABLE_IDENTITIES');
  requireThat(Number.isInteger(binding.pid) && binding.pid > 0 &&
    typeof binding.version === 'string' && binding.version.length > 0, 'PREREQUISITE_HOST_IDENTITY');
}

// Captures values once. No redirects, listener, DNS/proxy discovery or external URL.
// Error text/body and Authorization are never put in an Error or log.
export function directClient(binding) {
  prerequisites(binding);
  const { origin, authorization } = binding;
  const allowed = binding.sessions.map((s) => `/api/session/${encodeURIComponent(s.id)}`);
  return (method, path, body, signal) => new Promise((resolve, reject) => {
    requireThat((method === 'GET' && (path === '/api/info' || path === '/openapi.json' ||
      /^\/api\/session\/ses[^/?#]*($|\/inbox$|\/message\/msg_[^/?#]*$)/.test(path))) ||
      (method === 'POST' && /^\/api\/session\/ses[^/?#]*\/prompt$/.test(path)), 'PATH_SCOPE');
    requireThat(!path.startsWith('/api/session/') || allowed.some((base) =>
      path === base || path.startsWith(`${base}/`)), 'SESSION_SCOPE');
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request(`${origin}${path}`, { method, agent: false,
      headers: { authorization, ...(bytes ? { 'content-type': 'application/json',
        'content-length': bytes.length } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    }, (response) => {
      const chunks = []; let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > 4 * 1024 * 1024) response.destroy(new Error('CALIBRATION: BODY_BUDGET'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('CALIBRATION: RESPONSE_LOST')));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        try { resolve({ status: response.statusCode, raw, body: JSON.parse(raw.toString('utf8')) }); }
        catch { reject(new Error('CALIBRATION: JSON_SHAPE')); }
      });
    });
    request.on('error', () => reject(new Error('CALIBRATION: TRANSPORT_LOSS')));
    request.end(bytes);
  });
}

export async function identity(exchange, binding, signal) {
  const info = await exchange('GET', '/api/info', undefined, signal);
  requireThat(info.status === 200, info.status === 401 ? 'AUTH_REQUIRED' : 'INFO_STATUS');
  requireThat(info.body.version === binding.version && info.body.pid === binding.pid, 'ORIGIN_CHANGED');
  for (const session of binding.sessions) {
    const result = await exchange('GET', `/api/session/${encodeURIComponent(session.id)}`, undefined, signal);
    requireThat(result.status === 200 && result.body.data?.id === session.id &&
      result.body.data?.time?.created === session.created, 'SESSION_CHANGED');
  }
  // Advertised info.urls are intentionally never followed.
  return { version: info.body.version, pid: info.body.pid };
}

export async function preliminary(binding, exchange, signal = AbortSignal.timeout(30000)) {
  prerequisites(binding);
  exchange ??= directClient(binding);
  const observed = await identity(exchange, binding, signal);
  const schema = await exchange('GET', '/openapi.json', undefined, signal);
  requireThat(schema.status === 200 && schema.body.openapi === '3.1.0' &&
    schema.body.paths && schema.body.components?.schemas, 'SCHEMA_CAPTURE');
  const sha256 = hash(schema.raw);
  await identity(exchange, binding, signal);
  return { stage: 'PRELIMINARY_ONLY', ...observed, sha256,
    publishedSchemaMatch: sha256 === assistantSchemaHash.toLowerCase(),
    schemaBytes: schema.raw, supportEligible: false };
}

export function prompt(id, text) {
  requireThat(/^msg_[a-f0-9]{32}$/.test(id) && typeof text === 'string' && text.length > 0, 'CONTROLLED_PAYLOAD');
  return Object.freeze({ id, text, delivery: 'steer', resume: true });
}
function admission(item, session, input) {
  requireThat(item?.id === input.id && item.sessionID === session && item.type === 'user' &&
    item.payload?.text === input.text && item.delivery === 'steer', 'ADMISSION_MISMATCH');
}
export async function reconcile(exchange, session, input, signal) {
  const base = `/api/session/${encodeURIComponent(session)}`;
  const history = await exchange('GET', `${base}/message/${input.id}`, undefined, signal);
  requireThat(history.status === 200 || (history.status === 404 &&
    history.body?._tag === 'MessageNotFoundError'), 'HISTORY_STATUS');
  if (history.status === 200) requireThat(history.body.data?.id === input.id &&
    history.body.data?.type === 'user' && history.body.data?.text === input.text, 'PAYLOAD_MISMATCH');
  const inbox = await exchange('GET', `${base}/inbox`, undefined, signal);
  requireThat(inbox.status === 200 && Array.isArray(inbox.body.data), 'INBOX_STATUS');
  const pending = inbox.body.data.filter((item) => item.id === input.id);
  requireThat(pending.length <= 1, 'DUPLICATE_INBOX_ID');
  for (const item of pending) admission(item, session, input);
  return { state: pending.length ? 'admitted' : history.status === 200 ? 'delivered' : 'uncertain',
    continuationEstablished: false };
}

// One bounded attempt, not the product retry worker. Caller retains the SAME frozen
// input across restart. A 409 is only ConflictError, never proof of "busy".
export async function attempt(exchange, binding, session, input, signal = AbortSignal.timeout(30000)) {
  prerequisites(binding);
  requireThat(binding.sessions.some((s) => s.id === session), 'SESSION_SCOPE');
  requireThat(Object.isFrozen(input) && input.delivery === 'steer' && input.resume === true, 'IMMUTABLE_INPUT');
  await identity(exchange, binding, signal);
  const before = await reconcile(exchange, session, input, signal);
  if (before.state !== 'uncertain') return before;
  const result = await exchange('POST', `/api/session/${encodeURIComponent(session)}/prompt`, input, signal);
  if (result.status === 409) {
    requireThat(result.body?._tag === 'ConflictError', 'CONFLICT_SHAPE');
    return { state: 'pending', conflictObserved: true, busyEstablished: false };
  }
  requireThat(result.status === 200, result.status === 401 ? 'AUTH_REQUIRED' : 'ADMISSION_STATUS');
  admission(result.body.data, session, input);
  return reconcile(exchange, session, input, signal);
}
