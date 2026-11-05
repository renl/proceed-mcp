// TEST ONLY: design 4/5/7 C2a-i allocation. No send, receipt, wire or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-02T00:00:00Z'), iso = n => new Date(n).toISOString();
const token = 'a'.repeat(32), other = 'b'.repeat(32), opts = { timeout: 10000 };
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
const collision = e => e?.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION';
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = p => Promise.resolve().then(p).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const prepare = (h, id = h.ids[0]) => h.b.preparePresentation({ requestId: id });
const mutation = (id, extra = {}) => ({ op: 'telegram.presentation.prepare', request_id: id, callback_token: token, prepared_at: iso(at), ...extra });
async function native(work, { paired = true, injected = true } = {}) {
  const root = resolve('.scratch/c2a-i'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let b, j, file, generated = 0; const releases = [];
  const h = { ids: [], keys: [], now: at, generate: () => token, writing: async () => {}, syncing: async () => {},
    get b() { return b; }, get j() { return j; }, generated: () => generated, bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { await h.close(); const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...a) => { await h.writing(); return file.write(...a); },
        sync: async () => { await h.syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }, { owner_id: 'b', label: 'B' }],
        port: 43189, clock: () => h.now, ...(injected ? { generateCallbackToken: () => { generated++; return h.generate(); } } : {}) }); },
    async reopen() { await h.start(); await b.recover(); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(ownerId = 'a') { const key = await b.reserveHandle({ ownerId });
      const args = { ownerId, capability: key.request_capability, requestHandle: key.request_handle,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 };
      h.keys.push({ ownerId, capability: key.request_capability, requestId: key.request_id }); h.ids.push(key.request_id);
      return (await b.createRequest(args)).request; } };
  try { await h.start(); await b.recover();
    if (paired) { const c = await b.pairingChallenge(); assert.deepEqual(await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 }), { paired: true }); }
    await work(h);
  } finally { for (const release of releases) release(); h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}

