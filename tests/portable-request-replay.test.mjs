// TEST ONLY: design 4/7 Alpha-B. Seeded replay is not an actual request writer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { sha256Hex } from '../src/util/values.js';
import { measurePortablePresentation } from '../src/telegram/portable-render.js';

const id = (prefix, n) => prefix + n.toString(16).padStart(32, '0');
const capability = 'cap_' + 'a'.repeat(64), hash = 'b'.repeat(64);
const prepared = '2026-11-01T00:00:00Z', paired = '2026-11-01T00:01:00Z';
const created = '2026-11-01T00:02:00Z', deadline = '2026-11-01T00:03:00Z';
const identity = { user_id: '00090071992547409931234567890', chat_id: '00071', paired_at: paired };
const owner = 'o'.repeat(64), label = 'L'.repeat(128);
const reserve = (n = 1, extra = {}) => ({ op: 'handle.reserve', owner_id: owner,
  request_handle: id('hdl_', n), request_id: id('req_', n), session_label: label,
  capability_hash: n === 1 ? sha256Hex(capability) : sha256Hex(`fixture-${n}`), prepared_at: prepared, ...extra });
const challenge = (extra = {}) => ({ op: 'pairing.challenge', hash, created_at: prepared,
  expires_at: '2026-11-01T00:05:00Z', ...extra });
const consume = (extra = {}) => ({ op: 'pairing.challenge.consume', hash, consumed_at: paired, ...extra });
const set = () => ({ op: 'pairing.set', pairing: { ...identity } });
const base = () => [[reserve(), challenge()], [consume(), set()]];
const create = (extra = {}) => ({ op: 'request.create', request_handle: id('hdl_', 1),
  client_request_id: 'same_KEY-1', action: 'Approve this? 😀', context: '', expires_in_seconds: 60,
  created_at: created, expires_at: deadline, pairing_snapshot: { ...identity }, ...extra });
const expire = (extra = {}) => ({ op: 'request.expire', request_id: id('req_', 1),
  resolved_at: deadline, decision_id: id('dec_', 1), delivery_state: 'unavailable', ...extra });
const history = (c = create(), tail = []) => [...base(), [c], ...tail];
const event = () => ({ status: 'unverified', revision: null, reason: 'No verified Events contract or host support' });
const view = (c = create(), e) => ({ schema_version: 1, request_handle: c.request_handle,
  request_id: id('req_', 1), client_request_id: c.client_request_id, owner_id: owner,
  session_label: label, action: c.action, context: c.context, created_at: c.created_at, expires_at: c.expires_at,
  resolution: e ? 'expired' : 'pending', resolved_at: e?.resolved_at ?? null, response_text: null,
  decision_id: e?.decision_id ?? null, telegram_state: 'pending', delivery_state: e?.delivery_state ?? 'not_applicable',
  delivery_error: null, event_capability: event() });
const auth = { ownerId: owner, capability, requestId: id('req_', 1) };
const invalid = e => e?.code === 'JOURNAL_STATE_INVALID' && e.exitCode === 4 && !(e instanceof TypeError);

async function fixture(records, work, now = '2040-01-01T00:00:00Z') {
  const root = resolve('.scratch/alpha-b-replay');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-')), path = join(directory, 'journal.log');
  let journal, broker, calls = 0;
  try {
    // No server, lock, concurrent writer, framing fabrication or ordinary operator state.
    const writer = await Journal.open(path);
    try { for (const mutations of records) await writer.append(mutations); }
    finally { await writer.close(); }
    journal = await Journal.open(path);
    broker = createPortableBroker({ journal, owners: [{ owner_id: owner, label: 'changed operator label' }],
      port: 43189, clock: () => { assert.equal(++calls, 1, 'only constructor samples time'); return Date.parse(now); } });
    await work({ broker, journal, path });
    assert.equal(calls, 1);
  } finally {
    try { await broker?.close(); await journal?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); await assert.rejects(access(directory), { code: 'ENOENT' }); }
  }
}
async function accepted(records, expected) {
  await fixture(records, async ({ broker, path }) => {
    const bytes = await readFile(path);
    await broker.recover();
    assert.deepEqual(broker.snapshot().requests, expected);
    assert.deepEqual(await readFile(path), bytes, 'replay never writes expiry');
  });
}
async function rejected(records) {
  // A valid companion must reach the new decoder first: unknown-op is NOT negative proof.
  await accepted(history(create(), [[expire()]]), [view(create(), expire())]);
  await fixture(records, async ({ broker, journal, path }) => {
    const bytes = await readFile(path), sequence = journal.sequence;
    await assert.rejects(broker.recover(), invalid);
    assert.deepEqual(broker.snapshot(), { prepared: [], requests: [] });
    assert.equal(broker.pairing(), null);
    assert.equal(broker.authorize(auth), null);
    await assert.rejects(broker.reserveHandle({ ownerId: owner }), { exitCode: 4 });
    assert.deepEqual(await readFile(path), bytes); assert.equal(journal.sequence, sequence);
  });
}

