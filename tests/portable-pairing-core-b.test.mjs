// TEST ONLY: design 4/5 C1/7 native prerequisite, not Telegram/public first use.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspect } from 'node:util';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { sha256Hex } from '../src/util/values.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-01T00:01:00Z'), iso = n => new Date(n).toISOString();
const code = '0123456789abcdef'.repeat(2), other = 'fedcba9876543210'.repeat(2);
const userId = '00090071992547409931234567890', chatId = '00081';
const input = (extra = {}) => ({ code, userId, chatId, updateId: 7, ...extra });
const cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
const consume = (c = code, n = at) => ({ op: 'pairing.challenge.consume', hash: sha256Hex(c), consumed_at: iso(n) });
const binding = (n = at, u = userId, c = chatId) => ({ user_id: u, chat_id: c, paired_at: iso(n) });
const frame = (n = at) => [consume(code, n), { op: 'pairing.set', pairing: binding(n) }, cursor(7)];
const refusal = reason => ({ paired: false, reason });
const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4;
const invalid = e => e?.code === 'JOURNAL_STATE_INVALID' && e.exitCode === 4;
const capture = p => p.then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const opts = { timeout: 10000 };
const ordered = mutations => [...mutations].sort((a, b) => a.op.localeCompare(b.op));

// Same real-Journal fixture pattern as core-A, scoped here without changing its consumers.
async function native(work) {
  const root = resolve('.scratch/c1-core-b'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let j, b, file, samples = 0, writes = 0, syncs = 0;
  const releases = [], logs = [];
  const h = { now: at, generated: code, appending: async () => {}, writing: async () => {}, syncing: async () => {}, logs,
    get b() { return b; }, get j() { return j; }, counts: () => ({ samples, writes, syncs }),
    bytes: () => readFile(path), rows: async () => readJournal(await readFile(path)).transactions.map(t => ordered(t.mutations)),
    progress: phase => writeFile(join(dir, 'progress.json'), JSON.stringify({ phase })),
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { await h.close(); const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a');
      j = new Journal(path, { write: async (...a) => { writes++; await h.writing(); return file.write(...a); },
        sync: async () => { syncs++; await h.syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      const append = j.append.bind(j); j.append = async mutations => { await h.appending(); return append(mutations); };
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { samples++; if (h.now instanceof Error) throw h.now; return h.now; },
        logger: (...a) => logs.push(a), generatePairingCode: () => h.generated }); },
    async recover() { const before = samples; await b.recover(); assert.equal(samples, before); },
    async reopen() { await h.start(); await h.recover(); },
    async issue(c = code) { h.generated = c; assert.equal((await b.pairingChallenge()).code, c); } };
  try { await h.progress('setup'); await h.start(); await h.progress('assertions'); await work(h); }
  finally { for (const release of releases) release(); h.appending = h.writing = h.syncing = async () => {};
    try { await h.progress('teardown'); await h.close(); }
    finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}

test('C1B-CAL: actual producer, prearmed append/write/sync, standalone burn and ordinary reopen', opts, () => native(async h => {
  await h.recover(); await h.issue();
  for (const [i, phase] of ['appending', 'writing'].entries()) {
    const hold = h.hold(phase), sequence = h.j.sequence; let done = false;
    const p = capture(h.j.append([cursor(i)])).then(r => { done = true; return r; });
    await hold.entered(); await tick(); assert.equal(done, false); assert.equal(h.j.sequence, sequence);
    hold.release(); assert.ok((await p).value); h[phase] = async () => {};
  }
  const hold = h.hold('syncing'), sequence = h.j.sequence;
  let done = false; const p = capture(h.j.append([consume()])).then(r => { done = true; return r; });
  await hold.entered(); await tick(); assert.equal(done, false); assert.equal(h.j.sequence, sequence);
  hold.release(); assert.ok((await p).value); h.syncing = async () => {}; await h.reopen();
  assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), 1);
  await assert.rejects(h.b.pairingChallenge(), storage);
}));

for (const delta of [0, 299999, 300000, 300001]) test(`C1B-TIME-${delta}: actual issued code and expiry-exclusive consumption`, opts, () => native(async h => {
  await h.recover(); await h.issue(); const issued = (await h.rows())[0]; h.now = at + delta;
  const before = h.counts(); assert.deepEqual(await h.b.completePairing(input()), delta < 300000 ? { paired: true } : refusal('expired'));
  assert.equal(h.counts().samples - before.samples, 1);
  assert.deepEqual(await h.rows(), [issued, delta < 300000 ? frame(h.now) : [cursor(7)]]);
  assert.deepEqual(h.b.pairing(), delta < 300000 ? binding(h.now) : null); assert.equal(h.b.telegramCursor(), 7);
  h.now = at + 86400000; await h.reopen();
  assert.deepEqual(h.b.pairing(), delta < 300000 ? binding(at + delta) : null); assert.equal(h.b.telegramCursor(), 7);
}));

test('C1B-ATOMIC: one frame, independent lossless tuple, copied view, capability and code privacy', opts, () => native(async h => {
  await h.recover(); const r = await h.b.reserveHandle({ ownerId: 'a' }); await h.issue();
  const before = (await h.rows()).length, sequence = h.j.sequence;
  assert.deepEqual(await h.b.completePairing(input()), { paired: true });
  assert.equal(h.j.sequence, sequence + 1); assert.deepEqual((await h.rows()).slice(before), [frame()]);
  const copy = h.b.pairing(); copy.user_id = '9'; assert.deepEqual(h.b.pairing(), binding());
  const surfaces = JSON.stringify([h.b.snapshot(), await h.b.status(), h.logs]);
  for (const secret of [code, sha256Hex(code), userId, chatId, r.request_capability]) assert.equal(surfaces.includes(secret), false);
  for (const secret of [code, r.request_capability]) assert.equal((await h.bytes()).includes(Buffer.from(secret)), false);
  await h.reopen(); assert.deepEqual(h.b.pairing(), binding()); assert.equal(h.b.telegramCursor(), 7);
  assert.ok(h.b.authorize({ ownerId: 'a', capability: r.request_capability, requestHandle: r.request_handle }));
}));

test('C1B-REFUSE: malformed/unknown/burnt code uses only canonical new cursor', opts, async t => {
  for (const value of [undefined, null, 17, false, '', 'A'.repeat(32), '0'.repeat(31), [code], { toString: () => code }, other, code]) {
    await t.test(inspect(value), () => native(async h => {
      await h.recover(); await h.issue(); if (value === code) { await h.j.append([consume()]); await h.reopen(); }
      const before = await h.rows();
      assert.deepEqual(await h.b.completePairing(input({ code: value })), refusal('invalid'));
      assert.deepEqual(await h.rows(), [...before, [cursor(7)]]); assert.equal(h.b.pairing(), null);
      assert.equal(JSON.stringify(h.logs).includes(code), false);
    }));
  }
});

test('C1B-IDENTITY: native string domain, no numeric/coercion authority, cursor-only refusal', opts, async t => {
  for (const key of ['userId', 'chatId']) for (const value of [undefined, null, 71, '0', '000', '-1', '+1', ' 1', '1\n', '1.0', ['71']]) {
    await t.test(`${key}-${inspect(value)}`, () => native(async h => {
      await h.recover(); await h.issue(); const before = await h.rows();
      assert.deepEqual(await h.b.completePairing(input({ [key]: value })), refusal('invalid'));
      assert.deepEqual(await h.rows(), [...before, [cursor(7)]]); assert.equal(h.b.pairing(), null);
    }));
  }
});

test('C1B-UPDATE: malformed native update ID rejects without mutation, stale bypasses verification', opts, () => native(async h => {
  await h.recover(); await h.issue(); const bytes = await h.bytes(), before = h.counts();
  for (const updateId of [undefined, null, true, '7', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(Promise.resolve().then(() => h.b.completePairing(input({ updateId }))));
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.counts(), before);
  }
  await h.b.advanceCursor(7); const staleBytes = await h.bytes(), counts = h.counts();
  for (const updateId of [0, 7]) assert.deepEqual(await h.b.completePairing(input({ updateId })), refusal('stale'));
  assert.deepEqual(await h.bytes(), staleBytes); assert.deepEqual(h.counts(), counts);
  assert.deepEqual(await h.b.completePairing(input({ updateId: 19 })), { paired: true });
  assert.equal(h.b.telegramCursor(), 19);
}));

test('C1B-RATE: fifth verification allowed, sixth valid code refused, rolling window not fixed minute', opts, () => native(async h => {
  await h.recover(); await h.issue();
  for (const [i, elapsed] of [0, 10000, 20000, 30000, 40000].entries()) {
    h.now = at + elapsed; assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: i })), refusal('invalid'));
  }
  h.now = at + 59999; assert.deepEqual(await h.b.completePairing(input({ updateId: 5 })), refusal('rate_limited'));
  assert.equal(h.b.pairing(), null); assert.equal((await h.rows()).flat().filter(m => m.op === 'pairing.challenge.consume').length, 0);
  h.now = at + 60000; assert.deepEqual(await h.b.completePairing(input({ updateId: 6 })), { paired: true });
  assert.deepEqual(h.b.pairing(), binding(h.now));
}));

