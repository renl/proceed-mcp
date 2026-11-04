// TEST ONLY. Pure decisions, not lifecycle scheduling, containment or live proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';

const load = () => import('./support/live-run-plan.mjs');
const token = 'SYNTHETIC-pure-plan-token';
const limits = () => ({ totalMs: 1000, setupMs: 150, runMs: 500, cleanupMs: 350, gracefulMs: 100, forceMs: 100 });
const input = () => ({ worktree: resolve('.'), runId: 'live-pure', candidate: 'a'.repeat(40), port: 43189,
  environment: { PATH: 'synthetic', NODE_OPTIONS: token, TELEGRAM_TOKEN: token }, limits: limits() });
const authority = p => ({ live: true, credentialAccess: true, consumeUpdates: true, exclusiveBot: true,
  noWebhook: true, privateHuman: true, runId: p.runId, port: p.port, candidate: p.candidate, expiresAt: 101 });
const frozen = value => { assert.ok(Object.isFrozen(value)); return value; };
const failure = (value, code) => { assert.deepEqual(frozen(value), { ok: false, code }); };
const success = result => { assert.equal(frozen(result).ok, true); return result.value; };
const throws = (fn, code, message) => assert.throws(fn, e => e instanceof TypeError && e.code === code && e.message === message);
const buildError = (fn, message) => throws(fn, 'INVALID_BUILD_INPUT', message);
const unvalidated = fn => throws(fn, 'UNVALIDATED_PLAN', 'plan must be the frozen object returned by validatePlan');
const getter = key => Object.defineProperty({}, key, { enumerable: true, get() { throw Error(token); } });
const badShapes = () => [undefined, null, true, 1, '', [], () => {}, new Date(0), new Map(),
  new Number(1), Object.create({ inherited: true }), { [Symbol('x')]: true }, getter('x')];
const baseFacts = () => ({ validationCode: null, cancelled: false, reserved: true, work: 'ok', progressFailed: false, cleanup: 'passed' });
const result = (assertion, cleanup, retained, code) => ({ assertion, cleanup, retained, code });
const checkResult = (actual, expected) => assert.deepEqual(frozen(actual), expected);

test('CAL-PURE: exact outcome, frozen wrapper and disclosure discriminators reject mutations', () => {
  const expected = result('failed', 'failed', true, 'CANCELLED_CLEANUP_FAILED');
  checkResult(Object.freeze({ ...expected }), expected);
  for (const mutation of [{ ...expected, cleanup: 'passed' }, { ...expected, raw: token }])
    assert.throws(() => checkResult(Object.freeze(mutation), expected), { code: 'ERR_ASSERTION' });
  assert.throws(() => checkResult({ ...expected }, expected), { code: 'ERR_ASSERTION' });
  assert.throws(() => assert.ok(!JSON.stringify({ token }).includes(token)), { code: 'ERR_ASSERTION' });
});

test('PURE-PLAN: constants, exact sanitized paths, optional authority and copied safe environment', async () => {
  const m = await load(), p = input();
  assert.equal(m.LIVE_PORT, 43189); assert.equal(m.RUN_ID_PATTERN.source, '^live-[a-z0-9-]{1,40}$');
  assert.equal(m.RUN_ID_PATTERN.flags, '');
  p.authorization = token;
  for (const key of ['PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']) p.environment[key] = key;
  const before = structuredClone(p), v = success(m.validatePlan(p));
  const directory = join(p.worktree, '.scratch', 'portable-live', p.runId);
  assert.deepEqual(frozen(v), { worktree: p.worktree, runId: p.runId, candidate: p.candidate, port: 43189,
    directory, state: join(directory, 'state'), limits: limits(), environment: {
      PATH: 'synthetic', PATHEXT: 'PATHEXT', SystemRoot: 'SystemRoot', WINDIR: 'WINDIR', COMSPEC: 'COMSPEC' } });
  frozen(v.limits); frozen(v.environment); assert.notEqual(v.limits, p.limits); assert.notEqual(v.environment, p.environment);
  assert.deepEqual(p, before); assert.ok(!Object.isFrozen(p)); assert.ok(!JSON.stringify(v).includes(token));
  const empty = input(); empty.environment = Object.create(null);
  assert.deepEqual(success(m.validatePlan(empty)).environment, {});
  for (const runId of ['live-a', `live-${'a'.repeat(40)}`]) success(m.validatePlan({ ...input(), runId }));
});

