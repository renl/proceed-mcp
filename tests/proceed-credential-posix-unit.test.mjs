import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory } from './fixtures/proceed-credential-memory.mjs';
import { storageCases } from './fixtures/proceed-credential-storage-cases.mjs';
const m = await memory('linux');
const credential = await import('../src/state/credential-file.js');
storageCases(m, credential);
test('POSIX-MODES: exact owner-only directory/file modes are retained', async () => {
  for (const [target, mode] of [[m.parent, 0o750], [m.file, 0o640]]) {
    m.reset(); m.add(m.file, 'file').bytes = Buffer.from('synthetic\n');
    m.current.entries.get(target).info.mode = mode;
    await assert.rejects(credential.loadCredentialFile({ file: m.file, stateDir: m.stateDir }), { code: 'PROTECTION_UNVERIFIED' });
    assert.ok(!m.current.events.some(([name]) => name === 'read'));
  }
});
