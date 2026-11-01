// TEST ONLY: design 3/4/6/7. Controlled returned report is NOT an original MCP write.
import assert from 'node:assert/strict';
import test from 'node:test';
import { request, createServer } from 'node:http';
import { open, readFile, mkdir, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { storageFailure } from '../src/errors.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';
import { publicRegistration, success, toolError } from './support/public-registration.mjs';

const opts = { timeout: 30000 }, kinds = ['acknowledge', 'returned'];
const dec = n => `dec_${String(n).padStart(32, '0')}`;
const cap = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
const rows = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const envelope = (status, code, message) => ({ status, body: { schema_version: 1, error: { code, message, retryable: false } } });
const denied = envelope(404, 'NOT_FOUND', 'no such request');
const regDenied = envelope(401, 'AUTH_REQUIRED', 'registration authentication required');
const storage = envelope(500, 'STORAGE_FAILURE', 'the broker could not complete the request');
function error(r, status, code) { assert.equal(r.status, status); assert.equal(r.body.error.code, code); assert.equal(r.body.error.retryable, code === 'BROKER_NOT_READY'); }
async function native(work, { ready = true } = {}) {
  const progressRoot = resolve('.scratch/public-delivery'); await mkdir(progressRoot, { recursive: true });
  await bounded(async () => {
    const result = await managed(async ctx => {
      const path = join(ctx.directory, 'journal.log'), port = await freePort(), owner = '1'.repeat(64), foreign = '2'.repeat(64), control = '3'.repeat(64);
      const progress = phase => appendFile(join(progressRoot, 'progress.log'), `${ctx.directory.split(/[\\/]/).at(-1)} ${phase}\n`);
      let now = Date.parse('2026-11-01T12:00:00Z'), samples = 0, b, j, server, fh, sync = async () => {};
      const releases = [], pending = [], sockets = new Set(), logs = [], secrets = [owner, foreign, control];
      const seed = await Journal.open(path);
      try { const at = '2026-01-01T00:00:00.000Z', hash = 'a'.repeat(64);
        await seed.append([{ op: 'pairing.challenge', hash, created_at: at, expires_at: '2026-01-01T00:05:00.000Z' }]);
        await seed.append([{ op: 'pairing.challenge.consume', hash, consumed_at: at }, { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: at } }]);
      } finally { await seed.close(); }
      const start = async () => {
        const recovered = await Journal.open(path), sequence = recovered.sequence; await recovered.close(); fh = await open(path, 'a');
        j = new Journal(path, { write: (...a) => fh.write(...a), sync: async () => { await sync(); await fh.sync(); }, close: () => fh.close() }, sequence);
        b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'Owner' }, { owner_id: 'b', label: 'Other' }], port, clock: () => { samples++; return now; } });
        await b.recover(); server = createPortableServer({ broker: b, port, clock: () => now,
          credentials: { control, owners: new Map([['a', owner], ['b', foreign]]) }, logger: line => logs.push(line) });
        await server.listen(); if (ready) server.markReady();
      };
      const raw = (path, body = {}, { token = owner, headers = {} } = {}) => {
        const p = new Promise((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers } }, res => {
            const chunks = []; let size = 0;
            res.on('data', c => { size += c.length; if (size > 65536) res.destroy(new Error('response bound')); else chunks.push(c); });
            res.on('error', reject); res.on('end', () => { try { assert.equal(res.headers['access-control-allow-origin'], undefined); resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (e) { reject(e); } });
          });
          sockets.add(req); req.on('close', () => sockets.delete(req)); req.on('error', reject);
          req.setTimeout(2500, () => req.destroy(new Error('HTTP deadline'))); req.end(typeof body === 'string' ? body : JSON.stringify(body));
        }); p.catch(() => {}); pending.push(p); return p;
      };
      const register = async () => { const r = await raw('/v1/adapter'); assert.equal(r.status, 201); secrets.push(r.body.registration_secret); return r.body; };
      const call = (k, p, d, r, options = {}) => raw(`/v1/requests/${p.request_id}/${k}`,
        { ...(k === 'returned' ? { registration_id: r?.registration_id } : {}), decision_id: d },
        { headers: { ...cap(p), ...(r ? { 'X-Proceed-Registration': r.registration_secret } : {}) }, ...options });
      const h = { raw, call, register, owner, foreign, control, bytes: () => readFile(path), counts: () => samples,
        get b() { return b; }, get now() { return now; }, advance: n => { now += n; }, ready: () => server.markReady(),
        async reopen() { await server.close(); await b.close(); await j.close(); await start(); },
        hold(fail = false) { const entered = gate(), release = gate(); releases.push(release.release);
          sync = async () => { entered.release(); await release.promise; if (fail) throw storageFailure('synthetic public sync refusal'); };
          return { entered, release }; } };
      try {
        await progress('setup'); await start(); await progress('assertions'); await work(h);
      } finally {
        await progress('teardown'); releases.forEach(r => r()); await Promise.allSettled(pending);
        try { await server?.close(); } finally { try { await b?.close(); } finally { await j?.close(); } }
        assert.equal(sockets.size, 0, 'owned HTTP exchanges closed'); if (fh) await assert.rejects(fh.stat(), { code: 'EBADF' });
        const probe = createServer(); await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); }); await new Promise(done => probe.close(done));
        assert.ok(logs.every(line => secrets.every(s => !line.includes(s))), 'shutdown-inclusive redaction'); await progress('cleanup-pass');
      }
    }, { totalMs: 18000 });
    assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
  }, 24000, 'aggregate public delivery setup/assertion/teardown deadline');
}
async function setup(h, terminal = true) {
  const r = await h.raw('/v1/handles'), p = r.body; assert.equal(r.status, 201);
  const created = await h.raw('/v1/requests', { request_handle: p.request_handle, client_request_id: 'same', action: 'Question?', context: '', expires_in_seconds: 60 }, { headers: cap(p) });
  assert.equal(created.status, 201); const closure = terminal ? await h.raw(`/v1/requests/${p.request_id}/cancel`, {}, { headers: cap(p) }) : created;
  assert.equal(closure.status, terminal ? 200 : 201); return { p, v: closure.body };
}
test('PUBLIC-LEDGER-CAL: real public create/cancel, clock-free replay and due expiry calibrate prerequisites', opts, () => native(async h => {
  const { p, v } = await setup(h); assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'unavailable');
  await h.reopen(); assert.deepEqual((await h.raw(`/v1/requests/${p.request_id}/cancel`, {}, { headers: cap(p) })).body, v);
  const next = await setup(h, false); h.advance(60000);
  assert.equal((await h.raw(`/v1/requests/${next.p.request_id}/cancel`, {}, { headers: cap(next.p) })).body.resolution, 'expired');
}));
for (const order of [kinds, [...kinds].reverse()]) test(`PUBLIC-LEDGER-${order.join('-')}: first evidence, no inference, duplicate/restart retention`, opts, () => native(async h => {
  const { p, v } = await setup(h), r = await h.register(); let expected = v;
  for (const k of order) {
    h.advance(1000); expected = { ...expected, delivery_state: k === 'acknowledge' || expected.delivery_state === 'confirmed' ? 'confirmed' : 'returned' };
    assert.deepEqual(await h.call(k, p, v.decision_id, r), { status: 200, body: expected });
    const bytes = await h.bytes(), evidence = rows(bytes).filter(m => ['request.acknowledge', 'request.returned'].includes(m.op));
    assert.equal(evidence.length, order.indexOf(k) + 1); assert.equal(evidence.at(-1)[k === 'returned' ? 'returned_at' : 'acknowledged_at'], new Date(h.now).toISOString());
    if (k === 'acknowledge' && order[0] === k) assert.equal(rows(bytes).some(m => m.op === 'request.returned'), false);
    h.advance(1000); assert.deepEqual(await h.call(k, p, v.decision_id, r), { status: 200, body: expected }); assert.deepEqual(await h.bytes(), bytes);
  }
  const bytes = await h.bytes(); await h.reopen(); const replacement = await h.register();
  assert.deepEqual(await h.call('returned', p, v.decision_id, r), regDenied);
  for (const k of kinds) assert.deepEqual(await h.call(k, p, v.decision_id, replacement), { status: 200, body: expected });
  assert.deepEqual(await h.bytes(), bytes);
}));
for (const k of kinds) test(`PUBLIC-LEDGER-ORDER-${k}: browser/readiness/auth/role/parse/body/authority/conflict, due pending stays pending`, opts, () => native(async h => {
  const dummy = { request_id: 'bad' };
  error(await h.call(k, dummy, dec(1), null, { token: null, headers: { origin: 'https://browser.invalid' } }), 403, 'FORBIDDEN');
  error(await h.call(k, dummy, dec(1), null, { token: null, headers: {} }), 503, 'BROKER_NOT_READY'); h.ready();
  const { p } = await setup(h, false), r = await h.register(), before = await h.bytes(), snapshot = h.b.snapshot(), samples = h.counts();
  for (const [token, status, code] of [[null, 401, 'AUTH_REQUIRED'], ['bad', 401, 'AUTH_REQUIRED'], [h.control, 403, 'FORBIDDEN']])
    error(await h.call(k, p, dec(1), r, { token }), status, code);
  const path = `/v1/requests/${p.request_id}/${k}`, headers = { ...cap(p), 'X-Proceed-Registration': r.registration_secret };
  for (const body of ['{', '[]', 'null', ' '.repeat(65536) + '{}']) error(await h.raw(path, body, { headers }), 400, 'INVALID_ARGUMENT');
  if (k === 'returned') for (const [body, extra] of [[{ registration_id: r.registration_id, decision_id: null, extra: true }, {}],
    [{ registration_id: 'bad', decision_id: null }, headers], [{ registration_id: r.registration_id, decision_id: dec(1) }, { ...headers, 'X-Proceed-Registration': 'bad' }],
    [{ registration_id: r.registration_id, decision_id: dec(1) }, { ...headers, authorization: `Bearer ${h.foreign}` }]])
    assert.deepEqual(await h.raw(path, body, { headers: extra }), regDenied);
  const body = { ...(k === 'returned' ? { registration_id: r.registration_id } : {}), decision_id: dec(1) };
  for (const delta of [{ decision_id: null }, { decision_id: [dec(1)] }, { decision_id: 'bad' }, { extra: true }, { request_capability: 'bad' }])
    error(await h.raw(path, { ...body, ...delta }, { headers: { ...headers, 'X-Proceed-Request-Capability': 'bad' } }), 400, 'INVALID_ARGUMENT');
  const missing = { ...body }; delete missing.decision_id; error(await h.raw(path, missing, { headers }), 400, 'INVALID_ARGUMENT');
  for (const extra of [{}, { 'X-Proceed-Request-Capability': 'bad' }, { ...cap(p), authorization: `Bearer ${h.foreign}` }]) {
    if (k === 'returned' && extra.authorization) continue; // Foreign registration authentication is the earlier 401 above.
    assert.deepEqual(await h.call(k, p, dec(1), r, { headers: { ...extra, 'X-Proceed-Registration': r.registration_secret } }), denied);
  }
  assert.equal(h.counts(), samples); assert.deepEqual(await h.bytes(), before);
  const unused = await h.raw('/v1/handles');
  assert.deepEqual(await h.call(k, p, dec(1), r, { headers: { ...cap(unused.body), 'X-Proceed-Registration': r.registration_secret } }), denied);
  for (const target of [unused.body, { ...p, request_id: `req_${'0'.repeat(32)}` }]) assert.deepEqual(await h.call(k, target, dec(1), r), denied);
  const pendingBytes = await h.bytes(), pendingSamples = h.counts(); h.advance(60000); error(await h.call(k, p, dec(1), k === 'returned' ? await h.register() : r), 409, 'DECISION_MISMATCH');
  assert.deepEqual(h.b.snapshot().requests, snapshot.requests); assert.deepEqual(await h.bytes(), pendingBytes); assert.equal(h.counts(), pendingSamples);
}, { ready: false }));
for (const outcome of ['success', 'duplicate', 'conflict', 'body', 'authority', 'secret', 'storage']) test(`PUBLIC-LEDGER-LEASE-${outcome}: only whole success renews, expiry equality and stale incarnation`, opts, () => native(async h => {
  const { p, v } = await setup(h), r = await h.register(); h.advance(44000);
  const successCase = ['success', 'duplicate'].includes(outcome);
  if (outcome === 'storage') { const g = h.hold(true), pended = h.call('returned', p, v.decision_id, r);
    try { await bounded(() => Promise.race([g.entered.promise, pended.then(() => assert.fail('result before sync'))]), 1200, 'storage lease gate'); g.release.release(); assert.deepEqual(await pended, storage); }
    finally { g.release.release(); await pended; }
    h.advance(1000); await h.register(); assert.deepEqual(await h.call('returned', p, v.decision_id, r), regDenied); return;
  }
  if (outcome === 'duplicate') { assert.equal((await h.call('returned', p, v.decision_id, r)).status, 200); h.advance(44000); }
  const result = await h.call('returned', p, outcome === 'body' ? null : outcome === 'conflict' ? dec(999) : v.decision_id, r,
    outcome === 'authority' ? { headers: { 'X-Proceed-Registration': r.registration_secret } } : outcome === 'secret' ? { headers: { ...cap(p), 'X-Proceed-Registration': 'bad' } } : {});
  if (successCase) assert.equal(result.status, 200); else error(result, { conflict: 409, body: 400, authority: 404, secret: 401 }[outcome], { conflict: 'DECISION_MISMATCH', body: 'INVALID_ARGUMENT', authority: 'NOT_FOUND', secret: 'AUTH_REQUIRED' }[outcome]); h.advance(1000);
  if (successCase) { error(await h.raw('/v1/adapter'), 409, 'OWNER_IN_USE'); h.advance(44000); }
  assert.deepEqual(await h.call('returned', p, v.decision_id, r), regDenied);
  const replacement = await h.register(); assert.deepEqual(await h.call('returned', p, v.decision_id, r), regDenied);
  assert.equal((await h.call('returned', p, v.decision_id, replacement)).status, 200);
}));
test('PUBLIC-LEDGER-EXPIRY: public expiry then registration-free acknowledgement, no returned evidence', opts, () => native(async h => {
  const { p } = await setup(h, false); h.advance(60000);
  const expired = await h.raw(`/v1/requests/${p.request_id}/cancel`, {}, { headers: cap(p) }); assert.equal(expired.body.resolution, 'expired');
  assert.deepEqual(await h.call('acknowledge', p, expired.body.decision_id), { status: 200, body: { ...expired.body, delivery_state: 'confirmed' } });
  const bytes = await h.bytes(); assert.equal(rows(bytes).some(m => m.op === 'request.returned'), false);
  await h.reopen(); assert.equal((await h.call('acknowledge', p, expired.body.decision_id)).status, 200); assert.deepEqual(await h.bytes(), bytes);
}));
for (const k of kinds) for (const fail of [false, true]) test(`PUBLIC-LEDGER-FLUSH-${k}-${fail}: actual sync gates HTTP, failure fences; expired renewal cannot undo commit`, opts, () => native(async h => {
  const { p, v } = await setup(h), r = await h.register(), before = h.b.snapshot(), g = h.hold(fail); let settled = false;
  const pending = h.call(k, p, v.decision_id, r); pending.then(() => { settled = true; });
  try {
    await bounded(() => Promise.race([g.entered.promise, pending.then(() => assert.fail('result before sync'))]), 1200, 'public evidence enters real sync');
    assert.equal(settled, false); assert.deepEqual(h.b.snapshot(), before);
    assert.deepEqual(await bounded(() => h.call(k, p, v.decision_id, r, { headers: { 'X-Proceed-Registration': r.registration_secret } }), 800, 'authority denial bypasses held writer'), denied);
    error(await bounded(() => h.call(k, p, null, r), 800, 'body rejection bypasses held writer'), 400, 'INVALID_ARGUMENT');
    if (k === 'returned') { h.advance(45000); const replacement = await h.register(); assert.notEqual(replacement.registration_id, r.registration_id); h.advance(1000); }
    g.release.release(); const result = await pending;
    if (fail) { assert.deepEqual(result, storage); assert.deepEqual(await h.call('acknowledge', p, v.decision_id), storage); assert.deepEqual(h.b.snapshot(), before); }
    else { assert.equal(result.status, 200); assert.equal(result.body.delivery_state, k === 'returned' ? 'returned' : 'confirmed');
      if (k === 'returned') { h.advance(44000); await h.register(); } // Expired captured completion did not renew the replacement.
    }
  } finally { g.release.release(); await pending; }
}));
async function publicProof(work) {
  const root = resolve('.scratch/public-delivery'); await mkdir(root, { recursive: true });
  const progress = phase => appendFile(join(root, 'progress.log'), `public-child ${phase}\n`); await progress('setup');
  await bounded(() => publicRegistration(async h => { await progress('assertions'); try { await work(h); } finally { await progress('teardown'); } }, { paired: true, foreign: true }), 65000, 'aggregate public child lifecycle');
  await progress('cleanup-pass');
}
test('PUBLIC-LEDGER-MCP: actual ack forwarder returns equal text/structured confirmed result; denials and waiting remain honest', { timeout: 70000 }, () => publicProof(async h => {
  await h.restart(); const a = await h.connect(), p = success(await a.call('prepare_approval')); h.requestSecrets.push(p.request_capability);
  const r = await h.http('/v1/requests', h.owner, { method: 'POST', headers: cap(p), body: JSON.stringify({ request_handle: p.request_handle, client_request_id: 'same', action: 'Question?', context: '' }) }); assert.equal(r.status, 201);
  const args = { request_id: p.request_id, request_capability: p.request_capability }, terminal = success(await a.call('cancel_approval', args));
  const confirmed = { ...terminal, delivery_state: 'confirmed' }, ack = { ...args, decision_id: terminal.decision_id };
  assert.deepEqual(success(await a.call('acknowledge_approval', ack)), confirmed); const bytes = await h.journal();
  assert.deepEqual(success(await a.call('acknowledge_approval', ack)), confirmed); assert.deepEqual(await h.journal(), bytes);
  toolError(await a.call('acknowledge_approval', { ...ack, decision_id: dec(999) }), 'DECISION_MISMATCH');
  const foreign = await h.connect('foreign'); toolError(await foreign.call('acknowledge_approval', ack), 'NOT_FOUND'); await h.eof(foreign);
  assert.ok(h.calls.some(c => c.path.endsWith('/acknowledge') && c.status === 200));
  assert.equal(rows(bytes).some(m => m.op === 'request.returned'), false, 'ack RPC result is not original waiting result write');
  toolError(await a.call('request_approval', { request_handle: p.request_handle, request_capability: p.request_capability, client_request_id: 'same', action: 'Question?', context: '' }), 'ENHANCEMENT_UNAVAILABLE');
  await h.eof(a); await h.restart(); const next = await h.connect(); assert.deepEqual(success(await next.call('acknowledge_approval', ack)), confirmed); assert.deepEqual(await h.journal(), bytes); await h.eof(next);
}));
