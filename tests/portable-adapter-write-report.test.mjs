// TEST ONLY: design3/6/7 A1/A2/A3. Native callback proof, not OS pipe/model receipt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRegistration, observe, success } from './support/public-registration.mjs';
import { controlled, reports, rows, auth, question, cancel, quiet, recorded } from './support/adapter-write-report.mjs';
const opts = { timeout: 65000 };
async function prepare(h, a) {
  const p = success(await a.call('prepare_approval'));
  h.requestSecrets.push(p.request_capability); return p;
}
async function start(h, c, { immediate = false } = {}) {
  c.call('prepare', 'prepare_approval'); const p = (await c.frame('prepare')).frame.result.structuredContent;
  h.requestSecrets.push(p.request_capability);
  let terminal;
  if (immediate) h.beforeForward(async r => {
    if (r.path.endsWith('/wait')) terminal = await cancel(h, p);
  });
  c.call('original', 'request_approval', question(p));
  await observe(() => h.calls.some(r => r.path.endsWith('/wait') && r.body), 'real wait admitted');
  if (immediate) await observe(() => terminal, 'real closure committed before WAIT forwarding');
  terminal ??= await cancel(h, p);
  const w = await c.frame('original');
  assert.deepEqual(w.frame.result.structuredContent, terminal);
  assert.deepEqual(Object.keys(w.frame.result).sort(), ['content', 'isError', 'structuredContent']);
  for (const secret of [p.request_capability, ...h.secrets,
    h.calls.find(r => r.path === '/v1/adapter').reply.registration_secret])
    assert.ok(!JSON.stringify(w.frame).includes(secret), 'no private authority in either result channel');
  assert.deepEqual(JSON.parse(w.frame.result.content[0].text), w.frame.result.structuredContent);
  return { p, w };
}
test('B2c-CALIBRATION: controlled Writable false return is backpressure, callback gates completion', async () => {
  let done, callbacks = 0;
  const c = new (class extends Writable { _write(b, e, cb) { done = cb; } })({ highWaterMark: 1 });
  assert.equal(c.write('frame\n', () => callbacks++), false); assert.equal(callbacks, 0);
  done(); await new Promise(resolve => setImmediate(resolve)); assert.equal(callbacks, 1); c.destroy();
});
import { Writable } from 'node:stream';
test('B2c-CALIBRATION-LEDGER: direct HTTP report oracle, NOT actual write reporting proof', opts,
  () => publicRegistration(async h => {
    await h.restart(); await controlled(h, async c => {
      const { p, w } = await start(h, c); await quiet(h);
      const wait = h.calls.find(r => r.path.endsWith('/wait'));
      // Drive real route through relay with a disposable local client. No fixture mutation append.
      const config = JSON.parse(await readFile(join(h.state, 'config.json'), 'utf8'));
      const client = createLocalClient({ port: config.broker.port, token: h.owner });
      const r = await client.request('POST', `/v1/requests/${p.request_id}/returned`, {
        ...wait.body, decision_id: w.frame.result.structuredContent.decision_id }, {
        'X-Proceed-Registration': wait.header, 'X-Proceed-Request-Capability': p.request_capability });
      assert.equal(r.status, 200); await recorded(h, p); w.done();
    }, { callback: false });
  }, { paired: true }));
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalClient } from '../src/http/local-client.js';
for (const mode of ['success', 'immediate', 'absent', 'callback-error', 'callback-error-reusable', 'throw', 'destroy', 'cancel-first', 'EOF-first', 'stale'])
  test(`B2c-CALLBACK-${mode}`, opts, () => publicRegistration(async h => {
    await h.restart();
    await controlled(h, async c => {
      const { p, w } = await start(h, c, { immediate: mode === 'immediate' });
      await quiet(h); // Actual terminal HTTP response and bytes are NOT successful callback evidence.
      if (mode === 'stale') await h.restart();
      if (mode === 'cancel-first') {
        c.send({ method: 'notifications/cancelled', params: { requestId: 'original' } });
        await new Promise(resolve => setImmediate(resolve));
      }
      if (mode === 'EOF-first') { c.end(); await new Promise(resolve => setImmediate(resolve)); }
      if (mode === 'destroy') c.stdout.destroy();
      w.done(mode === 'callback-error' ? Error('controlled callback failure') : undefined);
      if (['success', 'immediate'].includes(mode)) {
        await recorded(h, p); await quiet(h, 1);
        assert.equal(c.hooks.filter(id => id === 'original').length, 1);
      } else if (mode === 'stale') {
        await observe(() => reports(h)[0]?.status === 401, 'captured stale incarnation is rejected');
        assert.equal(h.calls.filter(r => r.path === '/v1/adapter').length, 1, 'report never refreshes');
        await quiet(h, 1);
      } else await quiet(h);
      if (mode === 'EOF-first') await c.eof();
      if (['throw', 'callback-error-reusable', 'success', 'immediate', 'absent'].includes(mode)) {
        c.call('later', 'prepare_approval'); await c.frame('later');
      }
    }, { callback: mode !== 'absent', fault: ['throw', 'callback-error-reusable'].includes(mode) ? mode : null });
  }, { paired: true }));

