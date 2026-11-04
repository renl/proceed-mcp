// Runner safety contract only. Never run Telegram or application processes here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { validatePlan, buildContext, buildEnvironments, resolveOutcome } from './support/live-run-plan.mjs';
import { fakeDriver, fakeToken, plan, namespace, abortable, assertRedacted,
  noncooperative, turn, assertResult, assertContext, callerCancellation } from './fixtures/live-lifecycle-driver.mjs';

// Orchestration allocation: openspec/changes/add-telegram-approval-opencode-v2/slices/03c3t-bounded-orchestration.md
// Dynamic import keeps the missing implementation RED per case, not a skipped suite.
const run = async (p, d, options) => (await import('./support/live-run-lifecycle.mjs')).withLiveLifecycle(p, d, options);
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

test('CAL-STRICT: positive controls and deliberate result/context/listener faults', async () => {
  const p = plan(), result = { assertion: 'failed', cleanup: 'failed', retained: true,
    code: 'CANCELLED_CLEANUP_FAILED' };
  assertResult(result, result);
  assert.throws(() => assertResult({ ...result, raw: fakeToken }, result));
  assert.throws(() => assertResult({ ...result, cleanup: 'passed' }, result));
  const context = { directory: namespace(p), state: `${namespace(p)}/state`, port: p.port,
    candidate: p.candidate, deadline: performance.now() + 100, signal: new AbortController().signal };
  // Use the platform path from the oracle without touching the filesystem.
  context.state = namespace(p) + (process.platform === 'win32' ? '\\state' : '/state');
  assertContext(context, p);
  for (const extra of [{ authorization: p.authorization }, { environment: p.environment },
    { callerSignal: context.signal }, { token: fakeToken }]) {
    assert.throws(() => assertContext({ ...context, ...extra }, p));
  }
  const c = callerCancellation(), listener = () => {};
  c.signal.addEventListener('abort', listener);
  c.abort(); c.signal.removeEventListener('abort', listener);
  assert.deepEqual(c.counts, { add: 1, remove: 1 });
  assert.throws(() => c.signal.reason, /must not be read/);
  const controller = new AbortController(), pending = noncooperative({ signal: controller.signal });
  controller.abort();
  assert.equal(await Promise.race([pending.then(() => 'settled'), delay(10, 'pending')]), 'pending');
  const cooperative = new AbortController(), rejected = abortable({ signal: cooperative.signal });
  const observed = assert.rejects(rejected, /SYNTHETIC-private-error/);
  cooperative.abort(); await observed;
});

test('BUDGET: every work effect and stalled progress is bounded even without cooperation', { timeout: 15000 }, async () => {
  for (const stage of ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute', 'progress']) {
    const p = plan(), f = fakeDriver({ [stage]: noncooperative }), start = performance.now();
    const result = await run(p, f.driver);
    assert.ok(performance.now() - start < 1400, stage);
    const reserved = !['preflight', 'progress'].includes(stage);
    assertResult(result, { assertion: stage === 'preflight' ? 'blocked' : 'failed',
      cleanup: reserved ? 'passed' : 'not-needed', retained: reserved });
    assert.ok(!f.calls.includes('execute') || stage === 'execute');
    if (reserved) order(f.calls, 'stop', 'verifyStopped');
  }
});

test('RESERVES: stalled teardown progress/stop/force cannot consume verification time', { timeout: 5000 }, async () => {
  let verificationRemaining;
  const p = plan(), f = fakeDriver({ stop: noncooperative, forceStop: noncooperative,
    verifyStopped: async context => {
      verificationRemaining = context.deadline - performance.now();
      return { processesAbsent: true, listenerReleased: true, ownershipReleased: true };
    },
    progress: event => event.phase === 'teardown' || event.phase === 'complete'
      ? noncooperative() : Promise.resolve() });
  const start = performance.now(), result = await run(p, f.driver);
  assertResult(result, { assertion: 'failed', cleanup: 'passed', retained: true });
  assert.ok(performance.now() - start < 1400);
  order(f.calls, 'stop', 'forceStop'); order(f.calls, 'forceStop', 'verifyStopped');
  const verification = f.contexts.find(c => c.name === 'verifyStopped').value;
  assert.ok(verification.deadline - start >= p.limits.gracefulMs + p.limits.forceMs);
  assert.equal(verification.signal.aborted, false);
  assert.ok(verificationRemaining >= 90, 'verification retains its own usable reserve');
});

