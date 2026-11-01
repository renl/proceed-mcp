// TEST ONLY: design 4 uncertainty fence. Actual reserve writer; no seeded requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { storageFailure } from '../src/errors.js';

const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4;
const semantic = e => e?.code === 'JOURNAL_STATE_INVALID' && e.exitCode === 4;
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const tick = () => new Promise(r => setImmediate(r));
async function bounded(p) {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('observer gate timeout')), 1500);
  })]); } finally { clearTimeout(timer); }
}
const capture = p => Promise.resolve(p).then(value => ({ value }), error => ({ error }));
async function refuses(p, predicate = storage) { const r = await p; assert.ok(predicate(r.error), `expected refusal, got ${JSON.stringify(r.value)}`); }
async function fixture(work, { recover = true } = {}) {
  const root = resolve('.scratch/p0-fence'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let journal, broker, handle, samples = 0, ids = 0, appends = 0, writes = 0, syncs = 0, recoveries = 0;
  const h = { path, admission: async () => {}, syncing: async () => {}, writing: null,
    get journal() { return journal; }, get broker() { return broker; },
    counts: () => ({ samples, ids, appends, writes, syncs, recoveries }),
    closeHandle: () => handle.close(),
    async close() { await broker?.close(); await journal?.close(); },
    async reopen() {
      await h.close(); journal = await Journal.open(path); makeBroker(journal);
      const n = samples; const result = await broker.recover(); assert.equal(samples, n);
      return result;
    } };
  function makeBroker(store) {
    broker = createPortableBroker({ journal: store, owners: [{ owner_id: 'a', label: 'A' }, { owner_id: 'b', label: 'B' }],
      port: 43189, clock: () => { samples++; return Date.parse('2026-11-01T00:00:00Z'); },
      generateDecisionId: () => { ids++; return 'dec_' + '1'.repeat(32); } });
  }
  try {
    const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
    handle = await open(path, 'a');
    journal = new Journal(path, {
      write: async (...args) => { writes++; return h.writing ? h.writing(...args) : handle.write(...args); },
      sync: async () => { syncs++; await h.syncing(); await handle.sync(); },
      close: () => handle.close(),
    }, sequence);
    makeBroker({ recover: () => { recoveries++; return journal.recover(); }, append: async (...args) => {
      appends++; await h.admission(); return journal.append(...args);
    } });
    if (recover) await broker.recover();
    await work(h, handle);
  } finally {
    try { await h.close(); await handle?.close().catch(() => {}); }
    finally { await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
  }
}
const reserve = (h, ownerId = 'a') => h.broker.reserveHandle({ ownerId });
const binding = r => ({ ownerId: 'a', capability: r.request_capability, requestId: r.request_id });
async function armFault(h, handle, mode) {
  if (mode === 'no-frame') h.admission = async () => { throw storageFailure('test admission refusal'); };
  if (mode === 'closed') await h.closeHandle();
  if (mode === 'partial') h.writing = async (buffer, offset) => {
    const r = await handle.write(buffer, offset, 7); await h.closeHandle(); return r;
  };
  if (mode === 'complete') h.syncing = () => h.closeHandle();
}

test('P0-CALIBRATE: actual writer pending at sync, full bytes precede acknowledgement, ordinary reopen',
  { timeout: 10000 }, () => fixture(async h => {
    const entered = gate(), release = gate(), before = h.broker.snapshot(), bytes = await readFile(h.path);
    const sequence = h.journal.sequence; let settled = false;
    h.syncing = async () => { entered.release(); await release.promise; };
    const pending = capture(reserve(h)); pending.then(() => { settled = true; });
    try {
      await bounded(entered.promise); await tick(); assert.equal(settled, false);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.journal.sequence, sequence);
      const written = await readFile(h.path); assert.notDeepEqual(written, bytes);
      assert.equal(readJournal(written).transactions.length, 1);
    } finally { release.release(); await pending; }
    assert.ok((await pending).value); const saved = h.broker.snapshot();
    assert.deepEqual(await h.reopen(), { records: 1 }); assert.deepEqual(h.broker.snapshot(), saved);
    await reserve(h, 'b'); assert.equal(h.journal.sequence, 2);
  }));

test('P0-FAULT-CALIBRATE: no frame, genuine partial-write failure, full frame rejected sync, closed handle',
  { timeout: 15000 }, async t => {
    for (const mode of ['no-frame', 'partial', 'complete', 'closed']) await t.test(mode,
      () => fixture(async (h, handle) => {
        const before = h.broker.snapshot(), bytes = await readFile(h.path), sequence = h.journal.sequence;
        const counts = h.counts(); await armFault(h, handle, mode);
        const failed = capture(reserve(h)); await refuses(failed);
        if (mode !== 'no-frame') assert.equal((await failed).error.cause?.code, 'EBADF', 'actual closed FileHandle failure');
        assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.journal.sequence, sequence);
        const after = await readFile(h.path), parsed = readJournal(after);
        assert.equal(parsed.transactions.length, mode === 'complete' ? 1 : 0);
        assert.equal(after.length - parsed.validLength, mode === 'partial' ? 7 : 0);
        if (mode === 'no-frame' || mode === 'closed') assert.deepEqual(after, bytes);
        if (mode === 'partial' || mode === 'complete') assert.ok(h.counts().writes > 0);
        assert.equal(h.counts().syncs - counts.syncs, mode === 'complete' ? 1 : 0);
      }));
  });

