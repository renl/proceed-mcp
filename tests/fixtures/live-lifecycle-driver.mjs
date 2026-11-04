// TEST ONLY. In-memory effects, no filesystem, process, credential or network access.
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

export const fakeToken = 'SYNTHETIC-live-lifecycle-token';
export const assertRedacted = value => assert.ok(!JSON.stringify(value).includes(fakeToken),
  'runner evidence and non-broker contexts must omit the synthetic credential');
export function plan() {
  return { worktree: resolve('.'), runId: 'live-calibration', port: 43189,
    candidate: 'f434995ae6f1e299596c206dfe61253087908670',
    authorization: { live: true, credentialAccess: true, consumeUpdates: true,
      exclusiveBot: true, noWebhook: true, privateHuman: true,
      runId: 'live-calibration', port: 43189,
      candidate: 'f434995ae6f1e299596c206dfe61253087908670', expiresAt: Date.now() + 60000 },
    environment: { PATH: 'synthetic-path', SystemRoot: 'synthetic-system',
      TELEGRAM_TOKEN: fakeToken, PROCEED_TELEGRAM_BOT_TOKEN: fakeToken,
      NODE_OPTIONS: '--import forbidden', OPENCODE_PASSWORD: 'SYNTHETIC-password' },
    limits: { totalMs: 1000, setupMs: 150, runMs: 500, cleanupMs: 350,
      gracefulMs: 100, forceMs: 100 } };
}

export function fakeDriver(overrides = {}) {
  const calls = [], contexts = [], progress = [];
  const methods = {
    preflight: async () => ({ ready: true }),
    reserve: async () => ({ fresh: true, protected: true }),
    acquireCredential: async () => fakeToken,
    setup: async () => {}, execute: async () => {},
    stop: async () => {}, forceStop: async () => {},
    verifyStopped: async () => ({ processesAbsent: true, listenerReleased: true, ownershipReleased: true }),
    progress: async (event) => { progress.push(event); },
    ...overrides,
  };
  const driver = Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, async (...args) => {
    calls.push(name);
    if (name !== 'progress') contexts.push({ name, value: args[0] });
    return fn(...args);
  }]));
  return { driver, calls, contexts, progress };
}

export const namespace = (p) => join(p.worktree, '.scratch', 'portable-live', p.runId);
export const abortable = ({ signal }) => new Promise((_, reject) => {
  signal.throwIfAborted();
  signal.addEventListener('abort', () => reject(Error('SYNTHETIC-private-error')), { once: true });
});

export const noncooperative = () => new Promise(() => {});
export const turn = () => new Promise(resolve => setImmediate(resolve));
export function assertResult(result, expected) {
  assert.deepEqual(Object.keys(result).sort(), ['assertion', 'cleanup', 'code', 'retained']);
  for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key);
  assertRedacted(result);
}
export function assertContext(context, p, setup = false) {
  assert.deepEqual(Object.keys(context).sort(), ['candidate', 'deadline', 'directory', 'port',
    'signal', 'state', ...(setup ? ['environments'] : [])].sort());
  assert.equal(context.directory, namespace(p));
  assert.equal(context.state, join(namespace(p), 'state'));
  assert.equal(context.candidate, p.candidate);
  assert.equal(context.port, p.port);
  assert.ok(context.signal instanceof AbortSignal);
  assert.ok(Number.isFinite(context.deadline));
  if (!setup) assertRedacted(context);
}
export function callerCancellation() {
  const controller = new AbortController(), signal = controller.signal;
  const counts = { add: 0, remove: 0 };
  for (const [method, key] of [['addEventListener', 'add'], ['removeEventListener', 'remove']]) {
    const original = signal[method].bind(signal);
    signal[method] = (...args) => { if (args[0] === 'abort') counts[key]++; return original(...args); };
  }
  Object.defineProperty(signal, 'reason', { get() { throw Error('caller reason must not be read'); } });
  return { signal, counts, abort: () => controller.abort(fakeToken) };
}
