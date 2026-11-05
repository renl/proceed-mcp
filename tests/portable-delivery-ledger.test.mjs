// TEST ONLY: design 3/4/6/7. Returned here proves ledger admission, NOT an MCP write.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { storageFailure } from '../src/errors.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-01T00:01:00Z'), iso = n => new Date(n).toISOString();
const decision = n => `dec_${n.toString(16).padStart(32, '0')}`;
const kinds = ['acknowledge', 'returned'], method = k => k === 'acknowledge' ? 'acknowledgeRequest' : 'returnedRequest';
const timeKey = k => k === 'acknowledge' ? 'acknowledged_at' : 'returned_at';
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const captured = p => p.then(value => ({ value }), error => ({ error }));
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalidHistory = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID';
const binding = p => ({ ownerId: 'shared', capability: p.request_capability, requestId: p.request_id });
const records = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const evidence = (h, k, extra = {}) => ({ op: `request.${k}`, request_id: h.p[0].request_id,
  decision_id: h.terminal.decision_id, [timeKey(k)]: iso(at), delivery_state: k === 'acknowledge' ? 'confirmed' : 'returned', ...extra });
async function native(work) {
  const root = resolve('.scratch/delivery-ledger'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let j, b, file, samples = 0, ids = 0, appends = 0;
  const h = { now: at, sync: async () => {}, get b() { return b; }, get j() { return j; },
    counts: () => ({ samples, ids, appends }), bytes: () => readFile(path),
    async reopen() { await b.close(); await j.close(); await start(); } };
  async function start() {
    const initial = await Journal.open(path), sequence = initial.sequence; await initial.close(); file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, sequence);
    b = createPortableBroker({ journal: { recover: () => j.recover(), append: m => { appends++; return j.append(m); } },
      owners: [{ owner_id: 'shared', label: 'Display only' }, { owner_id: 'foreign', label: 'Other' }], port: 43189,
      clock: () => { samples++; if (h.now instanceof Error) throw h.now; return h.now; }, generateDecisionId: () => decision(++ids) });
    const before = samples; await b.recover(); assert.equal(samples, before, 'replay is clock-free');
  }
  try {
    const seed = await Journal.open(path);
    try {
      await seed.append([{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: iso(at), expires_at: iso(at + 300000) }]);
      await seed.append([{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: iso(at) },
        { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: iso(at) } }]);
    } finally { await seed.close(); }
    await start(); h.p = [];
    for (let i = 0; i < 3; i++) h.p.push(await b.reserveHandle({ ownerId: 'shared' }));
    for (const p of h.p.slice(0, 2)) await b.createRequest({ ownerId: 'shared', capability: p.request_capability,
      requestHandle: p.request_handle, clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
    h.terminal = await b.cancelRequest(binding(h.p[0]));
    h.call = (k, extra = {}, p = h.p[0]) => Promise.resolve().then(() => b[method(k)]({ ...binding(p), decisionId: h.terminal.decision_id, ...extra }));
    await work(h);
  } finally {
    try { await b?.close(); await j?.close(); } finally {
      await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' });
    }
  }
}
const options = { timeout: 10000 };
test('LEDGER-CAL: real closure, exact record, clock-free reopen and expiry calibrate setup', options, () => native(async h => {
  assert.equal(records(await h.bytes()).at(-1).op, 'request.cancel'); await h.reopen();
  assert.deepEqual(await h.b.readRequest(binding(h.p[0])), h.terminal); h.now = at + 60000;
  assert.equal((await h.b.readRequest(binding(h.p[1]))).resolution, 'expired');
}));
for (const order of [kinds, [...kinds].reverse()]) test(`LEDGER-WRITE-${order.join('-')}: both orders and concurrent duplicates retain first evidence`, options, () => native(async h => {
  let expected = h.terminal; const initial = h.counts();
  for (const [i, k] of order.entries()) {
    h.now = at + i * 1000; const [a, b] = await Promise.all([h.call(k), h.call(k)]);
    expected = { ...expected, delivery_state: k === 'acknowledge' || expected.delivery_state === 'confirmed' ? 'confirmed' : 'returned', delivery_error: null };
    assert.deepEqual(a, expected); assert.deepEqual(b, expected);
    assert.deepEqual(records(await h.bytes()).at(-1), evidence(h, k, { [timeKey(k)]: iso(h.now), delivery_state: expected.delivery_state }));
    a.event_capability.reason = 'changed'; a.action = 'changed'; assert.deepEqual(await h.call(k), expected);
  }
  assert.deepEqual(h.counts(), { samples: initial.samples + 2, ids: initial.ids, appends: initial.appends + 2 });
  const bytes = await h.bytes(); h.now = new Error('no repeated evidence clock');
  for (const k of kinds) assert.deepEqual(await h.call(k), expected);
  assert.deepEqual(await h.bytes(), bytes); h.now = at + 90000; await h.reopen();
  const counts = h.counts(); for (const k of kinds) assert.deepEqual(await h.call(k), expected);
  assert.deepEqual(h.counts(), counts); assert.deepEqual(await h.bytes(), bytes);
}));
test('LEDGER-RACE: simultaneous different evidence kinds serialize without confirmed downgrade', options, () => native(async h => {
  await Promise.all(kinds.map(k => h.call(k))); assert.equal(h.b.snapshot().requests[0].delivery_state, 'confirmed');
  assert.deepEqual(records(await h.bytes()).slice(-2).map(m => m.op).sort(), kinds.map(k => `request.${k}`).sort());
}));
for (const k of kinds) test(`LEDGER-EXPIRED-${k}: actual expired closure accepts evidence with stable identity on reopen`, options, () => native(async h => {
  h.now = at + 60000; const expired = await h.b.readRequest(binding(h.p[1])), counts = h.counts();
  const value = await h.call(k, { decisionId: expired.decision_id }, h.p[1]);
  assert.deepEqual(value, { ...expired, delivery_state: k === 'acknowledge' ? 'confirmed' : 'returned', delivery_error: null });
  assert.deepEqual(h.counts(), { samples: counts.samples + 1, ids: counts.ids, appends: counts.appends + 1 });
  await h.reopen(); assert.deepEqual(await h.b.readRequest(binding(h.p[1])), value);
}));
for (const k of kinds) test(`LEDGER-ADMISSION-${k}: decision validation precedes exact authority; due pending never expires`, options, () => native(async h => {
  const before = h.b.snapshot(), bytes = await h.bytes(), counts = h.counts(); h.now = new Error('must not sample');
  for (const input of [undefined, null, [], {}, { decisionId: null }, { decisionId: [decision(1)] }, { decisionId: 'DEC_bad' }])
    await assert.rejects(Promise.resolve().then(() => h.b[method(k)](input)), e => e?.exitCode === 2 && e.code === 'INVALID_ARGUMENT');
  for (const extra of [{ ownerId: undefined }, { ownerId: 'foreign' }, { capability: undefined },
    { capability: h.p[1].request_capability }, { requestId: undefined }, { requestId: ['bad'] }, { requestId: `req_${'0'.repeat(32)}` }])
    assert.equal(await h.call(k, extra), null);
  assert.equal(await h.call(k, {}, h.p[2]), null);
  for (const p of h.p.slice(0, 2)) await assert.rejects(h.call(k, { decisionId: decision(99) }, p), e => e?.status === 409 && e.code === 'DECISION_MISMATCH' && e.retryable === false);
  h.now = at + 60000; await assert.rejects(h.call(k, {}, h.p[1]), e => e?.code === 'DECISION_MISMATCH');
  assert.deepEqual(h.counts(), counts); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
}));
for (const k of kinds) test(`LEDGER-SYNC-${k}: actual flush gates install; denied input bypasses held queue; queued clock is fresh`, options, () => native(async h => {
  const entered = gate(), release = gate(), before = h.b.snapshot(); let settled = false;
  h.sync = async () => { entered.release(); await release.promise; }; const first = captured(h.call(k)); first.then(() => { settled = true; });
  try {
    await bounded(() => Promise.race([entered.promise, first.then(r => { if (r.error) throw r.error; })]), 1500, 'sync entry');
    assert.equal(settled, false); assert.deepEqual(h.b.snapshot(), before); const counts = h.counts();
    assert.equal(await bounded(() => h.call(k, { requestId: undefined }), 1000, 'prequeue denial'), null);
    assert.equal(await bounded(() => h.call(k, {}, h.p[2]), 1000, 'unused reservation denial'), null);
    await assert.rejects(bounded(() => h.call(k, { decisionId: null }), 1000, 'prequeue validation'), e => e.code === 'INVALID_ARGUMENT');
    assert.deepEqual(h.counts(), counts); const other = kinds.find(x => x !== k), follower = captured(h.call(other));
    h.now = at + 1000; release.release(); assert.ok((await first).value); assert.ok((await follower).value);
    assert.equal(records(await h.bytes()).at(-1)[timeKey(other)], iso(h.now));
  } finally { release.release(); await first; }
}));
for (const k of kinds) for (const fault of ['sync', 'no-frame']) test(`LEDGER-FAULT-${k}-${fault}: journal-wide fence then normal reopen`, options, () => native(async h => {
  const before = h.b.snapshot(), entered = gate(), release = gate(), append = h.j.append.bind(h.j);
  if (fault === 'sync') h.sync = async () => { entered.release(); await release.promise; throw storageFailure('controlled sync refusal'); };
  else h.j.append = async () => { entered.release(); await release.promise; throw storageFailure('controlled prewrite refusal'); };
  const first = captured(h.call(k)); let followers;
  try {
    await bounded(() => Promise.race([entered.promise, first.then(r => { if (r.error) throw r.error; })]), 1500, 'fault entry');
    followers = [captured(h.call(k)), captured(h.call(kinds.find(x => x !== k))), captured(h.b.reserveHandle({ ownerId: 'shared' })), captured(h.b.readRequest(binding(h.p[1])))];
    const counts = h.counts(); release.release(); assert.ok(storage((await first).error));
    for (const f of followers) assert.ok(storage((await f).error));
    await assert.rejects(h.call(k), storage); assert.deepEqual(h.counts(), counts); assert.deepEqual(h.b.snapshot(), before);
    assert.equal(await h.call(k, { capability: undefined }), null);
  } finally { release.release(); await first; if (followers) await Promise.all(followers); }
  h.sync = async () => {}; h.j.append = append; await h.reopen(); const value = await h.call(k);
  assert.equal(value.delivery_state, k === 'acknowledge' ? 'confirmed' : 'returned');
  assert.equal(records(await h.bytes()).filter(m => m.op === `request.${k}`).length, 1);
}));
for (const k of kinds) test(`LEDGER-CLOCK-${k}: unusable or before-resolution clock refuses without fence`, options, () => native(async h => {
  const bytes = await h.bytes(), before = h.b.snapshot();
  for (const now of [at - 1, NaN, 'bad', 1e20, new Error('clock')]) {
    h.now = now; await assert.rejects(h.call(k), storage); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  }
  h.now = at; assert.ok(await h.call(k));
}));
for (const k of kinds) test(`LEDGER-LIFECYCLE-${k}: queued operational latch and terminal close refuse`, options, () => native(async h => {
  const entered = gate(), release = gate(); h.sync = async () => { entered.release(); await release.promise; };
  const first = captured(h.b.reserveHandle({ ownerId: 'shared' }));
  try {
    await bounded(() => entered.promise, 1500, 'reserve sync'); const queued = captured(h.call(k));
    h.b.latchDeadlineFailure(); const counts = h.counts(); release.release(); assert.ok((await first).value);
    assert.ok(storage((await queued).error)); assert.deepEqual(h.counts(), counts);
    assert.equal(await h.call(k, { ownerId: 'foreign' }), null);
  } finally { release.release(); await first; }
  await h.b.close(); await assert.rejects(h.call(k), storage);
}));
for (const k of kinds) test(`LEDGER-REPLAY-${k}: strict vocabulary, ordered transitions, whole-history fail-closed`, { timeout: 20000 }, async t => {
  const cases = [['null mutation', () => null], ['array mutation', m => [m]], ['extra', m => ({ ...m, extra: true })], ['unknown', m => ({ ...m, request_id: `req_${'0'.repeat(32)}` })],
    ['pending', (m, h) => ({ ...m, request_id: h.p[1].request_id })], ['mismatch', m => ({ ...m, decision_id: decision(99) })],
    ['wrong state', m => ({ ...m, delivery_state: 'unavailable' })], ['downgrade/nonconfirmed', m => ({ ...m, delivery_state: 'returned' })], ['before resolution', m => ({ ...m, [timeKey(k)]: '2026-11-01T00:00:59.9999999Z' })],
    ...['2026-02-30T00:01:00Z', '2026-11-01T00:01:00-00:00', '2026-11-01T01:01:00+01:00'].map(v => [v, m => ({ ...m, [timeKey(k)]: v })])];
  for (const key of ['op', 'request_id', 'decision_id', timeKey(k), 'delivery_state']) {
    for (const value of [null, 1, true, {}, [], 'bad']) cases.push([`${key}:${JSON.stringify(value)}`, m => ({ ...m, [key]: value })]);
    cases.push([`missing ${key}`, m => { delete m[key]; return m; }], [`coercible ${key}`, m => ({ ...m, [key]: [m[key]] })]);
  }
  for (const [name, change] of cases) await t.test(name, () => native(async h => {
    const other = kinds.find(x => x !== k), good = evidence(h, other); await h.j.append([good]); await h.b.recover();
    const installed = h.b.snapshot(), counts = h.counts();
    await h.j.append([change(evidence(h, k, { delivery_state: 'confirmed' }), h)]); const bytes = await h.bytes();
    await assert.rejects(h.b.recover(), invalidHistory); assert.deepEqual(h.b.snapshot(), installed); assert.deepEqual(await h.bytes(), bytes);
    await assert.rejects(h.call(k), storage); assert.deepEqual(h.counts(), counts);
  }));
});
for (const k of kinds) test(`LEDGER-INSTANT-${k}: decoded closure lower bound, independent evidence times, duplicate history invalid`, options, () => native(async h => {
  // Strict decoder-only records; no human outcome or blocked/error producer is fabricated.
  await h.j.append([{ op: 'request.expire', request_id: h.p[1].request_id, decision_id: decision(2),
    resolved_at: '2026-11-01T00:02:00.0000001+00:00', delivery_state: 'pending' }]); await h.b.recover();
  const installed = h.b.snapshot(), bytes = await h.bytes(); h.now = at + 60000;
  await assert.rejects(h.call(k, { decisionId: decision(2) }, h.p[1]), storage);
  assert.deepEqual(h.b.snapshot(), installed); assert.deepEqual(await h.bytes(), bytes);
  const first = evidence(h, k, { [timeKey(k)]: '2026-11-01T00:01:00.0000001+00:00' });
  const other = kinds.find(x => x !== k), second = evidence(h, other, { delivery_state: 'confirmed', [timeKey(other)]: '2026-11-01T00:01:00.0000000Z' });
  await h.j.append([first, second]); await h.b.recover(); const good = h.b.snapshot(); assert.equal(good.requests[0].delivery_state, 'confirmed');
  await h.j.append([first]); const history = await h.bytes(); await assert.rejects(h.b.recover(), invalidHistory);
  assert.deepEqual(h.b.snapshot(), good); assert.deepEqual(await h.bytes(), history);
  const fresh = createPortableBroker({ journal: h.j, owners: [{ owner_id: 'shared', label: 'Display only' }], port: 43189, clock: () => at });
  try {
    await assert.rejects(fresh.recover(), invalidHistory); assert.deepEqual(fresh.snapshot().requests, []);
    await assert.rejects(fresh.reserveHandle({ ownerId: 'shared' }), storage); assert.deepEqual(await h.bytes(), history);
  } finally { await fresh.close(); }
}));
for (const k of kinds) test(`LEDGER-CANCEL-INSTANT-${k}: replayed cancellation retains submillisecond resolution bound`, options, () => native(async h => {
  await h.j.append([{ op: 'request.cancel', request_id: h.p[1].request_id, decision_id: decision(2),
    resolved_at: '2026-11-01T00:01:00.0000001Z', delivery_state: 'unavailable' }]); await h.b.recover();
  const before = h.b.snapshot(), bytes = await h.bytes(); h.now = at;
  await assert.rejects(h.call(k, { decisionId: decision(2) }, h.p[1]), storage);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  h.now = at + 1; const v = await h.call(k, { decisionId: decision(2) }, h.p[1]);
  assert.equal(v.resolved_at, before.requests[1].resolved_at);
  await h.reopen(); assert.deepEqual(await h.b.readRequest(binding(h.p[1])), v);
}));
