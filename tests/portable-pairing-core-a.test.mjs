// TEST ONLY: design 4/5 C1 enabling checkpoint. No Telegram/public pairing proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { sha256Hex } from '../src/util/values.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-01T00:01:00Z'), iso = n => new Date(n).toISOString();
const code = '0123456789abcdef'.repeat(2), nextCode = 'fedcba9876543210'.repeat(2);
const cursor = last_update_id => ({ op: 'telegram.cursor', last_update_id });
const challenge = (c = code) => ({ op: 'pairing.challenge', hash: sha256Hex(c), created_at: iso(at), expires_at: iso(at + 300000) });
const pairing = { user_id: '71', chat_id: '81', paired_at: iso(at) };
const paired = () => [[challenge()], [{ op: 'pairing.challenge.consume', hash: sha256Hex(code), consumed_at: iso(at) }, { op: 'pairing.set', pairing }]];
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = p => p.then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4;
const invalid = e => e?.code === 'JOURNAL_STATE_INVALID' && e.exitCode === 4;
const opts = { timeout: 10000 };

// Maintained native runner owns real file handles, progress, bounded barriers and teardown.
async function native(work, history = [], extra = {}) {
  const root = resolve('.scratch/c1-core-a'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let j, b, file, samples = 0, generated = 0, writes = 0, syncs = 0;
  const releases = [], logs = [];
  const h = { now: at, generate: () => code, writing: async () => {}, syncing: async () => {},
    get b() { return b; }, get j() { return j; }, logs,
    counts: () => ({ samples, generated, writes, syncs }), bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    progress: phase => writeFile(join(dir, 'progress.json'), JSON.stringify({ phase })),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async seed(rows) { const writer = await Journal.open(path); try { for (const m of rows) await writer.append(m); } finally { await writer.close(); } },
    async start(options = {}) {
      await h.close(); const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a');
      j = new Journal(path, { write: async (...a) => { writes++; await h.writing(); return file.write(...a); },
        sync: async () => { syncs++; await h.syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { samples++; if (h.now instanceof Error) throw h.now; return h.now; },
        logger: (...a) => logs.push(a), generatePairingCode: () => { generated++; return h.generate(); }, ...options });
    },
    async recover() { const before = samples; await b.recover(); assert.equal(samples, before, 'recovery cannot consult current time'); },
    async reopen() { await h.start(); await h.recover(); } };
  try { await h.progress('setup'); await h.seed(history); await h.start(extra); await h.progress('assertions'); await work(h); }
  finally { for (const release of releases) release(); h.writing = h.syncing = async () => {};
    try { await h.progress('teardown'); await h.close(); }
    finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}

test('C1A-CAL: real Journal flush gate and historical A0 pairing without cursor', opts, () => native(async h => {
  await h.recover(); assert.deepEqual(h.b.pairing(), pairing);
  const hold = h.hold('syncing'), before = h.j.sequence;
  let done = false; const p = capture(h.j.append([challenge(nextCode)])).then(r => { done = true; return r; });
  await hold.entered(); await tick(); assert.equal(done, false); assert.equal(h.j.sequence, before);
  hold.release(); assert.ok((await p).value); h.syncing = async () => {};
  await h.reopen(); assert.deepEqual(h.b.pairing(), pairing);
}, paired()));

test('C1A-WRITE: exact hashed five-minute challenge, protected surfaces and actual-writer reopen', opts, () => native(async h => {
  await h.recover(); assert.equal(h.b.telegramCursor(), null);
  const before = h.counts();
  assert.deepEqual(await h.b.pairingChallenge(), { code, expires_at: iso(at + 300000) });
  assert.equal(h.counts().samples - before.samples, 1); assert.equal(h.counts().generated - before.generated, 1);
  assert.deepEqual(await h.rows(), [[challenge()]]); assert.equal(h.b.pairing(), null);
  const surfaces = JSON.stringify([h.b.snapshot(), await h.b.status(), h.logs]);
  assert.equal(surfaces.includes(code), false); assert.equal(surfaces.includes(sha256Hex(code)), false);
  assert.equal((await h.bytes()).includes(Buffer.from(code)), false);
  h.now = at + 86400000; await h.reopen(); const bytes = await h.bytes();
  await assert.rejects(h.b.pairingChallenge(), storage); // Historical hash collision, even after expiry.
  assert.deepEqual(await h.bytes(), bytes);
  h.generate = () => nextCode; assert.equal((await h.b.pairingChallenge()).code, nextCode);
}));

for (const phase of ['writing', 'syncing']) test(`C1A-BARRIER-${phase}: prearmed queue, code and cursor hidden until flush`, opts, () => native(async h => {
  await h.recover(); const hold = h.hold(phase), before = h.counts(), sequence = h.j.sequence;
  let generated = 0; h.generate = () => ++generated === 1 ? code : nextCode;
  let done = false; const p = capture(h.b.pairingChallenge()).then(r => { done = true; return r; });
  await hold.entered(); const second = capture(h.b.pairingChallenge()), follower = capture(h.b.advanceCursor(7)), recovery = capture(h.b.recover());
  await tick(); assert.equal(done, false); assert.equal(h.j.sequence, sequence);
  assert.equal(h.b.telegramCursor(), null); assert.equal(h.counts().generated - before.generated, 1);
  assert.equal(h.counts().samples - before.samples, 1);
  assert.equal(JSON.stringify([h.b.snapshot(), h.logs]).includes(code), false);
  hold.release(); assert.equal((await p).value.code, code); assert.equal((await second).value.code, nextCode); assert.equal((await follower).value, 7);
  assert.ok((await recovery).value); assert.deepEqual(await h.rows(), [[challenge()], [challenge(nextCode)], [cursor(7)]]);
}));

test('C1A-CURSOR: zero, gaps, maximum safe next offset, stale no-op and queued monotonicity', opts, () => native(async h => {
  await h.recover(); const before = h.counts();
  assert.equal(await h.b.advanceCursor(0), 0);
  assert.deepEqual(await Promise.all([7, 3, 7, 19].map(n => h.b.advanceCursor(n))), [7, 7, 7, 19]);
  const max = Number.MAX_SAFE_INTEGER - 1; assert.equal(await h.b.advanceCursor(max), max);
  assert.deepEqual(await h.rows(), [0, 7, 19, max].map(n => [cursor(n)]));
  assert.equal(h.counts().samples, before.samples); assert.equal(h.counts().generated, before.generated);
  const bytes = await h.bytes(); assert.equal(await h.b.advanceCursor(max), max); assert.deepEqual(await h.bytes(), bytes);
  await h.reopen(); assert.equal(h.b.telegramCursor(), max);
  assert.deepEqual(h.b.snapshot(), { prepared: [], requests: [] });
  assert.deepEqual(Object.keys(await h.b.status()).sort(), ['broker', 'requests', 'schema_version']);
}));

test('C1A-CURSOR-BARRIER: cursor cannot become an offset before its own flush', opts, () => native(async h => {
  await h.recover(); const hold = h.hold('syncing'); let done = false;
  const p = capture(h.b.advanceCursor(8)).then(r => { done = true; return r; }); await hold.entered();
  const follower = capture(h.b.advanceCursor(3)); await tick();
  assert.equal(done, false); assert.equal(h.b.telegramCursor(), null); assert.equal(h.j.sequence, 0);
  hold.release(); assert.equal((await p).value, 8); assert.equal((await follower).value, 8);
  assert.deepEqual(await h.rows(), [[cursor(8)]]);
}));

test('C1A-CURSOR-INPUT: no coercion or unsafe next offset and valid control', opts, () => native(async h => {
  await h.recover(); const bytes = await h.bytes(), before = h.counts();
  for (const value of [null, true, '7', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, { valueOf: () => 7 }]) {
    await assert.rejects(Promise.resolve().then(() => h.b.advanceCursor(value)));
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.counts(), before);
  }
  assert.equal(await h.b.advanceCursor(7), 7);
}));

test('C1A-GENERATOR: raw encoding, thrown/async outputs and invalid clock do not append or fence', opts, async t => {
  for (const value of [null, 17, 'A'.repeat(32), '0'.repeat(31), '0'.repeat(33), { toString: () => code }, Promise.resolve(code), new Error(code)]) {
    await t.test(String(value), () => native(async h => {
      await h.recover(); const bytes = await h.bytes();
      h.generate = () => { if (value instanceof Error) throw value; return value; };
      await assert.rejects(h.b.pairingChallenge(), storage); assert.deepEqual(await h.bytes(), bytes);
      h.generate = () => code; assert.equal((await h.b.pairingChallenge()).code, code);
    }));
  }
  for (const now of [NaN, Infinity, '2026-11-01', 8640000000000000, new Error('clock')]) await t.test(`clock-${now}`, () => native(async h => {
    await h.recover(); const bytes = await h.bytes(); h.now = now;
    await assert.rejects(h.b.pairingChallenge(), storage); assert.deepEqual(await h.bytes(), bytes);
    h.now = at; assert.equal((await h.b.pairingChallenge()).code, code);
  }));
});

test('C1A-DEFAULT: ordinary random generator is optional and persists only verifiers', opts, () => native(async h => {
  await h.recover(); const a = await h.b.pairingChallenge(), b = await h.b.pairingChallenge();
  for (const result of [a, b]) { assert.match(result.code, /^[a-f0-9]{32}$/); assert.equal(result.expires_at, iso(at + 300000));
    assert.equal((await h.bytes()).includes(Buffer.from(result.code)), false); }
  assert.notEqual(a.code, b.code); assert.deepEqual(await h.rows(), [[challenge(a.code)], [challenge(b.code)]]);
}, [], { generatePairingCode: undefined }));

test('C1A-ADMISSION: unrecovered, paired, operational latch and closed retain precedence', opts, async t => {
  for (const mode of ['unrecovered', 'paired', 'operational', 'closed']) await t.test(mode, () => native(async h => {
    if (mode !== 'unrecovered') await h.recover();
    if (mode === 'operational') h.b.latchDeadlineFailure(); if (mode === 'closed') await h.b.close();
    const bytes = await h.bytes(), before = h.counts();
    await assert.rejects(h.b.pairingChallenge(), mode === 'paired' ? e => e.code === 'IDEMPOTENCY_CONFLICT' && e.message === 'A human is already paired; pairing cannot be replaced' && e.retryable === false : storage);
    if (mode !== 'paired') await assert.rejects(h.b.advanceCursor(9), storage);
    assert.deepEqual(h.counts(), before); assert.deepEqual(await h.bytes(), bytes);
  }, mode === 'paired' ? paired() : []));
});

for (const phase of ['writing', 'syncing']) for (const kind of ['challenge', 'cursor']) test(`C1A-FAULT-${phase}-${kind}: uncertain append fences queued/fresh work, ordinary reopen only`, opts, () => native(async h => {
  await h.recover(); const hold = h.hold(phase); const original = h[phase];
  h[phase] = async () => { await original(); throw new Error('controlled file fault'); };
  const p = capture(kind === 'challenge' ? h.b.pairingChallenge() : h.b.advanceCursor(8)); await hold.entered();
  const follower = capture(h.b.advanceCursor(12)); const before = h.counts(); hold.release();
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error));
  await assert.rejects(h.b.pairingChallenge(), storage); await assert.rejects(h.b.advanceCursor(13), storage);
  assert.deepEqual(h.counts(), before); assert.equal(h.b.telegramCursor(), null); assert.equal(h.j.sequence, 0);
  h.writing = h.syncing = async () => {}; await h.reopen(); assert.equal(h.b.telegramCursor(), phase === 'syncing' && kind === 'cursor' ? 8 : null);
  assert.deepEqual(await h.rows(), phase === 'syncing' ? [[kind === 'challenge' ? challenge() : cursor(8)]] : []);
  h.generate = () => nextCode; assert.equal((await h.b.pairingChallenge()).code, nextCode);
}));

