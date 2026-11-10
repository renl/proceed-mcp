// Broker-only automatic-startup Telegram credential (design sections 1-2).
//
// One explicitly provisioned owner-only file outside the repository, product
// state and MCP configuration. Provisioning is create-only: it never reads,
// overwrites, truncates or repairs an existing destination, and it removes only
// objects it can still prove it created. Loading verifies the path, the actual
// file identity and the protection before the content is read, then rechecks
// identity and protection before the token is used.
//
// This is same-account protection, not encryption or isolation from other
// processes running as the same account. Platforms or filesystems whose checks
// cannot be established fail closed.
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockedPrerequisite, invalidArgument, storageFailure } from '../errors.js';
import {
  assertProtectedAncestors,
  effectiveUid,
  posix,
  removeExactCreated,
  splitPath,
  windowsAbsolutePathProblem,
} from './path-trust.js';

export const CREDENTIAL_DIRECTORY_NAME = '.proceed-mcp-credentials';
export const CREDENTIAL_FILE_NAME = 'telegram.token';
// One nonempty line of 1-4096 ASCII non-whitespace bytes, optionally ending in
// one LF or CRLF. A longer input is refused rather than truncated.
export const MAX_TOKEN_BYTES = 4096;
export const MAX_TOKEN_INPUT_BYTES = 4098;
export const TOKEN_INPUT_TIMEOUT_MS = 60000;

const POSIX_DIRECTORY_MODE = 0o700;
const POSIX_FILE_MODE = 0o600;
// Destinations that would place credential material in an MCP client
// configuration file instead of dedicated credential storage.
const CONFIGURATION_FILE_NAMES = new Set([
  'opencode.json',
  'opencode.jsonc',
  'mcp.json',
  '.mcp.json',
  'settings.json',
  'credentials.json',
]);
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function credentialPathFailure(message, cause) {
  return storageFailure(message, 'PROTECTION_UNVERIFIED', cause);
}

function canonicalStatePath(stateDir) {
  let canonical = stateDir;
  const { root } = parse(canonical);
  if (canonical.length > root.length && (canonical.endsWith(sep) || canonical.endsWith('/'))) {
    canonical = canonical.slice(0, -1);
  }
  if (!posix()) canonical = canonical.replaceAll('\\', '/').toLowerCase();
  return canonical;
}

// sha256 of the canonical absolute state directory: it distinguishes state
// directories, not accounts, and moving state changes the default location.
export function stateKey(stateDir) {
  return createHash('sha256').update(canonicalStatePath(stateDir), 'utf8').digest('hex');
}

// `<home>/.proceed-mcp-credentials/<state-key>/telegram.token` is the supported
// default; an explicit absolute path replaces it and is repeated consistently.
export function defaultCredentialFile({ stateDir, home = homedir() } = {}) {
  return join(home, CREDENTIAL_DIRECTORY_NAME, stateKey(stateDir), CREDENTIAL_FILE_NAME);
}

// Syntax only: options carry paths, never token values, and a relative,
// URL-shaped, UNC, device or alternate-data-stream spelling is invalid input
// before any state is consulted.
export function validateCredentialFileOption(value) {
  if (typeof value !== 'string' || value === '') {
    throw invalidArgument('--telegram-token-file requires a path');
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw invalidArgument('--telegram-token-file must be one local filesystem path');
  }
  if (posix()) {
    if (value.includes(':')) {
      throw invalidArgument(
        '--telegram-token-file must be a local absolute filesystem path without a colon',
      );
    }
    if (value.startsWith('//')) {
      throw invalidArgument('--telegram-token-file must not name a network share');
    }
  } else {
    const problem = windowsAbsolutePathProblem(value);
    if (problem !== null) throw invalidArgument(`--telegram-token-file ${problem}`);
  }
  if (!isAbsolute(value)) {
    throw invalidArgument('--telegram-token-file must be an absolute filesystem path');
  }
  return value;
}

// Windows token-file provisioning and loading are not supportable in this
// release: the required file protection cannot be verified there. The refusal
// is a fixed, secret-free prerequisite failure before any secret is read or
// written, and it never falls back to another source.
const WINDOWS_FILE_ROUTE_GUIDANCE =
  'Windows Telegram token-file provisioning and loading are not supported in this release; supply the token privately through PROCEED_TELEGRAM_BOT_TOKEN at launch, or use "serve --secure-local" for foreground reuse without a token file';

export function assertWindowsFileCredentialSupported(operation) {
  if (posix()) return;
  throw blockedPrerequisite(
    `${WINDOWS_FILE_ROUTE_GUIDANCE} (${operation})`,
    'TELEGRAM_CREDENTIAL_UNSUPPORTED',
  );
}

