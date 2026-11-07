// Parent half of the private TUI/helper exchange (design section 2). The TUI
// resolves a trusted absolute Node >=24 executable and the packaged helper, then
// spawns one child with a clean explicit environment, an ignored stdin, zero-output
// stdout/stderr tripwires and two parent-created pipes on slots 3 and 4.
//
// One monotonic 10000 ms budget starts before resolution or spawn and covers
// handshake, handoff, TLS/HTTP work, response admission and owned cleanup. The
// final 1000 ms is reserved for cleanup, so active work stops before it and no
// transition, wait or escalation ever renews the remaining time. The child never
// learns a key path, and the parent never falls back to Bun, a shell, `fork`, the
// current directory or an inherited environment.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
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
// Implementation-owned scheduling headroom, not a contract tolerance: every
// deadline-bound request is issued strictly before its exact bound so timer,
// syscall and event-loop latency cannot turn an in-bound request into an
// overrun. Exhausted time never becomes a fresh positive wait.
const HELPER_SCHEDULING_HEADROOM_MS = 100;

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
  return {
    path: real,
    size: info.size,
    mtimeMs: info.mtimeMs,
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
  };
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

// A runtime candidate must be a native executable image, decided from a bounded
// header read rather than by running it: a shell/batch wrapper or text shim can
// invoke any other program, so a searched basename or regular-file stat is not
// executable trust, and a later self-reported ready frame can never grant it.
const EXECUTABLE_HEADER_BYTES = 4096;
const EXECUTABLE_BITS = 0o111;

function nativeImageKind(header) {
  if (header.length < 4) return null;
  if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
    return 'elf';
  }
  // Thin Mach-O 32/64-bit and universal images, in either byte order.
  if (header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa) return 'macho';
  if (header[0] === 0xcf && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe) {
    return 'macho';
  }
  if (header[0] === 0xca && header[1] === 0xfe && header[2] === 0xba) return 'macho';
  if (header[0] === 0xbe && header[1] === 0xba && header[2] === 0xfe && header[3] === 0xca) {
    return 'macho';
  }
  // PE: `MZ` plus the signature at the offset recorded in the DOS header.
  if (header.length >= 0x40 && header[0] === 0x4d && header[1] === 0x5a) {
    const offset = header.readUInt32LE(0x3c);
    if (
      offset >= 0x40 &&
      offset + 4 <= header.length &&
      header[offset] === 0x50 &&
      header[offset + 1] === 0x45 &&
      header[offset + 2] === 0x00 &&
      header[offset + 3] === 0x00
    ) {
      return 'pe';
    }
  }
  return null;
}

async function headerBytes(path, size) {
  const length = Math.min(EXECUTABLE_HEADER_BYTES, size);
  if (length < 4) return null;
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(header, read, length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return header.subarray(0, read);
  } finally {
    await handle.close();
  }
}

// The one identity used for the resolved runtime: a real file, executable by
// mode on POSIX, whose header is a native image. Anything else is an unusable
// candidate, so the search continues without ever executing it.
async function executableIdentity(candidate, platform) {
  const identity = await fileIdentity(candidate);
  if (identity === null) return null;
  if (platform !== 'win32' && (identity.mode & EXECUTABLE_BITS) === 0) return null;
  let header;
  try {
    header = await headerBytes(identity.path, identity.size);
  } catch {
    return null;
  }
  return header !== null && nativeImageKind(header) !== null ? identity : null;
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
    const identity = await executableIdentity(join(entry, name), platform);
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
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      done(value);
    };
    const onAbort = () => finish({ cancelled: true });
    if (signal?.aborted === true) {
      finish({ cancelled: true });
      return;
    }
    // An exhausted bound is a deadline outcome, never a fresh short wait.
    if (!(milliseconds > 0)) {
      finish({ timeout: true });
      return;
    }
    timer = setTimeout(() => finish({ timeout: true }), milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
    channel.take().then((outcome) => finish(active() ? outcome : { cancelled: true }));
  });
}

function waitForClose(promise, state, milliseconds) {
  if (state.done) return Promise.resolve(state);
  // An exhausted bound is not a fresh positive wait.
  if (!(milliseconds > 0)) return Promise.resolve(null);
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), milliseconds);
    promise.then((value) => {
      clearTimeout(timer);
      done(value);
    });
  });
}

