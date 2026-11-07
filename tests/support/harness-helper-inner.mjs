// TEST ONLY. Run only through the maintained private-PID/network-none container.
// No OpenCode, broker, key file, provider, or model is started by this checkpoint.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  frame,
  hello,
  exchangeId,
  invalidHelloVectors,
  forbiddenExchangeVectors,
  closedExchangeVectors,
} from './harness-helper-vectors.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.versions.node, '24.22.2');
assert.equal(process.versions.bun, undefined);
const evidence = '/run/proceed/evidence';
await mkdir(evidence, { recursive: true });
// Outer policy validation precedes release. This is not an authority handshake.
const start = performance.now();
while (true) {
  try {
    await readFile('/run/proceed-authorized');
    break;
  } catch {
    assert.ok(performance.now() - start < 10000);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const entry = process.argv[2];
assert.match(entry, /^\/payload\/src\/[a-zA-Z0-9_/-]+\.js$/);
const results = [];
let cleanup = true;
async function exercise(id, input, afterReady = false, eof = false) {
  await writeFile(
    `${evidence}/progress.jsonl`,
    JSON.stringify({ case: id, phase: 'spawn' }) + '\n',
    { flag: 'a' },
  );
  const child = spawn(process.execPath, [entry], {
    cwd: '/run/proceed',
    env: {},
    shell: false,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  let output = Buffer.alloc(0),
    noise = 0,
    overflow = false,
    spawnFailure = false;
  child.on('error', () => {
    spawnFailure = true;
  });
  for (const stream of child.stdio.filter(Boolean)) stream.on('error', () => {});
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      noise += b.length;
      if (noise > 4096) child.kill('SIGKILL');
    });
  child.stdio[4].on('data', (b) => {
    if (output.length + b.length > 98304) {
      overflow = true;
      child.kill('SIGKILL');
    } else output = Buffer.concat([output, b]);
  });
  let exited = false;
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      exited = true;
      resolve([code, signal]);
    });
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10500);
  try {
    child.stdio[3].write(afterReady ? frame(hello()) : input);
    if (afterReady) {
      const end = performance.now() + 10000;
      while (output.length < 4 || output.length < 4 + output.readUInt32BE(0)) {
        assert.ok(!exited && performance.now() < end, 'ready missing');
        await new Promise((r) => setTimeout(r, 5));
      }
      const n = output.readUInt32BE(0);
      assert.ok(n > 0 && n <= 81920);
      const ready = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(4, 4 + n)),
      );
      assert.deepEqual(Object.keys(ready).sort(), [
        'exchange_id',
        'node_version',
        'runtime',
        'schema_version',
        'type',
      ]);
      assert.equal(ready.type, 'ready');
      assert.equal(ready.schema_version, 1);
      assert.equal(ready.exchange_id, exchangeId);
      assert.equal(ready.runtime, 'node');
      assert.equal(ready.node_version, '24.22.2');
      if (!eof) child.stdio[3].write(input);
    }
    const closeStart = performance.now();
    if (eof) child.stdio[3].end();
    const [code, signal] = await closed;
    assert.equal(spawnFailure, false);
    assert.equal(signal, null);
    assert.equal(code, 1);
    assert.equal(noise, 0);
    assert.equal(overflow, false);
    if (!afterReady)
      assert.equal(output.length, 0, 'invalid hello cannot authorize an output frame');
    if (afterReady) assert.ok(output.length > 0);
    if (eof) assert.ok(performance.now() - closeStart <= 1000, 'EOF cleanup exceeds 1000 ms');
    // No successful response may be synthesized by malformed input or EOF.
    let offset = 0,
      count = 0;
    while (offset < output.length) {
      assert.ok(++count <= 2, 'extra child frame');
      assert.ok(offset + 4 <= output.length);
      const n = output.readUInt32BE(offset);
      assert.ok(n > 0 && n <= 81920);
      assert.ok(offset + 4 + n <= output.length);
      const value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          output.subarray(offset + 4, offset + 4 + n),
        ),
      );
      assert.notEqual(value.type, 'response');
      if (value.type === 'ready')
        assert.ok(afterReady && count === 1, 'duplicate or unsolicited ready');
      if (value.type !== 'ready') {
        assert.deepEqual(Object.keys(value).sort(), [
          'code',
          'exchange_id',
          'schema_version',
          'type',
        ]);
        assert.equal(value.type, 'error');
        assert.equal(value.exchange_id, exchangeId);
        assert.equal(value.schema_version, 1);
        assert.ok(
          [
            'HELPER_PROTOCOL_INVALID',
            'HELPER_LIMIT_EXCEEDED',
            'EXCHANGE_CANCELLED',
            'EXCHANGE_DEADLINE',
          ].includes(value.code),
        );
      }
      offset += n + 4;
    }
    results.push(id);
  } finally {
    clearTimeout(watchdog);
    if (!exited) {
      child.kill('SIGKILL');
      await Promise.race([closed.catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    }
    for (const stream of child.stdio.filter(Boolean)) stream.destroy();
    if (!exited) cleanup = false;
    assert.ok(exited, 'owned child exit unconfirmed');
  }
}
let failed = false;
try {
  for (const [id] of invalidHelloVectors()) {
    // Regenerate time-bearing invalid inputs at each exchange, not suite entry.
    await exercise(id, new Map(invalidHelloVectors()).get(id));
  }
  await exercise('partial-prefix-eof', Buffer.from([0, 0]), false, true);
  await exercise('partial-body-eof', frame(hello()).subarray(0, 12), false, true);
  await exercise('parent-pipe-eof', undefined, true, true);
  for (const [id, value] of forbiddenExchangeVectors()) await exercise(id, frame(value), true);
  for (const [id, value] of closedExchangeVectors()) await exercise(id, frame(value), true);
} catch {
  failed = true;
}
await writeFile(
  `${evidence}/result.json`,
  JSON.stringify({
    status: failed ? 'FAIL' : 'PASS',
    completed: results,
    cleanup: cleanup ? 'PASS' : 'FAIL',
    failure: failed ? 'HELPER_CONTRACT_FAILURE' : null,
  }),
);
process.exitCode = failed || !cleanup ? 1 : 0;
