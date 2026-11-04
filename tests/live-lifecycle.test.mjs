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

// A 700ms observation allows scheduling slack but cannot pass a 2000ms work timeout.
const cancellationPlan = () => {
  const p = plan();
  Object.assign(p.limits, { setupMs: 2000, runMs: 2000, totalMs: 4350 });
  return p;
};
const assertPromptCancellation = elapsed => assert.ok(elapsed < 700,
  'caller cancellation must settle comfortably before the 2000ms work deadline');

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
    const start = performance.now(), result = await run(cancellationPlan(), f.driver, { signal: c.signal });
    assertPromptCancellation(performance.now() - start);
    const reserved = !['preflight', 'progress'].includes(stage);
    assertResult(result, { assertion: reserved ? 'failed' : 'blocked', retained: reserved,
      cleanup: reserved ? 'passed' : 'not-needed', code: 'CANCELLED' });
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

// LIVE-ORCHESTRATION-001: malformed release evidence must still settle and report completion.
const assertVerificationCompletion = (result, progress, cleanup) => {
  assertResult(result, { assertion: 'passed', cleanup, retained: true,
    code: cleanup === 'passed' ? 'OK' : 'CLEANUP_FAILED' });
  assert.deepEqual(progress.map(event => event.phase), ['setup', 'run', 'teardown', 'complete']);
  assert.deepEqual(progress.at(-1), { phase: 'complete', assertion: 'passed', cleanup });
  assertRedacted([result, progress]);
};

test('CAL-VERIFY: completion oracle rejects false release, missing completion and raw leakage', () => {
  const result = { assertion: 'passed', cleanup: 'failed', retained: true, code: 'CLEANUP_FAILED' };
  const progress = [{ phase: 'setup' }, { phase: 'run' }, { phase: 'teardown' },
    { phase: 'complete', assertion: 'passed', cleanup: 'failed' }];
  assertVerificationCompletion(result, progress, 'failed');
  assert.throws(() => assertVerificationCompletion({ ...result, cleanup: 'passed' }, progress, 'failed'));
  assert.throws(() => assertVerificationCompletion(result, progress.slice(0, -1), 'failed'));
  assert.throws(() => assertVerificationCompletion({ ...result, error: fakeToken }, progress, 'failed'));
  assert.throws(() => assertVerificationCompletion(result,
    [{ phase: 'setup', error: fakeToken }, ...progress.slice(1)], 'failed'));
});

test('VERIFY-RAW: malformed release verdicts resolve redacted failed cleanup and complete progress',
  { timeout: 3000 }, async t => {
    const released = { processesAbsent: true, listenerReleased: true, ownershipReleased: true };
    const throwing = Object.defineProperty({}, 'processesAbsent', {
      get() { throw Error(fakeToken); },
    });
    for (const [name, verdict, cleanup] of [
      ['all release evidence true', released, 'passed'],
      ['null', null, 'failed'],
      ['undefined', undefined, 'failed'],
      ['missing fields', {}, 'failed'],
      ['truthy is not true', { ...released, listenerReleased: 'true' }, 'failed'],
      ['unreadable release field', throwing, 'failed'],
    ]) {
      await t.test(name, async () => {
        const f = fakeDriver({ verifyStopped: async () => verdict });
        const result = await run(plan(), f.driver);
        assertVerificationCompletion(result, f.progress, cleanup);
        assert.equal(f.calls.filter(name => name === 'stop').length, 1);
        assert.equal(f.calls.filter(name => name === 'verifyStopped').length, 1);
        assert.ok(!f.calls.includes('forceStop'), 'successful graceful stop needs no fallback');
        order(f.calls, 'stop', 'verifyStopped');
      });
    }
  });

