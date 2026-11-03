// TEST ONLY: actual fixed-origin client/process/Journal, not Telegram or human receipt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { completed } from './support/startup-guards.mjs';
import { success } from './support/portable-waiting.mjs';
import { controls, status, retired, shown, message, mutations, records, calls, run, receipt, setup, edit, finish } from './support/edits-public.mjs';
const opts = { timeout: 28000 };
const op = method => method === controls ? retired : shown;
async function target(h, q, method) {
  if (method === status) {
    const first = await edit(h, q, controls); h.response(h.r, first, message()); await receipt(h, h.r, retired);
  }
  return edit(h, q, method);
}
async function unchanged(h, q) {
  assert.deepEqual(await q.view(), q.current, 'local service and exact terminal outcome remain usable after real returned reporting');
  assert.equal(mutations(await h.bytes()).filter(m => m.op === 'request.cancel').length, 1);
  assert.ok(!h.r.output.includes('SYNTHETIC_PRIVATE_DETAIL') && !h.r.output.includes('offline-synthetic-token'));
}
test('C2EP-LIFECYCLE: actual public cancel -> controls flush -> exact terminal status -> separate shown flush', opts, () => run(async h => {
  const q = await setup(h); await finish(h, q);
  const history = mutations(await h.bytes()), c = history.find(m => m.op === retired), s = history.find(m => m.op === shown);
  for (const row of [c, s]) {
    assert.equal(row.request_id, q.p.request_id); assert.equal(row.chat_id, '81');
    assert.equal(row.message_id, 700); assert.equal(row.decision_id, q.terminal.decision_id);
  }
  assert.equal(s.delivery_state, q.current.delivery_state);
  assert.ok(history.indexOf(c) < history.indexOf(s));
  const statusRequest = calls(h.r, status)[0];
  const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === retired));
  assert.ok(commit >= 0 && commit < h.r.events.indexOf(statusRequest));
  await unchanged(h, q); await q.close(); await h.stop(h.r);
  const before = await h.bytes(), r = await h.start(); await h.request(r, 'getUpdates'); await delay(1100);
  assert.equal(calls(r, controls).length + calls(r, status).length, 0); assert.equal(await h.bytes(), before);
  await h.stop(r);
}));
const invalid = [
  ['boolean', true], ['wrong-message', message(701)],
  ['wrong-chat', { ...message(), chat: { id: 82, type: 'private' } }],
  ['malformed', { message_id: 700, chat: message().chat }],
];
for (const method of [controls, status]) {
  for (const [name, result] of invalid) test(`C2EP-INVALID-${method}-${name}: no fabricated completion or busy retry`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method); h.response(h.r, req, result);
    await h.wait(h.r, e => e.kind === 'response-delivered' && e.id === req.id, 'invalid response delivered');
    await delay(1200); assert.equal(records(await h.bytes(), op(method)).length, 0);
    assert.equal(calls(h.r, method).length, 1);
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    assert.match(h.r.output, /blocked after an invalid response/);
    await unchanged(h, q); await q.close();
  }));
  for (const code of [403, 404, 400]) test(`C2EP-REJECT-${method}-${code}: inaccessible/not-modified is unfinished until restart`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method);
    h.response(h.r, req, null, { status: code, raw: JSON.stringify({ ok: false, error_code: code,
      description: code === 400 ? 'Bad Request: message is not modified' : 'SYNTHETIC_PRIVATE_DETAIL' }) });
    await h.wait(h.r, e => e.kind === 'response-delivered' && e.id === req.id, 'rejection delivered');
    await delay(1200); assert.equal(records(await h.bytes(), op(method)).length, 0);
    assert.equal(calls(h.r, method).length, 1); assert.match(h.r.output, /blocked after rejection/);
    assert.ok(!h.r.output.includes('credential rejection'));
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    await unchanged(h, q); await q.close(); await h.stop(h.r);
    const r = await h.start(); await h.request(r, 'getUpdates');
    if (method === status) assert.equal(calls(r, controls).length, 0);
    const retry = await edit(h, q, method, r); assert.deepEqual(retry.body, req.body);
    await finish(h, q, r, method, retry); await h.stop(r);
  }));
  for (const fault of ['rate', 'timeout', 'error']) test(`C2EP-RETRY-${method}-${fault}: actual client failure and rate floor -> same payload`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method), at = performance.now();
    if (fault === 'rate') h.response(h.r, req, null, { status: 429,
      raw: JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 2 } }) });
    else h.r.child.send({ kind: 'fault', id: req.id, fault });
    const retry = await h.request(h.r, method, 1);
    assert.ok(performance.now() - at >= (fault === 'rate' ? 1900 : 900), 'local retry floor, not Telegram elapsed guarantee');
    assert.deepEqual(retry.body, req.body); assert.equal(records(retry.bytes, op(method)).length, 0);
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    await finish(h, q, h.r, method, retry); await unchanged(h, q); await q.close();
  }));
  test(`C2EP-CREDENTIAL-${method}: actual 401 stops all Telegram traffic but local terminal read remains usable`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method);
    h.response(h.r, req, null, { status: 401, raw: '{"ok":false,"error_code":401,"description":"SYNTHETIC_PRIVATE_DETAIL"}' });
    await h.wait(h.r, e => e.kind === 'destroy' && e.id === q.poll.id, 'global poll abort');
    h.response(h.r, q.poll, [{ update_id: 8 }]);
    const count = h.r.events.filter(e => e.kind === 'request').length;
    await delay(1200); assert.equal(h.r.events.filter(e => e.kind === 'request').length, count);
    assert.equal(records(await h.bytes(), op(method)).length, 0);
    assert.match(h.r.output, /credential rejection/); await unchanged(h, q); await q.close();
  }));
  test(`C2EP-STOP-${method}: actual in-flight abort cannot accept a later transport result or schedule new work`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method); await q.close(); h.r.child.send({ kind: 'stop' });
    await h.wait(h.r, e => e.kind === 'destroy' && e.id === req.id, 'actual edit abort');
    h.response(h.r, req, message()); assert.equal(await completed(h.r), 0);
    assert.ok(h.r.events.some(e => e.kind === 'response-delivered' && e.id === req.id));
    assert.equal(records(await h.bytes(), op(method)).length, 0); assert.equal(calls(h.r, method).length, 1);
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    const r = await h.start(); await h.request(r, 'getUpdates');
    const retry = await edit(h, q, method, r); assert.deepEqual(retry.body, req.body);
    await finish(h, q, r, method, retry); await h.stop(r);
    // A lost result may repeat the safe edit. This is not exactly-once platform evidence.
  }, 'late'));
  test(`C2EP-DRAIN-${method}: admitted valid Message receipt holds shutdown before storage close`, opts, () => run(async h => {
    const q = await setup(h), req = await target(h, q, method); await q.close(); h.response(h.r, req, message());
    const held = await h.wait(h.r, e => e.kind === 'flush-entered', 'admitted edit fsync held');
    assert.equal(records(held.bytes, op(method)).length, 1, 'written bytes alone are not flush proof');
    h.r.child.send({ kind: 'stop' }); await h.wait(h.r, e => e.kind === 'stop-observed', 'shutdown observed');
    assert.equal(h.r.events.some(e => e.kind === 'storage-close'), false);
    if (method === controls) assert.equal(calls(h.r, status).length, 0);
    h.r.child.send({ kind: 'release' }); assert.equal(await completed(h.r), 0);
    const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === op(method)));
    assert.ok(commit >= 0 && h.r.events.findIndex(e => e.kind === 'storage-close') > commit);
    assert.equal(calls(h.r, method).length, 1); assert.equal(records(await h.bytes(), op(method)).length, 1);
    const r = await h.start(); await h.request(r, 'getUpdates');
    if (method === controls) { assert.equal(calls(r, controls).length, 0); await finish(h, q, r, status); }
    else { await delay(1100); assert.equal(calls(r, controls).length + calls(r, status).length, 0); }
    await h.stop(r);
  }, method === controls ? 'controls-hold' : 'status-hold'));
}
