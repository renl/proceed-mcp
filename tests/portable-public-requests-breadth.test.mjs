// TEST ONLY: design 3/4/7. Real production HTTP/core/Journal composition, no cadence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';

const opts = { timeout: 20000 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const rows = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const denied = { status: 404, body: { schema_version: 1, error: { code: 'NOT_FOUND', message: 'no such request', retryable: false } } };
const storage = { status: 500, body: { schema_version: 1, error: { code: 'STORAGE_FAILURE', message: 'the broker could not complete the request', retryable: false } } };
const capHeader = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
const input = p => ({ request_handle: p.request_handle, client_request_id: 'key', action: 'Question?', context: '', expires_in_seconds: 60 });
function error(r, status, code) {
  assert.equal(r.status, status); assert.equal(r.body.schema_version, 1);
  assert.equal(r.body.error.code, code); assert.equal(r.body.error.retryable, code === 'BROKER_NOT_READY');
}

async function fixture(work, { paired = true, ready = true } = {}) {
  const result = await managed(async ctx => {
    const path = join(ctx.directory, 'journal.log'), port = await freePort();
    const owner = '1'.repeat(64), foreign = '2'.repeat(64), control = '3'.repeat(64), secrets = [owner, foreign, control];
    let now = Date.parse('2026-11-01T12:00:00.000Z'), samples = 0;
    const seed = await Journal.open(path);
    try {
      if (paired) {
        const at = '2026-01-01T00:00:00.000Z', hash = 'a'.repeat(64);
        await seed.append([{ op: 'pairing.challenge', hash, created_at: at, expires_at: '2026-01-01T00:05:00.000Z' }]);
        await seed.append([{ op: 'pairing.challenge.consume', hash, consumed_at: at },
          { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: at } }]);
      }
    } finally { await seed.close(); }
    const recovered = await Journal.open(path), seq = recovered.sequence; await recovered.close();
    const fh = await open(path, 'a'); let writeHook = async () => {}, syncHook = async () => {}, writes = 0, syncs = 0;
    const j = new Journal(path, {
      write: async (...args) => { writes++; await writeHook(); return fh.write(...args); },
      sync: async () => { syncs++; await syncHook(); return fh.sync(); }, close: () => fh.close(),
    }, seq);
    let b, server; const pending = [], releases = [], logs = [], sockets = new Set(), rejections = [], warnings = [];
    const onRejection = e => rejections.push(e), onWarning = e => warnings.push(e);
    process.on('unhandledRejection', onRejection); process.on('warning', onWarning);
    // All HTTP promises acquire a rejection observer immediately, before any held admission.
    const raw = (method, route, body, { token = owner, headers = {}, onHeaders = () => {} } = {}) => {
      const bytes = body === undefined ? undefined : Buffer.from(body);
      const promise = new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, method, path: route, headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          ...(bytes === undefined ? {} : { 'content-length': bytes.length }), ...headers,
        } }, res => {
          onHeaders(); const chunks = []; let size = 0;
          res.on('data', chunk => { size += chunk.length; if (size > 65536) res.destroy(new Error('response overflow')); else chunks.push(chunk); });
          res.on('error', reject); res.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString();
              assert.ok(secrets.every(s => !text.includes(s)), 'ordinary HTTP response discloses no authority');
              assert.doesNotMatch(text, /capability_hash|pairing_snapshot|registration_secret/);
              resolve({ status: res.statusCode, body: JSON.parse(text) });
            } catch (e) { reject(e); }
          });
        });
        req.on('socket', socket => {
          if (!sockets.has(socket)) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }
        });
        req.on('error', reject); req.setTimeout(3500, () => req.destroy(new Error('HTTP deadline'))); req.end(bytes);
      });
      promise.catch(() => {}); pending.push(promise); return promise;
    };
    const post = (p, body = input(p), options = {}) => raw('POST', '/v1/requests', JSON.stringify(body), { headers: capHeader(p), ...options });
    const get = (p, options = {}) => raw('GET', `/v1/requests/${p.request_id}`, undefined, { headers: capHeader(p), ...options });
    const reserve = async (label = 'Breadth') => {
      // Reservation alone intentionally returns its one-time authority. Observe it separately.
      const r = await raw('POST', '/v1/handles', JSON.stringify({ session_label: label }));
      assert.equal(r.status, 201); const p = r.body;
      assert.ok(/^cap_[a-f0-9]{64}$/.test(p.request_capability), 'well-formed preparation authority');
      secrets.push(p.request_capability); return p;
    };
    try {
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'Breadth' }, { owner_id: 'b', label: 'Foreign' }], port,
        clock: () => { samples++; return now; } });
      await b.recover();
      server = createPortableServer({ broker: b, port, credentials: { control, owners: new Map([['a', owner], ['b', foreign]]) }, logger: line => logs.push(line) });
      await server.listen(); if (ready) server.markReady();
      await work({ raw, post, get, reserve, owner, foreign, control, b, j, fh, logs,
        bytes: () => readFile(path), due: () => { now += 60000; }, markReady: () => server.markReady(),
        counts: () => ({ samples, writes, syncs }), write: fn => { writeHook = fn; }, sync: fn => { syncHook = fn; },
        gate: stage => { const entered = deferred(), release = deferred(); releases.push(release.resolve);
          const hook = async () => { entered.resolve(); await release.promise; };
          if (stage === 'append') writeHook = hook; else syncHook = hook;
          return { entered, release }; } });
    } finally {
      for (const release of releases) release();
      await Promise.allSettled(pending);
      try { await server?.close(); } finally {
        try { await b?.close(); } finally {
          await j.close(); process.off('unhandledRejection', onRejection); process.off('warning', onWarning);
        }
      }
      await assert.rejects(fh.stat(), { code: 'EBADF' });
      await bounded(async () => { while (sockets.size) await delay(5); }, 1000, 'HTTP sockets released');
      const probe = createServer();
      await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
      assert.ok(logs.every(line => secrets.every(s => !line.includes(s))), 'shutdown-inclusive log privacy');
      assert.deepEqual(rejections, [], 'prearmed unhandled rejection observer'); assert.deepEqual(warnings, [], 'no resource warnings');
    }
  }, { totalMs: 15000 });
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}

