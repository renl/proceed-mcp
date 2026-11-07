// TEST ONLY. Native preparation proof, never actual-host or human-authority evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 } from 'node:path';
import {
  pins,
  isolatedWindowsEnvironment,
  scriptArguments,
  dialogObserved,
  interactionPlan,
} from './support/harness-host-plan.mjs';

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
