// TEST ONLY. One bounded container owns every OpenCode/PTY descendant.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hostBudgets } from './harness-host-plan.mjs';
import { linuxImage, linuxPayload, assertContainerPolicy } from './harness-linux-plan.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function runLinuxHost(preflight) {
  const started = Date.now();
  const end = started + hostBudgets.aggregate;
  const executionEnd = end - hostBudgets.teardownReserve;
  const command = async (args, ceiling = 10000, cleanup = false) => {
    const timeout = Math.min(ceiling, (cleanup ? end : executionEnd) - Date.now());
    assert.ok(timeout > 0, 'aggregate deadline reached');
    return execute('docker', args, {
      cwd: root,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  };
  for (const name of ['plugin', 'client']) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const installed = JSON.parse(
      await readFile(join(root, `node_modules/@opencode/${name}/package.json`), 'utf8'),
    );
    assert.equal(manifest.devDependencies[`@opencode/${name}`], '2.2.5');
    assert.equal(installed.version, '2.2.5');
  }
  const image = JSON.parse((await command(['image', 'inspect', linuxImage])).stdout)[0];
  assert.equal(image.Id, linuxImage);
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  for (const path of linuxPayload) assert.ok((await lstat(join(root, path))).isFile());
  await execute('git', ['check-ignore', '.scratch/harness-host/run-owned'], {
    cwd: root,
    timeout: 10000,
  });
  if (preflight) {
    console.log(
      JSON.stringify({
        mode: 'LINUX-NO-LAUNCH',
        image: linuxImage,
        checks: 'PASS',
        payload: linuxPayload,
        budgets: hostBudgets,
      }),
    );
    return;
  }
  const scratch = join(root, '.scratch/harness-host');
  await mkdir(scratch, { recursive: true });
  const run = await mkdtemp(join(scratch, 'run-linux-'));
  const stage = join(run, 'payload');
  const name = `proceed-harness-host-${randomUUID()}`;
  const progress = async (phase, extra = {}) =>
    writeFile(
      join(run, 'progress.json'),
      JSON.stringify({ phase, elapsed: Date.now() - started, name, ...extra }, null, 2),
    );
  let created = false;
  let failure;
  let cleanup = 'UNRUN';
  try {
    await progress('stage');
    for (const path of linuxPayload) {
      const destination = join(stage, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(root, path), destination);
    }
    const candidate = (
      await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })
    ).stdout.trim();
    await writeFile(
      join(run, 'candidate.json'),
      JSON.stringify(
        {
          candidate,
          image: linuxImage,
          payload: linuxPayload,
          command: 'node tests/run-harness-host.mjs --linux-run',
        },
        null,
        2,
      ),
    );
    await command([
      'create',
      '--pull=never',
      '--name',
      name,
      '--init',
      '--network',
      'none',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--mount',
      `type=bind,source=${resolve(stage)},target=/payload,readonly`,
      '--entrypoint',
      '/usr/bin/timeout',
      linuxImage,
      '--signal=KILL',
      '250',
      'node',
      '/payload/tests/support/harness-linux-inner.mjs',
    ]);
    created = true;
    const policy = JSON.parse((await command(['inspect', name])).stdout)[0];
    assertContainerPolicy(policy, stage);
    await writeFile(
      join(run, 'policy.json'),
      JSON.stringify(
        {
          image: policy.Image,
          network: policy.HostConfig.NetworkMode,
          pid: policy.HostConfig.PidMode,
          init: policy.HostConfig.Init,
          readonlyPayload: true,
          mounts: 1,
        },
        null,
        2,
      ),
    );
    await progress('contained-start');
    await command(['start', name]);
    // Release only after exact image/mount/PID/network policy validation.
    await command([
      'exec',
      name,
      'node',
      '-e',
      "require('node:fs').writeFileSync('/run/proceed-authorized','yes')",
    ]);
    await progress('execution');
    const waited = await command(['wait', name], executionEnd - Date.now());
    await progress('evidence', { containerExit: waited.stdout.trim() });
    // Only these synthetic/sanitized files may cross the container boundary.
    for (const file of [
      'result.json',
      'progress.jsonl',
      'transcript.ansi',
      'fixture.jsonl',
      'isolation.json',
    ]) {
      try {
        await command(['cp', `${name}:/run/proceed/evidence/${file}`, join(run, file)], 10000);
      } catch (error) {
        if (file === 'result.json') throw error;
      }
    }
    const result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
    assert.equal(waited.stdout.trim(), '0', result.failure ?? 'container failed');
    assert.equal(result.status, 'PASS', result.failure);
  } catch (error) {
    failure = error.message;
    // Failure evidence is copied before owned namespace destruction, never raw host logs.
    if (created)
      for (const file of [
        'result.json',
        'progress.jsonl',
        'transcript.ansi',
        'fixture.jsonl',
        'isolation.json',
      ]) {
        try {
          await command(
            ['cp', `${name}:/run/proceed/evidence/${file}`, join(run, file)],
            3000,
            true,
          );
        } catch {
          /* absent means UNRUN */
        }
      }
  } finally {
    await progress('teardown');
    if (created) {
      try {
        await command(['rm', '--force', name], 10000, true);
        const remaining = (
          await command(['ps', '--all', '--quiet', '--filter', `name=^/${name}$`], 10000, true)
        ).stdout.trim();
        assert.equal(remaining, '', 'exact owned container still exists');
        // Inspect must also report the exact object absent, not merely stopped.
        try {
          await command(['inspect', name], 5000, true);
          throw new Error('owned container still inspectable');
        } catch (error) {
          assert.match(error.stderr ?? '', /No such (object|container)/i);
        }
        cleanup = 'PASS - exact container absent, private PID namespace destroyed';
      } catch (error) {
        cleanup = `FAIL - ${error.message}`;
        failure ??= cleanup;
      }
    } else cleanup = 'NOT APPLICABLE - container not created';
    await writeFile(
      join(run, 'verdict.json'),
      JSON.stringify(
        {
          status: failure ? 'FAIL' : 'PASS',
          failure,
          cleanup,
          elapsed: Date.now() - started,
          image: linuxImage,
        },
        null,
        2,
      ),
    );
    await progress('complete', { cleanup });
    console.log(
      JSON.stringify(
        { status: failure ? 'FAIL' : 'PASS', failure, cleanup, evidence: run },
        null,
        2,
      ),
    );
  }
  if (failure) process.exitCode = 1;
}
