// TEST ONLY. Transparent stdio entry for the real host's sole owner adapter.
// NOT a broker, decision API, outer assistant pipeline or standalone test launch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, writeFile, rm } from 'node:fs/promises';
import { bridgeCapturedMcp } from '/payload/tests/support/harness-transparent-capture.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.version, 'v24.22.2');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
assert.equal(process.argv.length, 3);
const state = process.argv[2];
assert.match(state, /^\/run\/proceed\/managed-fixtures\/[a-zA-Z0-9_/-]+$/);
assert.ok(!state.split('/').includes('..'));
const file = await open('/run/proceed/qualification-private/mcp.jsonl', 'wx', 0o600);
const controller = new AbortController();
let child,
  bytes = 0,
  stderrBytes = 0,
  closed = false;
const lifetime = setTimeout(() => controller.abort(), 150000);
try {
  // No owner/control/operator authority in arguments, environment or diagnostics.
  child = spawn(
    '/usr/local/bin/node',
    [
      '/payload/bin/proceed-mcp.js',
      'mcp',
      '--owner',
      'shared',
      '--harness-id',
      'qualification',
      '--state-dir',
      state,
    ],
    {
      env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const close = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      closed = true;
      resolve(code);
    });
  });
  // Attach rejection handling immediately. The private raw stderr is bounded and
  // never forwarded into MCP stdout or a diagnostic. Nonempty stderr fails closed.
  close.catch(() => controller.abort());
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    controller.abort();
  });
  const bridge = bridgeCapturedMcp({
    hostInput: process.stdin,
    hostOutput: process.stdout,
    adapterInput: child.stdin,
    adapterOutput: child.stdout,
    connection: 'composition-shared-owner',
    signal: controller.signal,
    persist: async (event) => {
      const line = JSON.stringify(event) + '\n';
      bytes += Buffer.byteLength(line);
      assert.ok(bytes <= 4 * 1048576, 'private capture envelope ceiling');
      await file.writeFile(line);
    },
  });
  bridge.catch(() => controller.abort());
  await writeFile(
    '/run/proceed/qualification-private/mcp-armed.json',
    JSON.stringify({
      connection: 'composition-shared-owner',
      capture: 'ATTACHED',
    }),
    { flag: 'wx', mode: 0o600 },
  );
  controller.signal.throwIfAborted();
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('composition adapter lifetime ended')),
      { once: true },
    ),
  );
  const code = await Promise.race([close, aborted]);
  controller.abort();
  await Promise.allSettled([bridge]);
  assert.equal(code, 0);
  assert.equal(stderrBytes, 0);
} finally {
  clearTimeout(lifetime);
  controller.abort();
  if (child && !closed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!closed) child.kill('SIGKILL');
    await new Promise((resolve) => {
      if (closed) return resolve();
      const timer = setTimeout(resolve, 500);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await file.close();
  await rm('/run/proceed/qualification-private/mcp-armed.json', { force: true });
  assert.ok(!child || closed, 'adapter cleanup unconfirmed');
}
