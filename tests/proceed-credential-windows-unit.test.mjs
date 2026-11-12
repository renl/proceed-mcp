// Windows semantics and subprocesses are memory-only, including on Linux.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory } from './fixtures/proceed-credential-memory.mjs';
import { storageCases } from './fixtures/proceed-credential-storage-cases.mjs';
const m = await memory('win32');
const credential = await import('../src/state/credential-file.js');
const protection = await import('../src/state/protection.js');
test('WIN-FIXTURE: complete safe metadata is admitted by the actual shared policy', async () => {
  m.reset();
  await protection.verifyWindowsProtection([m.parent]);
  assert.ok(m.current.queries.length > 0);
  assert.ok(!m.current.events.some(([event]) => ['read', 'write'].includes(event)));
});
storageCases(m, credential);
