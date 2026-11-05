// TEST ONLY: design5 C3 G1/G1b. Native core/Journal proof, not network or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 12000 };
const unknown = 'req_' + 'f'.repeat(32), token = n => n.toString(16).padStart(32, '0');
// Distinct canonical namespaces keep public decision IDs from mimicking private tokens.
const decision = n => 'dec_' + 'd'.repeat(16) + n.toString(16).padStart(16, '0');
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function native(work) {
  const root = resolve('.scratch/c3-prompt-admission'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], logs: [], now: at, clocks: 0, ids: 0, generated: 0,
    writing: async () => {}, syncing: async () => {}, get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.ids, j.sequence, b.telegramCursor()],
    lookup: t => b.correlateCallbackToken({ callbackToken: t }),
    admit: (i = 0) => b.prepareResponsePrompt({ requestId: h.keys[i].requestId }),
    fields: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      chatId: '00081', messageId: 7 + i, userId: '00071', callbackQueryId: 'private-query', updateId: 2 + i, ...extra }),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...a) => { await h.writing(); if (h.fail === 'writing') throw Error('private fault'); return file.write(...a); },
        sync: async () => { await h.syncing(); if (h.fail === 'syncing') throw Error('private fault'); return file.sync(); }, close: () => file.close(),
      }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; if (h.now instanceof Error) throw h.now; return h.now; },
        generateCallbackToken: () => token(++h.generated), generateDecisionId: () => decision(++h.ids), logger: (...a) => h.logs.push(a) }); },
    async reopen() { await h.close(); h.now = at + 2000; await h.start(); h.now = NaN;
      const n = h.clocks; await b.recover(); assert.equal(h.clocks, n); },
    async create(stage = 'opened') { const key = await b.reserveHandle({ ownerId: 'a' }), i = h.keys.length;
      h.keys.push({ ownerId: 'a', requestId: key.request_id, capability: key.request_capability });
      if (stage === 'reserved') return;
      await b.createRequest({ ownerId: 'a', requestHandle: key.request_handle, capability: key.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      if (stage === 'created') return;
      const p = await b.preparePresentation({ requestId: key.request_id }); h.tokens[i] = p.callback_token;
      if (stage === 'allocated') return;
      await b.recordPresentationSent({ requestId: key.request_id, callbackToken: p.callback_token, chatId: '00081', messageId: 7 + i });
      if (stage !== 'mapped') await b.openResponse(h.fields({}, i)); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 });
    h.now = at + 1000; await bounded(() => work(h), 9500, 'admission fixture');
  } finally { releases.forEach(r => r()); h.fail = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
async function unchanged(h, action) { const bytes = await h.bytes(), view = h.b.snapshot(), n = h.count(), generated = h.generated; await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.count(), n); assert.equal(h.generated, generated); }
for (const phase of ['writing', 'syncing']) test(`CAL-${phase}: real allocation flush/failure and clock-free replay`, opts, () => native(async h => {
  await h.create('created'); const held = h.hold(phase), before = h.b.snapshot(); let done = false;
  const p = capture(() => h.b.preparePresentation({ requestId: h.keys[0].requestId })).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.deepEqual(h.b.snapshot(), before); h.fail = null; h[phase] = async () => {};
  await h.reopen(); assert.equal(h.b.presentationWork().sends[0].callback_token, phase === 'syncing' ? token(1) : null);
}));
test('COR-LIFECYCLE: allocated/mapped/opened/prompted/terminal survive replay, copied result and public privacy', opts, () => native(async h => {
  await h.create('allocated');
  for (const stage of ['allocated', 'mapped', 'opened', 'prompted', 'terminal']) {
    if (stage === 'mapped') await h.b.recordPresentationSent({ ...h.fields(), messageId: 7 });
    if (stage === 'opened') await h.b.openResponse(h.fields());
    if (stage === 'prompted') await h.b.recordPromptSent({ requestId: h.keys[0].requestId, chatId: '00081', messageId: 70 });
    if (stage === 'terminal') { await h.b.cancelRequest(h.keys[0]);
      assert.equal(h.b.snapshot().requests[0].decision_id, decision(1));
      assert.equal(decision(1).includes(h.tokens[0]), false); }
    await unchanged(h, async () => { const found = h.lookup(h.tokens[0]); assert.deepEqual(found, { request_id: h.keys[0].requestId });
      for (const field of ['callback_token', 'user_id', 'resolution']) assert.equal(Object.hasOwn(found, field), false);
      found.request_id = unknown; assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId }); });
    await h.reopen(); assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId }); h.now = at + 2000;
    assert.equal(JSON.stringify([h.b.snapshot(), await h.b.status(), h.logs]).includes(h.tokens[0]), false);
  }
  assert.equal(h.b.presentationWork().sends.length, 0); await h.close(); h.now = NaN;
  assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId });
}));
test('COR-TOTAL: malformed/nonplain/pattern miss, blocked queue and unrecovered instance', opts, () => native(async h => {
  await h.create(); const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); await unchanged(h, async () => {
    for (const input of [undefined, null, [], 'x', new Date(), {}, { callbackToken: 1 }, { callbackToken: token(1) + '\n' }, { callbackToken: 'A'.repeat(32) }])
      assert.equal(h.b.correlateCallbackToken(input), null);
    assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId }); assert.equal(h.lookup(token(999)), null);
  }); } finally { held.release(); await p; h.syncing = async () => {}; }
  await h.close(); h.now = at; await h.start(); assert.equal(h.lookup(h.tokens[0]), null);
  await assert.rejects(h.admit(), storage);
}));
for (const phase of ['writing', 'syncing']) test(`COR-COMMIT-${phase}: no allocation visibility before flush or failed append, retained after fence`, opts, () => native(async h => {
  await h.create('created'); const held = h.hold(phase), p = capture(() => h.b.preparePresentation({ requestId: h.keys[0].requestId }));
  try { await held.entered(); assert.equal(h.lookup(token(1)), null); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.equal(h.lookup(token(1)), null); h.fail = null; h[phase] = async () => {};
  await h.reopen(); assert.deepEqual(h.lookup(token(1)), phase === 'syncing' ? { request_id: h.keys[0].requestId } : null);
}));
test('COR-FLUSH: successful allocation becomes visible only after native sync', opts, () => native(async h => {
  await h.create('created'); const held = h.hold('syncing'), p = capture(() => h.b.preparePresentation({ requestId: h.keys[0].requestId }));
  try { await held.entered(); assert.equal(h.lookup(token(1)), null); } finally { held.release(); }
  assert.equal((await p).value.callback_token, token(1)); assert.deepEqual(h.lookup(token(1)), { request_id: h.keys[0].requestId });
}));
test('COR-STAGE: invalid later history installs no partial index and preserves committed correlation', opts, () => native(async h => {
  await h.create('allocated'); const before = h.b.snapshot(); await h.create('created');
  await h.j.append([{ op: 'telegram.presentation.prepare', request_id: h.keys[1].requestId, callback_token: token(99), prepared_at: new Date(h.now).toISOString() }]);
  await h.j.append([{ op: 'not.a.valid.mutation' }]); const bytes = await h.bytes(); h.now = NaN;
  await assert.rejects(h.b.recover(), e => e?.code === 'JOURNAL_STATE_INVALID');
  assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId }); assert.equal(h.lookup(token(99)), null);
  assert.deepEqual(h.b.snapshot().requests[0], before.requests[0]); assert.deepEqual(await h.bytes(), bytes);
}));
test('COR-NO-AUTH: known request still refuses wrong actor/message in actual callback/open writers', opts, () => native(async h => {
  await h.create('mapped'); const found = h.lookup(h.tokens[0]); h.now = NaN;
  await unchanged(h, async () => { for (const extra of [{ userId: '71' }, { messageId: 99 }]) {
    const fields = h.fields({ requestId: found.request_id, ...extra });
    assert.deepEqual(await h.b.openResponse(fields), { result: 'refused' });
    assert.deepEqual(await h.b.resolveCallback({ ...fields, resolution: 'approved' }), { result: 'refused' });
  } });
}));
test('PAD-VALID: one sample, copied common request/exact snapshot chat, no append or work mutation', opts, () => native(async h => {
  await h.create(); h.now = at + 60999; const bytes = await h.bytes(), view = h.b.snapshot(), work = h.b.responseWork(), n = h.count(), generated = h.generated;
  const r = await h.b.prepareResponsePrompt({ requestId: h.keys[0].requestId, chat_id: '81', request: { authority: 'none' } });
  assert.deepEqual(r, { chat_id: '00081', request: view.requests[0] }); assert.equal(h.generated, generated);
  assert.deepEqual(h.count(), [n[0] + 1, ...n.slice(1)]); r.request.event_capability.status = 'evil'; r.chat_id = '81';
  assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.b.responseWork(), work); assert.deepEqual(await h.bytes(), bytes);
  assert.deepEqual(await h.admit(), { chat_id: '00081', request: view.requests[0] });
}));
test('PAD-INELIGIBLE: unknown/reserved/unopened/prompted/terminal are clock-free even overdue', opts, () => native(async h => {
  for (const stage of ['reserved', 'mapped', 'opened', 'opened']) await h.create(stage);
  await h.b.recordPromptSent({ requestId: h.keys[2].requestId, chatId: '00081', messageId: 70 }); await h.b.cancelRequest(h.keys[3]); h.now = NaN;
  await unchanged(h, async () => { assert.equal(await h.b.prepareResponsePrompt({ requestId: unknown }), null);
    for (let i = 0; i < 4; i++) assert.equal(await h.admit(i), null); });
}));
test('PAD-RAW: malformed arguments reject before a blocked queue without sampling', opts, () => native(async h => {
  await h.create(); const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); await unchanged(h, async () => {
    for (const input of [undefined, null, [], 'x', {}, { requestId: null }, { requestId: 1 }, { requestId: unknown + '\n' }])
      await assert.rejects(bounded(() => Promise.resolve().then(() => h.b.prepareResponsePrompt(input)), 500, 'raw'), e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2);
  }); } finally { held.release(); await p; }
}));
for (const attached of [false, true]) test(`PAD-DUE-${attached}: equality expiry initial ledger, flush-before-wake and no cursor`, opts, () => native(async h => {
  await h.create(); let woke = false; const wait = attached ? capture(() => h.b.waitRequest(h.keys[0])).then(r => { woke = true; return r; }) : null;
  await tick(); h.now = at + 61000; const n = h.count(), view = h.b.snapshot(), held = h.hold('syncing'), p = capture(() => h.admit());
  try { await held.entered(); assert.equal(woke, false); assert.deepEqual(h.b.snapshot(), view); } finally { held.release(); }
  assert.equal((await p).value, null); if (wait) assert.equal((await bounded(() => wait, 1500, 'expiry wait')).value.request.resolution, 'expired');
  const r = h.b.snapshot().requests[0]; assert.equal(r.resolution, 'expired'); assert.equal(r.delivery_state, attached ? 'pending' : 'unavailable');
  assert.deepEqual(h.count(), [n[0] + 1, n[1] + 1, n[2] + 1, n[3]]);
  assert.deepEqual((await h.rows()).at(-1).map(m => m.op), ['request.expire']);
}));
test('PAD-CLOCK: invalid/thrown/before-creation clock fails preappend, valid construction stays intact', opts, () => native(async h => {
  await h.create(); const bytes = await h.bytes(), view = h.b.snapshot(), n = h.count();
  for (const now of [NaN, Infinity, null, '1', at, new Error('private clock')]) { h.now = now; await assert.rejects(h.admit(), storage);
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.count().slice(1), n.slice(1)); }
}));
for (const stop of ['writing', 'syncing', 'latch', 'close']) test(`PAD-QUEUE-${stop}: queued/fresh admission rechecks installed fence/close/latch`, opts, () => native(async h => {
  await h.create(); const phase = stop === 'writing' ? 'writing' : 'syncing';
  const held = h.hold(phase), p = capture(() => h.b.advanceCursor(3)); let queued;
  try { await held.entered(); queued = capture(() => h.admit()); await tick();
    if (stop === 'latch') h.b.latchDeadlineFailure(); else if (stop === 'close') h.closing = h.b.close(); else h.fail = phase;
  } finally { held.release(); await p; await h.closing; }
  assert.ok(storage((await queued).error)); const n = h.count(); await assert.rejects(h.admit(), storage); assert.deepEqual(h.count(), n);
  assert.deepEqual(h.lookup(h.tokens[0]), { request_id: h.keys[0].requestId });
}));
for (const phase of ['writing', 'syncing']) test(`PAD-EXPIRY-FAULT-${phase}: no installed closure/wake success/cursor after rejected append`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick(); h.now = at + 61000;
  const view = h.b.snapshot(), cursor = h.b.telegramCursor(), held = h.hold(phase), p = capture(() => h.admit()); let queued;
  try { await held.entered(); queued = capture(() => h.admit()); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await queued).error));
  assert.ok(storage((await bounded(() => wait, 1500, 'fault waiter')).error));
  assert.deepEqual(h.b.snapshot(), view); assert.equal(h.b.telegramCursor(), cursor);
}));
test('PAD-QUEUED-MAPPING: committed preceding prompt receipt suppresses admitted candidate without clock', opts, () => native(async h => {
  await h.create(); const held = h.hold('syncing'), sent = capture(() => h.b.recordPromptSent({ requestId: h.keys[0].requestId, chatId: '00081', messageId: 70 })); let queued, n;
  try { await held.entered(); n = h.clocks; queued = capture(() => h.admit()); await tick(); } finally { held.release(); }
  assert.equal((await sent).value.sent, true); assert.equal((await queued).value, null); assert.equal(h.clocks, n);
}));
