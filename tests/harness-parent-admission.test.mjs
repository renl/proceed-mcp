// TEST ONLY. Design section 2, executable admission and pre-handoff refusal.
// Native no-launch checks. These do not qualify spawned children or Bun pipes.
import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHelperExchange, resolveNodeRuntime } from '../src/harness/node-helper.js';
import { syntheticOperator } from './support/harness-helper-vectors.mjs';
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
