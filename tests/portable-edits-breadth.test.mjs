// TEST ONLY: public producers and actual fixed-origin client. No external network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { publicPoller, update, paired } from './support/poller-public.mjs';
import { completed } from './support/startup-guards.mjs';
import { success } from './support/portable-waiting.mjs';
import { controls, status, retired, shown, message, records, mutations, calls, envelope, receipt, setup } from './support/edits-public.mjs';
const opts = { timeout: 28000 };
const run = (work, mode = '', expiry = false) => publicPoller(work, mode, { mcp: true,
  preloadPath: 'tests/fixtures/edits-breadth-preload.mjs',
  ...(expiry ? { totalMs: 85000, aggregateMs: 95000 } : {}) });
// This observer is armed before its producer. It never calls a read/status route.
function observe(r, predicate, ms = 3000) {
  let listener, timer, finish;
  const close = () => { clearTimeout(timer); r.child.off('message', listener); finish?.(); };
  const value = new Promise((done, reject) => {
    finish = done;
    listener = e => { if (predicate(e)) { done(e); close(); } };
    r.child.on('message', listener);
    timer = setTimeout(() => { reject(Error('prearmed producer observation deadline')); close(); }, ms);
  });
  // A setup failure can precede awaiting the observer. Retain its rejection for
  // the await, but do not create an unhandled rejection during guaranteed cleanup.
  value.catch(() => {});
  return { value, close };
}
async function pending(h, copies = false, expiry = false) {
  h.response(h.r, h.initial, [update(7, h.code)]);
  const confirm = await h.request(h.r, 'sendMessage'); assert.deepEqual(confirm.body, { chat_id: '81', text: paired });
  h.response(h.r, confirm, message(699)); const poll = await h.request(h.r, 'getUpdates', 1);
  const a = await h.connect(), p = success(await a.call('prepare_approval', { session_label: 'breadth <caller>' }));
  const key = { request_id: p.request_id, request_capability: p.request_capability };
  let settled = false;
  const result = a.call('request_approval', { request_handle: p.request_handle, request_capability: p.request_capability,
    client_request_id: 'breadth', action: 'Proceed <exact>?', context: 'one\ntwo & unchanged', expires_in_seconds: 60 },
    { id: 42, ms: expiry ? 82000 : 14000 });
  result.then(() => { settled = true; });
  const question = await h.request(h.r, 'sendMessage', 1);
  assert.equal(records(question.bytes, 'request.create').length, 1);
  assert.equal(records(question.bytes, 'telegram.presentation.prepare').length, 1);
  assert.equal(records(question.bytes, 'telegram.presentation.sent').length, 0);
  if (copies) {
    h.r.child.send({ kind: 'copy-start' });
    const second = await h.request(h.r, 'sendMessage', 2);
    envelope(second, 'sendMessage', question.body);
    h.response(h.r, second, message(701));
    await h.wait(h.r, e => e.kind === 'committed' && records(e.bytes, 'telegram.presentation.sent').length === 1, 'second producer mapping');
    h.r.child.send({ kind: 'copy-stop' }); await h.wait(h.r, e => e.kind === 'copy-stopped', 'extra worker drain');
  }
  h.response(h.r, question, message());
  await h.wait(h.r, e => e.kind === 'committed' && records(e.bytes, 'telegram.presentation.sent').length === (copies ? 2 : 1), 'all independent mappings');
  const mapped = records(await h.bytes(), 'telegram.presentation.sent');
  assert.deepEqual(mapped.map(m => m.message_id).sort(), copies ? [700, 701] : [700]);
  for (const m of mapped) { assert.equal(m.request_id, p.request_id); assert.equal(m.chat_id, '81');
    assert.equal(m.callback_token, records(question.bytes, 'telegram.presentation.prepare')[0].callback_token); }
  assert.equal(settled, false, 'mapping is not a decision');
  return { a, p, key, poll, question, result, close: async () => { await h.stop(a.resource); a.peer.assertComplete(); } };
}
async function cancel(h, q, heldReturned = false) {
  q.terminal = success(await q.a.call('cancel_approval', q.key));
  assert.equal(q.terminal.resolution, 'cancelled'); assert.equal(q.terminal.response_text, null);
  assert.deepEqual(success(await q.result), q.terminal);
  await (heldReturned ? h.wait(h.r, e => e.kind === 'returned-held', 'actual returned producer held') : receipt(h, h.r, 'request.returned'));
  q.current = { ...q.terminal, ...(heldReturned ? {} : { delivery_state: 'returned' }) };
}
async function wire(h, q, method, index = 0, r = h.r, expectedId = 700) {
  const req = await h.request(r, method, index), body = { chat_id: '81', message_id: expectedId };
  if (method === controls) body.reply_markup = { inline_keyboard: [] };
  else body.text = q.question.body.text.replace('Resolution: pending', `Resolution: ${q.current.resolution}`)
    .replace('Delivery: not_applicable', `Delivery: ${q.current.delivery_state}`);
  envelope(req, method, body); return req;
}
const has = (e, op) => e.kind === 'committed' && e.mutations.some(m => m.op === op);
function exactReceipts(bytes, q, states) {
  const base = { request_id: q.p.request_id, chat_id: '81', message_id: 700, decision_id: q.terminal.decision_id };
  assert.deepEqual(records(bytes, retired), [{ op: retired, ...base }]);
  assert.deepEqual(records(bytes, shown), states.map(delivery_state => ({ op: shown, ...base, delivery_state })));
}
async function accept(h, req, op, r = h.r) {
  const observer = observe(r, e => has(e, op));
  try { h.response(r, req, message(req.body.message_id)); return await observer.value; }
  finally { observer.close(); }
}
async function ack(h, q) {
  const observer = observe(h.r, e => has(e, 'request.acknowledge'));
  try {
    const value = success(await q.a.call('acknowledge_approval', { ...q.key, decision_id: q.terminal.decision_id }));
    assert.deepEqual(value, { ...q.current, delivery_state: 'confirmed' }); await observer.value;
    q.current = value;
  } finally { observer.close(); }
}
for (const code of [403, 404, 401, 409, 'api409']) test(`C2EB-COPIES-${code}: independently produced mapped siblings and scoped cessation`, opts, () => run(async h => {
  const q = await pending(h, true); await cancel(h, q);
  // Insertion order is established by actual send completions, not seeded tuples.
  const first = await wire(h, q, controls, 0, h.r, 701);
  h.response(h.r, first, null, { status: code === 'api409' ? 200 : code,
    raw: JSON.stringify({ ok: false, error_code: code === 'api409' ? 409 : code, description: 'PRIVATE_409' }) });
  if (code === 401) {
    await h.wait(h.r, e => e.kind === 'destroy' && e.id === q.poll.id, 'global credential abort');
    const count = h.r.events.filter(e => e.kind === 'request').length;
    await delay(1200); assert.equal(h.r.events.filter(e => e.kind === 'request').length, count);
    assert.equal(records(await h.bytes(), retired).length + records(await h.bytes(), shown).length, 0);
    assert.match(h.r.output, /credential rejection/);
  } else {
    await accept(h, await wire(h, q, controls, 1), retired);
    await accept(h, await wire(h, q, status), shown);
    await delay(1100);
    const bytes = await h.bytes();
    exactReceipts(bytes, q, ['returned']);
    assert.equal(records(bytes, retired).some(m => m.message_id === 701), false);
    assert.equal(calls(h.r, status).some(c => c.body.message_id === 701), false, 'failed retirement never unlocks status');
    assert.equal(calls(h.r, controls).length, 2); assert.equal(calls(h.r, status).length, 1);
    assert.match(h.r.output, /blocked after rejection/); assert.ok(!h.r.output.includes('credential rejection'));
    if (code === 409 || code === 'api409') {
      h.response(h.r, q.poll, [{ update_id: 8 }]);
      assert.equal((await h.request(h.r, 'getUpdates', 2)).body.offset, 9);
      assert.equal(h.r.output.split('Telegram question presentation blocked after rejection; repair Telegram access and restart serve').length - 1, 1);
    }
  }
  assert.ok(!h.r.output.includes('PRIVATE_409'));
  assert.deepEqual(success(await q.a.call('get_approval', q.key)), q.current); await q.close();
}));
for (const code of [409, 'api409', 'healthy']) test(`C2EB-STATUS-${code}: actual client rejection isolates mapped tuple and preserves polling`, opts, () => run(async h => {
  const q = await pending(h, true); await cancel(h, q);
  await accept(h, await wire(h, q, controls, 0, h.r, 701), retired);
  await accept(h, await wire(h, q, controls, 1), retired);
  const first = await wire(h, q, status, 0, h.r, 701);
  if (code === 'healthy') await accept(h, first, shown);
  else h.response(h.r, first, null, { status: code === 'api409' ? 200 : 409,
    raw: JSON.stringify({ ok: false, error_code: 409, description: 'PRIVATE_409' }) });
  await accept(h, await wire(h, q, status, 1), shown);
  h.response(h.r, q.poll, [{ update_id: 8 }]);
  assert.equal((await h.request(h.r, 'getUpdates', 2)).body.offset, 9);
  await delay(1200);
  const bytes = await h.bytes();
  assert.deepEqual(records(bytes, shown).map(m => m.message_id), code === 'healthy' ? [701, 700] : [700]);
  assert.deepEqual(records(bytes, retired).map(m => m.message_id), [701, 700]);
  assert.equal(calls(h.r, status).length, 2);
  assert.equal(h.r.output.split('Telegram question presentation blocked after rejection; repair Telegram access and restart serve').length - 1, code === 'healthy' ? 0 : 1);
  assert.ok(!/PRIVATE_409|processing stopped|credential rejection/.test(h.r.output));
  assert.deepEqual(success(await q.a.call('get_approval', q.key)), q.current); await q.close();
}));
for (const transition of ['returned', 'ack']) test(`C2EB-STALE-${transition}: actual captured status rejected after real ledger commit`, opts, () => run(async h => {
  const q = await pending(h); await cancel(h, q, transition === 'returned');
  await accept(h, await wire(h, q, controls), retired);
  const req = await wire(h, q, status);
  h.response(h.r, req, message());
  const captured = await h.wait(h.r, e => e.kind === 'fulfilled-before-writer', 'actual client fulfilled before ledger change');
  assert.equal(captured.input.deliveryState, q.current.delivery_state);
  assert.equal(h.r.events.some(e => e.kind === 'real-writer-entry'), false);
  if (transition === 'returned') {
    const observer = observe(h.r, e => has(e, 'request.returned'));
    try { h.r.child.send({ kind: 'release-returned' }); await observer.value; }
    finally { observer.close(); }
    q.current = { ...q.current, delivery_state: 'returned' };
  } else await ack(h, q);
  h.r.child.send({ kind: 'release-writer' });
  const next = await wire(h, q, status, 1);
  assert.equal(records(next.bytes, shown).length, 0, 'stale result appends no shown marker');
  assert.notEqual(next.body.text, req.body.text);
  await accept(h, next, shown);
  exactReceipts(await h.bytes(), q, [q.current.delivery_state]);
  await q.close();
}, transition === 'returned' ? 'returned' : 'stale'));