test('PURE-VALIDATE: total shape refusal, descriptors never execute and cycles terminate', async () => {
  const m = await load(), p = success(m.validatePlan(input()));
  const cyclic = {}; cyclic.self = cyclic;
  for (const [fn, code] of [[m.validatePlan, 'INVALID_PLAN'], [m.validateLimits, 'INVALID_PLAN'],
    [v => m.validateAuthority(v, p, 100), 'INVALID_AUTHORITY'], [m.validateDriver, 'INVALID_DRIVER'],
    [m.validateOptions, 'INVALID_OPTIONS']]) {
    for (const v of [...badShapes(), cyclic]) {
      if (fn === m.validateOptions && (v === undefined || v === null)) continue;
      failure(fn(v), code);
    }
  }
  for (const key of Object.keys(input())) {
    const p = input(); delete p[key]; failure(m.validatePlan(p), 'INVALID_PLAN');
    const accessor = input(); Object.defineProperty(accessor, key, { get() { throw Error(token); } });
    failure(m.validatePlan(accessor), 'INVALID_PLAN');
  }
  for (const key of ['authorization', 'ignored']) {
    const p = input(); const target = key === 'authorization' ? p : p.environment;
    Object.defineProperty(target, key, { get() { throw Error(token); } });
    failure(m.validatePlan(p), 'INVALID_PLAN');
  }
});

test('PURE-LIMITS: exact positive safe integers and reachable reserve', async () => {
  const m = await load(); assert.deepEqual(frozen(success(m.validateLimits(limits()))), limits());
  for (const key of Object.keys(limits())) {
    const missing = limits(); delete missing[key]; failure(m.validateLimits(missing), 'INVALID_PLAN');
    for (const value of [undefined, 0, -1, NaN, Infinity, 1.5, '10', Number.MAX_SAFE_INTEGER + 1])
      failure(m.validateLimits({ ...limits(), [key]: value }), 'INVALID_PLAN');
  }
  for (const patch of [{ extra: 1 }, { totalMs: 999 }, { forceMs: 250 }])
    failure(m.validateLimits({ ...limits(), ...patch }), 'INVALID_PLAN');
  success(m.validateLimits({ ...limits(), forceMs: 249 }));
  for (const patch of [{ worktree: '.' }, { worktree: `${resolve('.')}\u0000` }, { worktree: `${resolve('.')}/..` },
    ...['../x', 'live-a/b', 'live-a\\b', 'live-a:b', 'live-.', 'live-', `live-${'a'.repeat(41)}`, 'live-A'].map(runId => ({ runId })),
    { port: '43189' }, { port: 43190 }, { candidate: 'A'.repeat(40) }, { candidate: 'a'.repeat(39) },
    { extra: true }, { environment: { PATH: 1 } }]) failure(m.validatePlan({ ...input(), ...patch }), 'INVALID_PLAN');
});

test('PURE-AUTHORITY: strict flags, exact binding and independent epoch expiry', async () => {
  const m = await load(), p = success(m.validatePlan(input())), a = authority(p);
  assert.equal(success(m.validateAuthority(a, p, 100)), null);
  for (const key of Object.keys(a)) {
    const missing = { ...a }; delete missing[key]; failure(m.validateAuthority(missing, p, 100), 'INVALID_AUTHORITY');
    const value = ['runId', 'candidate'].includes(key) ? 'other' : key === 'port' ? 43190 : key === 'expiresAt' ? 100 : 1;
    failure(m.validateAuthority({ ...a, [key]: value }, p, 100), 'INVALID_AUTHORITY');
  }
  for (const expiresAt of [99, Infinity, NaN, '101']) failure(m.validateAuthority({ ...a, expiresAt }, p, 100), 'INVALID_AUTHORITY');
  failure(m.validateAuthority({ ...a, extra: true }, p, 100), 'INVALID_AUTHORITY');
  unvalidated(() => m.validateAuthority(a, input(), 100));
  buildError(() => m.validateAuthority(a, p, NaN), 'nowEpochMs must be a finite number');
});