test('PHASE: setup budget is shared across effects, never restarted per method', { timeout: 3000 }, async () => {
  const f = fakeDriver({ preflight: async () => { await delay(65); return { ready: true }; },
    reserve: async () => { await delay(65); return { fresh: true, protected: true }; },
    acquireCredential: async () => { await delay(65); return fakeToken; } });
  assertResult(await run(plan(), f.driver), { assertion: 'failed', cleanup: 'passed',
    retained: true, code: 'WORK_TIMEOUT' });
  assert.ok(!f.calls.includes('setup') && !f.calls.includes('execute'));
  const deadlines = f.contexts.filter(c => ['preflight', 'reserve', 'acquireCredential'].includes(c.name))
    .map(c => c.value.deadline);
  assert.ok(deadlines.length >= 2);
  assert.equal(new Set(deadlines).size, 1);
  await delay(70); // Drain the deliberately late synthetic acquisition, no owned resource.
});

test('ISOLATION: exact contexts and all three environments, no retained plan/authority', async () => {
  const p = plan(), f = fakeDriver();
  assertResult(await run(p, f.driver), { assertion: 'passed', cleanup: 'passed', retained: true, code: 'OK' });
  for (const { name, value } of f.contexts) assertContext(value, p, name === 'setup');
  const environments = f.contexts.find(c => c.name === 'setup').value.environments;
  const base = { PATH: p.environment.PATH, SystemRoot: p.environment.SystemRoot,
    TEMP: namespace(p), TMP: namespace(p), TMPDIR: namespace(p) };
  assert.deepEqual(environments, { broker: { ...base, PROCEED_TELEGRAM_BOT_TOKEN: fakeToken },
    cli: base, mcp: base });
  const refused = fakeDriver({ preflight: async () => ({ ready: false }) });
  assertResult(await run(plan(), refused.driver), { assertion: 'blocked', cleanup: 'not-needed', retained: false });
});

test('LATE: timed-out setup rejection cannot execute or escape as an unhandled rejection', { timeout: 3000 }, async () => {
  let rejectLate;
  const unhandled = [], listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    const f = fakeDriver({ setup: () => new Promise((_, reject) => { rejectLate = reject; }) });
    assertResult(await run(plan(), f.driver), { assertion: 'failed', cleanup: 'passed', retained: true });
    rejectLate(Error(fakeToken)); await turn(); await turn();
    assert.deepEqual(unhandled, []);
    assert.equal(f.calls.filter(n => n === 'stop').length, 1);
    assert.ok(!f.calls.includes('execute'));
  } finally { process.removeListener('unhandledRejection', listener); }
});

test('CANCEL-OPTIONS: strict options validation precedes cancellation and all effects', async () => {
  for (const options of [false, [], { signal: {} }, { signal: null }, { extra: true },
    { [Symbol('extra')]: true }, Object.create({ signal: new AbortController().signal }),
    Object.defineProperty({}, 'signal', { get() { throw Error(fakeToken); } })]) {
    const f = fakeDriver();
    assertResult(await run(plan(), f.driver, options), { assertion: 'blocked', cleanup: 'not-needed',
      retained: false, code: 'INVALID_OPTIONS' });
    assert.deepEqual(f.calls, []);
  }
  for (const options of [undefined, null, {}, { signal: undefined }]) {
    assertResult(await run(plan(), fakeDriver().driver, options), { assertion: 'passed', code: 'OK' });
  }
  const c = callerCancellation(); c.abort();
  const p = plan(); p.port = 0;
  assertResult(await run(p, fakeDriver().driver, { signal: c.signal }), { code: 'INVALID_PLAN' });
});

test('CANCEL-EARLY: pre-aborted caller owns no namespace, listener or effect', async () => {
  const c = callerCancellation(), f = fakeDriver(); c.abort();
  assertResult(await run(plan(), f.driver, { signal: c.signal }), { assertion: 'blocked',
    cleanup: 'not-needed', retained: false, code: 'CANCELLED' });
  assert.deepEqual(f.calls, []); assert.deepEqual(c.counts, { add: 0, remove: 0 });
});

test('CANCEL-PENDING: cancellation fences every pending effect and independently cleans attempted reservation', { timeout: 15000 }, async () => {
  for (const stage of ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute', 'progress']) {
    const c = callerCancellation(), f = fakeDriver({ [stage]: () => { c.abort(); return noncooperative(); } });
    const start = performance.now(), result = await run(plan(), f.driver, { signal: c.signal });
    const reserved = !['preflight', 'progress'].includes(stage);
    assertResult(result, { assertion: reserved ? 'failed' : 'blocked', retained: reserved,
      cleanup: reserved ? 'passed' : 'not-needed', code: 'CANCELLED' });
    assert.ok(performance.now() - start < 400, 'caller cancellation must not wait for work deadline');
    assert.deepEqual(c.counts, { add: 1, remove: 1 });
    for (const { name, value } of f.contexts) {
      assert.notEqual(value.signal, c.signal);
      if (name === stage) assert.equal(value.signal.aborted, true);
      if (['stop', 'verifyStopped', 'forceStop'].includes(name)) assert.equal(value.signal.aborted, false);
    }
    if (reserved) order(f.calls, 'stop', 'verifyStopped');
    assert.ok(!f.calls.includes('execute') || stage === 'execute');
  }
});