test('P0-FENCE: rejection fences unrelated queued/fresh turns, denies authority before queue, no in-place clearing',
  { timeout: 15000 }, async t => {
    for (const mode of ['no-frame', 'partial', 'complete', 'closed']) await t.test(mode,
      () => fixture(async (h, handle) => {
        const retained = await reserve(h), before = h.broker.snapshot();
        const entered = gate(), release = gate(); let queued = [], admitted;
        h.admission = async () => { entered.release(); await release.promise;
          if (mode === 'no-frame') throw storageFailure('test admission refusal'); };
        const failed = capture(reserve(h));
        try {
          await bounded(entered.promise);
          admitted = h.counts();
          queued = [capture(reserve(h, 'b')), capture(h.broker.readRequest(binding(retained))),
            capture(h.broker.sweepExpired()), capture(h.broker.status())];
          let settled = 0; queued.forEach(p => p.then(() => { settled++; }));
          assert.equal(await bounded(h.broker.readRequest({ ...binding(retained), ownerId: 'b' })), null);
          assert.equal(await bounded(h.broker.readRequest({ ownerId: 'a' })), null);
          await tick(); assert.equal(settled, 0, 'all admitted turns wait for writer');
          assert.deepEqual(h.broker.snapshot(), before);
          h.admission = async () => {}; await armFault(h, handle, mode);
        } finally { release.release(); await Promise.all([failed, ...queued]); }
        await refuses(failed); const counts = h.counts(), bytes = await readFile(h.path);
        for (const p of queued) await refuses(p);
        for (const key of ['samples', 'ids', 'appends']) assert.equal(counts[key], admitted[key], key);
        assert.deepEqual(h.broker.snapshot(), before);
        const copy = h.broker.snapshot(); copy.prepared[0].session_label = 'changed';
        assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.broker.pairing(), null);
        for (const action of [() => reserve(h, 'b'), () => h.broker.readRequest(binding(retained)),
          () => h.broker.sweepExpired(), () => h.broker.status(), () => h.broker.recover()])
          await refuses(capture(Promise.resolve().then(action)));
        assert.equal(await h.broker.readRequest({}), null);
        assert.deepEqual(h.counts(), counts, 'fenced turns never reach clocks, IDs, append, writes or recovery sync');
        assert.deepEqual(await readFile(h.path), bytes);
      }));
  });

test('P0-FRESH-FENCE: independently reaches post-rejection turns even when recovery queue ordering is broken',
  { timeout: 15000 }, async t => {
    for (const mode of ['no-frame', 'partial', 'complete', 'closed'])
      for (const operation of ['status', 'sweep', 'read', 'reserve', 'recover']) await t.test(`${mode}/${operation}`,
      () => fixture(async (h, handle) => {
        const retained = await reserve(h), before = h.broker.snapshot();
        await armFault(h, handle, mode); await refuses(capture(reserve(h)));
        const counts = h.counts(), bytes = await readFile(h.path);
        const actions = { status: () => h.broker.status(), sweep: () => h.broker.sweepExpired(),
          read: () => h.broker.readRequest(binding(retained)), reserve: () => reserve(h, 'b'), recover: () => h.broker.recover() };
        await refuses(capture(Promise.resolve().then(actions[operation])));
        assert.equal(await h.broker.readRequest({}), null);
        assert.deepEqual(h.counts(), counts); assert.deepEqual(h.broker.snapshot(), before);
        assert.deepEqual(await readFile(h.path), bytes);
      }));
  });