test('B-DUE: denied/conflicting due work never expires; identical replay closes durably; GET targets only itself', opts, () => fixture(async h => {
  const a = await h.reserve(), b = await h.reserve(), unused = await h.reserve();
  for (const p of [a, b]) assert.equal((await h.post(p)).status, 201);
  h.due(); const before = await h.bytes(), counts = h.counts();
  for (const [token, headers] of [[h.owner, {}], [h.foreign, capHeader(a)], [h.owner, capHeader(unused)]]) {
    assert.deepEqual(await h.post(a, input(a), { token, headers }), denied);
    assert.deepEqual(await h.get(a, { token, headers }), denied);
  }
  for (const delta of [{ client_request_id: 'changed' }, { action: 'Different' }, { context: 'x' }, { expires_in_seconds: 61 }])
    error(await h.post(a, { ...input(a), ...delta }), 409, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(h.counts(), counts, 'denials/conflicts do not even sample time or invoke storage');
  assert.deepEqual(await h.bytes(), before);
  const read = await h.get(b); assert.equal(read.status, 200); assert.equal(read.body.resolution, 'expired');
  assert.equal(h.b.snapshot().requests.find(r => r.request_id === a.request_id).resolution, 'pending');
  assert.deepEqual(rows(await h.bytes()).filter(m => m.op === 'request.expire').map(m => m.request_id), [b.request_id]);
  const replay = await h.post(a); assert.equal(replay.status, 200); assert.equal(replay.body.resolution, 'expired');
  assert.match(replay.body.decision_id, /^dec_[a-f0-9]{32}$/); assert.equal(replay.body.delivery_state, 'unavailable');
  const terminal = await h.bytes(); assert.deepEqual(await h.get(a), replay); assert.deepEqual(await h.post(a), replay);
  assert.deepEqual(await h.bytes(), terminal); assert.equal(rows(terminal).filter(m => m.op === 'request.expire').length, 2);
}));

test('B-ORDER: browser before reachable not-ready guard before Bearer, then role/input/authority/pairing', opts, () => fixture(async h => {
  error(await h.raw('POST', '/v1/requests', '{', { token: null, headers: { origin: 'https://browser.invalid' } }), 403, 'FORBIDDEN');
  error(await h.raw('POST', '/v1/requests', '{', { token: null }), 503, 'BROKER_NOT_READY');
  error(await h.raw('GET', '/v1/requests/bad', '{', { token: h.control }), 503, 'BROKER_NOT_READY');
  h.markReady();
  for (const method of ['POST', 'GET']) {
    const path = method === 'POST' ? '/v1/requests' : '/v1/requests/bad';
    error(await h.raw(method, path, '{', { token: null }), 401, 'AUTH_REQUIRED');
    error(await h.raw(method, path, '{', { token: h.control }), 403, 'FORBIDDEN');
  }
  const p = await h.reserve(), before = await h.bytes();
  error(await h.post(p, { ...input(p), action: '' }, { headers: {} }), 400, 'INVALID_ARGUMENT');
  assert.deepEqual(await h.post(p, input(p), { headers: {} }), denied);
  error(await h.post(p), 503, 'NOT_PAIRED'); assert.deepEqual(await h.bytes(), before);
}, { paired: false, ready: false }));

test('B-INPUT: independent public JSON, exact 64KiB, extras, required caller/key/text/scalar/duration matrix', opts, () => fixture(async h => {
  const p = await h.reserve(), before = await h.bytes();
  for (const body of ['{', 'null', '[]', 'true', '1', '"text"'])
    error(await h.raw('POST', '/v1/requests', body, { headers: capHeader(p) }), 400, 'INVALID_ARGUMENT');
  const invalid = [];
  for (const field of ['client_request_id', 'action', 'context']) {
    const absent = input(p); delete absent[field]; invalid.push(absent);
    for (const v of [null, 0, false, [], {}]) invalid.push({ ...input(p), [field]: v });
  }
  for (const field of ['owner_id', 'session_label', 'request_id', 'request_capability', 'resolution', 'telegram_state', '__proto__'])
    invalid.push({ ...input(p), [field]: 'forbidden' });
  for (const client_request_id of ['', 'a'.repeat(129), 'a b', 'é', 'a\n', '😀']) invalid.push({ ...input(p), client_request_id });
  for (const action of ['', 'x'.repeat(1001), '😀'.repeat(1001), '\ud800', '\udc00']) invalid.push({ ...input(p), action });
  for (const context of ['x'.repeat(1001), '😀'.repeat(1001), '\ud800', '\udc00']) invalid.push({ ...input(p), context });
  for (const expires_in_seconds of [null, 0, 59, 86401, 60.5, '60', true, [], {}]) invalid.push({ ...input(p), expires_in_seconds });
  for (const body of invalid) {
    // Each input fails with valid authority, then independently proves input precedes failed authority.
    error(await h.post(p, body), 400, 'INVALID_ARGUMENT');
    error(await h.post(p, body, { headers: {} }), 400, 'INVALID_ARGUMENT');
  }
  for (const request_handle of [undefined, null, '', 'bad', 1, [], {}, `hdl_${'0'.repeat(32)}`])
    assert.deepEqual(await h.post(p, { ...input(p), request_handle }), denied);
  assert.deepEqual(await h.bytes(), before);
  const serialized = JSON.stringify({ ...input(p), action: '😀' }), exact = serialized + ' '.repeat(65536 - Buffer.byteLength(serialized));
  assert.equal(Buffer.byteLength(exact), 65536);
  const accepted = await h.raw('POST', '/v1/requests', exact, { headers: capHeader(p) }); assert.equal(accepted.status, 201);
  const bytes = await h.bytes();
  error(await h.raw('POST', '/v1/requests', exact + ' ', { headers: capHeader(p) }), 400, 'INVALID_ARGUMENT');
  assert.deepEqual(await h.bytes(), bytes, 'one extra UTF-8 byte rejected before identical replay');
  // A GET body is intentionally NOT parsed; no registration header or HTTP registration was made.
  assert.deepEqual(await h.raw('GET', `/v1/requests/${p.request_id}`, '{', { headers: capHeader(p) }), { status: 200, body: accepted.body });
}));

test('B-VALID: scalar limits, exact text/key preservation and default/min/max durations admitted publicly', opts, () => fixture(async h => {
  for (const duration of [undefined, 60, 86400]) {
    const p = await h.reserve('😀'.repeat(128)), body = { ...input(p), client_request_id: 'A_0-'.repeat(32), action: '😀'.repeat(1000),
      context: 'x'.repeat(1000), expires_in_seconds: duration };
    const r = await h.post(p, body); assert.equal(r.status, 201);
    assert.equal(r.body.action, body.action); assert.equal(r.body.context, body.context); assert.equal(r.body.client_request_id, body.client_request_id);
    assert.equal(Date.parse(r.body.expires_at) - Date.parse(r.body.created_at), (duration ?? 3600) * 1000);
    assert.deepEqual(await h.post(p, { ...body, expires_in_seconds: duration ?? 3600 }), { status: 200, body: r.body });
  }
  const p = await h.reserve(), body = { ...input(p), action: ' \nÉé<&>😀 ', context: '\n ' };
  const r = await h.post(p, body); assert.equal(r.status, 201); assert.equal(r.body.action, body.action); assert.equal(r.body.context, body.context);
}));

test('B-AUTHORITY: unused/unknown/malformed/cross-bound authority all give exactly the same public denial', opts, () => fixture(async h => {
  const p = await h.reserve(), q = await h.reserve(), unused = await h.reserve();
  for (const a of [p, q]) assert.equal((await h.post(a)).status, 201);
  const before = await h.bytes(), counts = h.counts();
  for (const [token, headers] of [[h.owner, {}], [h.owner, { 'X-Proceed-Request-Capability': 'bad' }],
    [h.owner, { 'X-Proceed-Request-Capability': `cap_${'0'.repeat(64)}` }],
    [h.owner, capHeader(q)], [h.foreign, capHeader(p)]]) {
    assert.deepEqual(await h.post(p, input(p), { token, headers }), denied);
    assert.deepEqual(await h.get(p, { token, headers }), denied);
  }
  for (const request_id of [unused.request_id, `req_${'0'.repeat(32)}`, 'bad'])
    assert.deepEqual(await h.get({ ...p, request_id }), denied);
  assert.deepEqual(await h.get(unused), denied);
  assert.deepEqual(await h.post(p, { ...input(p), request_handle: q.request_handle }), denied);
  // Independent controls ensure neither general read/creation refusal nor missing pairing masks the matrix.
  assert.deepEqual(await h.get(p, { headers: { ...capHeader(p), 'X-Proceed-Registration': 'irrelevant' } }), await h.get(p));
  assert.equal((await h.post(p)).status, 200);
  assert.deepEqual(await h.bytes(), before);
  assert.equal(h.counts().writes, counts.writes); assert.equal(h.counts().syncs, counts.syncs);
}));

// Independent full-message arithmetic, not a renderer/measurement call as expected-value oracle.
function worstLength(p, label, action, context) {
  const message = [`Approval request ${p.request_id}`, '', 'Owner: a',
    `Caller-supplied context (display only, not verified identity): ${label}`, `Action: ${action}`,
    `Context: ${context || '(none)'}`, 'Expires: 2026-11-01T12:01:00.000Z',
    'Resolution: responded (instructions only)', 'Delivery: unavailable'].join('\n');
  const prompt = [`Respond to request ${p.request_id}`, '', 'Reply to this message with instructions for this request only.',
    'Your reply is instructions, not approval: any action that still needs approval', 'requires a separate request.'].join('\n');
  return Math.max(message.length, prompt.length);
}
test('B-RENDER: complete bound includes label, disclaimers, separators and worst terminal state; 4096 vs 4097', opts, () => fixture(async h => {
  const label = '😀'.repeat(128), action = '😀'.repeat(1000), p = await h.reserve(label), q = await h.reserve(label);
  const overhead = worstLength(p, label, action, 'x') - 1, units = 4096 - overhead;
  const context = '😀'.repeat(Math.floor(units / 2)) + (units % 2 ? 'x' : '');
  assert.ok([...context].length < 1000); assert.equal(worstLength(p, label, action, context), 4096);
  assert.equal(worstLength(q, label, action, context + 'x'), 4097);
  const before = await h.bytes(); error(await h.post(q, { ...input(q), action, context: context + 'x' }), 400, 'INVALID_ARGUMENT');
  assert.deepEqual(await h.bytes(), before); assert.equal((await h.post(p, { ...input(p), action, context })).status, 201);
}));

for (const stage of ['append', 'sync']) for (const operation of ['create', 'replay', 'read'])
  test(`B-GATE-${stage}-${operation}: no HTTP headers/success or installed state before actual storage gate`, opts, () => fixture(async h => {
    const p = await h.reserve();
    if (operation !== 'create') { assert.equal((await h.post(p)).status, 201); h.due(); }
    const before = await h.bytes(), counts = h.counts(), gate = h.gate(stage); let headers = 0, settled = false;
    const options = { onHeaders: () => { headers++; } };
    const pending = operation === 'read' ? h.get(p, options) : h.post(p, input(p), options);
    pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await bounded(() => gate.entered.promise, 1500, 'actual append/sync gate reached');
      await delay(40); assert.equal(headers, 0); assert.equal(settled, false);
      assert.equal(h.counts().writes, counts.writes + 1);
      if (stage === 'append') assert.deepEqual(await h.bytes(), before);
      else { assert.equal(h.counts().syncs, counts.syncs + 1); assert.notDeepEqual(await h.bytes(), before); }
      const stored = h.b.snapshot().requests.find(r => r.request_id === p.request_id);
      assert.equal(stored?.resolution, operation === 'create' ? undefined : 'pending');
    } finally { gate.release.resolve(); }
    const r = await pending; assert.equal(r.status, operation === 'create' ? 201 : 200);
    assert.equal(r.body.resolution, operation === 'create' ? 'pending' : 'expired'); assert.equal(headers, 1);
    assert.equal(rows(await h.bytes()).filter(m => m.op === (operation === 'create' ? 'request.create' : 'request.expire')).length, 1);
  }));