test('C2EB-FLUSH: admitted shown flush precedes queued real acknowledgement and current re-edit', opts, () => run(async h => {
  const q = await setup(h); await accept(h, await wire(h, q, controls), retired);
  const req = await wire(h, q, status); h.response(h.r, req, message());
  const held = await h.wait(h.r, e => e.kind === 'flush-entered', 'shown fsync held');
  assert.equal(records(held.bytes, shown).length, 1);
  const observer = observe(q.a.resource, e => e.kind === 'local-response' && e.path.endsWith('/acknowledge'));
  let finished = false;
  const acknowledgement = q.a.call('acknowledge_approval', { ...q.key, decision_id: q.terminal.decision_id });
  acknowledgement.then(() => { finished = true; });
  // Preload emits actual broker writer entry, before its serialization turn.
  await h.wait(h.r, e => e.kind === 'acknowledge-entered', 'real acknowledgement queued');
  assert.equal(finished, false); assert.equal(records(await h.bytes(), 'request.acknowledge').length, 0);
  assert.equal(h.r.events.some(e => has(e, shown)), false);
  h.r.child.send({ kind: 'release' });
  try { q.current = success(await acknowledgement); await observer.value; } finally { observer.close(); }
  assert.equal(q.current.delivery_state, 'confirmed');
  const firstCommit = h.r.events.findIndex(e => has(e, shown));
  assert.ok(firstCommit > h.r.events.indexOf(held));
  assert.ok(h.r.events.findIndex(e => has(e, 'request.acknowledge')) > firstCommit);
  const history = mutations(await h.bytes());
  assert.ok(history.findIndex(m => m.op === shown) < history.findIndex(m => m.op === 'request.acknowledge'));
  const next = await wire(h, q, status, 1);
  // Release is one-shot for each sync barrier, so prearm the next release.
  const flush = observe(h.r, e => e.kind === 'flush-entered');
  const committed = observe(h.r, e => has(e, shown) && records(e.bytes, shown).length === 2);
  try { h.response(h.r, next, message()); await flush.value; h.r.child.send({ kind: 'release' }); await committed.value; }
  finally { flush.close(); committed.close(); }
  exactReceipts(await h.bytes(), q, ['returned', 'confirmed']);
  await q.close();
}, 'flush'));