test('C1B-ACTORS: sender ceiling spans chats, other sender independent, limiter grants no code authority', opts, () => native(async h => {
  await h.recover(); await h.issue();
  for (let i = 0; i < 5; i++) assert.deepEqual(await h.b.completePairing(input({ code: other, chatId: String(90 + i), updateId: i })), refusal('invalid'));
  assert.deepEqual(await h.b.completePairing(input({ chatId: '99', updateId: 5 })), refusal('rate_limited'));
  assert.deepEqual(await h.b.completePairing(input({ userId: '72', code: other, updateId: 6 })), refusal('invalid'));
  assert.deepEqual(await h.b.completePairing(input({ userId: '72', updateId: 7 })), { paired: true });
  assert.deepEqual(h.b.pairing(), binding(at, '72'));
}));

test('C1B-FIFTH: stale updates spend no verification quota and fifth valid attempt succeeds', opts, () => native(async h => {
  await h.recover(); await h.issue(); await h.b.advanceCursor(0);
  for (let i = 0; i < 6; i++) assert.deepEqual(await h.b.completePairing(input({ updateId: 0 })), refusal('stale'));
  for (let i = 1; i < 5; i++) assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: i })), refusal('invalid'));
  assert.deepEqual(await h.b.completePairing(input()), { paired: true });
}));

