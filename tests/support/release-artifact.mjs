// TEST ONLY. Retain asserted bytes. Never build, pack, install or publish.
import assert from 'node:assert/strict';
import { mkdir, realpath, readFile, writeFile, copyFile, lstat, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Fixed vocabulary only. Never forward exception messages, paths or child output.
export function safeSmokeDiagnostic(value = {}) {
  if (value === null || typeof value !== 'object') value = {};
  const phases = ['entry', 'manifest', 'shim-help', 'invalid-command', 'init',
    'repeat-init', 'owner-add', 'broker-start', 'broker-ready', 'status',
    'adapter-start', 'initialize', 'catalog', 'prepare', 'unpaired-refusal',
    'status-after', 'adapter-eof', 'broker-stop', 'privacy', 'complete'];
  const outcome = (item) => ['pending', 'pass', 'fail'].includes(item) ? item : 'pending';
  return {
    phase: phases.includes(value.phase) ? value.phase : 'entry',
    elapsedMs: Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 &&
      value.elapsedMs <= 150000 ? value.elapsedMs : null,
    exit: Number.isInteger(value.exit) && value.exit >= -255 && value.exit <= 255 ? value.exit : null,
    error: value.error == null ? null :
      ['ERR_ASSERTION', 'ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS',
        'ERR_TEST_FAILURE'].includes(value.error) ? value.error : 'OTHER',
    assertion: outcome(value.assertion), cleanup: outcome(value.cleanup),
  };
}
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
  assert.ok([1, 2].includes(manifest.schemaVersion), 'known manifest version');
  assert.deepEqual(Object.keys(manifest).sort(),
    ['schemaVersion', 'package', 'version', 'filename', 'sha256', 'bytes', 'files', 'node', 'platform',
      ...(manifest.schemaVersion === 2 ? ['packedInputs'] : [])].sort());
  if (manifest.schemaVersion === 2) {
    assert.deepEqual(Object.keys(manifest.packedInputs).sort(), ['algorithm', 'digest']);
    assert.equal(manifest.packedInputs.algorithm, 'sha256-packed-inputs-v1');
    assert.match(manifest.packedInputs.digest, /^[a-f0-9]{64}$/);
  }
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
