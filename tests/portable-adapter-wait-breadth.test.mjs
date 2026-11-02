// TEST ONLY: design 3/6/7. Actual local serve/MCP/HTTP, no human/returned-write oracle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readJournal } from '../src/journal/framing.js';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';

const creates = h => h.calls.filter(c => c.path === '/v1/requests');
const waits = h => h.calls.filter(c => c.path.endsWith('/wait'));
const rows = async h => readJournal(await h.journal()).transactions.flatMap(t => t.mutations);
const question = (p, seconds = 60) => ({ request_handle: p.request_handle,
  request_capability: p.request_capability, client_request_id: 'breadth', action: 'Proceed?',
  context: '', expires_in_seconds: seconds });
const authority = p => ({ request_id: p.request_id, request_capability: p.request_capability });
function rawObserver() {
  const frames = []; let tail = '', ended = false;
  return { frames, attach(child) {
    child.stdout.on('data', b => {
      tail += b.toString(); let at;
      while ((at = tail.indexOf('\n')) >= 0) {
        frames.push(JSON.parse(tail.slice(0, at))); tail = tail.slice(at + 1);
      }
    });
    child.stdout.on('end', () => { ended = true; });
  }, complete() { assert.ok(ended && tail === '', 'raw protocol observer reaches framing EOF'); } };
}
async function setup(h) {
  await h.restart(); const raw = rawObserver();
  const a = await h.connect('shared', { observeOutput: raw.attach });
  const p = success(await a.call('prepare_approval', { session_label: 'Longevity' }));
  h.requestSecrets.push(p.request_capability);
  return { a, p, raw };
}
function wire(h, p, w) {
  assert.equal(w.method, 'POST'); assert.equal(w.path, `/v1/requests/${p.request_id}/wait`);
  const r = h.calls.find(c => c.path === '/v1/adapter' && c.reply?.registration_id === w.body?.registration_id);
  assert.ok(r, 'wait names a real authenticated registration response');
  assert.deepEqual(w.body, { registration_id: r.reply.registration_id });
  assert.ok(w.header === r.reply.registration_secret && w.capability === p.request_capability &&
    w.token === `Bearer ${h.owner}`, 'exact registration, capability and owner headers');
}
async function admitted(h, p, index = 0) {
  await observe(() => waits(h)[index]?.body, 'actual wait exchange reaches relay');
  const w = waits(h)[index]; wire(h, p, w);
  const r = await h.http(w.path, h.owner, { method: 'POST', headers: {
    'X-Proceed-Request-Capability': p.request_capability, 'X-Proceed-Registration': w.header },
  body: JSON.stringify(w.body) });
  assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'WAIT_ALREADY_ACTIVE');
  return w;
}
function oneCreate(h, p, seconds) {
  assert.equal(creates(h).length, 1, 'automatic polling/reconnect never repeats creation');
  const c = creates(h)[0], { request_capability, ...body } = question(p, seconds);
  assert.equal(c.status, 201); assert.equal(c.reply.resolution, 'pending');
  assert.deepEqual(c.body, body);
  assert.ok(c.capability === request_capability && c.token === `Bearer ${h.owner}`);
  assert.equal(c.reply.request_id, p.request_id);
}
function pending(raw, id) {
  assert.equal(raw.frames.filter(f => f.id === id).length, 0, 'original receives no receipt/progress/result');
}
function original(raw, outcome, id, value) {
  assert.equal(outcome.frame.id, id); assert.equal(typeof outcome.frame.id, typeof id);
  assert.deepEqual(success(outcome), value);
  assert.equal(raw.frames.filter(f => f.id === id).length, 1, 'one original destination response');
}
async function cancel(h, p) {
  const r = await h.http(`/v1/requests/${p.request_id}/cancel`, h.owner, { method: 'POST',
    headers: { 'X-Proceed-Request-Capability': p.request_capability }, body: '{}' });
  assert.equal(r.status, 200); const v = await r.json();
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'pending'); return v;
}
async function finish(h, a, raw) {
  assert.ok(!h.calls.some(c => /\/(returned|acknowledge)$/.test(c.path)), 'no fabricated write reports');
  await h.eof(a); raw.complete();
  assert.ok(!(await rows(h)).some(m => ['request.returned', 'request.acknowledge'].includes(m.op)));
}

test('W1c-TURNOVER: real25s204 gap preserves original reservation and re-entry', { timeout: 80000 },
  () => publicRegistration(async h => {
    const { a, p, raw } = await setup(h);
    h.hold(c => c.path.endsWith('/wait') && c.status === 204);
    const call = a.call('request_approval', question(p), { id: 7, ms: 55000 });
    const first = await admitted(h, p); await h.phase('real-25s-turnover');
    await observe(() => first.held, 'production25s wait completes204', 30000);
    assert.ok(first.heldAt - first.at >= 25000, 'real monotonic25s floor, no clock substitution');
    assert.equal(first.status, 204); assert.equal(first.reply, null); pending(raw, 7);
    const before = await h.journal();
    toolError(await a.call('request_approval', question(p), { id: '7' }), 'WAIT_ALREADY_ACTIVE');
    assert.equal(waits(h).length, 1); oneCreate(h, p, 60);
    assert.ok(before.equals(await h.journal()), 'duplicate in gap is inert');
    h.hold(() => false); first.release();
    const next = await admitted(h, p, 1); assert.deepEqual(next.body, first.body);
    assert.ok(next.header === first.header); pending(raw, 7); oneCreate(h, p, 60);
    const v = await cancel(h, p); original(raw, await call, 7, v);
    assert.equal(next.status, 200); assert.deepEqual(next.reply, v);
    assert.equal((await rows(h)).filter(m => m.op === 'request.create').length, 1);
    await finish(h, a, raw);
  }, { paired: true, totalMs: 65000 }));

