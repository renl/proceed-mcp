// TEST ONLY. Native preparation proof, never actual-host or human-authority evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  pins,
  isolatedWindowsEnvironment,
  scriptArguments,
  dialogObserved,
  interactionPlan,
  hostBudgets,
  launchBlockers,
} from './support/harness-host-plan.mjs';

test('HOST-PREP launch remains blocked before resources exist', () => {
  assert.deepEqual(
    launchBlockers.map((gate) => gate.check),
    ['owned-process-containment', 'external-egress-isolation'],
  );
  assert.ok(launchBlockers.every((gate) => gate.status === 'BLOCKED' && gate.reason));
  const result = spawnSync(process.execPath, ['tests/run-harness-host.mjs', '--preflight'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'NO-LAUNCH');
  assert.equal(report.runtime, 'UNRUN');
  assert.equal(report.cleanup, 'NOT APPLICABLE - no resources started');
  assert.deepEqual(report.launchBlockers, launchBlockers);
  assert.ok(report.checks.every((check) => check.status === 'PASS'));
  // Unknown/live modes must fail before staging too, never silently fall back.
  const live = spawnSync(process.execPath, ['tests/run-harness-host.mjs', '--run'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(live.error);
  assert.notEqual(live.status, 0);
  assert.match(live.stderr, /Only --preflight is implemented/);
});

test('HOST-PREP proposed deadlines leave teardown reachable, not runtime proof', () => {
  const { aggregate, teardownReserve, readiness, interaction, outer } = hostBudgets;
  assert.equal(aggregate, 300000);
  assert.equal(teardownReserve, 45000);
  assert.equal(readiness, 60000);
  assert.equal(interaction, 15000);
  assert.equal(outer, 310000);
  assert.ok(readiness + interactionPlan.length * interaction < aggregate - teardownReserve);
  assert.ok(aggregate < outer);
});

test('HOST-PREP isolation redirects import-time roots and drops inherited authority', () => {
  const root = 'C:\\project\\.scratch\\harness-host\\run-owned';
  const env = isolatedWindowsEnvironment(
    root,
    {
      SystemRoot: 'C:\\Windows',
      OPENCODE_SERVER_PASSWORD: 'forbidden-service-marker',
      OPENAI_API_KEY: 'forbidden-provider-marker',
      SSH_ASKPASS: 'forbidden-askpass-marker',
      OPENCODE_CLI_CONFIG_CONTENT: 'forbidden-config-marker',
      OPENCODE_CONFIG_CONTENT: 'forbidden-config-marker',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'forbidden-telemetry-marker',
      NODE_OPTIONS: 'forbidden-preload-marker',
      BUN_OPTIONS: 'forbidden-preload-marker',
      PATH: 'forbidden-path-marker',
    },
    'C:\\approved-tools',
  );
  assert.ok(!JSON.stringify(env).includes('forbidden-'));
  for (const key of [
    'HOME',
    'USERPROFILE',
    'OPENCODE_TEST_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_STATE_HOME',
    'OPENCODE_CONFIG_DIR',
    'ProgramData',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]) {
    assert.ok(!win32.relative(root, env[key]).startsWith('..'), key);
    assert.notEqual(env[key], root, key);
  }
  assert.equal(env.HOME, env.OPENCODE_TEST_HOME);
  assert.equal(env.USERPROFILE, env.OPENCODE_TEST_HOME);
  assert.notEqual(env.XDG_CONFIG_HOME, env.OPENCODE_CONFIG_DIR);
  for (const key of [
    'OPENCODE_CONFIG_PROJECT_DISABLE',
    'OPENCODE_DISABLE_MODELS_FETCH',
    'OPENCODE_DISABLE_AUTOUPDATE',
  ])
    assert.equal(env[key], '1');
});

test('HOST-PREP candidate MSYS arguments preserve literal executable and bounded log', () => {
  assert.equal(pins.host, '2.2.5');
  assert.equal(pins.plugin, pins.host);
  assert.equal(pins.client, pins.host);
  assert.equal(pins.script, '2.40.2');
  const args = scriptArguments({
    host: "C:\\owned tools\\it's opencode.exe",
    transcript: 'C:\\run\\pty.log',
  });
  assert.equal(args[1], "'C:/owned tools/it'\\''s opencode.exe' --standalone");
  assert.deepEqual(args.slice(2), [
    '--return',
    '--quiet',
    '--flush',
    '--echo',
    'never',
    '--log-out',
    'C:\\run\\pty.log',
    '--output-limit',
    '1048576',
  ]);
  assert.throws(() => scriptArguments({ host: 'C:\\bad\n.exe', transcript: 'C:\\run\\pty.log' }));
  assert.throws(() => scriptArguments({ host: 'opencode', transcript: 'C:\\run\\pty.log' }));
});

test('HOST-PREP dialog request alone or unrelated rendered output is not readiness', () => {
  const events = [{ phase: 'select-requested', id: 1 }];
  assert.equal(dialogObserved(events, '', 1), false);
  assert.equal(dialogObserved([], 'Proceed qualification 1', 1), false);
  assert.equal(dialogObserved(events, 'Proceed qualification 2', 1), false);
  assert.equal(dialogObserved(events, 'Proceed qualification 10', 1), false);
  assert.equal(dialogObserved(events, '\x1b[32mProceed qualification 1\x1b[0m', 1), true);
  assert.equal(dialogObserved(events, 'Proceed response 1', 1, true), false);
  assert.equal(
    dialogObserved([{ phase: 'prompt-requested', id: 1 }], 'Proceed response 1', 1, true),
    true,
  );
  assert.equal(interactionPlan[0].keys, '\x1b');
  assert.equal(interactionPlan[1].outcome, 'reject');
  assert.equal(interactionPlan.at(-1).keys, 'approved\r');
});