test('C1A-REPLAY: exact cursor schema, raw range and monotonic transaction matrix', { timeout: 20000 }, async t => {
  const bad = [null, true, '7', -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
  const histories = bad.map(v => [[cursor(v)]]);
  histories.push([[{ op: 'telegram.cursor' }]], [[{ ...cursor(8), extra: true }]], [[cursor(8), cursor(9)]], [[cursor(8)], [cursor(8)]], [[cursor(8)], [cursor(7)]]);
  for (const [index, rows] of histories.entries()) await t.test(`invalid-${index}`, () => native(async h => {
    const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
    assert.deepEqual(await h.bytes(), bytes); assert.equal(h.b.telegramCursor(), null); assert.equal(h.b.pairing(), null);
    assert.deepEqual(h.b.snapshot(), { prepared: [], requests: [] });
    await assert.rejects(h.b.pairingChallenge(), storage); assert.deepEqual(await h.bytes(), bytes);
  }, [...paired(), ...rows]));
  for (const n of [0, 7, Number.MAX_SAFE_INTEGER - 1]) await t.test(`valid-${n}`, () => native(async h => {
    await h.recover(); assert.equal(h.b.telegramCursor(), n); assert.deepEqual(h.b.pairing(), pairing);
  }, [...paired(), [cursor(n)]]));
  for (const index of [0, 1, 2]) { const rows = paired(); rows[1].splice(index, 0, cursor(7));
    await t.test(`atomic-pairing-cursor-position-${index}`, () => native(async h => {
      await h.recover(); assert.equal(h.b.telegramCursor(), 7); assert.deepEqual(h.b.pairing(), pairing);
    }, rows)); }
});

test('C1A-STAGING: later bad history cannot install earlier valid cursor/challenge/pairing/reservation', opts, () => native(async h => {
  await h.recover(); const reservation = await h.b.reserveHandle({ ownerId: 'a' });
  await h.b.advanceCursor(5); const snapshot = h.b.snapshot(), bytes = await h.bytes();
  // Raw Journal appends are test setup only, never an application writer or Telegram success.
  await h.j.append([cursor(10), challenge(nextCode)]); await h.j.append([cursor(9)]);
  const poisoned = await h.bytes(); await assert.rejects(h.b.recover(), invalid);
  assert.equal(h.b.telegramCursor(), 5); assert.deepEqual(h.b.snapshot(), snapshot); assert.deepEqual(h.b.pairing(), pairing);
  assert.ok(h.b.authorize({ ownerId: 'a', capability: reservation.request_capability, requestHandle: reservation.request_handle }));
  assert.deepEqual(await h.bytes(), poisoned); assert.ok(poisoned.length > bytes.length);
  await assert.rejects(h.b.advanceCursor(11), storage);
}, paired()));
