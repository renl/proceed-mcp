// TEST ONLY: design5 C2c/7. Core receipts assert worker evidence, never Telegram edits.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-03T00:00:00Z'), opts = { timeout: 10000 };
const unknown = 'req_' + 'f'.repeat(32), decision = 'dec_' + 'f'.repeat(32);
const storage = e => e?.exitCode === 4, invalid = e => storage(e) && e.code === 'JOURNAL_STATE_INVALID';
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const controls = h => h.b.presentationWork().edits.filter(e => e.kind === 'controls').sort((a, b) => a.message_id - b.message_id);
const fields = (h, extra = {}) => ({ requestId: h.keys[0].requestId, chatId: '00081', messageId: 7, decisionId: h.b.snapshot().requests[0].decision_id, ...extra });
const retire = (h, extra = {}) => h.b.recordControlsRetired(fields(h, extra));
const mutation = (h, extra = {}) => ({ op: 'telegram.controls.retired', request_id: h.keys[0].requestId, chat_id: '00081', message_id: 7, decision_id: h.b.snapshot().requests[0].decision_id, ...extra });
async function native(work) {
  const root = resolve('.scratch/c2c-i'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file, samples = 0;
  const releases = [], h = { keys: [], now: at, syncing: async () => {}, get b() { return b; }, get j() { return j; },
    samples: () => samples, bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    hold() { const entered = gate(), released = gate(); releases.push(released.release);
      h.syncing = async () => { entered.release(); await released.promise; }; return { entered: () => bounded(() => entered.promise, 1500, 'sync'), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { await h.close(); const initial = await Journal.open(path), seq = initial.sequence; await initial.close(); file = await open(path, 'a');
      j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.syncing(); await file.sync(); }, close: () => file.close() }, seq);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => { samples++; return h.now; } }); },
    async reopen() { await h.start(); await b.recover(); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(mapped = true) { const key = await b.reserveHandle({ ownerId: 'a' });
      const auth = { ownerId: 'a', capability: key.request_capability, requestId: key.request_id }; h.keys.push(auth);
      await b.createRequest({ ...auth, requestHandle: key.request_handle, clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: key.request_id });
      if (mapped) await h.send(h.keys.length - 1, 7); return p; },
    async send(index, messageId) { const id = h.keys[index].requestId, p = await b.preparePresentation({ requestId: id });
      // Late receipt tests retain the token returned while pending, not an invented allocation.
      const token = p?.callback_token ?? h.tokens[index]; h.tokens[index] = token;
      return b.recordPresentationSent({ requestId: id, callbackToken: token, chatId: '00081', messageId }); }, tokens: [],
    async terminal(kind = 'cancel') { return kind === 'cancel' ? b.cancelRequest(h.keys[0]) : (h.now = at + 60000, b.readRequest(h.keys[0])); } };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 }); await work(h);
  } finally { for (const release of releases) release(); h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
test('C2C-CAL: real producer/mapping/cancel/reopen and actual held flush', opts, () => native(async h => {
  await h.create(); assert.equal(h.b.snapshot().requests[0].telegram_state, 'sent');
  const before = h.b.snapshot(), held = h.hold(); let done = false;
  const p = capture(() => h.terminal()).then(r => { done = true; return r; });
  try { await held.entered(); await tick(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); }
  finally { held.release(); await p; } h.syncing = async () => {};
  assert.equal((await p).value.resolution, 'cancelled'); const view = h.b.snapshot(); await h.reopen(); assert.deepEqual(h.b.snapshot(), view);
}));
for (const kind of ['cancel', 'expire']) test(`C2C-WORK-${kind}: each known copy independent, copied work, ledger unchanged`, opts, () => native(async h => {
  await h.create(); await h.send(0, 8); assert.deepEqual(controls(h), []); await h.terminal(kind);
  const request = h.b.snapshot().requests[0], expected = [7, 8].map(message_id => ({ kind: 'controls', request_id: request.request_id, chat_id: '00081', message_id, decision_id: request.decision_id, request }));
  assert.deepEqual(h.b.presentationWork().edits.sort((a, b) => a.message_id - b.message_id), expected); const work = controls(h); work[0].request.event_capability.status = 'evil'; work[0].message_id = 99;
  const bytes = await h.bytes(), samples = h.samples(); h.now = NaN;
  assert.deepEqual(controls(h), expected); assert.deepEqual(await retire(h), { retired: true, request });
  assert.equal(h.samples(), samples); assert.deepEqual((await h.rows()).at(-1), [mutation(h)]);
  assert.deepEqual(controls(h), [expected[1]]); const committed = await h.bytes(); assert.notDeepEqual(committed, bytes);
  const duplicate = await retire(h); duplicate.request.event_capability.status = 'evil';
  assert.deepEqual(await retire(h), { retired: false, request }); assert.deepEqual(await h.bytes(), committed); assert.equal(h.samples(), samples);
  h.now = at + 60000; await h.reopen(); assert.deepEqual(h.b.snapshot().requests, [request]); assert.deepEqual(controls(h), [expected[1]]);
  assert.deepEqual(await retire(h), { retired: false, request }); await retire(h, { messageId: 8 }); assert.deepEqual(controls(h), []);
  assert.deepEqual(h.b.snapshot().requests, [request]); // Status entries belong to C2c-ii, not an empty-edits assertion.
  const acknowledged = await h.b.acknowledgeRequest({ ...h.keys[0], decisionId: request.decision_id });
  await h.reopen(); assert.deepEqual(controls(h), []); assert.deepEqual(await retire(h), { retired: false, request: acknowledged });
}));
test('C2C-LATE: late mapped terminal copy becomes controls work, unmapped terminal never does', opts, () => native(async h => {
  await h.create(); await h.terminal(); await retire(h); await h.send(0, 8); assert.deepEqual(controls(h).map(e => e.message_id), [8]);
  await h.create(false); await h.b.cancelRequest(h.keys[1]); assert.deepEqual(controls(h).map(e => e.message_id), [8]);
}));
test('C2C-REFUSE: malformed raw arguments reject, well-formed wrong binding returns null without effect', opts, () => native(async h => {
  await h.create(); const pendingBytes = await h.bytes(), samples = h.samples();
  assert.equal(await retire(h, { decisionId: decision }), null); assert.deepEqual(await h.bytes(), pendingBytes); assert.equal(h.samples(), samples);
  await h.terminal(); const before = h.b.snapshot(), work = h.b.presentationWork(), bytes = await h.bytes(), count = h.samples(); h.now = NaN;
  const bad = [null, [], 'x', ...['requestId', 'chatId', 'messageId', 'decisionId'].flatMap(k => [undefined, null, true, {}, [fields(h)[k]]].map(v => ({ ...fields(h), [k]: v }))),
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(messageId => fields(h, { messageId })), fields(h, { chatId: 81 }), fields(h, { chatId: '0' }), fields(h, { requestId: 'bad' }), fields(h, { decisionId: 'bad' })];
  for (const input of bad) await assert.rejects(Promise.resolve().then(() => h.b.recordControlsRetired(input)), e => e?.code === 'INVALID_ARGUMENT');
  for (const extra of [{ requestId: unknown }, { chatId: '81' }, { messageId: 8 }, { decisionId: decision }]) assert.equal(await retire(h, extra), null);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes); assert.equal(h.samples(), count);
}));
test('C2C-GLOBAL: foreign request cannot retire or adopt a tuple, including after reopen', opts, () => native(async h => {
  await h.create(); await h.terminal(); await h.create(false); await h.b.cancelRequest(h.keys[1]); await h.reopen(); const bytes = await h.bytes();
  assert.equal(await retire(h, { requestId: h.keys[1].requestId, decisionId: h.b.snapshot().requests[1].decision_id }), null);
  assert.deepEqual(await h.bytes(), bytes); assert.equal(controls(h).length, 1);
}));
for (const mode of ['valid', 'duplicate', 'pending', 'before-mapping', 'before-closure', 'foreign-request']) test(`C2C-REPLAY-${mode}: ordered histories with positive decoder control`, opts, () => native(async h => {
  await h.create(); await h.terminal(); if (mode === 'foreign-request') { await h.create(false); await h.b.cancelRequest(h.keys[1]); }
  const rows = await h.rows(), receipt = mutation(h), before = h.b.snapshot();
  if (mode === 'foreign-request') { receipt.request_id = h.keys[1].requestId; receipt.decision_id = before.requests[1].decision_id; }
  if (mode === 'pending') rows.pop();
  if (mode === 'before-mapping' || mode === 'before-closure') rows.splice(mode === 'before-mapping' ? rows.length - 2 : rows.length - 1, 0, [receipt]);
  else rows.push(mode === 'duplicate' ? [receipt, receipt] : [receipt]);
  if (mode === 'valid') { const closure = rows.splice(rows.length - 2, 1)[0]; rows[rows.length - 1].unshift(...closure); }
  // Replacement gives first-recovery coverage. Installed-state coverage below uses a later bad append.
  await h.replace(rows); const bytes = await h.bytes();
  if (mode === 'valid') { await h.b.recover(); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(controls(h), []); await h.reopen(); assert.deepEqual(controls(h), []); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, []); await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), storage); }
  assert.deepEqual(await h.bytes(), bytes);
}));
test('C2C-REPLAY-SCHEMA: exact fields/types/binding, installed whole-history state retained', opts, () => native(async h => {
  await h.create(); await h.terminal(); const rows = await h.rows(), sample = mutation(h);
  // A successful positive replay must precede malformed variants, so unknown-op refusal cannot pass this suite.
  await h.j.append([sample]); await h.b.recover(); assert.deepEqual(controls(h), []);
  const alterations = Object.keys(sample).flatMap(k => [m => { delete m[k]; return m; }, ...[null, true, {}].map(v => m => ({ ...m, [k]: v })), m => ({ ...m, [k]: [m[k]] })]);
  alterations.push(m => ({ ...m, timestamp: 'forbidden' }), m => ({ ...m, request_id: unknown }), m => ({ ...m, decision_id: decision }), m => ({ ...m, chat_id: 81 }), m => ({ ...m, chat_id: '81' }),
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(message_id => m => ({ ...m, message_id })));
  for (const alter of alterations) {
    await h.replace(rows); await h.b.recover(); const before = h.b.snapshot(), work = h.b.presentationWork();
    await h.j.append([alter({ ...sample })]); const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes);
  }
  await h.replace(rows); await h.b.recover(); const before = h.b.snapshot(), work = h.b.presentationWork();
  await h.j.append([sample, { ...sample, message_id: 8 }]); await assert.rejects(h.b.recover(), invalid);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work);
}));
test('C2C-BARRIER: controls remain offered until real Journal sync commits', opts, () => native(async h => {
  assert.equal(typeof h.b.recordControlsRetired, 'function');
  await h.create(); await h.terminal(); const before = h.b.snapshot(), work = h.b.presentationWork(), held = h.hold(); let done = false;
  const p = capture(() => retire(h)).then(r => { done = true; return r; });
  try { await held.entered(); await tick(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); }
  finally { held.release(); await p; } assert.equal((await p).value?.retired, true); assert.deepEqual(controls(h), []);
}));
test('C2C-FENCE: uncertain retirement fences queued/fresh work, reopen preserves committed marker', opts, () => native(async h => {
  assert.equal(typeof h.b.recordControlsRetired, 'function');
  await h.create(); await h.send(0, 8); await h.terminal(); const before = h.b.snapshot(), work = h.b.presentationWork(), held = h.hold(), sync = h.syncing;
  h.syncing = async () => { await sync(); throw new Error('synthetic sync fault'); };
  const p = capture(() => retire(h)); let follower;
  try { await held.entered(); follower = capture(() => retire(h, { messageId: 8 })); } finally { held.release(); await p; await follower; }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error)); const bytes = await h.bytes();
  await assert.rejects(retire(h), storage); await assert.rejects(h.b.status(), storage); assert.deepEqual(await h.bytes(), bytes);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); h.syncing = async () => {};
  await h.reopen(); assert.deepEqual(controls(h).map(e => e.message_id), [8]); assert.deepEqual(await retire(h), { retired: false, request: before.requests[0] });
}));
