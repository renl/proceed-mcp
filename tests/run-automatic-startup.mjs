// TEST ONLY. One maintained, bounded Docker lifecycle for the safety checkpoint.
// No image pull/build, host runtime bootstrap, user-state or whole-worktree mount.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, copyFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const image = 'sha256:3d1ccf6e73ee91da722f2d84469c2b451af45451921856f869d12569ddb2ce1e';
const deadline = performance.now() + 600000;
const root = resolve('.scratch/automatic-startup-checkpoint');
const ignored = spawnSync(
  'git',
  ['check-ignore', '--quiet', '.scratch/automatic-startup-checkpoint/run'],
  { timeout: 5000 },
);
assert.equal(ignored.status, 0, 'run backing path must be ignored before creation');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'run-'));
const payload = join(directory, 'candidate');
const evidence = join(directory, 'evidence');
await mkdir(evidence);
const name = `proceed-startup-${randomUUID()}`;
const progress = (phase) =>
  writeFile(join(directory, 'progress.json'), JSON.stringify({ phase, container: name, image }));
let inner = 'NOT RUN',
  cleanup = false,
  command;
const watchdog = setTimeout(
  () => {
    command?.kill();
    const removal = spawn('docker', ['rm', '--force', name], { shell: false, stdio: 'ignore' });
    const finish = () => {
      writeFile(
        join(directory, 'watchdog.json'),
        JSON.stringify({ inner: 'FAIL', containerCleanup: 'UNVERIFIED' }),
      ).finally(() => process.exit(1));
    };
    removal.once('error', finish);
    removal.once('close', finish);
    setTimeout(() => {
      removal.kill();
      finish();
    }, 5000);
  },
  Math.max(1, deadline - performance.now() - 5000),
);

function docker(args, timeout) {
  return new Promise((done, reject) => {
    const child = spawn('docker', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('bounded Docker operation'));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 131072) stdout += chunk;
      else {
        child.kill();
        reject(Error('Docker output limit'));
      }
    });
    // Do not publish raw daemon/application error output.
    child.stderr.on('data', (chunk) => {
      size += chunk.length;
      if (size > 131072) child.kill();
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(Error('Docker invocation failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout });
    });
    command = child;
  });
}