test('P0-RECONCILE: close both owners, normal reopen repairs only incomplete tail and retains complete failed frame once',
  { timeout: 15000 }, async t => {
    for (const mode of ['no-frame', 'partial', 'complete', 'closed']) await t.test(mode,
      () => fixture(async (h, handle) => {
        const retained = await reserve(h), before = h.broker.snapshot(), good = await readFile(h.path);
        await armFault(h, handle, mode); await refuses(capture(reserve(h, 'b')));
        const uncertain = await readFile(h.path), parsed = readJournal(uncertain);
        assert.deepEqual(h.broker.snapshot(), before);
        const records = mode === 'complete' ? 2 : 1;
        assert.deepEqual(await h.reopen(), { records });
        assert.equal(h.journal.sequence, records);
        assert.deepEqual(await readFile(h.path), mode === 'complete' ? uncertain : good);
        assert.equal(parsed.transactions.length, records);
        const recovered = h.broker.snapshot(); assert.deepEqual(recovered.prepared[0], before.prepared[0]);
        assert.equal(recovered.prepared.length, records); assert.deepEqual(recovered.requests, []);
        assert.ok(h.broker.authorize(binding(retained)), 'acknowledged capability survives');
        await reserve(h, 'b'); assert.equal(h.journal.sequence, records + 1);
        const saved = h.broker.snapshot(); await h.reopen(); assert.deepEqual(h.broker.snapshot(), saved);
      }));
  });

test('P0-RECOVERY-ORDER: sync before sequence/install acknowledgement; recover serializes and queued reserve waits',
  { timeout: 10000 }, () => fixture(async h => {
    const before = h.broker.snapshot(), entered = gate(), release = gate();
    const producer = createPortableBroker({ journal: h.journal, owners: [{ owner_id: 'a', label: 'A' }], port: 43189 });
    try { await producer.recover(); await producer.reserveHandle({ ownerId: 'a' }); }
    finally { await producer.close(); }
    const sequence = h.journal.sequence; let recovered = false, queued;
    h.syncing = async () => { entered.release(); await release.promise; };
    const recovery = capture(h.broker.recover()); recovery.then(() => { recovered = true; });
    try {
      await bounded(entered.promise); queued = capture(reserve(h, 'b')); const counts = h.counts();
      await tick(); assert.equal(recovered, false); assert.deepEqual(h.counts(), counts);
      assert.equal(h.journal.sequence, sequence); assert.deepEqual(h.broker.snapshot(), before);
    } finally { release.release(); await Promise.all([recovery, queued]); }
    assert.deepEqual((await recovery).value, { records: 1 }); assert.ok((await queued).value);
    assert.equal(h.journal.sequence, 2);
  }));

test('P0-RECOVERY-QUEUE: recover submitted behind admitted writer cannot race it or acknowledge old history',
  { timeout: 10000 }, () => fixture(async h => {
    const entered = gate(), release = gate(); let recovery, settled = false;
    h.admission = async () => { entered.release(); await release.promise; };
    const pending = capture(reserve(h));
    try {
      await bounded(entered.promise); const counts = h.counts();
      recovery = capture(h.broker.recover()); recovery.then(() => { settled = true; });
      assert.deepEqual(h.counts(), counts, 'queued recovery must not even enter storage while append is held');
      await tick(); assert.equal(settled, false); assert.deepEqual(h.broker.snapshot(), { prepared: [], requests: [] });
    } finally { release.release(); await Promise.all([pending, recovery]); }
    assert.ok((await pending).value); assert.deepEqual((await recovery).value, { records: 1 });
    assert.equal(h.broker.snapshot().prepared.length, 1);
  }));

test('P0-RECOVERY-SYNC: genuine closed-handle sync rejects, sequence unchanged and core remains unwritable',
  { timeout: 10000 }, () => fixture(async h => {
    await h.journal.append([{ op: 'unknown.for.sync.order' }]); const bytes = await readFile(h.path);
    // New ordinary Journal observer starts with unacknowledged sequence zero over a complete file.
    const handle = await open(h.path, 'a'); await handle.close();
    const observer = new Journal(h.path, handle, 0);
    await assert.rejects(() => observer.recover(), storage); assert.equal(observer.sequence, 0);
    await observer.close(); assert.deepEqual(await readFile(h.path), bytes);
    await assert.rejects(() => h.broker.recover(), semantic);
    await refuses(capture(reserve(h))); assert.deepEqual(h.broker.snapshot(), { prepared: [], requests: [] });
  }, { recover: false }));

