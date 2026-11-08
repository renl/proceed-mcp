// TEST ONLY. No inherited environment or downloaded SDK is staged into the host.
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { join } from 'node:path';
import { mkdir, readdir, copyFile, writeFile, readFile, lstat } from 'node:fs/promises';

export const qualificationSupport = Object.freeze([
  'tests/support/harness-composition-inner.mjs',
  'tests/support/harness-composition-readiness.mjs',
  'tests/support/harness-navigation-observation.mjs',
  'tests/support/harness-renderer-observation.mjs',
  'tests/support/harness-composition-retention.mjs',
  'tests/fixtures/harness-composition/tui.ts',
  'tests/fixtures/harness-composition/broker-observer.mjs',
  'tests/support/harness-parent-inner.mjs',
  'tests/support/harness-parent-observations.mjs',
  'tests/fixtures/harness-parent/child.mjs',
  'tests/support/harness-helper-inner.mjs',
  'tests/support/harness-helper-vectors.mjs',
  'tests/fixtures/harness-adversary/tui.ts',
  'tests/fixtures/harness-transport/tui.ts',
  'tests/fixtures/harness-wrapper/server.mjs',
  'tests/support/harness-runtime-transport.mjs',
  'tests/support/harness-transport-fixtures.mjs',
  'tests/support/harness-transport-inner.mjs',
  'tests/support/harness-wrapper-invocation.mjs',
  'tests/support/harness-transparent-capture.mjs',
  'tests/support/harness-qualification-setup.mjs',
  'tests/support/harness-setup-inner.mjs',
  'tests/support/portable-waiting.mjs',
  'tests/support/managed-spike.mjs',
  'tests/support/startup-guards.mjs',
  'tests/support/spike-rpc.mjs',
  'tests/support/catalog-consumer.mjs',
  'tests/support/automatic-startup.mjs',
  'tests/fixtures/portable-telegram-preload.mjs',
  'tests/fixtures/portable-clock-preload.mjs',
  'tests/fixtures/portable-faults-preload.mjs',
]);

// Input is git's tracked file list, not a recursive copy of private worktree data.
export function qualificationPayload(tracked) {
  const sources = tracked.filter((p) => /^(src|bin)\/[a-zA-Z0-9_/-]+\.js$/.test(p));
  assert.ok(sources.includes('src/harness/tui-entry.js') && sources.includes('bin/proceed-mcp.js'));
  return [
    ...new Set(['package.json', ...sources, ...linuxPayload, ...qualificationSupport]),
  ].sort();
}

export async function stageQualification(env, evidence, payload, destination, options, files) {
  for (const key of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR'])
    assert.deepEqual(await readdir(env[key]), [], `initial ${key} must be empty`);
  assert.deepEqual(Object.keys(options).sort(), [
    'harness_id',
    'operator_key_file',
    'owner_id',
    'state_dir',
  ]);
  const product = join(destination, 'product');
  // Preserve the exact manifest and complete tracked source tree, including
  // package-relative imports. Never copy node_modules or a whole worktree.
  for (const path of files.filter((p) => p === 'package.json' || p.startsWith('src/'))) {
    assert.ok(!path.split('/').includes('..'));
    assert.ok((await lstat(join(payload, path))).isFile());
    const target = join(product, path);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(payload, path), target);
  }
  const manifest = JSON.parse(await readFile(join(product, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./tui'], './src/harness/tui-entry.js');
  const directory = join(env.OPENCODE_CONFIG_DIR, 'plugins');
  const transport = join(directory, 'proceed-transport');
  const adversary = join(directory, 'proceed-adversary');
  const wrapper = join(directory, 'proceed-wrapper');
  for (const [dir, source, target, exports] of [
    [adversary, 'tests/fixtures/harness-adversary/tui.ts', 'tui.ts', { './tui': './tui.ts' }],
    [transport, 'tests/fixtures/harness-transport/tui.ts', 'tui.ts', { './tui': './tui.ts' }],
    [
      wrapper,
      'tests/fixtures/harness-wrapper/server.mjs',
      'server.mjs',
      { './server': './server.mjs' },
    ],
  ]) {
    await mkdir(dir, { recursive: true });
    await copyFile(join(payload, source), join(dir, target));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: dir.split(/[\\/]/).at(-1), type: 'module', exports }),
    );
  }
  const config = join(env.OPENCODE_CONFIG_DIR, 'cli.json');
  await writeFile(
    config,
    JSON.stringify({
      plugins: [
        { package: product, options },
        { package: adversary, options: { evidence_directory: evidence } },
        {
          package: transport,
          options: {
            cases_file: '/run/proceed/qualification-private/cases.json',
            evidence_directory: evidence,
          },
        },
      ],
    }),
  );
  return {
    config,
    product,
    transport,
    adversary,
    wrapper,
    options,
    clientEntries: [
      { plugin: product, entry: join(product, 'src/harness/tui-entry.js') },
      { plugin: adversary, entry: join(adversary, 'tui.ts') },
      { plugin: transport, entry: join(transport, 'tui.ts') },
    ],
    serviceEntries: [
      { plugin: adversary, features: { tui: true, server: false, rpc: false } },
      { plugin: transport, features: { tui: true, server: false, rpc: false } },
      { plugin: wrapper, features: { tui: false, server: true, rpc: false } },
    ],
    inventory: 'UNPROVEN - staging is not actual loader enumeration',
  };
}

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
