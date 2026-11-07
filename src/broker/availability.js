// One bounded automatic-availability attempt (design sections 3-5).
//
// Discovery inspects the protected ownership record without sending any
// credential, probes occupancy with a credential-free TCP connection only, and
// launches at most one broker candidate for this invocation when both the record
// is definitely absent and the port definitely refuses connections. Readiness is
// only adopted after the authenticated secure channel and a matching lifecycle
// envelope; an open port, a record or a successful spawn never stands in for that.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { SecureChannelError, secureExchange } from '../http/local-client.js';
import { readSecureOwnership } from '../state/ownership.js';
import { TELEGRAM_TOKEN_ENV } from '../config/portable-config.js';
import { lifecycleEnvelopeProblem } from './lifecycle-envelope.js';

export const STARTUP_BUDGET_MS = 150_000;
export const PROBE_TIMEOUT_MS = 1_000;
export const PROBE_SPACING_MS = 100;
// Private child propagation only: the absolute instant (epoch milliseconds) when
// the caller's original startup budget expires. Both processes read the same
// system clock, so a delayed child entry is charged to the same attempt instead
// of starting a fresh budget. Nonsecret and never a public CLI input.
export const STARTUP_DEADLINE_ENV = 'PROCEED_STARTUP_DEADLINE_AT';

export function startupConflict(message) {
  return blockedPrerequisite(`${message} (BROKER_INSTANCE_CONFLICT)`, 'BROKER_INSTANCE_CONFLICT');
}

export function startupTimeout() {
  return blockedPrerequisite(
    'the broker did not become ready within the startup deadline; inspect safe status before a new attempt (BROKER_STARTUP_TIMEOUT)',
    'BROKER_STARTUP_TIMEOUT',
  );
}

export function upgradeGuidance(message) {
  return blockedPrerequisite(
    `${message}; stop that broker through its own Ctrl+C or operator interface, then restart it with "serve --secure-local" using its environment token, or provision the token file for automatic startup (BROKER_INSTANCE_CONFLICT)`,
    'BROKER_INSTANCE_CONFLICT',
  );
}

// Credential-free occupancy only: a successful connection proves that something
// listens, never which service it is. No application bytes are sent.
export function probeOccupancy(port, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish('indeterminate'), Math.max(1, timeoutMs));
    socket.once('connect', () => finish('occupied'));
    socket.once('error', (error) =>
      finish(error?.code === 'ECONNREFUSED' ? 'refused' : 'indeterminate'),
    );
  });
}

function envelopeProblem(response, record) {
  if (response.status !== 200) return null;
  return lifecycleEnvelopeProblem(response.body, record);
}

// One readiness exchange against a stable schema-2 record. A refused connection
// means the candidate is still starting; any established connection that cannot
// prove the expected channel is a conflict, not a slower start. Caller
// cancellation travels through the same secure exchange, so an aborted attempt
// destroys that socket instead of waiting for the probe budget.
async function attemptReadiness(record, token, timeoutMs, signal) {
  let response;
  try {
    response = await secureExchange({
      lock: record,
      token,
      method: 'GET',
      path: '/v1/ready',
      timeoutMs,
      maxBytes: 16_384,
      signal,
    });
  } catch (error) {
    if (error instanceof SecureChannelError && error.code === 'BROKER_UNAVAILABLE') {
      return { state: 'starting' };
    }
    if (error instanceof SecureChannelError) {
      throw startupConflict('the configured listener could not prove the expected secure channel');
    }
    throw error;
  }
  if (response.status === 503) {
    const code = response.body?.error?.code;
    if (code === 'BROKER_NOT_READY') return { state: 'starting' };
    // The broker itself reported failed storage health over the authenticated
    // channel. That is the fixed nonretryable storage classification, not an
    // unrelated-service conflict, and no peer message is forwarded.
    if (code === 'STORAGE_FAILURE') {
      throw storageFailure(
        'the broker cannot confirm local readiness (STORAGE_FAILURE)',
        'STORAGE_FAILURE',
      );
    }
  }
  const problem = envelopeProblem(response, record);
  if (problem === 'malformed' || response.status !== 200) {
    throw startupConflict('the listener did not return a supported readiness envelope');
  }
  if (problem === 'mismatch') {
    throw startupConflict('the listener does not match the protected ownership record');
  }
  return { state: 'ready', record };
}