test('AB-B1: create-only recovery checkpoint; not full Alpha-B acceptance', { timeout: 30000 }, async () => {
  for (const now of ['2026-11-01T00:02:30Z', '2040-01-01T00:00:00Z'])
    await fixture(history(), async ({ broker, journal, path }) => {
      await broker.recover(); const before = broker.snapshot(), pairing = broker.pairing(), authority = broker.authorize(auth);
      assert.deepEqual(before.requests, [view()]); assert.deepEqual(pairing, identity); assert.ok(authority);
      const copy = broker.snapshot(), original = await readFile(path), seq = journal.sequence;
      copy.requests[0].event_capability.reason = 'changed'; copy.prepared[0].session_label = 'changed'; assert.deepEqual(broker.snapshot(), before);
      assert.deepEqual(broker.snapshot(), before); assert.deepEqual(await readFile(path), original); assert.equal(journal.sequence, seq);
      await journal.append([reserve(2)]); await journal.append([create()]);
      const bytes = await readFile(path), sequence = journal.sequence;
      await assert.rejects(broker.recover(), invalid); assert.deepEqual(broker.snapshot(), before);
      assert.deepEqual(broker.pairing(), pairing); assert.deepEqual(broker.authorize(auth), authority);
      assert.deepEqual(await readFile(path), bytes); assert.equal(journal.sequence, sequence);
    }, now);
  const c = create({ action: '😀'.repeat(1000), context: '😀'.repeat(830) + 'x', expires_at: '2026-11-01T00:03:00.000Z' });
  assert.equal(measurePortablePresentation(view(c)).worst.length, 4096); await accepted(history(c), [view(c)]);
  for (const records of [history(create({ request_handle: [id('hdl_', 1)] })), history(create({ extra: true })),
    history(create({ pairing_snapshot: { ...identity, chat_id: '71' } })), history(create({ expires_at: '2026-11-01T00:03:00.000000001Z' })),
    history(create({ ...c, context: '😀'.repeat(831) })), [[challenge()], [consume(), set()], [reserve(), create()]],
    [[reserve(), challenge()], [consume(), set(), create()]], history(create(), [[create()]])]) {
    await accepted(history(), [view()]); // Create-only companion: rejected() requires expiry and cannot discriminate B1.
    await fixture(records, async ({ broker, journal, path }) => {
      const bytes = await readFile(path), sequence = journal.sequence; await assert.rejects(broker.recover(), invalid);
      assert.deepEqual(broker.snapshot(), { prepared: [], requests: [] }); assert.equal(broker.pairing(), null); assert.equal(broker.authorize(auth), null);
      await assert.rejects(broker.reserveHandle({ ownerId: owner }), { exitCode: 4 });
      assert.deepEqual(await readFile(path), bytes); assert.equal(journal.sequence, sequence);
    });
  }
});
test('AB-CALIBRATE: normal journal2 vocabulary roundtrip; no product acceptance', { timeout: 10000 },
  () => fixture(history(), async ({ journal }) => {
    assert.deepEqual((await journal.recover()).transactions.map(t => t.mutations), history());
    assert.equal(journal.sequence, 3);
  }));
