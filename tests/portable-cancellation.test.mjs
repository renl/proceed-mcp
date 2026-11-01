// TEST ONLY: design 3/4/6/7. Synthetic pairing is setup, never a human decision.
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { storageFailure } from '../src/errors.js';
import { bounded } from './support/managed-spike.mjs';
import { publicRegistration, success, toolError } from './support/public-registration.mjs';

const at = Date.parse('2026-11-01T00:01:00Z'), iso = n => new Date(n).toISOString();
const decision = n => `dec_${n.toString(16).padStart(32, '0')}`;
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const captured = p => p.then(value => ({ value }), error => ({ error }));
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const invalidHistory = e => e?.exitCode === 4 && e.code === 'JOURNAL_STATE_INVALID' && !(e instanceof TypeError);
const mutations = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const binding = p => ({ ownerId: 'shared', capability: p.request_capability, requestId: p.request_id });
const args = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const closure = (p, n = 1, extra = {}) => ({ op: 'request.cancel', request_id: p.request_id,
  resolved_at: iso(at), decision_id: decision(n), delivery_state: 'unavailable', ...extra });
async function native(work) {
  const root = resolve('.scratch/cancellation'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let j, b, file, samples = 0, ids = 0, appends = 0;
  const h = { now: at, sync: async () => {}, generate: () => decision(++ids),
    get b() { return b; }, get j() { return j; }, counts: () => ({ samples, ids, appends }),
    bytes: () => readFile(path), async reopen() { await b.close(); await j.close(); await start(); } };
  async function start() {
    const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
    file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, sequence);
    b = createPortableBroker({ journal: { recover: () => j.recover(), append: m => { appends++; return j.append(m); } },
      owners: [{ owner_id: 'shared', label: 'Display only' }, { owner_id: 'foreign', label: 'Other' }], port: 43189,
      clock: () => { samples++; if (h.now instanceof Error) throw h.now; return h.now; }, generateDecisionId: () => h.generate() });
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
    h.cancel = (p = h.p[0], extra = {}) => Promise.resolve().then(() => b.cancelRequest({ ...binding(p), ...extra }));
    await work(h);
  } finally {
    try { await b?.close(); await j?.close(); } finally {
      await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' });
    }
  }
}
test('CANCEL-CAL: actual paired replay, creation, expiry and ordinary reopen calibrate fixture', { timeout: 10000 }, () => native(async h => {
  assert.equal(h.b.snapshot().requests.length, 2); h.now = at + 60000;
  const v = await h.b.readRequest(binding(h.p[0])); assert.equal(v.resolution, 'expired');
  await h.reopen(); assert.deepEqual(await h.b.readRequest(binding(h.p[0])), v);
}));
test('CANCEL-WRITE: concurrent single winner, exact mutation, copied view, clock-free terminal repeat/reopen', { timeout: 10000 }, () => native(async h => {
  const before = h.b.snapshot().requests[0], counts = h.counts();
  const [a, b] = await Promise.all([h.cancel(), h.cancel()]); assert.deepEqual(a, b);
  assert.deepEqual(a, { ...before, resolution: 'cancelled', resolved_at: iso(at), decision_id: decision(1), delivery_state: 'unavailable' });
  assert.deepEqual(h.counts(), { samples: counts.samples + 1, ids: counts.ids + 1, appends: counts.appends + 1 });
  assert.deepEqual(mutations(await h.bytes()).at(-1), closure(h.p[0]));
  a.event_capability.reason = 'mutated'; assert.deepEqual(await h.cancel(), b);
  const bytes = await h.bytes(), c = h.counts(); h.now = new Error('must not sample terminal');
  assert.deepEqual(await h.cancel(), b); assert.deepEqual(h.counts(), c); assert.deepEqual(await h.bytes(), bytes);
  h.now = at + 90000; await h.reopen(); assert.deepEqual(await h.cancel(), b);
}));
for (const offset of [59999, 60000, 60001]) test(`CANCEL-DEADLINE-${offset}: serialized expiry wins at equality`, { timeout: 10000 }, () => native(async h => {
  h.now = at + offset; const value = await h.cancel();
  assert.equal(value.resolution, offset < 60000 ? 'cancelled' : 'expired');
  assert.equal(value.resolved_at, iso(h.now)); assert.equal(value.delivery_state, 'unavailable');
  assert.equal(mutations(await h.bytes()).at(-1).op, offset < 60000 ? 'request.cancel' : 'request.expire');
  const bytes = await h.bytes(); h.now += 999999; assert.deepEqual(await h.cancel(), value); assert.deepEqual(await h.bytes(), bytes);
}));
test('CANCEL-ORDER: actual sync blocks installation; denials bypass queue/time; clock sampled inside turn', { timeout: 10000 }, () => native(async h => {
  const entered = gate(), release = gate(), before = h.b.snapshot(); let settled = false;
  h.sync = async () => { entered.release(); await release.promise; };
  const first = captured(h.cancel()); first.then(() => { settled = true; });
  try {
    await bounded(() => Promise.race([entered.promise, first.then(r => { if (r.error) throw r.error; })]), 1500, 'sync entry');
    assert.equal(settled, false); assert.deepEqual(h.b.snapshot(), before); const counts = h.counts();
    for (const extra of [{ ownerId: undefined }, { ownerId: 'foreign' }, { capability: undefined },
      { capability: h.p[1].request_capability }, { requestId: undefined }, { requestId: 'bad' }, { requestId: `req_${'0'.repeat(32)}` }])
      assert.equal(await bounded(() => h.cancel(h.p[0], extra), 1000, 'denial before release'), null);
    assert.deepEqual(h.counts(), counts);
    const follower = captured(h.cancel(h.p[1])); h.now = at + 60000; release.release();
    assert.equal((await first).value.resolution, 'cancelled'); assert.equal((await follower).value.resolution, 'expired');
    assert.equal(await h.cancel(h.p[2]), null, 'unused reservation is not actionable');
  } finally { release.release(); await first; }
}));
test('CANCEL-FAULT: sync rejection installs nothing, fences queued/fresh work, actual surviving frame recovers once', { timeout: 10000 }, () => native(async h => {
  const entered = gate(), release = gate(), before = h.b.snapshot();
  h.sync = async () => { entered.release(); await release.promise; throw storageFailure('synthetic sync refusal'); };
  const first = captured(h.cancel()); let queued;
  try {
    await bounded(() => Promise.race([entered.promise, first.then(r => { if (r.error) throw r.error; })]), 1500, 'fault sync entry');
    queued = captured(h.cancel(h.p[1])); const counts = h.counts(); release.release();
    assert.ok(storage((await first).error)); assert.ok(storage((await queued).error));
    await assert.rejects(h.cancel(), storage); assert.deepEqual(h.counts(), counts); assert.deepEqual(h.b.snapshot(), before);
  } finally { release.release(); await first; if (queued) await queued; }
  h.sync = async () => {}; await h.reopen(); const v = await h.cancel();
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.decision_id, decision(1));
  assert.equal(mutations(await h.bytes()).filter(m => m.op === 'request.cancel').length, 1);
}));
test('CANCEL-CLOCK-ID: invalid time/identity and global collision refuse before append', { timeout: 10000 }, () => native(async h => {
  for (const now of [at - 1, NaN, 'bad', new Error('clock')]) {
    const bytes = await h.bytes(), before = h.b.snapshot(); h.now = now;
    await assert.rejects(h.cancel(), storage); assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before);
  }
  h.now = at;
  for (const value of [null, [decision(1)], 'bad']) {
    h.generate = () => value; const bytes = await h.bytes(); await assert.rejects(h.cancel(), storage); assert.deepEqual(await h.bytes(), bytes);
  }
  h.generate = () => decision(1); await h.cancel(); const bytes = await h.bytes();
  await assert.rejects(h.cancel(h.p[1]), e => e.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION');
  assert.deepEqual(await h.bytes(), bytes);
}));
// Global means across producers AND owners, live and recovered; disjoint per-op sets fail.
for (const first of ['expire', 'cancel']) for (const mode of ['writer-live', 'writer-recovered', 'replay'])
  for (const collide of [false, true]) test(`CANCEL-GLOBAL-${first}-${mode}-${collide ? 'collision' : 'valid'}`, { timeout: 10000 }, () => native(async h => {
    h.now = at + 30000;
    const other = await h.b.reserveHandle({ ownerId: 'foreign' });
    await h.b.createRequest({ ownerId: 'foreign', capability: other.request_capability,
      requestHandle: other.request_handle, clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
    const foreignBinding = { ...binding(other), ownerId: 'foreign' };
    const second = first === 'expire' ? 'cancel' : 'expire';
    h.now = first === 'expire' ? at + 60000 : at + 30000;
    const initial = first === 'expire' ? await h.b.readRequest(binding(h.p[0])) : await h.cancel();
    assert.equal(initial.resolution, first === 'expire' ? 'expired' : 'cancelled');
    const actual = mutations(await h.bytes()).at(-1);
    assert.equal(actual.op, `request.${first}`); assert.equal(actual.request_id, h.p[0].request_id);
    assert.equal(actual.decision_id, initial.decision_id, 'unmodified actual production record supplies reused ID');
    if (mode === 'writer-recovered') await h.reopen();
    assert.equal(h.b.snapshot().requests.find(p => p.request_id === other.request_id).resolution, 'pending');
    h.now = second === 'expire' ? at + 90000 : at + 60000;
    const nextId = collide ? actual.decision_id : decision(99);
    const installed = h.b.snapshot(), bytes = await h.bytes(), counts = h.counts();
    if (mode !== 'replay') {
      h.generate = () => nextId;
      const act = () => second === 'expire' ? h.b.readRequest(foreignBinding) : h.cancel(other, { ownerId: 'foreign' });
      if (collide) {
        await assert.rejects(act(), e => e?.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION');
        assert.deepEqual(h.b.snapshot(), installed); assert.deepEqual(await h.bytes(), bytes);
        assert.equal(h.counts().appends, counts.appends, 'collision refused before append');
      } else {
        const v = await act(); assert.equal(v.resolution, second === 'expire' ? 'expired' : 'cancelled');
        assert.equal(v.decision_id, nextId); assert.equal(mutations(await h.bytes()).at(-1).op, `request.${second}`);
        await h.reopen(); assert.deepEqual(await h.b.readRequest(foreignBinding), v);
      }
    } else {
      // Decoder-only input, never claimed as actual second-producer writer proof.
      await h.j.append([closure(other, 99, { op: `request.${second}`, resolved_at: iso(h.now), decision_id: nextId })]);
      const history = await h.bytes(), samples = h.counts().samples;
      if (collide) {
        await assert.rejects(h.b.recover(), invalidHistory); assert.deepEqual(h.b.snapshot(), installed);
        await assert.rejects(h.cancel(other, { ownerId: 'foreign' }), storage);
      } else {
        await h.b.recover(); const v = h.b.snapshot().requests.find(p => p.request_id === other.request_id);
        assert.equal(v.resolution, second === 'expire' ? 'expired' : 'cancelled'); assert.equal(v.decision_id, nextId);
      }
      assert.equal(h.counts().samples, samples, 'mixed replay and fenced refusal are clock-free');
      assert.deepEqual(await h.bytes(), history);
    }
  }));
test('CANCEL-NOFRAME: pre-write rejection fences without inventing rollback; reopen permits explicit new cancellation', { timeout: 10000 }, () => native(async h => {
  const before = h.b.snapshot(), bytes = await h.bytes(), append = h.j.append.bind(h.j);
  h.j.append = async () => { throw storageFailure('synthetic pre-write refusal'); };
  await assert.rejects(h.cancel(), storage); assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.bytes(), bytes);
  h.j.append = append; await assert.rejects(h.cancel(h.p[1]), storage);
  await h.reopen(); assert.equal((await h.cancel()).resolution, 'cancelled');
  assert.equal(mutations(await h.bytes()).filter(m => m.op === 'request.cancel').length, 1);
}));
test('CANCEL-REPLAY: strict valid pending/unavailable UTC spellings then invalid-history fail-closed matrix', { timeout: 20000 }, async t => {
  const cases = [];
  for (const key of ['request_id', 'resolved_at', 'decision_id', 'delivery_state']) {
    for (const value of [null, 1, true, {}, [], 'bad']) cases.push([`${key}:${JSON.stringify(value)}`, m => ({ ...m, [key]: value })]);
    cases.push([`${key}:coercible array`, m => ({ ...m, [key]: [m[key]] })], [`missing ${key}`, m => { delete m[key]; return m; }]);
  }
  cases.push(['null mutation', () => null], ['array mutation', m => [m]], ['missing op', m => { delete m.op; return m; }],
    ['op array', m => ({ ...m, op: ['request.cancel'] })], ['unknown op', m => ({ ...m, op: 'request.cancelled' })],
    ['extra field', m => ({ ...m, response_text: 'yes' })], ['before creation', m => ({ ...m, resolved_at: iso(at - 1) })],
    ['at deadline', m => ({ ...m, resolved_at: iso(at + 60000) })], ['nonUTC', m => ({ ...m, resolved_at: '2026-11-01T01:01:00+01:00' })],
    ['bad calendar', m => ({ ...m, resolved_at: '2026-02-30T00:00:00Z' })], ['unknown target', m => ({ ...m, request_id: `req_${'0'.repeat(32)}` })],
    ['unknown offset', m => ({ ...m, resolved_at: '2026-11-01T00:01:00-00:00' })],
    ['after deadline submillisecond', m => ({ ...m, resolved_at: '2026-11-01T00:02:00.0000001Z' })],
    ['before creation submillisecond', m => ({ ...m, resolved_at: '2026-11-01T00:00:59.9999999Z' })],
    ['terminal target', (m, h) => ({ ...m, request_id: h.p[0].request_id })], ['global decision reuse', m => ({ ...m, decision_id: decision(1) })]);
  for (const [name, change] of cases) await t.test(name, () => native(async h => {
    const good = closure(h.p[0], 1, { resolved_at: '2026-11-01T00:01:00.000000+00:00', delivery_state: 'pending' });
    await h.j.append([good]); const count = h.counts().samples; await h.b.recover();
    assert.equal(h.counts().samples, count); assert.equal(h.b.snapshot().requests[0].delivery_state, 'pending', 'future waiter vocabulary remains valid');
    const installed = h.b.snapshot(); await h.j.append([change(closure(h.p[1], 2), h)]); const bytes = await h.bytes();
    await assert.rejects(h.b.recover(), invalidHistory); assert.deepEqual(h.b.snapshot(), installed); assert.deepEqual(await h.bytes(), bytes);
    await assert.rejects(h.cancel(h.p[1]), storage);
  }));
});
test('CANCEL-REPLAY-VALID: unavailable submillisecond predeadline retained, repeat mutation invalid', { timeout: 10000 }, () => native(async h => {
  const m = closure(h.p[0], 1, { resolved_at: '2026-11-01T00:01:59.9999999Z' }); await h.j.append([m]);
  await h.b.recover(); const v = h.b.snapshot().requests[0]; assert.equal(v.resolved_at, m.resolved_at);
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'unavailable');
  await h.j.append([m]); const bytes = await h.bytes(); await assert.rejects(h.b.recover(), invalidHistory);
  assert.deepEqual(h.b.snapshot().requests[0], v); assert.deepEqual(await h.bytes(), bytes);
}));

const publicOptions = { timeout: 60000 }, fixture = work => publicRegistration(work, { paired: true, foreign: true });
const header = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
async function http(h, p, { token = h.owner, headers = header(p), body = '{}', suffix = 'cancel' } = {}) {
  const r = await h.http(`/v1/requests/${p.request_id}/${suffix}`, token, { method: 'POST', headers, body });
  return { status: r.status, body: await r.json() };
}
async function setup(h) {
  await h.restart(); const a = await h.connect(), p = success(await a.call('prepare_approval'));
  h.requestSecrets.push(p.request_capability);
  const r = await h.http('/v1/requests', h.owner, { method: 'POST', headers: header(p), body: JSON.stringify({
    request_handle: p.request_handle, client_request_id: 'same', action: 'Question?', context: '' }) });
  assert.equal(r.status, 201); return { a, p, initial: await r.json() };
}
test('CANCEL-PUBLIC: actual HTTP creation/cancel/repeat + MCP observation, restart stable decision, no receipt', publicOptions, () => fixture(async h => {
  const { a, p, initial } = await setup(h); await h.eof(a);
  const r = await http(h, p); assert.equal(r.status, 200, 'registration-free cancellation must be enabled'); const v = r.body;
  assert.match(v.decision_id, /^dec_[a-f0-9]{32}$/); assert.ok(Date.parse(v.resolved_at) >= Date.parse(initial.created_at));
  assert.deepEqual(v, { ...initial, resolution: 'cancelled', resolved_at: v.resolved_at, decision_id: v.decision_id, delivery_state: 'unavailable' });
  const bytes = await h.journal(); assert.deepEqual(await http(h, p), r); assert.deepEqual(await h.journal(), bytes);
  await h.restart(); const replacement = await h.connect();
  assert.deepEqual(success(await replacement.call('cancel_approval', args(p))), v);
  assert.deepEqual(success(await replacement.call('get_approval', args(p))), v);
  assert.deepEqual(await h.journal(), bytes); await h.eof(replacement);
}));
test('CANCEL-MCP: real created pending request resolves through original cancel RPC; catalogue truthful', publicOptions, () => fixture(async h => {
  const { a, p } = await setup(h), v = success(await a.call('cancel_approval', args(p)));
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'unavailable');
  toolError(await a.call('cancel_approval', { request_id: p.request_id }), 'INVALID_ARGUMENT');
  const foreign = await h.connect('foreign'); toolError(await foreign.call('cancel_approval', args(p)), 'NOT_FOUND'); await h.eof(foreign);
  for (const text of [a.init.instructions, a.tools.find(t => t.name === 'cancel_approval').description])
    assert.doesNotMatch(text, /\b(?:cancel_approval|cancellation) (?:is |remains )?(?:not enabled|unavailable|returns NOT_FOUND for every call)/i);
  const bytes = await h.journal(); toolError(await a.call('acknowledge_approval', { ...args(p), decision_id: decision(999) }), 'DECISION_MISMATCH');
  toolError(await a.call('request_approval', { request_handle: p.request_handle, request_capability: p.request_capability,
    client_request_id: 'same', action: 'Question?', context: '' }), 'ENHANCEMENT_UNAVAILABLE');
  for (const [suffix, status] of [['wait', 401], ['returned', 401], ['acknowledge', 400]]) assert.equal((await http(h, p, { suffix })).status, status);
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}));
test('CANCEL-AUTH: public browser/Bearer/role/body precedence and uniform request denial without mutation', publicOptions, () => fixture(async h => {
  const { a, p } = await setup(h), unused = success(await a.call('prepare_approval')); h.requestSecrets.push(unused.request_capability);
  const bytes = await h.journal();
  for (const [options, status, code] of [[{ token: null, headers: { origin: 'https://browser.invalid' }, body: '{' }, 403, 'FORBIDDEN'],
    [{ token: null, body: '{' }, 401, 'AUTH_REQUIRED'], [{ token: h.control, body: '{' }, 403, 'FORBIDDEN'],
    ...['{', '[]', 'null', '{"owner_id":"shared"}', '{"request_capability":"bad"}', JSON.stringify({ extra: 'x'.repeat(65536) })]
      .map(body => [{ body }, 400, 'INVALID_ARGUMENT'])]) {
    const r = await http(h, p, options); assert.equal(r.status, status); assert.equal(r.body.error.code, code);
  }
  for (const [target, options] of [[p, { headers: {} }], [p, { headers: header(unused) }], [p, { token: h.secrets[2] }],
    [unused, {}], [{ ...p, request_id: `req_${'0'.repeat(32)}` }, {}]]) {
    const r = await http(h, target, options); assert.deepEqual(r, { status: 404,
      body: { schema_version: 1, error: { code: 'NOT_FOUND', message: 'no such request', retryable: false } } });
  }
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}));
