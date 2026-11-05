// TEST ONLY: design 4/7 callback breadth. Seeded requests are setup, not first-use proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { Server, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Journal } from '../src/journal/journal.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { startPortableRuntime } from '../src/broker/portable-runtime.js';
import { startExpirySchedule, SWEEP_INTERVAL_MS } from '../src/broker/expiry-schedule.js';
import { createRegistrationRegistry } from '../src/broker/registration.js';
import { statePaths } from '../src/state/paths.js';
import { sha256Hex } from '../src/util/values.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';

const message = 'expiry scheduling stopped after a storage failure; stop and restart serve';
const executable = resolve('bin/proceed-mcp.js');
const storage = e => e?.code === 'STORAGE_FAILURE' && e?.exitCode === 4;
const modes = ['throw', 'ordinary', 'fulfilled', 'rejected', 'lateResolve', 'lateReject',
  'thenFulfilled', 'thenRejected', 'thenLateResolve', 'thenLateReject'];
const held = mode => /[Ll]ate/.test(mode);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function observe(check) {
  const deadline = performance.now() + 4500;
  while (performance.now() < deadline) { if (check()) return; await delay(10); }
  assert.fail('bounded callback observation expired');
}
// Deliberately do not attach a test-side catch to a returned Promise: production
// containment, not fixture observation, must prevent its unhandled rejection.
function returned(mode) {
  const gate = held(mode) && !mode.startsWith('then') ? deferred() : null;
  let yes, no, assimilations = 0, releases = 0;
  const reason = new Error('synthetic callback refusal');
  return {
    call() {
      if (mode === 'throw') throw reason;
      if (mode === 'ordinary') return { ignored: true };
      if (mode === 'fulfilled') return Promise.resolve('ignored');
      if (mode === 'rejected') return Promise.reject(reason);
      if (gate) return gate.promise;
      return { then(resolve, reject) {
        assimilations++; yes = resolve; no = reject;
        if (mode === 'thenFulfilled') resolve('ignored');
        if (mode === 'thenRejected') reject(reason);
      } };
    },
    release() {
      if (!held(mode) || releases++) return;
      if (mode.endsWith('Reject')) (gate ? gate.reject : no)?.(reason);
      else (gate ? gate.resolve : yes)?.('ignored');
    },
    get assimilations() { return assimilations; },
  };
}

// Independent non-test-runner control: a deliberate unhandled rejection reaches
// an explicitly installed witness. No shared harness/global rejection swallower.
test('CALLBACK-CONTROL: independent leaf observer detects an actual unhandled rejection', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `let n=0; process.on('unhandledRejection', e=>{if(e.message==='control') n++});
     Promise.reject(new Error('control'));
     setTimeout(()=>{console.log(n);process.exitCode=n===1?0:9},30);`],
  { cwd: process.cwd(), env: {}, timeout: 3000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true });
  assert.ifError(r.error); assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '1');
});

