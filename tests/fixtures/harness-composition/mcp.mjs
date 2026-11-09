// TEST ONLY. Transparent stdio entry for the real host's sole owner adapter.
// NOT a broker, decision API, outer assistant pipeline or standalone test launch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, writeFile, rm, rename } from 'node:fs/promises';
import {
  bridgeCapturedMcp,
  privateCaptureWriter,
} from '/payload/tests/support/harness-transparent-capture.mjs';

const deadline = Date.now() + 150000;
assert.equal(process.platform, 'linux');
assert.equal(process.version, 'v24.22.2');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
assert.equal(process.argv.length, 3);
const state = process.argv[2];
assert.match(state, /^\/run\/proceed\/managed-fixtures\/[a-zA-Z0-9_/-]+$/);
assert.ok(!state.split('/').includes('..'));
const controller = new AbortController();
const stopInput = new AbortController();
const writer = privateCaptureWriter(4 * 1048576);
let file, child, bridge, close, timer, closing;
let writes = Promise.resolve();
let bytes = 0,
  stderrBytes = 0,
  settled = false,
  fenced = false,
  failed = false;
let closeDeadline = deadline;
let wake;
const stopping = new Promise((resolve) => {
  wake = resolve;
});
const writable = () => {
  if (fenced || Date.now() >= closeDeadline) throw Error('capture producer unsettled');
};
const finish = () => {
  if (closing) return closing;
  closeDeadline = Math.min(deadline, Date.now() + 1900);
  clearTimeout(timer);
  timer = setTimeout(expire, Math.max(0, closeDeadline - Date.now()));
  wake();
  closing = stopping;
  return closing;
};
const terminate = () => {
  finish();
  stopInput.abort();
};
const expire = () => {
  failed = true;
  fenced = true;
  writer.failed();
  controller.abort();
  stopInput.abort();
  if (child && !settled) child.kill('SIGKILL');
  process.stdin.removeListener('end', finish);
  process.removeListener('SIGTERM', terminate);
  // An ignored abort or stuck IO must not keep this producer alive. No receipt.
  process.exit(1);
};
process.stdin.once('end', finish);
process.on('SIGTERM', terminate);
timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
try {
  file = await open('/run/proceed/qualification-private/mcp.jsonl', 'wx', 0o600);
  writable();
  assert.ok(!closing, 'producer stopped before adapter setup');
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
    { env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  close = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      settled = true;
      finish();
      resolve({ code, signal });
    });
  });
  close.catch(() => {
    failed = true;
    terminate();
    controller.abort();
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    failed = true;
    writer.failed();
    terminate();
    controller.abort();
  });
  bridge = bridgeCapturedMcp({
    hostInput: process.stdin,
    hostOutput: process.stdout,
    adapterInput: child.stdin,
    adapterOutput: child.stdout,
    connection: 'composition-shared-owner',
    signal: controller.signal,
    stopInput: stopInput.signal,
    persist: async (event) => {
      writable();
      const line = JSON.stringify(event) + '\n';
      bytes += Buffer.byteLength(line);
      if (bytes > 4 * 1048576) {
        writer.failed();
        throw Error('private capture envelope ceiling');
      }
      const pending = writes.then(async () => {
        writable();
        await file.writeFile(line);
        writable();
        writer.written(Buffer.from(line));
      });
      writes = pending;
      await pending;
    },
  });
  bridge.catch(() => {
    failed = true;
    writer.failed();
    terminate();
    controller.abort();
  });
  await writeFile(
    '/run/proceed/qualification-private/mcp-armed.json',
    JSON.stringify({ connection: 'composition-shared-owner', capture: 'ATTACHED' }),
    { flag: 'wx', mode: 0o600 },
  );
  await stopping;
  const [outcome] = await Promise.all([close, bridge, writes]);
  // Bridge settlement precedes the final write snapshot. A signalled adapter is
  // incomplete even if termination was requested by this producer's owner.
  await writes;
  writable();
  assert.equal(outcome.code, 0);
  assert.ok(!outcome.signal);
  assert.equal(stderrBytes, 0);
  assert.equal(failed, false);
  await file.close();
  file = undefined;
  writable();
} catch {
  failed = true;
  writer.failed();
} finally {
  // One owner remains bounded even on setup, adapter or bridge failure.
  finish();
  stopInput.abort();
  controller.abort();
  if (child && !settled) child.kill('SIGTERM');
  if (close) await close.catch(() => {});
  if (bridge) await bridge.catch(() => {});
  await writes.catch(() => {});
  try {
    if (file) await file.close();
    await rm('/run/proceed/qualification-private/mcp-armed.json', { force: true });
    writable();
    assert.equal(failed, false);
    // No complete marker exists until every fallible owned cleanup has settled.
    // A partial/failed write can leave only an inadmissible staging file.
    await writeFile(
      '/run/proceed/qualification-private/mcp-seal.pending',
      JSON.stringify(writer.seal()),
      { flag: 'wx', mode: 0o600 },
    );
    writable();
    await rename(
      '/run/proceed/qualification-private/mcp-seal.pending',
      '/run/proceed/qualification-private/mcp-seal.json',
    );
  } catch {
    failed = true;
    writer.failed();
  }
  fenced = true;
  clearTimeout(timer);
  process.stdin.removeListener('end', finish);
  process.removeListener('SIGTERM', terminate);
  process.exit(failed ? 1 : 0);
}
