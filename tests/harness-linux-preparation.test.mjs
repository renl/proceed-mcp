// TEST ONLY. Native containment-plan checks, not a real TUI qualification.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  linuxImage,
  linuxPayload,
  isolatedLinuxEnvironment,
  linuxScriptArguments,
  assertContainerPolicy,
} from './support/harness-linux-plan.mjs';

test('LINUX-PREP fresh environment contains only owned roots and no inherited authority', () => {
  const env = isolatedLinuxEnvironment('/run/proceed/owned');
  assert.equal(env.PATH, '/usr/local/bin:/usr/bin:/bin');
  for (const [key, value] of Object.entries(env)) {
    if (
      !['PATH', 'TERM', 'LANG'].includes(key) &&
      !key.startsWith('OPENCODE_DISABLE_') &&
      key !== 'OPENCODE_CONFIG_PROJECT_DISABLE'
    )
      assert.ok(value.startsWith('/run/proceed/owned/'), key);
  }
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, '1');
  assert.equal(env.OPENCODE_DISABLE_MODELS_FETCH, '1');
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, '1');
  assert.notEqual(env.OPENCODE_CONFIG_DIR, env.XDG_CONFIG_HOME);
  assert.throws(() => isolatedLinuxEnvironment('/home/user'));
  assert.ok(!linuxPayload.some((path) => /node_modules|src\//.test(path)));
});

test('LINUX-PREP actual PTY command is finite-output, pinned and has no fallback', () => {
  const args = linuxScriptArguments('/run/proceed/owned/pty.log');
  assert.equal(args[1], 'stty rows 40 cols 120; exec /usr/local/bin/opencode --standalone');
  assert.deepEqual(args.slice(-2), ['--output-limit', '1048576']);
  assert.throws(() => linuxScriptArguments('/tmp/pty.log'));
  assert.throws(() => linuxScriptArguments('/run/proceed/bad\npath'));
});

test('LINUX-PREP container admission refuses each material containment mismatch', () => {
  const info = {
    Image: linuxImage,
    HostConfig: { NetworkMode: 'none', PidMode: '', Init: true, Privileged: false, CapAdd: null },
    Mounts: [
      { Source: '/run/desktop/mnt/host/c/project/payload', Destination: '/payload', RW: false },
    ],
  };
  const source = 'C:\\project\\payload';
  assert.doesNotThrow(() => assertContainerPolicy(info, source));
  const variants = [
    { ...info, Image: 'wrong' },
    { ...info, Mounts: [...info.Mounts, {}] },
    { ...info, Mounts: [{ ...info.Mounts[0], RW: true }] },
    { ...info, Mounts: [{ ...info.Mounts[0], Source: '/other/payload' }] },
    ...Object.entries({
      NetworkMode: 'default',
      PidMode: 'host',
      Init: false,
      Privileged: true,
      CapAdd: ['SYS_ADMIN'],
    }).map(([key, value]) => ({ ...info, HostConfig: { ...info.HostConfig, [key]: value } })),
  ];
  for (const variant of variants) assert.throws(() => assertContainerPolicy(variant, source));
});
