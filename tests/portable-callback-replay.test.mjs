// TEST ONLY: design 4/5 C3/7 callback replay. Not a Telegram update or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';

const at = Date.parse('2026-11-04T00:00:00Z');
const iso = n => new Date(n).toISOString();
const decision = n => 'dec_' + n.repeat(32);
const token = n => n.toString(16).repeat(32);
const cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
const opts = { timeout: 10000 };
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
function human(h, index = 0, extra = {}) {
  return { op: 'request.resolve.telegram', request_id: h.keys[index].requestId,
    decision_id: decision('a'), resolution: 'approved', response_text: null,
    resolved_at: iso(at + 2000), user_id: '00071', chat_id: '00081', update_id: 2,
    source: { kind: 'callback', message_id: 7 + index, callback_query_id: 'query-private',
      callback_token: token(index + 1), reply_prompt_id: null }, delivery_state: 'unavailable', ...extra };
}
async function native(work) {
  const root = resolve('.scratch/c3-replay');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let b, j;
  const h = { keys: [], now: at, clocks: 0, identities: 0, logs: [],
    get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    async close() { await b?.close(); await j?.close(); },
    async start() {
      j = await Journal.open(path);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; return h.now; },
        generateDecisionId: () => { h.identities++; return decision((10 + h.identities).toString(16)); },
        generateCallbackToken: () => token(h.keys.length), logger: (...args) => h.logs.push(args) });
    },
    async replace(rows) {
      await h.close(); await rm(path);
      const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); }
      await h.start();
    },
    async create(mapped = true) {
      h.now = at + 1000;
      const key = await b.reserveHandle({ ownerId: 'a' });
      h.keys.push({ ownerId: 'a', requestId: key.request_id, capability: key.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: key.request_handle,
        capability: key.request_capability, clientRequestId: 'same', action: 'Question?',
        context: '', expiresInSeconds: 60 });
      await b.preparePresentation({ requestId: key.request_id });
      if (mapped) await b.recordPresentationSent({ requestId: key.request_id,
        callbackToken: token(h.keys.length), chatId: '00081', messageId: 6 + h.keys.length });
    },
  };
  try {
    await h.start(); await b.recover();
    const challenge = await b.pairingChallenge();
    assert.deepEqual(await b.completePairing({ code: challenge.code, userId: '00071',
      chatId: '00081', updateId: 1 }), { paired: true });
    await work(h);
  } finally {
    try { await h.close(); } finally {
      await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' });
    }
  }
}
function privateAbsent(h, value) {
  const text = JSON.stringify(value);
  for (const secret of ['00071', '00081', 'query-private', token(1), token(2), ...h.keys.map(k => k.capability)]) {
    assert.equal(text.includes(secret), false, 'private authority leaked');
  }
}
async function rejectHistory(h, rows) {
  await h.replace(rows);
  const bytes = await h.bytes(), before = h.b.snapshot(), work = h.b.presentationWork();
  const clocks = h.clocks, identities = h.identities;
  await assert.rejects(h.b.recover(), e => {
    assert.ok(invalid(e)); privateAbsent(h, { message: e.message, logs: h.logs }); return true;
  });
  assert.deepEqual(h.b.snapshot(), before);
  assert.deepEqual(h.b.presentationWork(), work);
  assert.deepEqual(await h.bytes(), bytes);
  assert.equal(h.clocks, clocks); assert.equal(h.identities, identities);
}
test('CR-CAL: real paired create/prepare/sent and closure producers survive reopen', opts, () => native(async h => {
  await h.create(); await h.create();
  h.now = at + 2000; await h.b.cancelRequest(h.keys[0]);
  h.now = at + 61000; await h.b.readRequest(h.keys[1]);
  const before = h.b.snapshot(), bytes = await h.bytes();
  assert.deepEqual(before.requests.map(r => r.resolution), ['cancelled', 'expired']);
  assert.equal(before.requests[0].telegram_state, 'sent');
  await h.close(); await h.start();
  const clocks = h.clocks; await h.b.recover();
  assert.equal(h.clocks, clocks); assert.deepEqual(h.b.snapshot(), before);
  assert.deepEqual(await h.bytes(), bytes);
}));
for (const resolution of ['approved', 'rejected']) for (const delivery of ['pending', 'unavailable']) {
  for (const first of [true, false]) test(`CR-POS-${resolution}-${delivery}-cursorFirst=${first}`, opts, () => native(async h => {
    await h.create(); const rows = await h.rows();
    const record = human(h, 0, { resolution, delivery_state: delivery,
      resolved_at: resolution === 'approved' ? iso(at + 1000) : '2026-11-04T00:01:00.999999999Z' });
    rows.push(first ? [cursor(2), record] : [record, cursor(2)]);
    await h.replace(rows);
    const bytes = await h.bytes(), clocks = h.clocks, ids = h.identities;
    await h.b.recover();
    const view = h.b.snapshot().requests[0];
    assert.equal(view.resolution, resolution); assert.equal(view.delivery_state, delivery);
    assert.equal(view.decision_id, decision('a')); assert.equal(view.response_text, null);
    assert.equal(view.resolved_at, record.resolved_at); assert.equal(view.delivery_error, null);
    assert.equal(h.b.telegramCursor(), 2); privateAbsent(h, { view, logs: h.logs });
    assert.equal(h.clocks, clocks); assert.equal(h.identities, ids);
    assert.deepEqual(await h.bytes(), bytes);
    view.event_capability.status = 'verified';
    assert.equal(h.b.snapshot().requests[0].event_capability.status, 'unverified');
    await h.close(); await h.start(); await h.b.recover();
    assert.equal(h.b.snapshot().requests[0].delivery_state, delivery);
  }));
}
test('CR-LEDGER: evidence uses the staged human ledger, never recovery reachability', opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), id = h.keys[0].requestId;
  rows.push([human(h, 0, { delivery_state: 'pending' }), cursor(2),
    { op: 'request.acknowledge', request_id: id, decision_id: decision('a'), acknowledged_at: iso(at + 2000), delivery_state: 'confirmed' },
    { op: 'request.returned', request_id: id, decision_id: decision('a'), returned_at: iso(at + 2000), delivery_state: 'confirmed' }]);
  await h.replace(rows); h.now = NaN;
  const clocks = h.clocks; await h.b.recover();
  assert.equal(h.clocks, clocks); assert.equal(h.b.snapshot().requests[0].delivery_state, 'confirmed');
}));
const badRecords = [
  ['missing-delivery', r => { delete r.delivery_state; }], ['extra', r => { r.extra = true; }],
  ...['request_id', 'decision_id', 'resolution', 'resolved_at', 'user_id', 'chat_id', 'delivery_state'].map(field =>
    [`raw-${field}`, r => { r[field] = [r[field]]; }]),
  ['raw-update', r => { r.update_id = '2'; }], ['null-source', r => { r.source = null; }],
  ['negative-update', r => { r.update_id = -1; }], ['unsafe-update', r => { r.update_id = Number.MAX_SAFE_INTEGER; }],
  ['zero-message', r => { r.source.message_id = 0; }], ['fraction-message', r => { r.source.message_id = 1.5; }],
  ['source-extra', r => { r.source.extra = true; }], ['source-missing', r => { delete r.source.reply_prompt_id; }],
  ['source-array', r => { r.source = [r.source]; }],
  ...['kind', 'message_id', 'callback_query_id', 'callback_token'].map(field =>
    [`source-raw-${field}`, r => { r.source[field] = [r.source[field]]; }]),
  ['empty-query', r => { r.source.callback_query_id = ''; }],
  ['reply-prompt', r => { r.source.reply_prompt_id = 7; }],
  ['foreign-user', r => { r.user_id = '71'; }], ['foreign-chat', r => { r.chat_id = '81'; }],
  ['foreign-token', r => { r.source.callback_token = token(2); }],
  ['foreign-message', r => { r.source.message_id = 99; }],
  ['unknown-request', r => { r.request_id = 'req_' + 'f'.repeat(32); }],
  ['bad-id', r => { r.decision_id = 'dec_bad'; }], ['bad-time', r => { r.resolved_at = '2026-02-30T00:00:00Z'; }],
  ['non-UTC', r => { r.resolved_at = '2026-11-04T00:00:02-00:00'; }],
  ['early', r => { r.resolved_at = iso(at); }], ['deadline-equal', r => { r.resolved_at = iso(at + 61000); }],
  ['text-on-callback', r => { r.response_text = 'yes'; }], ['responded-callback', r => { r.resolution = 'responded'; r.response_text = 'yes'; }],
  ['bad-delivery', r => { r.delivery_state = 'returned'; }],
  ...['reply', 'command', 'unknown'].map(kind => [`invalid-${kind}-with-approved-callback-fields`, r => { r.source.kind = kind; }]),
];
test('CR-EXACT: schema, raw types, UTC lifetime, actor and source binding', opts, () => native(async h => {
  await h.create(); const base = await h.rows();
  const missing = Object.keys(human(h)).map(field => [`missing-${field}`, r => { delete r[field]; }]);
  const missingSource = Object.keys(human(h).source).map(field => [`missing-source-${field}`, r => { delete r.source[field]; }]);
  for (const [name, change] of [...badRecords, ...missing, ...missingSource]) {
    const record = human(h); change(record);
    try { await rejectHistory(h, [...base, [record, cursor(2)]]); }
    catch (error) { throw new Error(name, { cause: error }); }
  }
}));
test('CR-HUMAN-IDS: separate callback decisions cannot reuse a terminal identity', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows();
  await rejectHistory(h, [...base, [human(h), cursor(2)], [human(h, 1, { update_id: 3 }), cursor(3)]]);
}));
test('CR-TX: sole same-transaction source/cursor, entry cursor and ordered dependencies', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows();
  const r = human(h), other = human(h, 1, { decision_id: decision('c') });
  for (const suffix of [ [[r]], [[r], [cursor(2)]], [[cursor(2)], [r]],
    [[cursor(2), r, cursor(3)]], [[r, cursor(3)]], [[r, other, cursor(2)]],
    [[{ ...r, update_id: 1 }, cursor(1)]], [[r, cursor(2)], [{ ...r, update_id: 3 }, cursor(3)]] ]) {
    await rejectHistory(h, [...base, ...suffix]);
  }
  for (const source of [other.source, { ...r.source, callback_token: token(2) },
    { ...r.source, message_id: 8 }]) await rejectHistory(h, [...base, [{ ...r, source }, cursor(2)]]);
  const receipt = base.at(-1)[0], prior = base.slice(0, -1);
  await rejectHistory(h, [...prior, [other, cursor(2)]]);
  // Cursor position is independent. A mapping is not: it must precede its consumer.
  await h.replace([...prior, [cursor(2), receipt, other]]); await h.b.recover();
  assert.equal(h.b.snapshot().requests[1].resolution, 'approved');
  await rejectHistory(h, [...prior, [cursor(2), other, receipt]]);
}));
for (const closure of ['cancelled', 'expired']) for (const humanFirst of [false, true]) {
  test(`CR-GLOBAL-${closure}-humanFirst=${humanFirst}`, opts, () => native(async h => {
    await h.create(); await h.create(); const base = await h.rows();
    h.now = closure === 'expired' ? at + 61000 : at + 2000;
    if (closure === 'expired') await h.b.readRequest(h.keys[1]); else await h.b.cancelRequest(h.keys[1]);
    const closed = (await h.rows()).at(-1);
    const resolved = [human(h, 0, { decision_id: closed[0].decision_id }), cursor(2)];
    await rejectHistory(h, [...base, ...(humanFirst ? [resolved, closed] : [closed, resolved])]);
  }));
}
test('CR-STAGED: a later invalid member preserves installed outcomes, mappings, cursor and fences', opts, () => native(async h => {
  await h.create(); const rows = await h.rows(); rows.push([human(h), cursor(2)]);
  await h.replace(rows); await h.b.recover();
  const before = h.b.snapshot(), work = h.b.presentationWork(), clocks = h.clocks;
  await h.j.append([cursor(3), { ...human(h), update_id: 3 }]);
  const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work);
  assert.equal(h.b.telegramCursor(), 2);
  await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), e => e?.exitCode === 4);
  assert.equal(h.clocks, clocks); assert.deepEqual(await h.bytes(), bytes);
}));
