// Parent half of the private TUI/helper exchange (design section 2). The TUI
// resolves a trusted absolute Node >=24 executable and the packaged helper, then
// spawns one child with a clean explicit environment, an ignored stdin, zero-output
// stdout/stderr tripwires and two parent-created pipes on slots 3 and 4.
//
// One monotonic 10000 ms budget starts before resolution or spawn and covers
// handshake, handoff, TLS/HTTP work, response admission and owned cleanup. The
// child never learns a key path, and the parent never falls back to Bun, a shell,
// `fork`, the current directory or an inherited environment.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  MAX_EXCHANGE_BUDGET_MS,
  PROTOCOL_SCHEMA_VERSION,
  createFrameChannel,
  encodeFrame,
  errorProblem,
  readyProblem,
  responseProblem,
} from './helper-protocol.js';
import { exchangeProblem } from './helper-operations.js';

// A byte on either captured stream aborts the exchange; at most this much is read
// before the stream is closed and the child terminated. Nothing is ever logged.
export const HELPER_OUTPUT_LIMIT_BYTES = 4096;
export const HELPER_TERMINATION_GRACE_MS = 500;
export const HELPER_CLEANUP_LIMIT_MS = 1000;

// Fixed nonsecret text selected by code. No raw runtime message, stack, path,
// cause or authority value ever reaches the UI.
export const HELPER_ERROR_MESSAGES = Object.freeze({
  NODE_UNAVAILABLE: 'the harness channel needs an installed Node 24 or newer runtime',
  NODE_UNSUPPORTED: 'the located Node runtime cannot serve the harness channel',
  HELPER_PROTOCOL_INVALID: 'the harness helper exchange was not admitted',
  HELPER_LIMIT_EXCEEDED: 'the harness helper exchange exceeded its limits',
  EXCHANGE_CANCELLED: 'the harness exchange was cancelled',
  EXCHANGE_DEADLINE: 'the harness exchange did not finish in time',
  BROKER_UNAVAILABLE: 'the secure broker was not reachable for this exchange',
  BROKER_INSTANCE_CONFLICT: 'the listener could not prove the expected secure channel',
  BROKER_RESPONSE_INVALID: 'the secure broker returned an unusable response',
});

export class HelperChannelError extends Error {
  constructor(code) {
    const admitted = Object.hasOwn(HELPER_ERROR_MESSAGES, code) ? code : 'BROKER_UNAVAILABLE';
    super(HELPER_ERROR_MESSAGES[admitted]);
    this.name = 'HelperChannelError';
    this.code = admitted;
    // True only once the child was handed the admitted authority frame, so a
    // caller never claims an unconfirmed commit for an exchange that never ran.
    this.submitted = false;
  }
}

function channelError(code, submitted = false) {
  const error = new HelperChannelError(code);
  error.submitted = submitted;
  return error;
}

function toChannelError(error) {
  return error instanceof HelperChannelError ? error : channelError('BROKER_UNAVAILABLE');
}

const WINDOWS_ENVIRONMENT_KEYS = Object.freeze(['SystemRoot', 'WINDIR']);

// A clean explicit environment, not a filtered copy of the host environment: no
// provider/host/broker credential, proxy, PATH, NODE_OPTIONS, NODE_PATH, NODE_DEBUG,
// preload, inspector, loader or coverage variable can be inherited.
export function helperEnvironment(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return {};
  const allowed = {};
  for (const key of WINDOWS_ENVIRONMENT_KEYS) {
    const value = env[key];
    if (
      typeof value === 'string' &&
      value !== '' &&
      isAbsolute(value) &&
      !/[\u0000\r\n]/.test(value)
    ) {
      allowed[key] = value;
    }
  }
  return allowed;
}

function samePath(left, right, platform) {
  const a = resolve(left);
  const b = resolve(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// One resolved identity for an executable-like input: the real absolute path is a
// regular file. A relative, missing, directory or non-file candidate is unusable.
async function fileIdentity(candidate) {
  let link;
  try {
    link = await lstat(candidate);
  } catch {
    return null;
  }
  if (!link.isFile() && !link.isSymbolicLink()) return null;
  let real;
  try {
    real = await realpath(candidate);
  } catch {
    return null;
  }
  let info;
  try {
    info = await lstat(real);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  return { path: real, size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino };
}

// An identity is stable when the same real file is still the same object, so a
// replacement between resolution and spawn is refused instead of trusted.
function sameIdentity(left, right) {
  if (left === null || right === null) return false;
  if (left.path !== right.path || left.size !== right.size || left.mtimeMs !== right.mtimeMs) {
    return false;
  }
  if (left.ino !== 0 && right.ino !== 0 && left.ino !== right.ino) return false;
  if (left.dev !== 0 && right.dev !== 0 && left.dev !== right.dev) return false;
  return true;
}

// Resolve `node` (`node.exe` on Windows) from the trusted operator-provisioned
// search path only: an explicit candidate list of absolute directories, never a
// shell, current-directory lookup, wrapper or Bun's own `process.execPath`.
export async function resolveNodeRuntime({
  platform = process.platform,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const search = platform === 'win32' ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '');
  for (const entry of search.split(delimiter)) {
    // Relative or empty entries would let the current directory or the caller
    // decide which executable runs, so they are never candidates.
    if (entry === '' || !isAbsolute(entry)) continue;
    if (samePath(entry, cwd, platform)) continue;
    const identity = await fileIdentity(join(entry, name));
    if (identity !== null) return identity;
  }
  throw channelError('NODE_UNAVAILABLE');
}

// The packaged helper is resolved relative to this installed module, never the
// current directory, user input, host discovery or a test fixture.
export function packagedHelperEntry() {
  return fileURLToPath(new URL('./operator-helper.js', import.meta.url));
}

function writeFrame(stream, value) {
  stream.write(encodeFrame(value));
}

function takeWithin(channel, milliseconds, signal, active) {
  return new Promise((done) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      done(value);
    };
    const onAbort = () => finish({ cancelled: true });
    const timer = setTimeout(() => finish({ timeout: true }), Math.max(1, milliseconds));
    if (signal?.aborted === true) {
      finish({ cancelled: true });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    channel.take().then((outcome) => finish(active() ? outcome : { cancelled: true }));
  });
}

function waitForClose(promise, state, milliseconds) {
  if (state.done) return Promise.resolve(state);
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), Math.max(1, milliseconds));
    promise.then((value) => {
      clearTimeout(timer);
      done(value);
    });
  });
}

