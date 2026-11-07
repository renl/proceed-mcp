// TEST ONLY. Actual parent, real Node children, kernel descriptors and termination.
// Synthetic peer substitution is confined to the imported spawn boundary.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runHelperExchange, packagedHelperEntry } from '../../src/harness/node-helper.js';
import { FrameReader } from '../../src/harness/helper-protocol.js';
import { syntheticOperator } from './harness-helper-vectors.mjs';
import {
  assertParentAdmission,
  assertParentPrivacy,
  assertParentRefusal,
  assertParentLifetime,
  assertNoSpawn,
} from './harness-parent-observations.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.versions.node, '24.22.2');
const evidence = '/run/proceed/evidence';
await mkdir(evidence, { recursive: true });
await mkdir('/run/proceed/parent-private', { recursive: true });
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
const original = childProcess.spawn;
const results = [],
  physical = [];
let cleanup = true,
  currentCase = 'setup',
  failedAssertion = null,
  failureLine = null;
const valid = {
  operation: 'pending',
  body: { harness_id: 'qualification', owner_id: 'owner', session_id: 'session' },
  port: 1,
  lockFile: '/run/proceed/parent-private/absent.lock',
  operatorCredential: syntheticOperator,
  env: {
    PATH: dirname(process.execPath),
    NODE_OPTIONS: syntheticOperator,
    HTTPS_PROXY: syntheticOperator,
    PROVIDER_KEY: syntheticOperator,
  },
  cwd: '/run/proceed',
};

