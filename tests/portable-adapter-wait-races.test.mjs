// TEST ONLY: design3/6/7. Real public originals, no returned-write/human oracle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { readJournal } from '../src/journal/framing.js';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';

const waits = h => h.calls.filter(c => c.path.endsWith('/wait'));
const creates = h => h.calls.filter(c => c.path === '/v1/requests');
const question = p => ({ request_handle: p.request_handle, request_capability: p.request_capability,
  client_request_id: 'race', action: 'Proceed?', context: '', expires_in_seconds: 60 });
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
function observer() {
  let tail = '', ended = false; const frames = [];
  return { frames, attach(child) {
    child.stdout.on('data', b => { tail += b.toString(); let at;
      while ((at = tail.indexOf('\n')) >= 0) { frames.push(JSON.parse(tail.slice(0, at))); tail = tail.slice(at + 1); }
    });
    child.stdout.on('end', () => { ended = true; });
  }, complete() { assert.ok(ended && tail === '', 'raw observer reaches exact EOF'); } };
}
async function setup(h) {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = success(await a.call('prepare_approval')); h.requestSecrets.push(p.request_capability);
  return { a, p, raw };
}
async function admitted(h, p) {
  await observe(() => waits(h).at(-1)?.body, 'adapter actually sends wait');
  const w = waits(h).at(-1), reg = h.calls.find(c => c.reply?.registration_id === w.body.registration_id).reply;
  assert.ok(w.header === reg.registration_secret && w.capability === p.request_capability && w.token === `Bearer ${h.owner}`);
  const r = await h.http(w.path, h.owner, { method: 'POST', body: JSON.stringify(w.body), headers: {
    'X-Proceed-Registration': w.header, 'X-Proceed-Request-Capability': p.request_capability } });
  assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'WAIT_ALREADY_ACTIVE');
  assert.equal(creates(h).length, 1); assert.equal(creates(h)[0].status, 201);
  const { request_capability, ...body } = question(p); assert.deepEqual(creates(h)[0].body, body);
  return w;
}
async function cancel(h, p, expected) {
  const r = await h.http(`/v1/requests/${p.request_id}/cancel`, h.owner, { method: 'POST', body: '{}',
    headers: { 'X-Proceed-Request-Capability': p.request_capability } });
  assert.equal(r.status, 200); const v = await r.json(); assert.equal(v.resolution, 'cancelled');
  assert.equal(v.delivery_state, expected); return v;
}
function notify(a, id) {
  a.resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled',
    params: { requestId: id, reason: 'cancel approval' } }) + '\n');
}
async function noReports(h) {
  assert.ok(!h.calls.some(c => /\/(returned|acknowledge)$/.test(c.path)));
  const rows = readJournal(await h.journal()).transactions.flatMap(t => t.mutations);
  assert.ok(!rows.some(m => ['request.returned', 'request.acknowledge'].includes(m.op)));
  return rows;
}

test('W1c-READMIT409: real surviving upstream conflict ends original, never transfers identity',
  { timeout: 25000 }, () => publicRegistration(async h => {
    const { a, p, raw } = await setup(h);
    const pending = a.call('request_approval', question(p), { id: 'original', ms: 6000 });
    const first = await admitted(h, p); first.disconnect();
    await observe(() => first.socketClosed, 'original downstream actually lost');
    assert.ok(!first.upstreamClosed && !first.committed, 'real broker waiter deliberately survives loss');
    const result = await pending, error = toolError(result, 'WAIT_ALREADY_ACTIVE');
    assert.equal(error.retryable, false); assert.equal(result.frame.id, 'original');
    assert.equal(waits(h).length, 2); assert.equal(waits(h)[1].status, 409);
    assert.deepEqual(error, waits(h)[1].reply.error, 'broker message/code/retryability preserved');
    await delay(1200); assert.equal(waits(h).length, 2); assert.equal(creates(h).length, 1);
    assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1);
    assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
    await cancel(h, p, 'pending'); await observe(() => first.upstreamClosed, 'retained upstream completes');
    assert.equal(first.status, 200); await a.peer.call('ping', {}).outcome;
    assert.equal(raw.frames.filter(f => f.id === 'original').length, 1, 'no late outcome forwarded');
    await h.eof(a); raw.complete(); await noReports(h);
  }, { paired: true, totalMs: 15000 }));

