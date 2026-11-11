// Static package admission only, not installed-package/upgrade proof.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
test('PACKAGE-LIFETIME: ordinary install/replacement has no credential lifecycle hook or bundled state', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of [
    'preinstall',
    'install',
    'postinstall',
    'preuninstall',
    'uninstall',
    'postuninstall',
  ])
    assert.equal(
      manifest.scripts?.[name],
      undefined,
      'installation must not invoke secret setup or delete external artifacts',
    );
  for (const entry of ['bin', 'src', 'README.md']) assert.ok(manifest.files.includes(entry));
  for (const entry of manifest.files)
    assert.ok(!/^(\.|\*|\.env|\.proceed-mcp|state|credentials)(\/|$)/.test(entry));
  assert.equal(manifest.bin['proceed-mcp'], 'bin/proceed-mcp.js');
});