// Close the owned pipes, request termination immediately and escalate once. A
// successful kill request is not exit proof: only the observed close event is.
async function cleanupChild(
  child,
  { inbound, outbound, closePromise, close, endsAt, spawnFailure },
) {
  try {
    inbound?.destroy();
  } catch {
    // An already-destroyed pipe is not a cleanup failure.
  }
  try {
    outbound?.destroy();
  } catch {
    // An already-destroyed pipe is not a cleanup failure.
  }
  for (const stream of child.stdio ?? []) {
    if (stream === null || stream === undefined) continue;
    try {
      stream.destroy();
    } catch {
      // Owned stream teardown is best effort; the exit observation decides.
    }
  }
  // No process exists after a spawn failure, so there is nothing to confirm.
  if (spawnFailure !== null) return true;
  const limit = Math.min(HELPER_CLEANUP_LIMIT_MS, Math.max(1, endsAt - performance.now()));
  if (!close.done) {
    try {
      child.kill();
    } catch {
      // A refused termination request is followed by the escalation below.
    }
  }
  const graceful = Math.min(HELPER_TERMINATION_GRACE_MS, limit);
  let state = await waitForClose(closePromise, close, graceful);
  if (state === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Forced termination is the last step; absence is still verified below.
    }
    state = await waitForClose(closePromise, close, Math.max(1, limit - graceful));
  }
  return state !== null;
}

