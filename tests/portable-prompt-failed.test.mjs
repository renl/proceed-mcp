// TEST ONLY: design4/5 C3/7 prompt-failure core. Primitive receipts are not Telegram evidence.
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
const codes = ['unavailable', 'rate_limited', 'rejected', 'invalid_response'];
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalid = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function native(work) {
  const root = resolve('.scratch/c3-prompt-failed'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], now: at, clocks: 0, ids: 0, logs: [],
    writing: async () => {}, syncing: async () => {}, get b() { return b; }, get j() { return j; },
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.ids, j.sequence, b.telegramCursor()],
    fields: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      chatId: '00081', messageId: 7 + i, userId: '00071', callbackQueryId: 'private-query', updateId: 2 + i, ...extra }),
    failPrompt: (extra = {}, i = 0) => b.recordPromptFailed({ requestId: h.keys[i].requestId, errorCode: 'unavailable', ...extra }),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...args) => { await h.writing(); if (h.fail === 'writing') throw new Error('private fault SECRET'); return file.write(...args); },
        sync: async () => { await h.syncing(); if (h.fail === 'syncing') throw new Error('private fault SECRET'); return file.sync(); }, close: () => file.close(),
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
    h.now = at + 1000; await bounded(() => work(h), 9500, 'prompt failure fixture');
  } finally { releases.forEach(r => r()); h.fail = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
const failed = (h, extra = {}) => ({ op: 'telegram.prompt.failed', request_id: h.keys[0].requestId,
  failed_at: iso(at + 1000), error_code: 'unavailable', ...extra });
function visible(h) { return [h.b.snapshot(), h.b.responseWork(), h.b.presentationWork()]; }
async function unchanged(h, action) { const bytes = await h.bytes(), before = visible(h), n = h.count(); await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(visible(h), before); assert.deepEqual(h.count(), n); }
function redacted(h, value) { const text = JSON.stringify(value);
  for (const secret of ['SECRET', 'private fault', '00071', '00081', 'private-query', ...h.tokens, ...h.keys.map(k => k.capability)])
    assert.equal(text.includes(secret), false, secret); }
async function rejectHistory(h, rows) { h.now = at + 2000; await h.replace(rows); const bytes = await h.bytes(), before = visible(h), n = h.count(); h.now = NaN;
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(visible(h), before); assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.count(), n); }
for (const phase of ['writing', 'syncing']) test(`PF-CAL-${phase}: actual prefixes, prearmed closure failure, fence and fresh recovery`, opts, () => native(async h => {
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = visible(h), held = h.hold(phase); let done = false;
  const p = capture(() => h.b.cancelRequest(h.keys[0])).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(visible(h), before); h.fail = phase; }
  finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await bounded(() => wait, 1500, 'calibration wait')).error));
  h.fail = null; h[phase] = async () => {}; await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'cancelled');
}));
test('PF-ADMIT: malformed rejects before queue, unknown/unopened refuse without time or append', opts, () => native(async h => {
  await h.create(false); h.now = NaN;
  await unchanged(h, async () => { assert.equal(await h.failPrompt(), null); assert.equal(await h.failPrompt({ requestId: unknown }), null); });
  const good = { requestId: h.keys[0].requestId, errorCode: 'unavailable' };
  const bad = [undefined, null, [], 'x', {}, ...Object.keys(good).flatMap(k => [undefined, null, {}, [good[k]], true, 1].map(v => ({ ...good, [k]: v }))),
    ...['', 'UNKNOWN', 'Unavailable', ' unavailable', 'rejected ', 'SECRET'].map(errorCode => ({ ...good, errorCode })),
    { ...good, requestId: 'bad' }];
  const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(3));
  try { await held.entered(); const n = h.count(); for (const input of bad)
    await assert.rejects(bounded(() => Promise.resolve().then(() => h.b.recordPromptFailed(input)), 500, 'raw'), e => {
      redacted(h, [e.message, e.cause?.message, e.cause?.cause?.message]); return e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2; });
    assert.deepEqual(h.count(), n); } finally { held.release(); await p; }
}));
for (const phase of ['writing', 'syncing']) test(`PF-WRITE-${phase}: exact repeat receipts, flush before install, one sample and no wake`, opts, () => native(async h => {
  assert.equal(typeof h.b.recordPromptFailed, 'function', 'selected prompt-failure API');
  await h.create(); const abort = new AbortController(); let woke = false;
  const wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: abort.signal })).then(r => { woke = true; return r; }); await tick();
  try { const before = visible(h), n = h.count(), held = h.hold(phase); let done = false, follower;
    const p = capture(() => h.failPrompt()).then(r => { done = true; return r; });
    try { await held.entered(); assert.equal(done, false); assert.equal(woke, false); assert.deepEqual(visible(h), before);
      follower = capture(() => h.failPrompt({ errorCode: 'rate_limited' })); } finally { held.release(); }
    assert.deepEqual((await p).value, { request: before[0].requests[0] }); assert.deepEqual((await follower).value, { request: before[0].requests[0] });
    h[phase] = async () => {}; assert.equal(woke, false); assert.deepEqual(visible(h), before);
    assert.deepEqual(h.count(), [n[0] + 2, n[1], n[2] + 2, n[3]]);
    assert.deepEqual((await h.rows()).slice(-2), [[failed(h)], [failed(h, { error_code: 'rate_limited' })]]);
    (await p).value.request.event_capability.status = 'evil'; assert.deepEqual(visible(h), before);
    for (const errorCode of codes) { assert.deepEqual(await h.failPrompt({ errorCode }), { request: before[0].requests[0] });
      assert.deepEqual((await h.rows()).at(-1), [failed(h, { error_code: errorCode })]); }
    assert.deepEqual(h.count(), [n[0] + 6, n[1], n[2] + 6, n[3]]); assert.equal(woke, false); assert.deepEqual(visible(h), before);
    redacted(h, [h.b.snapshot(), await h.b.status(), h.logs]);
  } finally { abort.abort(); await wait; }
  await h.reopen(); assert.equal(h.b.responseWork().prompts.length, 1);
}));
test('PF-TIME: exact retained opening and latest failure bounds survive restart without public fields', opts, () => native(async h => {
  await h.create(); const rows = await h.rows(); rows.at(-1).find(m => m.op === 'telegram.response.open').opened_at = '2026-11-04T00:00:01.000000001Z';
  await h.replace(rows); await h.b.recover(); await h.reopen(); const before = visible(h), bytes = await h.bytes(), ids = h.ids;
  for (const now of [NaN, Infinity, null, '1', at, at + 1000, new Error('SECRET')]) { h.now = now;
    await assert.rejects(Promise.resolve().then(() => h.failPrompt()), storage); assert.deepEqual(visible(h), before);
    assert.deepEqual(await h.bytes(), bytes); assert.equal(h.ids, ids); }
  h.now = at + 1002; await h.failPrompt({ errorCode: 'rejected' }); await h.reopen();
  h.now = at + 1001; const stable = await h.bytes(); await assert.rejects(Promise.resolve().then(() => h.failPrompt()), storage);
  assert.deepEqual(await h.bytes(), stable); assert.deepEqual(visible(h), before);
  h.now = at + 1002; await h.failPrompt({ errorCode: 'invalid_response' });
  assert.deepEqual((await h.rows()).at(-1), [failed(h, { failed_at: iso(h.now), error_code: 'invalid_response' })]); redacted(h, h.logs);
}));
for (const closure of ['pending', 'cancelled', 'approved', 'rejected', 'expired']) test(`PF-LATE-${closure}: mapped copies and single winner unchanged, no expiry in receipt`, opts, () => native(async h => {
  await h.create(); for (const messageId of [70, 71]) await h.b.recordPromptSent({ requestId: h.keys[0].requestId, chatId: '00081', messageId });
  if (closure === 'cancelled') await h.b.cancelRequest(h.keys[0]);
  else if (closure === 'expired') { h.now = at + 61000; await h.b.readRequest(h.keys[0]); }
  else if (closure !== 'pending') await h.b.resolveCallback(h.fields({ resolution: closure, updateId: 3 }));
  const before = visible(h); h.now = at + 100000; assert.deepEqual(await h.failPrompt(), { request: before[0].requests[0] });
  assert.deepEqual(visible(h), before); await h.reopen(); assert.deepEqual(visible(h), before);
  await unchanged(h, async () => { for (const messageId of [70, 71]) assert.equal((await h.b.recordPromptSent({ requestId: h.keys[0].requestId, chatId: '00081', messageId })).sent, false); });
  if (closure === 'pending') { h.now = at + 100001; assert.equal((await h.b.readRequest(h.keys[0])).resolution, 'expired'); }
}));
for (const phase of ['writing', 'syncing']) test(`PF-FAULT-${phase}: no partial install, shared fence, waiter and surviving failure bound`, opts, () => native(async h => {
  assert.equal(typeof h.b.recordPromptFailed, 'function', 'selected prompt-failure API');
  await h.create(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = visible(h); h.now = at + 1010; const held = h.hold(phase), p = capture(() => h.failPrompt()); let follower;
  try { await held.entered(); follower = capture(() => h.b.recordPromptSent({ requestId: h.keys[0].requestId, chatId: '00081', messageId: 70 })); h.fail = phase; }
  finally { held.release(); }
  for (const result of [await p, await follower, await bounded(() => wait, 1500, 'fault wait')]) {
    assert.ok(storage(result.error)); redacted(h, result.error.message); }
  assert.deepEqual(visible(h), before); await assert.rejects(Promise.resolve().then(() => h.failPrompt()), storage); await assert.rejects(h.b.status(), storage);
  h.fail = null; h[phase] = async () => {}; await h.reopen(); assert.deepEqual(visible(h), before);
  h.now = at + 1009; if (phase === 'syncing') await assert.rejects(Promise.resolve().then(() => h.failPrompt()), storage);
  else await h.failPrompt(); h.now = at + 1010; await h.failPrompt(); redacted(h, h.logs);
}));
test('PF-REPLAY-POS: ordered opening/failures, exact offset/fraction equality, latest bound and clock-free recovery', opts, () => native(async h => {
  await h.create(); const before = visible(h), rows = await h.rows(), opening = rows.pop();
  const t = '2026-11-04T00:00:01.000000002Z'; opening.find(m => m.op === 'telegram.response.open').opened_at = t;
  const first = failed(h, { failed_at: '2026-11-04T00:00:01.000000002+00:00' });
  await h.replace([...rows, [...opening, first, { ...first, error_code: 'rejected' }], [failed(h, { failed_at: '2026-11-04T00:00:01.000000003Z', error_code: 'rate_limited' })]]);
  h.now = NaN; const n = h.count().slice(0, 3), bytes = await h.bytes(); await h.b.recover(); assert.deepEqual(h.count().slice(0, 3), n);
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(visible(h), before); await h.reopen();
  h.now = at + 1000; await assert.rejects(Promise.resolve().then(() => h.failPrompt()), storage);
  h.now = at + 1001; await h.failPrompt(); assert.deepEqual(visible(h), before);
}));
test('PF-REPLAY-STRICT: exact schema/raw code/time/history, staged order and whole-history no partial install', opts, () => native(async h => {
  await h.create(); const base = await h.rows(), r = failed(h);
  const changes = [...Object.keys(r).flatMap(k => [v => { delete v[k]; }, ...[null, [r[k]], {}, false, 1].map(value => v => { v[k] = value; })]),
    v => { v.extra = true; }, ...[{ request_id: unknown }, { request_id: 'bad' }, { error_code: 'SECRET' },
      ...['Unavailable', '', ' rejected', 'rejected '].map(error_code => ({ error_code })),
       ...['2026-02-30T00:00:00Z', '2026-11-04T00:00:01-00:00', '2026-11-04T01:00:01.000000002+01:00', '2026-11-04T00:00:00.999999999Z', 1].map(failed_at => ({ failed_at }))].map(e => v => Object.assign(v, e))];
  for (const change of changes) { const v = structuredClone(r); change(v); await rejectHistory(h, [...base, [v]]); }
  const opening = base.at(-1), prefix = base.slice(0, -1);
  for (const rows of [[...prefix, [r]], [...prefix, [r, ...opening]],
    [...base, [failed(h, { failed_at: '2026-11-04T00:00:01.000000002Z' })], [failed(h, { failed_at: '2026-11-04T00:00:01.000000001Z' })]]]) await rejectHistory(h, rows);
  h.now = at + 2000; await h.replace(base); await h.b.recover(); await h.failPrompt(); const before = visible(h);
  await h.j.append([failed(h, { failed_at: iso(at + 3000) }), { ...r, error_code: 'SECRET' }]); const bytes = await h.bytes(), n = h.count(); h.now = NaN;
  await assert.rejects(h.b.recover(), invalid); assert.deepEqual(visible(h), before); assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.count(), n);
  await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), e => e?.exitCode === 4);
}));
