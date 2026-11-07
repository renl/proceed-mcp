// Create-only protected operator credential (design section 1).
//
// `proceed-mcp harness keygen --operator-key-file <absolute-file>` writes exactly
// one `hop_` credential plus LF to a new owner-only file. It never reads,
// replaces or signs with an existing key, takes no secret argument, and neither
// enrolls the key nor approves work. The same current-account ownership,
// non-redirection, single-link, pre-write protection and exact-owned
// failure-cleanup rules as the startup credential apply.
//
// Same-account protection, not encryption or isolation from other processes
// running as the same account. Platforms whose checks cannot be established
// fail closed.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockedPrerequisite, invalidArgument, storageFailure } from '../errors.js';
import {
  assertProtectedAncestors,
  effectiveUid,
  posix,
  removeExactCreated,
  splitPath,
} from '../state/path-trust.js';
import { OPERATOR_KEY_PATTERN } from './identifiers.js';

const POSIX_DIRECTORY_MODE = 0o700;
const POSIX_FILE_MODE = 0o600;
// One `hop_` credential plus LF is 69 bytes. A bounded read refuses a larger or
// padded file instead of accepting the prefix of unrelated content.
export const MAX_OPERATOR_KEY_INPUT_BYTES = 4096;
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Destinations that would place operator material inside an MCP client
// configuration file instead of dedicated credential storage.
const CONFIGURATION_FILE_NAMES = new Set([
  'opencode.json',
  'opencode.jsonc',
  'mcp.json',
  '.mcp.json',
  'settings.json',
  'credentials.json',
]);

function keyPathFailure(message, cause) {
  return storageFailure(message, 'PROTECTION_UNVERIFIED', cause);
}

// A generated operator credential: `hop_` plus 32 random bytes in lowercase hex.
export function generateOperatorKey() {
  return `hop_${randomBytes(32).toString('hex')}`;
}

