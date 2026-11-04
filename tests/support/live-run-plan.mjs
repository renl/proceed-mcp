// TEST ONLY. Deterministic pure decisions for the portable live runner: no IO, clock,
// environment, credential, process, timer, listener, abort or caller mutation.
import { isAbsolute, join, resolve } from 'node:path';

export const LIVE_PORT = 43189;
export const RUN_ID_PATTERN = /^live-[a-z0-9-]{1,40}$/;
const PLAN_MESSAGE = 'plan must be the frozen object returned by validatePlan';
const LIMITS_MESSAGE = 'limits must be the frozen object returned by validateLimits';
const MONOTONIC_MESSAGE = 'monotonic arguments must be finite numbers';
const WINDOW_MESSAGE = 'window must be {startMono, endMono} with finite startMono <= endMono';
const PHASE_MESSAGE = 'unknown work phase';
const CONTEXT_MESSAGE = 'invalid context spec';
const OUTCOME_MESSAGE = 'invalid outcome facts';
const PLAN_INPUT_KEYS = ['worktree', 'runId', 'candidate', 'port', 'environment', 'limits'];
const PLAN_KEYS = [...PLAN_INPUT_KEYS, 'authorization'];
const PLAN_OUTPUT_KEYS = ['worktree', 'runId', 'candidate', 'port', 'directory', 'state', 'limits', 'environment'];
const LIMIT_KEYS = ['totalMs', 'setupMs', 'runMs', 'cleanupMs', 'gracefulMs', 'forceMs'];
const SAFE_ENVIRONMENT_KEYS = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'];
const ENVIRONMENT_ROLES = ['broker', 'cli', 'mcp'];
const AUTHORITY_FLAGS = ['live', 'credentialAccess', 'consumeUpdates', 'exclusiveBot', 'noWebhook', 'privateHuman'];
const AUTHORITY_KEYS = [...AUTHORITY_FLAGS, 'runId', 'port', 'candidate', 'expiresAt'];
const DRIVER_METHODS = ['preflight', 'reserve', 'acquireCredential', 'setup', 'execute', 'stop', 'forceStop', 'verifyStopped', 'progress'];
const WORK_PHASES = ['setup', 'run'], PROGRESS_PHASES = ['setup', 'run', 'teardown', 'complete'];
const VALIDATION_CODES = ['INVALID_PLAN', 'INVALID_AUTHORITY', 'INVALID_DRIVER', 'INVALID_OPTIONS'];
const OUTCOME_KEYS = ['validationCode', 'cancelled', 'reserved', 'work', 'progressFailed', 'cleanup'];
const WORK_FACTS = [null, 'ok', 'refused', 'failed', 'timeout'], CLEANUP_FACTS = ['not-needed', 'passed', 'failed'];
const WORK_CODES = { refused: 'PREFLIGHT_BLOCKED', failed: 'WORK_FAILED', timeout: 'WORK_TIMEOUT', ok: 'OK' };
const CANDIDATE_PATTERN = /^[0-9a-f]{40}$/, MISSING = Symbol('missing'), ACCESSOR = Symbol('accessor');

const failure = code => Object.freeze({ ok: false, code });
const success = value => Object.freeze({ ok: true, value });
const typeError = (code, message) => Object.assign(new TypeError(message), { code });
const buildError = message => typeError('INVALID_BUILD_INPUT', message);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isPlain = value => typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.getOwnPropertySymbols(value).length === 0 && [Object.prototype, null].includes(Object.getPrototypeOf(value));
// Descriptor read only: an accessor is reported, never invoked, and no value is ever coerced.
// A descriptor that defines get or set is an accessor even when both are undefined.
const field = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) return MISSING;
  return 'get' in descriptor || 'set' in descriptor ? ACCESSOR : descriptor.value;
};
const hasAccessor = (object, names) => names.some(name => field(object, name) === ACCESSOR);
const exactDataFields = (value, keys) => {
  if (!isPlain(value)) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || !keys.every(key => names.includes(key))) return null;
  if (hasAccessor(value, names)) return null;
  return Object.fromEntries(names.map(key => [key, field(value, key)]));
};
const validWorktree = value => typeof value === 'string' && value.length > 0 && !value.includes('\u0000')
  && isAbsolute(value) && resolve(value) === value;