// Final controller integration: selected private binding, no physical/public driver.
test('CANCEL-VALIDATION: competing invalid inputs precede listener registration and pre-abort', async t => {
  for (const [name, mutate, options, code] of [
    ['plan', p => { p.port = 0; }, { extra: true }, 'INVALID_PLAN'],
    ['authority', p => { p.authorization = undefined; }, { extra: true }, 'INVALID_AUTHORITY'],
    ['driver', () => {}, { extra: true }, 'INVALID_DRIVER'],
    ['options', () => {}, null, 'INVALID_OPTIONS'],
  ]) {
    await t.test(name, async () => {
      const c = callerCancellation(), p = plan(), f = fakeDriver(); c.abort(); mutate(p);
      if (name === 'plan') p.authorization = undefined;
      if (['plan', 'authority', 'driver'].includes(name)) delete f.driver.stop;
      const selected = options === null ? { signal: c.signal, extra: true } : { ...options, signal: c.signal };
      assertResult(await run(p, f.driver, selected), { assertion: 'blocked', cleanup: 'not-needed', retained: false, code });
      assert.deepEqual(f.calls, []);
      assert.deepEqual(c.counts, { add: 0, remove: 0 });
    });
  }
  const c = callerCancellation(), options = Object.assign(Object.create(null), { signal: c.signal });
  assertResult(await run(plan(), fakeDriver().driver, options), { assertion: 'passed', code: 'OK' });
  assert.equal(c.signal.aborted, false, 'controller must never abort the caller signal');
  assert.deepEqual(c.counts, { add: 1, remove: 1 });
  assert.equal(c.activeListeners.size, 0, 'remove the registered callback, not another callback');
});

test('CANCEL-SETTLEMENT: unfired caller listener is disposed on every ordinary outcome', { timeout: 3000 }, async t => {
  for (const [name, overrides, code] of [
    ['refusal', { preflight: async () => ({ ready: false }) }, 'PREFLIGHT_BLOCKED'],
    ['work error', { setup: async () => { throw Error(fakeToken); } }, 'WORK_FAILED'],
    ['timeout', { setup: noncooperative }, 'WORK_TIMEOUT'],
    ['progress error', { progress: async () => { throw Error(fakeToken); } }, 'PROGRESS_FAILED'],
    ['cleanup error', { verifyStopped: async () => null }, 'CLEANUP_FAILED'],
  ]) {
    await t.test(name, async () => {
      const c = callerCancellation(), f = fakeDriver(overrides);
      const result = await run(plan(), f.driver, { signal: c.signal }), snapshot = { ...result }, calls = [...f.calls];
      assertResult(result, { code });
      assert.equal(c.signal.aborted, false);
      assert.deepEqual(c.counts, { add: 1, remove: 1 });
      assert.equal(c.activeListeners.size, 0);
      c.abort(); await turn();
      assert.deepEqual(result, snapshot); assert.deepEqual(f.calls, calls);
    });
  }
});

test('CANCEL-COOPERATIVE: caller abort reaches pending work signal without forwarding caller authority', { timeout: 15000 }, async t => {
  for (const stage of ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute']) {
    await t.test(stage, async () => {
      const c = callerCancellation(), p = cancellationPlan();
      const f = fakeDriver({ [stage]: context => { queueMicrotask(c.abort); return abortable(context); } });
      const start = performance.now(), result = await run(p, f.driver, { signal: c.signal });
      assertPromptCancellation(performance.now() - start);
      const reserved = stage !== 'preflight';
      assertResult(result, { assertion: reserved ? 'failed' : 'blocked', retained: reserved,
        cleanup: reserved ? 'passed' : 'not-needed', code: 'CANCELLED' });
      for (const { name, value } of f.contexts) {
        assertContext(value, p, name === 'setup'); assert.notEqual(value.signal, c.signal);
        if (name === stage) assert.equal(value.signal.aborted, true);
      }
      assert.deepEqual(c.counts, { add: 1, remove: 1 });
      assert.equal(c.activeListeners.size, 0);
    });
  }
});