test('C1B-RATE-EXPIRY: expired verification counts, fresh code cannot bypass, restart resets only limiter', opts, () => native(async h => {
  await h.recover(); await h.issue(); h.now = at + 300000; await h.issue(other);
  for (let updateId = 0; updateId < 5; updateId++) assert.deepEqual(await h.b.completePairing(input({ updateId })), refusal('expired'));
  assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: 5 })), refusal('rate_limited'));
  await h.reopen(); assert.equal(h.b.telegramCursor(), 5);
  assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: 6 })), { paired: true });
}));

test('C1B-RACE: two actually issued codes, one winner, loser unconsumed and never replaces tuple', opts, () => native(async h => {
  await h.recover(); await h.issue(); await h.issue(other); const before = await h.rows();
  assert.deepEqual(await Promise.all([h.b.completePairing(input()), h.b.completePairing(input({ code: other, userId: '72', chatId: '82', updateId: 8 }))]), [{ paired: true }, refusal('already_paired')]);
  assert.deepEqual(await h.rows(), [...before, frame(), [cursor(8)]]); assert.deepEqual(h.b.pairing(), binding());
  assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: 9 })), refusal('already_paired'));
  await h.reopen(); assert.deepEqual(h.b.pairing(), binding());
}));

test('C1B-QUEUED-TIME: consumption samples inside its turn, not while earlier cursor flush is held', opts, () => native(async h => {
  await h.recover(); await h.issue(); const hold = h.hold('syncing');
  const first = capture(h.b.advanceCursor(1)); await hold.entered(); const counts = h.counts();
  const next = capture(h.b.completePairing(input())); await tick(); assert.deepEqual(h.counts(), counts);
  h.now = at + 300000; hold.release(); assert.equal((await first).value, 1);
  assert.deepEqual((await next).value, refusal('expired')); assert.equal(h.b.pairing(), null);
  assert.deepEqual((await h.rows()).slice(1), [[cursor(1)], [cursor(7)]]);
}));