async function inspect(path) {
  try {
    return await lstat(path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw storageFailure(
      'the credential path could not be inspected',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
}

// Ancestors are inspected without following them: no symbolic link, junction or
// other reparse component may redirect the credential, and an uninspectable
// component is a refusal rather than a guess. A missing tail is allowed only
// when the caller is about to create it. The shared owner-only path rule is the
// same one design section 4 applies to the trust publication.
async function assertAncestors(file, { allowMissingTail }) {
  await assertProtectedAncestors(file, {
    allowMissingTail,
    label: 'the credential path',
    fail: credentialPathFailure,
  });
}

async function canonicalExisting(path) {
  try {
    return await realpath(path);
  } catch (cause) {
    throw storageFailure(
      `the credential path ${path} could not be resolved`,
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
}

async function within(resolvedChild, resolvedParent) {
  const prefix = resolvedParent.endsWith(sep) ? resolvedParent : `${resolvedParent}${sep}`;
  return resolvedChild === resolvedParent || resolvedChild.startsWith(prefix);
}

// The destination must live outside product state, the running package, any
// repository worktree and known MCP configuration directories. Ancestors are
// inspected for repository markers only; repository contents are never read and
// the filesystem is never searched for configurations or secrets.
async function assertLocation({ file, stateDir }) {
  if (CONFIGURATION_FILE_NAMES.has(basename(file).toLowerCase())) {
    throw storageFailure(
      'the credential destination is a known configuration file name',
      'PROTECTION_UNVERIFIED',
    );
  }
  const parent = dirname(file);
  const parentInfo = await inspect(parent);
  const resolvedParent = parentInfo === null ? null : await canonicalExisting(parent);
  if (resolvedParent !== null) {
    if (await within(resolvedParent, await canonicalExisting(PACKAGE_ROOT))) {
      throw storageFailure(
        'the credential destination is inside the running package directory',
        'PROTECTION_UNVERIFIED',
      );
    }
    if ((await inspect(stateDir)) !== null) {
      if (await within(resolvedParent, await canonicalExisting(stateDir))) {
        throw storageFailure(
          'the credential destination must be outside the product state directory',
          'PROTECTION_UNVERIFIED',
        );
      }
    }
    for (const configRoot of [
      join(homedir(), '.config', 'opencode'),
      join(homedir(), '.opencode'),
    ]) {
      if ((await inspect(configRoot)) !== null) {
        if (await within(resolvedParent, await canonicalExisting(configRoot))) {
          throw storageFailure(
            'the credential destination is inside a known configuration directory',
            'PROTECTION_UNVERIFIED',
          );
        }
      }
    }
  }
  // Repository markers are inspected on every existing ancestor of the file.
  const { root, rest } = splitPath(file);
  let prefix = root;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    if ((await inspect(prefix)) === null) continue;
    if ((await inspect(join(prefix, '.git'))) !== null) {
      throw storageFailure(
        'the credential destination is inside a repository worktree',
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

// One token line: no BOM, embedded newline, NUL or whitespace. The terminator is
// optional on input and always stored exactly once as LF.
export function parseTokenInput(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw invalidArgument('the Telegram token input is empty');
  }
  if (bytes.length > MAX_TOKEN_INPUT_BYTES) {
    throw invalidArgument('the Telegram token input exceeds the accepted bound');
  }
  let end = bytes.length;
  if (bytes[end - 1] === 0x0a) {
    end -= 1;
    if (end > 0 && bytes[end - 1] === 0x0d) end -= 1;
  }
  if (end === 0 || end > MAX_TOKEN_BYTES) {
    throw invalidArgument('the Telegram token must be 1-4096 ASCII bytes');
  }
  for (let index = 0; index < end; index += 1) {
    const byte = bytes[index];
    if (byte < 0x21 || byte > 0x7e) {
      throw invalidArgument(
        'the Telegram token must contain only non-whitespace ASCII bytes on one line',
      );
    }
  }
  return bytes.subarray(0, end).toString('ascii');
}

// Bounded stdin read: a terminal is refused rather than allowing terminal echo,
// and the whole input must reach EOF inside the finite deadline.
export async function readTokenFromStdin(stream, { timeoutMs = TOKEN_INPUT_TIMEOUT_MS } = {}) {
  if (stream === undefined || stream === null) {
    throw invalidArgument('telegram provision requires token input on stdin');
  }
  if (stream.isTTY === true) {
    throw invalidArgument(
      'telegram provision refuses terminal input; pipe the token from a trusted source',
    );
  }
  const chunks = [];
  let size = 0;
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      stream.destroy?.();
      reject(invalidArgument('the Telegram token input did not reach EOF in time'));
    }, timeoutMs);
  });
  const read = (async () => {
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_TOKEN_INPUT_BYTES) {
          throw invalidArgument('the Telegram token input exceeds the accepted bound');
        }
        chunks.push(chunk);
      }
    } catch (cause) {
      if (cause?.name === 'CliError') throw cause;
      throw invalidArgument('the Telegram token input could not be read');
    }
    return Buffer.concat(chunks);
  })();
  try {
    return parseTokenInput(await Promise.race([read, deadline]));
  } finally {
    clearTimeout(timer);
  }
}

// The operator diagnostic names the fixed classification so the documented exit
// code and failure class are both actionable without printing any content.
function withCode(error) {
  if (
    error?.name === 'CliError' &&
    typeof error.code === 'string' &&
    !error.message.includes(`(${error.code})`)
  ) {
    error.message = `${error.message} (${error.code})`;
  }
  return error;
}

