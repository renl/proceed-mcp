// TEST ONLY: design4/7. Seed pairing/reservations ONLY; all requests are actual writes.
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
const owner = 'o'.repeat(64), start = '2026-11-01T00:00:00Z';
const at = '2026-11-01T00:01:00.123Z';
const input = (extra = {}, n = 1) => ({ ownerId: owner, capability: cap(n), requestHandle: id('hdl_', n),
  clientRequestId: 'same', action: 'Question?', context: '', ...extra });
const invalid = e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2 && !(e instanceof TypeError);
const storage = e => e?.code === 'STORAGE_FAILURE' && e.exitCode === 4 && !(e instanceof TypeError);
const conflict = e => e?.code === 'IDEMPOTENCY_CONFLICT' && e.status === 409 && e.retryable === false;
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const capture = p => p.then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(r => setImmediate(r));
async function bounded(p) {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('breadth observer timeout')), 1500);
  })]); } finally { clearTimeout(timer); }
}
const create = (h, value = input()) => Promise.resolve().then(() => h.broker.createRequest(value));
const ledger = async h => readJournal(await readFile(h.path)).transactions;
async function state(h) { return { bytes: await readFile(h.path), sequence: h.journal.sequence,
  snapshot: h.broker.snapshot(), counts: h.counts() }; }