test('AB-VIEWS: exact inherited representation, nested independence and privacy',
  { timeout: 15000 }, async t => {
    for (const e of [undefined, expire(), expire({ delivery_state: 'pending' })]) await t.test(e?.delivery_state ?? 'due-pending',
      () => fixture(history(create(), e ? [[e]] : []), async ({ broker, journal, path }) => {
        await broker.recover(); const expected = view(create(), e), before = broker.snapshot();
        assert.deepEqual(before.requests, [expected]);
        const bytes = await readFile(path), sequence = journal.sequence, authority = broker.authorize(auth);
        assert.ok(authority); assert.deepEqual(broker.pairing(), identity);
        for (let i = 0; i < 2; i++) {
          const copy = broker.snapshot(); copy.requests[0].event_capability.reason = 'changed';
          copy.requests[0].action = 'changed'; copy.requests.push({}); copy.prepared[0].session_label = 'changed';
          assert.deepEqual(broker.snapshot(), before);
        }
        for (const secret of [capability, sha256Hex(capability), hash, identity.user_id, identity.chat_id,
          'pairing_snapshot', 'expires_in_seconds', 'capability_hash']) assert.equal(JSON.stringify(before).includes(secret), false);
        assert.deepEqual(broker.authorize(auth), authority);
        assert.deepEqual(await readFile(path), bytes); assert.equal(journal.sequence, sequence);
      }));
    await t.test('future-pending', () => fixture(history(), async ({ broker }) => {
      await broker.recover(); assert.deepEqual(broker.snapshot().requests, [view()]);
    }, '2026-11-01T00:02:30Z'));
    await accepted(history(create(), [[expire()], [reserve(2)], [create({ request_handle: id('hdl_', 2) })]]),
      [view(create(), expire()), { ...view(), request_handle: id('hdl_', 2), request_id: id('req_', 2) }]);
  });