// The public fingerprint and verifier. Only this digest is ever persisted or
// disclosed; the credential stays in the operator's protected file.
export function operatorKeyId(credential) {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

// Syntax only: a path, never a credential value. A relative, URL-shaped, UNC,
// device or alternate-data-stream spelling is invalid before any state is read.
export function validateOperatorKeyFileOption(value) {
  if (typeof value !== 'string' || value === '') {
    throw invalidArgument('--operator-key-file requires a path');
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw invalidArgument('--operator-key-file must be one local filesystem path');
  }
  if (posix()) {
    if (value.includes(':')) {
      throw invalidArgument(
        '--operator-key-file must be an absolute filesystem path without a colon',
      );
    }
    if (value.startsWith('//')) {
      throw invalidArgument('--operator-key-file must not name a network share');
    }
  } else if (value.startsWith('\\\\') || value.startsWith('//')) {
    throw invalidArgument('--operator-key-file must not name a network share');
  }
  if (!isAbsolute(value)) {
    throw invalidArgument('--operator-key-file must be an absolute filesystem path');
  }
  return value;
}

async function inspect(path) {
  try {
    return await lstat(path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw storageFailure(
      'the operator credential path could not be inspected',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
}

async function canonicalExisting(path) {
  try {
    return await realpath(path);
  } catch (cause) {
    throw storageFailure(
      `the operator credential path ${path} could not be resolved`,
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
}

async function within(resolvedChild, resolvedParent) {
  const prefix = resolvedParent.endsWith(sep) ? resolvedParent : `${resolvedParent}${sep}`;
  return resolvedChild === resolvedParent || resolvedChild.startsWith(prefix);
}

// The destination stays outside the running package, product state, any
// repository worktree and known configuration directories. Ancestors are only
// inspected: nothing is repaired, followed or deleted.
async function assertLocation({ file, stateDir }) {
  if (CONFIGURATION_FILE_NAMES.has(basename(file).toLowerCase())) {
    throw storageFailure(
      'the operator credential destination is a known configuration file name',
      'PROTECTION_UNVERIFIED',
    );
  }
  const parent = dirname(file);
  const parentInfo = await inspect(parent);
  if (parentInfo !== null) {
    const resolvedParent = await canonicalExisting(parent);
    if (await within(resolvedParent, await canonicalExisting(PACKAGE_ROOT))) {
      throw storageFailure(
        'the operator credential destination is inside the running package directory',
        'PROTECTION_UNVERIFIED',
      );
    }
    if ((await inspect(stateDir)) !== null) {
      if (await within(resolvedParent, await canonicalExisting(stateDir))) {
        throw storageFailure(
          'the operator credential destination must be outside the product state directory',
          'PROTECTION_UNVERIFIED',
        );
      }
    }
    let home = null;
    try {
      home = homedir();
    } catch {
      home = null;
    }
    if (typeof home === 'string' && home !== '') {
      for (const configRoot of [join(home, '.config', 'opencode'), join(home, '.opencode')]) {
        if ((await inspect(configRoot)) === null) continue;
        if (await within(resolvedParent, await canonicalExisting(configRoot))) {
          throw storageFailure(
            'the operator credential destination is inside a known configuration directory',
            'PROTECTION_UNVERIFIED',
          );
        }
      }
    }
  }
  const { root, rest } = splitPath(file);
  let prefix = root;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    if ((await inspect(prefix)) === null) continue;
    if ((await inspect(join(prefix, '.git'))) !== null) {
      throw storageFailure(
        'the operator credential destination is inside a repository worktree',
        'PROTECTION_UNVERIFIED',
      );
    }
  }
}

function assertOwnerOnlyFile(info, description) {
  if (info === null || !info.isFile() || info.isSymbolicLink()) {
    throw storageFailure(`${description} is not a regular file`, 'PROTECTION_UNVERIFIED');
  }
  if (info.nlink !== 1) {
    throw storageFailure(`${description} has multiple hard links`, 'PROTECTION_UNVERIFIED');
  }
  if (!posix()) return;
  if ((info.mode & 0o777) !== POSIX_FILE_MODE) {
    throw storageFailure(
      `${description} does not have owner-only mode 0600`,
      'PROTECTION_UNVERIFIED',
    );
  }
  if (info.uid !== effectiveUid()) {
    throw storageFailure(
      `${description} is not owned by the current account`,
      'PROTECTION_UNVERIFIED',
    );
  }
}

function assertOwnerOnlyDirectory(info, description) {
  if (info === null || !info.isDirectory() || info.isSymbolicLink()) {
    throw storageFailure(`${description} is not a dedicated directory`, 'PROTECTION_UNVERIFIED');
  }
  if (!posix()) return;
  if ((info.mode & 0o777) !== POSIX_DIRECTORY_MODE) {
    throw storageFailure(
      `${description} does not have owner-only mode 0700`,
      'PROTECTION_UNVERIFIED',
    );
  }
  if (info.uid !== effectiveUid()) {
    throw storageFailure(
      `${description} is not owned by the current account`,
      'PROTECTION_UNVERIFIED',
    );
  }
}

// Creates only the missing dedicated directories and the new credential file.
// The destination is opened exclusively, protected before the credential is
// written, flushed and reverified before key generation is reported complete.
export async function createOperatorKeyFile({ file, stateDir } = {}) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the operator credential destination must be an absolute path');
  }
  await assertProtectedAncestors(file, {
    allowMissingTail: true,
    label: 'the operator credential path',
    fail: keyPathFailure,
  });
  await assertLocation({ file, stateDir });

  const { root, rest } = splitPath(file);
  let prefix = root;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    if ((await inspect(prefix)) !== null) continue;
    try {
      await mkdir(prefix, { mode: POSIX_DIRECTORY_MODE });
    } catch (cause) {
      if (cause?.code !== 'EEXIST') {
        throw storageFailure(
          'could not create the operator credential directory',
          'STORAGE_FAILURE',
          cause,
        );
      }
    }
  }

  const parent = dirname(file);
  assertOwnerOnlyDirectory(await inspect(parent), 'the operator credential directory');

  let handle;
  try {
    handle = await open(file, 'wx', POSIX_FILE_MODE);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw invalidArgument(
        'the operator credential destination already exists; choose another dedicated destination',
      );
    }
    throw storageFailure(
      'could not create the operator credential file',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }

  let created = null;
  let key = null;
  try {
    if (posix()) await handle.chmod(POSIX_FILE_MODE);
    created = await handle.stat();
    assertOwnerOnlyFile(created, 'the new operator credential file');
    key = generateOperatorKey();
    await handle.writeFile(`${key}\n`, 'utf8');
    await handle.sync();
    assertOwnerOnlyFile(await handle.stat(), 'the new operator credential file');
  } catch (cause) {
    await handle.close().catch(() => {});
    // The exclusive create proved this attempt owned the object it opened, but
    // the destination may have been renamed away and replaced since. Remove only
    // the exact object still proven to be this attempt's.
    const removed = await removeExactCreated(file, created);
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(
      removed
        ? 'could not write the operator credential file'
        : 'could not write the operator credential file; an object created during key generation could not be proven safe to remove',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
  await handle.close();

  assertOwnerOnlyFile(await inspect(file), 'the issued operator credential file');
  assertOwnerOnlyDirectory(await inspect(parent), 'the operator credential directory');
  return { file, keyId: operatorKeyId(key) };
}

const MISSING_KEY_GUIDANCE =
  'the operator credential is missing; run "proceed-mcp harness keygen --operator-key-file <absolute-file>"';

function invalidKey(message) {
  return blockedPrerequisite(
    `${message}; create a new key with "proceed-mcp harness keygen --operator-key-file <absolute-file>"`,
    'OPERATOR_KEY_INVALID',
  );
}

// Exactly one credential line: `hop_` plus 64 lowercase hexadecimal characters
// with an optional single LF/CRLF terminator. No padding, BOM, embedded newline or
// extra text is accepted.
export function parseOperatorKeyInput(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw invalidKey('the operator credential is empty');
  let end = bytes.length;
  if (bytes[end - 1] === 0x0a) {
    end -= 1;
    if (end > 0 && bytes[end - 1] === 0x0d) end -= 1;
  }
  if (end !== 68) throw invalidKey('the operator credential is not one complete credential line');
  const credential = bytes.subarray(0, end).toString('ascii');
  if (!OPERATOR_KEY_PATTERN.test(credential)) {
    throw invalidKey('the operator credential is not a valid operator key');
  }
  return credential;
}

// Read-only protected load for the TUI: path, ancestor and location rules, the
// actual opened file identity and owner-only protection are established before
// the credential is read, then rechecked before it is returned. Nothing is
// repaired, followed or created, and no other credential file is consulted.
export async function loadOperatorKeyFile({ file, stateDir } = {}) {
  validateOperatorKeyFileOption(file);
  if ((await inspect(dirname(file))) === null)
    throw blockedPrerequisite(MISSING_KEY_GUIDANCE, 'OPERATOR_KEY_UNAVAILABLE');
  await assertProtectedAncestors(file, {
    allowMissingTail: false,
    label: 'the operator credential path',
    fail: keyPathFailure,
  });
  await assertLocation({ file, stateDir });

  const before = await inspect(file);
  if (before === null) throw blockedPrerequisite(MISSING_KEY_GUIDANCE, 'OPERATOR_KEY_UNAVAILABLE');
  assertOwnerOnlyFile(before, 'the operator credential file');
  assertOwnerOnlyDirectory(await inspect(dirname(file)), 'the operator credential directory');

  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      throw blockedPrerequisite(MISSING_KEY_GUIDANCE, 'OPERATOR_KEY_UNAVAILABLE');
    }
    throw storageFailure(
      'the operator credential could not be opened safely',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }

  let bytes;
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw storageFailure(
        'the operator credential was replaced while it was being opened',
        'PROTECTION_UNVERIFIED',
      );
    }
    // The opened handle, not a pathname observation, must be the protected
    // single-link regular file before any credential byte is read.
    assertOwnerOnlyFile(opened, 'the opened operator credential file');
    if (opened.size > MAX_OPERATOR_KEY_INPUT_BYTES) {
      throw invalidKey('the operator credential file is too large');
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }

  if (bytes.length > MAX_OPERATOR_KEY_INPUT_BYTES)
    throw invalidKey('the operator credential file is too large');
  const after = await inspect(file);
  if (after === null || after.dev !== before.dev || after.ino !== before.ino) {
    throw storageFailure(
      'the operator credential changed identity while it was read',
      'PROTECTION_UNVERIFIED',
    );
  }
  assertOwnerOnlyFile(after, 'the operator credential file');
  assertOwnerOnlyDirectory(await inspect(dirname(file)), 'the operator credential directory');

  const credential = parseOperatorKeyInput(bytes);
  return { credential, keyId: operatorKeyId(credential) };
}
