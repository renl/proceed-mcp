// TEST ONLY: design4/5 C3/7 prompt-sent core. Primitive receipts are NOT Telegram Message/wire proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 12000 };
const iso = n => new Date(n).toISOString(), unknown = 'req_' + 'f'.repeat(32);
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function native(work) {
  const root = resolve('.scratch/c3-prompt-sent'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], now: at, clocks: 0, ids: 0, logs: [],
    writing: async () => {}, syncing: async () => {}, get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.ids, j.sequence, b.telegramCursor()],
    fields: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      chatId: '00081', messageId: 7 + i, userId: '00071', callbackQueryId: 'private-query', updateId: 2 + i, ...extra }),
    send: (extra = {}, i = 0) => b.recordPromptSent({ requestId: h.keys[i].requestId, chatId: '00081', messageId: 70, ...extra }),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...args) => { await h.writing(); if (h.fail === 'writing') throw new Error('private fault'); return file.write(...args); },
        sync: async () => { await h.syncing(); if (h.fail === 'syncing') throw new Error('private fault'); return file.sync(); }, close: () => file.close(),
      }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; if (h.now instanceof Error) throw h.now; return h.now; },
        generateDecisionId: () => 'dec_' + (++h.ids).toString(16).padStart(32, '0'), logger: (...a) => h.logs.push(a) }); },
    async reopen() { await h.close(); h.now = at + 2000; await h.start(); h.now = NaN;
      const n = h.count().slice(0, 3); await b.recover(); assert.deepEqual(h.count().slice(0, 3), n); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(opened = true) { const key = await b.reserveHandle({ ownerId: 'a' });
      const i = h.keys.length; h.keys.push({ ownerId: 'a', requestId: key.request_id, capability: key.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: key.request_handle, capability: key.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: key.request_id }); h.tokens.push(p.callback_token);
      await b.recordPresentationSent({ requestId: key.request_id, callbackToken: p.callback_token, chatId: '00081', messageId: 7 + i });
      if (opened) assert.equal((await b.openResponse(h.fields({}, i))).result, 'opened'); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 });
    h.now = at + 1000; await bounded(() => work(h), 9500, 'prompt fixture');
  } finally { releases.forEach(r => r()); h.fail = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
const sent = (h, extra = {}, i = 0) => ({ op: 'telegram.prompt.sent', request_id: h.keys[i].requestId,
  chat_id: '00081', message_id: 70, sent_at: iso(at + 1000), ...extra });
function privateAbsent(h, value) { const text = JSON.stringify(value);
  for (const secret of ['00071', '00081', 'private-query', ...h.tokens, ...h.keys.map(k => k.capability)])
    assert.equal(text.includes(secret), false, secret); }
async function unchanged(h, action) { const bytes = await h.bytes(), before = h.b.snapshot(), n = h.count(); await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.count(), n); }
async function rejectHistory(h, rows) { h.now = at + 2000; await h.replace(rows); const bytes = await h.bytes(), before = h.b.snapshot();
  const work = h.b.responseWork(), presentation = h.b.presentationWork(), n = h.count(); h.now = NaN;
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  assert.deepEqual(h.b.responseWork(), work); assert.deepEqual(h.b.presentationWork(), presentation); assert.deepEqual(h.count(), n); }
for (const phase of ['writing', 'syncing']) test(`PS-CAL-${phase}: real producers, held closure fault, waiter fence and reopen`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase); let done = false;
  const p = capture(() => h.b.cancelRequest(h.keys[0])).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); h.fail = phase; }
  finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await bounded(() => wait, 1500, 'calibration wait')).error));
  h.fail = null; h[phase] = async () => {}; await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'cancelled');
}));
test('PS-WORK: opened pending unmapped only, copied snapshot chat/request, restart and expiry', opts, () => native(async h => {
  await h.create(false); assert.deepEqual(h.b.responseWork(), { prompts: [] });
  await h.b.openResponse(h.fields()); const view = h.b.snapshot().requests[0], n = h.count();
  const work = h.b.responseWork(); assert.deepEqual(work, { prompts: [{ request_id: h.keys[0].requestId, chat_id: '00081', request: view }] });
  work.prompts[0].request.event_capability.status = 'evil'; work.prompts.length = 0;
  assert.equal(h.b.responseWork().prompts[0].request.event_capability.status, view.event_capability.status); assert.deepEqual(h.count(), n);
  await h.reopen(); assert.equal(h.b.responseWork().prompts.length, 1); h.now = at + 61000;
  assert.equal((await h.b.readRequest(h.keys[0])).resolution, 'expired'); assert.deepEqual(h.b.responseWork(), { prompts: [] });
}));
test('PS-BIND: raw validation and closed/unknown/snapshot/request-role refusal have no effects', opts, () => native(async h => {
  await h.create(false); await unchanged(h, async () => assert.equal(await h.send(), null));
  await h.b.openResponse(h.fields()); h.now = NaN;
  await unchanged(h, async () => { for (const extra of [{ requestId: unknown }, { chatId: '81' }, { messageId: 7 }])
    assert.equal(await h.send(extra), null); });
  const good = { requestId: h.keys[0].requestId, chatId: '00081', messageId: 70 };
  const bad = [null, [], 'x', ...Object.keys(good).flatMap(k => [undefined, null, {}, [good[k]], true].map(v => ({ ...good, [k]: v }))),
    ...[0, -1, 1.5, '70', Number.MAX_SAFE_INTEGER + 1].map(messageId => ({ ...good, messageId }))];
  const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); const n = h.count(); for (const input of bad)
    await assert.rejects(bounded(() => Promise.resolve().then(() => h.b.recordPromptSent(input)), 500, 'raw'), e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2);
    assert.deepEqual(h.count(), n); } finally { held.release(); await p; }
}));
for (const phase of ['writing', 'syncing']) test(`PS-SENT-${phase}: flush before work suppression, exact receipt and concurrent idempotence`, opts, () => native(async h => {
  await h.create(); const abort = new AbortController(); let woke = false;
  const wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: abort.signal })).then(r => { woke = true; return r; }); await tick();
  try { const before = h.b.snapshot(), work = h.b.responseWork(), n = h.count(), held = h.hold(phase); let done = false, follower;
    const p = capture(() => h.send()).then(r => { done = true; return r; });
    try { await held.entered(); assert.equal(done, false); assert.equal(woke, false); assert.deepEqual(h.b.snapshot(), before);
      assert.deepEqual(h.b.responseWork(), work); follower = capture(() => h.send()); }
    finally { held.release(); await p; h[phase] = async () => {}; }
    assert.deepEqual((await p).value, { sent: true, request: before.requests[0] });
    assert.deepEqual((await follower).value, { sent: false, request: before.requests[0] }); assert.equal(woke, false);
    assert.deepEqual(h.count().slice(0, 2), [n[0] + 1, n[1]]); assert.equal(h.b.telegramCursor(), n[3]);
    assert.deepEqual((await h.rows()).at(-1), [sent(h)]); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), { prompts: [] });
    (await p).value.request.event_capability.status = 'evil'; assert.deepEqual(h.b.snapshot(), before);
    h.now = NaN; await unchanged(h, async () => assert.deepEqual(await h.send(), { sent: false, request: before.requests[0] }));
    h.now = at + 1000; privateAbsent(h, [h.b.snapshot(), await h.b.status(), h.logs]);
  } finally { abort.abort(); await wait; }
  await h.reopen(); await unchanged(h, async () => assert.equal((await h.send()).sent, false));
  assert.deepEqual(h.b.responseWork(), { prompts: [] });
}));
test('PS-ROLES: actual multiple prompt producer, cross-request/role collisions both directions, callback and edit exclusion', opts, () => native(async h => {
  await h.create(); await h.create(); assert.equal((await h.send()).sent, true); assert.equal((await h.send({ messageId: 71 })).sent, true);
  h.now = NaN; await unchanged(h, async () => { assert.equal(await h.send({}, 1), null);
    for (const i of [0, 1]) assert.equal(await h.b.recordPresentationSent({ requestId: h.keys[i].requestId,
      callbackToken: h.tokens[i], chatId: '00081', messageId: 70 }), null);
    for (const resolution of ['approved', 'rejected']) assert.deepEqual(await h.b.resolveCallback(h.fields({ messageId: 70, updateId: 4, resolution })), { result: 'refused' });
    assert.deepEqual(await h.b.openResponse(h.fields({ messageId: 70, updateId: 4 })), { result: 'refused' }); });
  h.now = at + 1001; assert.equal((await h.send({ messageId: 72 }, 1)).sent, true);
  await h.b.cancelRequest(h.keys[0]); const view = h.b.snapshot().requests[0], decisionId = view.decision_id;
  assert.deepEqual(h.b.presentationWork().edits.map(e => e.message_id), [7]);
  const tuple = { requestId: h.keys[0].requestId, chatId: '00081', messageId: 70, decisionId };
  h.now = NaN; await unchanged(h, async () => { assert.equal(await h.b.recordControlsRetired(tuple), null);
    assert.equal(await h.b.recordStatusShown({ ...tuple, deliveryState: view.delivery_state }), null); });
  await h.b.recordControlsRetired({ ...tuple, messageId: 7 });
  assert.deepEqual(h.b.presentationWork().edits.map(e => [e.kind, e.message_id]), [['status', 7]]);
  await h.reopen(); assert.deepEqual(h.b.presentationWork().edits.map(e => [e.kind, e.message_id]), [['status', 7]]);
  await unchanged(h, async () => assert.equal(await h.send({}, 1), null));
  const rows = await h.rows(), retired = rows.at(-1)[0];
  await rejectHistory(h, [...rows, [{ ...retired, message_id: 70 }]]);
}));
for (const closure of ['cancelled', 'approved', 'rejected', 'expired']) test(`PS-LATE-${closure}: retains new copies without reopening or ledger/Telegram changes`, opts, () => native(async h => {
  await h.create(); if (closure === 'cancelled') await h.b.cancelRequest(h.keys[0]);
  else if (closure === 'expired') { h.now = at + 61000; await h.b.readRequest(h.keys[0]); }
  else await h.b.resolveCallback(h.fields({ resolution: closure, updateId: 3 }));
  const before = h.b.snapshot(), edits = h.b.presentationWork().edits; h.now = at + 100000;
  assert.deepEqual(await h.send(), { sent: true, request: before.requests[0] }); assert.equal((await h.send({ messageId: 71 })).sent, true);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), { prompts: [] }); assert.deepEqual(h.b.presentationWork().edits, edits);
  await h.reopen(); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), { prompts: [] });
  await unchanged(h, async () => assert.equal((await h.send()).sent, false));
}));
test('PS-CLOCK: invalid/backward samples never append, retained fractional opening bounds writer exactly', opts, () => native(async h => {
  await h.create(); const rows = await h.rows(); rows.at(-1).find(m => m.op === 'telegram.response.open').opened_at = '2026-11-04T00:00:01.000000001Z';
  await h.replace(rows); await h.b.recover(); await h.reopen(); const bytes = await h.bytes(), before = h.b.snapshot(), work = h.b.responseWork(), ids = h.ids;
  for (const now of [NaN, Infinity, null, '1', at, at + 1000, new Error('private clock')]) { h.now = now;
    await assert.rejects(Promise.resolve().then(() => h.send()), storage); assert.deepEqual(await h.bytes(), bytes);
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), work); assert.equal(h.ids, ids); }
  h.now = at + 1001; assert.equal((await h.send()).sent, true); privateAbsent(h, h.logs);
}));
for (const phase of ['writing', 'syncing']) test(`PS-FAULT-${phase}: uncertain append fences queued/fresh work and wait, surviving frame recovers`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), work = h.b.responseWork(), held = h.hold(phase), p = capture(() => h.send()); let follower;
  try { await held.entered(); follower = capture(() => h.send({ messageId: 71 })); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error));
  assert.ok(storage((await bounded(() => wait, 1500, 'fault wait')).error)); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), work);
  await assert.rejects(Promise.resolve().then(() => h.send()), storage); await assert.rejects(h.b.status(), storage);
  h.fail = null; h[phase] = async () => {}; await h.reopen(); assert.deepEqual(h.b.snapshot().requests, before.requests);
  assert.equal(h.b.responseWork().prompts.length, phase === 'writing' ? 1 : 0); h.now = at + 2000;
  assert.equal((await h.send()).sent, phase === 'writing'); privateAbsent(h, h.logs);
}));
test('PS-REPLAY-POS: array-ordered opening and exact offset/fraction receipt, no recovery clock or public change', opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), opening = rows.pop();
  opening.find(m => m.op === 'telegram.response.open').opened_at = '2026-11-04T00:00:01.000000002Z';
  const receipt = sent(h, { sent_at: '2026-11-04T00:00:01.000000002+00:00' });
  await h.replace([...rows, [...opening, receipt]]); const bytes = await h.bytes(), n = h.count(); h.now = NaN;
  await h.b.recover(); assert.deepEqual(h.count().slice(0, 3), n.slice(0, 3)); assert.deepEqual(await h.bytes(), bytes);
  assert.equal(h.b.snapshot().requests[0].resolution, 'pending'); assert.equal(h.b.snapshot().requests[0].telegram_state, 'sent');
  assert.deepEqual(h.b.responseWork(), { prompts: [] }); await h.reopen();
  await unchanged(h, async () => assert.equal((await h.send()).sent, false));
  await rejectHistory(h, [...rows, [...opening, { ...receipt, sent_at: '2026-11-04T00:00:01.000000001Z' }]]);
}));
test('PS-REPLAY-EXACT: schema/raw types/time/chat/global-role/duplicate/staged order rejection preserves installed state', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows(), r = sent(h);
  const changes = [...Object.keys(r).flatMap(k => [v => { delete v[k]; }, v => { v[k] = null; }, v => { v[k] = [v[k]]; }]),
    v => { v.extra = true; }, ...[{ request_id: unknown }, { chat_id: '81' }, { chat_id: 81 }, { message_id: 7 },
      ...[0, -1, 1.5, '70', Number.MAX_SAFE_INTEGER + 1].map(message_id => ({ message_id })),
      ...['2026-02-30T00:00:00Z', '2026-11-04T00:00:01-00:00', '2026-11-04T00:00:00.999999999Z'].map(sent_at => ({ sent_at }))].map(e => v => Object.assign(v, e))];
  for (const change of changes) { const v = structuredClone(r); change(v); await rejectHistory(h, [...base, [v]]); }
  const openingIndex = base.findIndex(row => row.some(m => m.op === 'telegram.response.open'));
  for (const rows of [[...base, [r, r]], [...base, [r], [{ ...r, request_id: h.keys[1].requestId }]],
    [...base, [r], [{ ...base.at(-2)[0], message_id: 70 }]],
    [...base.slice(0, openingIndex), [r, ...base[openingIndex]], ...base.slice(openingIndex + 1)],
    base.filter(row => !row.some(m => m.op === 'telegram.response.open')).concat([[r]])]) await rejectHistory(h, rows);
  h.now = at + 2000; await h.replace(base); await h.b.recover(); await h.send();
  const before = h.b.snapshot(), work = h.b.responseWork(); await h.j.append([{ ...r, message_id: 71 }, r]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.responseWork(), work);
  assert.deepEqual(await h.bytes(), bytes); await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), e => e?.exitCode === 4);
}));
test('PS-NO-UPPER: receipt records an overdue admitted result, only the expiry writer closes work', opts, () => native(async h => {
  await h.create(); h.now = at + 61000; const before = h.b.snapshot(), n = h.ids;
  assert.deepEqual(await h.send(), { sent: true, request: before.requests[0] });
  assert.deepEqual(h.b.snapshot(), before); assert.equal(h.ids, n);
  assert.deepEqual((await h.rows()).at(-1), [sent(h, { sent_at: iso(h.now) })]);
  assert.equal((await h.b.readRequest(h.keys[0])).resolution, 'expired'); assert.deepEqual(h.b.responseWork(), { prompts: [] });
}));
