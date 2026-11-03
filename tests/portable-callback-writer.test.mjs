// TEST ONLY: design4/5 C3/7 real callback writer, not Telegram or public activation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 10000 };
const iso = n => new Date(n).toISOString(), dec = n => 'dec_' + n.toString(16).padStart(32, '0');
const tick = () => new Promise(r => setImmediate(r));
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
async function native(work) {
  const root = resolve('.scratch/c3-writer'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], now: at, clocks: 0, identities: 0, logs: [],
    writing: async () => {}, syncing: async () => {}, generate: () => dec(h.identities),
    get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.identities, j.sequence, b.telegramCursor()],
    fields: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      messageId: 7 + i, userId: '00071', chatId: '00081', callbackQueryId: 'query-private',
      updateId: 2, resolution: 'approved', ...extra }),
    call: (extra = {}, i = 0) => b.resolveCallback(h.fields(extra, i)),
    ready() { assert.equal(typeof b.resolveCallback, 'function', 'selected callback writer is absent'); },
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...args) => { await h.writing(); if (h.failPhase === 'writing') throw new Error('write fault'); return file.write(...args); },
        sync: async () => { await h.syncing(); if (h.failPhase === 'syncing') throw new Error('sync fault'); return file.sync(); }, close: () => file.close(),
      }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; if (h.now instanceof Error) throw h.now; return h.now; },
        generateDecisionId: () => { h.identities++; return h.generate(); }, logger: (...a) => h.logs.push(a) }); },
    async reopen() { await h.close(); await h.start(); const n = h.clocks; await b.recover(); assert.equal(h.clocks, n); },
    async create(mapped = true) { const key = await b.reserveHandle({ ownerId: 'a' });
      h.keys.push({ ownerId: 'a', requestId: key.request_id, capability: key.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: key.request_handle, capability: key.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: key.request_id }); h.tokens.push(p.callback_token);
      if (mapped) await b.recordPresentationSent({ requestId: key.request_id, callbackToken: p.callback_token,
        chatId: '00081', messageId: 6 + h.keys.length }); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    assert.deepEqual(await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 }), { paired: true });
    h.now = at + 1000; await bounded(() => work(h), 7000, 'callback fixture');
  } finally { for (const release of releases) release(); h.failPhase = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {});
      await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
