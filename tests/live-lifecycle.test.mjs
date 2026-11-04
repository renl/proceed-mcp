// Runner safety contract only. Never run Telegram or application processes here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fakeDriver, fakeToken, plan, namespace, abortable, assertRedacted } from './fixtures/live-lifecycle-driver.mjs';

// Dynamic import keeps the missing implementation RED per case, not a skipped suite.
const run = async (p, d) => (await import('./support/live-run-lifecycle.mjs')).withLiveLifecycle(p, d);
const order = (calls, first, second) => assert.ok(calls.indexOf(first) >= 0
  && calls.indexOf(second) > calls.indexOf(first), `${first} before ${second}`);

test('CAL: controlled driver cannot access real resources and exposes deliberate failure', async () => {
  const f = fakeDriver({ execute: async () => { throw Error('calibration'); } });
  assert.deepEqual(await f.driver.preflight({}), { ready: true });
  await assert.rejects(f.driver.execute({}), /calibration/);
  assert.deepEqual(f.calls, ['preflight', 'execute']);
  assertRedacted({ phase: 'run', assertion: 'failed' });
  for (const disclosure of [{ error: fakeToken }, { env: { TELEGRAM_TOKEN: fakeToken } },
    { frames: [{ request_capability: fakeToken }] }]) {
    assert.throws(() => assertRedacted(disclosure), { code: 'ERR_ASSERTION' });
  }
});

test('AUTH: incomplete, expired or mismatched authority refuses before any effect', async () => {
  const changes = [
    p => { p.authorization = undefined; },
    ...['live', 'credentialAccess', 'consumeUpdates', 'exclusiveBot', 'noWebhook', 'privateHuman']
      .map(key => p => { p.authorization[key] = false; }),
    p => { p.authorization.expiresAt = Date.now() - 1; },
    ...['runId', 'port', 'candidate'].map(key => p => { p.authorization[key] = 'other'; }),
  ];
  for (const change of changes) {
    const p = plan(), f = fakeDriver(); change(p);
    const result = await run(p, f.driver);
    assert.equal(result.assertion, 'blocked');
    assert.equal(result.cleanup, 'not-needed');
    assert.deepEqual(f.calls, []);
  }
});

test('PLAN: reject path escape, alternate ports and unreachable deadline budgets', async () => {
  for (const change of [p => { p.runId = '../existing'; }, p => { p.runId = 'live-x/y'; },
    p => { p.port = 0; }, p => { p.port = 43190; },
    p => { p.limits.totalMs = 1; }, p => { p.limits.cleanupMs = 0; },
    p => { p.limits.setupMs = NaN; }, p => { p.limits.runMs = Infinity; },
    p => { p.limits.forceMs = -1; }, p => { p.limits.gracefulMs = 999; }]) {
    const p = plan(), f = fakeDriver(); change(p);
    Object.assign(p.authorization, { runId: p.runId, port: p.port });
    assert.equal((await run(p, f.driver)).assertion, 'blocked');
    assert.deepEqual(f.calls, []);
  }
});

test('PREFLIGHT: unknown ownership, listener, webhook or protection never reaches credentials', async () => {
  for (const preflight of [async () => ({ ready: false }), async () => { throw Error(fakeToken); }]) {
    const f = fakeDriver({ preflight });
    const result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'blocked');
    assert.equal(result.cleanup, 'not-needed');
    assert.ok(!f.calls.includes('reserve') && !f.calls.includes('acquireCredential'));
    assertRedacted([result, f.progress]);
  }
});

test('STATE: nonfresh or unprotected reservation stops before credential and preserves namespace', async () => {
  for (const reservation of [{ fresh: false, protected: true }, { fresh: true, protected: false }]) {
    const f = fakeDriver({ reserve: async () => reservation });
    const result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'failed');
    assert.equal(result.cleanup, 'passed');
    assert.ok(!f.calls.includes('acquireCredential'));
    order(f.calls, 'reserve', 'stop'); order(f.calls, 'stop', 'verifyStopped');
  }
});