test('C2EB-POSTSTOP-STALE: fulfilled client before stop, real ledger change, stale writer after stop', opts, () => run(async h => {
  const q = await setup(h); await accept(h, await wire(h, q, controls), retired);
  const req = await wire(h, q, status); h.response(h.r, req, message());
  const captured = await h.wait(h.r, e => e.kind === 'fulfilled-before-writer', 'actual fulfilled status held');
  assert.equal(captured.input.deliveryState, 'returned');
  assert.equal(h.r.events.some(e => e.kind === 'real-writer-entry'), false);
  await ack(h, q); await q.close();
  h.r.child.send({ kind: 'stop' }); const stopped = await h.wait(h.r, e => e.kind === 'stop-observed', 'stop before stale writer');
  h.r.child.send({ kind: 'release-writer' }); assert.equal(await completed(h.r), 0);
  const entered = h.r.events.find(e => e.kind === 'real-writer-entry');
  const result = h.r.events.find(e => e.kind === 'real-writer-result');
  assert.ok(h.r.events.indexOf(entered) > h.r.events.indexOf(stopped)); assert.ok(result);
  assert.equal(records(await h.bytes(), shown).length, 0);
  exactReceipts(await h.bytes(), q, []);
  assert.equal(h.r.events.some(e => e.kind === 'append-entered' && e.mutations.some(m => m.op === shown)), false);
  assert.equal(calls(h.r, status).length, 1); assert.equal(calls(h.r, controls).length, 1);
  assert.ok(h.r.events.findIndex(e => e.kind === 'storage-close') > h.r.events.indexOf(result));
}, 'poststop'));

