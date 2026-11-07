// TEST ONLY. No inherited environment or downloaded SDK is staged into the host.
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { join } from 'node:path';
import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';

export async function stageLinuxFixture(env, evidence, fixture) {
  // Assert clean roots BEFORE adding the one intentional explicit plugin/config.
  for (const key of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR'])
    assert.deepEqual(await readdir(env[key]), [], `initial ${key} must be empty`);
  const plugin = join(env.OPENCODE_CONFIG_DIR, 'plugins/proceed-qualification');
  await mkdir(plugin, { recursive: true });
  await copyFile(fixture, join(plugin, 'tui.ts'));
  const config = join(env.OPENCODE_CONFIG_DIR, 'cli.json');
  await writeFile(
    config,
    JSON.stringify({ plugins: [{ package: plugin, options: { evidence_directory: evidence } }] }),
  );
  return { config, plugin, entry: join(plugin, 'tui.ts'), initialEffectiveConfigEmpty: true };
}

export const linuxImage = 'sha256:a8302764b5f4896690dcba9cdbe27755f6c0f4f88db92974a029f8499f3700cb';
export const linuxPayload = Object.freeze([
  'tests/fixtures/harness-platform/tui.ts',
  'tests/support/harness-linux-inner.mjs',
  'tests/support/harness-linux-plan.mjs',
  'tests/support/harness-host-plan.mjs',
  'tests/support/harness-plugin-inventory.mjs',
]);

export function isolatedLinuxEnvironment(root) {
  assert.ok(posix.isAbsolute(root) && root.startsWith('/run/proceed/'));
  const at = (name) => posix.join(root, name);
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    HOME: at('home'),
    USERPROFILE: at('home'),
    OPENCODE_TEST_HOME: at('home'),
    XDG_DATA_HOME: at('data'),
    XDG_CACHE_HOME: at('cache'),
    XDG_CONFIG_HOME: at('config'),
    XDG_STATE_HOME: at('state'),
    OPENCODE_CONFIG_DIR: at('service-config'),
    TMPDIR: at('tmp'),
    TMP: at('tmp'),
    TEMP: at('tmp'),
    OPENCODE_CONFIG_PROJECT_DISABLE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_LOG_LEVEL: 'DEBUG',
  };
}

export function linuxScriptArguments(transcript) {
  assert.ok(transcript.startsWith('/run/proceed/') && !/[\r\n\0']/.test(transcript));
  return [
    '--command',
    'stty rows 40 cols 120; exec /usr/local/bin/opencode --standalone',
    '--return',
    '--quiet',
    '--flush',
    '--echo',
    'never',
    '--log-out',
    transcript,
    '--output-limit',
    '1048576',
  ];
}

export function assertContainerPolicy(info, source) {
  assert.equal(info.Image, linuxImage);
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.equal(info.HostConfig.PidMode, '');
  assert.equal(info.HostConfig.Init, true);
  assert.equal(info.HostConfig.Privileged, false);
  assert.deepEqual(info.HostConfig.CapAdd ?? [], []);
  assert.equal(info.Mounts.length, 1);
  const mount = info.Mounts[0];
  assert.equal(mount.Destination, '/payload');
  assert.equal(mount.RW, false);
  // Docker Desktop translates the Windows bind source. Match the complete suffix.
  const normalized = (s) => s.replaceAll('\\', '/').toLowerCase();
  assert.ok(normalized(mount.Source).endsWith(normalized(source).replace(/^[a-z]:/, '')));
}