test('CANCEL-ABANDONED: late fulfillment and rejection at every effect/progress window are fenced',
  { timeout: 5000 }, async t => {
    const unhandled = [], listener = reason => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      for (const stage of ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute',
        'progress:setup', 'progress:run', 'progress:teardown', 'progress:complete', 'stop', 'forceStop', 'verifyStopped']) {
        for (const reject of [false, true]) {
          await t.test(`${stage} ${reject ? 'reject' : 'fulfill'}`, async () => {
            const c = callerCancellation(); let settleLate;
            const pending = () => new Promise((resolve, fail) => {
              settleLate = () => reject ? fail(Error(fakeToken)) : resolve(fakeToken);
              c.abort();
            });
            const overrides = stage.startsWith('progress:')
              ? { progress: event => event.phase === stage.split(':')[1] ? pending() : Promise.resolve() }
              : { [stage]: pending };
            if (stage === 'forceStop') overrides.stop = noncooperative;
            const f = fakeDriver(overrides), result = await run(plan(), f.driver, { signal: c.signal });
            const snapshot = { ...result }, calls = [...f.calls];
            settleLate(); await turn(); await turn();
            const reserved = !['preflight', 'progress:setup'].includes(stage);
            assertResult(result, { assertion: reserved ? 'failed' : 'blocked', retained: reserved,
              cleanup: stage === 'verifyStopped' ? 'failed' : reserved ? 'passed' : 'not-needed',
              code: stage === 'verifyStopped' ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED' });
            assert.deepEqual(result, snapshot); assert.deepEqual(f.calls, calls);
            assert.equal(f.calls.filter(name => name === 'stop').length, reserved ? 1 : 0);
            assert.equal(f.calls.filter(name => name === 'verifyStopped').length, reserved ? 1 : 0);
            if (['preflight', 'reserve', 'acquireCredential', 'setup', 'progress:setup', 'progress:run'].includes(stage)) {
              assert.ok(!f.calls.includes('execute'));
            }
            assert.deepEqual(c.counts, { add: 1, remove: 1 });
            assert.equal(c.activeListeners.size, 0); assertRedacted(f.progress);
          });
        }
      }
      assert.deepEqual(unhandled, []);
    } finally { process.removeListener('unhandledRejection', listener); }
  });

test('CAL-CANCEL-PROMPT: valid long budgets and prompt oracle reject deadline-only settlement', () => {
  assert.equal(validatePlan(cancellationPlan()).ok, true);
  assertPromptCancellation(0);
  assert.throws(() => assertPromptCancellation(2000), { code: 'ERR_ASSERTION' });
});

test('CANCEL-SETUP-FULFILLED: successful setup cancellation fences execute and disposes its callback', async () => {
  const c = callerCancellation(), f = fakeDriver({ setup: async () => { c.abort(); } });
  const result = await run(cancellationPlan(), f.driver, { signal: c.signal });
  assert.ok(!f.calls.includes('execute'), 'fulfilled cancelled setup must never schedule execute');
  assertResult(result, { assertion: 'failed', cleanup: 'passed', retained: true, code: 'CANCELLED' });
  assert.equal(f.calls.filter(name => name === 'setup').length, 1);
  assert.equal(f.calls.filter(name => name === 'stop').length, 1);
  assert.equal(f.calls.filter(name => name === 'verifyStopped').length, 1);
  assert.ok(!f.calls.includes('forceStop'));
  order(f.calls, 'setup', 'stop'); order(f.calls, 'stop', 'verifyStopped');
  assert.deepEqual(c.counts, { add: 1, remove: 1 });
  assert.equal(c.activeListeners.size, 0);
  const calls = [...f.calls], snapshot = { ...result };
  c.abort(); await turn();
  assert.deepEqual(f.calls, calls); assert.deepEqual(result, snapshot);
});