const sanitizeLimits = (value, frozenOnly) => {
  if (frozenOnly && !Object.isFrozen(value)) return null;
  const limits = exactDataFields(value, LIMIT_KEYS);
  if (limits === null || !LIMIT_KEYS.every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0)) return null;
  if (limits.setupMs + limits.runMs + limits.cleanupMs > limits.totalMs) return null;
  if (limits.gracefulMs + limits.forceMs >= limits.cleanupMs) return null;
  return Object.freeze(limits);
};
const requireLimits = value => {
  const limits = sanitizeLimits(value, true);
  if (limits === null) throw buildError(LIMITS_MESSAGE);
  return limits;
};
const sanitizeEnvironment = value => {
  if (!isPlain(value)) return null;
  const names = Object.getOwnPropertyNames(value);
  if (hasAccessor(value, names)) return null;
  const kept = names.filter(key => SAFE_ENVIRONMENT_KEYS.includes(key));
  if (kept.some(key => typeof field(value, key) !== 'string')) return null;
  return Object.fromEntries(kept.map(key => [key, field(value, key)]));
};
// A trusted sanitized plan environment carries only the permitted safe string data keys. Raw plan
// validation drops other string data, while a sanitized plan refuses any forbidden key outright.
const isSanitizedEnvironment = value => {
  if (!isPlain(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.every(name => SAFE_ENVIRONMENT_KEYS.includes(name) && typeof field(value, name) === 'string');
};
const planShape = value => {
  if (!isPlain(value) || !Object.isFrozen(value)) return null;
  const plan = exactDataFields(value, PLAN_OUTPUT_KEYS);
  if (plan === null) return null;
  if (!validWorktree(plan.worktree)) return null;
  if (typeof plan.runId !== 'string' || !RUN_ID_PATTERN.test(plan.runId)) return null;
  if (typeof plan.candidate !== 'string' || !CANDIDATE_PATTERN.test(plan.candidate)) return null;
  if (plan.port !== LIVE_PORT) return null;
  const directory = join(plan.worktree, '.scratch', 'portable-live', plan.runId);
  if (plan.directory !== directory || plan.state !== join(directory, 'state')) return null;
  if (!Object.isFrozen(plan.limits) || sanitizeLimits(plan.limits, true) === null) return null;
  if (!Object.isFrozen(plan.environment) || !isSanitizedEnvironment(plan.environment)) return null;
  return plan;
};
const requirePlan = value => {
  const plan = planShape(value);
  if (plan === null) throw typeError('UNVALIDATED_PLAN', PLAN_MESSAGE);
  return plan;
};
const validRole = value => isPlain(value) && Object.isFrozen(value)
  && Object.getOwnPropertyNames(value).every(key => typeof field(value, key) === 'string');
const validEnvironments = value => {
  const roles = exactDataFields(value, ENVIRONMENT_ROLES);
  return roles !== null && ENVIRONMENT_ROLES.every(role => validRole(roles[role]));
};

export const validatePlan = value => {
  if (!isPlain(value)) return failure('INVALID_PLAN');
  const names = Object.getOwnPropertyNames(value);
  if (names.some(name => !PLAN_KEYS.includes(name))) return failure('INVALID_PLAN');
  if (hasAccessor(value, names)) return failure('INVALID_PLAN');
  if (!PLAN_INPUT_KEYS.every(name => names.includes(name))) return failure('INVALID_PLAN');
  const fields = Object.fromEntries(names.map(name => [name, field(value, name)]));
  const { worktree, runId, candidate, port, environment } = fields;
  if (!validWorktree(worktree)) return failure('INVALID_PLAN');
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return failure('INVALID_PLAN');
  if (typeof candidate !== 'string' || !CANDIDATE_PATTERN.test(candidate)) return failure('INVALID_PLAN');
  if (port !== LIVE_PORT) return failure('INVALID_PLAN');
  const safe = sanitizeEnvironment(environment), limits = sanitizeLimits(fields.limits, false);
  if (safe === null || limits === null) return failure('INVALID_PLAN');
  const directory = join(worktree, '.scratch', 'portable-live', runId);
  return success(Object.freeze({ worktree, runId, candidate, port, directory, state: join(directory, 'state'),
    limits, environment: Object.freeze(safe) }));
};
export const validateLimits = value => {
  const limits = sanitizeLimits(value, false);
  if (limits === null) return failure('INVALID_PLAN');
  return success(limits);
};
export const validateAuthority = (value, plan, nowEpochMs) => {
  const bound = requirePlan(plan);
  if (!isNumber(nowEpochMs)) throw buildError('nowEpochMs must be a finite number');
  const authority = exactDataFields(value, AUTHORITY_KEYS);
  if (authority === null) return failure('INVALID_AUTHORITY');
  if (!AUTHORITY_FLAGS.every(flag => authority[flag] === true)) return failure('INVALID_AUTHORITY');
  if (authority.runId !== bound.runId || authority.port !== bound.port) return failure('INVALID_AUTHORITY');
  if (authority.candidate !== bound.candidate) return failure('INVALID_AUTHORITY');
  if (!isNumber(authority.expiresAt) || !(authority.expiresAt > nowEpochMs)) return failure('INVALID_AUTHORITY');
  return success(null);
};
export const validateDriver = value => {
  if (!isPlain(value)) return failure('INVALID_DRIVER');
  const names = Object.getOwnPropertyNames(value);
  if (hasAccessor(value, names)) return failure('INVALID_DRIVER');
  if (!DRIVER_METHODS.every(method => typeof field(value, method) === 'function')) return failure('INVALID_DRIVER');
  return success(value);
};
export const validateOptions = value => {
  const absent = Object.freeze({ signal: null });
  if (value === undefined || value === null) return success(absent);
  const names = isPlain(value) ? Object.getOwnPropertyNames(value) : null;
  if (names === null || names.some(name => name !== 'signal')) return failure('INVALID_OPTIONS');
  const signal = field(value, 'signal');
  if (signal === MISSING || signal === undefined) return success(absent);
  return signal === ACCESSOR || !(signal instanceof AbortSignal) ? failure('INVALID_OPTIONS') : success(Object.freeze({ signal }));
};
export const buildEnvironments = (plan, token) => {
  const bound = requirePlan(plan);
  if (typeof token !== 'string' || token.length === 0) throw buildError('token must be a non-empty string');
  const base = { ...bound.environment, TEMP: bound.directory, TMP: bound.directory, TMPDIR: bound.directory };
  return Object.freeze({ broker: Object.freeze({ ...base, PROCEED_TELEGRAM_BOT_TOKEN: token }),
    cli: Object.freeze({ ...base }), mcp: Object.freeze({ ...base }) });
};
export const buildContext = (plan, spec) => {
  const bound = requirePlan(plan);
  const allowed = ['deadline', 'signal', 'environments'];
  if (!isPlain(spec) || Object.getOwnPropertyNames(spec).some(name => !allowed.includes(name))) throw buildError(CONTEXT_MESSAGE);
  const deadline = field(spec, 'deadline'), signal = field(spec, 'signal');
  if (deadline === MISSING || deadline === ACCESSOR || !isNumber(deadline)) throw buildError(CONTEXT_MESSAGE);
  if (signal === MISSING || signal === ACCESSOR || !(signal instanceof AbortSignal)) throw buildError(CONTEXT_MESSAGE);
  const context = { directory: bound.directory, state: bound.state, port: bound.port, candidate: bound.candidate,
    deadline, signal };
  const environments = field(spec, 'environments');
  if (environments === ACCESSOR || (environments !== MISSING && !validEnvironments(environments))) throw buildError('invalid environments');
  if (environments !== MISSING) context.environments = environments;
  return Object.freeze(context);
};
export const workDeadline = (phase, limits, originMono, nowMono) => {
  if (!WORK_PHASES.includes(phase)) throw buildError(PHASE_MESSAGE);
  const validated = requireLimits(limits);
  if (!isNumber(originMono) || !isNumber(nowMono)) throw buildError(MONOTONIC_MESSAGE);
  const setupEnd = originMono + validated.setupMs;
  return phase === 'setup' ? setupEnd : Math.min(nowMono + validated.runMs, setupEnd + validated.runMs);
};
export const cleanupWindows = (limits, cleanupStartMono, originMono) => {
  const validated = requireLimits(limits);
  if (!isNumber(cleanupStartMono) || !isNumber(originMono)) throw buildError(MONOTONIC_MESSAGE);
  const endMono = Math.min(cleanupStartMono + validated.cleanupMs, originMono + validated.totalMs);
  const gracefulEnd = Math.min(cleanupStartMono + validated.gracefulMs, endMono);
  const forceEnd = Math.min(gracefulEnd + validated.forceMs, endMono);
  return Object.freeze({ startMono: cleanupStartMono, endMono,
    graceful: Object.freeze({ startMono: cleanupStartMono, endMono: gracefulEnd }),
    force: Object.freeze({ startMono: gracefulEnd, endMono: forceEnd }),
    verification: Object.freeze({ startMono: forceEnd, endMono }) });
};
export const progressDeadline = (phase, window, nowMono) => {
  if (!PROGRESS_PHASES.includes(phase)) throw buildError(PHASE_MESSAGE);
  const bounds = exactDataFields(window, ['startMono', 'endMono']);
  if (bounds === null || !isNumber(bounds.startMono) || !isNumber(bounds.endMono)) throw buildError(WINDOW_MESSAGE);
  if (bounds.startMono > bounds.endMono) throw buildError(WINDOW_MESSAGE);
  if (!isNumber(nowMono)) throw buildError(MONOTONIC_MESSAGE);
  const budget = Math.min(1000, Math.max(1, Math.floor((bounds.endMono - bounds.startMono) / 10)));
  const remaining = bounds.endMono - nowMono, waitMs = remaining <= 0 ? 0 : Math.min(budget, remaining);
  return Object.freeze({ waitMs, endMono: nowMono + waitMs });
};
export const resolveOutcome = facts => {
  const resolved = exactDataFields(facts, OUTCOME_KEYS);
  if (resolved === null) throw buildError(OUTCOME_MESSAGE);
  const { validationCode, cancelled, reserved, work, progressFailed, cleanup } = resolved;
  if (validationCode !== null && !VALIDATION_CODES.includes(validationCode)) throw buildError(OUTCOME_MESSAGE);
  if (typeof cancelled !== 'boolean' || typeof reserved !== 'boolean') throw buildError(OUTCOME_MESSAGE);
  if (typeof progressFailed !== 'boolean' || !WORK_FACTS.includes(work)) throw buildError(OUTCOME_MESSAGE);
  if (!CLEANUP_FACTS.includes(cleanup)) throw buildError(OUTCOME_MESSAGE);
  const invalid = (cleanup === 'not-needed') !== !reserved || (work === 'refused' && (reserved || progressFailed))
    || (work === 'ok' && !reserved) || (work === null && validationCode === null && !cancelled)
    || (validationCode !== null && reserved);
  if (invalid) throw buildError(OUTCOME_MESSAGE);

  let code;
  if (validationCode !== null) code = validationCode;
  else if (cancelled) code = cleanup === 'failed' ? 'CANCELLED_CLEANUP_FAILED' : 'CANCELLED';
  else if (cleanup === 'failed') code = 'CLEANUP_FAILED';
  else if (progressFailed) code = 'PROGRESS_FAILED';
  else code = WORK_CODES[work];
  const blocked = validationCode !== null || (cancelled && !reserved) || (!cancelled && work === 'refused');
  const failed = cancelled || progressFailed || work === 'failed' || work === 'timeout';
  return Object.freeze({ assertion: blocked ? 'blocked' : failed ? 'failed' : 'passed', cleanup, retained: reserved, code });
};
