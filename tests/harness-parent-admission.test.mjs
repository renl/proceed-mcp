// TEST ONLY. Design section 2, executable admission and pre-handoff refusal.
// Native no-launch/unit checks. These do not qualify spawned children or Bun pipes.
import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { PassThrough, Writable } from 'node:stream';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runHelperExchange,
  resolveNodeRuntime,
  packagedHelperEntry,
} from '../src/harness/node-helper.js';
import { frame, ready, syntheticOperator } from './support/harness-helper-vectors.mjs';
import { assertNoSpawn } from './support/harness-parent-observations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const valid = {
  operation: 'pending',
  body: { harness_id: 'qualification', owner_id: 'owner', session_id: 'session' },
  port: 1,
  lockFile: join(root, '.scratch/harness-parent-admission/absent.lock'),
  operatorCredential: syntheticOperator,
};

test('actual parent refuses invalid input, preabort and missing Node before any spawn attempt', async () => {
  const original = childProcess.spawn;
  let attempts = 0;
  // Observe the actual imported spawn boundary and forbid accidental host launch.
  // No fake ChildProcess or invented production observation object is supplied.
  childProcess.spawn = () => {
    attempts += 1;
    throw new Error('unexpected native child launch');
  };
  syncBuiltinESMExports();
  try {
    const controller = new AbortController();
    controller.abort();
    for (const [options, code] of [
      [{ operation: 'start' }, 'HELPER_PROTOCOL_INVALID'],
      [{ body: { ...valid.body, url: 'https://invalid.example' } }, 'HELPER_PROTOCOL_INVALID'],
      [{ operatorCredential: 'not-authority' }, 'HELPER_PROTOCOL_INVALID'],
      [{ signal: controller.signal }, 'EXCHANGE_CANCELLED'],
      [{ env: { PATH: '' } }, 'NODE_UNAVAILABLE'],
    ]) {
      await assert.rejects(runHelperExchange({ ...valid, ...options }), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.submitted, false);
        assert.equal(JSON.stringify(error).includes(syntheticOperator), false);
        assert.equal(String(error).includes(syntheticOperator), false);
        return true;
      });
    }
    assert.equal(attempts, 0);
    // Zero attempts means no child or authority pipe existed in these calls.
    assertNoSpawn({ spawnedPids: [], authorityFrames: 0, acceptedResponses: 0 });
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});