test('PURE-DRIVER-OPTIONS: identity, no effects/listeners/state inspection or foreign freezing', async () => {
  const m = await load(); let calls = 0;
  const methods = ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute', 'stop', 'forceStop', 'verifyStopped', 'progress'];
  const driver = Object.fromEntries(methods.map(k => [k, () => { calls++; throw Error(token); }]));
  driver.extra = token; assert.equal(success(m.validateDriver(driver)), driver); assert.ok(!Object.isFrozen(driver));
  for (const k of methods) { const v = { ...driver }; delete v[k]; failure(m.validateDriver(v), 'INVALID_DRIVER');
    failure(m.validateDriver({ ...driver, [k]: true }), 'INVALID_DRIVER');
    const accessor = { ...driver }; Object.defineProperty(accessor, k, { get() { calls++; throw Error(token); } });
    failure(m.validateDriver(accessor), 'INVALID_DRIVER'); }
  for (const v of [undefined, null, {}, { signal: undefined }, Object.create(null)])
    assert.deepEqual(frozen(success(m.validateOptions(v))), { signal: null });
  const controller = new AbortController(); controller.abort(token); const signal = controller.signal;
  for (const key of ['aborted', 'reason', 'addEventListener', 'removeEventListener', 'throwIfAborted'])
    Object.defineProperty(signal, key, { get() { calls++; throw Error(token); } });
  assert.equal(frozen(success(m.validateOptions({ signal }))).signal, signal); assert.ok(!Object.isFrozen(signal));
  for (const v of [{ signal: null }, { signal: {} }, { extra: true }, getter('signal'), Object.create({ signal })])
    failure(m.validateOptions(v), 'INVALID_OPTIONS');
  assert.equal(calls, 0);
});

test('PURE-CONTEXT: exact roles and setup-only environments, identity and no input mutation', async () => {
  const m = await load(), p = success(m.validatePlan(input())), env = m.buildEnvironments(p, token);
  const base = { PATH: 'synthetic', TEMP: p.directory, TMP: p.directory, TMPDIR: p.directory };
  assert.deepEqual(frozen(env), { broker: { ...base, PROCEED_TELEGRAM_BOT_TOKEN: token }, cli: base, mcp: base });
  for (const role of Object.values(env)) frozen(role);
  assert.notEqual(env.cli, env.mcp); assert.notEqual(env.broker, env.cli);
  const signal = new AbortController().signal, spec = { deadline: 12.5, signal };
  const expected = { directory: p.directory, state: p.state, port: p.port, candidate: p.candidate, deadline: 12.5, signal };
  assert.deepEqual(frozen(m.buildContext(p, spec)), expected);
  assert.deepEqual(frozen(m.buildContext(p, { ...spec, environments: env })), { ...expected, environments: env });
  assert.equal(m.buildContext(p, { ...spec, environments: env }).environments, env);
  const foreign = { ...env };
  assert.equal(m.buildContext(p, { ...spec, environments: foreign }).environments, foreign);
  assert.ok(!Object.isFrozen(foreign));
  assert.ok(!Object.isFrozen(spec)); assert.ok(!Object.isFrozen(signal)); assert.ok(!JSON.stringify(expected).includes(token));
  for (const fn of [() => m.buildEnvironments(input(), token), () => m.buildContext(input(), spec)]) unvalidated(fn);
  for (const value of ['', null, 1]) buildError(() => m.buildEnvironments(p, value), 'token must be a non-empty string');
  for (const value of [null, { ...spec, deadline: Infinity }, { ...spec, signal: {} }, { ...spec, extra: true }, getter('deadline')])
    buildError(() => m.buildContext(p, value), 'invalid context spec');
  for (const environments of [undefined, {}, { ...env, extra: base }, { ...env, cli: base },
    { ...env, cli: Object.freeze({ PATH: 1 }) }])
    buildError(() => m.buildContext(p, { ...spec, environments }), 'invalid environments');
});

test('PURE-DEADLINES: absolute fractional time, shared phase and conditional cleanup reserve', async () => {
  const m = await load(), l = success(m.validateLimits(limits())), origin = 10.5;
  assert.equal(m.workDeadline('setup', l, origin, 99), 160.5);
  assert.equal(m.workDeadline('setup', l, origin, 140), 160.5);
  assert.equal(m.workDeadline('run', l, origin, 20.5), 520.5);
  assert.equal(m.workDeadline('run', l, origin, 200), 660.5);
  for (const start of [origin, 160.5, 660.5, 800.5, 1010.5, 1020.5]) {
    const end = Math.min(start + 350, 1010.5), g = Math.min(start + 100, end), f = Math.min(g + 100, end);
    const windows = m.cleanupWindows(l, start, origin);
    assert.deepEqual(frozen(windows), { startMono: start, endMono: end,
      graceful: { startMono: start, endMono: g }, force: { startMono: g, endMono: f }, verification: { startMono: f, endMono: end } });
    for (const key of ['graceful', 'force', 'verification']) frozen(windows[key]);
    if (start <= 660.5) assert.equal(end - f, 150);
  }
  buildError(() => m.workDeadline('other', l, 0, 0), 'unknown work phase');
  for (const fn of [() => m.workDeadline('setup', limits(), 0, 0), () => m.cleanupWindows(limits(), 0, 0)])
    buildError(fn, 'limits must be the frozen object returned by validateLimits');
  for (const time of [NaN, Infinity, '1']) for (const fn of [() => m.workDeadline('run', l, time, 0),
    () => m.workDeadline('setup', l, 0, time), () => m.cleanupWindows(l, time, 0), () => m.cleanupWindows(l, 0, time)])
    buildError(fn, 'monotonic arguments must be finite numbers');
});

