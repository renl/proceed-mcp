// Broker-only automatic-startup Telegram credential (design sections 1-3).
//
// One explicitly provisioned owner-only file outside every repository, product
// state, package installation and MCP configuration. Provisioning is create-only:
// it never reads, overwrites, truncates or repairs an existing destination, and it
// removes only objects it can still prove it created. Loading verifies the path,
// the actual file identity and the protection before the content is read, then
// rechecks identity, ancestry and protection before the token is used.
//
// Both supported platforms persist this file. POSIX verifies owner-only mode bits
// and protected ancestry; Windows reuses the shared metadata-only admission in
// `protection.js` and requires an already safe dedicated parent with account-only
// full-access inheritance. This is same-account protection, not encryption or
// isolation from other processes running as the same account. Storage whose checks
// cannot be established fails closed.
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
import {
  createProtectedDirectory,
  verifyWindowsInheritableDirectory,
  verifyWindowsProspectiveDirectory,
  verifyWindowsProtection,
} from './protection.js';

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

const MISSING_CREDENTIAL_GUIDANCE =
  'run "proceed-mcp telegram provision" in a trusted terminal, or provision it explicitly from a nonterminal source';
const MALFORMED_CREDENTIAL_GUIDANCE =
  'provision it again through a trusted source; never write it by hand';

function credentialPathFailure(message, cause) {
  return storageFailure(message, 'PROTECTION_UNVERIFIED', cause);
}

// The collision classification is the documented exit-2 outcome: the destination
// is never opened, compared or replaced.
function credentialExists() {
  return invalidArgument(
    'the credential destination already exists; choose another dedicated destination (TELEGRAM_CREDENTIAL_EXISTS)',
    'TELEGRAM_CREDENTIAL_EXISTS',
  );
}

function missingCredential() {
  return blockedPrerequisite(
    `the automatic-startup Telegram credential is missing; ${MISSING_CREDENTIAL_GUIDANCE} (TELEGRAM_CREDENTIAL_UNAVAILABLE)`,
    'TELEGRAM_CREDENTIAL_UNAVAILABLE',
  );
}