// Close the owned pipes, request termination immediately and escalate once. Every
// wait here is measured against the absolute deadlines fixed below, never against
// an initial limit minus a nominal duration. A successful kill request is not exit
// proof: only the observed close event is.
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
  // Fence/cleanup start. Exit and closure must be observed by the earlier of this
  // instant plus the cleanup limit and the original exchange deadline.
  const cleanupStartedAt = performance.now();
  const cleanupEndsAt = Math.min(cleanupStartedAt + HELPER_CLEANUP_LIMIT_MS, endsAt);
  // Forced termination is requested with headroom inside the grace bound so a
  // late-scheduled request still lands inside the exact maximum.
  const forceBy = Math.min(cleanupStartedAt + HELPER_TERMINATION_GRACE_MS, cleanupEndsAt);
  if (!close.done) {
    try {
      child.kill();
    } catch {
      // A refused termination request is followed by the escalation below.
    }
  }
  if (close.done) return true;
  let state = await waitForClose(
    closePromise,
    close,
    forceBy - performance.now() - HELPER_SCHEDULING_HEADROOM_MS,
  );
  if (state === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Forced termination is the last step; absence is still verified below.
    }
    // Actual time left after the request, not the limit minus the nominal wait.
    state = await waitForClose(
      closePromise,
      close,
      cleanupEndsAt - performance.now() - HELPER_SCHEDULING_HEADROOM_MS,
    );
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
  // The final cleanup limit is reserved from entry, so no exchange phase can
  // consume it. Active work stops before that reserve is reached.
  const activeWorkEndsAt = endsAt - HELPER_CLEANUP_LIMIT_MS;
  const deadlineUnixMs = Date.now() + budget;
  const remaining = () => endsAt - performance.now();
  const activeWorkRemaining = () =>
    activeWorkEndsAt - performance.now() - HELPER_SCHEDULING_HEADROOM_MS;
  const active = () => isActive() && signal?.aborted !== true;
  const assertActive = () => {
    if (!active()) throw channelError('EXCHANGE_CANCELLED');
    if (remaining() <= 0) throw channelError('EXCHANGE_DEADLINE');
  };
  // No next phase begins while the reserved cleanup limit is the only time left.
  const assertWorkable = () => {
    assertActive();
    if (activeWorkRemaining() <= 0) throw channelError('EXCHANGE_DEADLINE');
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

  assertWorkable();
  const runtime = await resolveNodeRuntime({ platform, env, cwd });
  assertWorkable();
  const helper = await fileIdentity(packagedHelperEntry());
  if (helper === null) throw channelError('HELPER_PROTOCOL_INVALID');
  assertWorkable();
  // Recheck both identities before spawn: a replacement in the resolution window
  // is a different executable, not the one that was admitted.
  if (!sameIdentity(runtime, await executableIdentity(runtime.path, platform))) {
    throw channelError('NODE_UNAVAILABLE');
  }
  if (!sameIdentity(helper, await fileIdentity(helper.path))) {
    throw channelError('HELPER_PROTOCOL_INVALID');
  }
  assertWorkable();

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
    assertWorkable();
    writeFrame(inbound, {
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'hello',
      exchange_id: exchangeId,
      // At most one full budget away: the child never receives extra time.
      deadline_unix_ms: deadlineUnixMs,
    });

    const ready = await takeWithin(channel, activeWorkRemaining(), signal, active);
    assertWorkable();
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
    assertWorkable();
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

    const reply = await takeWithin(channel, activeWorkRemaining(), signal, active);
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
    const exit = await waitForClose(closePromise, close, activeWorkRemaining());
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
    // Unconfirmed owned cleanup is uncertainty, never an accepted approval. The
    // handoff already observed is retained so a caller refreshes retained broker
    // status instead of reporting a local pre-submission failure or replaying.
    onUnconfirmedCleanup();
    throw channelError('HELPER_PROTOCOL_INVALID', submitted);
  }
  if (failure !== null) {
    failure.submitted = submitted;
    throw failure;
  }
  return outcome;
}
