// Windows semantics and subprocesses are memory-only, including on Linux.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory } from './fixtures/proceed-credential-memory.mjs';
import { storageCases } from './fixtures/proceed-credential-storage-cases.mjs';
const m = await memory('win32');
const credential = await import('../src/state/credential-file.js');
const protection = await import('../src/state/protection.js');
test('WIN-FIXTURE: shared ordinary directory admission needs no protection query', async () => {
  m.reset({ queryUnavailable: true });
  await protection.verifyOwnerOnly([m.parent]);
  assert.equal(m.current.queries.length, 0);
  assert.ok(!m.current.events.some(([event]) => ['read', 'write'].includes(event)));
});
storageCases(m, credential);