function launchEnvironment(environment) {
  const child = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key === TELEGRAM_TOKEN_ENV) continue;
    child[key] = value;
  }
  return child;
}

// Launches the installed broker entry point from this same package using the
// current runtime executable: no shell, no package download, no inferred path.
// The child is detached with independent stdio, and an inherited Telegram token
// is excluded from its environment rather than used as a credential source. The
// remaining startup budget travels as one absolute instant so the child cannot
// reset it by restarting its own clock origin.
export function spawnDetachedBroker({
  executable,
  args,
  environment = process.env,
  cwd,
  deadlineAt = null,
}) {
  const childEnvironment = launchEnvironment(environment);
  if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt)) {
    childEnvironment[STARTUP_DEADLINE_ENV] = String(Math.round(deadlineAt));
  }
  const child = spawn(process.execPath, [executable, ...args], {
    cwd,
    env: childEnvironment,
    detached: true,
    shell: false,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
  return child;
}

// Resolves with the adopted stable record once readiness is authenticated, or
// rejects with a classified prerequisite failure. Launch happens at most once per
// attempt; a losing candidate is never respawned in a loop. The attempt budget is
// absolute: no phase, helper, probe or launch is admitted after it expires, and a
// child receives the same remaining budget rather than a fresh one.
export async function awaitSecureAvailability({
  lockFile,
  port,
  token,
  launch = null,
  budgetMs = STARTUP_BUDGET_MS,
  signal,
  logger = () => {},
} = {}) {
  const deadline = performance.now() + budgetMs;
  const remaining = () => deadline - performance.now();
  // Cancellation and expiry are admission gates, not observations: neither may
  // admit another read, probe, launch or adoption after any awaited boundary.
  const ensureActive = () => {
    if (signal?.aborted === true) {
      throw blockedPrerequisite('the startup attempt was cancelled', 'BROKER_UNAVAILABLE');
    }
    if (remaining() <= 0) throw startupTimeout();
  };
  let launched = false;
  for (;;) {
    ensureActive();
    const record = await readSecureOwnership(lockFile);
    // A record read cannot be cancelled, so its result must not start occupancy
    // work once the caller has cancelled or the original budget has expired.
    ensureActive();
    if (record.absent === true) {
      ensureActive();
      const probe = await probeOccupancy(port, {
        timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1, remaining())),
      });
      ensureActive();
      if (probe === 'occupied') {
        throw startupConflict(
          'the configured port is occupied by a listener without a matching ownership record',
        );
      }
      if (probe === 'refused') {
        // Recheck absence after the probe and before launching; a race after these
        // observations is expected and the exclusive ownership record still decides.
        const again = await readSecureOwnership(lockFile);
        ensureActive();
        if (again.absent === true && !launched && typeof launch === 'function') {
          launched = true;
          logger('starting the broker for this state directory');
          // The absolute instant travels to the child: process-entry and startup
          // latency are charged to this attempt, never to a fresh child budget.
          launch({ deadlineAt: Date.now() + remaining() });
        }
      }
    } else if (record.schemaVersion === 1) {
      throw upgradeGuidance('the running broker uses the legacy local channel');
    } else {
      const result = await attemptReadiness(
        record,
        token,
        Math.min(PROBE_TIMEOUT_MS, Math.max(1, remaining())),
        signal,
      );
      // Adoption is authority, not an observation: cancellation or expiry while
      // readiness was pending is refused before the record is reused.
      ensureActive();
      if (result.state === 'ready') {
        return result.record;
      }
    }
    ensureActive();
    try {
      await delay(Math.min(PROBE_SPACING_MS, remaining()), { signal });
    } catch {
      throw blockedPrerequisite('the startup attempt was cancelled', 'BROKER_UNAVAILABLE');
    }
  }
}