for (const stage of ['append', 'sync']) for (const operation of ['create', 'replay', 'read'])
test(`B-FENCE-${stage}-${operation}: actual handle failure fences public queued duplicate/unrelated/read; denials still precede refusal`, opts, () => fixture(async h => {
  const p = await h.reserve(), q = await h.reserve();
  if (operation !== 'create') { assert.equal((await h.post(p)).status, 201); h.due(); }
  const gate = h.gate(stage), before = await h.bytes(); let reached = 0;
  const hook = async () => { reached++; gate.entered.resolve(); await gate.release.promise; await h.fh.close(); };
  if (stage === 'append') h.write(hook); else h.sync(hook);
  const leader = operation === 'read' ? h.get(p) : h.post(p);
  await bounded(() => gate.entered.promise, 1500, 'actual failing storage operation');
  let invoked = 0, settled = 0;
  // Arm at the real HTTP-to-core boundary before submitting followers, delegating unchanged methods.
  for (const name of ['createRequest', 'readRequest']) {
    const original = h.b[name].bind(h.b);
    h.b[name] = (...args) => { const promise = original(...args); invoked++; return promise; };
  }
  const followers = [h.post(p), h.post(q), h.get(p)];
  for (const p of followers) p.then(() => { settled++; }, () => { settled++; });
  await bounded(async () => { while (invoked !== 3) await delay(5); }, 1000, 'all public followers reached real core');
  assert.equal(settled, 0, 'all three admitted behind held writer before release');
  assert.deepEqual(await h.get(p, { headers: {} }), denied);
  error(await h.post(q, { ...input(q), action: '' }), 400, 'INVALID_ARGUMENT');
  gate.release.resolve(); assert.deepEqual(await leader, storage);
  for (const r of await Promise.all(followers)) assert.deepEqual(r, storage);
  const counts = h.counts(), bytes = await h.bytes(); assert.equal(reached, 1);
  assert.equal(h.b.snapshot().requests.length, operation === 'create' ? 0 : 1);
  if (operation !== 'create') assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
  for (const r of [await h.post(q), await h.get(p)]) assert.deepEqual(r, storage);
  for (const [token, headers, status, code] of [[null, {}, 401, 'AUTH_REQUIRED'], [h.control, {}, 403, 'FORBIDDEN'],
    [null, { origin: 'https://browser.invalid' }, 403, 'FORBIDDEN']])
    error(await h.raw('POST', '/v1/requests', '{', { token, headers }), status, code);
  error(await h.post(q, { ...input(q), context: null }), 400, 'INVALID_ARGUMENT');
  assert.deepEqual(await h.get(p, { token: h.foreign }), denied); assert.deepEqual(await h.post(q, input(q), { headers: {} }), denied);
  assert.deepEqual(h.counts(), counts); assert.deepEqual(await h.bytes(), bytes);
  if (stage === 'append') assert.deepEqual(bytes, before);
  else { assert.notDeepEqual(bytes, before);
    assert.equal(rows(bytes).filter(m => m.op === (operation === 'create' ? 'request.create' : 'request.expire')).length, 1,
      'complete frame after rejected sync is uncertain, not rolled back'); }
}));
