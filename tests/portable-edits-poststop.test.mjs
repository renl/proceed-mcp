// TEST ONLY: real CLI/MCP/client/worker/core/Journal, offline HTTPS interception.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { publicPoller } from './support/poller-public.mjs';
import { completed } from './support/startup-guards.mjs';
import { success } from './support/portable-waiting.mjs';
import { controls, status, retired, shown, message, records, calls, receipt, setup, edit, finish } from './support/edits-public.mjs';
for (const method of [controls, status]) test(`C2EP-POSTSTOP-${method}: fulfilled client before stop, real writer after stop, flush before close`,
  { timeout: 28000 }, () => publicPoller(async h => {
    const q = await setup(h), operation = method === controls ? retired : shown;
    if (method === status) {
      const first = await edit(h, q, controls); h.response(h.r, first, message());
      await receipt(h, h.r, retired);
    }
    const req = await edit(h, q, method); await q.close();
    h.response(h.r, req, message());
    const captured = await h.wait(h.r, e => e.kind === 'fulfilled-before-writer', 'client fulfilled, writer not entered');
    const input = { requestId: q.p.request_id, chatId: '81', messageId: 700, decisionId: q.terminal.decision_id };
    if (method === status) input.deliveryState = q.current.delivery_state;
    assert.deepEqual(captured.input, input);
    assert.equal(h.r.events.some(e => e.kind === 'real-writer-entry'), false);
    assert.equal(records(await h.bytes(), operation).length, 0);
    h.r.child.send({ kind: 'stop' });
    const stopped = await h.wait(h.r, e => e.kind === 'stop-observed', 'stop while continuation held');
    assert.ok(h.r.events.indexOf(captured) < h.r.events.indexOf(stopped));
    assert.equal(h.r.events.some(e => e.kind === 'storage-close'), false);
    assert.equal(h.r.events.some(e => e.kind === 'real-writer-entry'), false);
    h.r.child.send({ kind: 'release-writer' });
    const entered = await h.wait(h.r, e => e.kind === 'real-writer-entry', 'real writer entered after stop');
    const held = await h.wait(h.r, e => e.kind === 'flush-entered', 'post-stop receipt fsync held');
    assert.ok(h.r.events.indexOf(stopped) < h.r.events.indexOf(entered));
    const expected = { op: operation, request_id: q.p.request_id, chat_id: '81', message_id: 700,
      decision_id: q.terminal.decision_id };
    if (method === status) expected.delivery_state = q.current.delivery_state;
    assert.deepEqual(records(held.bytes, operation), [expected]);
    const append = h.r.events.find(e => e.kind === 'append-entered' && e.mutations.some(m => m.op === operation));
    assert.ok(h.r.events.indexOf(entered) < h.r.events.indexOf(append));
    assert.ok(h.r.events.indexOf(append) < h.r.events.indexOf(held));
    assert.equal(h.r.events.some(e => e.kind === 'committed' && e.mutations.some(m => m.op === operation)), false);
    assert.equal(h.r.events.some(e => e.kind === 'storage-close'), false, 'shutdown must await valid post-stop writer flush');
    assert.equal(calls(h.r, method).length, 1);
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    h.r.child.send({ kind: 'release' }); assert.equal(await completed(h.r), 0);
    const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === operation));
    const result = h.r.events.findIndex(e => e.kind === 'real-writer-result');
    assert.ok(commit > h.r.events.indexOf(held) && result > commit);
    assert.ok(h.r.events.findIndex(e => e.kind === 'storage-close') > result);
    assert.deepEqual(records(await h.bytes(), operation), [expected]);
    assert.equal(calls(h.r, method).length, 1, 'no new edit or retry after stop');
    const r = await h.start(); await h.request(r, 'getUpdates');
    const a = await h.connect();
    assert.deepEqual(success(await a.call('get_approval', q.key)), q.current);
    await h.stop(a.resource); a.peer.assertComplete();
    if (method === controls) { assert.equal(calls(r, controls).length, 0); await finish(h, q, r, status); }
    else { await delay(1100); assert.equal(calls(r, controls).length + calls(r, status).length, 0); }
    await h.stop(r);
  }, method === controls ? 'controls' : 'status', { mcp: true, preloadPath: 'tests/fixtures/edits-poststop-preload.mjs' }));

test('C2EP-POSTSTOP-CLEANUP: assertion failure at fulfilled barrier retains failure and releases owned writer/flush',
  { timeout: 28000 }, async () => {
    await assert.rejects(publicPoller(async h => {
      const q = await setup(h), req = await edit(h, q, controls); await q.close();
      h.response(h.r, req, message());
      await h.wait(h.r, e => e.kind === 'fulfilled-before-writer', 'cleanup injection barrier');
      throw Error('synthetic poststop assertion failure');
    }, 'controls', { mcp: true, preloadPath: 'tests/fixtures/edits-poststop-preload.mjs' }),
    { code: 'ERR_ASSERTION', message: 'ifError got unwanted exception: synthetic poststop assertion failure' });
    // publicPoller asserts cleanupError before rethrowing assertionError. Matching
    // the exact original failure therefore also requires successful owned cleanup.
  });
