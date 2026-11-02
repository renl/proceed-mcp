// TEST ONLY: design 4/5 C2/7 receipt core. Primitive receipts are NOT Telegram Message/wire proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-02T00:00:00Z'), iso = n => new Date(n).toISOString(), opts = { timeout: 10000 };
const token = 'a'.repeat(32), other = 'b'.repeat(32), unknown = 'req_' + 'f'.repeat(32);
const storage = e => e?.exitCode === 4, invalid = e => storage(e) && e.code === 'JOURNAL_STATE_INVALID';
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const sent = (id, extra = {}) => ({ op: 'telegram.presentation.sent', request_id: id, callback_token: token, chat_id: '00081', message_id: 7, sent_at: iso(at + 1000), ...extra });
const failed = (id, extra = {}) => ({ op: 'telegram.presentation.failed', request_id: id, callback_token: token, failed_at: iso(at + 1000), error_code: 'unavailable', ...extra });
const send = (h, extra = {}) => h.b.recordPresentationSent({ requestId: h.ids[0], callbackToken: token, chatId: '00081', messageId: 7, ...extra });
const fail = (h, errorCode = 'unavailable', extra = {}) => h.b.recordPresentationFailed({ requestId: h.ids[0], callbackToken: token, errorCode, ...extra });
async function native(work) {
  const root = resolve('.scratch/c2a-ii'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], logs = [], h = { ids: [], keys: [], now: at, logs, writing: async () => {}, syncing: async () => {},
    get b() { return b; }, get j() { return j; }, bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { await h.close(); const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, { write: async (...a) => { await h.writing(); return file.write(...a); },
        sync: async () => { await h.syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => h.now,
        generateCallbackToken: () => h.ids.length === 1 ? token : other, logger: (...a) => logs.push(a) }); },
    async reopen() { await h.start(); await b.recover(); },
    async replace(rows) { await h.close(); await rm(path); const writer = await Journal.open(path);
      try { for (const row of rows) await writer.append(row); } finally { await writer.close(); } await h.start(); },
    async create(allocate = true) { const key = await b.reserveHandle({ ownerId: 'a' });
      h.ids.push(key.request_id); h.keys.push({ ownerId: 'a', capability: key.request_capability, requestId: key.request_id });
      const view = (await b.createRequest({ ownerId: 'a', capability: key.request_capability, requestHandle: key.request_handle,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 })).request;
      h.now = at + 1000; if (allocate) await b.preparePresentation({ requestId: key.request_id }); return view; } };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    assert.deepEqual(await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 }), { paired: true }); await work(h);
  } finally { for (const release of releases) release(); h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
function privateAbsent(value) {
  const text = JSON.stringify(value); for (const secret of [token, other, '00071', '00081', 'pairing_snapshot', 'callback_token', 'last_failure_code']) assert.equal(text.includes(secret), false, secret);
}
test('C2R-CAL: actual create/prepare, immutable snapshot and real Journal recovery', opts, () => native(async h => {
  const view = await h.create(); assert.equal((await h.rows()).at(-1)[0].op, 'telegram.presentation.prepare');
  await h.reopen(); assert.deepEqual(h.b.snapshot().requests, [view]); assert.equal(h.b.presentationWork().sends[0].callback_token, token);
}));
for (const phase of ['writing', 'syncing']) test(`C2R-CAL-${phase}: fixture intercepts actual writer before installation`, opts, () => native(async h => {
  const hold = h.hold(phase), before = h.b.snapshot(); let done = false;
  const p = capture(() => h.b.reserveHandle({ ownerId: 'a' })).then(r => { done = true; return r; });
  try { await hold.entered(); await tick(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); }
  finally { hold.release(); await p; } assert.ok((await p).value.request_id);
}));
for (const mode of ['unallocated', 'reservation']) test(`C2R-NO-ALLOCATION-${mode}: no implicit token/mapping`, opts, () => native(async h => {
  if (mode === 'unallocated') await h.create(false); else { const key = await h.b.reserveHandle({ ownerId: 'a' }); h.ids.push(key.request_id); }
  const bytes = await h.bytes(), before = h.b.snapshot();
  for (const invoke of [() => send(h), () => fail(h)]) { const r = await capture(invoke); assert.ok(r.value === null || r.error?.exitCode); }
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before);
}));
for (const kind of ['sent', 'failed']) for (const bad of [NaN, Infinity, null, '1']) test(`C2R-CLOCK-${kind}-${String(bad)}: unusable time never appends`, opts, () => native(async h => {
  await h.create(); const bytes = await h.bytes(); h.now = bad; await assert.rejects(kind === 'sent' ? send(h) : fail(h), storage); assert.deepEqual(await h.bytes(), bytes);
}));
for (const order of ['prepare-first', 'receipt-first']) test(`C2R-ARRAY-${order}: receipt uses staged allocation instant`, opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), allocation = rows.pop()[0], receipt = sent(h.ids[0]);
  await h.replace([...rows, order === 'prepare-first' ? [allocation, receipt] : [receipt, allocation]]); const bytes = await h.bytes();
  if (order === 'prepare-first') { await h.b.recover(); assert.equal(h.b.snapshot().requests[0].telegram_state, 'sent'); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, []); }
  assert.deepEqual(await h.bytes(), bytes);
}));
for (const kind of ['sent', 'failed']) for (const fraction of ['000000001', '000000002']) test(`C2R-FRACTION-${kind}-${fraction}: compare exact recovered allocation`, opts, () => native(async h => {
  await h.create(); const rows = await h.rows(), allocation = rows.pop()[0]; allocation.prepared_at = '2026-11-02T00:00:01.000000002Z';
  const receipt = kind === 'sent' ? sent(h.ids[0], { sent_at: `2026-11-02T00:00:01.${fraction}Z` }) : failed(h.ids[0], { failed_at: `2026-11-02T00:00:01.${fraction}Z` });
  await h.replace([...rows, [allocation], [receipt]]); const bytes = await h.bytes();
  if (fraction === '000000002') { await h.b.recover(); assert.equal(h.b.snapshot().requests[0].telegram_state, kind); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, []); } assert.deepEqual(await h.bytes(), bytes);
}));
test('C2R-GLOBAL-REPLAY: two allocated requests cannot share a tuple, whole-history state is retained', opts, () => native(async h => {
  await h.create(); await h.create(); const before = h.b.snapshot(), work = h.b.presentationWork();
  await h.j.append([sent(h.ids[0])]); await h.j.append([sent(h.ids[1], { callback_token: other })]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes);
}));
for (const mode of ['failure-sent-failure', 'late-sent', 'regression-after-sent']) test(`C2R-SEQUENCE-${mode}: truthful presentation independent of terminal ledger`, opts, () => native(async h => {
  await h.create(); if (mode === 'late-sent') { await h.b.cancelRequest(h.keys[0]); h.now = at + 60000; }
  const before = h.b.snapshot().requests[0], good = mode !== 'regression-after-sent';
  await h.j.append([failed(h.ids[0]), sent(h.ids[0]), failed(h.ids[0], { failed_at: iso(at + (good ? 1001 : 999)) })]);
  const bytes = await h.bytes();
  if (good) { await h.b.recover(); assert.deepEqual(h.b.snapshot().requests, [{ ...before, telegram_state: 'sent' }]); assert.deepEqual(h.b.presentationWork().sends, []); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot().requests, [before]); }
  assert.deepEqual(await h.bytes(), bytes);
}));
test('C2R-SENT: exact receipt, mapped suppression, retry no append/clock and copied restart state', opts, () => native(async h => {
  const view = await h.create(), expected = { ...view, telegram_state: 'sent' }, result = await send(h);
  assert.deepEqual(result, expected); assert.deepEqual((await h.rows()).at(-1), [sent(h.ids[0])]);
  assert.deepEqual(h.b.presentationWork().sends, []); result.action = 'evil'; result.event_capability.status = 'evil';
  const bytes = await h.bytes(); h.now = NaN; assert.deepEqual(await send(h), expected); assert.deepEqual(await h.bytes(), bytes);
  h.now = at + 1000; await h.reopen(); assert.deepEqual(await send(h), expected); assert.deepEqual(await h.bytes(), bytes);
  privateAbsent([h.b.snapshot(), await h.b.status(), h.logs]); assert.deepEqual(h.b.presentationWork().sends, []);
}));
test('C2R-FAILED: closed classifications, latest diagnostic, repeat attempts, sent never downgraded', opts, () => native(async h => {
  const view = await h.create();
  for (const [n, code] of ['unavailable', 'rate_limited', 'rejected', 'invalid_response'].entries()) {
    h.now = at + 1000 + n; assert.deepEqual(await fail(h, code), { ...view, telegram_state: 'failed' });
    assert.deepEqual((await h.rows()).at(-1), [failed(h.ids[0], { failed_at: iso(h.now), error_code: code })]);
    const work = h.b.presentationWork(); assert.equal(work.sends[0].last_failure_code, code);
    work.sends[0].request.event_capability.status = 'evil'; work.sends[0].last_failure_code = 'evil';
    await h.reopen(); assert.equal(h.b.presentationWork().sends[0].last_failure_code, code);
  }
  const rows = (await h.rows()).length; await fail(h, 'invalid_response'); assert.equal((await h.rows()).length, rows + 1);
  assert.equal((await send(h)).telegram_state, 'sent'); assert.equal((await fail(h)).telegram_state, 'sent');
  assert.deepEqual(h.b.presentationWork().sends, []); privateAbsent([h.b.snapshot(), await h.b.status(), h.logs]);
}));
for (const closure of ['cancel-first', 'send-first', 'expire-first', 'send-expire']) test(`C2R-LATE-${closure}: receipt cannot resolve or rewrite ledger`, opts, () => native(async h => {
  await h.create(); if (closure.startsWith('send')) await send(h);
  if (closure.includes('expire')) { h.now = at + 60000; await h.b.readRequest(h.keys[0]); } else await h.b.cancelRequest(h.keys[0]);
  const before = h.b.snapshot().requests[0]; h.now += 1; const after = await send(h);
  assert.deepEqual(after, { ...before, telegram_state: 'sent' }); assert.equal((await fail(h)).telegram_state, 'sent');
  assert.deepEqual(h.b.presentationWork().sends, []); const work = h.b.presentationWork(); work.sends.push('evil');
  await h.reopen(); assert.deepEqual(h.b.snapshot().requests, [after]); assert.deepEqual(h.b.presentationWork().sends, []);
}));
test('C2R-COPIES: second known copy allowed, global tuple collision refused across requests/reopen', opts, () => native(async h => {
  await h.create(); await send(h); await send(h, { messageId: 8 }); await h.b.cancelRequest(h.keys[0]);
  assert.deepEqual((await h.rows()).slice(-3, -1).map(r => r[0].message_id), [7, 8]); await h.create(); await h.reopen(); const bytes = await h.bytes();
  const result = await capture(() => send(h, { requestId: h.ids[1], callbackToken: other }));
  assert.ok(result.value === null || result.error?.exitCode); assert.deepEqual(await h.bytes(), bytes);
  assert.equal((await send(h, { requestId: h.ids[1], callbackToken: other, messageId: 9 })).telegram_state, 'sent');
}));
test('C2R-INSTALLED: later invalid history cannot replace installed sent mapping or public view', opts, () => native(async h => {
  await h.create(); await send(h); const before = h.b.snapshot(), work = h.b.presentationWork();
  await h.j.append([sent(h.ids[0], { message_id: 8 })]); await h.j.append([sent(h.ids[0])]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes);
}));
for (const kind of ['sent', 'failed']) for (const phase of ['writing', 'syncing']) test(`C2R-BARRIER-${kind}-${phase}: flush before result/state/work`, opts, () => native(async h => {
  await h.create(); const before = h.b.snapshot(), work = h.b.presentationWork(), hold = h.hold(phase); let done = false;
  const p = capture(() => kind === 'sent' ? send(h) : fail(h)).then(r => { done = true; return r; });
  try { await hold.entered(); await tick(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); }
  finally { hold.release(); await p; } assert.equal((await p).value.telegram_state, kind);
}));
for (const kind of ['sent', 'failed']) test(`C2R-FENCE-${kind}: uncertain append fences queued/fresh writers and observations`, opts, () => native(async h => {
  await h.create(); const before = h.b.snapshot(), work = h.b.presentationWork(), hold = h.hold('syncing'), held = h.syncing;
  h.syncing = async () => { await held(); throw new Error('synthetic sync fault'); };
  const p = capture(() => kind === 'sent' ? send(h) : fail(h)); let follower;
  try { await hold.entered(); follower = capture(() => send(h, { messageId: 8 })); } finally { hold.release(); await p; await follower; }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error)); const bytes = await h.bytes();
  await assert.rejects(send(h), storage); await assert.rejects(h.b.status(), storage); assert.deepEqual(h.b.snapshot(), before);
  assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes); privateAbsent(h.logs);
  h.syncing = async () => {}; await h.reopen(); assert.equal(h.b.snapshot().requests[0].telegram_state, kind);
}));
for (const [kind, invoke, changes] of [
  ['sent', send, [{ requestId: unknown }, { requestId: [unknown] }, { callbackToken: other }, { callbackToken: [token] }, { chatId: '81' }, { chatId: 81 }, { chatId: ['00081'] }, ...[0, -1, 1.5, '7', [7], null, Number.MAX_SAFE_INTEGER + 1].map(messageId => ({ messageId }))]],
  ['failed', (h, extra) => fail(h, extra.errorCode ?? 'unavailable', extra), [{ requestId: unknown }, { callbackToken: other }, { callbackToken: [token] }, ...['platform secret', '', ['unavailable'], 1].map(errorCode => ({ errorCode }))]],
]) test(`C2R-REFUSE-${kind}: primitive validation/binding leaves state/bytes unchanged`, opts, () => native(async h => {
  await h.create(); const before = h.b.snapshot(), work = h.b.presentationWork(), bytes = await h.bytes();
  for (const extra of changes) { const r = await capture(() => invoke(h, extra)); assert.ok(r.value === null || r.error?.exitCode, JSON.stringify(extra));
    privateAbsent(r.error ? { message: r.error.message } : r.value); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes); }
}));
for (const kind of ['sent', 'failed']) test(`C2R-TIME-${kind}: allocation lower bound survives reopen, failure times nondecreasing`, opts, () => native(async h => {
  await h.create(); await h.reopen(); h.now = at + 999; const bytes = await h.bytes();
  await assert.rejects(kind === 'sent' ? send(h) : fail(h), storage); assert.deepEqual(await h.bytes(), bytes);
  h.now = at + 1002; if (kind === 'failed') { await fail(h); h.now--; const previous = await h.bytes(); await assert.rejects(fail(h), storage); assert.deepEqual(await h.bytes(), previous); }
  else assert.equal((await send(h)).telegram_state, 'sent');
}));
for (const make of [sent, failed]) {
  const sample = make(unknown), time = make === sent ? 'sent_at' : 'failed_at';
  const changes = Object.keys(sample).flatMap(field => [m => { delete m[field]; return m; }, m => ({ ...m, [field]: null }), m => ({ ...m, [field]: [m[field]] })]);
  changes.push(m => ({ ...m, extra: 1 }), m => ({ ...m, request_id: unknown }), m => ({ ...m, callback_token: other }),
    ...['2026-02-30T00:00:00Z', '2026-11-02T00:00:01-00:00', '2026-11-02T00:00:00.999999999Z'].map(t => m => ({ ...m, [time]: t })));
  if (make === sent) changes.push(...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(message_id => m => ({ ...m, message_id })), m => ({ ...m, chat_id: '81' }));
  else changes.push(m => ({ ...m, error_code: 'platform secret' }));
  for (const [n, alter] of changes.entries()) test(`C2R-REPLAY-${make === sent ? 'sent' : 'failed'}-${n}: strict staged refusal`, opts, () => native(async h => {
    await h.create(); const before = h.b.snapshot(), work = h.b.presentationWork(); await h.j.append([alter(make(h.ids[0]))]); const bytes = await h.bytes();
    await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); assert.deepEqual(await h.bytes(), bytes);
  }));
}
for (const mode of ['valid', 'duplicate-sent', 'duplicate-failure', 'regress', 'unallocated', 'staged-invalid', 'precision']) test(`C2R-HISTORY-${mode}: positive controls discriminate unknown-op refusal`, opts, () => native(async h => {
  await h.create(mode !== 'unallocated'); const id = h.ids[0], before = h.b.snapshot(), work = h.b.presentationWork();
  const rows = mode === 'duplicate-sent' ? [sent(id), sent(id)] : mode === 'regress' ? [failed(id, { failed_at: iso(at + 1001) }), failed(id)] :
    mode === 'duplicate-failure' ? [failed(id), failed(id)] : mode === 'staged-invalid' ? [sent(id), sent(id, { message_id: 0 })] :
    mode === 'precision' ? [sent(id, { sent_at: '2026-11-02T00:00:01.000000001+00:00' })] : [sent(id)];
  await h.j.append(rows); const bytes = await h.bytes();
  if (['valid', 'duplicate-failure', 'precision'].includes(mode)) { await h.b.recover(); assert.equal(h.b.snapshot().requests[0].telegram_state, mode === 'duplicate-failure' ? 'failed' : 'sent'); await h.reopen(); }
  else { await assert.rejects(h.b.recover(), invalid); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.b.presentationWork(), work); }
  assert.deepEqual(await h.bytes(), bytes);
}));
