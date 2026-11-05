// TEST ONLY: design5 C2c/7. Core receipts assert worker evidence, not external edits.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-03T00:00:00Z'), opts = { timeout: 10000 };
const unknown = 'req_' + 'f'.repeat(32), otherDecision = 'dec_' + 'f'.repeat(32);
const storage = e => e?.exitCode === 4, invalid = e => storage(e) && e.code === 'JOURNAL_STATE_INVALID';
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const view = h => h.b.snapshot().requests.find(r => r.request_id === h.auth.requestId);
const edits = h => h.b.presentationWork().edits.sort((a, b) => a.message_id - b.message_id);
const fields = (h, extra = {}) => ({ requestId: h.auth.requestId, chatId: '00081', messageId: 7, decisionId: view(h).decision_id, deliveryState: view(h).delivery_state, ...extra });
const shown = (h, extra = {}) => h.b.recordStatusShown(fields(h, extra));
const retired = (h, messageId = 7) => { const { deliveryState, ...input } = fields(h, { messageId }); return h.b.recordControlsRetired(input); };
const mutation = (h, extra = {}) => ({ op: 'telegram.status.shown', request_id: h.auth.requestId, chat_id: '00081', message_id: 7, decision_id: view(h).decision_id, delivery_state: view(h).delivery_state, ...extra });
const status = (h, message_id = 7) => ({ kind: 'status', request_id: h.auth.requestId, chat_id: '00081', message_id, decision_id: view(h).decision_id, delivery_state: view(h).delivery_state, request: view(h) });
async function native(work) {
  const root = resolve('.scratch/c2c-ii'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file, samples = 0;
  const releases = [], h = { now: at, syncing: async () => {}, get b() { return b; }, get j() { return j; }, samples: () => samples,
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    hold() { const entered = gate(), released = gate(); releases.push(released.release); h.syncing = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, 'sync'), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { await h.close(); const initial = await Journal.open(path), seq = initial.sequence; await initial.close(); file = await open(path, 'a');
      j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.syncing(); await file.sync(); }, close: () => file.close() }, seq);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => { samples++; return h.now; } }); },
    async reopen() { await h.start(); await b.recover(); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(mapped = true) { const key = await b.reserveHandle({ ownerId: 'a' }); h.auth = { ownerId: 'a', capability: key.request_capability, requestId: key.request_id };
      await b.createRequest({ ...h.auth, requestHandle: key.request_handle, clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      h.token = (await b.preparePresentation({ requestId: key.request_id })).callback_token; if (mapped) await h.send(7); },
    send: messageId => b.recordPresentationSent({ requestId: h.auth.requestId, callbackToken: h.token, chatId: '00081', messageId }),
    async terminal(kind = 'cancel', live = false) { let waiting;
      if (live) { waiting = b.waitRequest(h.auth); await tick(); }
      const result = kind === 'cancel' ? await b.cancelRequest(h.auth) : (h.now = at + 60000, await b.readRequest(h.auth));
      if (waiting) assert.equal((await waiting).state, 'terminal'); return result; },
    evidence: kind => b[kind === 'ack' ? 'acknowledgeRequest' : 'returnedRequest']({ ...h.auth, decisionId: view(h).decision_id }) };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 }); await work(h);
  } finally { for (const release of releases) release(); h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
test('S-CAL: actual producers, held ledger flush and reopen', opts, () => native(async h => {
  await h.create(); assert.deepEqual(edits(h), []); await h.terminal('cancel', true); assert.equal(view(h).delivery_state, 'pending'); await retired(h);
  const before = view(h), held = h.hold(); let done = false; const p = capture(() => h.evidence('returned')).then(r => { done = true; return r; });
  try { await held.entered(); await tick(); assert.equal(done, false); assert.deepEqual(view(h), before); }
  finally { held.release(); await p; } assert.equal((await p).value.delivery_state, 'returned'); await h.evidence('ack');
  assert.equal(view(h).delivery_state, 'confirmed'); const expected = view(h); await h.reopen(); assert.deepEqual(view(h), expected);
}));
for (const kind of ['cancel', 'expire']) test(`S-WORK-${kind}: controls first per copy, captured independent request and repeat`, opts, () => native(async h => {
  await h.create(); await h.send(8); assert.deepEqual(edits(h), []); await h.terminal(kind); assert.equal(view(h).delivery_state, 'unavailable');
  assert.deepEqual(edits(h).map(e => e.kind), ['controls', 'controls']); await retired(h);
  const expected = status(h); assert.deepEqual(edits(h).filter(e => e.kind === 'status'), [expected]); const copied = edits(h)[0];
  copied.request.event_capability.status = 'evil'; copied.message_id = 99; assert.deepEqual(edits(h)[0], expected);
  const count = h.samples(), request = view(h); h.now = NaN; assert.deepEqual(await shown(h), { shown: true, request });
  assert.deepEqual((await h.rows()).at(-1), [mutation(h)]); assert.equal(h.samples(), count); assert.deepEqual(view(h), request);
  const bytes = await h.bytes(), repeat = await shown(h); repeat.request.event_capability.status = 'evil';
  assert.deepEqual(await shown(h), { shown: false, request }); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.samples(), count);
  assert.deepEqual(edits(h).map(e => [e.kind, e.message_id]), [['controls', 8]]); await retired(h, 8); assert.deepEqual(edits(h), [status(h, 8)]);
  await shown(h, { messageId: 8 }); assert.deepEqual(edits(h), []); h.now = at + (kind === 'expire' ? 60000 : 0);
  await h.reopen(); assert.deepEqual(edits(h), []); assert.deepEqual(view(h), request);
}));
test('S-WRITE: actual returned/ack transitions rederive both copies, old captured work stays immutable', opts, () => native(async h => {
  await h.create(); await h.send(8); await h.terminal(); await retired(h); await retired(h, 8); await shown(h); await shown(h, { messageId: 8 });
  await h.evidence('returned'); const captured = edits(h); assert.deepEqual(captured, [status(h), status(h, 8)]); await shown(h);
  await h.evidence('ack'); assert.equal(captured[0].delivery_state, 'returned'); assert.equal(captured[0].request.delivery_state, 'returned');
  assert.deepEqual(edits(h), [status(h), status(h, 8)]); await shown(h); await shown(h, { messageId: 8 });
  const bytes = await h.bytes(); await h.evidence('returned'); assert.deepEqual(await h.bytes(), bytes); await h.reopen(); assert.deepEqual(edits(h), []);
}));
test('S-RETIRE-BARRIER: status work waits for retirement flush, queued status admits only afterward', opts, () => native(async h => {
  assert.equal(typeof h.b.recordStatusShown, 'function'); await h.create(); await h.terminal(); const work = edits(h), held = h.hold();
  const p = capture(() => retired(h)); let follower, done = false;
  try { await held.entered(); follower = capture(() => shown(h)).then(r => { done = true; return r; });
    await tick(); assert.equal(done, false); assert.deepEqual(edits(h), work); assert.deepEqual(work.map(e => e.kind), ['controls']);
  } finally { held.release(); await p; await follower; }
  assert.equal((await p).value.retired, true); assert.equal((await follower).value.shown, true); assert.deepEqual(edits(h), []);
  assert.deepEqual((await h.rows()).slice(-2).map(r => r[0].op), ['telegram.controls.retired', 'telegram.status.shown']);
}));
test('S-REFUSE: raw argument errors versus binding/stale null with no clock or append', opts, () => native(async h => {
  assert.equal(typeof h.b.recordStatusShown, 'function'); await h.create(); const pendingBytes = await h.bytes();
  assert.equal(await shown(h, { decisionId: otherDecision, deliveryState: 'pending' }), null); assert.deepEqual(await h.bytes(), pendingBytes);
  await h.terminal(); assert.equal(await shown(h), null); await retired(h); const before = view(h), work = edits(h), bytes = await h.bytes(), count = h.samples(); h.now = NaN;
  const bad = [null, [], 'x', ...Object.keys(fields(h)).flatMap(k => [undefined, null, true, {}, [fields(h)[k]]].map(v => ({ ...fields(h), [k]: v }))),
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(messageId => fields(h, { messageId })),
    fields(h, { chatId: 81 }), fields(h, { chatId: '0' }), fields(h, { requestId: 'bad' }), fields(h, { decisionId: 'bad' }),
    ...['not_applicable', '', 'CONFIRMED'].map(deliveryState => fields(h, { deliveryState }))];
  for (const input of bad) await assert.rejects(Promise.resolve().then(() => h.b.recordStatusShown(input)), e => e?.code === 'INVALID_ARGUMENT');
  for (const extra of [{ requestId: unknown }, { chatId: '81' }, { messageId: 8 }, { decisionId: otherDecision }, ...['pending', 'returned', 'confirmed', 'blocked'].map(deliveryState => ({ deliveryState }))]) assert.equal(await shown(h, extra), null);
  assert.deepEqual(view(h), before); assert.deepEqual(edits(h), work); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.samples(), count);
}));
test('S-NOMAP: no status for reserved-only, unmapped or foreign request binding', opts, () => native(async h => {
  assert.equal(typeof h.b.recordStatusShown, 'function'); await h.create(); await h.terminal(); await retired(h); const original = fields(h);
  const reserved = await h.b.reserveHandle({ ownerId: 'a' }); assert.equal(await h.b.recordStatusShown({ ...original, requestId: reserved.request_id }), null);
  await h.create(false); await h.terminal(); const bytes = await h.bytes(); assert.equal(await shown(h), null);
  assert.equal(await h.b.recordStatusShown({ ...original, requestId: h.auth.requestId, decisionId: view(h).decision_id }), null); assert.deepEqual(await h.bytes(), bytes);
  assert.deepEqual(edits(h).map(e => e.request_id), [original.requestId]);
}));
for (const live of [false, true]) test(`S-HISTORY-positive-${live}: full ordered current ledger history, old marker remains valid`, opts, () => native(async h => {
  await h.create(); await h.terminal('cancel', live); await retired(h); const request = view(h);
  if (!live) { const rows = await h.rows(), retirement = rows.pop(), closure = rows.pop(); rows.push([...closure, ...retirement, mutation(h)]); await h.replace(rows); }
  else await h.j.append([mutation(h)]);
  await h.b.recover(); assert.deepEqual(view(h), request); assert.deepEqual(edits(h), []);
  await h.evidence('returned'); assert.deepEqual(edits(h), [status(h)]); await h.j.append([mutation(h)]); await h.b.recover(); assert.deepEqual(edits(h), []);
  await h.evidence('ack'); await h.j.append([mutation(h)]); await h.b.recover(); assert.deepEqual(edits(h), []); await h.reopen(); assert.deepEqual(edits(h), []);
}));
test('S-HISTORY-schema: positive control then missing/extra/raw/binding/state/duplicate negatives retain installed views and bytes', opts, () => native(async h => {
  await h.create(); await h.terminal(); await retired(h); const rows = await h.rows(), sample = mutation(h);
  await h.j.append([sample]); await h.b.recover(); assert.deepEqual(edits(h), []);
  const changes = Object.keys(sample).flatMap(k => [m => { delete m[k]; return m; }, ...[null, true, {}, [sample[k]]].map(v => m => ({ ...m, [k]: v }))]);
  changes.push(m => ({ ...m, timestamp: 'forbidden' }), m => ({ ...m, request_id: unknown }), m => ({ ...m, decision_id: otherDecision }),
    m => ({ ...m, chat_id: 81 }), m => ({ ...m, chat_id: '81' }), ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1, 8].map(message_id => m => ({ ...m, message_id })),
    ...['not_applicable', '', 'CONFIRMED', 'pending', 'returned', 'confirmed', 'blocked'].map(delivery_state => m => ({ ...m, delivery_state })));
  for (const change of changes) { await h.replace(rows); await h.b.recover(); const before = h.b.snapshot(), work = edits(h);
    await h.j.append([change({ ...sample })]); const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(edits(h), work); assert.deepEqual(await h.bytes(), bytes); }
  await h.replace(rows); await h.b.recover(); const before = h.b.snapshot(), work = edits(h); await h.j.append([sample, sample]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(edits(h), work); assert.deepEqual(await h.bytes(), bytes);
}));
for (const mode of ['unretired', 'before-retirement', 'before-mapping', 'pending', 'future-ledger']) test(`S-HISTORY-order-${mode}: no inferred retirement or eventual-ledger validation`, opts, () => native(async h => {
  await h.create(); await h.terminal(); const noRetire = await h.rows(); await retired(h); const sample = mutation(h), rows = await h.rows();
  if (mode === 'unretired') { rows.pop(); rows.push([sample]); }
  if (mode === 'before-retirement') rows.splice(rows.length - 1, 0, [sample]);
  if (mode === 'before-mapping') rows.splice(rows.length - 3, 0, [sample]);
  if (mode === 'pending') { rows.splice(0, rows.length, ...noRetire.slice(0, -1), [sample]); }
  if (mode === 'future-ledger') { await h.evidence('ack'); rows.push([{ ...sample, delivery_state: 'confirmed' }], (await h.rows()).at(-1)); }
  await h.replace(rows); const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, []);
  await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), storage); assert.deepEqual(await h.bytes(), bytes);
}));
for (const first of ['ledger', 'status']) test(`S-RACE-${first}: prearmed sync discriminates serialized pair comparison and install order`, opts, () => native(async h => {
  assert.equal(typeof h.b.recordStatusShown, 'function'); await h.create(); await h.terminal(); await retired(h); const captured = fields(h), before = view(h), count = (await h.rows()).length;
  const held = h.hold(); let done = false; const p = capture(() => first === 'ledger' ? h.evidence('ack') : h.b.recordStatusShown(captured)); let follower;
  try { await held.entered(); follower = capture(() => first === 'ledger' ? h.b.recordStatusShown(captured) : h.evidence('ack')).then(r => { done = true; return r; });
    await tick(); assert.equal(done, false); assert.deepEqual(view(h), before); assert.deepEqual(edits(h), [status(h)]);
  } finally { held.release(); await p; await follower; }
  assert.ifError((await p).error); assert.ifError((await follower).error); assert.equal(view(h).delivery_state, 'confirmed');
  if (first === 'ledger') { assert.equal((await follower).value, null); assert.equal((await h.rows()).length, count + 1); }
  else { assert.equal((await p).value.shown, true); assert.equal((await p).value.request.delivery_state, 'unavailable');
    assert.deepEqual((await h.rows()).slice(count).map(r => r[0].op), ['telegram.status.shown', 'request.acknowledge']); }
  assert.deepEqual(edits(h), [status(h)]); await h.reopen(); assert.deepEqual(edits(h), [status(h)]); await shown(h); assert.deepEqual(edits(h), []);
}));
test('S-FENCE: uncertain status sync fences queued/fresh operations, ordinary reopen retains surviving marker', opts, () => native(async h => {
  assert.equal(typeof h.b.recordStatusShown, 'function'); await h.create(); await h.terminal(); await retired(h); const before = view(h), work = edits(h), held = h.hold(), sync = h.syncing;
  h.syncing = async () => { await sync(); throw new Error('synthetic sync fault'); }; const p = capture(() => shown(h)); let follower;
  try { await held.entered(); follower = capture(() => h.evidence('ack')); } finally { held.release(); await p; await follower; }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error)); const bytes = await h.bytes();
  await assert.rejects(shown(h), storage); await assert.rejects(h.b.status(), storage); assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(view(h), before); assert.deepEqual(edits(h), work);
  h.syncing = async () => {}; await h.reopen(); assert.deepEqual(edits(h), []); assert.deepEqual(await shown(h), { shown: false, request: before });
}));
