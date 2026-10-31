// Test-only additive seam binding. Synthetic credentials never enter diagnostics.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const load = () => import('../src/state/owner-credentials.js');
const scratch = fileURLToPath(new URL('../.scratch/small03a1a/', import.meta.url));

test('PORT-HELPER-CREDENTIAL: validated owner-scoped filenames and paths', async () => {
  const m = await load();
  assert.equal(m.OWNER_CREDENTIAL_PREFIX, 'owner.');
  assert.equal(m.OWNER_CREDENTIAL_SUFFIX, '.token');
  for (const id of ['a', 'owner_b-2', 'z'.repeat(64)]) {
    assert.equal(m.ownerCredentialFileName(id), `owner.${id}.token`);
    assert.equal(m.ownerCredentialPath(resolve(scratch), id), join(resolve(scratch), `owner.${id}.token`));
  }
  for (const id of ['../a', 'a/b', 'a\\b', '', 'A', 'a'.repeat(65)]) {
    assert.throws(() => m.ownerCredentialFileName(id), { code: 'INVALID_ARGUMENT', exitCode: 2 });
    assert.throws(() => m.ownerCredentialPath(scratch, id), { code: 'INVALID_ARGUMENT', exitCode: 2 });
  }
});

test('PORT-HELPER-CREDENTIAL: independent tokens, secret-free results, immutable duplicates and read failures',
  { timeout: 15000 }, async () => {
    const m = await load(); // Import before scratch creation: missing seam is explicit RED.
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, 'credentials-'));
    try {
      const a = m.ownerCredentialPath(root, 'a');
      const b = m.ownerCredentialPath(root, 'b');
      const resultA = await m.writeOwnerCredential(a);
      const resultB = await m.writeOwnerCredential(b);
      assert.deepEqual(resultA, { file: a });
      assert.deepEqual(resultB, { file: b });
      const beforeA = await readFile(a);
      const beforeB = await readFile(b);
      const tokenA = await m.readOwnerCredential(a, 'a');
      const tokenB = await m.readOwnerCredential(b, 'b');
      assert.equal(typeof tokenA, 'string');
      assert.equal(typeof tokenB, 'string');
      assert.ok(/^[0-9a-f]{64}$/.test(tokenA), 'owner A token shape');
      assert.ok(/^[0-9a-f]{64}$/.test(tokenB), 'owner B token shape');
      assert.ok(tokenA !== tokenB, 'independent owners must not share credentials');
      assert.ok(beforeA.toString('utf8').trim() === tokenA, 'read matches owner A file');
      assert.ok(beforeB.toString('utf8').trim() === tokenB, 'read matches owner B file');
      await assert.rejects(m.writeOwnerCredential(a), { code: 'OWNER_ALREADY_CONFIGURED', exitCode: 2 });
      assert.ok(beforeA.equals(await readFile(a)), 'duplicate preserves owner A bytes');
      assert.ok(beforeB.equals(await readFile(b)), 'owner B bytes unchanged');
      await assert.rejects(m.readOwnerCredential(join(root, 'missing.token'), 'missing'),
        { code: 'CREDENTIAL_MISSING', exitCode: 3 });
      const malformed = join(root, 'malformed.token');
      for (const text of ['', 'not-a-token', 'f'.repeat(63), 'g'.repeat(64)]) {
        await writeFile(malformed, text);
        await assert.rejects(m.readOwnerCredential(malformed, 'bad'), error => {
          assert.equal(error.code, 'CREDENTIAL_INVALID');
          assert.equal(error.exitCode, 4);
          if (text) assert.ok(!error.message.includes(text), 'malformed credential redacted');
          return true;
        });
      }
      assert.deepEqual((await readdir(root)).sort(), ['malformed.token', 'owner.a.token', 'owner.b.token']);
    } finally {
      await rm(root, { recursive: true, force: true });
      await assert.rejects(stat(root), { code: 'ENOENT' });
    }
  });
