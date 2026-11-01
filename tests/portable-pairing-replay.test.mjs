// TEST ONLY: design 4/7 A0 storage prerequisite, not public pairing/first use.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { createPortableBroker } from '../src/broker/portable.js';

const owners = [{ owner_id: 'a', label: 'A' }, { owner_id: 'b', label: 'B' }];
const hash = 'a'.repeat(64), other = 'b'.repeat(64);
const created = '2026-11-01T00:00:00Z', expires = '2026-11-01T00:05:00Z';
const at = '2026-11-01T00:01:00Z';
const challenge = (extra = {}) => ({ op: 'pairing.challenge', hash,
  created_at: created, expires_at: expires, ...extra });
const consume = (extra = {}) => ({ op: 'pairing.challenge.consume', hash, consumed_at: at, ...extra });
const pairing = (extra = {}) => ({ user_id: '00090071992547409931234567890',
  chat_id: '00071', paired_at: at, ...extra });
const set = (extra = {}) => ({ op: 'pairing.set', pairing: pairing(), ...extra });
const valid = () => [[challenge()], [consume(), set()]];
const invalid = error => error.code === 'JOURNAL_STATE_INVALID' && error.exitCode === 4;

async function fixture(work) {
  const root = resolve('.scratch/a0-pairing-replay');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  const path = join(directory, 'journal.log');
  let journal, broker;
  const logs = [];
  const h = { path, logs,
    async close() { await broker?.close(); await journal?.close(); },
    async seed(history) {
      await h.close();
      const writer = await Journal.open(path);
      try { for (const mutations of history) await writer.append(mutations); }
      finally { await writer.close(); }
    },
    async open(extra = {}) {
      await h.close();
      journal = await Journal.open(path);
      broker = createPortableBroker({ journal, owners, port: 43189,
        // Constructor may call once for started_at; historical validity uses no live time.
        clock: () => Date.parse('2040-01-01T00:00:00Z'),
        logger: (...args) => logs.push(args), ...extra });
      return { broker, journal };
    } };
  try { await work(h); }
  finally {
    try { await h.close(); }
    finally {
      await rm(directory, { recursive: true, force: true });
      await assert.rejects(access(directory), { code: 'ENOENT' });
    }
  }
}

async function rejected(h, history) {
  await h.seed(history);
  const { broker, journal } = await h.open();
  const bytes = await readFile(h.path), sequence = journal.sequence;
  await assert.rejects(broker.recover(), error => {
    assert.ok(invalid(error));
    for (const value of [hash, pairing().user_id, pairing().chat_id]) {
      assert.equal(error.message.includes(value), false, 'private replay data is not a diagnostic');
    }
    return true;
  });
  assert.deepEqual(await readFile(h.path), bytes, 'semantic refusal preserves framed bytes');
  assert.equal(journal.sequence, sequence);
  assert.equal(broker.pairing(), null);
  assert.deepEqual(broker.snapshot(), { prepared: [], requests: [] });
  await assert.rejects(broker.reserveHandle({ ownerId: 'a' }), { exitCode: 4 });
  assert.deepEqual(await readFile(h.path), bytes, 'failed first recovery cannot admit writes');
}

test('A0-FIXTURE: ordinary journal writer closes before reopen; exact synthetic vocabulary',
  { timeout: 10000 }, () => fixture(async h => {
    await h.seed(valid());
    const journal = await Journal.open(h.path);
    try {
      const { transactions } = await journal.recover();
      assert.deepEqual(transactions.map(t => t.mutations), valid());
      assert.equal(journal.sequence, 2);
      assert.equal((await readFile(h.path, 'utf8')).includes('cap_'), false);
    } finally { await journal.close(); }
  }));

test('A0-REOPEN: copied private pairing survives expiry/owner changes; reservation authority unchanged',
  { timeout: 10000 }, () => fixture(async h => {
    let { broker } = await h.open();
    assert.equal(broker.pairing(), null);
    await broker.recover();
    const reservation = await broker.reserveHandle({ ownerId: 'a' });
    const auth = { ownerId: 'a', capability: reservation.request_capability,
      requestHandle: reservation.request_handle, requestId: reservation.request_id };
    const expected = broker.authorize(auth), snapshot = broker.snapshot();
    await h.seed(valid());
    let calls = 0;
    ({ broker } = await h.open({ clock: () => {
      assert.equal(++calls, 1, 'replay must not consult recovery time');
      return Date.parse('2040-01-01T00:00:00Z');
    } }));
    const bytes = await readFile(h.path);
    assert.deepEqual(await broker.recover(), { records: 3 });
    assert.deepEqual(broker.pairing(), pairing());
    const copy = broker.pairing(); copy.user_id = '1'; copy.extra = 'changed';
    assert.deepEqual(broker.pairing(), pairing());
    assert.deepEqual(broker.authorize(auth), expected);
    for (const change of [{ ownerId: 'b' }, { capability: 'cap_' + '0'.repeat(64) },
      { requestId: 'req_' + '0'.repeat(32) }, { requestHandle: 'hdl_' + '0'.repeat(32) }]) {
      assert.equal(broker.authorize({ ...auth, ...change }), null);
    }
    assert.deepEqual(broker.snapshot(), snapshot);
    assert.deepEqual(broker.status(), { schema_version: 1, broker: { pid: process.pid,
      port: 43189, started_at: '2040-01-01T00:00:00.000Z' }, requests: [] });
    const surfaces = JSON.stringify([broker.snapshot(), broker.status(), h.logs]);
    for (const privateValue of [hash, pairing().user_id, pairing().chat_id, reservation.request_capability]) {
      assert.equal(surfaces.includes(privateValue), false, 'private data stays off public/log views');
    }
    ({ broker } = await h.open({ owners: [] }));
    await broker.recover();
    assert.deepEqual(broker.pairing(), pairing(), 'pairing is independent of transport owners');
    assert.equal(broker.authorize(auth), null);
    assert.deepEqual(broker.snapshot(), snapshot);
    assert.deepEqual(await readFile(h.path), bytes);
  }));