test('CANCEL-CLEANUP: retain both cancellation and cleanup failure, caller cannot cancel cleanup', async () => {
  for (const failed of [false, true]) {
    const c = callerCancellation(), f = fakeDriver({ stop: async context => {
      c.abort(); assert.equal(context.signal.aborted, false);
    }, verifyStopped: async context => {
      assert.equal(context.signal.aborted, false);
      return { processesAbsent: !failed, listenerReleased: true, ownershipReleased: true };
    } });
    assertResult(await run(plan(), f.driver, { signal: c.signal }), { assertion: 'failed',
      cleanup: failed ? 'failed' : 'passed', retained: true,
      code: failed ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED' });
    assert.deepEqual(c.counts, { add: 1, remove: 1 });
  }
});

test('CANCEL-PROGRESS: every progress window is cancellable without cancelling cleanup', { timeout: 5000 }, async () => {
  for (const phase of ['setup', 'run', 'teardown', 'complete']) {
    const c = callerCancellation(), f = fakeDriver({ progress: event => {
      if (event.phase === phase) { c.abort(); return noncooperative(); }
      return Promise.resolve();
    } });
    const reserved = phase !== 'setup', result = await run(plan(), f.driver, { signal: c.signal });
    assertResult(result, { assertion: reserved ? 'failed' : 'blocked', retained: reserved,
      cleanup: reserved ? 'passed' : 'not-needed', code: 'CANCELLED' });
    assert.deepEqual(c.counts, { add: 1, remove: 1 });
    if (reserved) order(f.calls, 'stop', 'verifyStopped');
  }
});

test('CANCEL-LATE: listener removed on success and late cancelled work cannot revive execution', async () => {
  const normal = callerCancellation(), good = fakeDriver();
  const result = await run(plan(), good.driver, { signal: normal.signal });
  assertResult(result, { assertion: 'passed', code: 'OK' });
  normal.abort(); await turn(); assertResult(result, { assertion: 'passed', code: 'OK' });
  assert.deepEqual(normal.counts, { add: 1, remove: 1 });
  const unhandled = [], listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    for (const reject of [false, true]) {
      const c = callerCancellation(); let settleLate;
      const f = fakeDriver({ setup: () => new Promise((resolve, fail) => {
        settleLate = reject ? () => fail(Error(fakeToken)) : resolve; c.abort();
      }) });
      assertResult(await run(plan(), f.driver, { signal: c.signal }), { code: 'CANCELLED', retained: true });
      settleLate(); await turn(); await turn();
      assert.ok(!f.calls.includes('execute'));
      assert.equal(f.calls.filter(n => n === 'stop').length, 1);
      assert.deepEqual(c.counts, { add: 1, remove: 1 });
    }
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', listener); }
});

test('LIMITS: all budgets finite positive integers, setup/run/cleanup and fallback/verification reachable', async () => {
  for (const key of ['totalMs', 'setupMs', 'runMs', 'cleanupMs', 'gracefulMs', 'forceMs']) {
    for (const value of [undefined, 0, -1, NaN, Infinity, 1.5, '10']) {
      const p = plan(), f = fakeDriver(); p.limits[key] = value;
      assertResult(await run(p, f.driver), { code: 'INVALID_PLAN', retained: false });
      assert.deepEqual(f.calls, []);
    }
  }
  for (const change of [p => { p.limits.totalMs--; },
    p => { p.limits.forceMs = p.limits.cleanupMs - p.limits.gracefulMs; }]) {
    const p = plan(), f = fakeDriver(); change(p);
    assertResult(await run(p, f.driver), { code: 'INVALID_PLAN', retained: false });
    assert.deepEqual(f.calls, []);
  }
});

test('VERIFY: noncooperative verification and failed forced stop never fabricate release', { timeout: 5000 }, async () => {
  for (const overrides of [{ verifyStopped: noncooperative },
    { stop: noncooperative, forceStop: async () => { throw Error(fakeToken); },
      verifyStopped: async () => ({ processesAbsent: false, listenerReleased: false, ownershipReleased: false }) }]) {
    const f = fakeDriver(overrides), start = performance.now();
    assertResult(await run(plan(), f.driver), { assertion: 'passed', cleanup: 'failed',
      retained: true, code: 'CLEANUP_FAILED' });
    assert.ok(performance.now() - start < 1400);
    assert.equal(f.calls.filter(n => n === 'verifyStopped').length, 1);
  }
});

test('CAL-PLAN: accepted actual pure module supplies isolated contexts and fixed outcomes', () => {
  const p = plan(), validated = validatePlan(p);
  assert.equal(validated.ok, true);
  const signal = new AbortController().signal;
  const environments = buildEnvironments(validated.value, fakeToken);
  assertContext(buildContext(validated.value, { deadline: 123, signal, environments }), p, true);
  assert.deepEqual(environments.cli, { PATH: p.environment.PATH, SystemRoot: p.environment.SystemRoot,
    TEMP: namespace(p), TMP: namespace(p), TMPDIR: namespace(p) });
  assertResult(resolveOutcome({ validationCode: null, cancelled: false, reserved: true,
    work: 'timeout', progressFailed: false, cleanup: 'passed' }),
  { assertion: 'failed', cleanup: 'passed', retained: true, code: 'WORK_TIMEOUT' });
});

test('OUTCOMES: controller agrees with actual pure outcomes for refusals and partial failure', async () => {
  for (const [change, code] of [[p => { p.port = 0; }, 'INVALID_PLAN'],
    [p => { p.authorization = undefined; }, 'INVALID_AUTHORITY']]) {
    const p = plan(), f = fakeDriver(); change(p);
    assertResult(await run(p, f.driver), { assertion: 'blocked', cleanup: 'not-needed', retained: false, code });
    assert.deepEqual(f.calls, []);
  }
  for (const [overrides, reserved, work] of [
    [{ preflight: async () => ({ ready: false }) }, false, 'refused'],
    [{ reserve: async () => { throw Error(fakeToken); } }, true, 'failed'],
    [{ acquireCredential: async () => '' }, true, 'failed'],
    [{}, true, 'ok']]) {
    const expected = resolveOutcome({ validationCode: null, cancelled: false, reserved, work,
      progressFailed: false, cleanup: reserved ? 'passed' : 'not-needed' });
    assertResult(await run(plan(), fakeDriver(overrides).driver), expected);
  }
  for (const change of [d => { delete d.stop; }, d => { d.execute = null; }]) {
    const f = fakeDriver(); change(f.driver);
    assertResult(await run(plan(), f.driver), { assertion: 'blocked', cleanup: 'not-needed',
      retained: false, code: 'INVALID_DRIVER' });
    assert.deepEqual(f.calls, []);
  }
});

test('RUN-SHARED: run progress spends the execute budget rather than restarting it', { timeout: 3000 }, async () => {
  const p = plan(); p.limits.runMs = 100;
  let entered, progressStart;
  const f = fakeDriver({ progress: async event => {
    if (event.phase === 'run') { progressStart = performance.now(); await delay(7); }
  },
    execute: context => { entered = { now: performance.now(), deadline: context.deadline }; return noncooperative(); } });
  assertResult(await run(p, f.driver), { assertion: 'failed', cleanup: 'passed', retained: true, code: 'WORK_TIMEOUT' });
  assert.ok(entered.deadline <= progressStart + p.limits.runMs, 'progress time deducted from run');
  assert.equal(f.contexts.find(c => c.name === 'execute').value.signal.aborted, true);
});

test('PROGRESS-WINDOWS: each failed persistence is fixed/redacted and cannot skip cleanup', async () => {
  for (const phase of ['setup', 'run', 'teardown', 'complete']) {
    const f = fakeDriver({ progress: async event => { if (event.phase === phase) throw Error(fakeToken); } });
    const reserved = phase !== 'setup';
    assertResult(await run(plan(), f.driver), { assertion: 'failed',
      cleanup: reserved ? 'passed' : 'not-needed', retained: reserved, code: 'PROGRESS_FAILED' });
    if (reserved) {
      assert.equal(f.calls.filter(n => n === 'stop').length, 1);
      assert.equal(f.calls.filter(n => n === 'verifyStopped').length, 1);
    } else assert.ok(!f.calls.includes('reserve'));
    assertRedacted(f.progress);
  }
});

test('LATE-ALL: deadline-abandoned fulfillment/rejection cannot change settled results or resume work', { timeout: 10000 }, async () => {
  const unhandled = [], listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    for (const stage of ['reserve', 'acquireCredential', 'setup', 'execute']) {
      for (const reject of [false, true]) {
        let settle;
        const f = fakeDriver({ [stage]: () => new Promise((resolve, fail) => {
          settle = () => reject ? fail(Error(fakeToken)) : resolve(fakeToken);
        }) });
        const result = await run(plan(), f.driver), snapshot = { ...result }, calls = [...f.calls];
        assertResult(result, { assertion: 'failed', cleanup: 'passed', retained: true, code: 'WORK_TIMEOUT' });
        settle(); await turn(); await turn();
        assert.deepEqual(result, snapshot); assert.deepEqual(f.calls, calls);
        assert.equal(f.calls.filter(n => n === 'stop').length, 1);
      }
    }
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', listener); }
});
