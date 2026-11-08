// TEST ONLY. One bounded container owns every OpenCode/PTY descendant.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  copyFile,
  writeFile,
  readFile,
  lstat,
  appendFile,
  rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { hostBudgets } from './harness-host-plan.mjs';
import {
  rendererPayload,
  assertRendererExport,
  safeRendererDiagnostic,
} from './harness-renderer-observation.mjs';
import {
  retainProgress,
  safeCompositionDiagnostic,
  assertCompositionExport,
} from './harness-composition-retention.mjs';
import {
  assertTransportDiagnostic,
  assertDetailedTransportExport,
} from './harness-runtime-transport.mjs';
import {
  linuxImage,
  linuxPayload,
  qualificationPayload,
  assertContainerPolicy,
} from './harness-linux-plan.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function runLinuxHost(preflight, mode = 'platform', helperEntry) {
  assert.ok(
    [
      'platform',
      'broker-setup',
      'transport',
      'transport-first-exchange',
      'helper-contract',
      'parent-process',
      'composition',
      'renderer',
    ].includes(mode),
  );
  const parent = mode === 'parent-process';
  const renderer = mode === 'renderer';
  const composition = mode === 'composition';
  const helper = mode === 'helper-contract' || parent;
  if (helper && !parent) {
    assert.equal(
      typeof helperEntry,
      'string',
      'HELPER_ENTRY_REQUIRED - implementation has not selected a packaged helper',
    );
    assert.match(helperEntry, /^src\/[a-zA-Z0-9_/-]+\.js$/);
    assert.ok((await lstat(join(root, helperEntry))).isFile());
  }
  const setupOnly = mode === 'broker-setup';
  const firstOnly = mode === 'transport-first-exchange';
  const transport = mode === 'transport' || firstOnly || composition;
  const payload = renderer
    ? rendererPayload
    : setupOnly || transport || helper
      ? qualificationPayload(
          (
            await execute('git', ['ls-files', '--', 'src', 'bin'], { cwd: root, timeout: 10000 })
          ).stdout
            .trim()
            .split(/\r?\n/),
        )
      : linuxPayload;
  if (helper && !parent)
    assert.ok(payload.includes(helperEntry), 'helper must be a tracked payload source');
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
  for (const path of payload) assert.ok((await lstat(join(root, path))).isFile());
  if (transport || helper || renderer) {
    // Owner README/status overlays are excluded. Every staged input must be clean.
    await execute('git', ['diff', '--quiet', 'HEAD', '--', ...payload], {
      cwd: root,
      timeout: 10000,
    });
    const tracked = (
      await execute('git', ['ls-files'], { cwd: root, timeout: 10000 })
    ).stdout.split(/\r?\n/);
    for (const path of payload) assert.ok(tracked.includes(path), `uncommitted payload: ${path}`);
  }
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
        payload,
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
  let progressState;
  const evidenceDestination = (file) =>
    join(run, file === 'progress.jsonl' ? 'inner-progress.jsonl' : file);
  const progress = async (phase, extra = {}) => {
    progressState = retainProgress(progressState, phase, extra);
    const record = { ...progressState, elapsed: Date.now() - started, name };
    await appendFile(join(run, 'progress.jsonl'), JSON.stringify(record) + '\n');
    await writeFile(join(run, 'progress.json'), JSON.stringify(record, null, 2));
  };
  const retainDiagnostic = async (cleanup = false) => {
    // Quarantine never becomes retained diagnostic evidence without revalidation.
    const privatePath = join(run, 'composition-diagnostic.private');
    try {
      await command(
        ['cp', `${name}:/run/proceed/evidence/composition-diagnostic.json`, privatePath],
        3000,
        cleanup,
      );
      const safe = safeCompositionDiagnostic(JSON.parse(await readFile(privatePath, 'utf8')));
      await writeFile(join(run, 'composition-diagnostic.json'), JSON.stringify(safe));
      return safe;
    } finally {
      await rm(privatePath, { force: true });
    }
  };
  let created = false;
  let failure;
  let cleanup = 'UNRUN';
  try {
    await progress('stage');
    for (const path of payload) {
      const destination = join(stage, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(root, path), destination);
    }
    if (setupOnly || transport || helper || renderer)
      await writeFile(join(stage, 'input-paths.json'), JSON.stringify(payload));
    const integrity = [];
    for (const path of payload) {
      const source = await readFile(join(root, path));
      const staged = await readFile(join(stage, path));
      assert.ok(source.equals(staged), `staged input differs: ${path}`);
      integrity.push({ path, sha256: createHash('sha256').update(staged).digest('hex') });
    }
    await writeFile(join(run, 'input-integrity.json'), JSON.stringify(integrity, null, 2));
    if (renderer) {
      const outerInputs = [
        'tests/run-harness-host.mjs',
        'tests/support/harness-linux-runner.mjs',
        'tests/harness-renderer-calibration.test.mjs',
      ];
      await execute('git', ['diff', '--quiet', 'HEAD', '--', ...outerInputs], {
        cwd: root,
        timeout: 10000,
      });
      await writeFile(
        join(run, 'outer-input-integrity.json'),
        JSON.stringify(
          await Promise.all(
            outerInputs.map(async (path) => ({
              path,
              sha256: createHash('sha256')
                .update(await readFile(join(root, path)))
                .digest('hex'),
            })),
          ),
          null,
          2,
        ),
      );
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
          payload,
          command: `node tests/run-harness-host.mjs ${renderer ? '--renderer-run' : composition ? '--composition-run' : parent ? '--parent-process-run' : helper ? '--helper-contract-run ' + helperEntry : firstOnly ? '--transport-first-exchange-run' : transport ? '--transport-run' : setupOnly ? '--broker-setup-run' : '--linux-run'}`,
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
      renderer
        ? '/payload/tests/support/harness-renderer-inner.mjs'
        : helper
          ? parent
            ? '/payload/tests/support/harness-parent-inner.mjs'
            : '/payload/tests/support/harness-helper-inner.mjs'
          : composition
            ? '/payload/tests/support/harness-composition-inner.mjs'
            : transport
              ? '/payload/tests/support/harness-transport-inner.mjs'
              : setupOnly
                ? '/payload/tests/support/harness-setup-inner.mjs'
                : '/payload/tests/support/harness-linux-inner.mjs',
      ...(firstOnly ? ['--first-exchange-only'] : []),
      ...(helper && !parent ? ['/payload/' + helperEntry] : []),
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
    const observedExit = waited.stdout.trim();
    await progress('evidence', {
      containerExit: /^\d{1,3}$/.test(observedExit) ? observedExit : 'UNLISTED_EXIT',
    });
    if (renderer) {
      await command([
        'cp',
        `${name}:/run/proceed/evidence/renderer-diagnostic.json`,
        join(run, 'renderer-diagnostic.private'),
      ]);
      try {
        const diagnostic = safeRendererDiagnostic(
          JSON.parse(await readFile(join(run, 'renderer-diagnostic.private'), 'utf8')),
        );
        await writeFile(join(run, 'renderer-diagnostic.json'), JSON.stringify(diagnostic));
        // Calibration failure does not bypass or skip full capture scanning.
        await command([
          'cp',
          `${name}:/run/proceed/evidence/scan-pass.json`,
          join(run, 'scan-pass.json'),
        ]);
        assertRendererExport(JSON.parse(await readFile(join(run, 'scan-pass.json'), 'utf8')));
        for (const file of [
          'binding.json',
          'observations.json',
          'fixture.jsonl',
          'inventory.json',
          'transcript.ansi',
          'diagnostics.log',
          'progress.jsonl',
        ])
          await command(['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)]);
        assert.equal(waited.stdout.trim(), '0', 'RENDERER_CONTROL_FAILURE');
        assert.equal(diagnostic.status, 'PASS');
      } finally {
        await rm(join(run, 'renderer-diagnostic.private'), { force: true });
      }
    } else if (composition) {
      // Fixed phase/classification is not raw capture. Detailed assertion export
      // is forbidden until the complete in-container raw scan has passed.
      const diagnostic = await retainDiagnostic();
      assert.ok(['PASS', 'FAIL'].includes(diagnostic.status));
      assert.equal(waited.stdout.trim(), '0', 'COMPOSITION_CONTROL_FAILURE');
      assert.equal(diagnostic.status, 'PASS');
      await command([
        'cp',
        `${name}:/run/proceed/evidence/scan-pass.json`,
        join(run, 'scan-pass.json'),
      ]);
      assertCompositionExport(JSON.parse(await readFile(join(run, 'scan-pass.json'), 'utf8')));
      for (const file of ['composition-summary.json', 'progress.jsonl'])
        await command(['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)]);
      for (const file of [
        'composition-observations.json',
        'transcript.ansi',
        'plugin-diagnostics.log',
      ])
        await command(['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)]);
    } else if (helper) {
      // No raw child bytes or arbitrary exception strings cross this boundary.
      await command(['cp', `${name}:/run/proceed/evidence/result.json`, join(run, 'result.json')]);
      const result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
      assert.equal(waited.stdout.trim(), '0', 'HELPER_CONTRACT_FAILURE');
      assert.equal(result.status, 'PASS');
      assert.equal(result.cleanup, 'PASS');
    } else if (transport) {
      // This one allowlisted diagnostic has its own in-container secret floor.
      // Nothing from the raw capture set is copied in diagnostic-only mode.
      await command([
        'cp',
        `${name}:/run/proceed/evidence/diagnostic-export.json`,
        join(run, 'diagnostic-export.json'),
      ]);
      const diagnostic = assertTransportDiagnostic(
        JSON.parse(await readFile(join(run, 'diagnostic-export.json'), 'utf8')),
      );
      if (firstOnly) {
        assert.equal(waited.stdout.trim(), '0', 'first enrolled exchange failed');
        assert.equal(diagnostic.classification, 'FIRST_EXCHANGE_PASS');
        assert.equal(diagnostic.case, 'enrolled');
      } else {
        // Mandatory scan marker must exist and pass BEFORE any detailed export.
        await command([
          'cp',
          `${name}:/run/proceed/evidence/scan-pass.json`,
          join(run, 'scan-pass.json'),
        ]);
        assertDetailedTransportExport(
          JSON.parse(await readFile(join(run, 'scan-pass.json'), 'utf8')),
        );
        for (const file of [
          'result.json',
          'progress.jsonl',
          'transport-summary.json',
          'transport-cleanup.json',
        ])
          await command(['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)]);
        const result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
        assert.equal(waited.stdout.trim(), '0', result.failure ?? 'embedded transport failed');
        assert.equal(result.status, 'PASS', result.failure);
      }
    } else {
      // Only these synthetic/sanitized files may cross the container boundary.
      for (const file of [
        'result.json',
        'progress.jsonl',
        'transcript.ansi',
        'fixture.jsonl',
        'isolation.json',
        'staging.json',
        'plugin-diagnostics.log',
        'plugin-inventory.json',
        'server-inventory.json',
      ]) {
        try {
          await command(
            ['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)],
            10000,
          );
        } catch (error) {
          if (file === 'result.json') throw error;
        }
      }
      const result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
      assert.equal(waited.stdout.trim(), '0', result.failure ?? 'container failed');
      assert.equal(result.status, 'PASS', result.failure);
    }
  } catch (error) {
    if (renderer && created) {
      // Fixed metadata survives a missing scan or aborted outer wait. No raw fallback.
      let diagnostic = {
        status: 'FAIL',
        failure: 'CONTROL_OR_IO',
        phase: 'UNOBSERVED',
        scanReason: 'UNRUN',
        frames: null,
        bytes: null,
        counts: { ctrlG: null, arrowDown: null, observe: null, escape: null, enter: null },
        runtime: { host: 'UNKNOWN', bun: 'UNKNOWN' },
        cleanup: false,
        hostExit: false,
      };
      try {
        await command(
          [
            'cp',
            `${name}:/run/proceed/evidence/renderer-diagnostic.json`,
            join(run, 'renderer-diagnostic.private'),
          ],
          3000,
          true,
        );
        diagnostic = safeRendererDiagnostic(
          JSON.parse(await readFile(join(run, 'renderer-diagnostic.private'), 'utf8')),
        );
      } catch {
        /* fixed unknowns, not fabricated counts */
      } finally {
        await rm(join(run, 'renderer-diagnostic.private'), { force: true });
      }
      await writeFile(join(run, 'renderer-diagnostic.json'), JSON.stringify(diagnostic));
    }
    failure = renderer
      ? 'RENDERER_CONTROL_OR_EXPORT_FAILURE'
      : helper
        ? 'HELPER_CONTRACT_FAILURE'
        : composition
          ? 'COMPOSITION_CONTROL_FAILURE'
          : transport
            ? 'W3_EXPORT_OR_CONTROL_FAILURE'
            : error.message;
    // Failure evidence is copied before owned namespace destruction, never raw host logs.
    if (created && !transport && !helper && !renderer)
      for (const file of [
        'result.json',
        'progress.jsonl',
        'transcript.ansi',
        'fixture.jsonl',
        'isolation.json',
        'staging.json',
        'plugin-diagnostics.log',
        'plugin-inventory.json',
        'server-inventory.json',
      ]) {
        try {
          await command(
            ['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)],
            3000,
            true,
          );
        } catch {
          /* absent means UNRUN */
        }
      }
    if (created && composition) {
      try {
        await retainDiagnostic(true);
      } catch {
        /* no raw capture fallback */
      }
      try {
        // Also on failure, detailed evidence requires the complete raw scan.
        await command(
          ['cp', `${name}:/run/proceed/evidence/scan-pass.json`, join(run, 'scan-pass.json')],
          3000,
          true,
        );
        assertCompositionExport(JSON.parse(await readFile(join(run, 'scan-pass.json'), 'utf8')));
        for (const file of [
          'composition-observations.json',
          'transcript.ansi',
          'plugin-diagnostics.log',
          'progress.jsonl',
        ])
          await command(
            ['cp', `${name}:/run/proceed/evidence/${file}`, evidenceDestination(file)],
            3000,
            true,
          );
      } catch {
        /* Missing/failed scan refuses every detailed capture. No raw fallback. */
      }
    } else if (created && transport) {
      // No result/error strings or detailed capture may bypass the full scan.
      // Only the separately scanned allowlisted diagnostic can leave on failure.
      for (const file of ['diagnostic-export.json']) {
        try {
          await command(
            ['cp', `${name}:/run/proceed/evidence/${file}`, join(run, file)],
            3000,
            true,
          );
          assertTransportDiagnostic(JSON.parse(await readFile(join(run, file), 'utf8')));
        } catch {
          /* no detailed capture export on failure */
        }
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
        cleanup =
          transport || helper || renderer
            ? 'FAIL - exact owned container cleanup'
            : `FAIL - ${error.message}`;
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
          containerExit: progressState?.containerExit ?? 'UNRUN',
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