test('P0-JOURNAL-ORDER: recovered sequence acknowledgement waits for delegated real sync',
  { timeout: 10000 }, () => fixture(async h => {
    await reserve(h); const handle = await open(h.path, 'a'), entered = gate(), release = gate();
    const journal = new Journal(h.path, { write: (...a) => handle.write(...a), close: () => handle.close(),
      sync: async () => { entered.release(); await release.promise; await handle.sync(); } }, 0);
    let settled = false; const pending = capture(journal.recover()); pending.then(() => { settled = true; });
    try {
      await bounded(entered.promise); await tick(); assert.equal(settled, false); assert.equal(journal.sequence, 0);
    } finally { release.release(); await pending; await journal.close(); }
    assert.equal((await pending).value.transactions.length, 1); assert.equal(journal.sequence, 1);
  }));

test('P0-CORE-SYNC: first and later authentic recovery-sync failure preserve state and disallow new success',
  { timeout: 10000 }, async t => {
    for (const first of [true, false]) await t.test(`first=${first}`, () => fixture(async h => {
      if (!first) await reserve(h);
      const before = h.broker.snapshot(), sequence = h.journal.sequence, bytes = await readFile(h.path);
      await h.closeHandle(); await assert.rejects(() => h.broker.recover(), storage);
      assert.deepEqual(h.broker.snapshot(), before); assert.equal(h.journal.sequence, sequence);
      const counts = h.counts(); await refuses(capture(reserve(h)));
      assert.deepEqual(h.counts(), counts); assert.deepEqual(await readFile(h.path), bytes);
    }, { recover: !first }));
  });

test('P0-SEMANTIC: failed later whole-history replay preserves installed state but fences every successful turn',
  { timeout: 10000 }, () => fixture(async h => {
    const retained = await reserve(h), before = h.broker.snapshot();
    // Quiescent original core; one temporary ordinary producer adds valid history, then closes.
    const producer = createPortableBroker({ journal: h.journal, owners: [{ owner_id: 'b', label: 'B' }], port: 43189 });
    try { await producer.recover(); await producer.reserveHandle({ ownerId: 'b' }); }
    finally { await producer.close(); }
    await h.journal.append([{ op: 'unknown.semantic.control' }]); const bytes = await readFile(h.path);
    await assert.rejects(() => h.broker.recover(), semantic); assert.deepEqual(h.broker.snapshot(), before);
    const counts = h.counts();
    for (const action of [() => reserve(h), () => h.broker.readRequest(binding(retained)),
      () => h.broker.status(), () => h.broker.sweepExpired(), () => h.broker.recover()])
      await refuses(capture(Promise.resolve().then(action)));
    assert.deepEqual(h.counts(), counts); assert.deepEqual(await readFile(h.path), bytes);
    await h.close(); const journal = await Journal.open(h.path);
    try { assert.deepEqual(await readFile(h.path), bytes, 'framing reopen must not erase semantic corruption'); }
    finally { await journal.close(); }
  }));

test('P0-INCOMPLETE: fresh broker refuses unrepaired final tail; only normal close/reopen may repair',
  { timeout: 10000 }, () => fixture(async (h, handle) => {
    const retained = await reserve(h), before = h.broker.snapshot();
    await armFault(h, handle, 'partial'); await refuses(capture(reserve(h)));
    await h.close(); const bytes = await readFile(h.path), raw = await open(h.path, 'a');
    const journal = new Journal(h.path, raw, 0);
    const broker = createPortableBroker({ journal, owners: [{ owner_id: 'a', label: 'A' }], port: 43189 });
    try {
      await assert.rejects(() => broker.recover(), storage);
      assert.deepEqual(broker.snapshot(), { prepared: [], requests: [] });
      await assert.rejects(() => broker.reserveHandle({ ownerId: 'a' }), storage);
      assert.deepEqual(await readFile(h.path), bytes);
    } finally { await broker.close(); await journal.close(); }
    await h.reopen(); assert.deepEqual(h.broker.snapshot(), before);
    assert.ok(h.broker.authorize(binding(retained)));
  }));
