// TEST ONLY. Bounded orchestration for the portable live runner harness. No live entrypoint,
// physical driver, network caller or application contract exists here, and none may be added.
// The selected caller-cancellation bridge is a later checkpoint: options are validated exactly,
// but no listener is installed and a supplied signal is never attached, aborted or inspected.
import { performance } from 'node:perf_hooks';
import { validatePlan, validateAuthority, validateDriver, validateOptions, buildContext,
  buildEnvironments, workDeadline, cleanupWindows, progressDeadline, resolveOutcome }
  from './live-run-plan.mjs';

const TIMEOUT = Symbol('lifecycle deadline');
const RELEASED = ['processesAbsent', 'listenerReleased', 'ownershipReleased'];

const observe = promise => { promise.then(() => {}, () => {}); };
const call = (effect, argument) => {
  try {
    return Promise.resolve(effect(argument));
  } catch (error) {
    return Promise.reject(error);
  }
};

// One reachable deadline per effect. Expiry aborts the owning signal, disposes the timer and keeps
// a late fulfillment or rejection observed so abandoned work cannot escape or resume scheduling.
const race = async (pending, deadline, controller) => {
  let timer;
  const expired = new Promise(resolve => {
    timer = setTimeout(() => {
      if (controller !== undefined) controller.abort();
      resolve(TIMEOUT);
    }, Math.max(0, deadline - performance.now()));
  });
  try {
    return { value: await Promise.race([pending, expired]) };
  } catch (error) {
    return { failed: true };
  } finally {
    clearTimeout(timer);
    observe(pending);
  }
};

// Effects keep rejection, deadline and value apart because a success may legitimately be undefined.
const attempt = async (effect, argument, deadline, controller) => {
  const raced = await race(call(effect, argument), deadline, controller);
  const settled = raced.failed !== true && raced.value !== TIMEOUT;
  return { failed: raced.failed === true, timedOut: raced.value === TIMEOUT,
    value: settled ? raced.value : undefined };
};

// Only three literal true fields prove release. Null, absent or unreadable evidence fails closed so a
// malformed verdict cannot reject the lifecycle or skip the completion report.
const released = verification => {
  if (verification === null || typeof verification !== 'object') return false;
  try {
    return RELEASED.every(field => verification[field] === true);
  } catch {
    return false;
  }
};

export const withLiveLifecycle = async (plan, driver, options) => {
  const origin = performance.now();
  const refused = code => resolveOutcome({ validationCode: code, cancelled: false, reserved: false,
    work: null, progressFailed: false, cleanup: 'not-needed' });
  const settle = facts => resolveOutcome({ validationCode: null, cancelled: false, ...facts });

  const validated = validatePlan(plan);
  if (!validated.ok) return refused(validated.code);
  const bound = validated.value;
  const authority = Object.getOwnPropertyDescriptor(plan, 'authorization');
  if (!validateAuthority(authority?.value, bound, Date.now()).ok) {
    return refused('INVALID_AUTHORITY');
  }
  const supported = validateDriver(driver);
  if (!supported.ok) return refused(supported.code);
  const selection = validateOptions(options);
  if (!selection.ok) return refused(selection.code);

  let reserved = false;
  let workResult = null;
  let progressFailed = false;
  let cleanup = 'not-needed';
  const currentAssertion = () => (progressFailed || workResult === 'failed' || workResult === 'timeout')
    ? 'failed' : 'passed';
  const work = new AbortController();
  const setupEnd = workDeadline('setup', bound.limits, origin, origin);
  const context = (deadline, signal, environments) => (environments === undefined
    ? buildContext(bound, { deadline, signal })
    : buildContext(bound, { deadline, signal, environments }));
  const report = async (phase, window, event) => {
    const { waitMs } = progressDeadline(phase, window, performance.now());
    if (waitMs === 0) return true;
    const raced = await race(call(driver.progress, event), performance.now() + waitMs);
    return raced.failed !== true && raced.value !== TIMEOUT;
  };

  const preflight = await attempt(driver.preflight, context(setupEnd, work.signal), setupEnd, work);
  if (preflight.value?.ready !== true) {
    return settle({ reserved: false, work: 'refused', progressFailed: false, cleanup: 'not-needed' });
  }
  if (!await report('setup', { startMono: origin, endMono: setupEnd },
    { phase: 'setup', assertion: currentAssertion() })) {
    return settle({ reserved: false, work: 'failed', progressFailed: true, cleanup: 'not-needed' });
  }

  // Retention is claimed before the effect so a throw, timeout or partial reservation is recorded.
  reserved = true;
  const reservation = await attempt(driver.reserve, context(setupEnd, work.signal), setupEnd, work);
  if (reservation.timedOut) workResult = 'timeout';
  else if (reservation.value?.fresh !== true || reservation.value?.protected !== true) {
    workResult = 'failed';
  }
  let token = null;
  if (workResult === null) {
    const acquired = await attempt(driver.acquireCredential, context(setupEnd, work.signal), setupEnd, work);
    if (acquired.timedOut) workResult = 'timeout';
    else if (typeof acquired.value !== 'string' || acquired.value.length === 0) workResult = 'failed';
    else token = acquired.value;
  }
  if (workResult === null) {
    const environments = buildEnvironments(bound, token);
    const started = await attempt(driver.setup, context(setupEnd, work.signal, environments), setupEnd, work);
    if (started.timedOut) workResult = 'timeout';
    else if (started.failed) workResult = 'failed';
  }
  if (workResult === null) {
    const runEnd = workDeadline('run', bound.limits, origin, performance.now());
    const persisted = await report('run', { startMono: performance.now(), endMono: runEnd },
      { phase: 'run', assertion: currentAssertion() });
    if (!persisted) {
      workResult = 'failed';
      progressFailed = true;
    } else {
      const executed = await attempt(driver.execute, context(runEnd, work.signal), runEnd, work);
      if (executed.timedOut) workResult = 'timeout';
      else if (executed.failed) workResult = 'failed';
      else workResult = 'ok';
    }
  }

  if (reserved) {
    const windows = cleanupWindows(bound.limits, performance.now(), origin);
    if (!await report('teardown', windows.graceful, { phase: 'teardown', assertion: currentAssertion() })) {
      progressFailed = true;
    }
    const graceful = new AbortController();
    const stopped = await attempt(driver.stop, context(windows.graceful.endMono, graceful.signal),
      windows.graceful.endMono, graceful);
    if (stopped.failed || stopped.timedOut) {
      const forced = new AbortController();
      await attempt(driver.forceStop, context(windows.force.endMono, forced.signal),
        windows.force.endMono, forced);
    }
    const verification = new AbortController();
    const verified = await attempt(driver.verifyStopped,
      context(windows.verification.endMono, verification.signal), windows.verification.endMono, verification);
    cleanup = released(verified.value) ? 'passed' : 'failed';
    if (!await report('complete', windows.verification,
      { phase: 'complete', assertion: currentAssertion(), cleanup })) {
      progressFailed = true;
    }
  }
  return settle({ reserved, work: workResult, progressFailed, cleanup });
};