// Creates only missing dedicated credential directories and the new credential
// file. The destination is opened exclusively, protected before the token is
// written, flushed and reverified before provisioning is reported complete.
async function provisionInner({ file, stateDir, token }) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the credential destination must be an absolute path');
  }
  assertWindowsFileCredentialSupported('provision');
  await assertAncestors(file, { allowMissingTail: true });
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
        throw storageFailure('could not create the credential directory', 'STORAGE_FAILURE', cause);
      }
    }
  }

  const parent = dirname(file);
  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');

  let handle;
  try {
    handle = await open(file, 'wx', POSIX_FILE_MODE);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw invalidArgument(
        'the credential destination already exists; choose another dedicated destination (TELEGRAM_CREDENTIAL_EXISTS)',
        'TELEGRAM_CREDENTIAL_EXISTS',
      );
    }
    throw storageFailure('could not create the credential file', 'PROTECTION_UNVERIFIED', cause);
  }

  let created = null;
  try {
    if (posix()) await handle.chmod(POSIX_FILE_MODE);
    created = await handle.stat();
    assertOwnerOnlyFile(created, 'the new credential file');
    await handle.writeFile(`${token}\n`, 'utf8');
    await handle.sync();
    assertOwnerOnlyFile(await handle.stat(), 'the new credential file');
  } catch (cause) {
    await handle.close().catch(() => {});
    // The exclusive create proved this attempt owned the object it opened, but
    // the destination may have been renamed away and replaced since. Remove only
    // the exact object still proven to be this attempt's; preserve a replacement
    // or an uncertain entry and report the incomplete cleanup.
    const removed = await removeExactCreated(file, created);
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(
      removed
        ? 'could not write the credential file'
        : 'could not write the credential file; an object created during provisioning could not be proven safe to remove',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
  await handle.close();

  assertOwnerOnlyFile(await inspect(file), 'the provisioned credential file');
  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');
  return { file };
}

// Broker-only load: path and protection are established, the actual regular-file
// identity is checked before the content read, and both are rechecked before the
// token is returned. No validation-then-following-read shortcut is used.
async function loadInner({ file, stateDir }) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the credential destination must be an absolute path');
  }
  assertWindowsFileCredentialSupported('load');
  if ((await inspect(dirname(file))) === null) {
    throw blockedPrerequisite(
      'the automatic-startup Telegram credential is missing; run "proceed-mcp telegram provision --token-stdin"',
      'TELEGRAM_CREDENTIAL_UNAVAILABLE',
    );
  }
  await assertAncestors(file, { allowMissingTail: false });
  await assertLocation({ file, stateDir });

  const before = await inspect(file);
  if (before === null) {
    throw blockedPrerequisite(
      'the automatic-startup Telegram credential is missing; run "proceed-mcp telegram provision --token-stdin"',
      'TELEGRAM_CREDENTIAL_UNAVAILABLE',
    );
  }
  assertOwnerOnlyFile(before, 'the automatic-startup credential file');
  assertOwnerOnlyDirectory(await inspect(dirname(file)), 'the credential directory');

  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      throw blockedPrerequisite(
        'the automatic-startup Telegram credential is missing; run "proceed-mcp telegram provision --token-stdin"',
        'TELEGRAM_CREDENTIAL_UNAVAILABLE',
      );
    }
    throw storageFailure(
      'the automatic-startup credential could not be opened safely',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }

  let bytes;
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw storageFailure(
        'the automatic-startup credential was replaced while it was being opened',
        'PROTECTION_UNVERIFIED',
      );
    }
    // Validate the actual opened handle before any content access: a pathname
    // check before the open cannot prove the handle that will be read.
    assertOwnerOnlyFile(opened, 'the opened automatic-startup credential file');
    if (opened.size > MAX_TOKEN_INPUT_BYTES) {
      throw blockedPrerequisite(
        'the automatic-startup Telegram credential is malformed; provision it again through a trusted source',
        'TELEGRAM_CREDENTIAL_UNAVAILABLE',
      );
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }

  const after = await inspect(file);
  if (after === null || after.dev !== before.dev || after.ino !== before.ino) {
    throw storageFailure(
      'the automatic-startup credential changed identity while it was read',
      'PROTECTION_UNVERIFIED',
    );
  }
  assertOwnerOnlyFile(after, 'the automatic-startup credential file');

  let token;
  try {
    token = parseTokenInput(bytes);
  } catch {
    throw blockedPrerequisite(
      'the automatic-startup Telegram credential is empty or malformed; provision it again through a trusted source',
      'TELEGRAM_CREDENTIAL_UNAVAILABLE',
    );
  }
  return token;
}

export async function provisionCredentialFile(options) {
  try {
    return await provisionInner(options);
  } catch (error) {
    throw withCode(error);
  }
}

export async function loadCredentialFile(options) {
  try {
    return await loadInner(options);
  } catch (error) {
    throw withCode(error);
  }
}
