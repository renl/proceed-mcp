// TEST ONLY: actual whole-poll client boundary and public pairing continuity.
// No divergent snapshots, seeded business history or live Telegram claims.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { lifecycle, gate } from './support/lifecycle-p3.mjs';
import { until } from './support/portable-waiting.mjs';

const opts = { timeout: 60000 };
const rejected = 'Telegram returned an unusable update batch; retrying from the committed cursor';
const wait = (h, check, label) => until(check, label, h.signal);
const cursor = rows => rows.filter(m => m.op === 'telegram.cursor').at(-1).last_update_id;
const receipt = (h, op, p) => wait(h, async () => (await h.records(op, p)).length === 1, op);
const read = (h, p) => h.request(`/v1/requests/${p.request_id}`, { capability: p.request_capability });
const control = async h => (await readFile(h.paths.controlCredentialFile, 'utf8')).trim();
const consume = (h, id) => wait(h, async () => cursor(await h.rows()) === id, 'input cursor');

test('C3-P3-RAW: non-array whole results reject without mutation, valid empty polls and callback continue', opts, () => lifecycle(async h => {
  await h.start(); await h.pair();
  const p = await h.create('raw envelope continuation'), message = await h.mapped(p);
  await receipt(h, 'telegram.presentation.sent', p);
  const initial = await read(h, p); assert.equal(initial.body.resolution, 'pending');
  const position = cursor(await h.rows());
  // Do not use fixture.redeliver(null): its nullish fallback would silently turn
  // the malformed whole result into a valid array. Emit exact HTTP bytes instead.
  for (const value of [null, {}, 'PRIVATE_RAW_POLL_SENTINEL', 17, false]) {
    const before = await readFile(h.paths.journalFile), diagnostics = h.logs.filter(l => l === rejected).length;
    const armed = gate(), sent = [], payloads = [value, []];
    let stage = 0;
    h.fixture.observe((call, res) => {
      if (call.method !== 'getUpdates') return false;
      sent.push(call.body);
      if (stage === 2) { stage++; armed.release(); return false; }
      if (stage > 2) return false;
      const result = payloads[stage++];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result })); return true;
    });
    // Wake the already-held valid poll. The next poll receives our raw result,
    // then an empty control, then reaches an ordinary held poll again.
    h.fixture.redeliver([]);
    await armed.promise;
    assert.equal(h.logs.filter(l => l === rejected).length, diagnostics + 1,
      'malformed result is a failed poll, while [] is a successful empty poll');
    assert.deepEqual(await readFile(h.paths.journalFile), before, 'neither result advances storage');
    assert.equal(cursor(await h.rows()), position);
    assert.equal(sent.length, 3);
    for (const body of sent) {
      assert.equal(body.offset, position + 1, 'retry/empty/continuation keep exact committed successor');
      assert.deepEqual(body.allowed_updates, ['message', 'callback_query']);
    }
  }
  h.fixture.observe(() => false);
  assert.ok(h.logs.every(line => !line.includes('PRIVATE_RAW_POLL_SENTINEL')));
  assert.equal((await read(h, p)).body.resolution, 'pending');
  h.fixture.choose(message, 'a'); await receipt(h, 'request.resolve.telegram', p);
  const resolved = await read(h, p);
  assert.equal(resolved.status, 200); assert.equal(resolved.body.resolution, 'approved');
  assert.equal(resolved.body.delivery_state, 'unavailable', 'no waiter or receipt manufactured');
  assert.equal((await h.records('request.resolve.telegram', p)).length, 1);
}));

test('C3-P3-SNAPSHOT-CONTROL: attempted public re-pair cannot replace pending authority, including after restart', opts, () => lifecycle(async h => {
  const runtime = await h.start(); await h.pair();
  const p = await h.create('immutable pairing continuity'), message = await h.mapped(p);
  await receipt(h, 'telegram.presentation.sent', p);
  const before = await readFile(h.paths.journalFile);
  const issue = await h.request('/v1/pairing', { token: await control(h), method: 'POST', body: {} });
  assert.equal(issue.status, 409);
  assert.deepEqual(await readFile(h.paths.journalFile), before, 'operator reissuance cannot replace pairing');
  for (const id of [7, 8]) {
    const position = h.fixture.enqueue({ message: { message_id: 9000 + id, date: 1,
      from: { id, is_bot: false }, chat: { id, type: 'private' }, text: `/pair ${'f'.repeat(32)}` } });
    await consume(h, position);
    const last = (await h.rows()).at(-1);
    assert.deepEqual(last, { op: 'telegram.cursor', last_update_id: position });
  }
  const rows = await h.rows(), pairings = rows.filter(m => m.op === 'pairing.set');
  assert.equal(pairings.length, 1);
  const creation = rows.find(m => m.op === 'request.create');
  assert.deepEqual(creation.pairing_snapshot, pairings[0].pairing,
    'supporting read-only evidence: sole actual creation copies sole actual pairing');
  const pending = await read(h, p); assert.equal(pending.body.resolution, 'pending');
  await runtime.stop(); await h.start();
  assert.deepEqual((await read(h, p)).body, pending.body, 'ordinary restart preserves pending request');
  const data = message.reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith('a:')).callback_data;
  const id = h.fixture.enqueue({ callback_query: { id: 'foreign_after_restart',
    from: { id: 8, is_bot: false }, message, data } });
  await consume(h, id);
  await wait(h, () => h.fixture.calls.some(c => c.method === 'answerCallbackQuery'
    && c.body.callback_query_id === 'foreign_after_restart'), 'foreign generic refusal');
  assert.deepEqual(h.fixture.calls.find(c => c.body.callback_query_id === 'foreign_after_restart').body,
    { callback_query_id: 'foreign_after_restart', text: 'This request is not available.' });
  assert.equal((await read(h, p)).body.resolution, 'pending');
  assert.equal((await h.records('request.resolve.telegram', p)).length, 0);
  h.fixture.choose(message, 'a'); await receipt(h, 'request.resolve.telegram', p);
  const resolved = await read(h, p);
  assert.equal(resolved.body.resolution, 'approved'); assert.equal(resolved.body.request_id, p.request_id);
  assert.equal((await h.records('pairing.set')).length, 1);
  assert.equal((await h.records('request.resolve.telegram', p)).length, 1);
}));
