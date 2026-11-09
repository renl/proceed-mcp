// TEST ONLY. Actual maintained producer, memory files/streams/clock/events.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as capture from './support/harness-transparent-capture.mjs';

const text = (
  await readFile(new URL('./fixtures/harness-composition/mcp.mjs', import.meta.url), 'utf8')
).replace(/^import[\s\S]*?from '[^']+';\s*/gm, '');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
};
const root = '/run/proceed/qualification-private/';
async function fixture({ stalledWrite = false, ignores = false } = {}) {
  let now = 0,
    release,
    fileClosed = false,
    writes = 0;
  const files = new Map(),
    timers = new Map(),
    exits = [],
    kills = [];
  const p = new EventEmitter();
  const child = new EventEmitter();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (signal) => {
      kills.push(signal);
      if (!ignores) {
        child.stdout.end();
        child.emit('close', null, signal);
      }
    },
  });
  Object.assign(p, {
    platform: 'linux',
    version: 'v24.22.2',
    env: { PROCEED_TEST_ISOLATED_PID_NAMESPACE: '1' },
    argv: ['node', 'fixture', '/run/proceed/managed-fixtures/memory'],
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exit: (code) => exits.push(code),
  });
  child.stdin.resume();
  p.stdout.resume();
  const body = runInNewContext(`(async () => { ${text} })()`, {
    assert,
    Buffer,
    AbortController,
    process: p,
    Date: { now: () => now },
    setTimeout: (fn, delay) => {
      const key = {};
      timers.set(key, { fn, at: now + delay });
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
    spawn: () => child,
    open: async (path) => {
      files.set(path, Buffer.alloc(0));
      return {
        writeFile: async (line) => {
          writes++;
          if (stalledWrite)
            await new Promise((resolve) => {
              release = resolve;
            });
          assert.equal(fileClosed, false);
          files.set(path, Buffer.concat([files.get(path), Buffer.from(line)]));
        },
        close: async () => {
          fileClosed = true;
        },
      };
    },
    writeFile: async (path, data) => {
      if (path.endsWith('seal.json')) assert.equal(fileClosed, true);
      files.set(path, Buffer.from(data));
    },
    rm: async (path) => files.delete(path),
    ...capture,
  });
  body.catch(() => {});
  await flush();
  return {
    p,
    child,
    files,
    timers,
    exits,
    kills,
    body,
    get writes() {
      return writes;
    },
    release: () => release?.(),
    async advance(value) {
      now = value;
      for (const [key, t] of [...timers])
        if (t.at <= now) {
          timers.delete(key);
          t.fn();
        }
      await flush();
    },
    async adapter(code = 0, signal = null) {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code, signal);
      await flush();
    },
    receipt: () => files.get(root + 'mcp-seal.json'),
  };
}

for (const route of ['EOF', 'SIGTERM']) {
  test(`actual MCP ${route} drains accepted bytes and removes close owners`, async () => {
    const f = await fixture();
    f.p.stdin.write('request\n');
    f.child.stdout.write('response\n');
    await flush();
    if (route === 'EOF') f.p.stdin.end();
    else f.p.emit('SIGTERM');
    await flush();
    assert.equal(f.child.stdin.writableEnded, true);
    await f.adapter();
    await f.body;
    assert.deepEqual(f.exits, [0]);
    assert.equal(f.p.listenerCount('SIGTERM'), 0);
    assert.equal(f.p.stdin.listenerCount('end'), 0);
    assert.equal(f.timers.size, 0);
    capture.assertPrivateCaptureReceipt(f.files.get(root + 'mcp.jsonl'), JSON.parse(f.receipt()));
  });
}

test('SIGTERM queued write drains once, fences later ingress, duplicate EOF/signal never renews', async () => {
  const f = await fixture({ stalledWrite: true });
  f.p.stdin.write('accepted\n');
  await flush();
  f.p.emit('SIGTERM');
  await flush();
  const deadline = [...f.timers.values()][0].at;
  await f.advance(500);
  f.p.emit('SIGTERM');
  f.p.stdin.emit('end');
  assert.equal([...f.timers.values()][0].at, deadline);
  f.p.stdin.write('not accepted\n');
  f.release();
  await flush();
  await f.adapter();
  await f.body;
  assert.equal(f.writes, 1);
  assert.deepEqual(f.exits, [0]);
  assert.ok(f.receipt());
});

for (const mode of ['error', 'signal', 'stderr', 'ignores', 'late', 'SIGKILL']) {
  test(`actual MCP refuses receipt for ${mode}`, async () => {
    const f = await fixture({ stalledWrite: mode === 'late', ignores: true });
    if (mode === 'late') {
      f.p.stdin.write('pending\n');
      await flush();
    }
    if (mode === 'SIGKILL') {
      // Unhandleable process death: no callback/finally is run by this control.
      assert.equal(f.p.listenerCount('SIGKILL'), 0);
      assert.equal(f.receipt(), undefined);
    }
    f.p.emit('SIGTERM');
    if (mode === 'error') f.child.emit('error', Error('controlled failure'));
    if (mode === 'stderr') f.child.stderr.write('controlled failure');
    if (mode === 'signal') await f.adapter(null, 'SIGTERM');
    if (mode === 'late') await f.adapter();
    await f.advance(1900);
    assert.equal(f.receipt(), undefined);
    assert.ok(f.exits.includes(1));
    assert.equal(f.p.listenerCount('SIGTERM'), 0);
    f.release();
    await flush();
    assert.equal(f.receipt(), undefined);
  });
}

test('original startup lifetime caps late EOF grace, never a fresh 150 seconds', async () => {
  const f = await fixture({ ignores: true });
  assert.equal([...f.timers.values()][0].at, 150000);
  await f.advance(149500);
  f.p.stdin.end();
  await flush();
  assert.equal([...f.timers.values()][0].at, 150000);
  await f.advance(150000);
  assert.equal(f.receipt(), undefined);
  assert.deepEqual(f.exits, [1]);
  assert.equal(f.kills[0], 'SIGKILL');
});
