// TEST ONLY: design 4/7 actual creation. Seeds pairing/reservations, NEVER requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { sha256Hex } from '../src/util/values.js';
import { storageFailure } from '../src/errors.js';

const id = (p, n) => p + n.toString(16).padStart(32, '0');
const cap = n => 'cap_' + n.toString(16).padStart(64, '0');
const owner = 'o'.repeat(64), label = 's'.repeat(128);
const start = '2026-11-01T00:00:00Z', at = '2026-11-01T00:01:00.000Z';
const pairing = { user_id: '00071', chat_id: '00081', paired_at: start };
const input = (n = 1, extra = {}) => ({ ownerId: owner, capability: cap(n), requestHandle: id('hdl_', n),
  clientRequestId: 'same', action: 'Question?', context: '', ...extra });
const mutation = (n = 1, extra = {}) => ({ op: 'request.create', request_handle: id('hdl_', n),
  client_request_id: 'same', action: 'Question?', context: '', expires_in_seconds: 3600,
  created_at: at, expires_at: '2026-11-01T01:01:00.000Z', pairing_snapshot: { ...pairing }, ...extra });
const view = (n = 1, extra = {}) => ({ schema_version: 1, request_handle: id('hdl_', n), request_id: id('req_', n),
  client_request_id: 'same', owner_id: owner, session_label: label, action: 'Question?', context: '',
  created_at: at, expires_at: '2026-11-01T01:01:00.000Z', resolution: 'pending', resolved_at: null,
  response_text: null, decision_id: null, telegram_state: 'pending', delivery_state: 'not_applicable', delivery_error: null,
  event_capability: { status: 'unverified', revision: null, reason: 'No verified Events contract or host support' }, ...extra });
const invalid = e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2 && !(e instanceof TypeError);
const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4 && !(e instanceof TypeError);
const conflict = e => e?.code === 'IDEMPOTENCY_CONFLICT' && e.status === 409 && e.retryable === false;
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const tick = () => new Promise(r => setImmediate(r));
const capture = p => p.then(value => ({ value }), error => ({ error }));
async function bounded(p) {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('creation observer timeout')), 1500);
  })]); } finally { clearTimeout(timer); }
}
const create = (h, value = input()) => Promise.resolve().then(() => {
  const p = h.broker.createRequest(value); assert.equal(typeof p?.then, 'function'); return p;
});
async function ledger(h) { return readJournal(await readFile(h.path)).transactions; }
async function state(h) { return { bytes: await readFile(h.path), sequence: h.journal.sequence,
  snapshot: h.broker.snapshot(), counts: h.counts() }; }
