// TEST ONLY. Bounded orchestration for the portable live runner harness. No live entrypoint,
// physical driver, network caller or application contract exists here, and none may be added.
// A caller-supplied AbortSignal is only ever observed: it is never aborted, read for a reason,
// attached to an effect or kept after settlement.
import { performance } from 'node:perf_hooks';
import { validatePlan, validateAuthority, validateDriver, validateOptions, buildContext,
  buildEnvironments, workDeadline, cleanupWindows, progressDeadline, resolveOutcome }
  from './live-run-plan.mjs';

const TIMEOUT = Symbol('lifecycle deadline');
const CANCEL = Symbol('caller cancellation');
const RELEASED = ['processesAbsent', 'listenerReleased', 'ownershipReleased'];

const observe = promise => { promise.then(() => {}, () => {}); };
const call = (effect, argument) => {
  try {
    return Promise.resolve(effect(argument));
  } catch (error) {
    return Promise.reject(error);
  }
};

// One reachable deadline per effect. Expiry aborts the owning signal and a caller cancellation can
// win the same race, while every abandoned work promise keeps a fulfillment/rejection observer.
const race = async (pending, deadline, controller, fence) => {
  let timer;
  const expired = new Promise(resolve => {
    timer = setTimeout(() => {
      if (controller !== undefined) controller.abort();
      resolve(TIMEOUT);
    }, Math.max(0, deadline - performance.now()));
  });
  const racers = fence === undefined ? [pending, expired] : [pending, expired, fence];
  try {
    return { value: await Promise.race(racers) };
  } catch (error) {
    return { failed: true };
  } finally {
    clearTimeout(timer);
    observe(pending);
  }
};

// Effects keep rejection, deadline, cancellation and value apart; a success may be undefined.
const attempt = async (effect, argument, deadline, controller, fence) => {
  const raced = await race(call(effect, argument), deadline, controller, fence);
  const settled = raced.failed !== true && raced.value !== TIMEOUT && raced.value !== CANCEL;
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

  const caller = selection.value.signal;
  const work = new AbortController();
  let reserved = false;
  let workResult = null;
  let progressFailed = false;
  let cleanup = 'not-needed';
  let cancelled = false;
  let listening = false;
  let releaseCancellation;
  const cancellation = new Promise(resolve => { releaseCancellation = resolve; });
  // The single caller callback records the request, aborts only the owned work context and releases
  // a pending race. The caller signal, its reason and its options are never aborted, read or forwarded.
  const onCallerAbort = () => {
    cancelled = true;
    work.abort();
    releaseCancellation(CANCEL);
  };
  const dispose = () => {
    if (!listening) return;
    listening = false;
    caller.removeEventListener('abort', onCallerAbort);
  };
  // Every settled path disposes that same callback exactly once, fired or unfired. Cancellation before
  // retention is a blocked run that owns no effect and owes no cleanup.
  const settle = facts => {
    dispose();
    return resolveOutcome({ validationCode: null, cancelled, ...facts });
  };
  if (caller !== null && caller.aborted) {
    cancelled = true;
    return settle({ reserved: false, work: null, progressFailed: false, cleanup: 'not-needed' });
  }
  if (caller !== null) {
    caller.addEventListener('abort', onCallerAbort);
    listening = true;
  }

  const currentAssertion = () => (progressFailed || workResult === 'failed' || workResult === 'timeout')
    ? 'failed' : 'passed';
  const setupEnd = workDeadline('setup', bound.limits, origin, origin);
  const context = (deadline, signal, environments) => (environments === undefined
    ? buildContext(bound, { deadline, signal })
    : buildContext(bound, { deadline, signal, environments }));
  const report = async (phase, window, event, fence) => {
    const { waitMs } = progressDeadline(phase, window, performance.now());
    if (waitMs === 0) return true;
    const raced = await race(call(driver.progress, event), performance.now() + waitMs, undefined, fence);
    return raced.failed !== true && raced.value !== TIMEOUT && raced.value !== CANCEL;
  };
  // Work effects share the owned work signal, its phase deadline and the caller cancellation fence.
  const workAttempt = (effect, argument, deadline) => attempt(effect, argument, deadline, work, cancellation);

  const preflight = await workAttempt(driver.preflight, context(setupEnd, work.signal), setupEnd);
  if (!cancelled && preflight.value?.ready !== true) {
    return settle({ reserved: false, work: 'refused', progressFailed: false, cleanup: 'not-needed' });
  }
  if (!cancelled && !await report('setup', { startMono: origin, endMono: setupEnd },
    { phase: 'setup', assertion: currentAssertion() }, cancellation)) {
    return settle({ reserved: false, work: 'failed', progressFailed: true, cleanup: 'not-needed' });
  }
  if (cancelled) return settle({ reserved: false, work: null, progressFailed: false, cleanup: 'not-needed' });

  // Retention is claimed before the effect so a throw, timeout or partial reservation is recorded.
  reserved = true;
  const reservation = await workAttempt(driver.reserve, context(setupEnd, work.signal), setupEnd);
  if (reservation.timedOut) workResult = 'timeout';
  else if (reservation.value?.fresh !== true || reservation.value?.protected !== true) {
    workResult = 'failed';
  }
  let token = null;
  if (!cancelled && workResult === null) {
    const acquired = await workAttempt(driver.acquireCredential, context(setupEnd, work.signal), setupEnd);
    if (acquired.timedOut) workResult = 'timeout';
    else if (typeof acquired.value !== 'string' || acquired.value.length === 0) workResult = 'failed';
    else token = acquired.value;
  }
  if (!cancelled && workResult === null) {
    const environments = buildEnvironments(bound, token);
    const started = await workAttempt(driver.setup, context(setupEnd, work.signal, environments), setupEnd);
    if (started.timedOut) workResult = 'timeout';
    else if (started.failed) workResult = 'failed';
  }
  if (!cancelled && workResult === null) {
    const runEnd = workDeadline('run', bound.limits, origin, performance.now());
    const persisted = await report('run', { startMono: performance.now(), endMono: runEnd },
      { phase: 'run', assertion: currentAssertion() }, cancellation);
    if (!persisted && !cancelled) {
      workResult = 'failed';
      progressFailed = true;
    } else if (persisted) {
      const executed = await workAttempt(driver.execute, context(runEnd, work.signal), runEnd);
      if (executed.timedOut) workResult = 'timeout';
      else if (executed.failed) workResult = 'failed';
      else if (!cancelled) workResult = 'ok';
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