test('AB-EMPTY: reservation-only and paired reservation observations unchanged', { timeout: 10000 }, async t => {
  for (const records of [[[reserve()]], base()]) await t.test(`${records.length}`, () => fixture(records, async ({ broker }) => {
    await broker.recover(); assert.deepEqual(broker.snapshot().requests, []);
    const expected = { schema_version: 1, broker: { pid: process.pid, port: 43189, started_at: '2040-01-01T00:00:00.000Z' }, requests: [] };
    assert.deepEqual(await broker.status(), expected); assert.deepEqual(await broker.status(), expected);
  }));
});
test('AB-CREATE-SCHEMA: exact fields, types before coercion, scalar and wellformed limits', { timeout: 60000 }, async t => {
  const cases = [];
  for (const key of Object.keys(create())) { const c = create(); delete c[key]; cases.push([`missing-${key}`, c]); }
  cases.push(['extra', create({ extra: true })]);
  const bad = { request_handle: [null, 1, [id('hdl_', 1)], { toString: null }, 'hdl_bad'],
    client_request_id: [null, 1, ['same_KEY-1'], '', 'x'.repeat(129), 'has space', 'é'],
    action: [null, 1, ['text'], '', 'x'.repeat(1001), '\ud800'],
    context: [null, 1, ['text'], 'x'.repeat(1001), '\udc00'],
    expires_in_seconds: [null, '60', [60], 59, 86401, 60.5], pairing_snapshot: [null, [], 'pair'] };
  for (const [key, values] of Object.entries(bad)) for (const v of values) cases.push([`${key}-${JSON.stringify(v)}`, create({ [key]: v })]);
  for (const key of Object.keys(identity)) {
    const p = { ...identity }; delete p[key]; cases.push([`snapshot-missing-${key}`, create({ pairing_snapshot: p })]);
    for (const v of [null, 1, [identity[key]], key === 'paired_at' ? paired.replace('Z', '+00:00') : '71'])
      cases.push([`snapshot-${key}-${JSON.stringify(v)}`, create({ pairing_snapshot: { ...identity, [key]: v } })]);
  }
  cases.push(['snapshot-extra', create({ pairing_snapshot: { ...identity, extra: 1 } })]);
  for (const [name, c] of cases) await t.test(name, () => rejected(history(c)));
});
test('AB-TIMES: strict UTC, duration and preparation/pairing lower bounds without rounding', { timeout: 60000 }, async t => {
  for (const key of ['created_at', 'expires_at']) for (const value of [null, 1, [created], '',
    '2026-02-30T00:02:00Z', '2026-11-01T24:00:00Z', '2026-11-01T00:02:00-00:00',
    '2026-11-01T00:02:00+01:00', '2026-11-01', '2026-11-01T00:02:00']) {
    await t.test(`${key}-${JSON.stringify(value)}`, () => rejected(history(create({ [key]: value }))));
  }
  for (const expires_at of ['2026-11-01T00:02:59.999999999Z', '2026-11-01T00:03:00.000000001Z'])
    await t.test(`duration-${expires_at}`, () => rejected(history(create({ expires_at }))));
  for (const [created_at, expires_at] of [
    ['2026-11-31T00:02:00Z', '2026-11-31T00:03:00Z'],
    ['2026-11-01T00:02:00-00:00', '2026-11-01T00:03:00-00:00'],
    ['2026-11-02T00:02:00+01:00', '2026-11-02T00:03:00+01:00'],
  ]) await t.test(`matched-invalid-${created_at}`, () => rejected(history(create({ created_at, expires_at }))));
  for (const [name, records] of [
    ['before-pairing', [...base(), [create({ created_at: prepared, expires_at: paired })]]],
    ['before-prepared', [[reserve(1, { prepared_at: '2026-11-01T00:02:00.000000001Z' }), challenge()], [consume(), set()], [create()]]],
  ]) await t.test(name, () => rejected(records));
  for (const seconds of [60, 86400]) {
    const c = create({ expires_in_seconds: seconds, created_at: paired,
      expires_at: seconds === 60 ? '2026-11-01T00:02:00+00:00' : '2026-11-02T00:01:00.000Z' });
    await t.test(`valid-${seconds}`, () => accepted(history(c), [view(c)]));
  }
});
test('AB-RENDER: full accepted renderer bound discriminates 4096/4097 below scalar ceilings', { timeout: 15000 }, async t => {
  for (const [size, context] of [[4096, '😀'.repeat(830) + 'x'], [4097, '😀'.repeat(831)]]) {
    const c = create({ action: '😀'.repeat(1000), context, expires_at: '2026-11-01T00:03:00.000Z' });
    assert.equal(measurePortablePresentation(view(c)).worst.length, size);
    await t.test(`${size}`, () => size === 4096 ? accepted(history(c), [view(c)]) : rejected(history(c)));
  }
  const c = create({ action: '😀'.repeat(1000), context: '😀'.repeat(830) + 'x',
    expires_at: '2026-11-01T00:03:00.' + '0'.repeat(100) + '+00:00' });
  await t.test('actual-timestamp-width', () => rejected(history(c)));
  const ordinary = create({ action: '<&"\\\n😀', context: 'e\u0301' });
  await t.test('plain-text-no-escaping-or-normalization', () => accepted(history(ordinary), [view(ordinary)]));
  const maximum = create({ action: '😀'.repeat(1000), context: 'x'.repeat(1000) });
  await t.test('scalar-maxima-admitted', () => accepted(history(maximum), [view(maximum)]));
});
test('AB-BINDINGS: committed predecessors, ordered request mutations, unrelated records allowed', { timeout: 30000 }, async t => {
  for (const reverse of [false, true]) {
    const pair = [reserve(), create()]; if (reverse) pair.reverse();
    await t.test(`same-reservation-${reverse}`, () => rejected([[challenge()], [consume(), set()], pair]));
    const p = [consume(), set(), create()]; if (reverse) p.reverse();
    await t.test(`same-pairing-${reverse}`, () => rejected([[reserve(), challenge()], p]));
  }
  for (const extra of [reserve(2), challenge({ hash: 'c'.repeat(64) })])
    await t.test(`unrelated-${extra.op}`, () => accepted([...base(), [create(), extra]], [view()]));
  await t.test('standalone-burn', () => accepted([...base(), [challenge({ hash: 'c'.repeat(64) })],
    [consume({ hash: 'c'.repeat(64) }), create()]], [view()]));
  for (const records of [history(create(), [[create()]]), [...base(), [expire(), create()]],
    [[reserve()], [create()]], history(create({ request_handle: id('hdl_', 9) }))])
    await t.test(JSON.stringify(records), () => rejected(records));
  await t.test('create-then-expire', () => accepted([...base(), [create(), expire()]], [view(create(), expire())]));
});
test('AB-EXPIRY: exact schema, pending target, deadline, unique decision and initial delivery', { timeout: 60000 }, async t => {
  const cases = [];
  for (const key of Object.keys(expire())) { const e = expire(); delete e[key]; cases.push([`missing-${key}`, e]); }
  cases.push(['extra', expire({ extra: true })]);
  for (const [key, values] of Object.entries({ request_id: [null, 1, [id('req_', 1)], id('req_', 9)],
    decision_id: [null, 1, [id('dec_', 1)], { toString: null }, 'dec_bad', 'dec_' + 'A'.repeat(32)],
    resolved_at: [null, 1, [deadline], '2026-02-30T00:03:00Z', '2026-11-01T00:03:00-00:00', '2026-11-01T00:02:59.999999999Z'],
    delivery_state: [null, 1, ['pending'], 'not_applicable', 'returned', 'confirmed', 'blocked', 'failed'] }))
    for (const v of values) cases.push([`${key}-${JSON.stringify(v)}`, expire({ [key]: v })]);
  for (const [name, e] of cases) await t.test(name, () => rejected(history(create(), [[e]])));
  for (const resolved_at of [deadline, '2026-11-01T00:03:00.000000001+00:00']) {
    const e = expire({ resolved_at }); await t.test(`valid-${resolved_at}`, () => accepted(history(create(), [[e]]), [view(create(), e)]));
  }
  const c = create({ created_at: '2026-11-01T00:02:00.000000002Z', expires_at: '2026-11-01T00:03:00.000000002Z' });
  const e = expire({ resolved_at: '2026-11-01T00:03:00.0000000020+00:00' });
  await t.test('fraction-equality', () => accepted(history(c, [[e]]), [view(c, e)]));
  await t.test('submillisecond-early', () => rejected(history(c, [[expire({ resolved_at: '2026-11-01T00:03:00.000000001Z' })]])));
  const c2 = create({ request_handle: id('hdl_', 2) }), e2 = expire({ request_id: id('req_', 2), decision_id: id('dec_', 2) });
  await t.test('distinct-decisions-control', () => accepted([...base(), [reserve(2)], [create(), c2], [expire(), e2]],
    [view(create(), expire()), { ...view(c2, e2), request_id: id('req_', 2) }]));
  for (const tail of [[[expire()]], [[expire({ decision_id: id('dec_', 2) })]],
    [[reserve(2)], [create({ request_handle: id('hdl_', 2) })], [expire({ request_id: id('req_', 2) })]]])
    await t.test(`duplicate-${JSON.stringify(tail)}`, () => rejected(history(create(), [[expire()], ...tail])));
});
test('AB-ATOMIC: whole-history failure preserves installed requests, nested state, pairing and authority',
  { timeout: 20000 }, async t => {
    for (const tail of [[{ op: 'unknown' }], [create()], [expire({ decision_id: id('dec_', 2) })]])
      await t.test(JSON.stringify(tail), () => fixture(history(create(), [[expire()]]), async ({ broker, journal, path }) => {
        await broker.recover(); const before = broker.snapshot(), p = broker.pairing(), authorized = broker.authorize(auth);
        await journal.append([reserve(2)]); await journal.append(tail);
        const bytes = await readFile(path), sequence = journal.sequence;
        await assert.rejects(broker.recover(), invalid);
        assert.deepEqual(broker.snapshot(), before); assert.deepEqual(broker.pairing(), p);
        assert.deepEqual(broker.authorize(auth), authorized); assert.equal(journal.sequence, sequence);
        assert.deepEqual(await readFile(path), bytes);
      }));
  });