test('C2AI-CAL: actual request producers, private snapshot and ordinary Journal reopen', opts, () => native(async h => {
  const view = await h.create(), rows = await h.rows();
  assert.deepEqual(rows.at(-1)[0].pairing_snapshot, { user_id: '00071', chat_id: '00081', paired_at: iso(at) });
  assert.equal(rows.flat().some(m => m.op === 'telegram.presentation.prepare'), false);
  await h.reopen(); assert.deepEqual(h.b.snapshot().requests, [view]);
  assert.equal(JSON.stringify([h.b.snapshot(), await h.b.status()]).includes('pairing_snapshot'), false);
}));
for (const phase of ['writing', 'syncing']) test(`C2AI-CAL-${phase}: actual Journal hook blocks installation`, opts, () => native(async h => {
  const hold = h.hold(phase), before = h.b.snapshot(); let done = false;
  const p = capture(() => h.b.reserveHandle({ ownerId: 'a' })).then(r => { done = true; return r; });
  try { await hold.entered(); await tick(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); }
  finally { hold.release(); await p; } assert.ok((await p).value.request_id);
}));
test('C2AI-WRITE: creation lower equality, exact allocation, stable retry/reopen and copied work', opts, () => native(async h => {
  const view = await h.create(), before = h.b.snapshot();
  assert.deepEqual(h.b.presentationWork(), { sends: [{ request_id: view.request_id, chat_id: '00081', callback_token: null, request: view, last_failure_code: null }], edits: [] });
  const result = await prepare(h); assert.deepEqual(result, { chat_id: '00081', callback_token: token, request: view });
  assert.deepEqual((await h.rows()).at(-1), [mutation(view.request_id)]);
  const bytes = await h.bytes(); result.request.action = 'changed'; result.request.event_capability.status = 'changed'; result.chat_id = 'evil';
  const work = h.b.presentationWork(); work.sends[0].callback_token = 'evil'; work.sends[0].request.action = 'evil'; work.edits.push('evil');
  const expected = { chat_id: '00081', callback_token: token, request: view };
  assert.deepEqual(await prepare(h), expected); assert.deepEqual(h.b.snapshot(), before);
  assert.deepEqual(h.b.presentationWork(), { sends: [{ request_id: view.request_id, ...expected, last_failure_code: null }], edits: [] });
  assert.deepEqual((await h.b.status()).requests, [view]); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.generated(), 1);
  await h.reopen(); assert.deepEqual(await prepare(h), expected); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.generated(), 1);
}));
test('C2AI-DEFAULT: existing random generator produces a durable raw 32-hex token', opts, () => native(async h => {
  await h.create(); const result = await prepare(h); assert.match(result.callback_token, /^[a-f0-9]{32}$/);
  assert.equal((await h.rows()).at(-1)[0].callback_token, result.callback_token);
}, { injected: false }));
test('C2AI-WAIT: due preparation uses actual expiry/wake and preserves initial pending ledger', opts, () => native(async h => {
  await h.create(); const c = new AbortController(), wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: c.signal }));
  try { await tick(); await h.b.readRequest(h.keys[0]); h.now = at + 60000;
    assert.equal(await prepare(h), null); const result = await bounded(() => wait, 1500, 'expiry wake');
    assert.equal(result.value.state, 'terminal'); assert.equal(result.value.request.resolution, 'expired');
    assert.equal(result.value.request.delivery_state, 'pending'); assert.equal(h.generated(), 0);
  } finally { c.abort(); await wait; }
}));
for (const delta of [-1, 59999, 60000]) test(`C2AI-TIME-${delta}: lower bound/exclusive deadline`, opts, () => native(async h => {
  await h.create(); h.now = at + delta;
  if (delta < 0) { const bytes = await h.bytes(); await assert.rejects(prepare(h), storage); assert.deepEqual(await h.bytes(), bytes); }
  else if (delta < 60000) assert.equal((await prepare(h)).callback_token, token);
  else { assert.equal(await prepare(h), null); assert.equal(h.generated(), 0); assert.deepEqual(h.b.presentationWork(), { sends: [], edits: [] });
    const view = h.b.snapshot().requests[0]; assert.equal(view.resolution, 'expired'); assert.equal(view.delivery_state, 'unavailable');
    assert.equal(view.telegram_state, 'pending'); assert.equal((await h.rows()).at(-1)[0].op, 'request.expire'); }
}));
test('C2AI-SUPPRESS: reserved/unknown/unpaired and cancelled targets allocate nothing', opts, () => native(async h => {
  const key = await h.b.reserveHandle({ ownerId: 'a' }); assert.equal(await prepare(h, key.request_id), null);
  assert.equal(await prepare(h, 'req_' + 'f'.repeat(32)), null); assert.deepEqual(h.b.presentationWork(), { sends: [], edits: [] }); assert.equal(h.generated(), 0);
}, { paired: false }));
test('C2AI-TERMINAL: allocated token retained historically but terminal sends suppressed', opts, () => native(async h => {
  await h.create(); await prepare(h); await h.b.cancelRequest(h.keys[0]); const bytes = await h.bytes();
  assert.equal(await prepare(h), null); assert.deepEqual(h.b.presentationWork(), { sends: [], edits: [] }); assert.deepEqual(await h.bytes(), bytes);
  await h.reopen(); assert.equal(await prepare(h), null); assert.deepEqual(h.b.presentationWork(), { sends: [], edits: [] });
}));
for (const bad of [null, 3, [token], '', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) test(`C2AI-GENERATOR-${JSON.stringify(bad)}`, opts, () => native(async h => {
  await h.create(); h.generate = () => bad; const bytes = await h.bytes(); await assert.rejects(prepare(h), storage); assert.deepEqual(await h.bytes(), bytes);
  h.generate = () => token; assert.equal((await prepare(h)).callback_token, token);
}));
test('C2AI-COLLISION: global across principals and terminal history after reopen', opts, () => native(async h => {
  await h.create(); await prepare(h); await h.b.cancelRequest(h.keys[0]); await h.create('b'); await h.reopen();
  const bytes = await h.bytes(); await assert.rejects(prepare(h, h.ids[1]), collision); assert.deepEqual(await h.bytes(), bytes);
  h.generate = () => other; assert.equal((await prepare(h, h.ids[1])).callback_token, other);
}));
test('C2AI-THROW: generator exception is storage failure before append', opts, () => native(async h => {
  await h.create(); h.generate = () => { throw new Error('generator failed'); }; const bytes = await h.bytes();
  await assert.rejects(prepare(h), storage); assert.deepEqual(await h.bytes(), bytes);
}));
for (const allocated of [false, true]) test(`C2AI-CLOSURE-${allocated}: cancellation/expiry cannot allocate or rotate`, opts, () => native(async h => {
  await h.create(); if (allocated) await prepare(h); await h.b.cancelRequest(h.keys[0]);
  const generated = h.generated(), bytes = await h.bytes(); assert.equal(await prepare(h), null); assert.equal(h.generated(), generated); assert.deepEqual(await h.bytes(), bytes);
  await h.create('b'); if (allocated) { h.generate = () => other; await prepare(h, h.ids[1]); } h.now = at + 60000;
  assert.equal(await prepare(h, h.ids[1]), null); assert.deepEqual(h.b.presentationWork(), { sends: [], edits: [] });
  assert.equal(h.b.snapshot().requests[1].resolution, 'expired');
}));
for (const phase of ['writing', 'syncing']) test(`C2AI-BARRIER-${phase}: no token/installation before flush, queued retry rechecks`, opts, () => native(async h => {
  const view = await h.create(), hold = h.hold(phase); let done = false;
  const p = capture(() => prepare(h)).then(r => { done = true; return r; }); let follower;
  try { await hold.entered(); follower = capture(() => prepare(h)); await tick(); assert.equal(done, false);
    assert.equal(h.b.presentationWork().sends[0].callback_token, null); assert.deepEqual(h.b.snapshot().requests, [view]);
  } finally { hold.release(); await p; await follower; }
  assert.equal((await p).value.callback_token, token); assert.deepEqual(await follower, await p); assert.equal(h.generated(), 1);
}));
test('C2AI-FENCE: sync uncertainty refuses queued/fresh allocation without retry', opts, () => native(async h => {
  await h.create(); await h.create('b'); const before = h.b.snapshot(), hold = h.hold('syncing');
  const held = h.syncing; h.syncing = async () => { await held(); throw Object.assign(new Error('sync failed'), { exitCode: 4, code: 'STORAGE_FAILURE' }); };
  const p = capture(() => prepare(h)); let follower;
  try { await hold.entered(); follower = capture(() => prepare(h, h.ids[1])); } finally { hold.release(); await p; await follower; }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error)); const bytes = await h.bytes();
  await assert.rejects(prepare(h, h.ids[1]), storage); assert.equal(h.generated(), 1); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  h.syncing = async () => {}; await h.reopen(); assert.equal((await prepare(h)).callback_token, token);
}));
const variants = ['op', 'request_id', 'callback_token', 'prepared_at'].flatMap(field => [
  m => { delete m[field]; return m; }, m => ({ ...m, [field]: null }), m => ({ ...m, [field]: [m[field]] })]);
