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
import { blockedPrerequisite } from '../errors.js';
import { SecureChannelError, secureExchange } from '../http/local-client.js';
import { readSecureOwnership } from '../state/ownership.js';
import { TELEGRAM_TOKEN_ENV } from '../config/portable-config.js';
import { lifecycleEnvelopeProblem } from './lifecycle-envelope.js';

export const STARTUP_BUDGET_MS = 150_000;
export const PROBE_TIMEOUT_MS = 1_000;
export const PROBE_SPACING_MS = 100;

export function startupConflict(message) {
  return blockedPrerequisite(`${message} (BROKER_INSTANCE_CONFLICT)`, 'BROKER_INSTANCE_CONFLICT');
}

export function startupTimeout() {
  return blockedPrerequisite(
    'the broker did not become ready within the startup deadline; inspect safe status before a new attempt',
    'BROKER_STARTUP_TIMEOUT',
  );
}

export function upgradeGuidance(message) {
  return blockedPrerequisite(
    `${message}; stop that broker through its own Ctrl+C or operator interface, then restart it with "serve --secure-local" using its environment token, or provision the token file for automatic startup`,
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
// prove the expected channel is a conflict, not a slower start.
async function attemptReadiness(record, token, timeoutMs) {
  let response;
  try {
    response = await secureExchange({
      lock: record,
      token,
      method: 'GET',
      path: '/v1/ready',
      timeoutMs,
      maxBytes: 16_384,
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
  if (response.status === 503 && response.body?.error?.code === 'BROKER_NOT_READY') {
    return { state: 'starting' };
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
// is excluded from its environment rather than used as a credential source.
export function spawnDetachedBroker({ executable, args, environment = process.env, cwd }) {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd,
    env: launchEnvironment(environment),
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
// attempt; a losing candidate is never respawned in a loop.
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
  let launched = false;
  for (;;) {
    if (signal?.aborted === true) {
      throw blockedPrerequisite('the startup attempt was cancelled', 'BROKER_UNAVAILABLE');
    }
    const record = await readSecureOwnership(lockFile);
    if (record.absent === true) {
      const probe = await probeOccupancy(port);
      if (probe === 'occupied') {
        throw startupConflict(
          'the configured port is occupied by a listener without a matching ownership record',
        );
      }
      if (probe === 'refused') {
        // Recheck absence after the probe and before launching; a race after these
        // observations is expected and the exclusive ownership record still decides.
        const again = await readSecureOwnership(lockFile);
        if (again.absent === true && !launched && typeof launch === 'function') {
          launched = true;
          logger('starting the broker for this state directory');
          launch();
        }
      }
    } else if (record.schemaVersion === 1) {
      throw upgradeGuidance('the running broker uses the legacy local channel');
    } else {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw startupTimeout();
      const result = await attemptReadiness(record, token, Math.min(1000, remaining));
      if (result.state === 'ready') return result.record;
    }
    const left = deadline - performance.now();
    if (left <= 0) throw startupTimeout();
    try {
      await delay(Math.min(PROBE_SPACING_MS, left), { signal });
    } catch {
      throw blockedPrerequisite('the startup attempt was cancelled', 'BROKER_UNAVAILABLE');
    }
  }
}
