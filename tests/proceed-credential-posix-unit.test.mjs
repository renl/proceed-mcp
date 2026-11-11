// Ordinary token storage contract, synthetic POSIX filesystem only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory } from './fixtures/proceed-credential-memory.mjs';
import { storageCases } from './fixtures/proceed-credential-storage-cases.mjs';
const m = await memory('linux');
const credential = await import('../src/state/credential-file.js');
storageCases(m, credential);
test('POSIX-PROTECTED-CALLER: operator key retains shared ancestry and owner-only admission', async () => {
  const operator = await import('../src/harness/operator-key.js');
  for (const target of [m.home, m.parent, m.file]) {
    m.reset();
    m.add(m.file, 'file').bytes = Buffer.from(`hop_${'a'.repeat(64)}\n`);
    Object.assign(m.current.entries.get(target).info, { mode: 0o777, uid: 987654 });
    await assert.rejects(operator.loadOperatorKeyFile({ file: m.file, stateDir: m.stateDir }), {
      code: 'PROTECTION_UNVERIFIED',
    });
    assert.ok(!m.current.events.some(([name]) => ['read', 'write', 'unlink'].includes(name)));
  }
});
