// TEST ONLY: design 4/7 beta. Seeded creation is setup; expiry must be production-written.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { sha256Hex, DECISION_ID_PATTERN } from '../src/util/values.js';

const id = (p, n) => p + n.toString(16).padStart(32, '0');
const cap = n => 'cap_' + n.toString(16).padStart(64, '0');
const auth = n => ({ ownerId: 'a', capability: cap(n), requestId: id('req_', n) });
const start = '2026-11-01T00:00:00Z', created = '2026-11-01T00:01:00Z';
const due = '2026-11-01T00:02:00.000Z', later = '2026-11-01T00:02:01.234Z';
const pairing = { user_id: '00071', chat_id: '00081', paired_at: start };
const closure = (n, d, at = due) => ({ op: 'request.expire', request_id: id('req_', n),
  decision_id: id('dec_', d), resolved_at: at, delivery_state: 'unavailable' });
function history(count, fraction = '') {
  return [[{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: start,
    expires_at: '2026-11-01T00:05:00Z' }],
  [{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: start },
    { op: 'pairing.set', pairing }],
  ...Array.from({ length: count }, (_, i) => [{ op: 'handle.reserve', owner_id: 'a',
    request_handle: id('hdl_', i + 1), request_id: id('req_', i + 1), session_label: 'display only',
    capability_hash: sha256Hex(cap(i + 1)), prepared_at: start }]),
  ...Array.from({ length: count }, (_, i) => [{ op: 'request.create', request_handle: id('hdl_', i + 1),
    client_request_id: 'same', action: 'Question?', context: '', expires_in_seconds: 60,
    created_at: created.replace('Z', fraction + 'Z'),
    expires_at: '2026-11-01T00:02:00' + fraction + 'Z', pairing_snapshot: pairing }])];
}
const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4 && !(e instanceof TypeError);
const collision = e => e?.code === 'JOURNAL_IDENTIFIER_COLLISION' && e.exitCode === 4;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('test gate timeout')), 2000);
  })]); } finally { clearTimeout(timer); }
}
async function fixture(records, work, options = {}) {
  const root = resolve('.scratch/beta-expiry'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-')), path = join(directory, 'journal.log');
  let journal, broker, handle, calls = 0, generated = 0, delegate;
  const h = { path, now: Date.parse(due), hook: async () => {}, sync: async () => {},
    get calls() { return calls; }, get generated() { return generated; },
    get journal() { return journal; }, get broker() { return broker; },
    async close() { await broker?.close(); await journal?.close(); },
    async reopen() {
      await h.close(); journal = await Journal.open(path);
      broker = createPortableBroker({ journal, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { calls++; return h.now; } });
      const before = calls; await broker.recover(); assert.equal(calls, before, 'replay has no clock');
      return broker.snapshot().requests;
    } };
  try {
    const seed = await Journal.open(path);
    try { for (const row of records) await seed.append(row); } finally { await seed.close(); }
    // Actual Journal write/flush code, actual OS file. Only the caller-owned handle delegates sync.
    const recovered = await Journal.open(path), sequence = recovered.sequence; await recovered.close();
    handle = await open(path, 'a');
    journal = new Journal(path, { write: (...args) => handle.write(...args),
      sync: async () => { await h.sync(); await handle.sync(); }, close: () => handle.close() }, sequence);
    delegate = { recover: () => journal.recover(), append: async mutations => {
      await h.hook(mutations); return journal.append(mutations);
    } };
    const generateDecisionId = () => { generated++; return options.generate ? options.generate(generated) : id('dec_', generated); };
    broker = createPortableBroker({ journal: delegate, owners: options.owners ?? [{ owner_id: 'a', label: 'A' }],
      port: 43189, clock: () => { calls++; return h.now; },
      ...(options.defaultGenerator ? {} : { generateDecisionId }) });
    const before = calls; await broker.recover(); assert.equal(calls, before);
    await work(h);
  } finally {
    try { await h.close(); await handle?.close().catch(() => {}); }
    finally { await rm(directory, { recursive: true, force: true });
      await assert.rejects(access(directory), { code: 'ENOENT' }); }
  }
}
const expired = views => views.filter(v => v.resolution === 'expired');
async function ledger(h) { return (await h.journal.recover()).transactions.flatMap(t => t.mutations).filter(m => m.op === 'request.expire'); }

test('BETA-CALIBRATE: ordinary journal, seeded creation only; replay/copies never sample time', { timeout: 10000 },
  () => fixture(history(2), async h => {
    const calls = h.calls, bytes = await readFile(h.path), snapshot = h.broker.snapshot();
    assert.equal(typeof snapshot.then, 'undefined'); assert.equal(snapshot.requests.length, 2);
    snapshot.requests[0].event_capability.reason = 'changed'; snapshot.requests.length = 0;
    assert.equal(h.broker.snapshot().requests.length, 2); assert.equal(h.calls, calls);
    assert.equal((await ledger(h)).length, 0); assert.deepEqual(await readFile(h.path), bytes);
  }));
test('BETA-GATE-CALIBRATE: actual reserve writer reaches independent append/sync barriers', { timeout: 10000 },
  () => fixture(history(0), async h => {
    const entered = deferred(), release = deferred(), syncing = deferred(), flush = deferred();
    const before = h.broker.snapshot(), bytes = await readFile(h.path), sequence = h.journal.sequence;
    let settled = false;
    h.hook = async () => { entered.resolve(); await release.promise; };
    h.sync = async () => { syncing.resolve(); await flush.promise; };
    const pending = h.broker.reserveHandle({ ownerId: 'a' }); pending.then(() => { settled = true; }, () => {});
    try {
      await bounded(entered.promise); assert.deepEqual(await readFile(h.path), bytes);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(settled, false);
      release.resolve(); await bounded(syncing.promise);
      assert.notDeepEqual(await readFile(h.path), bytes); assert.equal(h.journal.sequence, sequence);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(settled, false);
    } finally { release.resolve(); flush.resolve(); await Promise.allSettled([pending]); }
    const reservation = await pending; assert.equal(h.journal.sequence, sequence + 1);
    assert.equal(h.broker.snapshot().prepared[0].request_id, reservation.request_id);
  }));
test('BETA-FAULT-CALIBRATE: existing writer distinguishes append refusal from actual sync refusal',
  { timeout: 10000 }, async t => {
    for (const stage of ['append', 'sync']) await t.test(stage, () => fixture(history(0), async h => {
      const before = h.broker.snapshot(), bytes = await readFile(h.path), sequence = h.journal.sequence;
      let reachedSync = false;
      if (stage === 'append') await h.journal.close();
      h.sync = async () => { reachedSync = true; await h.journal.close(); };
      await assert.rejects(h.broker.reserveHandle({ ownerId: 'a' }), storage);
      assert.equal(reachedSync, stage === 'sync'); assert.equal(h.journal.sequence, sequence);
      assert.deepEqual(h.broker.snapshot(), before);
      if (stage === 'append') assert.deepEqual(await readFile(h.path), bytes);
      else assert.notDeepEqual(await readFile(h.path), bytes);
    }));
  });
test('BETA-READ: denied authority before clock or writes; authorized target only, copied/private exact closure',
  { timeout: 10000 }, () => fixture(history(2), async h => {
    const before = h.broker.snapshot(), calls = h.calls, bytes = await readFile(h.path), sequence = h.journal.sequence;
    for (const input of [undefined, {}, { ...auth(1), ownerId: 'b' }, { ...auth(1), capability: cap(2) },
      { ...auth(1), capability: [cap(1)] }, { ...auth(1), requestId: id('req_', 9) },
      { ...auth(1), requestId: undefined }, { ...auth(1), requestId: [id('req_', 1)] },
      { ...auth(1), capability: undefined }, { ...auth(1), capability: 'cap_bad' }]) {
      const read = h.broker.readRequest(input); assert.equal(typeof read?.then, 'function'); assert.equal(await read, null);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.calls, calls);
      assert.deepEqual(await readFile(h.path), bytes); assert.equal(h.journal.sequence, sequence);
    }
    const view = await h.broker.readRequest(auth(1));
    assert.deepEqual(view, { ...before.requests[0], resolution: 'expired', resolved_at: due,
      decision_id: id('dec_', 1), delivery_state: 'unavailable' });
    assert.deepEqual(await ledger(h), [closure(1, 1)]); assert.equal(h.journal.sequence, sequence + 1);
    assert.deepEqual(h.broker.snapshot().requests[1], before.requests[1], 'no global sweep');
    view.event_capability.reason = 'changed'; view.action = 'changed';
    const terminal = h.broker.snapshot().requests[0], sampled = h.calls;
    assert.deepEqual(await h.broker.readRequest(auth(1)), terminal); assert.equal(h.calls, sampled);
    for (const secret of [cap(1), sha256Hex(cap(1)), pairing.user_id, pairing.chat_id, 'pairing_snapshot', 'expires_in_seconds'])
      assert.equal(JSON.stringify(terminal).includes(secret), false);
    const saved = h.broker.snapshot().requests; assert.deepEqual(await h.reopen(), saved);
  }));
