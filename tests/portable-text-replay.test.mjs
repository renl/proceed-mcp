// TEST ONLY: real producer prefix plus synthetic EXACT text resolution for DECODER proof.
// No actual human writer, raw Telegram admission, command grammar or public outcome proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 12000 };
const iso = n => new Date(n).toISOString(), decision = n => 'dec_' + n.repeat(32);
const cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
async function native(work) {
  const root = resolve('.scratch/c3-text-replay'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j;
  const h = { keys: [], tokens: [], now: at, clocks: 0, ids: 0, logs: [],
    get b() { return b; }, get j() { return j; }, bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    counts: () => [h.clocks, h.ids, j.sequence],
    fields: (i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      chatId: '00081', userId: '00071', messageId: 7 + i, callbackQueryId: 'private-query', updateId: 2 + i }),
    async close() { await b?.close(); await j?.close(); },
    async start() { j = await Journal.open(path); b = createPortableBroker({ journal: j,
      owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
      clock: () => { h.clocks++; return h.now; }, generateDecisionId: () => decision((++h.ids).toString(16)),
      logger: (...args) => h.logs.push(args) }); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); }
      h.now = at + 2000; await h.start(); h.now = NaN; },
    async create(opened = true, prompt = true) { h.now = at + 1000; const k = await b.reserveHandle({ ownerId: 'a' });
      const i = h.keys.length; h.keys.push({ ownerId: 'a', requestId: k.request_id, capability: k.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: k.request_handle, capability: k.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: k.request_id }); h.tokens.push(p.callback_token);
      await b.recordPresentationSent({ requestId: k.request_id, callbackToken: p.callback_token, chatId: '00081', messageId: 7 + i });
      if (opened) await b.openResponse(h.fields(i));
      if (opened && prompt) await b.recordPromptSent({ requestId: k.request_id, chatId: '00081', messageId: 70 + i }); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 });
    await bounded(() => work(h), 9500, 'text replay fixture');
  } finally { try { await h.close(); } finally { await rm(dir, { recursive: true, force: true });
    await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
const textRecord = (h, kind = 'reply', prompt = 70, extra = {}) => ({ op: 'request.resolve.telegram',
  request_id: h.keys[0].requestId, decision_id: decision('a'), resolution: 'responded', response_text: '  yes \u{1f600}\n ',
  resolved_at: iso(at + 2000), user_id: '00071', chat_id: '00081', update_id: 4,
  source: { kind, message_id: 90, callback_query_id: null, callback_token: null, reply_prompt_id: prompt },
  delivery_state: 'unavailable', ...extra });
function privateAbsent(h, value) { const text = JSON.stringify(value);
  for (const secret of ['00071', '00081', 'private-query', ...h.tokens, ...h.keys.map(k => k.capability)])
    assert.equal(text.includes(secret), false, 'private source/authority leaked'); }
async function rejectHistory(h, rows) { await h.replace(rows); const bytes = await h.bytes(), before = h.b.snapshot();
  const work = [h.b.responseWork(), h.b.presentationWork()], counts = h.counts(), position = h.b.telegramCursor();
  await assert.rejects(h.b.recover(), e => { assert.ok(invalid(e)); privateAbsent(h, [e.message, h.logs]); return true; });
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual([h.b.responseWork(), h.b.presentationWork()], work);
  assert.deepEqual(h.counts(), counts); assert.equal(h.b.telegramCursor(), position); assert.deepEqual(await h.bytes(), bytes);
}
test('TR-CAL: real open/prompt/callback producers and clock-free reopen', opts, () => native(async h => {
  await h.create(); assert.deepEqual(h.b.responseWork(), { prompts: [] });
  h.now = at + 2000; assert.equal((await h.b.resolveCallback({ ...h.fields(), updateId: 4, resolution: 'approved' })).result, 'recorded');
  const before = h.b.snapshot(), bytes = await h.bytes(); await h.close(); await h.start(); h.now = NaN;
  const counts = h.counts(); await h.b.recover(); assert.deepEqual(h.counts(), counts);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
}));
for (const [kind, prompt] of [['reply', 70], ['command', 70], ['command', null]]) {
  for (const delivery of ['pending', 'unavailable']) for (const first of [true, false]) {
    test(`TR-POS-${kind}-${prompt}-${delivery}-cursorFirst=${first}`, opts, () => native(async h => {
      await h.create(true, prompt !== null); const rows = await h.rows();
      const r = textRecord(h, kind, prompt, { delivery_state: delivery, response_text: first ? ' ' : '\u{1f600}'.repeat(4096),
        resolved_at: first ? iso(at + 1000) : '2026-11-04T00:01:00.999999999+00:00' });
      rows.push(first ? [cursor(4), r] : [r, cursor(4)]); await h.replace(rows);
      const bytes = await h.bytes(), counts = h.counts(); await h.b.recover(); const view = h.b.snapshot().requests[0];
      assert.equal(view.resolution, 'responded'); assert.equal(view.response_text, r.response_text);
      assert.equal(view.resolved_at, r.resolved_at); assert.equal(view.decision_id, r.decision_id);
      assert.equal(view.delivery_state, delivery); assert.equal(view.delivery_error, null); assert.equal(h.b.telegramCursor(), 4);
      assert.deepEqual(h.counts(), counts); assert.deepEqual(await h.bytes(), bytes); privateAbsent(h, [view, h.logs]);
      h.now = at + 2000; const status = await h.b.status(); assert.equal(status.requests[0].response_text, r.response_text);
      privateAbsent(h, status); view.event_capability.status = 'evil'; assert.equal(h.b.snapshot().requests[0].event_capability.status, 'unverified');
      await h.close(); await h.start(); h.now = NaN; await h.b.recover(); assert.equal(h.b.snapshot().requests[0].response_text, r.response_text);
    }));
  }
}
test('TR-EXACT: text variants and exact raw fields fail closed without installation', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows(), r = textRecord(h);
  const mutations = [...Object.keys(r).flatMap(k => [v => { delete v[k]; }, v => { v[k] = [v[k]]; }]),
    ...Object.keys(r.source).flatMap(k => [v => { delete v.source[k]; }, v => { v.source[k] = [v.source[k]]; }]),
    v => { v.extra = true; }, v => { v.source.extra = true; }, v => { v.source = null; }, v => { v.source = []; },
    ...[null, '', 1, true, {}, '\ud800', '\udc00', 'a\ud800b', 'x'.repeat(4097), '\u{1f600}'.repeat(4097)].map(response_text => v => { v.response_text = response_text; }),
    ...['approved', 'rejected', 'unknown'].map(resolution => v => { v.resolution = resolution; }),
    v => { v.source.kind = 'callback'; }, v => { v.source.kind = 'unknown'; },
    v => { v.source.callback_token = h.tokens[0]; }, v => { v.source.callback_query_id = 'private-query'; },
    ...[null, 0, -1, 1.5, '70', Number.MAX_SAFE_INTEGER + 1, 7, 71, 99].map(reply_prompt_id => v => { v.source.reply_prompt_id = reply_prompt_id; }),
    ...[0, -1, 1.5, '90', Number.MAX_SAFE_INTEGER + 1].map(message_id => v => { v.source.message_id = message_id; }),
    ...[{ user_id: '71' }, { chat_id: '81' }, { request_id: 'req_' + 'f'.repeat(32) }, { decision_id: 'dec_bad' },
      { update_id: -1 }, { update_id: Number.MAX_SAFE_INTEGER }, { delivery_state: 'confirmed' },
      ...['bad', '2026-02-30T00:00:02Z', '2026-11-04T00:00:02-00:00', iso(at), iso(at + 61000)].map(resolved_at => ({ resolved_at }))].map(e => v => Object.assign(v, e))];
  for (const [i, change] of mutations.entries()) { const v = structuredClone(r); change(v);
    try { await rejectHistory(h, [...base, [v, cursor(4)]]); } catch (e) { throw new Error(`text variant ${i}`, { cause: e }); } }
  for (const prompt of [7, 71, 99, 0, '70', Number.MAX_SAFE_INTEGER + 1])
    await rejectHistory(h, [...base, [textRecord(h, 'command', prompt), cursor(4)]]);
}));
test('TR-ORDER: actual prompt mapping precedes consumer, cursor position does not authorize future mapping', opts, () => native(async h => {
  await h.create(); const base = await h.rows(), prompt = base.pop()[0], r = textRecord(h);
  for (const first of [true, false]) { await h.replace([...base, first ? [cursor(4), prompt, r] : [prompt, r, cursor(4)]]);
    await h.b.recover(); assert.equal(h.b.snapshot().requests[0].response_text, r.response_text); }
  for (const rows of [[...base, [cursor(4), r, prompt]], [...base, [r, cursor(4)]],
    [...base.filter(row => !row.some(m => m.op === 'telegram.response.open')), [textRecord(h, 'command', null), cursor(4)]]])
    await rejectHistory(h, rows);
}));
test('TR-TX: entry cursor, single consumer, duplicate terminal and global decision uniqueness', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows(), r = textRecord(h);
  const other = textRecord(h, 'reply', 71, { request_id: h.keys[1].requestId, decision_id: decision('b') });
  for (const suffix of [[[r]], [[r], [cursor(4)]], [[cursor(4)], [r]], [[r, cursor(5)]],
    [[cursor(4), r, cursor(5)]], [[r, other, cursor(4)]], [[r, cursor(4)], [r, cursor(4)]],
    [[{ ...r, update_id: 3 }, cursor(3)]], [[r, cursor(4)], [{ ...other, decision_id: r.decision_id, update_id: 5 }, cursor(5)]]])
    await rejectHistory(h, [...base, ...suffix]);
  h.now = at + 2000; await h.replace(base); await h.b.recover(); h.now = at + 2000; await h.b.cancelRequest(h.keys[1]);
  const closed = (await h.rows()).at(-1), collision = [textRecord(h, 'reply', 70, { decision_id: closed[0].decision_id }), cursor(4)];
  for (const order of [[closed, collision], [collision, closed]]) await rejectHistory(h, [...base, ...order]);
  await rejectHistory(h, [...base, closed, [{ ...other, update_id: 4 }, cursor(4)]]);
}));
test('TR-LEDGER: persisted initial ledger supports ordered evidence, never recovery reachability', opts, () => native(async h => {
  await h.create(); const base = await h.rows(), r = textRecord(h, 'command', null, { delivery_state: 'pending' });
  const evidence = { request_id: r.request_id, decision_id: r.decision_id, delivery_state: 'confirmed' };
  await h.replace([...base, [r, cursor(4), { op: 'request.acknowledge', ...evidence, acknowledged_at: r.resolved_at },
    { op: 'request.returned', ...evidence, returned_at: r.resolved_at }]]); const counts = h.counts(); await h.b.recover();
  assert.deepEqual(h.counts(), counts); assert.equal(h.b.snapshot().requests[0].delivery_state, 'confirmed');
}));
test('TR-STAGED: later bad member retains installed outcomes/work/cursor and fences fresh writes', opts, () => native(async h => {
  await h.create(); await h.create(); const rows = await h.rows(), r = textRecord(h); rows.push([r, cursor(4)]);
  await h.replace(rows); await h.b.recover(); const before = h.b.snapshot(), work = [h.b.responseWork(), h.b.presentationWork()], counts = h.counts();
  await h.j.append([textRecord(h, 'reply', 71, { request_id: h.keys[1].requestId, decision_id: decision('b'), update_id: 5 }), cursor(5),
    { op: 'telegram.prompt.sent', request_id: 'req_' + 'f'.repeat(32), chat_id: '00081', message_id: 999, sent_at: iso(at + 2000) }]);
  const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual([h.b.responseWork(), h.b.presentationWork()], work);
  assert.equal(h.b.telegramCursor(), 4); assert.deepEqual(h.counts().slice(0, 2), counts.slice(0, 2)); assert.deepEqual(await h.bytes(), bytes);
  await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), e => e?.exitCode === 4);
}));