test('ENV: broker-only token, no ambient credentials or preload in CLI/MCP, exact isolated paths', async () => {
  const p = plan(), f = fakeDriver();
  const result = await run(p, f.driver);
  assert.equal(result.assertion, 'passed'); assert.equal(result.cleanup, 'passed');
  const setup = f.contexts.find(c => c.name === 'setup').value;
  assert.equal(setup.directory, namespace(p));
  assert.equal(setup.state, `${namespace(p)}${process.platform === 'win32' ? '\\' : '/'}state`);
  assert.equal(setup.port, 43189);
  assert.equal(setup.environments.broker.PROCEED_TELEGRAM_BOT_TOKEN, fakeToken);
  for (const role of ['cli', 'mcp']) {
    const env = setup.environments[role];
    assert.ok(Object.keys(env).every(k => ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC',
      'TEMP', 'TMP', 'TMPDIR'].includes(k)));
    for (const key of ['TELEGRAM_TOKEN', 'PROCEED_TELEGRAM_BOT_TOKEN', 'NODE_OPTIONS', 'OPENCODE_PASSWORD'])
      assert.equal(env[key], undefined);
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[key], namespace(p));
  }
  assert.equal(setup.environments.broker.TELEGRAM_TOKEN, undefined);
  assert.equal(setup.environments.broker.NODE_OPTIONS, undefined);
  assertRedacted(f.contexts.filter(c => c.name !== 'setup'));
  order(f.calls, 'preflight', 'reserve'); order(f.calls, 'reserve', 'acquireCredential');
  order(f.calls, 'setup', 'execute'); order(f.calls, 'execute', 'stop');
  order(f.calls, 'stop', 'verifyStopped');
});

test('FAIL: partial setup and assertion failures still stop and verify, never expose raw diagnostics', async () => {
  for (const stage of ['reserve', 'acquireCredential', 'setup', 'execute']) {
    const f = fakeDriver({ [stage]: async () => { throw Error(fakeToken); } });
    const result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'failed'); assert.equal(result.cleanup, 'passed');
    assert.equal(f.calls.filter(n => n === 'stop').length, 1);
    assert.equal(f.calls.filter(n => n === 'verifyStopped').length, 1);
    assertRedacted([result, f.progress]);
    if (stage !== 'execute') assert.ok(!f.calls.includes('execute'));
  }
});

test('FAIL-CLOSED: empty credential or failed progress cannot start execution or skip teardown', async () => {
  for (const overrides of [{ acquireCredential: async () => '' },
    { progress: async (event) => { if (event.phase === 'run') throw Error(fakeToken); } }]) {
    const f = fakeDriver(overrides), result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'failed'); assert.equal(result.cleanup, 'passed');
    assert.ok(!f.calls.includes('execute'));
    order(f.calls, 'stop', 'verifyStopped');
    assertRedacted(result);
  }
});

test('TIME: setup/run timeout aborts work and leaves independent teardown time and signal', async () => {
  for (const stage of ['setup', 'execute']) {
    const f = fakeDriver({ [stage]: abortable });
    const start = performance.now(), result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'failed'); assert.equal(result.cleanup, 'passed');
    assert.ok(performance.now() - start < 1400, 'bounded aggregate including teardown');
    assert.equal(f.contexts.find(c => c.name === stage).value.signal.aborted, true);
    assert.equal(f.contexts.find(c => c.name === 'stop').value.signal.aborted, false);
  }
});

test('CLEAN: graceful failure or hang uses owned fallback then verifies all release evidence', async () => {
  for (const stop of [abortable, async () => { throw Error(fakeToken); }]) {
    const f = fakeDriver({ stop });
    const result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'passed'); assert.equal(result.cleanup, 'passed');
    order(f.calls, 'stop', 'forceStop'); order(f.calls, 'forceStop', 'verifyStopped');
  }
});

test('CLEAN-FAIL: no false pass for residual process, listener, lock or stalled cleanup', async () => {
  for (const key of ['processesAbsent', 'listenerReleased', 'ownershipReleased']) {
    const f = fakeDriver({ verifyStopped: async () => ({ processesAbsent: true,
      listenerReleased: true, ownershipReleased: true, [key]: false }) });
    const result = await run(plan(), f.driver);
    assert.equal(result.assertion, 'passed'); assert.equal(result.cleanup, 'failed');
  }
  const f = fakeDriver({ stop: abortable, forceStop: abortable, verifyStopped: abortable });
  const start = performance.now(), result = await run(plan(), f.driver);
  assert.equal(result.cleanup, 'failed');
  assert.ok(performance.now() - start < 1400);
});

test('PROGRESS: allowlisted phase evidence, no raw output, evidence/state retained on either outcome', async () => {
  for (const failed of [false, true]) {
    const f = fakeDriver(failed ? { execute: async () => { throw Error(fakeToken); } } : {});
    const result = await run(plan(), f.driver);
    assert.equal(result.retained, true);
    assert.deepEqual(f.progress.map(e => e.phase), ['setup', 'run', 'teardown', 'complete']);
    for (const event of f.progress) {
      assert.ok(Object.keys(event).every(k => ['phase', 'assertion', 'cleanup'].includes(k)));
    }
    assert.ok(!f.calls.some(n => /delete|remove|clear|drop/i.test(n)));
    assertRedacted([result, f.progress]);
  }
});