function malformedCredential() {
  return blockedPrerequisite(
    `the automatic-startup Telegram credential is empty or malformed; ${MALFORMED_CREDENTIAL_GUIDANCE} (TELEGRAM_CREDENTIAL_UNAVAILABLE)`,
    'TELEGRAM_CREDENTIAL_UNAVAILABLE',
  );
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

// Complete normalized components of one absolute path, including components that
// do not exist yet. Windows comparison is case- and separator-insensitive; POSIX
// comparison is exact. This is the platform normalization the design requires,
// not a prefix test on raw text.
function pathComponents(value) {
  const { root } = parse(value);
  const parts = String(value)
    .slice(root.length)
    .split(/[\\/]/)
    .filter((part) => part !== '');
  const normalize = (part) => (posix() ? part : part.toLowerCase());
  return [normalize(root), ...parts.map(normalize)];
}

function withinComponents(child, parent) {
  if (child.length < parent.length) return false;
  return parent.every((part, index) => part === child[index]);
}

// The running package root plus the conservative npm layout containers derived
// from its own absolute physical path (design decision 2). No npm subprocess,
// configuration scan, prefix variable or working directory is consulted, and no
// prefix is invented when no `node_modules` ancestor is observable.
function installationContainers() {
  const components = pathComponents(PACKAGE_ROOT);
  const containers = [components];
  for (let index = 1; index < components.length; index += 1) {
    if (components[index] !== 'node_modules') continue;
    const parentEnd = index - 1;
    // Every `node_modules` parent and all its descendants.
    containers.push(components.slice(0, parentEnd + 1));
    // The documented npm global layout nests `node_modules` under `lib`. A local
    // project named `lib` is indistinguishable from it, so both plausible
    // containers are excluded without guessing which install mode was used.
    if (posix() && parentEnd >= 1 && components[parentEnd] === 'lib') {
      containers.push(components.slice(0, parentEnd));
    }
  }
  return containers;
}

// The destination must live outside product state, the running package and every
// installation container derived from it, and known MCP configuration
// directories. The whole destination decides this, including a tail that does not
// exist yet. Ancestors are inspected for repository markers only; repository
// contents are never read and the filesystem is never searched for configurations
// or secrets.
async function assertLocation({ file, stateDir }) {
  if (CONFIGURATION_FILE_NAMES.has(basename(file).toLowerCase())) {
    throw storageFailure(
      'the credential destination is a known configuration file name',
      'PROTECTION_UNVERIFIED',
    );
  }
  const destination = pathComponents(file);
  for (const container of installationContainers()) {
    if (!withinComponents(destination, container)) continue;
    throw storageFailure(
      'the credential destination is inside an npm installation or the running package directory; choose a dedicated directory outside every installation being replaced',
      'PROTECTION_UNVERIFIED',
    );
  }
  if (withinComponents(destination, pathComponents(stateDir))) {
    throw storageFailure(
      'the credential destination must be outside the product state directory',
      'PROTECTION_UNVERIFIED',
    );
  }
  const configRoots = [join(homedir(), '.config', 'opencode'), join(homedir(), '.opencode')];
  for (const configRoot of configRoots) {
    if (!withinComponents(destination, pathComponents(configRoot))) continue;
    throw storageFailure(
      'the credential destination is inside a known configuration directory',
      'PROTECTION_UNVERIFIED',
    );
  }

  // Existing ancestors are additionally resolved, so a redirect cannot hide one
  // of these locations behind another spelling.
  const parentInfo = await inspect(dirname(file));
  const resolvedParent = parentInfo === null ? null : await canonicalExisting(dirname(file));
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
    for (const configRoot of configRoots) {
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

// The exclusive create proves which object this attempt opened. That identity is
// retained and compared with the destination afterwards, so a pathname renamed
// away and replaced by another regular, equally protected file is refused rather
// than reported as this attempt's completed provision. A missing or uninspectable
// destination is equally uncertain. This is a repeated-snapshot check, not a
// native handle pin.
function assertCreatedIdentity(info, created) {
  if (info === null || info.dev !== created.dev || info.ino !== created.ino) {
    throw storageFailure(
      'the credential destination no longer resolves to the object this attempt created',
      'PROTECTION_UNVERIFIED',
    );
  }
}

// Shared Windows admission, applied at the same points as the POSIX owner-only
// checks: before a secret is written or read, and again before success is
// reported. No helper receives the token.
async function admitWindowsProtection(targets, { allowMissingTail = false } = {}) {
  if (posix()) return;
  await verifyWindowsProtection(targets, { allowMissingTail });
}

// A credential file that is not yet created must arrive in a directory that
// passes account-only full access to children. This is the shared inheritance
// policy, not a new one, and it never repairs an unsafe parent.
async function admitWindowsCredentialParent(directory) {
  if (posix()) return;
  await verifyWindowsInheritableDirectory(directory);
}

// A dedicated credential directory that does not exist yet is admitted through
// its existing ancestry before any secret is supplied, so an unavailable query or
// an inheritance that would reach another account refuses before either input
// mode. This observes only; the creation attempt still admits the parent it
// actually uses.
async function admitWindowsCredentialTail(directory) {
  if (posix()) return;
  await verifyWindowsProspectiveDirectory(directory);
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

// Everything that must hold before the operator supplies a secret: absolute
// syntax, safe ancestry, destination separation, destination absence, and the
// protection this attempt is not allowed to change. Nothing here reads or writes
// credential content. A missing dedicated parent is admitted through its existing
// ancestry and safe-inheritance rule rather than skipped, so an unavailable or
// unsafe Windows chain refuses before either input mode.
async function verifyProvisioningInner({ file, stateDir }) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the credential destination must be an absolute path');
  }
  await assertAncestors(file, { allowMissingTail: true });
  await assertLocation({ file, stateDir });
  if ((await inspect(file)) !== null) throw credentialExists();
  const parent = dirname(file);
  const parentInfo = await inspect(parent);
  if (parentInfo === null) {
    await admitWindowsCredentialTail(parent);
    return { file, parent };
  }
  assertOwnerOnlyDirectory(parentInfo, 'the credential directory');
  await admitWindowsCredentialParent(parent);
  return { file, parent };
}

// Public preflight for the operator command: the same prerequisite checks run
// again inside provisioning, before the token is written.
export async function verifyCredentialProvisioning({ file, stateDir }) {
  try {
    return await verifyProvisioningInner({ file, stateDir });
  } catch (error) {
    throw withCode(error);
  }
}

// Missing dedicated directories are created one component at a time under
// admitted parents and admitted before the next component is descended into. An
// existing directory is never re-permissioned.
async function createCredentialDirectory(directory) {
  if (!posix()) {
    await createProtectedDirectory(directory, { inheritsProtection: true });
    return;
  }
  try {
    await mkdir(directory, { mode: POSIX_DIRECTORY_MODE });
  } catch (cause) {
    if (cause?.code !== 'EEXIST') {
      throw storageFailure('could not create the credential directory', 'STORAGE_FAILURE', cause);
    }
  }
  assertOwnerOnlyDirectory(await inspect(directory), 'the credential directory');
}

// Creates only missing dedicated credential directories and the new credential
// file. The destination is opened exclusively, protected before the token is
// written, flushed and reverified before provisioning is reported complete.
async function provisionInner({ file, stateDir, token }) {
  const { parent } = await verifyProvisioningInner({ file, stateDir });

  const { root, rest } = splitPath(file);
  let prefix = root;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    if ((await inspect(prefix)) !== null) continue;
    await createCredentialDirectory(prefix);
  }

  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');

  let handle;
  try {
    handle = await open(file, 'wx', POSIX_FILE_MODE);
  } catch (cause) {
    if (cause?.code === 'EEXIST') throw credentialExists();
    throw storageFailure('could not create the credential file', 'PROTECTION_UNVERIFIED', cause);
  }

  let created = null;
  try {
    if (posix()) await handle.chmod(POSIX_FILE_MODE);
    created = await handle.stat();
    assertOwnerOnlyFile(created, 'the new credential file');
    // Protection is established before the token is written, so no secret reaches
    // an object this attempt has not admitted.
    await admitWindowsProtection([parent, file]);
    await handle.writeFile(`${token}\n`, 'utf8');
    await handle.sync();
    // Flushed and revalidated before success is reported: a changed identity,
    // ancestry or protection is a failure, not a completed provision.
    assertOwnerOnlyFile(await handle.stat(), 'the new credential file');
    assertCreatedIdentity(await inspect(file), created);
    assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');
    await assertAncestors(file, { allowMissingTail: false });
    await admitWindowsProtection([parent, file]);
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

  // The destination is checked once more after the handle is released: the
  // reported success names this attempt's object, not a later replacement.
  const provisioned = await inspect(file);
  assertCreatedIdentity(provisioned, created);
  assertOwnerOnlyFile(provisioned, 'the provisioned credential file');
  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');
  return { file };
}

// Content access is bounded by the accepted input bound. The earlier size
// observation is only an observation, so the read itself is bounded and one byte
// beyond the bound is probed rather than trusted to a reported length.
async function readBoundedContent(handle) {
  const buffer = Buffer.allocUnsafe(MAX_TOKEN_INPUT_BYTES);
  const { bytesRead } = await handle.read(buffer, 0, MAX_TOKEN_INPUT_BYTES, 0);
  if (bytesRead === MAX_TOKEN_INPUT_BYTES) {
    const beyond = Buffer.allocUnsafe(1);
    const more = await handle.read(beyond, 0, 1, MAX_TOKEN_INPUT_BYTES);
    if (more.bytesRead > 0) throw malformedCredential();
  }
  return buffer.subarray(0, bytesRead);
}

// Broker-only load: path and protection are established, the actual regular-file
// identity is checked before the content read, and identity, ancestry and
// protection are rechecked before the token is returned. No
// validation-then-following-read shortcut is used.
async function loadInner({ file, stateDir }) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the credential destination must be an absolute path');
  }
  const parent = dirname(file);
  if ((await inspect(parent)) === null) throw missingCredential();
  await assertAncestors(file, { allowMissingTail: false });
  await assertLocation({ file, stateDir });

  const before = await inspect(file);
  if (before === null) throw missingCredential();
  assertOwnerOnlyFile(before, 'the automatic-startup credential file');
  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');
  // A directory that cannot pass account-only full access to its children is not
  // a dedicated credential directory, even though this attempt only reads.
  await admitWindowsCredentialParent(parent);
  await admitWindowsProtection([parent, file]);

  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === 'ENOENT') throw missingCredential();
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
    if (opened.size > MAX_TOKEN_INPUT_BYTES) throw malformedCredential();
    bytes = await readBoundedContent(handle);
  } finally {
    await handle.close().catch(() => {});
  }

  // Post-access revalidation: a changed identity, kind, ancestry or protection
  // discards the loaded value instead of releasing it to broker startup.
  const after = await inspect(file);
  if (after === null || after.dev !== before.dev || after.ino !== before.ino) {
    throw storageFailure(
      'the automatic-startup credential changed identity while it was read',
      'PROTECTION_UNVERIFIED',
    );
  }
  assertOwnerOnlyFile(after, 'the automatic-startup credential file');
  assertOwnerOnlyDirectory(await inspect(parent), 'the credential directory');
  await assertAncestors(file, { allowMissingTail: false });
  await admitWindowsProtection([parent, file]);

  try {
    return parseTokenInput(bytes);
  } catch {
    throw malformedCredential();
  }
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