function privateAbsent(h, value) {
  const text = JSON.stringify(value);
  for (const secret of ['00071', '00081', 'query-private', ...h.tokens, ...h.keys.map(k => k.capability)]) assert.equal(text.includes(secret), false);
}
async function unchanged(h, action) {
  const bytes = await h.bytes(), view = h.b.snapshot(), counts = h.count(); await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.count(), counts);
}
test('CW-CAL: actual producers, prearmed write/sync, closure and reopen', opts, () => native(async h => {
  await h.create(); await h.create(); const before = h.b.snapshot();
  for (const phase of ['writing', 'syncing']) {
    const held = h.hold(phase); let done = false;
    const p = capture(() => phase === 'writing' ? h.b.cancelRequest(h.keys[0]) : h.b.readRequest(h.keys[1])).then(r => { done = true; return r; });
    if (phase === 'syncing') h.now = at + 61000;
    try { await held.entered(); assert.equal(done, false); assert.equal(h.b.snapshot().requests[phase === 'writing' ? 0 : 1].resolution, 'pending'); }
    finally { held.release(); await p; h[phase] = async () => {}; }
    assert.equal((await p).error, undefined);
  }
  assert.equal(before.requests[0].telegram_state, 'sent');
  assert.deepEqual(h.b.snapshot().requests.map(r => r.resolution), ['cancelled', 'expired']);
  const final = h.b.snapshot(); await h.reopen(); assert.deepEqual(h.b.snapshot(), final);
}));
for (const phase of ['writing', 'syncing']) test(`CW-CAL-FAULT-${phase}: actual cancellation calibrates fault and wait cleanup`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase), p = capture(() => h.b.cancelRequest(h.keys[0]));
  try { await held.entered(); h.failPhase = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await bounded(() => wait, 1500, 'failed calibration wait')).error));
  assert.deepEqual(h.b.snapshot(), before); h.failPhase = null; h[phase] = async () => {};
  await h.reopen(); assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'cancelled');
}));
test('CW-RAW: raw validation before state and queue, no coercion', opts, () => native(async h => {
  await h.create(); h.ready(); const f = h.fields();
  const bad = [undefined, null, [], 'x', ...Object.keys(f).flatMap(k => [undefined, null, {}, [f[k]], true].map(v => ({ ...f, [k]: v }))),
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(messageId => ({ ...f, messageId })),
    ...[-1, 1.5, '2', Number.MAX_SAFE_INTEGER].map(updateId => ({ ...f, updateId })),
    ...[{ requestId: 'bad' }, { callbackToken: 'bad' }, { userId: '0' }, { chatId: 81 }, { callbackQueryId: '' }, { resolution: 'responded' }].map(e => ({ ...f, ...e }))];
  const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); const count = h.count();
    for (const input of bad) await assert.rejects(bounded(() => Promise.resolve().then(() => h.b.resolveCallback(input)), 500, 'raw admission'), e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2);
    assert.deepEqual(h.count(), count);
  } finally { held.release(); await p; }
}));
test('CW-BIND: valid unknown/foreign/token/actor/own-tuple refusals have no effects or disclosure', opts, () => native(async h => {
  await h.create(); await h.create(); await h.create(false); h.ready(); h.now = NaN;
  await unchanged(h, async () => {
    for (const extra of [{ requestId: 'req_' + 'f'.repeat(32) }, { callbackToken: 'f'.repeat(32) },
      { userId: '71' }, { userId: '71', updateId: 0 }, { chatId: '81' }, { messageId: 9 }, { messageId: 8 },
      { requestId: h.keys[1].requestId }, { callbackToken: h.tokens[1] }, { requestId: h.keys[2].requestId, callbackToken: h.tokens[2] }]) {
      const r = await h.call(extra); assert.deepEqual(r, { result: 'refused' }); privateAbsent(h, r);
    }
  });
}));
test('CW-STALE: bound duplicate updates never sample, allocate, append or disclose', opts, () => native(async h => {
  await h.create(); h.ready(); h.now = NaN;
  await unchanged(h, async () => { for (const updateId of [0, 1]) assert.deepEqual(await h.call({ updateId }), { result: 'stale' }); });
}));
test('CW-STALE-QUEUE: serialized cursor wins over already admitted pending callback', opts, () => native(async h => {
  await h.create(); h.ready(); const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(2)); let follower;
  const n = h.count(); h.now = NaN;
  try { await held.entered(); follower = capture(() => h.call()); }
  finally { held.release(); await p; h.syncing = async () => {}; }
  assert.deepEqual((await follower).value, { result: 'stale' }); assert.equal(h.clocks, n[0]); assert.equal(h.identities, n[1]);
  assert.deepEqual((await h.rows()).at(-1), [cursor(2)]); assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
}));
for (const resolution of ['approved', 'rejected']) test(`CW-RECORD-${resolution}: exact producer frame, independent view and recovery`, opts, () => native(async h => {
  await h.create(); h.ready(); const counts = h.count(), p = h.b.snapshot().requests[0];
  const r = await h.call({ resolution, ignored: 'no authority' });
  assert.equal(r.result, 'recorded'); const view = r.request;
  assert.deepEqual(r, { result: 'recorded', request: view });
  assert.deepEqual(view, { ...p, resolution, resolved_at: iso(h.now), decision_id: dec(1), delivery_state: 'unavailable' });
  assert.equal(h.clocks, counts[0] + 1); assert.equal(h.identities, counts[1] + 1);
  const row = (await h.rows()).at(-1), record = { op: 'request.resolve.telegram', request_id: p.request_id,
    decision_id: dec(1), resolution, response_text: null, resolved_at: iso(h.now), user_id: '00071', chat_id: '00081', update_id: 2,
    source: { kind: 'callback', message_id: 7, callback_query_id: 'query-private', callback_token: h.tokens[0], reply_prompt_id: null }, delivery_state: 'unavailable' };
  assert.equal(row.length, 2); assert.deepEqual(row.find(m => m.op !== 'telegram.cursor'), record); assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(2));
  privateAbsent(h, { view, logs: h.logs }); assert.equal(view.event_capability.status, 'unverified');
  const saved = structuredClone(view); view.event_capability.status = 'evil'; view.resolution = 'evil';
  const bytes = await h.bytes(); await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], saved); assert.deepEqual(await h.bytes(), bytes);
  h.now = NaN; await unchanged(h, async () => assert.deepEqual(await h.call(), { result: 'stale' }));
  const n = h.count(); const retained = await h.call({ resolution: resolution === 'approved' ? 'rejected' : 'approved', updateId: 3 });
  assert.deepEqual(retained, { result: 'retained', request: saved }); assert.equal(h.clocks, n[0]); assert.equal(h.identities, n[1]);
  assert.deepEqual((await h.rows()).at(-1), [cursor(3)]);
  assert.deepEqual(await h.call({ userId: '71', updateId: 4 }), { result: 'refused' }); assert.equal(h.b.telegramCursor(), 3);
}));
for (const mode of ['live', 'detached', 'invalid', 'lost-during-flush']) test(`CW-WAIT-${mode}: initial ledger, atomic flush then matching original wake`, opts, () => native(async h => {
  await h.create(); h.ready(); const abort = new AbortController(); let valid = true, woke = false;
  const wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: abort.signal, registration: { valid: () => valid } })).then(r => { woke = true; return r; });
  await tick(); if (mode === 'detached') { abort.abort(); await wait; } if (mode === 'invalid') valid = false;
  const before = h.b.snapshot(), held = h.hold('syncing'); let done = false;
  const p = capture(() => h.call()).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), 1);
    if (mode === 'live' || mode === 'lost-during-flush') assert.equal(woke, false);
    if (mode === 'lost-during-flush') { valid = false; abort.abort(); await wait; }
  } finally { held.release(); await p; h.syncing = async () => {}; }
  const result = (await p).value; assert.equal(result.result, 'recorded');
  assert.equal(result.request.delivery_state, mode === 'live' || mode === 'lost-during-flush' ? 'pending' : 'unavailable');
  assert.equal(h.b.telegramCursor(), 2);
  if (mode === 'live') { const observed = await bounded(() => wait, 1500, 'original wait'); assert.deepEqual(observed.value, { state: 'terminal', request: result.request });
    assert.deepEqual(h.b.snapshot().requests[0], observed.value.request); }
  else { abort.abort(); await wait; }
  await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], result.request);
  const confirmed = await h.b.acknowledgeRequest({ ...h.keys[0], decisionId: result.request.decision_id });
  assert.equal(confirmed.delivery_state, 'confirmed');
  assert.equal((await h.b.returnedRequest({ ...h.keys[0], decisionId: result.request.decision_id })).delivery_state, 'confirmed');
}));
test('CW-RETAIN: cursor-only flush, no clock/ID or sibling wake, duplicate no mutation', opts, () => native(async h => {
  await h.create(); await h.create(); h.ready(); const saved = await h.b.cancelRequest(h.keys[0]);
  const abort = new AbortController(); let woke = false;
  const wait = capture(() => h.b.waitRequest({ ...h.keys[1], signal: abort.signal })).then(r => { woke = true; return r; }); await tick();
  h.now = NaN; const n = h.count(), held = h.hold('writing'); let done = false;
  const p = capture(() => h.call()).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.equal(woke, false); assert.equal(h.b.telegramCursor(), 1); }
  finally { held.release(); await p; h.writing = async () => {}; abort.abort(); await wait; }
  assert.deepEqual((await p).value, { result: 'retained', request: saved }); assert.equal(h.clocks, n[0]); assert.equal(h.identities, n[1]);
  assert.deepEqual((await h.rows()).at(-1), [cursor(2)]);
  await unchanged(h, async () => assert.deepEqual(await h.call(), { result: 'stale' }));
}));
test('CW-REJECT-WAIT: exact rejection reaches only the attached original core wait', opts, () => native(async h => {
  await h.create(); h.ready(); const wait = h.b.waitRequest(h.keys[0]); await tick();
  const r = await h.call({ resolution: 'rejected' }); assert.equal(r.request.resolution, 'rejected');
  assert.equal(r.request.response_text, null); assert.equal(r.request.delivery_state, 'pending');
  assert.deepEqual(await bounded(() => wait, 1500, 'rejected wait'), { state: 'terminal', request: r.request });
}));
for (const due of [false, true]) test(`CW-TIME-deadline=${due}: single sample, actual expiry at equality`, opts, () => native(async h => {
  await h.create(); h.ready(); h.now = at + (due ? 61000 : 60999); const n = h.count();
  const r = await h.call(); assert.equal(r.result, due ? 'expired' : 'recorded'); assert.equal(r.request.resolution, due ? 'expired' : 'approved');
  assert.equal(r.request.response_text, null); assert.equal(h.clocks, n[0] + 1); assert.equal(h.identities, n[1] + 1);
  const row = (await h.rows()).at(-1); assert.equal(row.length, 2); assert.equal(row.find(m => m.op !== 'telegram.cursor').op, due ? 'request.expire' : 'request.resolve.telegram');
  if (due) assert.deepEqual(row.find(m => m.op === 'request.expire'), { op: 'request.expire', request_id: h.keys[0].requestId,
    decision_id: dec(1), resolved_at: iso(h.now), delivery_state: 'unavailable' });
  assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(2)); await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], r.request);
}));
test('CW-TIME-invalid: throwing, unusable, unrepresentable and pre-created clocks fail preappend without fencing', opts, () => native(async h => {
  await h.create(); h.ready(); const before = h.b.snapshot(), bytes = await h.bytes(), ids = h.identities;
  for (const value of [new Error('clock'), NaN, Infinity, '0', 1e20, at]) {
    h.now = value; await assert.rejects(capture(() => h.call()).then(r => { if (r.error) throw r.error; }), storage);
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.identities, ids); assert.equal(h.b.telegramCursor(), 1);
  }
  h.now = at + 2000; assert.equal((await h.call()).result, 'recorded');
}));
test('CW-ID-invalid: invalid/throwing decision generators fail preappend and remain usable', opts, () => native(async h => {
  await h.create(); h.ready(); const before = h.b.snapshot(), bytes = await h.bytes();
  for (const generate of [() => null, () => ['dec_' + 'a'.repeat(32)], () => 'bad', () => { throw new Error('generator'); }]) {
    h.generate = generate; await assert.rejects(Promise.resolve().then(() => h.call()), storage);
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.b.telegramCursor(), 1);
  }
  h.generate = () => dec(99); assert.equal((await h.call()).result, 'recorded');
}));
for (const producer of ['cancel', 'expire', 'human']) test(`CW-ID-${producer}: actual global identity producer blocks every other writer`, opts, () => native(async h => {
  await h.create(); await h.create(); h.ready(); h.generate = () => dec(88);
  if (producer === 'cancel') await h.b.cancelRequest(h.keys[0]);
  else if (producer === 'expire') { h.now = at + 61000; await h.b.readRequest(h.keys[0]); h.now = at + 2000; }
  else await h.call();
  await h.reopen();
  const before = h.b.snapshot(), bytes = await h.bytes();
  for (const writer of [() => h.call({ updateId: 3 }, 1), () => h.b.cancelRequest(h.keys[1]), () => { h.now = at + 61000; return h.b.readRequest(h.keys[1]); }]) {
    h.now = at + 2000; await assert.rejects(Promise.resolve().then(writer), e => e?.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION');
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  }
  h.now = at + 2000; h.generate = () => dec(89); assert.equal((await h.call({ updateId: 3 }, 1)).result, 'recorded');
}));
for (const first of ['human', 'cancel', 'expiry']) test(`CW-RACE-${first}: serialized winner only, queued contender rechecks terminal state`, opts, () => native(async h => {
  await h.create(); h.ready(); if (first === 'expiry') h.now = at + 61000;
  const held = h.hold('syncing'); const p = capture(() => first === 'human' ? h.call() : first === 'cancel' ? h.b.cancelRequest(h.keys[0]) : h.b.readRequest(h.keys[0]));
  let second, cancel; const ids = h.identities;
  try { await held.entered(); second = capture(() => h.call({ updateId: 3, resolution: 'rejected' }));
    if (first === 'human') cancel = capture(() => h.b.cancelRequest(h.keys[0])); }
  finally { held.release(); await p; h.syncing = async () => {}; }
  const winner = first === 'human' ? (await p).value.request : (await p).value;
  assert.deepEqual((await second).value, { result: 'retained', request: winner });
  if (cancel) assert.deepEqual((await cancel).value, winner); assert.equal(h.identities, ids + 1);
  const closures = (await h.rows()).flat().filter(m => ['request.resolve.telegram', 'request.cancel', 'request.expire'].includes(m.op));
  assert.equal(closures.length, 1); assert.equal(winner.resolution, first === 'human' ? 'approved' : first === 'cancel' ? 'cancelled' : 'expired');
  assert.deepEqual((await h.rows()).at(-1), [cursor(3)]); await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], winner);
}));
for (const phase of ['writing', 'syncing']) test(`CW-FAULT-${phase}: prearmed real Journal rejection fences followers and affected wait`, opts, () => native(async h => {
  await h.create(); h.ready(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase); const p = capture(() => h.call()); let follower, counts;
  try { await held.entered(); counts = h.count(); follower = capture(() => h.call({ updateId: 3 }));
    h.failPhase = phase;
  } finally { held.release(); }
  const result = await p;
  assert.ok(storage(result.error)); assert.ok(storage((await follower).error)); assert.ok(storage((await bounded(() => wait, 1500, 'failed callback wait')).error));
  assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), 1); assert.deepEqual(h.count(), counts);
  await assert.rejects(Promise.resolve().then(() => h.call({ updateId: 4 })), storage);
  h.failPhase = null; h.writing = h.syncing = async () => {}; await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'approved');
  assert.equal(h.b.telegramCursor(), phase === 'writing' ? 1 : 2);
  if (phase === 'syncing') assert.deepEqual(h.b.snapshot().requests[0], { ...before.requests[0], resolution: 'approved',
    decision_id: dec(1), resolved_at: iso(at + 1000), delivery_state: 'pending' });
}));
test('CW-RACE-DUP: concurrent same update cannot record opposite choices', opts, () => native(async h => {
  await h.create(); h.ready(); const held = h.hold('writing'), n = h.identities, p = capture(() => h.call()); let follower;
  try { await held.entered(); follower = capture(() => h.call({ resolution: 'rejected' })); }
  finally { held.release(); await p; h.writing = async () => {}; }
  assert.equal((await p).value.request.resolution, 'approved'); assert.deepEqual((await follower).value, { result: 'stale' });
  assert.equal(h.identities, n + 1); assert.equal((await h.rows()).flat().filter(m => m.op === 'request.resolve.telegram').length, 1);
}));