test('CANCEL-RESERVES: cancellation during each cleanup effect preserves independent signals and verification',
  { timeout: 5000 }, async t => {
    for (const stage of ['stop', 'forceStop', 'verifyStopped']) {
      await t.test(stage, async () => {
        const c = callerCancellation(), p = plan(); let remaining;
        const f = fakeDriver({ stop: noncooperative, forceStop: noncooperative,
          verifyStopped: async context => {
            remaining = context.deadline - performance.now();
            return { processesAbsent: true, listenerReleased: true, ownershipReleased: true };
          }, [stage]: context => { c.abort(); assert.equal(context.signal.aborted, false); return noncooperative(); } });
        const start = performance.now(), result = await run(p, f.driver, { signal: c.signal });
        assertResult(result, { assertion: 'failed', cleanup: stage === 'verifyStopped' ? 'failed' : 'passed',
          retained: true, code: stage === 'verifyStopped' ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED' });
        assert.ok(performance.now() - start < 1400);
        order(f.calls, 'stop', 'forceStop'); order(f.calls, 'forceStop', 'verifyStopped');
        const contexts = ['stop', 'forceStop', 'verifyStopped'].map(name => f.contexts.find(c => c.name === name).value);
        assert.equal(new Set(contexts.map(context => context.signal)).size, 3);
        for (const context of contexts) assert.notEqual(context.signal, c.signal);
        assert.equal(contexts[0].signal.aborted, true); assert.equal(contexts[1].signal.aborted, true);
        assert.equal(contexts[2].signal.aborted, stage === 'verifyStopped');
        if (stage !== 'verifyStopped') assert.ok(remaining >= 90, 'verification keeps its usable reserve');
        assert.deepEqual(c.counts, { add: 1, remove: 1 }); assert.equal(c.activeListeners.size, 0);
      });
    }
  });

// LIVE-CANCELLATION-001: direct fulfillment must not conceal a cancelled dispatch.
test('CANCEL-RUN-FULFILLED: successful progress fences execute and releases owned timers/listener',
  { timeout: 3000 }, async t => {
    for (const cancel of [false, true]) {
      await t.test(cancel ? 'cancelled progress forbids execute' : 'uncancelled progress permits execute', async t => {
        const c = callerCancellation(), f = fakeDriver(), active = new Set();
        const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
        let created = 0, cleared = 0;
        t.mock.method(globalThis, 'setTimeout', (...args) => {
          const timer = set(...args); active.add(timer); created++; return timer;
        });
        t.mock.method(globalThis, 'clearTimeout', timer => {
          if (active.delete(timer)) cleared++;
          return clear(timer);
        });
        try {
          // Deliberately bypass the fixture's extra async wrapper for this allowed return order.
          f.driver.progress = async event => {
            f.calls.push('progress'); f.progress.push(event);
            if (event.phase === 'run' && cancel) c.abort();
          };
          const start = performance.now();
          const result = await run(cancellationPlan(), f.driver, { signal: c.signal });
          assertPromptCancellation(performance.now() - start);
          assertResult(result, { assertion: cancel ? 'failed' : 'passed', cleanup: 'passed',
            retained: true, code: cancel ? 'CANCELLED' : 'OK' });
          for (const stage of ['setup', 'stop', 'verifyStopped']) {
            assert.equal(f.calls.filter(name => name === stage).length, 1, stage);
          }
          assert.ok(!f.calls.includes('forceStop'));
          order(f.calls, 'setup', 'stop'); order(f.calls, 'stop', 'verifyStopped');
          for (const stage of ['stop', 'verifyStopped']) {
            assert.equal(f.contexts.find(context => context.name === stage).value.signal.aborted, false);
          }
          assert.deepEqual(c.counts, { add: 1, remove: 1 });
          assert.equal(c.activeListeners.size, 0);
          assert.ok(created > 0); assert.equal(cleared, created); assert.equal(active.size, 0);
          assertRedacted([result, f.progress]);
          const calls = [...f.calls], snapshot = { ...result };
          c.abort(); await turn(); await turn();
          assert.deepEqual(f.calls, calls); assert.deepEqual(result, snapshot);
          assert.equal(active.size, 0);
          assert.equal(f.calls.filter(name => name === 'execute').length, cancel ? 0 : 1,
            'fulfilled run progress must not admit execute after observed caller cancellation');
        } finally {
          for (const timer of active) clear(timer);
          t.mock.restoreAll();
        }
      });
    }
  });

test('CANCEL-PRECEDENCE: cancellation supersedes work/progress failure but never erases cleanup failure',
  { timeout: 4000 }, async t => {
    for (const primary of ['error', 'timeout', 'progress']) {
      for (const cleanupFailed of [false, true]) {
        await t.test(`${primary} cleanup ${cleanupFailed ? 'failed' : 'passed'}`, async () => {
          const c = callerCancellation();
          const overrides = primary === 'progress'
            ? { progress: async event => { if (event.phase === 'run') throw Error(fakeToken); } }
            : { execute: primary === 'timeout' ? noncooperative : async () => { throw Error(fakeToken); } };
          const f = fakeDriver({ ...overrides, stop: async () => { c.abort(); },
            verifyStopped: async () => ({ processesAbsent: !cleanupFailed, listenerReleased: true, ownershipReleased: true }) });
          assertResult(await run(plan(), f.driver, { signal: c.signal }), { assertion: 'failed', retained: true,
            cleanup: cleanupFailed ? 'failed' : 'passed', code: cleanupFailed ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED' });
          assert.equal(f.calls.filter(name => name === 'verifyStopped').length, 1);
          assert.deepEqual(c.counts, { add: 1, remove: 1 }); assert.equal(c.activeListeners.size, 0);
        });
      }
    }
  });
