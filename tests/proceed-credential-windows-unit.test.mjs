// Windows path semantics, metadata and processes are memory-only on every host.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory, SECRET } from './fixtures/proceed-credential-memory.mjs';
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
test('WIN-SETUP: supported private setup reaches the same public command', async () => {
  m.reset();
  const result = await m.invoke();
  assert.equal(result.code, 0);
  assert.equal(await credential.loadCredentialFile({ file: m.file, stateDir: m.stateDir }), SECRET);
});
test('WIN-REFUSAL: unsafe inheritance/storage or unavailable query refuses before input and reads', async (t) => {
  for (const [name, settings, code] of [
    ['unavailable query', { queryUnavailable: true }, 'PROTECTION_UNAVAILABLE'],
    ['foreign grant', { metadata(entry) {
      if (entry.path === m.parent && entry.object) entry.object.aces.push({ type: 'allow', sid: 'S-1-1-0', mask: 1, flags: 3 });
      return entry;
    } }, 'PROTECTION_UNVERIFIED'],
    ['no file inheritance', { metadata(entry) {
      if (entry.path === m.parent && entry.object) entry.object.aces[0].flags = 2;
      return entry;
    } }, 'PROTECTION_UNVERIFIED'],
    ['removable storage', { metadata(entry) {
      if (entry.volume) entry.volume.drive_type = 'removable'; return entry;
    } }, 'PROTECTION_UNVERIFIED'],
  ]) await t.test(name, async () => {
    m.reset(settings);
    const result = await m.invoke();
    assert.equal(result.code, 4);
    assert.equal(m.current.events.filter(([event]) => ['input', 'read', 'write', 'chmod'].includes(event)).length, 0);
    m.add(m.file, 'file').bytes = Buffer.from(`${SECRET}\n`);
    await assert.rejects(credential.loadCredentialFile({ file: m.file, stateDir: m.stateDir }), { code });
    assert.ok(!m.current.events.some(([event]) => event === 'read'));
  });
});
