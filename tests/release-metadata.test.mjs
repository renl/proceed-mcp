// TEST ONLY. Contract: active change design section 8, npm-distribution delta.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifest = await json('package.json');
const lock = await json('package-lock.json');

test('PREVIEW-META: publishable preview and lock metadata agree', () => {
  assert.equal(manifest.name, 'proceed-mcp');
  assert.equal(manifest.version, '0.1.0-preview.1');
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
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  assert.match(repository ?? '', /^(?:git\+)?https:\/\/github\.com\/renl\/proceed-mcp(?:\.git)?$/);
});

test('PREVIEW-LICENSE: standard MIT grant and owner-approved attribution', async () => {
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(license, /^Copyright \(c\) 2026 Ng Cheng Leong\r?$/m);
  assert.match(license, /The above copyright notice and this permission notice shall be included/);
  assert.match(license.replace(/\s+/g, ' '), /IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE/);
  assert.doesNotMatch(license, /\[year\]|\[fullname\]|<copyright|TODO/i);
  // Owner-selected attribution is not evidence of registry publishing rights.
});

test('PREVIEW-REGISTRY: owner-approved namespace and consistent listing', async () => {
  const listing = await json('server.json');
  assert.equal(listing.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(manifest.mcpName, 'io.github.renl/proceed-mcp');
  assert.equal(listing.name, manifest.mcpName);
  assert.equal(listing.version, manifest.version);
  const packages = listing.packages.filter((entry) => entry.registryType === 'npm');
  assert.equal(packages.length, 1);
  assert.equal(packages[0].identifier, manifest.name);
  assert.equal(packages[0].version, manifest.version);
  assert.equal(packages[0].transport.type, 'stdio');
  assert.ok(packages[0].packageArguments.some((arg) => arg.value === 'mcp'));
  assert.ok(packages[0].packageArguments.some((arg) => arg.name === '--owner'));
  assert.ok(packages[0].packageArguments.some((arg) => arg.name === '--state-dir'));
  assert.doesNotMatch(JSON.stringify(listing), /PROCEED_TELEGRAM_BOT_TOKEN/);
});