for (const order of ['cancel', 'EOF']) test(`B2c-CALLBACK-FIRST-${order}: report transport aborted, no retry`, opts,
  () => publicRegistration(async h => {
    await h.restart(); let release; const gate = new Promise(resolve => { release = resolve; });
    h.beforeForward(r => r.path.endsWith('/returned') ? gate : undefined);
    try { await controlled(h, async c => {
      const { w } = await start(h, c); w.done();
      await observe(() => reports(h)[0]?.body, 'callback admits tracked real report transport');
      c.call('unrelated', 'prepare_approval'); await c.frame('unrelated');
      if (order === 'cancel') c.send({ method: 'notifications/cancelled', params: { requestId: 'original' } });
      else await c.eof();
      await observe(() => reports(h)[0].socketClosed, 'actual report socket aborted');
      release(); await quiet(h, 1);
      assert.ok(!(await rows(h)).some(m => m.op === 'request.returned'));
    }); } finally { release(); }
  }, { paired: true }));

test('B2c-PUBLIC: reverse concurrent original frames each admit own authenticated returned report', opts,
  () => publicRegistration(async h => {
    await h.restart(); const a = await h.connect(), p = await prepare(h, a), q = await prepare(h, a);
    const first = a.call('request_approval', question(p), { id: 7 });
    const second = a.call('request_approval', question(q), { id: '7' });
    await observe(() => h.calls.filter(r => r.path.endsWith('/wait') && r.body).length === 2, 'both actual waits');
    for (const [item, call, id] of [[q, second, '7'], [p, first, 7]]) {
      const v = await cancel(h, item), out = await call;
      assert.equal(out.frame.id, id); assert.deepEqual(success(out), v); await recorded(h, item);
    }
    await quiet(h, 2); const before = await h.journal();
    for (const name of ['get_approval', 'cancel_approval', 'acknowledge_approval', 'request_approval']) {
      const v = success(await a.call('get_approval', auth(p)));
      success(await a.call(name, name === 'request_approval' ? question(p) :
        { ...auth(p), ...(name === 'acknowledge_approval' ? { decision_id: v.decision_id } : {}) }));
    }
    await quiet(h, 2); // Only explicit acknowledgement may change the journal here.
    assert.ok(!(await h.journal()).equals(before)); await h.eof(a);
    assert.equal((await rows(h)).filter(m => m.op === 'request.returned').length, 2);
  }, { paired: true }));

for (const fault of ['ack-before', 'lost-response', 'held-EOF']) test(`B2c-PUBLIC-${fault}`, opts,
  () => publicRegistration(async h => {
    await h.restart(); const a = await h.connect(), p = await prepare(h, a);
    let release; const gate = new Promise(resolve => { release = resolve; });
    if (fault !== 'lost-response') h.beforeForward(r => r.path.endsWith('/returned') ? gate : undefined);
    else h.hold(r => { if (!r.path.endsWith('/returned')) return false; r.disconnect(); return true; });
    try {
      const call = a.call('request_approval', question(p), { id: 'original' });
      await observe(() => h.calls.some(r => r.path.endsWith('/wait') && r.body), 'actual pending original');
      const v = await cancel(h, p); assert.deepEqual(success(await call), v);
      await observe(() => reports(h)[0]?.body, 'actual report starts after original result');
      if (fault === 'held-EOF') {
        await h.eof(a); await observe(() => reports(h)[0].socketClosed, 'EOF aborts held report'); release();
        await quiet(h, 1); assert.ok(!(await rows(h)).some(m => m.op === 'request.returned')); return;
      }
      if (fault === 'ack-before') {
        const ack = success(await a.call('acknowledge_approval', { ...auth(p), decision_id: v.decision_id }));
        assert.equal(ack.delivery_state, 'confirmed'); release();
      }
      await recorded(h, p); await quiet(h, 1);
      const final = success(await a.call('get_approval', auth(p)));
      assert.equal(final.delivery_state, fault === 'ack-before' ? 'confirmed' : 'returned');
      const evidence = (await rows(h)).filter(m => m.op === 'request.returned');
      assert.equal(evidence.length, 1); assert.equal(evidence[0].decision_id, v.decision_id);
      assert.equal(evidence[0].delivery_state, final.delivery_state);
      assert.ok(Date.parse(evidence[0].returned_at) >= Date.parse(v.resolved_at));
      assert.equal(final.decision_id, v.decision_id); await h.eof(a);
    } finally { release(); }
  }, { paired: true }));