test('A0-ORDER: all same-transaction permutations and both historical consume/set orders',
  { timeout: 10000 }, async t => {
    const permutations = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
    for (const order of permutations) await t.test(order.join(''), () => fixture(async h => {
      const mutations = [challenge(), consume(), set()];
      await h.seed([order.map(i => mutations[i])]);
      const { broker } = await h.open(); await broker.recover();
      assert.deepEqual(broker.pairing(), pairing());
    }));
    for (const reversed of [false, true]) await t.test(`historical-${reversed}`, () => fixture(async h => {
      await h.seed([[challenge()], reversed ? [set(), consume()] : [consume(), set()]]);
      const { broker } = await h.open(); await broker.recover();
      assert.deepEqual(broker.pairing(), pairing());
    }));
  });

test('A0-INSTANTS: creation inclusive, expiry exclusive and fractional equality without rounding',
  { timeout: 10000 }, async t => {
    const cases = [
      [created, created, created, expires],
      ['2026-11-01T00:04:59.999999999Z', '2026-11-01T00:04:59.999999999+00:00', created, expires],
      ['2026-11-01T00:00:00.000000001Z', '2026-11-01T00:00:00.0000000010Z',
        '2026-11-01T00:00:00.000000001+00:00', '2026-11-01T00:05:00.000000001Z'],
      ['2026-11-01T00:05:00.000000001Z', '2026-11-01T00:05:00.000000001Z',
        '2026-11-01T00:00:00.000000002Z', '2026-11-01T00:05:00.000000002Z'],
      ['2024-02-29T23:59:59+00:00', '2024-02-29T23:59:59.000Z',
        '2024-02-29T23:59:59Z', '2024-03-01T00:04:59Z'],
    ];
    for (const [consumed_at, paired_at, created_at, expires_at] of cases) {
      await t.test(consumed_at, () => fixture(async h => {
        await h.seed([[challenge({ created_at, expires_at })],
          [consume({ consumed_at }), set({ pairing: pairing({ paired_at }) })]]);
        const { broker } = await h.open(); await broker.recover();
        assert.deepEqual(broker.pairing(), pairing({ paired_at }));
      }));
    }
  });

test('A0-BURN: standalone consume commits no pairing and cannot authorize later set/reuse',
  { timeout: 10000 }, () => fixture(async h => {
    await h.seed([[challenge()], [consume()]]);
    const { broker } = await h.open(); await broker.recover();
    assert.equal(broker.pairing(), null);
    // A different unused challenge can still establish pairing after an unrelated burn.
    await h.seed([[challenge({ hash: other })], [set(), consume({ hash: other })]]);
    const reopened = await h.open(); await reopened.broker.recover();
    assert.deepEqual(reopened.broker.pairing(), pairing());
  }));

