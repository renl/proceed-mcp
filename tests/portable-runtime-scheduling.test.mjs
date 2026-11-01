// TEST ONLY: design 2/3/4/7 A1b-first. Seeded creation is setup, never public creation proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { open, readFile, writeFile, access } from 'node:fs/promises';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, Server } from 'node:net';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { startPortableRuntime } from '../src/broker/portable-runtime.js';
import { statePaths } from '../src/state/paths.js';
import { sha256Hex } from '../src/util/values.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort, completed, stopped } from './support/startup-guards.mjs';
const executable = resolve('bin/proceed-mcp.js');
const preload = pathToFileURL(resolve('tests/fixtures/runtime-scheduling-preload.mjs')).href;
const logLine = 'expiry scheduling stopped after a storage failure; stop and restart serve';
const tokenLine = 'proceed-mcp: Telegram unavailable: set PROCEED_TELEGRAM_BOT_TOKEN and restart serve; local broker only\n';
const capability = `cap_${'1'.repeat(64)}`, requestId = `req_${'1'.repeat(32)}`, handleId = `hdl_${'1'.repeat(32)}`;
const binding = { ownerId: 'a', capability, requestId };
const creation = { ownerId: 'a', capability, requestHandle: handleId, clientRequestId: 'fixture', action: 'Question?', context: '', expiresInSeconds: 60 };
const storage = e => e?.exitCode === 4 && e?.code === 'STORAGE_FAILURE';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const mutations = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const closures = bytes => mutations(bytes).filter(m => m.op === 'request.expire');
async function observe(check, ms = 4500) {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (await check()) return; await delay(20); }
  assert.fail('bounded observation expired');
}
async function fixture(work, { futureMs = 60000 } = {}) {
  const result = await managed(async ctx => {
    const paths = statePaths(join(ctx.directory, 'state'));
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: ctx.directory, TEMP: ctx.directory, TMPDIR: ctx.directory });
    const cli = (...args) => {
      const r = spawnSync(process.execPath, [executable, ...args, '--state-dir', paths.stateDir],
        { cwd: ctx.directory, env, timeout: 10000, maxBuffer: 65536, encoding: 'utf8', windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0, 'public fixture setup');
    };
    cli('init'); cli('owner', 'add', 'a', '--label', 'A');
    const config = JSON.parse(await readFile(paths.configFile)); config.broker.port = await freePort();
    await writeFile(paths.configFile, JSON.stringify(config) + '\n');
    const control = (await readFile(paths.controlCredentialFile, 'utf8')).trim();
    const owner = (await readFile(paths.ownerCredentialFile('a'), 'utf8')).trim();
    const deadline = Date.now() + futureMs;
    const iso = n => new Date(n).toISOString(), created = deadline - 60000, paired = created - 1000;
    const pairing = { user_id: '71', chat_id: '81', paired_at: iso(paired) };
    const seed = await Journal.open(paths.journalFile);
    try {
      for (const row of [[{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: iso(paired), expires_at: iso(paired + 300000) }],
        [{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: iso(paired) }, { op: 'pairing.set', pairing }],
        [{ op: 'handle.reserve', owner_id: 'a', request_handle: handleId, request_id: requestId, capability_hash: sha256Hex(capability), session_label: 'A', prepared_at: iso(paired) }],
        [{ op: 'request.create', request_handle: handleId, client_request_id: 'fixture', action: 'Question?', context: '', expires_in_seconds: 60, created_at: iso(created), expires_at: iso(deadline), pairing_snapshot: pairing }]]) await seed.append(row);
    } finally { await seed.close(); }
    await assert.rejects(access(paths.brokerLockFile), { code: 'ENOENT' });
    const children = []; let runtime;
    const start = (args = ['serve'], token, nodeArgs) => {
      const child = spawn(process.execPath, nodeArgs ?? [...(args[0] === 'serve' ? ['--import', preload] : []), executable, ...args, '--state-dir', paths.stateDir],
        { cwd: ctx.directory, env: { ...env, ...(token === undefined ? {} : { PROCEED_TELEGRAM_BOT_TOKEN: token }) }, windowsHide: true,
          detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
      const r = { child, pid: child.pid, knownPids: [], out: '', err: '', events: [] };
      ctx.resources.push(r); children.push(r); child.on('close', () => { r.closed = true; });
      child.on('message', m => r.events.push(m));
      for (const [stream, key] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', b => {
        r[key] += b; if (r.out.length + r.err.length > 65536) child.kill();
      });
      return r;
    };
    const http = async (path = '/v1/status', token = control, options = {}) => {
      const r = await fetch(`http://127.0.0.1:${config.broker.port}${path}`, { ...options,
        headers: { authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(2000) });
      return { status: r.status, body: await r.json() };
    };
    const h = { paths, config, control, owner, start, http, deadline,
      async runtime(options = {}) { runtime = await startPortableRuntime({ paths, config, ...options }); return runtime; },
      async bytes() { return readFile(paths.journalFile); },
      async recovered() { const j = await Journal.open(paths.journalFile); try { return (await j.recover()).transactions.flatMap(t => t.mutations); } finally { await j.close(); } } };
    try { await work(h); }
    finally {
      await runtime?.stop();
      for (const r of children) if (!r.closed && r.child.connected) await stopped(r);
      for (const r of children) assert.ok(![control, owner, capability, 'synthetic-token'].some(s => (r.out + r.err).includes(s)), 'no credential output');
      await assert.rejects(access(paths.brokerLockFile), { code: 'ENOENT' });
      const probe = createServer(); await new Promise((done, reject) => { probe.once('error', reject); probe.listen(config.broker.port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
    }
  }, { totalMs: 65000 });
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}
test('SCHED-CAL: stopped protected setup replays through actual core, no expiry or writer retained', { timeout: 75000 }, () => fixture(async h => {
  const j = await Journal.open(h.paths.journalFile);
  const b = createPortableBroker({ journal: j, owners: h.config.owners, port: h.config.broker.port, clock: () => h.deadline - 1 });
  try { await b.recover(); assert.equal(b.snapshot().requests[0].resolution, 'pending'); assert.equal(closures(await h.bytes()).length, 0); }
  finally { await b.close(); await j.close(); }
}));
test('SCHED-PUBLIC: real cadence durable expiry with ZERO HTTP/status; stop/reopen preserves decision', { timeout: 75000 }, () => fixture(async h => {
  const r = h.start(); await observe(() => r.out.includes('broker ready on'), 10000);
  assert.equal(closures(Buffer.from(r.events.find(e => e.kind === 'listening').bytes, 'base64')).length, 0, 'not startup expiry');
  await observe(async () => closures(await h.bytes()).length === 1, 6500);
  assert.equal(r.events.filter(e => e.kind === 'network-attempt').length, 0);
  await stopped(r); const saved = (await h.recovered()).filter(m => m.op === 'request.expire');
  assert.equal(saved.length, 1); assert.match(saved[0].decision_id, /^dec_[0-9a-f]{32}$/);
  const again = h.start(); await observe(() => again.out.includes('broker ready on'), 10000); await stopped(again);
  assert.deepEqual((await h.recovered()).filter(m => m.op === 'request.expire'), saved);
}, { futureMs: 4000 }));
test('SCHED-RESTART: future pending stop, deadline crossed while stopped, durable before earliest listen', { timeout: 75000 }, () => fixture(async h => {
  const r = h.start(); await observe(() => r.out.includes('broker ready on'), 10000); await stopped(r);
  assert.equal(closures(await h.bytes()).length, 0);
  await delay(Math.max(0, h.deadline - Date.now() + 20));
  const again = h.start(); await observe(() => again.out.includes('broker ready on'), 10000);
  const first = closures(Buffer.from(again.events.find(e => e.kind === 'listening').bytes, 'base64'));
  assert.equal(first.length, 1, 'closure already durable before first public listen, not status-induced');
  await stopped(again); assert.deepEqual((await h.recovered()).filter(m => m.op === 'request.expire'), first);
  const third = h.start(); await observe(() => third.out.includes('broker ready on'), 10000); await stopped(third);
  assert.deepEqual((await h.recovered()).filter(m => m.op === 'request.expire'), first);
}, { futureMs: 5000 }));
test('SCHED-TOKEN: missing/empty once on stderr only after success; present is not transport proof', { timeout: 75000 }, () => fixture(async h => {
  for (const token of [undefined, '', 'synthetic-token']) {
    const r = h.start(['serve'], token); await observe(() => r.out.includes('broker ready on'), 10000);
    await delay(100); await stopped(r);
    assert.equal(r.err.split(tokenLine).length - 1, token === 'synthetic-token' ? 0 : 1);
    assert.equal(r.out.includes('Telegram unavailable'), false);
    assert.equal(r.events.filter(e => e.kind === 'network-attempt').length, 0);
  }
}));
test('SCHED-START-FAULT: constructor clock succeeds, post-replay initial sweep clock refuses before bind', { timeout: 75000 }, () => fixture(async h => {
  let calls = 0, listens = 0; const before = await h.bytes(), emit = Server.prototype.emit;
  Server.prototype.emit = function (event, ...args) { if (event === 'listening' && this.address()?.port === h.config.broker.port) listens++; return emit.call(this, event, ...args); };
  try { await assert.rejects(h.runtime({ clock: () => { if (++calls === 2) throw new Error('private-clock-path'); return h.deadline - 1; } })); }
  finally { Server.prototype.emit = emit; }
  assert.equal(listens, 0, 'prearmed real listener observer, not a hypothetical prelisten503');
  assert.equal(calls, 2, 'constructor then actual pending sweep; semantic replay never samples clock');
  assert.deepEqual(await h.bytes(), before); await assert.rejects(access(h.paths.brokerLockFile), { code: 'ENOENT' });
  // If startup wrongly succeeded, fixture still owns and stops that runtime in finally.
}));
test('SCHED-CORRUPT: actual serve refuses invalid history without ready/token diagnostic or repair', { timeout: 75000 }, () => fixture(async h => {
  const before = await h.bytes(); const corrupt = Buffer.from(before); corrupt[corrupt.length - 1] ^= 1;
  await writeFile(h.paths.journalFile, corrupt); const r = h.start();
  assert.equal(await completed(r), 4); assert.equal(r.out, ''); assert.equal(r.err.includes(tokenLine), false);
  assert.equal(r.events.some(e => e.kind === 'listening'), false); assert.deepEqual(await h.bytes(), corrupt);
}));
test('SCHED-RUNTIME-FAULT: postready clock failure stops/logs/latches, HTTP redaction/precedence, actual CLI exit4', { timeout: 75000 }, () => fixture(async h => {
  let fail = false, calls = 0; const logs = [];
  const runtime = await h.runtime({ clock: () => { calls++; if (fail) throw new Error('private-clock-path'); return h.deadline - 1; }, logger: (...args) => logs.push(args) });
  assert.equal(runtime.ready, true); const before = await h.bytes(); fail = true;
  await observe(() => logs.some(args => args[0] === logLine)); const sampled = calls;
  assert.equal(runtime.ready, false); await delay(2200); assert.equal(calls, sampled, 'no retry ticks');
  assert.deepEqual(logs, [[logLine]], 'one fixed line, no exception argument');
  assert.deepEqual(await h.http(), { status: 500, body: { schema_version: 1, error: { code: 'STORAGE_FAILURE', message: 'the broker could not complete the request', retryable: false } } });
  const prepared = await h.http('/v1/handles', h.owner, { method: 'POST', body: '{}' });
  assert.equal(prepared.status, 500); assert.equal(prepared.body.error.code, 'STORAGE_FAILURE');
  for (const [path, token, options, status] of [['/v1/status', '', {}, 401], ['/v1/status', h.owner, {}, 403],
    ['/v1/status', h.control, { headers: { origin: 'https://browser.invalid' } }, 403],
    ['/v1/handles', h.owner, { method: 'POST', body: '{' }, 400],
    ['/v1/handles', h.owner, { method: 'POST', body: '{"session_label":""}' }, 400]]) assert.equal((await h.http(path, token, options)).status, status);
  const cli = h.start(['status', '--json']); assert.equal(await completed(cli), 4); assert.equal(cli.out, '');
  assert.match(cli.err, /STORAGE_FAILURE/); assert.equal(cli.err.includes('private-clock-path'), false);
  assert.deepEqual(await h.bytes(), before); assert.equal(calls, sampled, 'denials/latch never sample expiry');
  const stop = runtime.stop(); assert.equal(runtime.stop(), stop, 'runtime shares exact draining promise'); await stop;
}));
test('SCHED-RUNTIME-DRAIN: actual runtime FileHandle sync held; stop shares completion and closes only after sweep', { timeout: 75000 }, () => fixture(async h => {
  const originalOpen = fs.open, originalClose = Server.prototype.close;
  const entered = deferred(), release = deferred(), order = []; let armed = false, recoverySyncs = 0, now = h.deadline - 1, stop, pending = false;
  fs.open = async function (path, ...args) {
    const fh = await originalOpen.call(this, path, ...args);
    if (String(path) === h.paths.journalFile) {
      const sync = fh.sync.bind(fh), close = fh.close.bind(fh);
      fh.sync = async () => { if (armed) { entered.resolve(); await release.promise; } else recoverySyncs++; return sync(); };
      fh.close = async () => { if (armed) { order.push('journal'); await access(h.paths.brokerLockFile); } return close(); };
    }
    return fh;
  }; syncBuiltinESMExports();
  try {
    const runtime = await h.runtime({ clock: () => now });
    assert.equal(recoverySyncs, 2, 'actual Journal.open and broker replay flushes reached observer while unarmed');
    const coreClose = runtime.broker.close.bind(runtime.broker);
    runtime.broker.close = () => { order.push('broker'); return coreClose(); };
    Server.prototype.close = function (...args) { if (this.address()?.port === h.config.broker.port) order.push('server'); return originalClose.apply(this, args); };
    armed = true; now = h.deadline;
    await bounded(() => entered.promise, 2500, 'runtime scheduled actual Journal sync');
    assert.equal(runtime.broker.snapshot().requests[0].resolution, 'pending');
    stop = runtime.stop(); pending = true; stop.then(() => { pending = false; });
    assert.equal(runtime.ready, false, 'stop synchronously withdraws current health');
    assert.equal(runtime.stop(), stop); await delay(1100); assert.equal(pending, true); assert.deepEqual(order, []);
    await access(h.paths.brokerLockFile); release.resolve(); await stop;
    assert.deepEqual(order, ['server', 'broker', 'journal']); await assert.rejects(access(h.paths.brokerLockFile), { code: 'ENOENT' });
    assert.equal(runtime.ready, false); assert.equal(runtime.stop(), stop, 'same promise after settlement');
  } finally { release.resolve(); await stop; fs.open = originalOpen; Server.prototype.close = originalClose; syncBuiltinESMExports(); }
}));
async function composition(work) {
  return fixture(async h => {
    const recovered = await Journal.open(h.paths.journalFile), seq = recovered.sequence; await recovered.close();
    const fh = await open(h.paths.journalFile, 'a'); let syncHook = async () => {}, writeHook = async () => {}, now = h.deadline - 1;
    const j = new Journal(h.paths.journalFile, { write: async (...args) => { await writeHook(); return fh.write(...args); }, sync: async () => { await syncHook(); await fh.sync(); }, close: () => fh.close() }, seq);
    let clockFault = false, samples = 0, identities = 0;
    const b = createPortableBroker({ journal: j, owners: h.config.owners, port: h.config.broker.port,
      clock: () => { samples++; if (clockFault) throw new Error('private-clock-path'); return now; },
      generateDecisionId: () => { identities++; return `dec_${'2'.repeat(32)}`; } });
    let schedule;
    try {
      await b.recover(); // Hooks are armed AFTER both ordinary recovery syncs.
      await work({ ...h, b, j, fh, due: () => { now = h.deadline; }, sync: fn => { syncHook = fn; }, write: fn => { writeHook = fn; },
        faultClock: () => { clockFault = true; }, counts: () => ({ samples, identities }),
        schedule: async options => { const m = await import('../src/broker/expiry-schedule.js'); assert.equal(m.SWEEP_INTERVAL_MS, 1000);
          schedule = m.startExpirySchedule({ broker: b, ...options }); return schedule; } });
    } finally { await schedule?.stop(); await b.close(); await j.close(); await fh.close().catch(() => {}); }
  });
}
test('SCHED-GATE-CAL: actual Journal write then held sync; no install/ack before flush', { timeout: 75000 }, () => composition(async h => {
  const entered = deferred(), release = deferred(); let settled = false;
  h.sync(async () => { entered.resolve(); await release.promise; }); h.due();
  const p = h.b.sweepExpired(); p.then(() => { settled = true; }, () => {});
  try { await bounded(() => entered.promise, 2000, 'actual sync gate'); assert.equal(settled, false); assert.equal(h.b.snapshot().requests[0].resolution, 'pending'); assert.equal(closures(await h.bytes()).length, 1, 'complete frame is not rollback/durable acknowledgement'); }
  finally { release.resolve(); await p; }
  assert.equal(h.b.snapshot().requests[0].resolution, 'expired');
}));
for (const stage of ['append', 'sync']) test(`SCHED-FAULT-CAL-${stage}: fault actually reaches existing Journal, pending state retained`, { timeout: 75000 }, () => composition(async h => {
  let reached = 0; const before = await h.bytes();
  if (stage === 'append') h.write(async () => { reached++; await h.fh.close(); });
  else h.sync(async () => { reached++; await h.fh.close(); });
  h.due(); await assert.rejects(h.b.sweepExpired(), storage); assert.equal(reached, 1);
  assert.equal(h.b.snapshot().requests[0].resolution, 'pending'); await assert.rejects(h.b.status(), storage);
  if (stage === 'append') assert.deepEqual(await h.bytes(), before); else assert.notDeepEqual(await h.bytes(), before);
}));
test('SCHED-UNREF: real healthy timer cannot keep actual core/Journal leaf process alive', { timeout: 75000 }, () => fixture(async h => {
  const url = p => JSON.stringify(pathToFileURL(resolve(p)).href);
  const source = `import {Journal} from ${url('src/journal/journal.js')};
    import {createPortableBroker} from ${url('src/broker/portable.js')};
    import {startExpirySchedule} from ${url('src/broker/expiry-schedule.js')};
    const j=await Journal.open(${JSON.stringify(h.paths.journalFile)});
    const b=createPortableBroker({journal:j,owners:[{owner_id:'a',label:'A'}],port:43189}); await b.recover();
    const s=startExpirySchedule({broker:b});
    setTimeout(async()=>{process.exitCode=19;await s.stop();await b.close();await j.close();},1500).unref();`;
  const r = h.start([], undefined, ['--input-type=module', '--eval', source]);
  assert.equal(await completed(r), 0, 'refed timer would hit bounded leaf failsafe exit19');
}));
test('SCHED-SINGLEFLIGHT: sweep queued behind held writer >2ticks, shared stop drains, no work after stop', { timeout: 75000 }, () => composition(async h => {
  const entered = deferred(), release = deferred(); let writes = 0, sweeps = 0, stopped = false;
  h.write(async () => { if (++writes === 1) { entered.resolve(); await release.promise; } });
  const writer = h.b.reserveHandle({ ownerId: 'a' });
  const sweep = h.b.scheduledSweep?.bind(h.b); h.b.scheduledSweep = () => { sweeps++; return sweep(); };
  let schedule, stopping;
  try { await bounded(() => entered.promise, 2000, 'actual writer blocks serialized admission'); h.due(); schedule = await h.schedule();
    await observe(() => sweeps === 1, 2500); await delay(2200);
    assert.equal(sweeps, 1, 'including queued admission, no overlapping attempts'); assert.equal(writes, 1);
    stopping = schedule.stop(); assert.equal(schedule.stop(), stopping); stopping.then(() => { stopped = true; });
    await delay(1100); assert.equal(stopped, false, 'stop awaits held actual sweep');
  } finally { release.resolve(); await writer; await stopping; }
  await delay(1100); assert.equal(sweeps, 1); assert.equal(writes, 2); assert.equal(closures(await h.bytes()).length, 1);
}));
for (const stage of ['append', 'sync']) test(`SCHED-FAIL-${stage}: actual handle refusal stops permanently, logs once, callback no arguments`, { timeout: 75000 }, () => composition(async h => {
  const logs = [], callbacks = []; let writes = 0;
  h.write(async () => { writes++; if (stage === 'append') await h.fh.close(); });
  h.sync(async () => { if (stage === 'sync') await h.fh.close(); }); h.due();
  const before = await h.bytes(); const schedule = await h.schedule({ logger: (...a) => logs.push(a), onFailure: (...a) => callbacks.push(a) });
  await observe(() => callbacks.length === 1); await delay(2200); await schedule.stop();
  assert.deepEqual(logs, [[logLine]]); assert.deepEqual(callbacks, [[]]); assert.equal(writes, 1);
  assert.equal(h.b.snapshot().requests[0].resolution, 'pending'); await assert.rejects(h.b.status(), storage);
  const fence = await h.b.status().catch(e => e); h.b.latchDeadlineFailure(); h.b.latchDeadlineFailure();
  await assert.rejects(h.b.reserveHandle({ ownerId: 'a', sessionLabel: '' }), e => e === fence);
  await assert.rejects(h.b.recover(), e => e === fence);
  if (stage === 'append') assert.deepEqual(await h.bytes(), before); else assert.notDeepEqual(await h.bytes(), before, 'sync rejection may leave complete frame');
}));
test('SCHED-ORDER: actual scheduled clock refusal precedes queued followers; admitted write drains', { timeout: 75000 }, () => composition(async h => {
  const entered = deferred(), release = deferred(), invoked = deferred(); let writes = 0, followers = [];
  const randomBytes = crypto.randomBytes; let allocations = 0;
  crypto.randomBytes = (...args) => { allocations++; return randomBytes(...args); }; syncBuiltinESMExports();
  h.sync(async () => { entered.resolve(); await release.promise; }); h.write(async () => { writes++; });
  const held = h.b.reserveHandle({ ownerId: 'a' });
  try {
    await bounded(() => entered.promise, 2000, 'admitted actual sync');
    assert.equal(allocations, 3, 'prearmed actual reservation identity observer');
    assert.equal(typeof h.b.scheduledSweep, 'function');
    const sweep = h.b.scheduledSweep.bind(h.b);
    h.b.scheduledSweep = () => { const pending = sweep(); invoked.resolve(); return pending; };
    const schedule = await h.schedule(); await bounded(() => invoked.promise, 2500, 'actual scheduled invocation');
    h.faultClock(); const before = h.counts(), bytes = await h.bytes();
    followers = [h.b.readRequest(binding), h.b.createRequest(creation), h.b.reserveHandle({ ownerId: 'a' }), h.b.status(), h.b.sweepExpired(), h.b.recover()];
    const refused = Promise.all(followers.map(p => assert.rejects(p, storage))); refused.catch(() => {});
    await Promise.resolve(); await Promise.resolve(); // createRequest's existing deferred admission precedes release.
    release.resolve(); const result = await held; assert.match(result.request_handle, /^hdl_[0-9a-f]{32}$/);
    await refused; await schedule.stop(); assert.equal(schedule.failed, true);
    assert.deepEqual(h.counts(), { samples: before.samples + 1, identities: before.identities });
    assert.equal(writes, 1); assert.deepEqual(await h.bytes(), bytes); assert.equal(closures(bytes).length, 0);
    assert.equal(allocations, 3, 'no follower identity allocation');
    assert.equal(h.b.snapshot().prepared.length, 2, 'only admitted write installed');
    assert.equal(await h.b.readRequest({ ...binding, capability: 'cap_bad' }), null);
    assert.equal(await h.b.createRequest({ ...creation, ownerId: 'foreign' }), null);
    await assert.rejects(h.b.createRequest({ ...creation, action: '' }), e => e?.exitCode === 2);
    await assert.rejects(h.b.reserveHandle({ ownerId: 'a', sessionLabel: '' }), e => e?.exitCode === 2);
  } finally { release.resolve(); await Promise.allSettled([held, ...followers]); crypto.randomBytes = randomBytes; syncBuiltinESMExports(); }
}));
test('SCHED-HOOKS: synchronous throws are independently attempted once and cannot block stop', { timeout: 75000 }, () => composition(async h => {
  const attempts = []; h.faultClock();
  const schedule = await h.schedule({ onFailure: (...args) => { attempts.push(['failure', args]); throw new Error('private-hook'); },
    logger: (...args) => { attempts.push(['logger', args]); throw new Error('private-logger'); } });
  await observe(() => attempts.length === 2); assert.equal(schedule.failed, true);
  const stop = schedule.stop(); assert.equal(schedule.stop(), stop); await bounded(() => stop, 2000, 'throwing hooks drain');
  assert.equal(schedule.stop(), stop); await delay(1100);
  assert.deepEqual(attempts, [['failure', []], ['logger', [logLine]]]); await assert.rejects(h.b.status(), storage);
}));
test('SCHED-LATCH: queued authorized work rechecks latch after held turn; authority/input denials remain', { timeout: 75000 }, () => composition(async h => {
  assert.equal(typeof h.b.latchDeadlineFailure, 'function');
  const entered = deferred(), release = deferred(); h.sync(async () => { entered.resolve(); await release.promise; });
  const held = h.b.reserveHandle({ ownerId: 'a' }); let queued;
  try { await bounded(() => entered.promise, 2000, 'held authorized write');
    queued = [h.b.status(), h.b.readRequest(binding), h.b.createRequest(creation), h.b.reserveHandle({ ownerId: 'a' })];
    const refused = Promise.all(queued.map(p => assert.rejects(p, storage))); refused.catch(() => {});
    await Promise.resolve(); await Promise.resolve(); const bytes = await h.bytes();
    h.b.latchDeadlineFailure(); h.b.latchDeadlineFailure();
    assert.equal(await h.b.readRequest({ ...binding, capability: 'cap_bad' }), null);
    assert.equal(await h.b.createRequest({ ...creation, ownerId: 'foreign' }), null);
    await assert.rejects(h.b.createRequest({ ...creation, action: '' }), e => e?.exitCode === 2);
    await assert.rejects(h.b.reserveHandle({ ownerId: 'a', sessionLabel: '' }), e => e?.exitCode === 2);
    assert.deepEqual(await h.bytes(), bytes, 'latch and denials append nothing while accepted write is held');
    release.resolve(); await held; await refused;
    await assert.rejects(h.b.status(), storage); await assert.rejects(h.b.reserveHandle({ ownerId: 'a' }), storage);
    assert.equal(closures(await h.bytes()).length, 0, 'latch itself neither expires nor appends');
  } finally { release.resolve(); await Promise.allSettled([held, ...(queued ?? [])]); }
}));