async function exercise(
  mode,
  expected,
  { noSpawn = false, beforeAuthority = false, real = false } = {},
) {
  currentCase = mode;
  await writeFile(
    `${evidence}/progress.jsonl`,
    JSON.stringify({ case: mode, phase: 'start' }) + '\n',
    { flag: 'a' },
  );
  const controller = new AbortController();
  const entryAt = performance.now(),
    budget = 2500;
  let child, identityPromise, optionsObserved, proc, failure, result;
  let helloAt,
    readyAt,
    authorityAt,
    exitAt,
    closedAt,
    terminateAt,
    forceAt = null,
    fenceAt;
  let authorityFrames = 0,
    fenced = 0;
  const stdout = [],
    stderr = [];
  const reader = new FrameReader();
  const actualHelper = real
    ? packagedHelperEntry()
    : '/payload/tests/fixtures/harness-parent/child.mjs';
  childProcess.spawn = (exe, args, options) => {
    assert.equal(child, undefined, 'no automatic replay');
    assert.equal(args[0], packagedHelperEntry());
    optionsObserved = options;
    child = original(exe, real ? args : [actualHelper, mode], options);
    identityPromise = new Promise((resolve, reject) =>
      child.once('spawn', () => {
        Promise.all([
          readlink(`/proc/${child.pid}/exe`),
          readFile(`/proc/${child.pid}/cmdline`),
          readFile(`/proc/${child.pid}/environ`),
          readlink(`/proc/${child.pid}/fd/3`),
          readlink(`/proc/${child.pid}/fd/4`),
        ]).then(resolve, reject);
      }),
    );
    const write = child.stdio[3].write.bind(child.stdio[3]);
    child.stdio[3].write = (bytes, ...rest) => {
      const value = JSON.parse(bytes.subarray(4));
      if (value.type === 'hello') helloAt = performance.now();
      else {
        authorityAt = performance.now();
        authorityFrames++;
        if (mode === 'invocation-cancel' || mode === 'hung-child-force')
          queueMicrotask(() => {
            fenceAt = performance.now();
            controller.abort();
          });
      }
      return write(bytes, ...rest);
    };
    child.stdio[4].on('data', (bytes) => {
      try {
        for (const value of reader.push(bytes))
          if (value.type === 'ready') readyAt = performance.now();
      } catch {
        /* actual parent decides admission of hostile bytes */
      }
    });
    child.stdout.on('data', (b) => stdout.push(b));
    child.stderr.on('data', (b) => stderr.push(b));
    const kill = child.kill.bind(child);
    child.kill = (signal) => {
      if (signal === 'SIGKILL') forceAt = performance.now();
      else {
        terminateAt = performance.now();
        fenceAt ??= terminateAt;
      }
      return kill(signal);
    };
    child.once('exit', () => {
      exitAt = performance.now();
    });
    child.once('close', () => {
      closedAt = performance.now();
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    if (mode === 'preaborted-no-spawn') controller.abort();
    const env = mode === 'missing-node' ? { PATH: '' } : valid.env;
    try {
      result = await runHelperExchange({
        ...valid,
        env,
        signal: controller.signal,
        budgetMs: budget,
        onUnconfirmedCleanup: () => {
          fenced++;
        },
      });
    } catch (error) {
      failure = error;
    }
    if (child) {
      proc = await identityPromise;
      assert.equal(proc[0], process.execPath);
      for (const fd of proc.slice(3)) assert.match(fd, /^(socket|pipe):\[/);
      assert.notEqual(proc[3], proc[4]);
      assert.equal(proc[2].length, 0);
      assert.equal(child.exitCode !== null || child.signalCode !== null, true);
      assert.ok(Number.isFinite(closedAt), 'real close must precede return');
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      assert.ok(child.stdio.filter(Boolean).every((s) => s.destroyed));
      assert.ok(performance.now() <= entryAt + budget + 100, 'one original budget');
      physical.push({
        case: mode,
        pid: child.pid,
        executable: proc[0],
        fd3: proc[3],
        fd4: proc[4],
        authorityFrames,
        helloAt,
        readyAt,
        authorityAt,
        terminateAt,
        forceAt,
        exitAt,
        closedAt,
      });
      assertParentPrivacy(
        {
          argv: proc[1],
          environment: proc[2],
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          diagnostics: Buffer.from(
            failure ? String(failure) + JSON.stringify(failure) : JSON.stringify(result),
          ),
        },
        [syntheticOperator],
      );
    }
    if (noSpawn)
      assertNoSpawn({
        spawnedPids: child ? [child.pid] : [],
        authorityFrames,
        acceptedResponses: result ? 1 : 0,
      });
    if (expected === null) {
      assert.equal(failure, undefined);
      assert.deepEqual(result, { status: 200, body: { schema_version: 1, presentation: null } });
      const identity = JSON.parse(await readFile(`/run/proceed/parent-private/${mode}.json`));
      assert.equal(identity.pid, child.pid);
      assertParentAdmission(
        {
          spawn: {
            executable: proc[0],
            realExecutable: proc[0],
            helper: actualHelper,
            realHelper: actualHelper,
            ...optionsObserved,
            environment: identity.environment,
            requiredOSVariables: [],
          },
          runtime: { ...identity, executable: proc[0] },
          pipes: {
            private: true,
            lifetimeClosedBeforeResponseExit: closedAt < exitAt,
            helloAt,
            readyAt,
            authorityAt,
            authorityFrames,
          },
        },
        { executable: process.execPath, helper: actualHelper },
      );
    } else {
      assert.equal(result, undefined, 'hostile output must never be admitted');
      assert.ok(expected.includes(failure?.code), `wrong refusal for ${mode}`);
      assert.equal(failure.submitted, authorityFrames > 0);
      const refusal = {
        acceptedResponses: result ? 1 : 0,
        authorityFrames,
        ownedChildrenRemaining:
          child && child.exitCode === null && child.signalCode === null ? 1 : 0,
        openOwnedPipes: child ? child.stdio.filter((s) => s && !s.destroyed).length : 0,
        openOwnedSockets: 0,
        liveOwnedTimers: 0,
      };
      // Peer fixtures create no sockets or retained timers outside their child.
      assertParentRefusal(refusal, { beforeAuthority });
      if (mode === 'hung-child-force') {
        assert.equal(child.signalCode, 'SIGKILL');
        assertParentLifetime({
          ...refusal,
          entryAt,
          fenceAt,
          terminateAt,
          forceAt,
          exitAt,
          closedAt,
          admittedAt: null,
          deadlineAt: entryAt + budget,
          nextPhaseAfterFence: 0,
          unrelatedSignals: 0,
        });
      }
    }
    assert.equal(fenced, 0, 'confirmed physical cleanup must not disable generation');
    results.push(mode);
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((r) => {
        child.once('close', r);
        setTimeout(r, 1000).unref();
      });
    }
    if (child) {
      try {
        process.kill(child.pid, 0);
        cleanup = false;
      } catch (e) {
        if (e.code !== 'ESRCH') cleanup = false;
      }
    }
  }
}

let status = 'FAIL';
try {
  await exercise('supported-node-positive', null);
  await exercise('real-production-helper', ['BROKER_UNAVAILABLE'], { real: true });
  await exercise('missing-node', ['NODE_UNAVAILABLE'], { noSpawn: true, beforeAuthority: true });
  await exercise('preaborted-no-spawn', ['EXCHANGE_CANCELLED'], {
    noSpawn: true,
    beforeAuthority: true,
  });
  for (const mode of [
    'unsupported-node',
    'bun-not-node',
    'malformed-child',
    'oversized-child',
    'partial-child',
    'parent-eof',
    'wrong-id',
    'wrong-order',
    'wrong-version',
  ])
    await exercise(mode, ['HELPER_PROTOCOL_INVALID', 'HELPER_LIMIT_EXCEEDED'], {
      beforeAuthority: true,
    });
  for (const mode of ['stdout-tripwire', 'stderr-tripwire', 'response-then-nonzero-exit'])
    await exercise(mode, ['HELPER_PROTOCOL_INVALID']);
  await exercise('invocation-cancel', ['EXCHANGE_CANCELLED']);
  await exercise('hung-child-force', ['EXCHANGE_CANCELLED']);
  await exercise('exchange-deadline', ['EXCHANGE_DEADLINE']);
  await exercise('response-with-open-pipes', ['EXCHANGE_DEADLINE']);
  await exercise('extra-child-frame', ['HELPER_PROTOCOL_INVALID']);
  status = 'PASS';
} catch (error) {
  // Failure strings remain private. Export only a fixed assertion classification.
  failedAssertion = error.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'OBSERVER_FAILED';
  failureLine = /harness-parent-inner\.mjs:(\d+):/.exec(error.stack)?.[1] ?? null;
  process.exitCode = 1;
} finally {
  await writeFile(
    `${evidence}/result.json`,
    JSON.stringify({
      status,
      cleanup: cleanup ? 'PASS' : 'FAIL',
      passed: results,
      failed: status === 'FAIL' ? currentCase : null,
      failedAssertion,
      failureLine,
      physical,
      scope:
        'actual Node parent with synthetic process peers and unchanged production helper refusal',
      nh5Attempts: 0,
    }),
  );
}
