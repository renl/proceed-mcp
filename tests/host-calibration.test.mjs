// Controlled fixtures only; these assertions prove the test consumer, not OpenCode.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { calibrationEntry } from './host-calibration-entry.mjs';
import { attempt, directClient, hash, preliminary, prerequisites, prompt, reconcile } from './support/host-calibration.mjs';

const binding = () => ({ ready: true, origin: 'http://127.0.0.1:12345',
  authorization: `Basic ${Buffer.from('opencode:fixture-only').toString('base64')}`,
  pid: 123, version: 'fixture-not-supported',
  sessions: [{ id: 'ses_a', created: 1 }, { id: 'ses_b', created: 2 }] });
const input = () => prompt(`msg_${'a'.repeat(32)}`, 'Instructions only.\n yes\n拒否');
const admitted = (p) => ({ id: p.id, sessionID: 'ses_a', type: 'user', payload: { text: p.text }, delivery: 'steer' });
function fixture({ conflict = false, mismatch = false } = {}) {
  const calls = []; let delivered = false;
  return { calls, exchange: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/api/info') return { status: 200, body: { version: 'fixture-not-supported', pid: 123 } };
    const session = binding().sessions.find((s) => path === `/api/session/${s.id}`);
    if (session) return { status: 200, body: { data: { id: session.id, time: { created: session.created } } } };
    if (path.endsWith('/inbox')) return { status: 200, body: { data: [] } };
    if (method === 'POST') {
      if (conflict) return { status: 409, body: { _tag: 'ConflictError', message: 'fixture' } };
      delivered = true;
      return { status: 200, body: { data: admitted(body) } };
    }
    return delivered ? { status: 200, body: { data: { id: input().id, type: 'user',
      text: mismatch ? 'rewritten' : input().text } } } :
      { status: 404, body: { _tag: 'MessageNotFoundError' } };
  } };
}

test('CAL-PREREQ: no binding/credential/identity is RED without a call', async () => {
  let calls = 0;
  await assert.rejects(calibrationEntry(undefined, () => { calls++; }), /PREREQUISITE/);
  for (const delta of [{ authorization: '' }, { authorization: 'Basic d3Jvbmc6dXNlcg==' },
    { ready: false }, { sessions: [] }, { pid: 0 },
    { origin: 'http://localhost:12345' }]) assert.throws(() => prerequisites({ ...binding(), ...delta }));
  assert.equal(calls, 0);
});
test('CAL-CAPTURE: exact bytes hash, runtime version distinct from schema version, preliminary only', async () => {
  const f = fixture();
  const raw = Buffer.from('{"openapi":"3.1.0","info":{"version":"0.0.1"},"paths":{},"components":{"schemas":{}}}');
  const result = await preliminary(binding(), async (...args) => args[1] === '/openapi.json' ?
    { status: 200, raw, body: JSON.parse(raw) } : f.exchange(...args));
  assert.equal(result.version, 'fixture-not-supported');
  assert.equal(result.sha256, hash(raw));
  assert.equal(result.schemaBytes, raw);
  assert.equal(result.publishedSchemaMatch, false);
  assert.equal(result.supportEligible, false);
});
test('CAL-IDENTITY: changed host/session prevents admission', async () => {
  for (const delta of [{ pid: 999 }, { version: 'other' },
    { sessions: [{ id: 'ses_a', created: 9 }, { id: 'ses_b', created: 2 }] }]) {
    const f = fixture();
    await assert.rejects(attempt(f.exchange, { ...binding(), ...delta }, 'ses_a', input()), /CHANGED/);
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  }
});
test('CAL-REPLAY: stable exact payload, history+inbox, no second POST after driver recreation', async () => {
  const f = fixture(); const p = input();
  assert.equal((await attempt(f.exchange, binding(), 'ses_a', p)).state, 'delivered');
  const restored = prompt(p.id, p.text); // Fixture reconstruction, NOT actual process restart proof.
  const result = await attempt(f.exchange, binding(), 'ses_a', restored);
  assert.equal(result.continuationEstablished, false);
  const posts = f.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1); assert.deepEqual(posts[0].body, p);
});
test('CAL-CONFLICT: 409 is not busy, mismatched projected text blocks', async () => {
  const conflict = fixture({ conflict: true });
  assert.deepEqual(await attempt(conflict.exchange, binding(), 'ses_a', input()),
    { state: 'pending', conflictObserved: true, busyEstablished: false });
  const mismatch = fixture({ mismatch: true });
  await assert.rejects(attempt(mismatch.exchange, binding(), 'ses_a', input()), /PAYLOAD_MISMATCH/);
  await assert.rejects(reconcile(async () => ({ status: 404, body: { _tag: 'SessionNotFoundError' } }),
    'ses_a', input()), /HISTORY_STATUS/);
});
test('CAL-RECONCILE: pending inbox is not delivered; absent history+inbox stays uncertain', async () => {
  const p = input();
  const exchange = (items) => async (_method, path) => path.endsWith('/inbox') ?
    { status: 200, body: { data: items } } : { status: 404, body: { _tag: 'MessageNotFoundError' } };
  assert.equal((await reconcile(exchange([admitted(p)]), 'ses_a', p)).state, 'admitted');
  assert.equal((await reconcile(exchange([]), 'ses_a', p)).state, 'uncertain');
  await assert.rejects(reconcile(exchange([{ ...admitted(p), sessionID: 'ses_b' }]), 'ses_a', p),
    /ADMISSION_MISMATCH/);
});
test('CAL-TRANSPORT: finite local fixture, Basic unchanged, redirect not followed, session/origin fenced',
  { timeout: 5000 }, async () => {
    let calls = 0; let authorization;
    const server = http.createServer((req, res) => {
      calls++; authorization = req.headers.authorization;
      res.writeHead(302, { location: 'http://127.0.0.1:1/never', 'content-type': 'application/json' });
      res.end('{}');
    });
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const b = binding(); b.origin = `http://127.0.0.1:${server.address().port}`;
      const exchange = directClient(b);
      b.origin = 'http://127.0.0.1:1'; b.authorization = 'Basic changed';
      assert.equal((await exchange('GET', '/api/info')).status, 302);
      assert.equal(authorization, binding().authorization); assert.equal(calls, 1);
      await assert.rejects(exchange('POST', '/api/session/ses_other/prompt', input()), /SESSION_SCOPE/);
      await assert.rejects(exchange('GET', '//other/api/info'), /PATH_SCOPE/);
      const cancelled = AbortSignal.abort();
      await assert.rejects(exchange('GET', '/api/info', undefined, cancelled), /TRANSPORT_LOSS/);
    } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    assert.equal(server.listening, false);
  });
