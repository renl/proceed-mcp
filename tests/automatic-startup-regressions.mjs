// TEST ONLY. Bounded migrated regression batch inside the maintained isolated runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { symlink, readdir, writeFile } from 'node:fs/promises';

assert.equal(process.env.PROCEED_TEST_FIXTURES, '/fixtures');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
assert.equal(process.versions.node, '24.22.2');
const baseline = new Set((await readdir('/proc')).filter((name) => /^\d+$/.test(name)));
for (const name of ['bin', 'src', 'tests'])
  await symlink(`/workspace/${name}`, `/fixtures/${name}`);
process.chdir('/fixtures');
const results = [];
let cleanup = false,
  current = 'setup';
const timer = setTimeout(() => process.exit(1), 540000);
try {
  const suites = [
    ['AUTO-REGRESSION-SCHEDULING', 'portable-runtime-scheduling.test.mjs'],
    ['AUTO-REGRESSION-ACTIVATION', 'portable-activation.test.mjs'],
  ];
  const selection = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
  const pattern = process.argv.includes('--health-only')
    ? 'SCHED-RUNTIME-FAULT'
    : selection === 'identity'
      ? 'SCHED-MCP-IDENTITY'
      : selection === 'drain'
        ? 'SCHED-RUNTIME-DRAIN'
        : undefined;
  const selectedSuites =
    selection === 'harness'
      ? [['HARNESS-CHECKPOINT', 'harness-checkpoint.test.mjs']]
      : pattern
        ? suites.slice(0, 1)
        : suites;
  for (const [id, file] of selectedSuites) {
    current = id;
    await writeFile('/evidence/phase.json', JSON.stringify({ phase: id }));
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-reporter=tap',
        ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
        `/workspace/tests/${file}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '',
      bytes = 0;
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= 262144) output += chunk;
        else child.kill();
      });
    const deadline = setTimeout(() => child.kill(), 240000);
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    clearTimeout(deadline);
    const counts = Object.fromEntries(
      ['tests', 'pass', 'fail', 'cancelled', 'skipped'].map((key) => [
        key,
        Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output)?.[1] ?? -1),
      ]),
    );
    // Only fixed IDs and counts leave the namespace, never TAP assertion values.
    const failure =
      selection === 'harness' &&
      code !== 0 &&
      counts.tests === 3 &&
      counts.fail === 3 &&
      output.includes('public CLI harness must succeed') &&
      output.includes('new synthetic operator proposal must be admitted')
        ? 'HARNESS-PUBLIC-BEHAVIOR-NOT-IMPLEMENTED'
        : selection === 'identity' &&
            code !== 0 &&
            output.includes(
              'served MCP identity must equal the candidate manifest, not the published predecessor',
            ) &&
            output.includes('0.1.0-preview.1') &&
            output.includes('0.1.0-preview.2')
          ? 'SERVED-VERSION-MISMATCH'
          : code === 0
            ? null
            : 'UNCLASSIFIED';
    const checkpoint =
      selection === 'harness'
        ? {
            keygenReached: output.includes('public CLI harness must succeed'),
            enrollmentReached: output.includes('new synthetic operator proposal must be admitted'),
            laterAssertions: code === 0 ? 'PASS' : 'UNPROVEN',
          }
        : undefined;
    await writeFile(`/evidence/${id}.json`, JSON.stringify({ counts, code, failure, checkpoint }));
    assert.ok(counts.tests > 0 && bytes <= 262144);
    assert.equal(code, 0, id);
    assert.equal(counts.fail, 0);
    results.push({ id, status: 'PASS' });
  }
} catch {
  results.push({ id: current, status: 'FAIL' });
} finally {
  const residual = (await readdir('/proc')).filter(
    (name) => /^\d+$/.test(name) && !baseline.has(name),
  );
  cleanup = residual.length === 0;
  clearTimeout(timer);
  const assertions =
    results.length ===
      (process.argv.includes('--health-only') ||
      process.argv.includes('--only=identity') ||
      process.argv.includes('--only=drain') ||
      process.argv.includes('--only=harness')
        ? 1
        : 2) && results.every((item) => item.status === 'PASS');
  console.log(
    JSON.stringify({
      assertions: assertions ? 'PASS' : 'FAIL',
      cleanup: cleanup ? 'PASS' : 'UNVERIFIED',
      results,
    }),
  );
  process.exitCode = assertions && cleanup ? 0 : 1;
}