async function unchanged(h, before, samples = 0) {
  assert.deepEqual(await readFile(h.path), before.bytes); assert.equal(h.journal.sequence, before.sequence);
  assert.deepEqual(h.broker.snapshot(), before.snapshot);
  assert.deepEqual(h.counts(), { ...before.counts, samples: before.counts.samples + samples });
}
async function fixture(work, { paired = true, owners = [{ owner_id: owner, label: 'configured, not prepared' }, { owner_id: 'other', label: 'Other' }] } = {}) {
  const root = resolve('.scratch/creation-prep'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let journal, broker, handle, samples = 0, ids = 0, appends = 0, writes = 0, syncs = 0;
  const h = { path, logs: [], now: Date.parse(at), admission: async () => {}, syncing: async () => {}, writing: null,
    get journal() { return journal; }, get broker() { return broker; },
    counts: () => ({ samples, ids, appends, writes, syncs }),
    async close() { await broker?.close(); await journal?.close(); },
    async reopen() {
      await h.close(); journal = await Journal.open(path); make(journal);
      const before = samples; await broker.recover(); assert.equal(samples, before, 'replay clock-free');
    } };
  function make(store) {
    broker = createPortableBroker({ journal: store, owners, port: 43189, logger: (...args) => h.logs.push(args),
      clock: () => { samples++; if (h.now instanceof Error) throw h.now; return h.now; },
      generateDecisionId: () => { ids++; return id('dec_', ids); } });
  }
  try {
    const seed = await Journal.open(path);
    try {
      if (paired) {
        await seed.append([{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: start, expires_at: '2026-11-01T00:05:00Z' }]);
        await seed.append([{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: start }, { op: 'pairing.set', pairing }]);
      }
      for (const n of [1, 2]) await seed.append([{ op: 'handle.reserve', owner_id: owner, request_handle: id('hdl_', n),
        request_id: id('req_', n), capability_hash: sha256Hex(cap(n)), session_label: label, prepared_at: start }]);
    } finally { await seed.close(); }
    const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
    handle = await open(path, 'a');
    journal = new Journal(path, { write: async (...args) => { writes++; return h.writing ? h.writing(...args) : handle.write(...args); },
      sync: async () => { syncs++; await h.syncing(); await handle.sync(); }, close: () => handle.close() }, sequence);
    make({ recover: () => journal.recover(), append: async mutations => { appends++; await h.admission(mutations); return journal.append(mutations); } });
    const before = samples; await broker.recover(); assert.equal(samples, before);
    await work(h, handle);
  } finally {
    try { await h.close(); await handle?.close().catch(() => {}); }
    finally { await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
  }
}

test('CREATE-CALIBRATE: paired reservation-only replay, actual reserve sync barrier and ordinary reopen',
  { timeout: 10000 }, () => fixture(async h => {
    assert.deepEqual(h.broker.snapshot().requests, []); assert.deepEqual(h.broker.pairing(), pairing);
    assert.equal((await ledger(h)).length, 4);
    const entered = gate(), release = gate(), before = await state(h); let settled = false;
    h.syncing = async () => { entered.release(); await release.promise; };
    const pending = capture(h.broker.reserveHandle({ ownerId: owner })); pending.then(() => { settled = true; });
    try {
      await bounded(entered.promise); await tick(); assert.equal(settled, false);
      assert.deepEqual(h.broker.snapshot(), before.snapshot); assert.equal(h.journal.sequence, before.sequence);
      assert.equal((await ledger(h)).length, 5, 'complete bytes may precede sync acknowledgement');
    } finally { release.release(); await pending; }
    assert.ok((await pending).value); const saved = h.broker.snapshot();
    await h.reopen(); assert.deepEqual(h.broker.snapshot(), saved);
  }));

test('CREATE-WRITE: exact nine-field mutation, inherited state, nested copies/privacy and reopen retry',
  { timeout: 10000 }, () => fixture(async h => {
    const before = await state(h);
    const result = await create(h, input(1, { request_id: 'evil', owner_id: 'evil', session_label: 'evil',
      pairing_snapshot: { user_id: 'evil' }, created_at: 'evil', expires_at: 'evil', resolution: 'approved',
      telegram_state: 'sent', event_capability: { status: 'verified' } }));
    assert.deepEqual(result, { created: true, request: view() });
    assert.deepEqual((await ledger(h)).at(-1).mutations, [mutation()]);
    assert.equal(Object.keys((await ledger(h)).at(-1).mutations[0]).length, 9);
    assert.equal(h.journal.sequence, before.sequence + 1); assert.equal(h.counts().samples, before.counts.samples + 1);
    result.request.event_capability.reason = 'changed'; result.request.action = 'changed';
    const snapshot = h.broker.snapshot(); snapshot.requests[0].event_capability.status = 'changed';
    assert.deepEqual(h.broker.snapshot().requests, [view()]);
    const publicText = JSON.stringify([h.broker.snapshot(), h.logs]);
    for (const secret of [cap(1), sha256Hex(cap(1)), pairing.user_id, pairing.chat_id, 'pairing_snapshot', 'expires_in_seconds'])
      assert.equal(publicText.includes(secret), false, secret);
    await h.reopen(); assert.deepEqual(h.broker.snapshot().requests, [view()]);
    const reopened = await state(h); assert.deepEqual(await create(h, input(1, { expiresInSeconds: 3600 })), { created: false, request: view() });
    await unchanged(h, reopened, 1);
  }));

test('CREATE-ORDER: append/sync before exposure; prompt denied authority; queued identical/conflicting callers',
  { timeout: 10000 }, () => fixture(async h => {
    const entered = gate(), admit = gate(), syncing = gate(), flush = gate(), before = await state(h);
    let settled = 0, followers = [];
    h.admission = async () => { entered.release(); await admit.promise; };
    h.syncing = async () => { syncing.release(); await flush.promise; };
    const first = capture(create(h)); first.then(() => { settled++; });
    try {
      await bounded(Promise.race([entered.promise, first.then(r => { if (r.error) throw r.error; })])); const counts = h.counts();
      assert.deepEqual(await readFile(h.path), before.bytes);
      for (const bad of [{ ownerId: 'other' }, { capability: cap(2) }, { requestHandle: undefined }])
        assert.equal(await bounded(create(h, input(1, bad))), null, 'denial settles before append releases');
      await assert.rejects(bounded(create(h, input(1, { context: undefined }))), invalid);
      assert.deepEqual(h.counts(), counts);
      followers = [capture(create(h, input(1, { expiresInSeconds: 3600 }))), capture(create(h, input(1, { action: 'different' })))];
      followers.forEach(p => p.then(() => { settled++; }));
      await tick(); assert.deepEqual(h.counts(), counts); assert.equal(settled, 0);
      admit.release(); await bounded(syncing.promise); await tick();
      assert.equal((await ledger(h)).length, before.sequence + 1);
      assert.deepEqual(h.broker.snapshot(), before.snapshot); assert.equal(h.journal.sequence, before.sequence); assert.equal(settled, 0);
      h.now += 1000;
    } finally { admit.release(); flush.release(); await Promise.all([first, ...followers]); }
    assert.deepEqual((await first).value, { created: true, request: view() });
    assert.deepEqual((await followers[0]).value, { created: false, request: view() }); assert.ok(conflict((await followers[1]).error));
    assert.equal(h.counts().samples - before.counts.samples, 2, 'creation once, queued pending expiry once; no new deadline');
    assert.equal(h.counts().appends - before.counts.appends, 1);
    assert.deepEqual((await ledger(h)).at(-1).mutations, [mutation()]);
  }));

test('CREATE-REPLAY: due per-field conflict is clock-free; identical target-only durable expiry then terminal no-clock',
  { timeout: 10000 }, () => fixture(async h => {
    await create(h); await create(h, input(2)); h.now = Date.parse(view().expires_at);
    const before = await state(h);
    for (const delta of [{ clientRequestId: 'changed' }, { action: 'Question? ' }, { context: 'x' }, { expiresInSeconds: 3601 }]) {
      await assert.rejects(create(h, input(1, delta)), conflict); await unchanged(h, before);
    }
    const terminal = view(1, { resolution: 'expired', resolved_at: view().expires_at, decision_id: id('dec_', 1), delivery_state: 'unavailable' });
    assert.deepEqual(await create(h), { created: false, request: terminal });
    assert.deepEqual(h.broker.snapshot().requests, [terminal, view(2)]);
    assert.deepEqual((await ledger(h)).at(-1).mutations, [{ op: 'request.expire', request_id: id('req_', 1),
      decision_id: id('dec_', 1), resolved_at: view().expires_at, delivery_state: 'unavailable' }]);
    assert.equal(h.counts().samples - before.counts.samples, 1);
    const closed = await state(h); assert.deepEqual(await create(h), { created: false, request: terminal }); await unchanged(h, closed);
    await h.reopen(); const recovered = await state(h);
    assert.deepEqual(await create(h), { created: false, request: terminal }); await unchanged(h, recovered);
  }));

test('CREATE-DENIAL: explicit exact authority, unpaired/revoked non-disclosure and exact prerequisite',
  { timeout: 15000 }, async () => {
    for (const options of [{}, { paired: false }, { owners: [] }]) await fixture(async h => {
      const before = await state(h);
      for (const delta of [{ ownerId: undefined }, { ownerId: [] }, { ownerId: 'unknown' }, { ownerId: 'other' }, { capability: undefined },
        { capability: [cap(1)] }, { capability: 'cap_bad' }, { capability: cap(2) }, { requestHandle: undefined },
        { requestHandle: [id('hdl_', 1)] }, { requestHandle: 'hdl_bad' }, { requestHandle: id('hdl_', 9) }]) {
        assert.equal(await create(h, input(1, delta)), null); await unchanged(h, before);
      }
      if (options.owners) assert.equal(await create(h), null);
      else if (options.paired === false) await assert.rejects(create(h), e => e?.status === 503 && e.code === 'NOT_PAIRED' &&
        e.retryable === false && e.message === 'No human is paired; run proceed-mcp pair and complete private-chat pairing');
      await unchanged(h, before);
    }, options);
  });

test('CREATE-INPUT: required fields/default only undefined, plain object, surrogate/scalar and precedence',
  { timeout: 15000 }, () => fixture(async h => {
    const before = await state(h);
    for (const value of [undefined, null, [], 1, 'text', {},
      ...[{ clientRequestId: undefined }, { clientRequestId: [] }, { clientRequestId: '' }, { clientRequestId: 'bad key' }, { clientRequestId: 'x'.repeat(129) },
        { action: undefined }, { action: [] }, { action: '' }, { action: '\ud800' }, { action: '😀'.repeat(1001) },
        { context: undefined }, { context: null }, { context: [] }, { context: '\udfff' }, { context: '😀'.repeat(1001) },
        ...[null, '3600', 59, 86401, 60.5, NaN].map(expiresInSeconds => ({ expiresInSeconds }))]
        .map(delta => input(1, { ...delta, capability: undefined }))]) {
      // Explicit undefined exercises the actual default argument, not the helper's default input.
      const p = value === undefined ? Promise.resolve().then(() => h.broker.createRequest()) : create(h, value);
      await assert.rejects(p, invalid); await unchanged(h, before);
    }
  }));

// Independent accepted layout: overhead143 + longest resolution29 + delivery11,
// full ID36 + owner64 + label128 + timestamp24 + action2000 =>2435 before context.
test('CREATE-RENDER: full-message 4096 accepted/4097 refused before append, not scalar-only',
  { timeout: 10000 }, async t => {
    for (const [limit, context] of [[4096, '😀'.repeat(830) + 'x'], [4097, '😀'.repeat(831)]]) await t.test(String(limit), () => fixture(async h => {
      assert.equal(143 + 29 + 11 + 36 + owner.length + label.length + 24 + 2000 + context.length, limit);
      assert.ok([...context].length <= 1000); const before = await state(h);
      const p = create(h, input(1, { action: '😀'.repeat(1000), context }));
      if (limit === 4097) { await assert.rejects(p, invalid); await unchanged(h, before, 1); }
      else {
        assert.deepEqual(await p, { created: true, request: view(1, { action: '😀'.repeat(1000), context }) });
        assert.deepEqual((await ledger(h)).at(-1).mutations, [mutation(1, { action: '😀'.repeat(1000), context })]);
      }
    }));
  });

test('CREATE-CLOCK: unusable/throw/unrepresentable generated times are storage, no fence before append',
  { timeout: 15000 }, async t => {
    for (const now of [undefined, null, NaN, Infinity, '2026-11-01', 8640000000000001, new Error('test clock'), Date.parse('9999-12-31T23:30:00Z')])
      await t.test(String(now), () => fixture(async h => {
        const before = await state(h); h.now = now;
        await assert.rejects(create(h), storage); await unchanged(h, before, 1);
        h.now = Date.parse(at); // Recovery is unnecessary after a pre-append refusal.
        assert.equal((await create(h)).created, true);
      }));
  });

test('CREATE-FAULT: actual creation no-frame/partial/complete-sync failure fences queued work; reopen retry once',
  { timeout: 20000 }, async t => {
    for (const mode of ['no-frame', 'partial', 'complete']) await t.test(mode, () => fixture(async (h, handle) => {
      const before = await state(h), entered = gate(), release = gate(); let queued = [], admitted;
      h.admission = async () => { entered.release(); await release.promise;
        if (mode === 'no-frame') throw storageFailure('test creation append refusal'); };
      if (mode === 'partial') h.writing = async (buffer, offset) => { const r = await handle.write(buffer, offset, 7); await handle.close(); return r; };
      if (mode === 'complete') h.syncing = () => handle.close();
      const failed = capture(create(h));
      try {
        // Missing-method RED must surface rather than waiting for an impossible append gate.
        await bounded(Promise.race([entered.promise, failed.then(r => { if (r.error) throw r.error; })]));
        admitted = h.counts();
        queued = [capture(create(h)), capture(create(h, input(2))), capture(h.broker.reserveHandle({ ownerId: owner })),
          capture(h.broker.status()), capture(h.broker.readRequest({ ownerId: owner, capability: cap(1), requestId: id('req_', 1) }))];
        let settled = 0; queued.forEach(p => p.then(() => { settled++; }));
        assert.equal(await bounded(create(h, input(1, { capability: cap(2) }))), null);
        await tick(); assert.equal(settled, 0); assert.deepEqual(h.counts(), admitted);
      } finally { release.release(); await Promise.all([failed, ...queued]); }
      assert.ok(storage((await failed).error));
      if (mode !== 'no-frame') assert.equal((await failed).error.cause?.code, 'EBADF');
      for (const p of queued) assert.ok(storage((await p).error));
      const counts = h.counts(); assert.equal(counts.samples, admitted.samples); assert.equal(counts.ids, admitted.ids);
      assert.equal(counts.appends, admitted.appends); assert.equal(h.journal.sequence, before.sequence);
      assert.deepEqual(h.broker.snapshot(), before.snapshot);
      const bytes = await readFile(h.path), parsed = readJournal(bytes);
      assert.equal(parsed.transactions.length, before.sequence + (mode === 'complete' ? 1 : 0));
      assert.equal(bytes.length - parsed.validLength, mode === 'partial' ? 7 : 0);
      if (mode === 'no-frame') assert.deepEqual(bytes, before.bytes);
      for (const action of [() => create(h), () => create(h, input(2)), () => h.broker.status(), () => h.broker.recover()])
        await assert.rejects(Promise.resolve().then(action), storage);
      assert.equal(await create(h, input(1, { capability: cap(2) })), null);
      await assert.rejects(create(h, input(1, { context: undefined })), invalid);
      assert.deepEqual(h.counts(), counts); assert.deepEqual(await readFile(h.path), bytes);
      await h.reopen(); assert.deepEqual(h.broker.snapshot().requests, mode === 'complete' ? [view()] : []);
      assert.deepEqual(await create(h), { created: mode !== 'complete', request: view() });
      assert.deepEqual(await create(h), { created: false, request: view() });
      const rows = await ledger(h); assert.equal(rows.length, before.sequence + 1);
      assert.deepEqual(rows.at(-1).mutations, [mutation()]);
      await h.reopen(); assert.deepEqual(h.broker.snapshot().requests, [view()]);
    }));
  });