export async function runHelperExchange({
  operation,
  body,
  presentationId = null,
  port,
  lockFile,
  operatorCredential,
  signal = undefined,
  isActive = () => true,
  onUnconfirmedCleanup = () => {},
  budgetMs = MAX_EXCHANGE_BUDGET_MS,
  platform = process.platform,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const budget = Math.min(MAX_EXCHANGE_BUDGET_MS, Math.max(1, Math.trunc(budgetMs) || 0));
  // One parent monotonic budget and one absolute deadline, both fixed at entry.
  const endsAt = performance.now() + budget;
  const deadlineUnixMs = Date.now() + budget;
  const remaining = () => endsAt - performance.now();
  const active = () => isActive() && signal?.aborted !== true;
  const assertActive = () => {
    if (!active()) throw channelError('EXCHANGE_CANCELLED');
    if (remaining() <= 0) throw channelError('EXCHANGE_DEADLINE');
  };

  // The parent validates the exact frame it is about to send, so a malformed
  // operation, binding or credential never reaches a child at all.
  const exchangeId = randomBytes(16).toString('hex');
  const placeholderId = '0'.repeat(32);
  const frameProblem = exchangeProblem(
    {
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'exchange',
      exchange_id: placeholderId,
      port,
      lock_file: lockFile,
      operator_credential: operatorCredential,
      operation,
      presentation_id: presentationId,
      body,
    },
    placeholderId,
  );
  if (frameProblem !== null) throw channelError('HELPER_PROTOCOL_INVALID');

  assertActive();
  const runtime = await resolveNodeRuntime({ platform, env, cwd });
  assertActive();
  const helper = await fileIdentity(packagedHelperEntry());
  if (helper === null) throw channelError('HELPER_PROTOCOL_INVALID');
  assertActive();
  // Recheck both identities before spawn: a replacement in the resolution window
  // is a different executable, not the one that was admitted.
  if (!sameIdentity(runtime, await fileIdentity(runtime.path))) {
    throw channelError('NODE_UNAVAILABLE');
  }
  if (!sameIdentity(helper, await fileIdentity(helper.path))) {
    throw channelError('HELPER_PROTOCOL_INVALID');
  }
  assertActive();

  let child;
  try {
    child = spawn(runtime.path, [helper.path], {
      // Package-relative working directory: the caller's directory never decides
      // what the helper can resolve.
      cwd: dirname(helper.path),
      env: helperEnvironment(platform, env),
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw channelError('NODE_UNAVAILABLE');
  }

  const close = { done: false, code: null, signal: null };
  let resolveClose;
  const closePromise = new Promise((done) => {
    resolveClose = done;
  });
  child.once('close', (code, signalName) => {
    close.done = true;
    close.code = code;
    close.signal = signalName;
    resolveClose(close);
  });
  let spawnFailure = null;
  child.on('error', (error) => {
    spawnFailure ??= error;
  });

  // Zero-output tripwires: any captured byte means the exchange is not admitted,
  // and a bounded overrun closes the stream and terminates the child.
  const output = { stdout: 0, stderr: 0 };
  let tripwire = false;
  const watchOutput = (stream, key) => {
    if (stream === null || stream === undefined) return;
    stream.on('data', (chunk) => {
      output[key] += chunk.length;
      tripwire = true;
      if (output[key] > HELPER_OUTPUT_LIMIT_BYTES) {
        try {
          stream.destroy();
        } catch {
          // Best effort; the child termination below is the real boundary.
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // The exit observation still decides cleanup.
        }
      }
    });
    stream.on('error', () => {});
  };
  watchOutput(child.stdout, 'stdout');
  watchOutput(child.stderr, 'stderr');

  const inbound = child.stdio?.[3] ?? null;
  const outbound = child.stdio?.[4] ?? null;
  let pipeFailure = false;
  if (inbound !== null) inbound.on('error', () => (pipeFailure = true));
  const channel = outbound === null ? null : createFrameChannel(outbound);

  let submitted = false;
  let outcome = null;
  let failure = null;
  try {
    if (inbound === null || channel === null) throw channelError('HELPER_PROTOCOL_INVALID');
    assertActive();
    writeFrame(inbound, {
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'hello',
      exchange_id: exchangeId,
      // At most one full budget away: the child never receives extra time.
      deadline_unix_ms: deadlineUnixMs,
    });

    const ready = await takeWithin(channel, remaining(), signal, active);
    assertActive();
    if (spawnFailure !== null) throw channelError('NODE_UNAVAILABLE');
    if (pipeFailure || tripwire) throw channelError('HELPER_PROTOCOL_INVALID');
    if (ready.timeout === true) throw channelError('EXCHANGE_DEADLINE');
    if (ready.cancelled === true) throw channelError('EXCHANGE_CANCELLED');
    if (ready.eof === true) throw channelError('HELPER_PROTOCOL_INVALID');
    if (ready.failure !== undefined) throw channelError(ready.failure);
    if (readyProblem(ready.frame, exchangeId) !== null) {
      throw channelError('HELPER_PROTOCOL_INVALID');
    }

    // Authority handoff happens once, and only after a genuine Node `ready`.
    assertActive();
    writeFrame(inbound, {
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'exchange',
      exchange_id: exchangeId,
      port,
      lock_file: lockFile,
      operator_credential: operatorCredential,
      operation,
      presentation_id: presentationId,
      body,
    });
    submitted = true;

    const reply = await takeWithin(channel, remaining(), signal, active);
    if (spawnFailure !== null) throw channelError('NODE_UNAVAILABLE');
    if (pipeFailure || tripwire) throw channelError('HELPER_PROTOCOL_INVALID');
    if (reply.timeout === true) throw channelError('EXCHANGE_DEADLINE');
    if (reply.cancelled === true) throw channelError('EXCHANGE_CANCELLED');
    if (reply.eof === true) throw channelError('HELPER_PROTOCOL_INVALID');
    if (reply.failure !== undefined) throw channelError(reply.failure);
    if (reply.frame.type === 'error') {
      if (errorProblem(reply.frame, exchangeId) !== null) {
        throw channelError('HELPER_PROTOCOL_INVALID');
      }
      throw channelError(reply.frame.code);
    }
    if (responseProblem(reply.frame, exchangeId) !== null) {
      throw channelError('HELPER_PROTOCOL_INVALID');
    }

    // A response is usable only after its own frame, a clean exit and pipe
    // closure are admitted inside the original deadline for a still-active
    // interaction. A late completion never authorizes the next phase.
    const exit = await waitForClose(closePromise, close, remaining());
    if (exit === null) throw channelError('EXCHANGE_DEADLINE');
    if (tripwire) throw channelError('HELPER_PROTOCOL_INVALID');
    assertActive();
    if (exit.code !== 0 || exit.signal !== null) throw channelError('HELPER_PROTOCOL_INVALID');
    outcome = { status: reply.frame.status, body: reply.frame.body };
  } catch (error) {
    failure = toChannelError(error);
  }

  const cleaned = await cleanupChild(child, {
    inbound,
    outbound,
    closePromise,
    close,
    endsAt,
    spawnFailure,
  });
  if (!cleaned) {
    // Unconfirmed owned cleanup is uncertainty, never an accepted approval.
    onUnconfirmedCleanup();
    throw channelError('HELPER_PROTOCOL_INVALID');
  }
  if (failure !== null) {
    failure.submitted = submitted;
    throw failure;
  }
  return outcome;
}