async function fixture(work) {
  const result = await managed(async ctx => {
    const paths = statePaths(join(ctx.directory, 'state'));
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: ctx.directory, TEMP: ctx.directory, TMPDIR: ctx.directory });
    for (const args of [['init'], ['owner', 'add', 'a', '--label', 'A']]) {
      const r = spawnSync(process.execPath, [executable, ...args, '--state-dir', paths.stateDir],
        { cwd: ctx.directory, env, timeout: 10000, maxBuffer: 8192, encoding: 'utf8', windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0, 'fixture-only public setup');
    }
    const config = JSON.parse(await fs.readFile(paths.configFile));
    config.broker.port = await freePort(); await fs.writeFile(paths.configFile, JSON.stringify(config) + '\n');
    const owner = (await fs.readFile(paths.ownerCredentialFile('a'), 'utf8')).trim();
    const now = Date.now(), iso = n => new Date(n).toISOString();
    const pairing = { user_id: '71', chat_id: '81', paired_at: iso(now) };
    const seed = await Journal.open(paths.journalFile);
    try {
      for (const mutations of [
        [{ op: 'pairing.challenge', hash: 'a'.repeat(64), created_at: iso(now), expires_at: iso(now + 300000) }],
        [{ op: 'pairing.challenge.consume', hash: 'a'.repeat(64), consumed_at: iso(now) }, { op: 'pairing.set', pairing }],
        [{ op: 'handle.reserve', owner_id: 'a', request_handle: `hdl_${'1'.repeat(32)}`, request_id: `req_${'1'.repeat(32)}`,
          capability_hash: sha256Hex(`cap_${'1'.repeat(64)}`), session_label: 'A', prepared_at: iso(now) }],
        [{ op: 'request.create', request_handle: `hdl_${'1'.repeat(32)}`, client_request_id: 'fixture', action: 'Question?',
          context: '', expires_in_seconds: 60, created_at: iso(now), expires_at: iso(now + 60000), pairing_snapshot: pairing }],
      ]) await seed.append(mutations);
    } finally { await seed.close(); }
    const before = await fs.readFile(paths.journalFile), unhandled = [];
    const witness = reason => unhandled.push(reason);
    process.on('unhandledRejection', witness); // Prearmed BEFORE the real scheduled fault.
    let fault = false, samples = 0, sweeps = 0, closedUses = 0, closes = 0;
    const order = [], handles = [], lockAtJournalClose = [], originalOpen = fs.open;
    fs.open = async function (path, ...args) {
      const fh = await originalOpen.call(this, path, ...args);
      if (String(path) === paths.journalFile) {
        const record = { closed: false }; handles.push(record);
        for (const method of ['read', 'write', 'sync', 'truncate', 'stat']) {
          const original = fh[method].bind(fh);
          fh[method] = (...a) => { if (record.closed) closedUses++; return original(...a); };
        }
        const close = fh.close.bind(fh);
        record.cleanup = async () => { if (!record.closed) { await close(); record.closed = true; } };
        fh.close = async () => {
          if (order.includes('listener')) lockAtJournalClose.push(await fs.access(paths.brokerLockFile).then(() => true, () => false));
          order.push('journal'); closes++; await close(); record.closed = true;
        };
      }
      return fh;
    }; syncBuiltinESMExports();
    let runtime, schedule, broker, journal;
    const clock = () => { samples++; if (fault) throw new Error('synthetic clock refusal'); return now; };
    const wrap = b => {
      broker = b;
      const sweep = b.scheduledSweep.bind(b), close = b.close.bind(b);
      b.scheduledSweep = () => { sweeps++; return sweep().finally(() => order.push('sweep-settled')); };
      b.close = () => { order.push('core'); return close(); };
    };
    const h = { paths, config, order, unhandled,
      get b() { return broker; }, get r() { return runtime; }, get s() { return schedule; },
      counts: () => ({ samples, sweeps, closedUses, closes }), fault: () => { fault = true; },
      async scheduler(options) {
        journal = await Journal.open(paths.journalFile);
        wrap(createPortableBroker({ journal, owners: config.owners, port: config.broker.port, clock }));
        await broker.recover(); assert.equal((await broker.status()).requests[0].resolution, 'pending');
        schedule = startExpirySchedule({ broker, ...options }); return schedule;
      },
      async runtime(logger) {
        runtime = await startPortableRuntime({ paths, config, clock, logger }); wrap(runtime.broker);
        assert.equal(runtime.ready, true);
        const r = await fetch(`http://127.0.0.1:${config.broker.port}/v1/adapter`, {
          method: 'POST', headers: { authorization: `Bearer ${owner}` }, body: '{}', signal: AbortSignal.timeout(2000),
        });
        assert.equal(r.status, 201); const registration = await r.json();
        assert.match(registration.registration_id, /^reg_/); return registration;
      },
      async close() { if (runtime) await runtime.stop(); else { await schedule?.stop(); await broker?.close(); await journal?.close(); } },
    };
    try {
      await work(h);
      assert.deepEqual(await fs.readFile(paths.journalFile), before, 'failed clock/callbacks never append');
    } finally {
      try {
        let allClosed;
        try { await h.close(); }
        finally {
          allClosed = handles.length > 0 && handles.every(r => r.closed);
          for (const record of handles) await record.cleanup(); // Owned fallback, never hides product close failure.
        }
        assert.ok(allClosed, 'all observed real Journal handles closed without fallback');
        assert.ok(lockAtJournalClose.every(Boolean), 'owned lock retained through journal close');
        assert.equal(closedUses, 0); assert.deepEqual(unhandled, []);
        await assert.rejects(fs.access(paths.brokerLockFile), { code: 'ENOENT' });
        const probe = createServer();
        try { await new Promise((yes, no) => { probe.once('error', no); probe.listen(config.broker.port, '127.0.0.1', yes); }); }
        finally { if (probe.listening) await new Promise(done => probe.close(done)); }
      } finally { fs.open = originalOpen; syncBuiltinESMExports(); process.off('unhandledRejection', witness); }
    }
  }, { totalMs: 20000 });
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}

