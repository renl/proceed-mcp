// TEST ONLY: design 3/4/7 G1/G2/G3. Pairing seed is setup, not human/Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { request, createServer } from 'node:http';
import { getEventListeners } from 'node:events';
import { open, mkdir, readFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { storageFailure } from '../src/errors.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';

const opts = { timeout: 12000 }, at = Date.parse('2026-11-01T12:00:00Z');
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const bind = p => ({ ownerId: 'a', capability: p.request_capability, requestId: p.request_id });
const cap = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
const rows = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const code = (r, status, name) => { assert.equal(r.status, status); assert.equal(r.body.error.code, name); assert.equal(r.body.error.retryable, name === 'BROKER_NOT_READY'); };
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
async function run(work, { wire = false, defaultTurn = false, ready = true } = {}) {
  const root = resolve('.scratch/wait-core'); await mkdir(root, { recursive: true });
  const total = defaultTurn ? 38000 : 7000;
  await bounded(async () => {
    const result = await managed(async ctx => {
      const path = join(ctx.directory, 'journal.log'), port = await freePort();
      const progress = phase => appendFile(join(root, 'progress.log'), `${ctx.directory.split(/[\\/]/).at(-1)} ${phase}\n`);
      const owner = '1'.repeat(64), foreign = '2'.repeat(64), control = '3'.repeat(64), pending = [], clients = new Set(), releases = [];
      let j, b, file, server, samples = 0, ids = 0, waitEntry = null;
      const h = { now: at, regNow: at, clockFault: null, sync: async () => {}, generate: () => `dec_${String(++ids).padStart(32, '0')}`,
        clockHook: () => {}, counts: () => ({ samples, ids }), bytes: () => readFile(path), get b() { return b; }, owner, foreign, control };
      const start = async () => {
        const initial = await Journal.open(path), sequence = initial.sequence; await initial.close(); file = await open(path, 'a');
        j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, sequence);
        b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'Owner' }, { owner_id: 'b', label: 'Other' }], port,
          clock: () => { samples++; h.clockHook(); if (h.clockFault) throw h.clockFault; return h.now; }, generateDecisionId: () => h.generate(),
          ...(defaultTurn ? {} : { waitTurnoverMs: 200 }) });
        const before = samples; await b.recover(); assert.equal(samples, before, 'clock-free actual recovery');
        if (wire) {
          const observed = new Proxy(b, { get(target, key) { const value = target[key]; if (typeof value !== 'function') return value;
            return (...args) => { const p = value.apply(target, args); if (key === 'waitRequest') { h.waitSignal = args[0].signal; waitEntry?.release(); } return p; }; } });
          server = createPortableServer({ broker: observed, port, clock: () => h.regNow, credentials: { control, owners: new Map([['a', owner], ['b', foreign]]) } });
          await server.listen(); if (ready) server.markReady();
        }
      };
      h.raw = (path, body = {}, { method = 'POST', token = owner, headers = {} } = {}) => {
        let req; const p = new Promise((resolve, reject) => {
          req = request({ hostname: '127.0.0.1', port, path, method, headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers } }, res => {
            const chunks = []; let size = 0; res.on('data', c => { size += c.length; if (size > 65536) res.destroy(new Error('response bound')); else chunks.push(c); });
            res.on('error', reject); res.on('end', () => { try { const text = Buffer.concat(chunks).toString(); assert.equal(res.headers['access-control-allow-origin'], undefined); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); } catch (e) { reject(e); } });
          }); clients.add(req); req.on('close', () => clients.delete(req)); req.on('error', reject);
          req.setTimeout(defaultTurn ? 32000 : 3000, () => req.destroy(new Error('HTTP deadline'))); req.end(typeof body === 'string' ? body : JSON.stringify(body));
        }); p.catch(() => {}); pending.push(p); return { p, abort: () => req.destroy(new Error('synthetic disconnect')) };
      };
      h.call = async (...args) => h.raw(...args).p;
      h.reg = async () => { const r = await h.call('/v1/adapter'); assert.equal(r.status, 201); return r.body; };
      h.rh = r => ({ 'X-Proceed-Registration': r.registration_secret });
      h.wait = (p, r, options = {}, body = { registration_id: r.registration_id }) => h.raw(`/v1/requests/${p.request_id}/wait`, body, { headers: { ...cap(p), ...h.rh(r) }, ...options });
      h.enter = async (p, r) => { waitEntry = gate(); const x = h.wait(p, r); await bounded(() => Promise.race([waitEntry.promise, x.p.then(() => assert.fail('no wait admission'))]), 800, 'core wait entry'); return x; };
      h.admit = async (p, r) => { const x = await h.enter(p, r); await bounded(() => b.readRequest(bind(h.ps[2])), 800, 'wait releases transaction queue'); return x; };
      h.hold = (fail = false) => { const entered = gate(), release = gate(); releases.push(release.release);
        h.sync = async () => { entered.release(); await release.promise; if (fail) throw storageFailure('synthetic wait sync fault'); }; return { entered, release }; };
      h.reopen = async () => { await server?.close(); await b.close(); await j.close(); await start(); };
      h.close = () => server.close(); h.ready = () => server.markReady();
      try {
        await progress('setup'); const seed = await Journal.open(path);
        try { const hash = 'a'.repeat(64), created_at = '2026-01-01T00:00:00.000Z';
          await seed.append([{ op: 'pairing.challenge', hash, created_at, expires_at: '2026-01-01T00:05:00.000Z' }]);
          await seed.append([{ op: 'pairing.challenge.consume', hash, consumed_at: created_at }, { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: created_at } }]);
        } finally { await seed.close(); }
        await start(); h.ps = [];
        for (let i = 0; i < 3; i++) {
          const p = wire ? (await h.call('/v1/handles')).body : await b.reserveHandle({ ownerId: 'a' }); h.ps.push(p);
          if (i === 2) continue;
          const body = { request_handle: p.request_handle, client_request_id: 'same', action: 'Question?', context: '', expires_in_seconds: 60 };
          if (wire) assert.equal((await h.call('/v1/requests', body, { headers: cap(p) })).status, 201);
          else await b.createRequest({ ...bind(p), requestHandle: p.request_handle, clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
        }
        await progress('assertions'); await work(h);
      } finally {
        await progress('teardown'); releases.forEach(r => r()); clients.forEach(c => c.destroy());
        try { await server?.close(); } finally { try { await b?.close(); } finally { await j?.close(); } }
        await Promise.allSettled(pending); assert.equal(clients.size, 0, 'owned exchanges closed');
        if (file) await assert.rejects(file.stat(), { code: 'EBADF' });
        const probe = createServer(); await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); }); await new Promise(done => probe.close(done));
        await progress('cleanup-pass');
      }
    }, { totalMs: total }); assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
  }, total + 2500, 'aggregate wait setup/assertion/teardown');
}
test('WAIT-CORE: no missed wake or queue hold; duplicate, denial, copied terminal and clock-free reentry', opts, () => run(async h => {
  const [p, q, unused] = h.ps, controller = new AbortController(); let cancel;
  h.clockHook = () => { h.clockHook = () => {}; cancel = h.b.cancelRequest(bind(p)); };
  const waiting = h.b.waitRequest({ ...bind(p), signal: controller.signal });
  const result = await bounded(() => waiting, 1000, 'closure queued at admission sample cannot be missed');
  assert.equal(result.state, 'terminal'); assert.deepEqual(result.request, await cancel); assert.equal(result.request.delivery_state, 'pending');
  result.request.event_capability.reason = 'changed'; const counts = h.counts(); h.clockFault = new Error('terminal must not sample');
  assert.equal((await h.b.waitRequest(bind(p))).request.event_capability.reason, 'No verified Events contract or host support'); assert.deepEqual(h.counts(), counts); h.clockFault = null;
  const active = h.b.waitRequest({ ...bind(q), signal: controller.signal }); await bounded(() => h.b.reserveHandle({ ownerId: 'a' }), 800, 'unrelated writer during wait');
  const before = h.counts(), bytes = await h.bytes(); assert.deepEqual(await h.b.waitRequest(bind(q)), { state: 'conflict' });
  for (const input of [bind(unused), { ...bind(q), ownerId: 'b' }, { ...bind(q), capability: p.request_capability }, {}]) assert.equal(await h.b.waitRequest(input), null);
  assert.deepEqual(h.counts(), before); assert.deepEqual(await h.bytes(), bytes); controller.abort(); assert.deepEqual(await active, { state: 'detached' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0); assert.deepEqual(await h.b.waitRequest(bind(q)), { state: 'pending' });
}));
for (const producer of ['wait', 'read', 'status', 'sweep', 'cancel']) test(`WAIT-CORE-DUE-${producer}: exact due, actual closure pending, flush before wake, replay stable`, opts, () => run(async h => {
  const p = h.ps[0], controller = new AbortController(); let waiting;
  if (producer !== 'wait') { waiting = h.b.waitRequest({ ...bind(p), signal: controller.signal }); await h.b.readRequest(bind(h.ps[1])); }
  h.now += 60000; const g = h.hold(); let settled = false;
  if (producer === 'wait') waiting = h.b.waitRequest({ ...bind(p), signal: controller.signal });
  waiting.then(() => { settled = true; }, () => {});
  const writing = producer === 'wait' ? waiting : producer === 'read' ? h.b.readRequest(bind(p)) : producer === 'status' ? h.b.status() : producer === 'sweep' ? h.b.sweepExpired() : h.b.cancelRequest(bind(p));
  try { await bounded(() => g.entered.promise, 800, 'actual closure sync'); assert.equal(settled, false); assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
    g.release.release(); await writing; const v = (await waiting).request; assert.equal(v.resolution, 'expired'); assert.equal(v.delivery_state, 'pending');
    assert.equal(rows(await h.bytes()).find(m => m.op === 'request.expire' && m.request_id === p.request_id).delivery_state, 'pending');
    await h.reopen(); assert.deepEqual((await h.b.waitRequest(bind(p))).request, v);
  } finally { g.release.release(); controller.abort(); }
}));
for (const fault of ['clock', 'identity', 'append', 'preabort', 'queued-abort']) test(`WAIT-CORE-FAULT-${fault}: slot/listener cleanup, no false conflict or fence bypass`, opts, () => run(async h => {
  const p = h.ps[0], c = new AbortController(), before = await h.bytes(); let held;
  if (fault === 'queued-abort') { held = h.hold(); const writer = h.b.reserveHandle({ ownerId: 'a' }); await held.entered.promise; h.writer = writer; }
  if (fault === 'clock') h.clockFault = new Error('synthetic admission clock failure');
  if (fault === 'identity') { h.now += 60000; h.generate = () => { throw new Error('synthetic identity failure'); }; }
  if (fault === 'append') { h.now += 60000; h.sync = async () => { throw storageFailure('synthetic append failure'); }; }
  if (fault === 'preabort') c.abort();
  const admissionCounts = h.counts();
  const wait = h.b.waitRequest({ ...bind(p), signal: c.signal });
  if (held) { c.abort(); held.release.release(); await h.writer; }
  if (fault.endsWith('abort')) assert.deepEqual(await wait, { state: 'detached' }); else await assert.rejects(wait, storage);
  if (fault.endsWith('abort')) assert.deepEqual(h.counts(), admissionCounts, 'detached admission performs no deadline work');
  assert.equal(getEventListeners(c.signal, 'abort').length, 0); h.clockFault = null; h.generate = () => `dec_${'f'.repeat(32)}`; h.sync = async () => {};
  if (fault === 'append') { await assert.rejects(h.b.waitRequest(bind(p)), storage); await h.reopen(); }
  else if (fault !== 'queued-abort') assert.deepEqual(await h.bytes(), before);
  assert.notEqual((await h.b.waitRequest(bind(p))).state, 'conflict');
}));
test('WAIT-CORE-TURNOVER: before/at deadline, later closure and core close detach without mutation', opts, () => run(async h => {
  const p = h.ps[0]; h.now += 59999; assert.deepEqual(await h.b.waitRequest(bind(p)), { state: 'pending' });
  const turning = h.b.waitRequest(bind(p)); await h.b.readRequest(bind(h.ps[2])); h.now++;
  const v = (await turning).request; assert.equal(v.resolution, 'expired'); assert.equal(v.delivery_state, 'pending');
   const future = h.ps[2]; await h.b.createRequest({ ...bind(future), requestHandle: future.request_handle, clientRequestId: 'future', action: 'Still pending?', context: '', expiresInSeconds: 60 });
   const bytes = await h.bytes(), c = new AbortController(), active = h.b.waitRequest({ ...bind(future), signal: c.signal });
   await bounded(async () => { assert.equal((await h.b.readRequest(bind(future))).resolution, 'pending'); assert.deepEqual(await h.b.waitRequest(bind(future)), { state: 'conflict' }); }, 800, 'future pending waiter admitted before close');
   assert.ok(getEventListeners(c.signal, 'abort').length > 0); await bounded(() => h.b.close(), 800, 'close drains admitted wait');
   assert.deepEqual(await active, { state: 'detached' }); assert.equal(getEventListeners(c.signal, 'abort').length, 0); assert.deepEqual(await h.bytes(), bytes);
   await h.reopen(); assert.deepEqual(await h.b.waitRequest(bind(future)), { state: 'pending' }); assert.deepEqual(await h.bytes(), bytes);
}));