test('BETA-ABSENT: unused reservation and revoked principal return null without time/mutation', { timeout: 10000 }, async () => {
  const rows = history(1); rows.pop();
  for (const [records, owners] of [[rows, [{ owner_id: 'a', label: 'A' }]], [history(1), []]])
    await fixture(records, async h => {
      const calls = h.calls, bytes = await readFile(h.path);
      assert.equal(await h.broker.readRequest(auth(1)), null); assert.equal(h.calls, calls);
      assert.deepEqual(await readFile(h.path), bytes);
    }, { owners });
});
test('BETA-DEADLINE: before/equal/after and submillisecond deadline never rounded earlier', { timeout: 15000 }, async t => {
  for (const [fraction, now, isDue] of [['', Date.parse(due) - 1, false], ['', Date.parse(due), true],
    ['', Date.parse(due) + 1, true], ['.000000002', Date.parse(due), false], ['.000000002', Date.parse(due) + 1, true]])
    await t.test(`${fraction}/${now}`, () => fixture(history(1, fraction), async h => {
      h.now = now; const v = await h.broker.readRequest(auth(1));
      assert.equal(v.resolution, isDue ? 'expired' : 'pending');
      assert.deepEqual(await ledger(h), isDue ? [closure(1, 1, new Date(now).toISOString())] : []);
      assert.equal(v.resolved_at, isDue ? new Date(now).toISOString() : null);
      assert.deepEqual(await h.reopen(), [v]);
    }));
});
test('BETA-ORDER: append admission then actual sync gate; queued status samples after release, not admission',
  { timeout: 10000 }, () => fixture(history(2), async h => {
    const admission = deferred(), admit = deferred(), syncing = deferred(), flush = deferred();
    const before = h.broker.snapshot(), bytes = await readFile(h.path), sequence = h.journal.sequence;
    let appends = 0, settled = false, statusSettled = false;
    h.hook = async () => { if (++appends === 1) { admission.resolve(); await admit.promise; } };
    h.sync = async () => { if (appends === 1) { syncing.resolve(); await flush.promise; } };
    const read = Promise.resolve().then(() => h.broker.readRequest(auth(1)));
    read.then(() => { settled = true; }, () => {});
    let status;
    try {
      await bounded(admission.promise); assert.deepEqual(await readFile(h.path), bytes);
      assert.equal(h.journal.sequence, sequence); assert.deepEqual(h.broker.snapshot(), before); assert.equal(settled, false);
      status = Promise.resolve().then(() => h.broker.status()); status.then(() => { statusSettled = true; }, () => {});
      const calls = h.calls; await new Promise(r => setImmediate(r)); assert.equal(h.calls, calls);
      admit.resolve(); await bounded(syncing.promise);
      assert.notDeepEqual(await readFile(h.path), bytes, 'actual frame written before held OS sync');
      assert.equal(h.journal.sequence, sequence); assert.deepEqual(h.broker.snapshot(), before);
      assert.equal(settled, false); assert.equal(statusSettled, false); h.now = Date.parse(later);
    } finally { admit.resolve(); flush.resolve(); await Promise.allSettled([read, status]); }
    assert.equal((await read).resolved_at, due);
    const result = await status; assert.deepEqual(result.requests, h.broker.snapshot().requests);
    assert.equal(result.requests[1].resolved_at, later); assert.deepEqual(await ledger(h), [closure(1, 1), closure(2, 2, later)]);
    const saved = h.broker.snapshot().requests; assert.deepEqual(await h.reopen(), saved);
  }));
