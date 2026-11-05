// Release-policy digest leaf: the one read-only function that binds the installed
// package bytes to the declared root inputs, so a later acceptance record can be
// compared byte for byte. It imports the schema leaf only, so the algorithm
// constant and the single ReleasePolicyError identity stay shared. There is no
// write, child process, environment or clock read, network access or top-level
// execution here, and nothing outside installDir and the declared input list is
// ever opened: release/, docs/, tests/, .scratch/ and every credential file stay
// out of the binding.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  PACKED_INPUT_DIGEST_ALGORITHM,
  ReleasePolicyError,
  isText,
} from './release-policy-schema.mjs';

const PACKED_INPUTS_SCHEMA = 'proceed-mcp/packed-inputs/1';
// The five mandatory inputs must exist, or the call fails. The optional set is
// recorded when present and absent otherwise: .npmignore versus the .gitignore
// fallback and a shrinkwrap replacing the lockfile each change what npm packs.
const MANDATORY_INPUTS = [
  'LICENSE',
  'README.md',
  'package-lock.json',
  'package.json',
  'scripts/build.mjs',
];
const OPTIONAL_INPUTS = ['.gitignore', '.npmignore', 'npm-shrinkwrap.json'];

const unreadable = (detail) => new ReleasePolicyError('DIGEST_UNREADABLE', detail);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Ordering is UTF-8 byte order, never locale order, because the acceptance record
// holds pre-sorted arrays and a digest has to reproduce on any host.
const byPath = (left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
const readBytes = async (path) => {
  try {
    return await readFile(path);
  } catch {
    throw unreadable('declared path is not a readable regular file');
  }
};

// Every regular file under the installed package root, with '/'-joined paths
// relative to that root. A symlink or junction could resolve outside the tree, so
// it is refused before being followed, and a name that resolves outside the root
// is refused the same way.
async function enumerateInstalledFiles(installDir) {
  const installedRoot = resolve(installDir);
  const files = [];
  const walk = async (directory, prefix) => {
    let entries;
    try {
      entries = await readdir(directory);
    } catch {
      throw unreadable('installed tree is not readable');
    }
    for (const name of entries) {
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = resolve(directory, name);
      if (!absolute.startsWith(`${installedRoot}${sep}`)) {
        throw unreadable('installed tree entry resolves outside the package root');
      }
      let stats;
      try {
        stats = await lstat(absolute);
      } catch {
        throw unreadable('installed tree entry is not readable');
      }
      if (stats.isSymbolicLink()) throw unreadable('installed tree contains a link');
      if (stats.isDirectory()) {
        await walk(absolute, path);
        continue;
      }
      if (!stats.isFile()) throw unreadable('installed tree entry is not a regular file');
      const bytes = await readBytes(absolute);
      files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    }
  };
  await walk(installedRoot, '');
  return files.sort(byPath);
}

// The declared inputs from the repository root at the same revision, sorted once
// as a single array so an optional file that is added, changed or removed moves the
// digest before it can affect a shipped file.
async function readDeclaredInputs(root) {
  const inputs = [];
  for (const path of [...MANDATORY_INPUTS, ...OPTIONAL_INPUTS]) {
    const absolute = resolve(root, path);
    let stats;
    try {
      stats = await lstat(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw unreadable('declared input is not readable');
      if (MANDATORY_INPUTS.includes(path)) throw unreadable('mandatory declared input is absent');
      continue;
    }
    if (!stats.isFile()) throw unreadable('declared input is not a regular file');
    inputs.push({ path, sha256: sha256(await readBytes(absolute)) });
  }
  return inputs.sort(byPath);
}

// {algorithm, digest, files, inputs} with the fixed key order and no whitespace, so
// the same tree, walked in any order, reproduces the same digest.
export async function computePackedInputs({ installDir, root } = {}) {
  if (!isText(installDir) || !isText(root)) {
    throw unreadable('install dir and root are required');
  }
  const files = await enumerateInstalledFiles(installDir);
  const inputs = await readDeclaredInputs(root);
  const digest = sha256(
    Buffer.from(JSON.stringify({ schema: PACKED_INPUTS_SCHEMA, files, inputs }), 'utf8'),
  );
  return { algorithm: PACKED_INPUT_DIGEST_ALGORITHM, digest, files, inputs };
}
