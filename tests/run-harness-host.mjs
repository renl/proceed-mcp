// TEST ONLY. Maintained NO-LAUNCH prerequisite command. Live lifecycle is not yet qualified.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pins } from './support/harness-host-plan.mjs';

assert.deepEqual(
  process.argv.slice(2),
  ['--preflight'],
  'Only --preflight is implemented. No host launch.',
);
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const checks = [];
for (const name of ['plugin', 'client']) {
  const dependency = `@opencode/${name}`;
  let installed = null;
  try {
    installed = JSON.parse(
      await readFile(new URL(`node_modules/${dependency}/package.json`, root), 'utf8'),
    ).version;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  checks.push({
    check: dependency,
    required: pins[name],
    declared: manifest.devDependencies?.[dependency] ?? null,
    installed,
    status:
      manifest.devDependencies?.[dependency] === pins[name] && installed === pins[name]
        ? 'PASS'
        : 'BLOCKED',
  });
}
console.log(
  JSON.stringify(
    {
      phase: 'prerequisites',
      mode: 'NO-LAUNCH',
      fixture: fileURLToPath(new URL('tests/fixtures/harness-platform/tui.ts', root)),
      checks,
      runtime: 'UNRUN',
      cleanup: 'NOT APPLICABLE - no resources started',
      remaining: [
        'Actual SDK export/type compatibility',
        'Run-root staging and isolated Windows config validation',
        'Observed empty SQLiteCredentialTable and no legacy import/config/user-plugin loading',
        'Enforced/observed no external network',
        'MSYS PTY native-console compatibility',
        'Owned descendant tracking/termination and absence verification',
        'Aggregate lifecycle with persisted progress and reachable inner deadlines',
      ],
    },
    null,
    2,
  ),
);
// Exit 2 remains BLOCKED even with installed SDKs: a plan is not a managed live runner.
process.exitCode = 2;
