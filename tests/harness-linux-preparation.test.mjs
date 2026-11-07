// TEST ONLY. Native containment-plan checks, not a real TUI qualification.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  linuxImage,
  linuxPayload,
  isolatedLinuxEnvironment,
  linuxScriptArguments,
  assertContainerPolicy,
  stageLinuxFixture,
} from './support/harness-linux-plan.mjs';

test('LINUX-PREP stages into distinct effective config root, refuses dirty initial roots', async () => {
  const scratch = new URL('../.scratch/harness-host/', import.meta.url);
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(new URL('prep-config-', scratch));
  try {
    const env = Object.fromEntries(
      ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR'].map((key) => [
        key,
        join(root, key),
      ]),
    );
    for (const directory of Object.values(env)) await mkdir(directory);
    const fixture = new URL('fixtures/harness-platform/tui.ts', import.meta.url);
    const staged = await stageLinuxFixture(env, root, fixture);
    const config = JSON.parse(await readFile(staged.config, 'utf8'));
    assert.equal(staged.config, join(env.OPENCODE_CONFIG_DIR, 'cli.json'));
    assert.equal(config.plugins[0].package, staged.plugin);
    assert.equal(config.plugins[0].options.evidence_directory, root);
    assert.equal(await readFile(staged.entry, 'utf8'), await readFile(fixture, 'utf8'));
    assert.deepEqual(await readdir(env.XDG_CONFIG_HOME), []);
    assert.equal(staged.initialEffectiveConfigEmpty, true);
    await assert.rejects(
      stageLinuxFixture(env, root, fixture),
      /initial OPENCODE_CONFIG_DIR must be empty/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

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
