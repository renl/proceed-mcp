// Shared storage admission for state, journals, ownership records, local
// credentials, confidential-channel keys and operator keys.
//
// POSIX keeps owner-only protection: 0700 directories and 0600 files validated
// by mode bits and UID at each caller's existing call site, with the existing
// ancestor policy. Windows keeps ordinary object correctness only: non-following
// type and identity observations, one contiguous unredirected directory
// ancestry, exclusive creation and write completion.
//
// Windows filesystem privacy is the operator's responsibility. No ACL, owner,
// mode, inheritance, volume or protection query decides admission, nothing here
// repairs permissions, and a successful operation never claims owner-only
// protection was verified.
//
// The Windows observations below are repeated path/handle comparisons. They
// detect an observed replacement or the wrong object before private bytes are
// returned or a publication is reported as complete. They do not pin native
// handles and do not promise resistance to hostile local mutation.
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { storageFailure } from '../errors.js';
import { splitPath } from './path-trust.js';

const POSIX_DIRECTORY_MODE = 0o700;

function ordinaryFailure(message, cause) {
  return storageFailure(message, 'STORAGE_FAILURE', cause);
}

// Expected kind comes from the operation. `null` accepts either an existing
// directory or an existing regular file, which is all a mixed target list can
// promise without inventing a new public policy object.
function assertObjectShape(info, { expected, description, fail }) {
  if (info.isSymbolicLink()) {
    throw fail(`${description} is a link or reparse point instead of ordinary storage`);
  }
  if (expected === 'directory') {
    if (!info.isDirectory()) throw fail(`${description} is not a directory`);
    return;
  }
  if (expected === 'file') {
    if (!info.isFile()) throw fail(`${description} is not a regular file`);
    return;
  }
  if (!info.isDirectory() && !info.isFile()) {
    throw fail(`${description} is not a directory or regular file`);
  }
}

// Non-following observation of one existing object. Only ENOENT means absent:
// access denial and every other inspection failure refuse rather than guess.
async function observeObject(path, { description, fail }) {
  try {
    return await lstat(path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw fail(`${description} could not be inspected`, cause);
  }
}

// Every existing component of the path's ancestry must be one contiguous,
// non-redirected directory chain. A missing component is accepted only when the
// operation supports a missing tail, and an existing entry below a missing one
// is not this operation's object.
async function assertOrdinaryAncestry(file, { allowMissingTail, description, fail }) {
  const { root, rest } = splitPath(file);
  let prefix = root;
  let missingFrom = null;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    const info = await observeObject(prefix, { description, fail });
    if (missingFrom !== null) {
      if (info !== null) {
        throw fail(`${description} does not resolve to one contiguous directory chain`);
      }
      continue;
    }
    if (info === null) {
      if (!allowMissingTail) {
        throw fail(`${description} does not resolve to one existing directory chain`);
      }
      missingFrom = prefix;
      continue;
    }
    if (info.isSymbolicLink()) throw fail(`${description} contains a link or reparse point`);
    if (!info.isDirectory()) throw fail(`${description} has a non-directory parent`);
  }
}

// Shared admission for an existing Windows storage object and its ancestry.
// Returns the observation, or null when the tail is absent and absence is
// allowed for this operation. Nothing is repaired or re-permissioned, and on
// POSIX this is a no-op so the callers keep their existing policy.
export async function verifyStorageObject(
  file,
  {
    allowMissingTail = false,
    expected = null,
    description = `the storage path ${file}`,
    fail = ordinaryFailure,
  } = {},
) {
  if (process.platform !== 'win32') return null;
  await assertOrdinaryAncestry(file, { allowMissingTail, description, fail });
  const info = await observeObject(file, { description, fail });
  if (info === null) {
    if (allowMissingTail) return null;
    throw fail(`${description} is missing`);
  }
  assertObjectShape(info, { expected, description, fail });
  return info;
}