test('PURE-PROGRESS: bounded fraction, cap, fractional remainder and exhausted window', async () => {
  const m = await load();
  for (const phase of ['setup', 'run', 'teardown', 'complete'])
    for (const [startMono, endMono, now, waitMs] of [[10, 10, 10, 0], [10, 15, 10, 1], [10, 115, 10, 10],
      [0, 20000, 0, 1000], [10, 115, 114.75, 0.25], [10, 115, 116, 0]])
      assert.deepEqual(frozen(m.progressDeadline(phase, { startMono, endMono }, now)), { waitMs, endMono: now + waitMs });
  buildError(() => m.progressDeadline('other', { startMono: 0, endMono: 1 }, 0), 'unknown work phase');
  for (const window of [null, {}, { startMono: 1, endMono: 0 }, { startMono: 0, endMono: Infinity },
    { startMono: 0, endMono: 1, extra: true }, getter('startMono')])
    buildError(() => m.progressDeadline('setup', window, 0), 'window must be {startMono, endMono} with finite startMono <= endMono');
  buildError(() => m.progressDeadline('setup', { startMono: 0, endMono: 1 }, NaN), 'monotonic arguments must be finite numbers');
});

test('PURE-OUTCOME: exhaustive finite facts, invariants and precedence including cancellation in cleanup', async () => {
  const m = await load(), codes = new Set();
  for (const validationCode of [null, 'INVALID_PLAN', 'INVALID_AUTHORITY', 'INVALID_DRIVER', 'INVALID_OPTIONS'])
    for (const cancelled of [false, true]) for (const reserved of [false, true])
      for (const work of [null, 'ok', 'refused', 'failed', 'timeout']) for (const progressFailed of [false, true])
        for (const cleanup of ['not-needed', 'passed', 'failed']) {
          const facts = { validationCode, cancelled, reserved, work, progressFailed, cleanup }, before = { ...facts };
          const invalid = (cleanup === 'not-needed') !== !reserved || (work === 'refused' && (reserved || progressFailed))
            || (work === 'ok' && !reserved) || (work === null && validationCode === null && !cancelled)
            || (validationCode !== null && reserved);
          if (invalid) buildError(() => m.resolveOutcome(facts), 'invalid outcome facts');
          else {
            const code = validationCode ?? (cancelled ? (cleanup === 'failed' ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED')
              : cleanup === 'failed' ? 'CLEANUP_FAILED' : progressFailed ? 'PROGRESS_FAILED'
              : ({ refused: 'PREFLIGHT_BLOCKED', failed: 'WORK_FAILED', timeout: 'WORK_TIMEOUT', ok: 'OK' })[work]);
            const assertion = validationCode || (cancelled && !reserved) || (!cancelled && work === 'refused') ? 'blocked'
              : cancelled || progressFailed || work === 'failed' || work === 'timeout' ? 'failed' : 'passed';
            // Progress/cleanup precedence may outrank work refusal only when the invariants allow it.
            checkResult(m.resolveOutcome(facts), result(assertion, cleanup, reserved, code)); codes.add(code);
          }
          assert.deepEqual(facts, before); assert.ok(!Object.isFrozen(facts));
        }
  assert.deepEqual([...codes].sort(), ['INVALID_PLAN', 'INVALID_AUTHORITY', 'INVALID_DRIVER', 'INVALID_OPTIONS', 'OK',
    'PREFLIGHT_BLOCKED', 'WORK_FAILED', 'WORK_TIMEOUT', 'PROGRESS_FAILED', 'CLEANUP_FAILED', 'CANCELLED', 'CANCELLED_CLEANUP_FAILED'].sort());
  for (const key of Object.keys(baseFacts())) { const f = baseFacts(); delete f[key]; buildError(() => m.resolveOutcome(f), 'invalid outcome facts'); }
  for (const f of [...badShapes(), { ...baseFacts(), extra: true }, { ...baseFacts(), cancelled: 1 },
    { ...baseFacts(), reserved: 1 }, { ...baseFacts(), progressFailed: 1 }, { ...baseFacts(), validationCode: token },
    { ...baseFacts(), cleanup: token }, { ...baseFacts(), work: token }]) buildError(() => m.resolveOutcome(f), 'invalid outcome facts');
});
