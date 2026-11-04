// TEST ONLY. Offline retention/teardown calibration in owned ignored scratch.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { retainVerifiedArtifact } from './support/release-artifact.mjs';

test('retention binds bytes and requires teardown before eligibility', async () => {
  const parent = resolve('.scratch/preview-package');
  await mkdir(parent, { recursive: true });
  await mkdir(resolve('.scratch/preview-prep'), { recursive: true });
  const run = await mkdtemp(join(parent, 'run-retention-control-'));
  const fixture = await mkdtemp(resolve('.scratch/preview-prep/retention-control-'));
  const artifactDir = join(fixture, 'artifact');
  const filename = 'meshimize-proceed-mcp-0.1.0-preview.1.tgz';
  const tarballPath = join(run, filename);
  const bytes = Buffer.from('offline dummy tarball bytes, not package proof');
  const manifest = { schemaVersion: 1, package: '@meshimize/proceed-mcp', version: '0.1.0-preview.1',
    filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    files: [{ path: 'LICENSE', size: 1 }], node: process.versions.node, platform: process.platform };
  const retain = (changes = {}) => retainVerifiedArtifact({ tarballPath, artifactDir, manifest, ...changes });
  try {
    await writeFile(tarballPath, bytes);
    for (const bad of ['relative', resolve('.scratch/preview-package'), join(run, 'artifact'),
      `${fixture}/../escape`, resolve('.')]) {
      await assert.rejects(retain({ artifactDir: bad }));
    }
    await assert.rejects(retain({ manifest: { ...manifest, sha256: '0'.repeat(64) } }));
    await assert.rejects(retain({ manifest: { ...manifest, secret: 'not allowed' } }));
    await assert.rejects(access(artifactDir), { code: 'ENOENT' });
    const finish = await retain();
    const output = join(artifactDir, 'artifact.json');
    assert.deepEqual(await readFile(join(artifactDir, filename)), bytes);
    assert.deepEqual(JSON.parse(await readFile(output)), manifest);
    await assert.rejects(finish(run), 'cleanup failure must leave artifact ineligible');
    assert.equal(JSON.parse(await readFile(output)).cleanup, undefined);
    await assert.rejects(retain(), 'never overwrite an existing retained artifact');
    await rm(run, { recursive: true });
    await writeFile(join(artifactDir, filename), 'tampered');
    await assert.rejects(finish(run));
    assert.equal(JSON.parse(await readFile(output)).cleanup, undefined);
    await writeFile(join(artifactDir, filename), bytes);
    await finish(run);
    assert.deepEqual(JSON.parse(await readFile(output)), { ...manifest, cleanup: 'pass' });
    assert.deepEqual((await readdir(artifactDir)).sort(), ['artifact.json', filename].sort());
    assert.doesNotMatch(await readFile(output, 'utf8'), /[A-Z]:\\|npmrc|token|secret/i);
  } finally {
    await rm(run, { recursive: true, force: true });
    await rm(fixture, { recursive: true });
    await assert.rejects(access(run), { code: 'ENOENT' });
    await assert.rejects(access(fixture), { code: 'ENOENT' });
  }
});
