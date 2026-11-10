// TEST ONLY. Contract: active change design section 8, npm-distribution delta.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseArguments, requireOptions } from '../src/cli/args.js';

const json = async (path) =>
  JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifest = await json('package.json');
const lock = await json('package-lock.json');
const listing = await json('server.json');

// Test-only assertions shared with calibration. Corrected excerpts are NOT pack proof.
function scopedIdentity(pkg, locked, registry) {
  for (const entry of [pkg, locked, locked.packages['']]) {
    assert.equal(entry.name, '@meshimize/proceed-mcp');
    assert.equal(entry.version, '0.1.0-preview.3');
  }
  const packages = registry.packages.filter((entry) => entry.registryType === 'npm');
  assert.equal(packages.length, 1);
  assert.equal(packages[0].identifier, pkg.name);
  assert.equal(packages[0].version, pkg.version);
}

function publicPreview(pkg) {
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.tag, 'preview');
}

function portableDescription(text) {
  assert.equal(typeof text, 'string');
  assert.match(text, /Telegram/i);
  assert.match(text, /approv/i);
  assert.match(text, /\bMCP\b|Model Context Protocol/i);
  assert.doesNotMatch(
    text,
    /(?:continues?|resumes?|wakes?)\b[^.]*\bsession|for OpenCode(?: V2)? sessions/i,
  );
}

test('PREVIEW-SCOPE: real manifest, lock roots and Registry npm identity agree', () => {
  scopedIdentity(manifest, lock, listing);
});

test('PREVIEW-PUBLIC: canonical publish config selects public preview', () =>
  publicPreview(manifest));

test('PREVIEW-DESCRIPTION: both metadata descriptions explain portable approval, not host continuation', () => {
  for (const text of [manifest.description, listing.description]) portableDescription(text);
});

test('PREVIEW-CONTROLS: identity/config/meaning assertions accept corrected excerpts and reject mutations', () => {
  const pkg = {
    ...manifest,
    name: '@meshimize/proceed-mcp',
    publishConfig: { access: 'public', tag: 'preview' },
  };
  const locked = structuredClone(lock);
  locked.name = locked.packages[''].name = pkg.name;
  const registry = structuredClone(listing);
  registry.packages.find((entry) => entry.registryType === 'npm').identifier = pkg.name;
  scopedIdentity(pkg, locked, registry);
  publicPreview(pkg);
  for (const text of [
    'Portable Telegram approval broker for MCP clients.',
    'MCP server providing human approvals through Telegram.',
  ])
    portableDescription(text);
  for (const target of ['manifest', 'lock', 'root', 'registry']) {
    const [p, l, r] = structuredClone([pkg, locked, registry]);
    if (target === 'manifest') p.name = 'proceed-mcp';
    if (target === 'lock') l.name = 'proceed-mcp';
    if (target === 'root') l.packages[''].name = 'proceed-mcp';
    if (target === 'registry') r.packages[0].identifier = 'proceed-mcp';
    assert.throws(() => scopedIdentity(p, l, r), assert.AssertionError, target);
  }
  for (const publishConfig of [
    undefined,
    { access: 'restricted', tag: 'preview' },
    { access: 'public', tag: 'latest' },
  ]) {
    assert.throws(() => publicPreview({ ...pkg, publishConfig }), assert.AssertionError);
  }
  for (const target of ['manifest', 'lock', 'root', 'registry']) {
    const [p, l, r] = structuredClone([pkg, locked, registry]);
    if (target === 'manifest') p.version = '0.1.0-preview.1';
    if (target === 'lock') l.version = '0.1.0-preview.1';
    if (target === 'root') l.packages[''].version = '0.1.0-preview.1';
    if (target === 'registry') r.packages[0].version = '0.1.0-preview.1';
    assert.throws(() => scopedIdentity(p, l, r), assert.AssertionError, target);
  }
  for (const text of [
    'Telegram approval broker that continues the exact requesting OpenCode V2 session.',
    'Preview Telegram approval broker for OpenCode sessions; live first use unverified.',
    '',
    'Telegram approval MCP that resumes the exact requesting OpenCode V2 session.',
  ]) {
    assert.throws(() => portableDescription(text), assert.AssertionError);
  }
});

test('PREVIEW-META: publishable preview and lock metadata agree', () => {
  assert.equal(manifest.version, '0.1.0-preview.3');
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(manifest.engines, { node: '>=24' });
  assert.equal(manifest.bin['proceed-mcp'], 'bin/proceed-mcp.js');
  for (const entry of [lock, lock.packages['']]) {
    assert.equal(entry.name, manifest.name);
    assert.equal(entry.version, manifest.version);
  }
  assert.equal(lock.packages[''].license, manifest.license);
  assert.deepEqual(lock.packages[''].bin, manifest.bin);
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  assert.match(repository ?? '', /^(?:git\+)?https:\/\/github\.com\/renl\/proceed-mcp(?:\.git)?$/);
});

test('PREVIEW-LICENSE: standard MIT grant and owner-approved attribution', async () => {
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(license, /^Copyright \(c\) 2026 Ng Cheng Leong\r?$/m);
  assert.match(license, /The above copyright notice and this permission notice shall be included/);
  assert.match(
    license.replace(/\s+/g, ' '),
    /IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE/,
  );
  assert.doesNotMatch(license, /\[year\]|\[fullname\]|<copyright|TODO/i);
  // Owner-selected attribution is not evidence of registry publishing rights.
});

