// Native setup controls only. Container broker execution has a separate command.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { qualificationPayload, stageQualification } from './support/harness-linux-plan.mjs';
import {
  assertPluginInventory,
  assertServiceInventory,
  builtinOrigins,
} from './support/harness-plugin-inventory.mjs';
import { confirmQualificationEnrollment } from './support/harness-qualification-setup.mjs';

const files = qualificationPayload(
  execFileSync('git', ['ls-files', '--', 'src', 'bin'], { encoding: 'utf8', timeout: 5000 })
    .trim()
    .split(/\r?\n/),
);

test('W1 stages exact product manifest/full source closure, transport and server wrapper only', async () => {
  const scratch = resolve('.scratch/harness-host');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'setup-control-'));
  try {
    const env = Object.fromEntries(
      ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR'].map((key) => [
        key,
        join(root, key),
      ]),
    );
    for (const path of Object.values(env)) await mkdir(path);
    const options = {
      state_dir: '/run/proceed/broker',
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: '/run/proceed/qualification-private/operator.token',
    };
    const staging = await stageQualification(
      env,
      '/run/proceed/evidence',
      resolve('.'),
      join(root, 'stage'),
      options,
      files,
    );
    for (const path of files.filter((p) => p === 'package.json' || p.startsWith('src/'))) {
      const staged = await readFile(join(staging.product, path));
      assert.deepEqual(staged, await readFile(path));
      if (!path.endsWith('.js')) continue;
      for (const match of staged.toString().matchAll(/(?:from\s+|import\s*\()(['"])(\.[^'"]+)\1/g))
        await readFile(resolve(staging.product, dirname(path), match[2]));
    }
    const config = JSON.parse(await readFile(staging.config, 'utf8'));
    assert.deepEqual(config.plugins[0], { package: staging.product, options });
    assert.equal(config.plugins[1].package, staging.adversary);
    assert.equal(config.plugins[2].package, staging.transport);
    assert.deepEqual(await readdir(staging.wrapper), ['package.json', 'server.mjs']);
    assert.deepEqual(await readdir(env.XDG_CONFIG_HOME), []);
    assert.match(staging.inventory, /UNPROVEN/);
    assert.ok(
      files.every(
        (p) => !/README|node_modules|credential|\.scratch/.test(p) || p.startsWith('src/'),
      ),
    );
    await assert.rejects(
      stageQualification(env, '', '.', '', options, files),
      /initial OPENCODE_CONFIG_DIR/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test('W1 multi-origin observations reject missing, foreign, substituted and truncated inventories', () => {
  const entries = [
    { plugin: '/product', entry: '/product/src/harness/tui-entry.js' },
    { plugin: '/transport', entry: '/transport/tui.ts' },
  ];
  const observed = entries.map(
    (e) =>
      `component=plugin role=cli message="plugin operation started" stage=read target=${e.plugin} entrypoint=${e.entry}`,
  );
  const completed = `component=plugin role=cli message="plugin reconciliation completed" plugins=${builtinOrigins.length + entries.length}`;
  assert.equal(
    assertPluginInventory([...observed, completed], { entries, complete: true }).externalOrigins
      .length,
    2,
  );
  for (const lines of [
    [completed],
    [observed[0], completed],
    [...observed, observed[0].replace('/product ', '/foreign '), completed],
  ])
    assert.throws(() => assertPluginInventory(lines, { entries, complete: true }));
  assert.throws(() =>
    assertPluginInventory([...observed, completed], { entries, complete: false }),
  );
  const expected = [
    { plugin: '/wrapper', features: { server: true } },
    { plugin: '/transport', features: { tui: true } },
  ];
  const items = expected.map((e) => ({
    id: e.plugin,
    source: { type: 'local', path: e.plugin },
    features: e.features,
    state: { status: 'active' },
  }));
  assertServiceInventory(items, { entries: expected });
  for (const list of [
    [],
    items.slice(1),
    [...items, items[0]],
    [{ ...items[0], features: { server: true, rpc: true } }, items[1]],
  ])
    assert.throws(() => assertServiceInventory(list, { entries: expected }));
});

test('W2 fingerprint guards have no callback side effect before independent matching observations', async () => {
  let effects = 0;
  const h = { fixture: { text: () => effects++ } };
  const operator = { keyId: 'a'.repeat(64) };
  const proposal = { key_id: operator.keyId, harness_id: 'qualification', owner_id: 'shared' };
  for (const [p, displayed] of [
    [proposal, { local: 'b'.repeat(64), broker: operator.keyId }],
    [proposal, { local: operator.keyId, broker: 'b'.repeat(64) }],
    [
      { ...proposal, key_id: 'b'.repeat(64) },
      { local: operator.keyId, broker: 'b'.repeat(64) },
    ],
    [
      { ...proposal, owner_id: 'foreign' },
      { local: operator.keyId, broker: operator.keyId },
    ],
  ])
    await assert.rejects(confirmQualificationEnrollment(h, operator, p, displayed));
  assert.equal(effects, 0);
});
