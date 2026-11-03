// TEST ONLY: design4/5 C3/7 opening writer/replay. No prompt, Telegram or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 12000 };
const iso = n => new Date(n).toISOString(), cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
const tick = () => new Promise(r => setImmediate(r));
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function native(work) {
  const root = resolve('.scratch/c3-opening'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], now: at, clocks: 0, ids: 0, logs: [],
    writing: async () => {}, syncing: async () => {}, get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.ids, j.sequence, b.telegramCursor()],
    fields: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      messageId: 7 + i, userId: '00071', chatId: '00081', callbackQueryId: 'private-query', updateId: 2, ...extra }),
    call: (extra = {}, i = 0) => b.openResponse(h.fields(extra, i)),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...args) => { await h.writing(); if (h.fail === 'writing') throw new Error('private write failure'); return file.write(...args); },
        sync: async () => { await h.syncing(); if (h.fail === 'syncing') throw new Error('private sync failure'); return file.sync(); }, close: () => file.close(),
      }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; if (h.now instanceof Error) throw h.now; return h.now; },
        generateDecisionId: () => 'dec_' + (++h.ids).toString(16).padStart(32, '0'), logger: (...a) => h.logs.push(a) }); },
    async reopen() { await h.close(); await h.start(); const c = h.clocks; await b.recover(); assert.equal(h.clocks, c); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(mapped = true) { const key = await b.reserveHandle({ ownerId: 'a' });
      h.keys.push({ ownerId: 'a', requestId: key.request_id, capability: key.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: key.request_handle, capability: key.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: key.request_id }); h.tokens.push(p.callback_token);
      if (mapped) await b.recordPresentationSent({ requestId: key.request_id, callbackToken: p.callback_token, chatId: '00081', messageId: 6 + h.keys.length }); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 });
    h.now = at + 1000; await bounded(() => work(h), 9500, 'opening fixture');
  } finally { releases.forEach(r => r()); h.fail = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
function record(h, extra = {}, i = 0) {
  return { op: 'telegram.response.open', request_id: h.keys[i].requestId, callback_token: h.tokens[i],
    chat_id: '00081', message_id: 7 + i, user_id: '00071', callback_query_id: 'private-query', update_id: 2, opened_at: iso(at + 1000), ...extra };
}
function privateAbsent(h, value) { const text = JSON.stringify(value);
  for (const s of ['00071', '00081', 'private-query', ...h.tokens, ...h.keys.map(k => k.capability)]) assert.equal(text.includes(s), false); }
async function unchanged(h, action) { const bytes = await h.bytes(), view = h.b.snapshot(), n = h.count(); await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.count(), n); }
async function rejectHistory(h, rows) { await h.replace(rows); const bytes = await h.bytes(), before = h.b.snapshot(), work = h.b.presentationWork(), n = h.count();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  assert.deepEqual(h.count(), n); assert.deepEqual(h.b.presentationWork(), work); privateAbsent(h, h.logs); }
for (const phase of ['writing', 'syncing']) test(`RO-CAL-${phase}: actual producers, flush/fault, wait cleanup and recovery`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase); let done = false;
  const p = capture(() => h.b.cancelRequest(h.keys[0])).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); h.fail = phase; }
  finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await bounded(() => wait, 1500, 'calibration wait')).error));
  h.fail = null; h[phase] = async () => {}; await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'cancelled');
}));
test('RO-RAW: selected API raw validation outside blocked queue, no aliases or coercion', opts, () => native(async h => {
  await h.create(); const f = h.fields(), bad = [undefined, null, [], 'x', ...Object.keys(f).flatMap(k =>
    [undefined, null, {}, [f[k]], true].map(v => ({ ...f, [k]: v }))),
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(messageId => ({ ...f, messageId })),
    ...[-1, 1.5, '2', Number.MAX_SAFE_INTEGER].map(updateId => ({ ...f, updateId })),
    ...[{ requestId: 'bad' }, { callbackToken: 'BAD' }, { userId: '0' }, { chatId: '-81' }, { callbackQueryId: '' }].map(e => ({ ...f, ...e }))];
  const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); const n = h.count(); for (const input of bad)
    await assert.rejects(bounded(() => Promise.resolve().then(() => h.b.openResponse(input)), 500, 'raw'), e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2);
    assert.deepEqual(h.count(), n); } finally { held.release(); await p; }
}));
test('RO-BIND: own mapped request role, token, snapshot and paired actor before cursor/privacy', opts, () => native(async h => {
  await h.create(); await h.create(); await h.create(false); h.now = NaN;
  await unchanged(h, async () => { for (const extra of [{ requestId: 'req_' + 'f'.repeat(32) }, { callbackToken: 'f'.repeat(32) },
    { userId: '71' }, { userId: '71', updateId: 0 }, { chatId: '81' }, { messageId: 8 }, { messageId: 99 },
    { requestId: h.keys[1].requestId }, { callbackToken: h.tokens[1] }, { requestId: h.keys[2].requestId, callbackToken: h.tokens[2], messageId: 9 }])
    assert.deepEqual(await h.call(extra), { result: 'refused' }); });
  await unchanged(h, async () => { for (const updateId of [0, 1]) assert.deepEqual(await h.call({ updateId }), { result: 'stale' }); });
}));
for (const phase of ['writing', 'syncing']) test(`RO-OPEN-${phase}: exact atomic opening, no resolution/wake, repeat and restart`, opts, () => native(async h => {
  await h.create(); const abort = new AbortController(); let woke = false;
  const wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: abort.signal })).then(r => { woke = true; return r; }); await tick();
  const before = h.b.snapshot(), n = h.count(), held = h.hold(phase); let done = false, follower;
  const p = capture(() => h.call({ ignored: 'no authority' })).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.equal(woke, false); assert.equal(h.b.telegramCursor(), 1);
    assert.deepEqual(h.b.snapshot(), before); follower = capture(() => h.call({ updateId: 3 })); }
  finally { held.release(); await p; h[phase] = async () => {}; }
  assert.deepEqual((await p).value, { result: 'opened', request: before.requests[0] });
  assert.deepEqual((await follower).value, { result: 'open', request: before.requests[0] }); assert.equal(woke, false);
  assert.equal(h.ids, n[1]); assert.equal(h.clocks, n[0] + 2); const rows = await h.rows(), row = rows.at(-2);
  assert.equal(row.length, 2); assert.deepEqual(row.find(m => m.op !== 'telegram.cursor'), record(h));
  assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(2)); assert.deepEqual(rows.at(-1), [cursor(3)]);
  const view = (await p).value.request; privateAbsent(h, { view, logs: h.logs }); view.event_capability.status = 'evil';
  assert.deepEqual(h.b.snapshot(), before); abort.abort(); await wait; await h.reopen();
  const bytes = await h.bytes(); await unchanged(h, async () => assert.deepEqual(await h.call({ updateId: 3 }), { result: 'stale' }));
  assert.deepEqual(await h.call({ updateId: 4 }), { result: 'open', request: before.requests[0] });
  assert.equal((await h.rows()).flat().filter(m => m.op === 'telegram.response.open').length, 1); assert.ok(bytes.length);
  const closed = await h.b.resolveCallback({ ...h.fields({ updateId: 5 }), resolution: 'approved' });
  assert.equal(closed.request.resolution, 'approved'); assert.equal(closed.request.response_text, null);
}));
test('RO-TIME: deadline first including repeat opening, actual expiry/cursor and original wait', opts, () => native(async h => {
  await h.create(); h.now = at + 60999; const n = h.count(); assert.equal((await h.call()).result, 'opened');
  assert.equal(h.clocks, n[0] + 1); assert.equal(h.ids, n[1]);
  const wait = h.b.waitRequest(h.keys[0]); await tick(); h.now = at + 61000;
  const r = await h.call({ updateId: 3 }); assert.equal(r.result, 'expired'); assert.equal(r.request.resolution, 'expired');
  assert.deepEqual(await bounded(() => wait, 1500, 'expiry wait'), { state: 'terminal', request: r.request });
  const row = (await h.rows()).at(-1); assert.equal(row.length, 2); assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(3));
  assert.deepEqual(row.find(m => m.op === 'request.expire'), { op: 'request.expire', request_id: h.keys[0].requestId,
    decision_id: r.request.decision_id, resolved_at: iso(h.now), delivery_state: 'pending' });
  await h.reopen(); h.now = NaN; const c = h.count(); assert.deepEqual(await h.call({ updateId: 4 }), { result: 'retained', request: r.request });
  assert.equal(h.clocks, c[0]); assert.equal(h.ids, c[1]); assert.deepEqual((await h.rows()).at(-1), [cursor(4)]);
}));
test('RO-CLOCK: invalid/backward times refuse before append, no fence or decision', opts, () => native(async h => {
  await h.create(); const bytes = await h.bytes(), before = h.b.snapshot(), ids = h.ids;
  for (const now of [NaN, Infinity, '0', 1e20, at, new Error('clock-private')]) { h.now = now;
    await assert.rejects(Promise.resolve().then(() => h.call()), storage); assert.deepEqual(await h.bytes(), bytes);
    assert.deepEqual(h.b.snapshot(), before); assert.equal(h.ids, ids); assert.equal(h.b.telegramCursor(), 1); }
  h.now = at + 1000; assert.equal((await h.call()).result, 'opened');
}));
test('RO-DUE-UNOPENED: expiry wins without ever opening, duplicate same update stays stale', opts, () => native(async h => {
  await h.create(); h.now = at + 61000; const r = await h.call(); assert.equal(r.result, 'expired');
  assert.equal((await h.rows()).flat().some(m => m.op === 'telegram.response.open'), false);
  assert.deepEqual(await h.call(), { result: 'stale' }); await h.reopen();
  assert.deepEqual(h.b.snapshot().requests[0], r.request);
}));
test('RO-DUP: simultaneous same update opens once and then stays stale', opts, () => native(async h => {
  await h.create(); const results = await Promise.all([h.call(), h.call()]);
  assert.deepEqual(results.map(r => r.result), ['opened', 'stale']);
  assert.equal((await h.rows()).flat().filter(m => m.op === 'telegram.response.open').length, 1);
}));
for (const first of ['open', 'cancel', 'human', 'expiry', 'cursor']) test(`RO-RACE-${first}: queued contender rechecks committed winner`, opts, () => native(async h => {
  await h.create(); if (first === 'expiry') h.now = at + 61000;
  const held = h.hold('syncing'), p = capture(() => first === 'open' ? h.call() : first === 'cancel' ? h.b.cancelRequest(h.keys[0]) :
    first === 'human' ? h.b.resolveCallback({ ...h.fields(), resolution: 'rejected' }) : first === 'cursor' ? h.b.advanceCursor(3) : h.b.readRequest(h.keys[0])); let follower;
  try { await held.entered(); if (first !== 'open') h.now = NaN; follower = capture(() => h.call({ updateId: 3 })); }
  finally { held.release(); await p; h.syncing = async () => {}; }
  const r = (await follower).value;
  assert.equal(r.result, first === 'open' ? 'open' : first === 'cursor' ? 'stale' : 'retained');
  assert.equal(h.b.snapshot().requests[0].resolution, first === 'open' || first === 'cursor' ? 'pending' : first === 'human' ? 'rejected' : first === 'cancel' ? 'cancelled' : 'expired');
  assert.equal((await h.rows()).flat().filter(m => m.op === 'telegram.response.open').length, first === 'open' ? 1 : 0);
}));
for (const phase of ['writing', 'syncing']) test(`RO-FAULT-${phase}: uncertain opening fences followers/wait and recovers once`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase), p = capture(() => h.call()); let follower;
  try { await held.entered(); follower = capture(() => h.call({ updateId: 3 })); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error));
  assert.ok(storage((await bounded(() => wait, 1500, 'fault wait')).error)); assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), 1);
  await assert.rejects(Promise.resolve().then(() => h.call({ updateId: 4 })), storage);
  h.fail = null; h[phase] = async () => {}; await h.reopen(); assert.equal(h.b.telegramCursor(), phase === 'writing' ? 1 : 2);
  assert.equal((await h.call({ updateId: 4 })).result, phase === 'writing' ? 'opened' : 'open');
}));
for (const first of [false, true]) test(`RO-REPLAY-POS-cursorFirst=${first}: entry cursor, staged mapping, strict fractional lifetime`, opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), receipt = rows.at(-1)[0], prior = rows.slice(0, -1);
  const r = record(h, { opened_at: first ? '2026-11-04T00:01:00.999999999Z' : '2026-11-04T00:00:01.000000001+00:00' });
  await h.replace([...prior, first ? [cursor(2), receipt, r] : [receipt, r, cursor(2)]]); h.now = NaN;
  const n = h.count(), bytes = await h.bytes(); await h.b.recover(); assert.equal(h.clocks, n[0]); assert.equal(h.ids, n[1]);
  assert.equal(h.b.telegramCursor(), 2); assert.deepEqual(await h.bytes(), bytes); await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
  if (!first) { h.now = at + 2000; assert.equal((await h.call({ updateId: 3 })).result, 'open'); }
}));
test('RO-REPLAY-EXACT: all fields/raw types, identity/actor/token/tuple and strict recorded time', opts, () => native(async h => {
  await h.create(); const base = await h.rows(), r = record(h);
  const changes = [...Object.keys(r).flatMap(k => [v => { delete v[k]; }, v => { v[k] = [v[k]]; }]),
    v => { v.extra = true; }, ...[{ request_id: 'req_' + 'f'.repeat(32) }, { callback_token: 'f'.repeat(32) },
      { user_id: '71' }, { chat_id: '81' }, { message_id: 0 }, { message_id: 99 }, { callback_query_id: '' },
      { update_id: Number.MAX_SAFE_INTEGER }, { opened_at: iso(at) }, { opened_at: iso(at + 61000) },
      { opened_at: '2026-02-30T00:00:00Z' }, { opened_at: '2026-11-04T00:00:01-00:00' }].map(e => v => Object.assign(v, e))];
  for (const change of changes) { const v = structuredClone(r); change(v); await rejectHistory(h, [...base, [v, cursor(2)]]); }
}));
test('RO-REPLAY-TX: sole entry-new cursor/source, array-ordered prerequisites, no reopening or partial install', opts, () => native(async h => {
  await h.create(); await h.create(); const base = await h.rows(), r = record(h), other = record(h, {}, 1);
  for (const suffix of [[[r]], [[r], [cursor(2)]], [[cursor(2)], [r]], [[r, cursor(3)]], [[cursor(2), r, cursor(3)]],
    [[r, other, cursor(2)]], [[{ ...r, update_id: 1 }, cursor(1)]], [[r, cursor(2)], [{ ...r, update_id: 3 }, cursor(3)]]])
    await rejectHistory(h, [...base, ...suffix]);
  await h.replace(base); await h.b.recover(); await h.b.resolveCallback({ ...h.fields({}, 1), resolution: 'approved' });
  const human = (await h.rows()).at(-1).find(m => m.op === 'request.resolve.telegram');
  await rejectHistory(h, [...base, [r, human, cursor(2)]]);
  const receipt = base.at(-1)[0]; await rejectHistory(h, [...base.slice(0, -1), [other, receipt, cursor(2)]]);
  await h.replace(base); await h.b.recover(); await h.b.cancelRequest(h.keys[0]); const closed = await h.rows();
  await rejectHistory(h, [...closed, [r, cursor(2)]]);
  await h.replace([...base, [r, cursor(2)]]); await h.b.recover(); const before = h.b.snapshot();
  await h.j.append([{ ...r, update_id: 3 }, cursor(3)]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), 2);
  assert.deepEqual(await h.bytes(), bytes); await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), e => e?.exitCode === 4);
}));