async function unchanged(h, before, samples = 0) {
  assert.deepEqual(await readFile(h.path), before.bytes); assert.equal(h.journal.sequence, before.sequence);
  assert.deepEqual(h.broker.snapshot(), before.snapshot);
  assert.deepEqual(h.counts(), { ...before.counts, samples: before.counts.samples + samples });
}
async function fixture(work, { prepared = start, paired = start, label = 's'.repeat(128) } = {}) {
  const root = resolve('.scratch/creation-breadth'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let journal, broker, handle, samples = 0, ids = 0, appends = 0, syncs = 0;
  const pairing = { user_id: '00071', chat_id: '00081', paired_at: paired };
  const h = { path, pairing, label, now: Date.parse(at), admission: async () => {}, syncing: async () => {},
    get journal() { return journal; }, get broker() { return broker; },
    counts: () => ({ samples, ids, appends, syncs }),
    async close() { await broker?.close(); await journal?.close(); },
    async reopen() {
      await h.close(); journal = await Journal.open(path); make(journal);
      const before = samples; await broker.recover(); assert.equal(samples, before, 'clock-free replay');
    } };
  function make(store) {
    broker = createPortableBroker({ journal: store, owners: [{ owner_id: owner, label: 'changed operator label' }],
      port: 43189, clock: () => { samples++; return h.now; }, generateDecisionId: () => id('dec_', ++ids) });
  }
  try {
    const seed = await Journal.open(path);
    try {
      await seed.append([{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: start,
        expires_at: '2026-11-01T00:05:00Z' }]);
      await seed.append([{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: paired },
        { op: 'pairing.set', pairing }]);
      for (const n of [1, 2]) await seed.append([{ op: 'handle.reserve', owner_id: owner,
        request_handle: id('hdl_', n), request_id: id('req_', n), capability_hash: sha256Hex(cap(n)),
        session_label: label, prepared_at: prepared }]);
    } finally { await seed.close(); }
    const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
    handle = await open(path, 'a');
    journal = new Journal(path, { write: (...args) => handle.write(...args),
      sync: async () => { syncs++; await h.syncing(); await handle.sync(); }, close: () => handle.close() }, sequence);
    make({ recover: () => journal.recover(), append: async mutations => {
      appends++; await h.admission(mutations); return journal.append(mutations);
    } });
    const beforeReplay = samples; await broker.recover(); assert.equal(samples, beforeReplay);
    assert.deepEqual(broker.snapshot().requests, []);
    assert.deepEqual(broker.pairing(), pairing);
    await work(h, handle);
  } finally {
    try { await h.close(); await handle?.close().catch(() => {}); }
    finally { await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
  }
}

test('BREADTH-DURATION: endpoints/interior actual history, nondefault reopen conflict and exact deadline',
  { timeout: 15000 }, async t => {
    for (const duration of [60, 7319, 86400]) await t.test(String(duration), () => fixture(async h => {
      const value = input({ expiresInSeconds: duration }), before = await state(h);
      const result = await create(h, value), request = result.request;
      assert.equal(result.created, true); assert.equal(request.created_at, at);
      assert.equal(request.expires_at, new Date(Date.parse(at) + duration * 1000).toISOString());
      assert.equal('expires_in_seconds' in request, false); assert.equal('expiresInSeconds' in request, false);
      assert.deepEqual((await ledger(h)).at(-1).mutations, [{ op: 'request.create', request_handle: id('hdl_', 1),
        client_request_id: 'same', action: 'Question?', context: '', expires_in_seconds: duration,
        created_at: at, expires_at: request.expires_at, pairing_snapshot: h.pairing }]);
      assert.equal(h.journal.sequence, before.sequence + 1);
      await h.reopen(); assert.deepEqual(h.broker.snapshot().requests, [request]);
      h.now = Date.parse(request.expires_at) - 1;
      const reopened = await state(h);
      assert.deepEqual(await create(h, value), { created: false, request }); await unchanged(h, reopened, 1);
      h.now++; const due = await state(h);
      await assert.rejects(create(h, input({ expiresInSeconds: duration === 60 ? 61 : duration - 1 })), conflict);
      await unchanged(h, due);
      const terminal = { ...request, resolution: 'expired', resolved_at: request.expires_at,
        decision_id: id('dec_', 1), delivery_state: 'unavailable' };
      assert.deepEqual(await create(h, value), { created: false, request: terminal });
      const rows = await ledger(h); assert.equal(rows.length, before.sequence + 2);
      assert.deepEqual(rows.at(-1).mutations, [{ op: 'request.expire', request_id: id('req_', 1),
        decision_id: id('dec_', 1), resolved_at: request.expires_at, delivery_state: 'unavailable' }]);
      await h.reopen(); assert.deepEqual(await ledger(h), rows);
      const closed = await state(h); assert.deepEqual(await create(h, value), { created: false, request: terminal });
      await unchanged(h, closed);
    }));
  });

test('BREADTH-DEFAULT: omitted/undefined/explicit3600 equivalent before and after normal reopen',
  { timeout: 10000 }, () => fixture(async h => {
    const result = await create(h, input({ expiresInSeconds: undefined })); assert.equal(result.created, true);
    assert.equal((await ledger(h)).at(-1).mutations[0].expires_in_seconds, 3600);
    for (const reopen of [false, true]) {
      if (reopen) await h.reopen();
      for (const extra of [{}, { expiresInSeconds: undefined }, { expiresInSeconds: 3600 }]) {
        const before = await state(h); assert.deepEqual(await create(h, input(extra)), { ...result, created: false });
        await unchanged(h, before, 1);
      }
    }
  }));

test('BREADTH-INVALID-DURATION: types/range/nonfinite before authority; valid companion remains usable',
  { timeout: 10000 }, () => fixture(async h => {
    const before = await state(h);
    for (const expiresInSeconds of [null, true, false, {}, [], [60], '60', '', 59, 86401, 60.1, -Infinity, Infinity, NaN]) {
      for (const capability of [cap(1), undefined]) {
        await assert.rejects(create(h, input({ expiresInSeconds, capability })), invalid); await unchanged(h, before);
      }
    }
    assert.equal((await create(h, input({ expiresInSeconds: 60 }))).created, true);
  }));

test('BREADTH-TEXT: key/scalar min/max and BMP/astral/combining accepted without normalization',
  { timeout: 20000 }, async t => {
    const cases = [{ clientRequestId: 'A', action: 'x', context: '' },
      { clientRequestId: 'Az09_-'.repeat(21) + '_Z', action: '界'.repeat(1000), context: '界'.repeat(1000) },
      { action: '😀'.repeat(1000), context: 'x'.repeat(1000) },
      { action: '界', context: '😀'.repeat(1000) },
      { action: 'e\u0301'.repeat(500), context: 'e\u0301'.repeat(500) },
      { action: ' \n\t ', context: '\t\n ' }, { action: '\ud800\udc00', context: '\udbff\udfff' }];
    for (const [i, extra] of cases.entries()) await t.test(String(i), () => fixture(async h => {
      const value = input(extra), result = await create(h, value); assert.equal(result.created, true);
      for (const [key, field] of [['clientRequestId', 'client_request_id'], ['action', 'action'], ['context', 'context']])
        assert.equal(result.request[field], value[key]);
      const saved = await ledger(h); await h.reopen(); assert.deepEqual(await ledger(h), saved);
      const before = await state(h); assert.deepEqual(await create(h, value), { ...result, created: false });
      await unchanged(h, before, 1);
    }));
  });

test('BREADTH-TEXT-REFUSAL: adjacent lengths, malformed surrogates, invalid keys; valid partners',
  { timeout: 10000 }, () => fixture(async h => {
    const before = await state(h);
    const cases = [{ clientRequestId: '' }, { clientRequestId: 'x'.repeat(129) }, { clientRequestId: 'é' },
      { clientRequestId: ' x' }, { clientRequestId: 'x\n' }, { action: '' }];
    for (const field of ['action', 'context']) for (const text of ['界'.repeat(1001), '😀'.repeat(1001),
      'e\u0301'.repeat(500) + 'x', '\ud800', '\udfff', '\ud800x', 'x\udc00', '\udc00\ud800'])
      cases.push({ [field]: text });
    for (const extra of cases) { await assert.rejects(create(h, input(extra)), invalid); await unchanged(h, before); }
    assert.equal((await create(h, input({ clientRequestId: '_', action: '\ud800\udc00', context: '' }))).created, true);
  }));

test('BREADTH-EXACT: whitespace/key case/NFC-equivalent changes conflict clock-free even due',
  { timeout: 10000 }, () => fixture(async h => {
    const value = input({ clientRequestId: 'Key_', action: ' é\n', context: 'e\u0301\t' });
    const result = await create(h, value); await h.reopen(); h.now = Date.parse(result.request.expires_at);
    const before = await state(h);
    for (const extra of [{ clientRequestId: 'key_' }, { action: ' e\u0301\n' }, { action: 'é\n' },
      { context: 'é\t' }, { context: 'e\u0301' }]) {
      await assert.rejects(create(h, { ...value, ...extra }), conflict); await unchanged(h, before);
    }
    const exact = await create(h, value); assert.equal(exact.created, false); assert.equal(exact.request.resolution, 'expired');
    assert.equal(exact.request.expires_at, result.request.expires_at);
  }));

test('BREADTH-TIME: independently binding prepared/pairing equality, before and sub-ms stored bounds',
  { timeout: 20000 }, async t => {
    for (const field of ['prepared', 'paired']) for (const bound of [at, '2026-11-01T00:01:00.1231Z'])
      await t.test(`${field}/${bound}`, () => fixture(async h => {
        h.now = Date.parse(at) - 1; let before = await state(h);
        await assert.rejects(create(h), storage); await unchanged(h, before, 1);
        h.now = Date.parse(at); before = await state(h);
        if (bound !== at) { await assert.rejects(create(h), storage); await unchanged(h, before, 1); h.now++; }
        const result = await create(h); assert.equal(result.created, true);
        assert.equal(result.request.created_at, new Date(h.now).toISOString());
        assert.equal(result.request.expires_at, new Date(h.now + 3600000).toISOString());
        const rows = await ledger(h); assert.equal(rows.length, before.sequence + 1);
        await h.reopen(); assert.deepEqual(h.broker.snapshot().requests, [result.request]); assert.deepEqual(await ledger(h), rows);
      }, { [field]: bound }));
  });

// Independent accepted full-message maximum: 143 literals/newlines +29 resolution +11 delivery.
const maximum = r => 143 + 29 + 11 + r.request_id.length + r.owner_id.length + r.session_label.length +
  r.action.length + (r.context === '' ? 6 : r.context.length) + r.expires_at.length;
test('BREADTH-PRESENTATION: actual writer empty/markup/newline/combining/inherited label arithmetic',
  { timeout: 20000 }, async t => {
    for (const label of ['é', '😀'.repeat(128), 'e\u0301'.repeat(64), ' \n<&>"\\ '])
      await t.test(label, () => fixture(async h => {
        for (const [n, extra] of [[1, { action: '  "\\\n<&>*_[😀]  ', context: '' }],
          [2, { action: 'e\u0301\né', context: 'e\u0301\n\t"\\<&>' }]]) {
          const value = input({ ...extra, session_label: 'untrusted override' }, n), result = await create(h, value);
          assert.equal(result.created, true); assert.equal(result.request.session_label, label);
          assert.equal(result.request.action, extra.action); assert.equal(result.request.context, extra.context);
          const expected = 143 + 29 + 11 + 36 + 64 + label.length + extra.action.length +
            (extra.context === '' ? 6 : extra.context.length) + 24;
          assert.equal(maximum(result.request), expected); assert.ok(expected < 4096);
          assert.equal((await ledger(h)).at(-1).mutations[0].context, extra.context);
        }
        const saved = h.broker.snapshot(); await h.reopen(); assert.deepEqual(h.broker.snapshot(), saved);
      }, { label }));
    // Label's supplementary units must affect admission, independently of its scalar count.
    for (const [label, accepted, length] of [['s'.repeat(128), true, 4096], ['😀'.repeat(128), false, 4224]])
      await t.test(`label-bound-${length}`, () => fixture(async h => {
        const value = input({ action: '😀'.repeat(1000), context: '😀'.repeat(830) + 'x' });
        assert.equal(maximum({ request_id: id('req_', 1), owner_id: owner, session_label: label,
          action: value.action, context: value.context, expires_at: at }), length);
        const before = await state(h);
        if (accepted) assert.equal((await create(h, value)).created, true);
        else { await assert.rejects(create(h, value), invalid); await unchanged(h, before, 1);
          assert.equal((await create(h)).created, true); }
      }, { label }));
  });

test('BREADTH-CLOSED: closed actual Journal refuses creation without installed success',
  { timeout: 10000 }, () => fixture(async h => {
    const before = await state(h); await h.journal.close(); await assert.rejects(create(h), storage);
    assert.deepEqual(h.broker.snapshot(), before.snapshot); assert.deepEqual(await readFile(h.path), before.bytes);
    assert.equal(h.journal.sequence, before.sequence); const fenced = h.counts();
    await assert.rejects(create(h), storage); assert.deepEqual(h.counts(), fenced);
    await h.reopen(); assert.equal((await create(h)).created, true);
  }));

test('BREADTH-QUEUE: recover/sweep admitted behind failed creation cannot repair its fence',
  { timeout: 10000 }, () => fixture(async h => {
    const entered = gate(), release = gate(), before = await state(h); let queued = [];
    h.admission = async () => { entered.release(); await release.promise; throw storageFailure('test no-frame failure'); };
    const first = capture(create(h));
    try {
      await bounded(entered.promise); queued = [capture(h.broker.recover()), capture(h.broker.sweepExpired())];
      let settled = 0; queued.forEach(p => p.then(() => { settled++; })); await tick(); assert.equal(settled, 0);
    } finally { release.release(); await Promise.all([first, ...queued]); }
    assert.ok(storage((await first).error)); for (const p of queued) assert.ok(storage((await p).error));
    assert.deepEqual(h.broker.snapshot(), before.snapshot); assert.deepEqual(await readFile(h.path), before.bytes);
    assert.equal(h.journal.sequence, before.sequence); assert.equal(h.counts().samples - before.counts.samples, 1);
    assert.equal(h.counts().appends - before.counts.appends, 1); assert.equal(h.counts().ids, 0);
    await h.reopen(); assert.equal((await create(h)).created, true);
    assert.deepEqual(await h.broker.sweepExpired(), { expired: 0 });
  }));

test('BREADTH-CLOSE: drains held admitted creation, rejects new turns and preserves exact reopen',
  { timeout: 10000 }, () => fixture(async h => {
    const entered = gate(), release = gate(); let closed = false, settled = false, closing;
    h.syncing = async () => { entered.release(); await release.promise; };
    const first = capture(create(h)); first.then(() => { settled = true; });
    try {
      await bounded(entered.promise); closing = h.broker.close().then(() => { closed = true; });
      const before = await state(h); await assert.rejects(bounded(create(h, input({}, 2))), storage);
      await unchanged(h, before); await tick(); assert.equal(closed, false); assert.equal(settled, false);
      assert.deepEqual(h.broker.snapshot().requests, []);
      assert.equal((await ledger(h)).at(-1).mutations[0].op, 'request.create', 'bytes may precede sync');
    } finally { release.release(); await first; await closing; }
    assert.equal(closed, true); assert.equal((await first).value.created, true);
    const saved = h.broker.snapshot(), rows = await ledger(h); await h.reopen();
    assert.deepEqual(h.broker.snapshot(), saved); assert.deepEqual(await ledger(h), rows);
  }));

test('BREADTH-DUE-FAULT: identical retry on ACTUAL creation fails expiry without replacing installed state',
  { timeout: 15000 }, async t => {
    for (const mode of ['no-frame', 'complete-sync']) await t.test(mode, () => fixture(async (h, handle) => {
      const value = input({ expiresInSeconds: 60 }), created = await create(h, value);
      await create(h, input({}, 2)); const before = await state(h), originalRows = await ledger(h);
      h.now = Date.parse(created.request.expires_at);
      if (mode === 'no-frame') h.admission = async () => { throw storageFailure('test expiry refusal'); };
      else h.syncing = () => handle.close();
      await assert.rejects(create(h, value), storage);
      assert.deepEqual(h.broker.snapshot(), before.snapshot); assert.equal(h.journal.sequence, before.sequence);
      const rows = await ledger(h); assert.deepEqual(rows.slice(0, originalRows.length), originalRows);
      assert.equal(rows.length, originalRows.length + (mode === 'complete-sync' ? 1 : 0));
      if (mode === 'no-frame') assert.deepEqual(await readFile(h.path), before.bytes);
      else assert.deepEqual(rows.at(-1).mutations, [{ op: 'request.expire', request_id: id('req_', 1),
        decision_id: id('dec_', 1), resolved_at: created.request.expires_at, delivery_state: 'unavailable' }]);
      const failed = await state(h); await assert.rejects(h.broker.recover(), storage);
      await assert.rejects(h.broker.sweepExpired(), storage); await unchanged(h, failed);
      await h.reopen(); assert.deepEqual(await ledger(h), rows);
      const recovered = h.broker.snapshot().requests;
      assert.equal(recovered[0].resolution, mode === 'complete-sync' ? 'expired' : 'pending');
      assert.deepEqual(recovered[1], before.snapshot.requests[1]);
      const retry = await create(h, value); assert.equal(retry.created, false); assert.equal(retry.request.resolution, 'expired');
      assert.equal(retry.request.expires_at, created.request.expires_at);
      const finalRows = await ledger(h); assert.equal(finalRows.length, originalRows.length + 1);
      const saved = h.broker.snapshot(); await h.reopen(); assert.deepEqual(h.broker.snapshot(), saved);
      assert.deepEqual(await ledger(h), finalRows);
    }));
  });

test('BREADTH-RECOVERY: invalid suffix after ACTUAL creation retains installed state and exact history',
  { timeout: 10000 }, () => fixture(async h => {
    const created = await create(h); const installed = h.broker.snapshot();
    await h.journal.append([{ op: 'breadth.invalid' }]);
    const bytes = await readFile(h.path), rows = await ledger(h), sequence = h.journal.sequence;
    await assert.rejects(h.broker.recover(), e => e?.code === 'JOURNAL_STATE_INVALID' && e.exitCode === 4 && !(e instanceof TypeError));
    assert.deepEqual(h.broker.snapshot(), installed); assert.deepEqual(await readFile(h.path), bytes);
    assert.equal(h.journal.sequence, sequence); assert.equal(installed.requests[0].request_id, created.request.request_id);
    await h.close(); const reopened = await Journal.open(h.path);
    try { assert.deepEqual((await reopened.recover()).transactions, rows); assert.deepEqual(await readFile(h.path), bytes); }
    finally { await reopened.close(); }
  }));