// Re-observes a path after a read, flush or publication and requires it to still
// be the same object this attempt opened or created. A replacement,
// disappearance or shape change is not success.
export async function verifyStorageIdentity(
  file,
  created,
  { expected = 'file', description = `the storage path ${file}`, fail = ordinaryFailure } = {},
) {
  if (process.platform !== 'win32') return;
  if (created === null || typeof created !== 'object') {
    throw fail(`${description} was never observed as an ordinary object`);
  }
  const info = await observeObject(file, { description, fail });
  if (info === null) throw fail(`${description} disappeared`);
  assertObjectShape(info, { expected, description, fail });
  if (info.dev !== created.dev || info.ino !== created.ino) {
    throw fail(`${description} was replaced or changed identity`);
  }
}

// Ordinary read of one storage file. On POSIX this is the existing plain read.
// On Windows the object and its ancestry are admitted, the opened handle is
// compared with the path observation before any byte is returned, and the path
// is re-observed before the bytes are used. Returns null only for absence.
export async function readStorageFile(
  file,
  { expected = 'file', description = `the storage file ${file}`, fail = ordinaryFailure } = {},
) {
  if (process.platform !== 'win32') {
    try {
      return await readFile(file);
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw fail(`could not read ${description}`, cause);
    }
  }

  const before = await verifyStorageObject(file, {
    allowMissingTail: true,
    expected,
    description,
    fail,
  });
  if (before === null) return null;

  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw fail(`${description} could not be opened`, cause);
  }

  let bytes;
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw fail(`${description} changed identity while it was being opened`);
    }
    assertObjectShape(opened, { expected, description, fail });
    bytes = await handle.readFile();
  } catch (cause) {
    if (cause?.name === 'CliError') throw cause;
    throw fail(`${description} could not be read`, cause);
  } finally {
    await handle.close().catch(() => {});
  }

  await verifyStorageIdentity(file, before, { expected, description, fail });
  return bytes;
}

export async function verifyOwnerOnly(targets) {
  if (targets.length === 0) return;
  if (process.platform === 'win32') {
    // Ordinary Windows admission: each target must be existing, unredirected
    // ordinary storage. Permissions do not decide this.
    for (const target of targets) {
      await verifyStorageObject(target, { description: `the storage path ${target}` });
    }
    return;
  }
  await assertPosixOwnerOnly(targets);
}

// Creates a state directory with the platform's own creation policy. Windows
// uses ordinary OS defaults, supports missing parents and applies or repairs no
// permission; POSIX keeps its owner-only mode and check.
export async function createProtectedDirectory(directory) {
  if (process.platform === 'win32') {
    const description = `the storage directory ${directory}`;
    await assertOrdinaryAncestry(directory, {
      allowMissingTail: true,
      description,
      fail: ordinaryFailure,
    });
    try {
      await mkdir(directory, { recursive: true });
    } catch (cause) {
      throw storageFailure(`could not create ${description}`, 'STORAGE_FAILURE', cause);
    }
    // An existing component is checked as a real directory, never adopted as a
    // redirected object, and a creation collision never authorizes repair.
    await verifyStorageObject(directory, { expected: 'directory', description });
    return;
  }

  try {
    await mkdir(directory, { recursive: true, mode: POSIX_DIRECTORY_MODE });
  } catch (cause) {
    throw storageFailure(`could not create directory ${directory}`, 'STORAGE_FAILURE', cause);
  }
  await chmod(directory, POSIX_DIRECTORY_MODE);
  await assertPosixOwnerOnly([directory]);
}

async function assertPosixOwnerOnly(targets) {
  const failures = [];
  for (const target of targets) {
    let info;
    try {
      info = await stat(target);
    } catch (cause) {
      throw storageFailure(`could not inspect ${target}`, 'PROTECTION_UNVERIFIED', cause);
    }
    const mode = info.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      failures.push(`${target} (mode ${mode.toString(8)})`);
    }
  }
  if (failures.length > 0) {
    throw storageFailure(
      `state files grant access to other accounts: ${failures.join('; ')}`,
      'PROTECTION_UNVERIFIED',
    );
  }
}