test('A0-INVALID: exact schemas, encodings and transition matrix', { timeout: 20000 }, async t => {
  const cases = [];
  const add = (name, history) => cases.push([name, history]);
  for (const [name, mutation] of [['challenge', challenge()], ['consume', consume()], ['set', set()]]) {
    for (const key of Object.keys(mutation)) {
      const missing = { ...mutation }; delete missing[key];
      add(`${name}-missing-${key}`, [[name === 'challenge' ? missing : challenge()],
        [name === 'consume' ? missing : consume(), name === 'set' ? missing : set()]]);
    }
    const extra = { ...mutation, secret: 'forbidden' };
    add(`${name}-extra`, [[name === 'challenge' ? extra : challenge()],
      [name === 'consume' ? extra : consume(), name === 'set' ? extra : set()]]);
  }
  for (const key of ['user_id', 'chat_id', 'paired_at']) {
    const missing = pairing(); delete missing[key];
    add(`pairing-missing-${key}`, [[challenge()], [consume(), set({ pairing: missing })]]);
  }
  add('nested-extra', [[challenge()], [consume(), set({ pairing: pairing({ extra: true }) })]]);
  for (const value of [null, [], 'pairing']) add(`nested-type-${JSON.stringify(value)}`,
    [[challenge()], [consume(), set({ pairing: value })]]);
  for (const field of ['user_id', 'chat_id']) for (const value of [null, 7, '', '0', '000', '-7',
    '+7', ' 7', '7 ', '7.0', '7e1', '７', '٧', '7\n']) {
    add(`${field}-${JSON.stringify(value)}`, [[challenge()], [consume(), set({ pairing: pairing({ [field]: value }) })]]);
  }
  for (const value of [null, 1, '', other.toUpperCase(), 'a'.repeat(63), 'g'.repeat(64)]) {
    add(`declaration-hash-${value}`, [[challenge({ hash: value })]]);
    add(`consume-hash-${value}`, [[challenge()], [consume({ hash: value }), set()]]);
  }
  const badTimes = [null, 1, '', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-11-01T24:00:00Z', '2026-11-01T00:60:00Z', '2026-11-01',
    '2026-11-01T00:00:00', '2026-11-01T00:00:00-00:00', '2026-11-01T00:00:00+01:00'];
  for (const value of badTimes) for (const field of ['created_at', 'expires_at', 'consumed_at', 'paired_at']) {
    add(`${field}-${JSON.stringify(value)}`, [[challenge(['created_at', 'expires_at'].includes(field)
      ? { [field]: value } : {})], [consume(field === 'consumed_at' ? { [field]: value } : {}),
      set({ pairing: pairing(field === 'paired_at' ? { [field]: value } : {}) })]]);
  }
  for (const consumed_at of ['2026-10-31T23:59:59.999999999Z', expires,
    '2026-11-01T00:05:00.000000001Z']) add(`deadline-${consumed_at}`,
      [[challenge()], [consume({ consumed_at }), set({ pairing: pairing({ paired_at: consumed_at }) })]]);
  for (const expires_at of ['2026-11-01T00:04:59.999999999Z', '2026-11-01T00:05:00.000000001Z']) {
    add(`duration-${expires_at}`, [[challenge({ expires_at })], [consume(), set()]]);
  }
  add('submillisecond-inequality', [[challenge()], [consume({ consumed_at: '2026-11-01T00:01:00.000000001Z' }), set()]]);
  add('submillisecond-before-creation', [[challenge({ created_at: '2026-11-01T00:00:00.000000002Z',
    expires_at: '2026-11-01T00:05:00.000000002Z' })],
    [consume({ consumed_at: '2026-11-01T00:00:00.000000001Z' }),
      set({ pairing: pairing({ paired_at: '2026-11-01T00:00:00.000000001Z' }) })]]);
  add('set-alone', [[set()]]);
  add('unknown-consume', [[consume(), set()]]);
  add('duplicate-declaration', [[challenge(), challenge()]]);
  add('historical-duplicate-declaration', [[challenge()], [challenge()]]);
  add('duplicate-consume', [[challenge()], [consume(), consume(), set()]]);
  add('two-distinct-consumes', [[challenge(), challenge({ hash: other })], [consume(), consume({ hash: other }), set()]]);
  add('two-sets', [[challenge()], [consume(), set(), set()]]);
  add('second-pairing', [...valid(), [challenge({ hash: other })], [consume({ hash: other }), set()]]);
  add('burn-then-set', [[challenge()], [consume()], [set()]]);
  add('burn-then-reuse', [[challenge()], [consume()], [consume(), set()]]);
  for (const mutation of [null, [], {}, { op: 'unknown' }, { op: 'pairing.reset' }]) {
    add(`unknown-${JSON.stringify(mutation)}`, [...valid(), [mutation]]);
  }
  for (const [name, history] of cases) await t.test(name, () => fixture(h => rejected(h, history)));
});

test('A0-ISOLATION: failed whole-history replay retains installed pairing AND reservations',
  { timeout: 10000 }, async t => {
    for (const tail of [[{ op: 'pairing.reset' }], [challenge({ hash: 'bad' })],
      [consume(), set()]]) await t.test(JSON.stringify(tail), () => fixture(async h => {
        await h.seed(valid());
        const { broker, journal } = await h.open(); await broker.recover();
        const r = await broker.reserveHandle({ ownerId: 'a' });
        const auth = { ownerId: 'a', capability: r.request_capability, requestId: r.request_id };
        const before = broker.snapshot(), authorized = broker.authorize(auth);
        // Ordinary append, no framing fabrication; broker makes no concurrent writes.
        const original = (await journal.recover()).transactions.at(-1).mutations[0];
        await journal.append([{ ...original, request_handle: 'hdl_' + 'e'.repeat(32),
          request_id: 'req_' + 'e'.repeat(32), capability_hash: 'e'.repeat(64) }]);
        await journal.append(tail);
        const bytes = await readFile(h.path), sequence = journal.sequence;
        await assert.rejects(broker.recover(), invalid);
        assert.deepEqual(broker.pairing(), pairing());
        assert.deepEqual(broker.snapshot(), before);
        assert.deepEqual(broker.authorize(auth), authorized);
        assert.deepEqual(await readFile(h.path), bytes);
        assert.equal(journal.sequence, sequence);
      }));
  });