for (const mode of ['notification', 'EOF']) for (const phase of ['registration', 'admission', 'attached', 'turnover', 'backoff', 'terminal'])
  test(`W1c-RACE-${mode}-${phase}: exact transport cleanup, suppression and no late work`,
    { timeout: 60000 }, () => publicRegistration(async h => {
      let { a, p, raw } = await setup(h); const barrier = gate(); let target, terminal;
      if (phase === 'registration') {
        await h.eof(a); raw.complete(); raw = observer();
        a = await h.connect('shared', { observeOutput: raw.attach });
        h.hold(c => c.path === '/v1/adapter');
      } else if (phase === 'admission') h.beforeForward(async c => {
        if (c.path.endsWith('/wait')) { target = c; await barrier.promise; }
      });
      else if (phase === 'turnover') h.hold(c => c.path.endsWith('/wait') && c.status === 204);
      else if (phase === 'terminal') h.hold(c => c.path.endsWith('/wait') && c.status === 200);
      const id = 700, pending = a.call('request_approval', question(p), { id, ms: 45000, suppressed: true });
      try {
        if (phase === 'registration') {
          await observe(() => h.calls.some(c => c.path === '/v1/adapter' && c.held), 'real registration committed and held');
          target = h.calls.find(c => c.path === '/v1/adapter' && c.held); assert.equal(creates(h).length, 0);
        } else if (phase === 'admission') {
          await observe(() => target?.body, 'wait reaches pre-forward admission barrier');
          assert.equal(creates(h).length, 1); assert.equal(creates(h)[0].status, 201);
        } else {
          target = await admitted(h, p);
          if (phase === 'turnover') {
            await h.phase('actual204-cancellation-gap');
            await observe(() => target.held, 'real production204 gap', 30000);
            assert.equal(target.status, 204); assert.equal(target.reply, null);
          } else if (phase === 'backoff') {
            target.disconnect(); await observe(() => target.socketClosed && target.upstreamClosed, 'actual upstream disconnect before retry');
          } else if (phase === 'terminal') {
            terminal = await cancel(h, p, 'pending');
            await observe(() => target.held, 'actual committed terminal response held'); assert.deepEqual(target.reply, terminal);
          }
        }
        assert.equal(raw.frames.filter(f => f.id === id).length, 0, 'barrier precedes any original result');
        const count = waits(h).length, made = creates(h).length;
        if (mode === 'notification') {
          notify(a, id); await a.peer.call('ping', {}).outcome;
          // Registration ensure is shared lifecycle work, not invocation-owned HTTP.
          if (phase !== 'registration') await observe(() => target.socketClosed, 'cancel destroys exact active wait socket');
        } else { await h.eof(a); await observe(() => target.socketClosed, 'EOF destroys active captured transport'); }
        h.hold(() => false); barrier.release(); target.release?.();
        if (phase === 'admission') await observe(() => target.notForwarded, 'cancelled admission never reaches broker');
        if (phase === 'backoff') assert.ok(target.upstreamClosed);
        if (phase === 'attached') await observe(() => target.upstreamClosed, 'actual admitted upstream transport detached');
        await delay(1250); // Exceeds the next real1s reconnect opportunity.
        assert.equal(waits(h).length, count); assert.equal(creates(h).length, made, 'late completion cannot forward/recreate');
        if (mode === 'notification') {
          const control = success(await a.call('prepare_approval')); h.requestSecrets.push(control.request_capability);
          assert.notEqual(control.request_handle, p.request_handle, 'adapter remains usable after one cancellation');
          await h.eof(a);
        }
        raw.complete(); assert.equal((await pending).kind, 'transport-closed');
        assert.equal(raw.frames.filter(f => f.id === id).length, 0, 'no suppressed late result through EOF');
        const traffic = h.calls.length; await delay(150); assert.equal(h.calls.length, traffic, 'closed binding starts no late work');
        const rows = await noReports(h);
        assert.equal(rows.filter(m => m.op === 'request.cancel').length, phase === 'terminal' ? 1 : 0, 'no business cancellation from transport cleanup');
        if (phase !== 'registration' && phase !== 'terminal') {
          // Independent terminal ledger selection proves real upstream waiter detachment, not just relay closure.
          await cancel(h, p, 'unavailable');
        }
        if (phase === 'terminal') assert.equal(target.reply.decision_id, terminal.decision_id, 'no rollback of committed outcome');
        const deletes = h.calls.filter(c => c.method === 'DELETE' && c.at >= target.at);
        if (mode === 'EOF' && phase === 'registration') assert.equal(deletes.length, 0, 'lost authority is not guessed for release');
        else {
          const reg = h.calls.filter(c => c.path === '/v1/adapter').at(-1).reply;
          assert.equal(deletes.length, 1); assert.ok(deletes[0].path.endsWith(reg.registration_id) && deletes[0].header === reg.registration_secret);
        }
      } finally { barrier.release(); }
    }, { paired: true, detachUpstream: true, totalMs: 50000 }));
