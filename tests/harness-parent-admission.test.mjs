// TEST ONLY. Design section 2, executable admission and pre-handoff refusal.
// Native no-launch/unit checks. These do not qualify spawned children or Bun pipes.
import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHelperExchange, resolveNodeRuntime } from '../src/harness/node-helper.js';
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
  } finally {
    await rm(owned, { recursive: true });
    await assert.rejects(access(owned, constants.F_OK), { code: 'ENOENT' });
  }
});

// TEST ONLY: script the imported ChildProcess boundary, not a production hook or
// an observation comparator. Real parent framing, admission, catch and cleanup
// execute against owned streams. No process, helper, broker or authority exists.
function submittedChild(confirmClose) {
  const child = new EventEmitter();
  const frames = [];
  const kills = [];
  const outbound = new PassThrough();
  const inbound = new Writable({
    write(bytes, encoding, done) {
      const value = JSON.parse(bytes.subarray(4).toString('utf8'));
      frames.push(value);
      if (value.type === 'hello') {
        outbound.write(frame({ ...ready(), exchange_id: value.exchange_id }));
      } else if (value.type === 'exchange') {
        outbound.write(
          frame({
            schema_version: 1,
            type: 'error',
            exchange_id: value.exchange_id,
            code: 'BROKER_UNAVAILABLE',
          }),
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
    if (confirmClose) queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  return { child, frames, kills };
}

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