test('C2EB-EXPIRY: original public 60s request expires autonomously, exact expired UI and stable restart',
  { timeout: 100000 }, () => run(async h => {
    const expired = observe(h.r, e => has(e, 'request.expire'), 73000);
    try {
      const started = performance.now(), q = await pending(h, false, true);
      const created = records(q.question.bytes, 'request.create')[0];
      assert.equal(Date.parse(created.expires_at) - Date.parse(created.created_at), 60000);
      const event = await expired.value;
      assert.ok(performance.now() - started >= 59000, 'no deadline rewriting');
      assert.equal(records(event.bytes, 'request.cancel').length, 0);
      const outcome = await q.result; assert.equal(outcome.frame.id, 42);
      q.terminal = success(outcome); assert.equal(q.terminal.resolution, 'expired'); assert.equal(q.terminal.response_text, null);
      assert.match(q.terminal.decision_id, /^dec_[a-f0-9]{32}$/);
      await receipt(h, h.r, 'request.returned'); q.current = { ...q.terminal, delivery_state: 'returned' };
      await accept(h, await wire(h, q, controls), retired);
      await accept(h, await wire(h, q, status), shown);
      exactReceipts(await h.bytes(), q, ['returned']);
      const history = mutations(await h.bytes());
      assert.ok(history.findIndex(m => m.op === 'request.expire') < history.findIndex(m => m.op === retired));
      assert.ok(history.findIndex(m => m.op === retired) < history.findIndex(m => m.op === shown));
      await q.close(); await h.stop(h.r);
      const r = await h.start(); await h.request(r, 'getUpdates'); const a = await h.connect();
      assert.deepEqual(success(await a.call('get_approval', q.key)), q.current);
      await delay(1100); assert.equal(calls(r, controls).length + calls(r, status).length, 0);
      await h.stop(a.resource); a.peer.assertComplete(); await h.stop(r);
    } finally { expired.close(); }
  }, '', true));