test('W1c-RESTART: same live call survives graceful stop, full reconnect ladder and registration replacement',
  { timeout: 160000 }, () => publicRegistration(async h => {
    const { a, p, raw } = await setup(h), pid = a.resource.pid;
    const call = a.call('request_approval', question(p, 180), { id: 'restart-original', ms: 130000 });
    const first = await admitted(h, p), before = await h.journal();
    await h.phase('graceful-broker-stop'); const start = performance.now(); await h.stop();
    assert.ok(performance.now() - start < 8000, 'shutdown does not await25s turnover');
    assert.ok(before.equals(await h.journal()), 'shutdown is not business cancellation');
    await observe(() => first.upstreamClosed && first.upstreamErrorAt, 'actual upstream lost transport observed');
    assert.equal(first.committed, undefined, 'shutdown fabricates no successful wait response');
    await h.phase('real-reconnect-1-2-4-8-16-30-30');
    // Initial loss, then six real failed retries. Restart before the second capped30s retry.
    await observe(() => waits(h).length >= 7 && waits(h)[6].upstreamErrorAt,
      'real reconnect ladder reaches30s with original call retained', 100000);
    const failed = waits(h).slice(0, 7), floors = [1000, 2000, 4000, 8000, 16000, 30000];
    for (let i = 1; i < failed.length; i++) {
      wire(h, p, failed[i]);
      assert.ok(failed[i].at - failed[i - 1].upstreamErrorAt >= floors[i - 1] - 50,
        `reconnect delay floor${floors[i - 1]}ms with50ms measurement tolerance`);
    }
    pending(raw, 'restart-original'); oneCreate(h, p, 180);
    assert.equal(a.resource.pid, pid); assert.ok(!a.resource.closed, 'same adapter process remains live');
    await h.phase('authenticated-restart'); await h.restart();
    await observe(() => waits(h).some(w => w.body?.registration_id !== first.body.registration_id &&
      w.body && !w.closed),
      'same invocation reconnects after second30s delay', 35000);
    await observe(() => waits(h).some(w => w.status === 401), 'old captured wait authority is rejected');
    const live = waits(h).at(-1); await admitted(h, p, waits(h).length - 1);
    assert.ok(live.at - failed[6].upstreamErrorAt >= 29950, '30s ladder cap repeats');
    assert.notEqual(live.body.registration_id, first.body.registration_id);
    assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 2, 'one authenticated replacement');
    pending(raw, 'restart-original'); oneCreate(h, p, 180);
    const v = await cancel(h, p); original(raw, await call, 'restart-original', v);
    assert.deepEqual(live.reply, v); assert.equal((await rows(h)).filter(m => m.op === 'request.create').length, 1);
    await finish(h, a, raw);
  }, { paired: true, totalMs: 145000, transportErrors: true }));

test('W1c-EXPIRY: real public60s duration automatically returns exact durable expiry and survives recovery',
  { timeout: 125000 }, () => publicRegistration(async h => {
    const { a, p, raw } = await setup(h), started = performance.now();
    const call = a.call('request_approval', question(p), { id: 'expiry-original', ms: 85000 });
    await admitted(h, p); await h.phase('real-60s-automatic-expiry');
    const outcome = await call, elapsed = performance.now() - started, v = success(outcome);
    assert.ok(elapsed >= 60000, 'real60s floor, no deadline rewriting or clock control');
    oneCreate(h, p, 60); assert.equal(v.resolution, 'expired'); assert.equal(v.delivery_state, 'pending');
    assert.equal(v.response_text, null); assert.match(v.decision_id, /^dec_[a-f0-9]{32}$/);
    assert.equal(Date.parse(v.expires_at) - Date.parse(v.created_at), 60000);
    assert.ok(Date.parse(v.resolved_at) >= Date.parse(v.expires_at)); original(raw, outcome, 'expiry-original', v);
    assert.ok(waits(h).filter(w => w.status === 204).length >= 2);
    assert.deepEqual(waits(h).at(-1).reply, v, 'original result equals actual terminal HTTP view');
    const mutations = await rows(h), expiration = mutations.filter(m => m.op === 'request.expire');
    assert.equal(expiration.length, 1); assert.equal(expiration[0].decision_id, v.decision_id);
    assert.equal(expiration[0].request_id, p.request_id); assert.equal(expiration[0].resolved_at, v.resolved_at);
    assert.equal(mutations.filter(m => m.op === 'request.create').length, 1);
    assert.ok(!h.calls.some(c => /\/(cancel|returned|acknowledge)$/.test(c.path)), 'no substitute terminal producer');
    await finish(h, a, raw); const before = await h.journal();
    await h.phase('expired-decision-recovery'); await h.restart();
    const again = await h.connect(), repeated = await again.call('request_approval', question(p), { id: 7 });
    assert.equal(repeated.frame.id, 7); assert.deepEqual(success(repeated), v);
    assert.deepEqual(success(await again.call('get_approval', authority(p))), v);
    assert.equal(creates(h).length, 2); assert.equal(creates(h)[1].status, 200);
    assert.ok(before.equals(await h.journal()), 'terminal recovery/repeat preserves exact journal');
    await h.eof(again);
  }, { paired: true, totalMs: 110000 }));