test('BETA-COHERENT: status captures its serialized view before a later queued target expiry', { timeout: 10000 },
  () => {
    const records = history(2); records.at(-1)[0].expires_in_seconds = 61;
    records.at(-1)[0].expires_at = '2026-11-01T00:02:01Z';
    return fixture(records, async h => {
      const before = h.broker.snapshot().requests; let appends = 0;
      h.hook = async () => { if (++appends === 1) h.now = Date.parse(later); };
      const status = Promise.resolve().then(() => h.broker.status());
      const read = Promise.resolve().then(() => h.broker.readRequest(auth(2)));
      const [observed, target] = await Promise.all([status, read]);
      assert.deepEqual(observed.requests, [{ ...before[0], resolution: 'expired', resolved_at: due,
        decision_id: id('dec_', 1), delivery_state: 'unavailable' }, before[1]]);
      assert.equal(target.resolution, 'expired'); assert.equal(target.resolved_at, later);
      assert.deepEqual(await ledger(h), [closure(1, 1), closure(2, 2, later)]);
    });
  });
test('BETA-FAULT: closed-journal append refusal and real closed-handle sync failure install nothing',
  { timeout: 10000 }, async t => {
    for (const stage of ['append', 'sync']) await t.test(stage, () => fixture(history(1), async h => {
      const before = h.broker.snapshot(), sequence = h.journal.sequence, bytes = await readFile(h.path);
      if (stage === 'append') await h.journal.close();
      else h.sync = async () => { await h.journal.close(); };
      await assert.rejects(Promise.resolve().then(() => h.broker.status()), storage);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.journal.sequence, sequence);
      if (stage === 'append') assert.deepEqual(await readFile(h.path), bytes);
      // sync failure can leave a complete frame: no assertion of rollback or crash durability.
    }));
});
test('BETA-GROUP: 101 due requests, distinct per-group time, 100 flush installs before next group failure',
  { timeout: 30000 }, async t => {
    for (const fail of [false, true]) await t.test(`${fail}`, () => fixture(history(101), async h => {
      const original = h.broker.snapshot(), calls = h.calls, batches = []; let firstClock;
      h.hook = async mutations => {
        batches.push(structuredClone(mutations));
        if (batches.length === 1) { firstClock = h.calls; h.now = Date.parse(later); }
        else {
          assert.equal(expired(h.broker.snapshot().requests).length, 100, 'first flushed group installed');
          assert.ok(h.calls > firstClock, 'fresh time sampled inside second serialized group');
          if (fail) await h.journal.close();
        }
      };
      if (fail) await assert.rejects(Promise.resolve().then(() => h.broker.sweepExpired()), storage);
      else assert.deepEqual(await h.broker.sweepExpired(), { expired: 101 });
      assert.deepEqual(batches.map(b => b.length), [100, 1]); assert.ok(h.calls > calls);
      const targets = new Set(original.requests.map(v => v.request_id)), ids = new Set();
      for (const [index, batch] of batches.entries()) for (const row of batch) {
        assert.ok(targets.delete(row.request_id), 'one unique existing target per mutation');
        assert.equal(DECISION_ID_PATTERN.test(row.decision_id), true); assert.ok(!ids.has(row.decision_id)); ids.add(row.decision_id);
        assert.deepEqual(row, { ...closure(1, 1, index === 0 ? due : later),
          request_id: row.request_id, decision_id: row.decision_id });
      }
      assert.equal(targets.size, 0);
      const saved = h.broker.snapshot().requests;
      assert.equal(expired(saved).length, fail ? 100 : 101);
      if (fail) { const failed = batches[1][0].request_id;
        assert.deepEqual(saved.find(v => v.request_id === failed), original.requests.find(v => v.request_id === failed)); }
      assert.deepEqual(await h.reopen(), saved, 'only flushed groups recovered');
      const entries = await ledger(h); assert.equal(entries.length, fail ? 100 : 101);
    }));
});
test('BETA-IDS: malformed/throw, intra-batch collision and historical collision refuse before append',
  { timeout: 15000 }, async t => {
    for (const [name, generate, predicate, records] of [
      ['array', () => [id('dec_', 1)], storage, history(2)],
      ['null-in-batch', n => n === 1 ? id('dec_', n) : null, storage, history(2)],
      ['object', () => ({ toString: null }), storage, history(2)], ['number', () => 1, storage, history(2)],
      ['encoding', () => 'dec_BAD', storage, history(2)],
      ['throw-in-batch', n => { if (n === 2) throw new TypeError('private generator fault'); return id('dec_', n); }, storage, history(2)],
      ['batch', () => id('dec_', 1), collision, history(2)],
      ['history', () => id('dec_', 7), collision, [...history(2), [closure(1, 7)]]],
    ]) await t.test(name, () => fixture(records, async h => {
      const before = h.broker.snapshot(), bytes = await readFile(h.path), sequence = h.journal.sequence;
      let appends = 0; h.hook = async () => { appends++; };
      await assert.rejects(Promise.resolve().then(() => h.broker.sweepExpired()), predicate);
      assert.equal(appends, 0); assert.deepEqual(h.broker.snapshot(), before);
      assert.deepEqual(await readFile(h.path), bytes); assert.equal(h.journal.sequence, sequence);
    }, { generate }));
});
test('BETA-EMPTY: no clock/generator/append for empty or terminal; terminal never replaced', { timeout: 10000 }, async () => {
  for (const records of [history(0), [...history(1), [closure(1, 9)]]]) await fixture(records, async h => {
    const before = h.broker.snapshot(), calls = h.calls, bytes = await readFile(h.path);
    const sweep = h.broker.sweepExpired(); assert.equal(typeof sweep?.then, 'function');
    assert.deepEqual(await sweep, { expired: 0 });
    const status = h.broker.status(); assert.equal(typeof status?.then, 'function'); const result = await status;
    assert.deepEqual(result, { schema_version: 1, broker: { pid: process.pid, port: 43189,
      started_at: due }, requests: before.requests });
    result.requests[0]?.event_capability && (result.requests[0].event_capability.reason = 'changed');
    assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.calls, calls); assert.equal(h.generated, 0);
    assert.deepEqual(await readFile(h.path), bytes);
  });
});
test('BETA-DEFAULT: ordinary default generator emits distinct valid durable decisions', { timeout: 10000 },
  () => fixture(history(2), async h => {
    const status = await h.broker.status(); assert.equal(status.requests.length, 2);
    const ids = status.requests.map(v => v.decision_id); assert.equal(new Set(ids).size, 2);
    for (const value of ids) assert.equal(typeof value === 'string' && DECISION_ID_PATTERN.test(value), true);
    assert.deepEqual(await h.reopen(), status.requests);
  }, { defaultGenerator: true }));
test('BETA-HTTP-SOURCE: existing control consumer must await status (structural proxy, no listener)', async () => {
  const source = await readFile(new URL('../src/broker/portable-server.js', import.meta.url), 'utf8');
  assert.ok(/send\(response, 200, await broker\.status\(\)\)/.test(source), 'existing HTTP consumer awaits expiry-aware status');
});
