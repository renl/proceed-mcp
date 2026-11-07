// Owner-only path trust for protected state and credential files (design
// sections 2 and 4).
//
// Section 4 applies section 2's current-account ownership, non-redirection,
// ancestor-protection, regular-file/single-link and handle-identity conditions to
// the protected trust publication as well as the credential file, without the
// separate token-location rule. Both callers share this one implementation so the
// two rules cannot drift apart. An existing ancestor is only inspected: nothing
// here repairs, re-permissions, follows or deletes it.
import { lstat, unlink } from 'node:fs/promises';
import { join, parse } from 'node:path';

export const posix = () => process.platform !== 'win32';

export function effectiveUid() {
  return typeof process.geteuid === 'function' ? process.geteuid() : null;
}

export function splitPath(file) {
  const { root } = parse(file);
  return {
    root,
    rest: file
      .slice(root.length)
      .split(/[\\/]/)
      .filter((name) => name !== ''),
  };
}

// An ancestor must not let an untrusted account replace the protected entry. A
// directory without group/other write permission protects its children. A
// writable system ancestor such as a temporary or shared root protects them only
// with the sticky bit, which reserves rename/removal for the entry owner, the
// directory owner and root. A system root is never required to belong to the
// operator and its permissions are never altered here.
export function ancestorProtects(info) {
  if (!posix()) return true;
  if ((info.mode & 0o022) === 0) return true;
  if ((info.mode & 0o1000) === 0) return false;
  return info.uid === 0 || info.uid === effectiveUid();
}

// Non-following inspection. A missing component is reported as null only when the
// caller is about to create the tail; every other failure refuses rather than
// guesses.
export async function inspectEntry(path, fail) {
  try {
    return await lstat(path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw fail('the protected path could not be inspected', cause);
  }
}

// Every existing ancestor of `file` must be one contiguous, non-redirected
// directory chain that no untrusted account can replace. `fail` supplies the
// caller's own classification so a credential refusal and a trust-publication
// refusal stay distinguishable.
export async function assertProtectedAncestors(file, { allowMissingTail = false, label, fail }) {
  const { root, rest } = splitPath(file);
  let prefix = root;
  let missingFrom = null;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    const info = await inspectEntry(prefix, fail);
    if (info === null) {
      if (!allowMissingTail) {
        throw fail(`${label} does not resolve to one existing directory chain`);
      }
      missingFrom ??= prefix;
      continue;
    }
    if (missingFrom !== null) {
      // An existing entry below a missing parent is not this attempt's object.
      throw fail(`${label} does not resolve to one contiguous directory chain`);
    }
    if (info.isSymbolicLink()) {
      throw fail(`${label} contains a symbolic link or reparse point`);
    }
    if (!info.isDirectory()) {
      throw fail(`${label} has a non-directory ancestor`);
    }
    if (!ancestorProtects(info)) {
      throw fail(`the ancestor ${prefix} of ${label} could be replaced by another account`);
    }
  }
}

// `true` only when the destination still resolves to the exact object this
// attempt created. A missing or uninspectable destination, or a different
// device/inode, is not proof of ownership over the current entry, so a
// replacement and an uncertain object are both preserved.
export async function removeExactCreated(file, created) {
  if (created === null) return false;
  let current;
  try {
    current = await lstat(file);
  } catch {
    return false;
  }
  if (current.dev !== created.dev || current.ino !== created.ino) return false;
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}