for (const hook of ['onFailure', 'logger']) for (const mode of modes) {
  test(`CALLBACK-${hook}-${mode}: isolated return containment, real core latch, late settlement`, { timeout: 25000 }, () => fixture(async h => {
    assert.equal(SWEEP_INTERVAL_MS, 1000);
    const value = returned(mode), attempts = [], entry = [], refusals = [];
    const callback = name => (...args) => {
      attempts.push([name, args]);
      entry.push(h.s.failed); // Actual scheduler state, never a helper failure flag.
      refusals.push(h.b.status().catch(e => e)); // Actual authorized latch observation.
      queueMicrotask(() => { refusals.push(h.b.reserveHandle({ ownerId: 'a' }).catch(e => e)); });
      return name === hook ? value.call() : 'other hook ordinary control';
    };
    try {
      const schedule = await h.scheduler({ onFailure: callback('onFailure'), logger: callback('logger') });
      h.fault(); await observe(() => attempts.length === 2); await delay(20);
      assert.deepEqual(entry, [true, true]);
      assert.deepEqual(attempts, [['onFailure', []], ['logger', [message]]]);
      assert.equal(refusals.length, 4); assert.ok((await Promise.all(refusals)).every(storage));
      const atFailure = h.counts(); assert.equal(atFailure.sweeps, 1);
      await delay(2200); // Observe disabled scheduling BEFORE stop can clear a defective timer.
      assert.deepEqual(h.counts(), atFailure); assert.equal(attempts.length, 2);
      assert.deepEqual(h.unhandled, []);
      const stop = schedule.stop(); assert.equal(schedule.stop(), stop);
      await bounded(() => stop, 1500, 'callback returns must not block scheduler stop');
      assert.equal(schedule.stop(), stop); assert.deepEqual(h.unhandled, []);
      await h.close(); const beforeRelease = h.counts();
      assert.equal(beforeRelease.samples, atFailure.samples, 'latch/refused callback work never resamples');
      value.release(); await delay(2200);
      assert.deepEqual(h.counts(), beforeRelease, 'late settlement cannot revive timer or touch closed storage');
      assert.equal(schedule.failed, true); assert.equal(schedule.stop(), stop);
      assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
      assert.deepEqual(attempts, [['onFailure', []], ['logger', [message]]]);
      assert.deepEqual(h.unhandled, []);
      assert.equal(value.assimilations, mode.startsWith('then') ? 1 : 0);
    } finally { value.release(); }
  }));
}

for (const mode of modes) test(`CALLBACK-runtime-${mode}: current health and ordered real cleanup`, { timeout: 25000 }, () => fixture(async h => {
  const value = returned(mode), calls = [], health = [], refusals = [];
  let stop, registration, samplesAtEntry, closedRegistry = 0;
  const registryAuthorityAfterClose = [], stopIdentityDuringCallback = [];
  const originalClose = Server.prototype.close;
  const registryPrototype = Object.getPrototypeOf(createRegistrationRegistry());
  const registryClose = registryPrototype.close;
  Server.prototype.close = function (...args) {
    if (this.address()?.port === h.config.broker.port) h.order.push('listener');
    return originalClose.apply(this, args);
  };
  registryPrototype.close = function (...args) {
    const result = registryClose.apply(this, args); closedRegistry++;
    h.order.push('registrations');
    registryAuthorityAfterClose.push(this.authenticate({ ownerId: 'a', registrationId: registration?.registration_id, secret: registration?.registration_secret }));
    return result;
  };
  try {
    registration = await h.runtime((...args) => {
      if (args[0] !== message) return; // Registration setup logging is not a scheduling notification.
      calls.push(args); health.push(h.r.ready); h.order.push('callback-enter');
      samplesAtEntry = h.counts().samples;
      refusals.push(h.b.status().catch(e => e));
      stop = h.r.stop(); // Starts while callback is on stack; cleanup must await scheduler drain.
      stopIdentityDuringCallback.push(h.r.stop() === stop);
      health.push(h.r.ready);
      try { return value.call(); } finally { h.order.push('callback-exit'); }
    });
    h.fault(); await observe(() => calls.length === 1);
    assert.deepEqual(calls, [[message]]); assert.deepEqual(health, [false, false]);
    assert.deepEqual(stopIdentityDuringCallback, [true]);
    assert.ok(storage(await refusals[0])); assert.equal(h.r.stop(), stop);
    await bounded(() => stop, 1500, 'callback fault/pending return must not block runtime cleanup');
    assert.equal(h.r.stop(), stop); assert.equal(h.r.ready, false);
    assert.deepEqual(h.order, ['sweep-settled', 'callback-enter', 'callback-exit', 'registrations', 'listener', 'core', 'journal']);
    assert.equal(closedRegistry, 1); assert.deepEqual(registryAuthorityAfterClose, [false]);
    await assert.rejects(fs.access(h.paths.brokerLockFile), { code: 'ENOENT' });
    const beforeRelease = h.counts(); assert.equal(beforeRelease.sweeps, 1);
    assert.equal(beforeRelease.samples, samplesAtEntry, 'latched callback observation never samples clock');
    assert.deepEqual(h.unhandled, []); value.release(); await delay(2200);
    assert.deepEqual(h.counts(), beforeRelease); assert.equal(h.r.ready, false);
    assert.equal(h.r.stop(), stop); assert.deepEqual(calls, [[message]]);
    assert.deepEqual(h.unhandled, []); assert.equal(value.assimilations, mode.startsWith('then') ? 1 : 0);
  } finally {
    value.release();
    try { await h.close(); }
    finally { Server.prototype.close = originalClose; registryPrototype.close = registryClose; }
  }
}));
