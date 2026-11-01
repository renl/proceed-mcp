// TEST ONLY: implementation-selected ordinary seam; design 2–4, not public workflow proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Journal } from '../src/journal/journal.js';
import * as framing from '../src/journal/framing.js';
import * as values from '../src/util/values.js';

const load = () => import('../src/broker/portable.js');
const owners = [{ owner_id: 'a', label: 'Shared 🛰' }, { owner_id: 'b', label: 'Shared 🛰' }];
const now = Date.parse('2026-11-01T00:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const redacted = r => ({ owner_id: r.owner_id, request_handle: r.request_handle,
  request_id: r.request_id, session_label: r.session_label, prepared_at: r.prepared_at });
async function fixture(work) {
  const root = resolve('.scratch/portable-authority-unit');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  const path = join(directory, 'journal.log');
  let journal, broker;
  try {
    await work({ path, async open(extra = {}) {
      journal = await Journal.open(path);
      const m = await load();
      broker = m.createPortableBroker({ journal, owners, port: 43189, clock: () => now, ...extra });
      return { journal, broker };
    }, async close() { await broker?.close(); await journal?.close(); } });
  } finally {
    try { await broker?.close(); } finally {
      try { await journal?.close(); } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

test('PORT-AUTH-VALUES: exact case-sensitive identifiers and fresh independent randomness', () => {
  for (const [name, prefix, size] of [['REQUEST_HANDLE_PATTERN', 'hdl_', 32],
    ['REQUEST_CAPABILITY_PATTERN', 'cap_', 64], ['DECISION_ID_PATTERN', 'dec_', 32]]) {
    assert.ok(values[name] instanceof RegExp, name);
    assert.equal(values[name].source, `^${prefix}[a-f0-9]{${size}}$`);
    assert.equal(values[name].flags, '');
  }
  for (const [fn, pattern] of [['randomRequestHandle', 'REQUEST_HANDLE_PATTERN'],
    ['randomRequestCapability', 'REQUEST_CAPABILITY_PATTERN']]) {
    const results = Array.from({ length: 32 }, () => values[fn]());
    assert.equal(new Set(results).size, results.length);
    for (const value of results) assert.match(value, values[pattern]);
  }
});

test('PORT-AUTH-DURABLE: exact reservation, hash-only persistence, restart and owner binding',
  { timeout: 10000 }, () => fixture(async h => {
    const logs = [];
    const { broker, journal } = await h.open({ logger: (...args) => logs.push(args) });
    assert.equal((await load()).PORTABLE_REPRESENTATION_SCHEMA_VERSION, 1);
    assert.deepEqual(await broker.recover(), { records: 0 });
    const a = await broker.reserveHandle({ ownerId: 'a', sessionLabel: ' \n😀 ' });
    assert.deepEqual(Object.keys(a).sort(), ['request_capability', 'request_handle', 'request_id', 'schema_version']);
    assert.equal(a.schema_version, 1);
    assert.match(a.request_handle, /^hdl_[a-f0-9]{32}$/);
    assert.match(a.request_id, /^req_[a-f0-9]{32}$/);
    assert.match(a.request_capability, /^cap_[a-f0-9]{64}$/);
    const b = await broker.reserveHandle({ ownerId: 'a' });
    for (const field of ['request_handle', 'request_id', 'request_capability']) assert.notEqual(a[field], b[field]);
    const tx = (await journal.recover()).transactions;
    assert.equal(tx.length, 2);
    const mutations = tx.flatMap(t => t.mutations);
    const expected = { owner_id: 'a', request_handle: a.request_handle, request_id: a.request_id,
      session_label: ' \n😀 ', prepared_at: new Date(now).toISOString() };
    assert.deepEqual(mutations[0], { op: 'handle.reserve', ...expected, capability_hash: hash(a.request_capability) });
    assert.equal(mutations[1].session_label, owners[0].label);
    assert.equal((await readFile(h.path, 'utf8')).includes(a.request_capability), false);
    const auth = { ownerId: 'a', capability: a.request_capability, requestHandle: a.request_handle, requestId: a.request_id };
    assert.deepEqual(await broker.authorize(auth), expected);
    assert.deepEqual(await broker.authorize({ ...auth, requestId: undefined }), expected);
    assert.deepEqual(await broker.authorize({ ...auth, requestHandle: undefined }), expected);
    for (const change of [{ capability: undefined }, { capability: `${a.request_capability.slice(0, -1)}z` },
      { capability: b.request_capability }, { ownerId: 'b' }, { ownerId: 'unknown' },
      { requestHandle: b.request_handle }, { requestId: b.request_id }]) {
      assert.equal(await broker.authorize({ ...auth, ...change }), null);
    }
    assert.deepEqual(await broker.authorize({ ...auth }), expected, 'same-owner transfer allowed');
    assert.deepEqual(await broker.snapshot(), { prepared: mutations.map(redacted), requests: [] });
    assert.deepEqual(await broker.status(), { schema_version: 1,
      broker: { pid: process.pid, port: 43189, started_at: new Date(now).toISOString() }, requests: [] });
    const publicText = JSON.stringify([await broker.snapshot(), await broker.status(), logs]);
    for (const secret of [a.request_capability, b.request_capability, hash(a.request_capability), hash(b.request_capability)]) {
      assert.equal(publicText.includes(secret), false, 'no key/verifier on public surfaces');
    }
    await h.close();
    const reopened = await h.open();
    assert.deepEqual(await reopened.broker.recover(), { records: 2 });
    assert.deepEqual(await reopened.broker.authorize(auth), expected);
  }));

for (const [scenario, currentOwners] of [['empty', []], ['other-only', [owners[1]]]]) {
  test(`AUTH-OWNER-DRIFT-001: ${scenario} configuration retains history, denies old authority`,
    { timeout: 10000 }, () => fixture(async h => {
      const { broker } = await h.open();
      await broker.recover();
      const reservation = await broker.reserveHandle({ ownerId: 'a', sessionLabel: 'Original 🛰' });
      const expected = { owner_id: 'a', request_handle: reservation.request_handle,
        request_id: reservation.request_id, session_label: 'Original 🛰',
        prepared_at: new Date(now).toISOString() };
      const auth = { ownerId: 'a', capability: reservation.request_capability,
        requestHandle: reservation.request_handle, requestId: reservation.request_id };
      assert.deepEqual(await broker.authorize(auth), expected, 'configured-owner positive control');
      assert.deepEqual(await broker.authorize({ ...auth }), expected, 'same-principal transfer remains valid');
      await h.close();
      const bytes = await readFile(h.path);
      const configured = await h.open();
      assert.deepEqual(await configured.broker.recover(), { records: 1 });
      assert.deepEqual(await configured.broker.authorize({ ...auth }), expected,
        'configured owner and transferred key remain valid after actual journal reopen');
      await h.close();
      const reopened = await h.open({ owners: currentOwners });
      assert.deepEqual(await reopened.broker.recover(), { records: 1 });
      const snapshot = { prepared: [expected], requests: [] };
      assert.deepEqual(await reopened.broker.snapshot(), snapshot, 'exact redacted history retained');
      assert.deepEqual(await readFile(h.path), bytes, 'replay preserves journal bytes');
      const sequence = reopened.journal.sequence;
      const result = await reopened.broker.authorize({ ...auth });
      assert.deepEqual(await reopened.broker.snapshot(), snapshot, 'authorization does not mutate history');
      assert.equal(reopened.journal.sequence, sequence, 'authorization does not commit');
      assert.deepEqual(await readFile(h.path), bytes, 'authorization preserves journal bytes');
      assert.equal(result, null, 'historical owner absent from CURRENT configuration must not authorize');
    }));
}

test('PORT-AUTH-GUARDS: recovery prerequisite, scalar labels, known owner and closed mutation',
  { timeout: 10000 }, () => fixture(async h => {
    const { broker, journal } = await h.open();
    await assert.rejects(async () => broker.reserveHandle({ ownerId: 'a' }));
    await broker.recover();
    for (const args of [{ ownerId: 'unknown' }, ...['', '😀'.repeat(129), '\ud800', null, 5]
      .map(sessionLabel => ({ ownerId: 'a', sessionLabel }))]) {
      await assert.rejects(async () => broker.reserveHandle(args));
    }
    assert.equal(journal.sequence, 0, 'refusal does not commit');
    await broker.reserveHandle({ ownerId: 'a', sessionLabel: '😀'.repeat(128) });
    await broker.close(); await broker.close();
    await assert.rejects(async () => broker.reserveHandle({ ownerId: 'a' }));
    await journal.append([{ op: 'observer.only' }]); // caller still owns open journal
    assert.equal(journal.sequence, 2);
  }));

test('PORT-AUTH-FLUSH: append completion precedes visibility/result; close drains serialized queue',
  { timeout: 10000 }, () => fixture(async h => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const { journal, broker } = await h.open();
    await broker.recover();
    const append = journal.append.bind(journal);
    journal.append = async (...args) => { entered(); await gate; return append(...args); };
    let settled = false, closed = false;
    const first = broker.reserveHandle({ ownerId: 'a' });
    const second = broker.reserveHandle({ ownerId: 'b' });
    first.then(() => { settled = true; }, () => {});
    await started;
    try {
      assert.equal(settled, false);
      assert.deepEqual(await broker.snapshot(), { prepared: [], requests: [] });
      const closing = broker.close().then(() => { closed = true; });
      await Promise.resolve(); assert.equal(closed, false);
      release();
      const results = await Promise.all([first, second]); await closing;
      assert.equal(new Set(results.map(r => r.request_id)).size, 2);
      assert.deepEqual((await journal.recover()).transactions.map(r => r.sequence), [1, 2]);
    } finally { release(); await Promise.allSettled([first, second]); }
  }));

test('PORT-AUTH-REPLAY: unknown operations and duplicate immutable identifiers fail closed',
  { timeout: 10000 }, async () => {
    const base = { op: 'handle.reserve', owner_id: 'a', request_handle: `hdl_${'a'.repeat(32)}`,
      request_id: `req_${'b'.repeat(32)}`, capability_hash: hash(`cap_${'c'.repeat(64)}`),
      session_label: 'display', prepared_at: new Date(now).toISOString() };
    for (const mutations of [[{ op: 'unknown.op' }], [base, { ...base }],
      [base, { ...base, request_handle: `hdl_${'d'.repeat(32)}` }]]) {
      await fixture(async h => {
        const journal = await Journal.open(h.path);
        try { for (const m of mutations) await journal.append([m]); } finally { await journal.close(); }
        const before = await readFile(h.path);
        const opened = await h.open();
        await assert.rejects(async () => opened.broker.recover(), { code: 'JOURNAL_STATE_INVALID', exitCode: 4 });
        assert.deepEqual(await readFile(h.path), before);
      });
    }
  });

test('PORT-JOURNAL2: versions, historical refusal, checksums, sequence and incomplete-tail rules',
  { timeout: 10000 }, async () => {
    assert.equal(framing.FILE_FORMAT_VERSION, 2);
    assert.equal(framing.RECORD_SCHEMA_VERSION, 2);
    const header = framing.createFileHeader();
    const frame = framing.encodeFrame({ sequence: 1, committedAt: new Date(now).toISOString(), mutations: [{ op: 'test.only' }] });
    const payload = JSON.parse(frame.subarray(16, 16 + frame.readUInt32BE(4)));
    assert.equal(payload.schema_version, 2);
    const old = Buffer.from(header); old.writeUInt32BE(1, 8);
    const schema1 = Buffer.from(frame);
    const bodyEnd = 16 + schema1.readUInt32BE(4);
    Buffer.from(JSON.stringify({ ...payload, schema_version: 1 })).copy(schema1, 16);
    createHash('sha256').update(schema1.subarray(0, bodyEnd)).digest().copy(schema1, bodyEnd);
    const corrupt = Buffer.from(frame); corrupt[20] ^= 1;
    const gap = framing.encodeFrame({ sequence: 2, committedAt: payload.committed_at, mutations: payload.mutations });
    for (const [bytes, code] of [[old, 'JOURNAL_VERSION_UNSUPPORTED'],
      [Buffer.concat([header, schema1]), 'JOURNAL_RECORD_VERSION_UNSUPPORTED'],
      [Buffer.concat([header, corrupt]), 'JOURNAL_CHECKSUM_MISMATCH'],
      [Buffer.concat([header, gap]), 'JOURNAL_SEQUENCE_GAP']]) {
      await fixture(async h => {
        await writeFile(h.path, bytes);
        await assert.rejects(() => Journal.open(h.path), { code, exitCode: 4 });
        assert.deepEqual(await readFile(h.path), bytes);
      });
    }
    await fixture(async h => {
      const valid = Buffer.concat([header, frame]);
      await writeFile(h.path, Buffer.concat([valid, frame.subarray(0, 19)]));
      const journal = await Journal.open(h.path);
      try {
        assert.deepEqual(await readFile(h.path), valid);
        assert.equal((await journal.recover()).transactions.length, 1);
        await journal.append([{ op: 'test.next' }]);
        assert.deepEqual((await journal.recover()).transactions.map(r => r.sequence), [1, 2]);
      } finally { await journal.close(); }
    });
  });