for (const phase of ['appending', 'writing', 'syncing']) test(`C1B-BARRIER-${phase}: queued race and offset cannot expose uncommitted pairing`, opts, () => native(async h => {
  await h.recover(); await h.issue(); await h.issue(other); const hold = h.hold(phase), before = h.counts(), sequence = h.j.sequence;
  let done = false; const p = capture(h.b.completePairing(input())).then(r => { done = true; return r; }); await hold.entered();
  const loser = capture(h.b.completePairing(input({ code: other, updateId: 8 }))), next = capture(h.b.advanceCursor(19)), recovery = capture(h.b.recover());
  await tick(); assert.equal(done, false); assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null);
  assert.equal(h.j.sequence, sequence); assert.equal(h.counts().samples - before.samples, 1);
  hold.release(); assert.deepEqual((await p).value, { paired: true }); assert.deepEqual((await loser).value, refusal('already_paired'));
  assert.equal((await next).value, 19); assert.ok((await recovery).value);
  assert.deepEqual((await h.rows()).slice(2), [frame(), [cursor(8)], [cursor(19)]]);
}));

for (const phase of ['appending', 'writing', 'syncing']) test(`C1B-FAULT-${phase}: shared uncertain fence, privacy, no offset/confirmation, reopen reconciles`, opts, () => native(async h => {
  await h.recover(); await h.issue(); const hold = h.hold(phase), original = h[phase], sequence = h.j.sequence;
  h[phase] = async () => { await original(); throw new Error('controlled file fault'); };
  const p = capture(h.b.completePairing(input())); await hold.entered();
  const duplicate = capture(h.b.completePairing(input({ updateId: 8 }))), pollOffset = capture(h.b.advanceCursor(19)), reserve = capture(h.b.reserveHandle({ ownerId: 'a' }));
  const before = h.counts(); hold.release();
  for (const result of await Promise.all([p, duplicate, pollOffset, reserve])) { assert.ok(storage(result.error)); assert.equal(inspect(result.error).includes(code), false); }
  assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null); assert.equal(h.j.sequence, sequence);
  await assert.rejects(h.b.completePairing(input({ updateId: 20 })), storage); await assert.rejects(h.b.advanceCursor(21), storage);
  await assert.rejects(h.b.pairingChallenge(), storage); await assert.rejects(h.b.status(), storage); await assert.rejects(h.b.recover(), storage);
  assert.deepEqual(h.counts(), before); assert.equal(JSON.stringify(h.logs).includes(code), false);
  h.appending = h.writing = h.syncing = async () => {}; await h.reopen();
  assert.deepEqual(h.b.pairing(), phase === 'syncing' ? binding() : null); assert.equal(h.b.telegramCursor(), phase === 'syncing' ? 7 : null);
  if (phase !== 'syncing') assert.deepEqual(await h.b.completePairing(input()), { paired: true });
  else assert.deepEqual(await h.b.completePairing(input()), refusal('stale'));
}));

test('C1B-CLOCK: preappend clock failure stages no attempt/pairing/cursor, healthy retry remains possible', opts, async t => {
  for (const value of [NaN, Infinity, '2026-11-01', new Error(code)]) await t.test(inspect(value), () => native(async h => {
    await h.recover(); await h.issue(); const bytes = await h.bytes(); h.now = value;
    const result = await capture(h.b.completePairing(input())); assert.ok(storage(result.error)); assert.equal(result.error.message.includes(code), false);
    assert.deepEqual(await h.bytes(), bytes); assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null);
    h.now = at; for (let i = 0; i < 4; i++) assert.deepEqual(await h.b.completePairing(input({ code: other, updateId: i })), refusal('invalid'));
    assert.deepEqual(await h.b.completePairing(input()), { paired: true });
  }));
});

test('C1B-ADMISSION: unrecovered, operational and closed cannot sample, append or pair', opts, async t => {
  for (const mode of ['unrecovered', 'operational', 'closed']) await t.test(mode, () => native(async h => {
    if (mode !== 'unrecovered') { await h.recover(); await h.issue(); }
    if (mode === 'operational') h.b.latchDeadlineFailure(); if (mode === 'closed') await h.b.close();
    const bytes = await h.bytes(), counts = h.counts(); await assert.rejects(h.b.completePairing(input()), storage);
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.counts(), counts); assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null);
  }));
});

test('C1B-STAGING: first failed recovery installs no otherwise valid consumable challenge/cursor', opts, () => native(async h => {
  await h.recover(); await h.issue(); await h.close(); await h.start();
  await h.j.append([cursor(7)]); await h.j.append([cursor(6)]); const bytes = await h.bytes();
  await assert.rejects(h.b.recover(), invalid); assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null);
  await assert.rejects(h.b.completePairing(input({ updateId: 19 })), storage); assert.deepEqual(await h.bytes(), bytes);
}));