variants.push(m => ({ ...m, extra: 1 }),
  m => ({ ...m, request_id: [m.request_id] }), m => ({ ...m, request_id: 'req_' + 'f'.repeat(32) }),
  m => ({ ...m, callback_token: [token] }), m => ({ ...m, callback_token: null }), m => ({ ...m, callback_token: 'A'.repeat(32) }),
  m => ({ ...m, prepared_at: [m.prepared_at] }), m => ({ ...m, prepared_at: '2026-02-30T00:00:00Z' }),
  m => ({ ...m, callback_token: 3 }), m => ({ ...m, callback_token: 'a'.repeat(31) }), m => ({ ...m, callback_token: 'a'.repeat(33) }),
  m => ({ ...m, prepared_at: '2026-11-02T00:00:00-00:00' }),
  m => ({ ...m, prepared_at: '2026-11-01T23:59:59.999999999Z' }), m => ({ ...m, prepared_at: iso(at + 60000) }));
for (const [n, alter] of variants.entries()) test(`C2AI-REPLAY-${n}: strict history preserves bytes/installed state`, opts, () => native(async h => {
  await h.create(); const before = h.b.snapshot(); await h.j.append([alter(mutation(h.ids[0]))]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
}));
for (const createFirst of [true, false]) test(`C2AI-ORDER-${createFirst}: actual-created frame staged in array order`, opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), creation = rows.pop()[0], allocation = mutation(h.ids[0]);
  await h.replace([...rows, createFirst ? [creation, allocation] : [allocation, creation]]); const bytes = await h.bytes();
  if (createFirst) { await h.b.recover(); assert.equal((await prepare(h)).chat_id, '00081'); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, []); }
  assert.deepEqual(await h.bytes(), bytes);
}));
test('C2AI-PRECISION: valid submillisecond preparation survives clock-free replay', opts, () => native(async h => {
  await h.create(); await h.j.append([mutation(h.ids[0], { prepared_at: '2026-11-02T00:00:59.999999999+00:00' })]);
  h.now = at + 90000; await h.b.recover(); assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
  h.now = at + 59999; assert.equal((await prepare(h)).callback_token, token);
}));
for (const mode of ['valid', 'duplicate', 'reuse', 'history-reuse', 'terminal', 'staged-terminal', 'prepare-then-terminal']) test(`C2AI-STAGED-${mode}`, opts, () => native(async h => {
  await h.create(); await h.create('b'); const first = mutation(h.ids[0]), second = mutation(h.ids[1]);
  if (mode === 'terminal') await h.b.cancelRequest(h.keys[0]);
  const before = h.b.snapshot(), rows = mode === 'duplicate' ? [first, first] : mode === 'reuse' ? [first, second] : [first];
  if (mode === 'history-reuse') { await h.j.append([first]); rows.splice(0, 1, second); }
  if (mode === 'staged-terminal') rows.unshift({ op: 'request.cancel', request_id: h.ids[0], resolved_at: iso(at), decision_id: 'dec_' + 'c'.repeat(32), delivery_state: 'unavailable' });
  if (mode === 'prepare-then-terminal') rows.push({ op: 'request.cancel', request_id: h.ids[0], resolved_at: iso(at), decision_id: 'dec_' + 'c'.repeat(32), delivery_state: 'unavailable' });
  await h.j.append(rows); const bytes = await h.bytes();
  if (mode === 'valid') { await h.b.recover(); assert.equal((await prepare(h)).callback_token, token); assert.deepEqual(h.b.snapshot(), before); }
  else if (mode === 'prepare-then-terminal') { await h.b.recover(); assert.equal(await prepare(h), null); assert.equal(h.b.snapshot().requests[0].resolution, 'cancelled'); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); }
  assert.deepEqual(await h.bytes(), bytes);
}));