try {
  await progress('setup');
  // Tracked production JavaScript only. No .env, settings, credential or recovery mounts.
  const tracked = spawnSync('git', ['ls-files', '--', 'bin', 'src'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
  });
  assert.equal(tracked.status, 0);
  const files = [
    'package.json',
    'package-lock.json',
    'server.json',
    'README.md',
    'LICENSE',
    ...tracked.stdout
      .trim()
      .split(/\r?\n/)
      .filter((path) => path.endsWith('.js')),
    'tests/automatic-startup-checkpoint.mjs',
    'tests/automatic-startup-cli.test.mjs',
    'tests/support/automatic-startup.mjs',
    'tests/fixtures/automatic-startup-preload.mjs',
    'tests/fixtures/automatic-startup-certificate.mjs',
    'tests/automatic-startup-regressions.mjs',
    'tests/harness-checkpoint.test.mjs',
    'tests/automatic-startup-remaining.mjs',
    'tests/automatic-startup-admission.mjs',
    'tests/automatic-startup-package.mjs',
    'tests/release-pack.mjs',
    'tests/release-metadata.test.mjs',
    'tests/release-installed.test.mjs',
    'tests/support/release-artifact.mjs',
    'tests/fixtures/release-observer.mjs',
    'tests/portable-runtime-scheduling.test.mjs',
    'tests/portable-activation.test.mjs',
    'tests/fixtures/runtime-scheduling-preload.mjs',
    'tests/fixtures/portable-telegram-preload.mjs',
    'tests/fixtures/portable-clock-preload.mjs',
    'tests/fixtures/portable-faults-preload.mjs',
    // Existing Telegram fixture's static dependency closure. No live suites are run.
    'tests/support/portable-waiting.mjs',
    'tests/support/managed-spike.mjs',
    'tests/support/startup-guards.mjs',
    'tests/support/spike-rpc.mjs',
    'tests/support/catalog-consumer.mjs',
  ];
  for (const file of files) {
    assert.equal((await lstat(file)).isFile(), true, 'allowlisted payload is an ordinary file');
    const destination = join(payload, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file, destination);
  }
  await writeFile(join(directory, 'input-paths.json'), JSON.stringify(files));
  const mode = process.argv[2] ?? 'checkpoint';
  if (mode === 'remaining' && process.argv[3]) assert.match(process.argv[3], /^[A-Z0-9,-]+$/);
  assert.ok(
    [
      'checkpoint',
      'platform',
      'dispatcher',
      'regressions',
      'file-safety',
      'deadline',
      'remaining',
      'package',
      'health',
      'identity',
      'drain',
      'package-fixture',
      'admission',
      'harness',
      'scheduling',
    ].includes(mode),
    'explicit bounded checkpoint selection',
  );
  const args =
    mode === 'admission'
      ? ['tests/automatic-startup-admission.mjs']
      : mode === 'package' || mode === 'package-fixture'
        ? [
            'tests/automatic-startup-package.mjs',
            ...(mode === 'package-fixture' ? ['--fixture-only'] : []),
          ]
        : ['regressions', 'health', 'identity', 'drain', 'harness', 'scheduling'].includes(mode)
          ? [
              'tests/automatic-startup-regressions.mjs',
              ...(mode === 'health' ? ['--health-only'] : []),
              ...(['identity', 'drain', 'harness', 'scheduling'].includes(mode)
                ? [`--only=${mode}`]
                : []),
            ]
          : mode === 'dispatcher'
            ? ['--test', '--test-reporter=tap', '/workspace/tests/automatic-startup-cli.test.mjs']
            : [
                'tests/automatic-startup-checkpoint.mjs',
                ...(mode === 'platform' ? ['--tls-platform-only'] : []),
                ...(mode === 'file-safety' ? ['--file-safety-only'] : []),
                ...(mode === 'deadline' ? ['--deadline-only'] : []),
                ...(mode === 'deadline' && process.argv[3]
                  ? [`--deadline-stage=${process.argv[3]}`]
                  : []),
                ...(mode === 'remaining' ? ['--remaining-only'] : []),
                ...(mode === 'remaining' && process.argv[3]
                  ? [`--remaining-cases=${process.argv[3]}`]
                  : []),
              ];
  await progress(`run-${mode}`);
  const result = await docker(
    [
      'run',
      '--pull=never',
      '--rm',
      '--init',
      '--name',
      name,
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      ...(mode === 'remaining' ? ['--cap-add=CHOWN'] : []),
      '--security-opt=no-new-privileges',
      '--memory=512m',
      '--cpus=2',
      '--pids-limit=256',
      '--tmpfs',
      mode === 'package' || mode === 'package-fixture'
        ? '/fixtures:rw,exec,mode=0700'
        : '/fixtures:rw,mode=0700',
      '--tmpfs',
      '/tmp:rw,mode=0700',
      '--mount',
      `type=bind,source=${payload},target=/workspace,readonly`,
      '--mount',
      `type=bind,source=${evidence},target=/evidence`,
      '--workdir',
      mode === 'dispatcher' ? '/fixtures' : '/workspace',
      '--env',
      'PROCEED_TEST_FIXTURES=/fixtures',
      '--env',
      'PROCEED_TEST_ISOLATED_PID_NAMESPACE=1',
      '--env',
      'HOME=/fixtures',
      '--env',
      'TMPDIR=/fixtures',
      '--env',
      'TEMP=/fixtures',
      '--env',
      'TMP=/fixtures',
      image,
      'node',
      ...args,
    ],
    Math.max(1, deadline - performance.now() - 45000),
  );
  inner = result.code === 0 ? 'PASS' : 'FAIL';
  if (mode !== 'dispatcher') {
    const summary = JSON.parse(result.stdout.trim());
    assert.ok(['PASS', 'FAIL'].includes(summary.assertions));
    assert.ok(['PASS', 'UNVERIFIED'].includes(summary.cleanup));
    // Export only allowlisted classifications. Never export fixtures or raw output.
    const sanitized = {
      assertions: summary.assertions,
      cleanup: summary.cleanup,
      provisioningExitCodes: (summary.provisioningExitCodes ?? []).filter(Number.isInteger),
      results: summary.results.map((item) => ({
        id: String(item.id).replace(/[^A-Z0-9-]/g, ''),
        status: item.status === 'PASS' ? 'PASS' : 'FAIL',
      })),
    };
    await writeFile(join(directory, 'assertions.json'), JSON.stringify(sanitized));
    console.log(JSON.stringify(sanitized));
  } else {
    // TAP diagnostics may contain synthetic values. Keep only numeric result counts.
    const counts = Object.fromEntries(
      ['tests', 'pass', 'fail', 'cancelled', 'skipped'].map((key) => [
        key,
        Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(result.stdout)?.[1] ?? -1),
      ]),
    );
    assert.ok(counts.tests > 0, 'dispatcher result must contain actual TAP counts');
    await writeFile(join(directory, 'dispatcher-counts.json'), JSON.stringify(counts));
    console.log(JSON.stringify(counts));
  }
} catch {
  inner = 'FAIL';
} finally {
  await progress('teardown');
  command?.kill();
  try {
    // Exact unique runner-owned container only, including a timed-out detached child namespace.
    await docker(
      ['rm', '--force', name],
      Math.min(15000, Math.max(1, deadline - performance.now() - 5000)),
    );
    const check = await docker(
      ['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'],
      Math.min(10000, Math.max(1, deadline - performance.now())),
    );
    cleanup = check.code === 0 && check.stdout.trim() === '';
  } catch {
    cleanup = false;
  }
  const summary = { inner, containerCleanup: cleanup ? 'PASS' : 'UNVERIFIED', image };
  await writeFile(join(directory, 'result.json'), JSON.stringify(summary));
  await progress('complete');
  clearTimeout(watchdog);
  console.log(JSON.stringify(summary));
  console.log(JSON.stringify({ evidence: directory }));
  process.exitCode = inner === 'PASS' && cleanup ? 0 : 1;
}
