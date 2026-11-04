// TEST ONLY. Retain asserted bytes. Never build, pack, install or publish.
import assert from 'node:assert/strict';
import { mkdir, realpath, readFile, writeFile, copyFile, lstat, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {
  const part = relative(parent, child);
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
};
export async function retainVerifiedArtifact({ tarballPath, artifactDir, manifest }) {
  const root = await realpath('.');
  const disposable = resolve('.scratch/preview-package');
  assert.ok(isAbsolute(artifactDir) && !artifactDir.split(/[\\/]/).includes('..'), 'absolute nontraversing retention path');
  const destination = resolve(artifactDir);
  assert.ok(inside(root, destination) && destination !== disposable && !inside(disposable, destination), 'retention outside disposable runs');
  // Require an existing real parent. Never follow a link out of the worktree.
  assert.equal(await realpath(dirname(destination)), dirname(destination), 'retention parent must not be a link');
  assert.ok(inside(disposable, tarballPath), 'retain only a pack-run tarball');
  assert.equal(await realpath(tarballPath), tarballPath, 'tarball must not be a link');
  assert.match(manifest.filename, /^[a-z0-9.-]+\.tgz$/);
  assert.equal(basename(tarballPath), manifest.filename);
  assert.equal(manifest.cleanup, undefined, 'cleanup not yet proven');
  assert.deepEqual(Object.keys(manifest).sort(),
    ['schemaVersion', 'package', 'version', 'filename', 'sha256', 'bytes', 'files', 'node', 'platform'].sort());
  for (const entry of manifest.files) {
    assert.deepEqual(Object.keys(entry).sort(), ['path', 'size']);
    assert.match(entry.path, /^(?:package\.json|README\.md|LICENSE|(?:bin|src)\/[a-zA-Z0-9_/-]+\.js)$/);
    assert.ok(!entry.path.split('/').includes('..') && Number.isSafeInteger(entry.size) && entry.size >= 0);
  }
  const bytes = await readFile(tarballPath);
  assert.equal(hash(bytes), manifest.sha256, 'asserted source hash');
  assert.equal(bytes.length, manifest.bytes);
  // Exclusive directory creation also preserves all prior manifests and unknown data.
  await mkdir(destination, { mode: 0o700 });
  const target = join(destination, manifest.filename);
  await copyFile(tarballPath, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
  assert.equal(hash(await readFile(target)), manifest.sha256, 'retained copy hash');
  const output = join(destination, 'artifact.json');
  await writeFile(output, `${JSON.stringify(manifest)}\n`, { mode: 0o600, flag: 'wx' });
  return async function afterCleanup(runPath) {
    assert.ok(inside(disposable, runPath) && inside(runPath, tarballPath), 'exact owning run required');
    await assert.rejects(lstat(runPath), { code: 'ENOENT' });
    assert.equal(hash(await readFile(target)), manifest.sha256, 'retained bytes unchanged after teardown');
    await writeFile(output, `${JSON.stringify({ ...manifest, cleanup: 'pass' })}\n`, { mode: 0o600 });
  };
}