test('PREVIEW-REGISTRY: owner-approved namespace and consistent listing', async () => {
  assert.equal(
    listing.$schema,
    'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  );
  assert.equal(manifest.mcpName, 'io.github.renl/proceed-mcp');
  assert.equal(listing.name, manifest.mcpName);
  assert.equal(listing.version, manifest.version);
  const packages = listing.packages.filter((entry) => entry.registryType === 'npm');
  assert.equal(packages.length, 1);
  assert.equal(packages[0].identifier, manifest.name);
  assert.equal(packages[0].version, manifest.version);
  assert.equal(packages[0].transport.type, 'stdio');
  assert.doesNotMatch(JSON.stringify(listing), /PROCEED_TELEGRAM_BOT_TOKEN/);
});

// TEST ONLY: this fixed five-slot schema mapping is not a consuming-client renderer.
const operatorInputs = {
  'operator-owner-id': 'metadata-test-owner',
  'operator-state-dir': 'C:\\Synthetic State\\approval data',
};
const expectedArgv = [
  'mcp',
  '--owner',
  operatorInputs['operator-owner-id'],
  '--state-dir',
  operatorInputs['operator-state-dir'],
];

function registryArguments(args) {
  assert.equal(args.length, 5);
  const slots = ['mcp', '--owner', 'operator-owner-id', '--state-dir', 'operator-state-dir'];
  for (const [index, slot] of slots.entries()) {
    const arg = args[index];
    assert.equal(arg.type, 'positional');
    assert.equal(arg.isRequired, true);
    assert.equal(typeof arg.description, 'string');
    assert.ok(arg.description.trim().length > 0);
    for (const key of ['name', 'default', 'variables', 'choices', 'isRepeated']) {
      assert.equal(Object.hasOwn(arg, key), false, `${slot}: unexpected ${key}`);
    }
    if (Object.hasOwn(operatorInputs, slot)) {
      assert.equal(Object.hasOwn(arg, 'value'), false);
      assert.equal(arg.valueHint, slot);
      assert.equal(arg.placeholder, slot);
      assert.equal(arg.format, 'string');
      assert.equal(arg.isSecret, false);
    } else {
      assert.equal(arg.value, slot);
    }
  }
  const argv = args.map((arg) =>
    Object.hasOwn(arg, 'value') ? arg.value : operatorInputs[arg.valueHint],
  );
  assert.deepEqual(argv, expectedArgv);
  const parsed = parseArguments(argv, { valueOptions: ['owner', 'state-dir'] });
  requireOptions(parsed.options, ['owner', 'state-dir']);
  assert.deepEqual(parsed.positionals, ['mcp']);
  assert.deepEqual(
    [...parsed.options],
    [
      ['owner', operatorInputs['operator-owner-id']],
      ['state-dir', operatorInputs['operator-state-dir']],
    ],
  );
  assert.equal(parsed.flags.size, 0);
}

test('PREVIEW-REGISTRY-ARGV: real metadata maps to published separate-token parser', () => {
  const pkg = listing.packages.find((entry) => entry.registryType === 'npm');
  assert.equal(Object.hasOwn(listing, 'remotes'), false);
  for (const key of ['environmentVariables', 'runtimeArguments']) {
    assert.equal(Object.hasOwn(pkg, key), false);
  }
  registryArguments(pkg.packageArguments);
});

test('PREVIEW-REGISTRY-ARGV-CONTROLS: exact mapping accepts positional fixture and rejects mutations', () => {
  const fixed = (value) => ({
    type: 'positional',
    value,
    isRequired: true,
    description: `Literal ${value}`,
  });
  const input = (valueHint) => ({
    type: 'positional',
    valueHint,
    placeholder: valueHint,
    format: 'string',
    isRequired: true,
    isSecret: false,
    description: `Operator input ${valueHint}`,
  });
  const correct = [
    fixed('mcp'),
    fixed('--owner'),
    input('operator-owner-id'),
    fixed('--state-dir'),
    input('operator-state-dir'),
  ];
  registryArguments(correct);
  const mutations = [
    (args) => {
      args.splice(2, 1);
    },
    (args) => {
      [args[2], args[4]] = [args[4], args[2]];
    },
    (args) => {
      args[1].value = '--owner=metadata-test-owner';
    },
    (args) => {
      args[1].value = '--owner metadata-test-owner';
    },
    (args) => {
      args[3].type = 'named';
      args[3].name = '--state-dir';
    },
    (args) => {
      args[4].value = 'C:\\default';
    },
    (args) => {
      args[2].default = 'invented-owner';
    },
    (args) => {
      args[2].isRequired = false;
    },
    (args) => {
      args[4].isSecret = true;
    },
    (args) => {
      args[4].placeholder = '"operator-state-dir"';
    },
    (args) => {
      args[3].value = '"--state-dir"';
    },
  ];
  for (const mutate of mutations) {
    const args = structuredClone(correct);
    mutate(args);
    assert.throws(() => registryArguments(args), assert.AssertionError);
  }
  for (const argv of [
    ['mcp', '--owner=metadata-test-owner', '--state-dir', operatorInputs['operator-state-dir']],
    ['mcp', '--owner metadata-test-owner', '--state-dir', operatorInputs['operator-state-dir']],
    ['mcp', '--owner', '--state-dir', operatorInputs['operator-state-dir']],
  ])
    assert.throws(
      () => parseArguments(argv, { valueOptions: ['owner', 'state-dir'] }),
      /unknown option|requires a value/,
    );
  const missing = parseArguments(['mcp', '--owner', operatorInputs['operator-owner-id']], {
    valueOptions: ['owner', 'state-dir'],
  });
  assert.throws(
    () => requireOptions(missing.options, ['owner', 'state-dir']),
    /--state-dir is required/,
  );
  // The parser permits option reordering. Only the approved metadata ordering is pinned above.
});