test('actual resolver rejects a shell wrapper instead of selecting it as Node', async () => {
  const scratch = join(root, '.scratch/harness-parent-admission');
  await mkdir(scratch, { recursive: true });
  const owned = await mkdtemp(join(scratch, 'admission-'));
  const original = childProcess.spawn;
  let attempts = 0;
  childProcess.spawn = () => {
    attempts++;
    throw new Error('wrapper must not execute');
  };
  syncBuiltinESMExports();
  try {
    const candidate = join(owned, process.platform === 'win32' ? 'node.exe' : 'node');
    // This file is never executed. A shell script is not a genuine Node runtime,
    // even when it has the searched basename and an absolute PATH directory.
    await writeFile(candidate, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await assert.rejects(
      resolveNodeRuntime({ env: { PATH: owned }, cwd: dirname(owned) }),
      (error) => ['NODE_UNAVAILABLE', 'NODE_UNSUPPORTED'].includes(error.code),
      'shell wrappers must not be admitted as runtime identities',
    );
    await assert.rejects(runHelperExchange({ ...valid, env: { PATH: owned } }), {
      code: 'NODE_UNAVAILABLE',
      submitted: false,
    });
    assert.equal(attempts, 0, 'actual parent must not execute the wrapper');
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    await rm(owned, { recursive: true });
    await assert.rejects(access(owned, constants.F_OK), { code: 'ENOENT' });
  }
});

test('actual parent excludes relative, empty and current-directory runtime search entries', async () => {
  const original = childProcess.spawn;
  let attempts = 0;
  childProcess.spawn = () => {
    attempts++;
    throw new Error('unsafe PATH must not spawn');
  };
  syncBuiltinESMExports();
  try {
    for (const PATH of ['.', '', delimiter, dirname(process.execPath)]) {
      await assert.rejects(
        runHelperExchange({ ...valid, env: { PATH }, cwd: dirname(process.execPath) }),
        { code: 'NODE_UNAVAILABLE', submitted: false },
      );
    }
    assert.equal(attempts, 0);
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});

test('actual parent rejects closed operations and extra body inputs with valid authority before spawn', async () => {
  const original = childProcess.spawn;
  let attempts = 0;
  childProcess.spawn = () => {
    attempts++;
    throw new Error('invalid operation must not spawn');
  };
  syncBuiltinESMExports();
  try {
    const inputs = [
      ...['start', 'stop', 'readiness', 'owner', 'control', 'proxy'].map((operation) => ({
        operation,
      })),
      ...['url', 'method', 'headers', 'proxy', 'key_file', 'owner_token', 'control_token'].map(
        (field) => ({
          body: { ...valid.body, [field]: 'forbidden' },
        }),
      ),
    ];
    for (const input of inputs) {
      await assert.rejects(runHelperExchange({ ...valid, ...input }), {
        code: 'HELPER_PROTOCOL_INVALID',
        submitted: false,
      });
    }
    assert.equal(attempts, 0);
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});

test('actual parent refuses changed executable and helper identities before spawn', async () => {
  // Script only the imported filesystem observation. No installed file is edited.
  // This proves the parent's race handling, not real filesystem replacement.
  const originalStat = fsPromises.lstat;
  const originalSpawn = childProcess.spawn;
  let attempts = 0;
  childProcess.spawn = () => {
    attempts++;
    throw new Error('replaced identity must not spawn');
  };
  try {
    for (const [target, code] of [
      [process.execPath, 'NODE_UNAVAILABLE'],
      [packagedHelperEntry(), 'HELPER_PROTOCOL_INVALID'],
    ]) {
      let observations = 0;
      const realTarget = await fsPromises.realpath(target);
      const matches = new Set(
        [target, realTarget].map((p) => p.replaceAll('\\', '/').toLowerCase()),
      );
      fsPromises.lstat = async (path, ...args) => {
        const stat = await originalStat(path, ...args);
        if (!matches.has(String(path).replaceAll('\\', '/').toLowerCase())) return stat;
        observations++;
        // fileIdentity observes link and real-file stat on each pass. Change the
        // second pass, retaining methods and all unrelated real stat properties.
        if (observations <= 2) return stat;
        return new Proxy(stat, {
          get(value, key) {
            return key === 'mtimeMs' ? value.mtimeMs + 1 : Reflect.get(value, key);
          },
        });
      };
      syncBuiltinESMExports();
      await assert.rejects(
        runHelperExchange({ ...valid, env: { PATH: dirname(process.execPath) }, cwd: root }),
        { code, submitted: false },
      );
      assert.ok(observations >= 4, 'both identity observations must be reached');
      assert.equal(attempts, 0);
    }
  } finally {
    fsPromises.lstat = originalStat;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// TEST ONLY: script the imported ChildProcess boundary, not a production hook or
// an observation comparator. Real parent framing, admission, catch and cleanup
// execute against owned streams. No process, helper, broker or authority exists.
function submittedChild(
  confirmClose,
  { stall = null, closeDelay = 0, terminationDelay = 0, responseTail = null } = {},
) {
  const child = new EventEmitter();
  const frames = [];
  const kills = [];
  const signalCalls = [];
  const timers = [];
  let closedAt;
  const outbound = new PassThrough();
  const inbound = new Writable({
    write(bytes, encoding, done) {
      const value = JSON.parse(bytes.subarray(4).toString('utf8'));
      frames.push(value);
      if (value.type === 'hello') {
        if (stall !== 'ready')
          outbound.write(frame({ ...ready(), exchange_id: value.exchange_id }));
      } else if (value.type === 'exchange') {
        if (stall === 'reply') return done();
        if (responseTail !== null) {
          const response = frame({
            schema_version: 1,
            type: 'response',
            exchange_id: value.exchange_id,
            status: 200,
            body: { schema_version: 1, presentation: null },
          });
          const tail = {
            valid: Buffer.alloc(0),
            extra: response,
            partial: Buffer.from([0, 0]),
            malformed: Buffer.from([0, 0, 0, 1, 0xff]),
          }[responseTail];
          outbound.end(Buffer.concat([response, tail]), () => {
            queueMicrotask(() => child.emit('close', 0, null));
          });
          return done();
        }
        outbound.write(
          frame(
            stall === 'close'
              ? {
                  schema_version: 1,
                  type: 'response',
                  exchange_id: value.exchange_id,
                  status: 200,
                  body: { schema_version: 1, presentation: null },
                }
              : {
                  schema_version: 1,
                  type: 'error',
                  exchange_id: value.exchange_id,
                  code: 'BROKER_UNAVAILABLE',
                },
          ),
        );
      }
      done();
    },
  });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr, inbound, outbound];
  child.kill = (signal) => {
    kills.push(signal ?? 'SIGTERM');
    signalCalls.push({ signal: signal ?? 'SIGTERM', at: performance.now() });
    if (signal !== 'SIGKILL') {
      const until = performance.now() + terminationDelay;
      while (performance.now() < until) {
        /* finite synthetic termination-call delay */
      }
    }
    const close = () => {
      closedAt = performance.now();
      child.emit('close', null, signal ?? 'SIGTERM');
    };
    if (confirmClose) queueMicrotask(close);
    else if (stall !== null && signal === 'SIGKILL') timers.push(setTimeout(close, closeDelay));
    return true;
  };
  return {
    child,
    frames,
    kills,
    signalCalls,
    get closedAt() {
      return closedAt;
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

test('actual parent admits one ended response and refuses extra or trailing bytes without replay', async () => {
  const original = childProcess.spawn;
  try {
    for (const responseTail of ['valid', 'extra', 'partial', 'malformed']) {
      const fixture = submittedChild(true, { responseTail });
      let attempts = 0;
      childProcess.spawn = () => {
        attempts++;
        return fixture.child;
      };
      syncBuiltinESMExports();
      try {
        const exchange = runHelperExchange({
          ...valid,
          env: { PATH: dirname(process.execPath) },
          cwd: root,
          budgetMs: 3000,
        });
        if (responseTail === 'valid') {
          assert.deepEqual(await exchange, {
            status: 200,
            body: { schema_version: 1, presentation: null },
          });
        } else {
          await assert.rejects(exchange, (error) => {
            assert.equal(error.code, 'HELPER_PROTOCOL_INVALID', responseTail);
            assert.equal(error.submitted, true);
            assert.equal(String(error).includes(syntheticOperator), false);
            return true;
          });
        }
        assert.equal(attempts, 1);
        assert.deepEqual(
          fixture.frames.map((value) => value.type),
          ['hello', 'exchange'],
        );
        // Malformed bytes may fail before the scripted clean-close microtask.
        // The parent then requests normal owned cleanup, not a second exchange.
        assert.deepEqual(fixture.kills, responseTail === 'malformed' ? ['SIGTERM'] : []);
        assert.ok(fixture.child.stdio.filter(Boolean).every((stream) => stream.destroyed));
      } finally {
        fixture.dispose();
        for (const stream of fixture.child.stdio.filter(Boolean)) stream.destroy();
      }
    }
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});

for (const confirmClose of [true, false]) {
  test(
    `actual parent preserves submitted after handoff with ${confirmClose ? 'confirmed' : 'unconfirmed'} cleanup`,
    { timeout: 5000 },
    async () => {
      const fixture = submittedChild(confirmClose);
      const original = childProcess.spawn;
      let attempts = 0;
      let fenced = 0;
      childProcess.spawn = () => {
        attempts += 1;
        return fixture.child;
      };
      syncBuiltinESMExports();
      try {
        // Resolve the already-running genuine Node installation. It is not
        // launched. A corrected resolver must not need to accept a wrapper here.
        let failure;
        try {
          await runHelperExchange({
            ...valid,
            env: { PATH: dirname(process.execPath) },
            cwd: root,
            budgetMs: 3000,
            onUnconfirmedCleanup: () => {
              fenced += 1;
            },
          });
        } catch (error) {
          failure = error;
        }
        assert.equal(attempts, 1);
        assert.deepEqual(
          fixture.frames.map((value) => value.type),
          ['hello', 'exchange'],
        );
        assert.equal(fixture.frames[1].operator_credential, syntheticOperator);
        assert.equal(fixture.frames[1].exchange_id, fixture.frames[0].exchange_id);
        assert.deepEqual(fixture.kills, confirmClose ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
        assert.equal(fenced, confirmClose ? 0 : 1);
        assert.ok(fixture.child.stdio.filter(Boolean).every((stream) => stream.destroyed));
        assert.equal(
          failure?.code,
          confirmClose ? 'BROKER_UNAVAILABLE' : 'HELPER_PROTOCOL_INVALID',
        );
        assert.equal(JSON.stringify(failure).includes(syntheticOperator), false);
        assert.equal(String(failure).includes(syntheticOperator), false);
        assert.equal(
          failure.submitted,
          true,
          'unconfirmed cleanup must not erase observed authority handoff',
        );
      } finally {
        childProcess.spawn = original;
        syncBuiltinESMExports();
        for (const stream of fixture.child.stdio.filter(Boolean)) stream.destroy();
      }
    },
  );
}

test(
  'actual parent cleanup uses actual remaining time after delayed termination',
  { timeout: 5000 },
  async () => {
    const fixture = submittedChild(false, { terminationDelay: 150 });
    const original = childProcess.spawn;
    let fenced = 0;
    childProcess.spawn = () => fixture.child;
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        runHelperExchange({
          ...valid,
          env: { PATH: dirname(process.execPath) },
          cwd: root,
          budgetMs: 3000,
          onUnconfirmedCleanup: () => {
            fenced++;
          },
        }),
        (error) => {
          assert.equal(error.code, 'HELPER_PROTOCOL_INVALID');
          assert.equal(error.submitted, true);
          return true;
        },
      );
      const returnedAt = performance.now();
      assert.equal(fenced, 1);
      assert.deepEqual(fixture.kills, ['SIGTERM', 'SIGKILL']);
      assert.ok(fixture.child.stdio.filter(Boolean).every((stream) => stream.destroyed));
      const [term, force] = fixture.signalCalls.map((call) => call.at);
      const violations = [];
      if (!(force <= term + 500)) violations.push('force request exceeded 500 ms');
      if (!(returnedAt <= term + 1000))
        violations.push('cleanup renewed time after delayed termination');
      assert.deepEqual(
        violations,
        [],
        'actual remaining cleanup time, not nominal wait subtraction',
      );
    } finally {
      childProcess.spawn = original;
      syncBuiltinESMExports();
      fixture.dispose();
      for (const stream of fixture.child.stdio.filter(Boolean)) stream.destroy();
    }
  },
);

// Native scripted-stream regressions, not real-child timing qualification.
// Each stalled phase ignores SIGTERM and closes only after SIGKILL plus a known
// delay. Charge delayed spawn and all later phases to the same entry deadline.
for (const stall of ['ready', 'reply', 'close']) {
  test(
    `actual parent reserves cleanup inside original budget for stalled ${stall}`,
    { timeout: 5000 },
    async () => {
      const fixture = submittedChild(false, { stall, closeDelay: 100 });
      const original = childProcess.spawn;
      const budget = 1800;
      let attempts = 0,
        fenced = 0;
      childProcess.spawn = () => {
        attempts++;
        const until = performance.now() + 150;
        while (performance.now() < until) {
          /* finite synthetic spawn delay */
        }
        return fixture.child;
      };
      syncBuiltinESMExports();
      const entryAt = performance.now();
      try {
        let failure;
        try {
          await runHelperExchange({
            ...valid,
            env: { PATH: dirname(process.execPath) },
            cwd: root,
            budgetMs: budget,
            onUnconfirmedCleanup: () => {
              fenced++;
            },
          });
        } catch (error) {
          failure = error;
        }
        const returnedAt = performance.now();
        assert.equal(attempts, 1, 'no renewed exchange or replay');
        assert.equal(failure?.submitted, stall !== 'ready');
        assert.deepEqual(
          fixture.frames.map((value) => value.type),
          stall === 'ready' ? ['hello'] : ['hello', 'exchange'],
        );
        assert.equal(JSON.stringify(failure).includes(syntheticOperator), false);
        assert.ok(fixture.child.stdio.filter(Boolean).every((stream) => stream.destroyed));
        const term = fixture.signalCalls.find((call) => call.signal === 'SIGTERM')?.at;
        const force = fixture.signalCalls.find((call) => call.signal === 'SIGKILL')?.at;
        const violations = [];
        if (!(term <= entryAt + budget - 1000))
          violations.push('active work consumed cleanup reserve');
        if (!(force >= term && force <= term + 500))
          violations.push('force request exceeded 500 ms');
        if (!(fixture.closedAt >= force && fixture.closedAt <= term + 1000))
          violations.push('close exceeded cleanup deadline or was unconfirmed');
        if (!(fixture.closedAt <= entryAt + budget && returnedAt <= entryAt + budget))
          violations.push('original budget renewed or exceeded');
        if (fenced !== 0 || failure?.code !== 'EXCHANGE_DEADLINE')
          violations.push('confirmed cleanup/deadline outcome missing');
        assert.deepEqual(violations, [], 'exact bounds, no timing allowance');
      } finally {
        childProcess.spawn = original;
        syncBuiltinESMExports();
        fixture.dispose();
        for (const stream of fixture.child.stdio.filter(Boolean)) stream.destroy();
      }
    },
  );
}
