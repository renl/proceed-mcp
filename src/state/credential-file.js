// Broker-only automatic-startup Telegram credential (design sections 1-3).
//
// One explicitly provisioned ordinary plaintext file outside every repository,
// product state, package installation and MCP configuration. Provisioning is
// create-only: it never reads, overwrites, truncates or repairs an existing
// destination, and it removes only objects it can still prove it created. Loading
// checks the path and the actual file identity before the content is read, then
// rechecks identity and ancestry before the token is used.
//
// This file is deliberately not protected storage. Both platforms use ordinary
// filesystem I/O: no owner, mode, ACL, inheritance, filesystem-type or fixed
// volume admission is queried, required or repaired, and creation uses ordinary
// OS defaults. Anyone whose OS access permits reading the file can obtain the
// token. What remains here is I/O integrity and non-replacement only: a
// contiguous non-redirected directory chain, storage separation, exclusive
// creation, handle/path identity, write-flush completion, bounded reads and
// cleanup limited to objects this attempt can still prove it created. Approval
// state, journals, owner/control/operator credentials and channel keys keep the
// shared admission in `protection.js` and `path-trust.js`; this caller no longer
// reaches it (design decision 4).
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockedPrerequisite, invalidArgument, storageFailure } from '../errors.js';
import { posix, removeExactCreated, splitPath, windowsAbsolutePathProblem } from './path-trust.js';

export const CREDENTIAL_DIRECTORY_NAME = '.proceed-mcp-credentials';
export const CREDENTIAL_FILE_NAME = 'telegram.token';
// One nonempty line of 1-4096 ASCII non-whitespace bytes, optionally ending in
// one LF or CRLF. A longer input is refused rather than truncated.
export const MAX_TOKEN_BYTES = 4096;
export const MAX_TOKEN_INPUT_BYTES = 4098;
export const TOKEN_INPUT_TIMEOUT_MS = 60000;

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
// when the caller is about to create it. Ownership, mode bits, ACLs and
// inheritance are not admission for this file (design decision 1), so only
// non-redirection and the directory type are retained here.
async function assertAncestors(file, { allowMissingTail }) {
  const { root, rest } = splitPath(file);
  let prefix = root;
  let missingFrom = null;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    const info = await inspect(prefix);
    if (info === null) {
      if (!allowMissingTail) {
        throw credentialPathFailure(
          'the credential path does not resolve to one existing directory chain',
        );
      }
      missingFrom ??= prefix;
      continue;
    }
    if (missingFrom !== null) {
      // An existing entry below a missing parent is not this attempt's object.
      throw credentialPathFailure(
        'the credential path does not resolve to one contiguous directory chain',
      );
    }
    if (info.isSymbolicLink()) {
      throw credentialPathFailure('the credential path contains a symbolic link or reparse point');
    }
    if (!info.isDirectory()) {
      throw credentialPathFailure('the credential path has a non-directory ancestor');
    }
  }
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

// The deepest ancestor of `directory` that already exists, resolved to its
// physical path. A destination whose own parent does not exist yet still belongs
// to the resolved ancestor that exists today, so a not-yet-created tail cannot
// escape the separation rule or hide behind another spelling of a forbidden
// location.
async function resolvedExistingAncestor(directory) {
  let current = directory;
  for (;;) {
    if ((await inspect(current)) !== null) return canonicalExisting(current);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
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

  // Existing ancestry is additionally resolved, so a redirect cannot hide one of
  // these locations behind another spelling, and a destination below directories
  // that do not exist yet is still judged by the ancestor that does exist.
  const resolvedParent = await resolvedExistingAncestor(dirname(file));
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

// Ordinary object type only: the credential is a regular, non-redirected file and
// its dedicated parent is a real directory. Ownership, link count and mode are not
// admission (design decisions 1 and 3), so they are not inspected here.
function assertRegularFile(info, description) {
  if (info === null || !info.isFile() || info.isSymbolicLink()) {
    throw storageFailure(`${description} is not a regular file`, 'PROTECTION_UNVERIFIED');
  }
}

function assertDirectoryEntry(info, description) {
  if (info === null || !info.isDirectory() || info.isSymbolicLink()) {
    throw storageFailure(`${description} is not a directory`, 'PROTECTION_UNVERIFIED');
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
// syntax, one non-redirected directory chain, destination separation and
// destination absence. Nothing here reads or writes credential content, and no
// owner, mode, ACL or inheritance admission is consulted (design decisions 1-3).
async function verifyProvisioningInner({ file, stateDir }) {
  if (!isAbsolute(file)) {
    throw invalidArgument('the credential destination must be an absolute path');
  }
  await assertAncestors(file, { allowMissingTail: true });
  await assertLocation({ file, stateDir });
  if ((await inspect(file)) !== null) throw credentialExists();
  return { file, parent: dirname(file) };
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

// Missing dedicated directories are created one component at a time with ordinary
// OS creation defaults: no token-specific mode is requested and an existing
// directory is never re-permissioned or repaired.
async function createCredentialDirectory(directory) {
  try {
    await mkdir(directory);
  } catch (cause) {
    if (cause?.code !== 'EEXIST') {
      throw storageFailure('could not create the credential directory', 'STORAGE_FAILURE', cause);
    }
  }
}

// Creates only missing dedicated credential directories and the new credential
// file. The destination is opened exclusively, written, flushed and reverified
// before provisioning is reported complete.
async function provisionInner({ file, stateDir, token }) {
  const { parent } = await verifyProvisioningInner({ file, stateDir });

  const { root, rest } = splitPath(file);
  let prefix = root;
  for (const part of rest.slice(0, -1)) {
    prefix = join(prefix, part);
    if ((await inspect(prefix)) !== null) continue;
    await createCredentialDirectory(prefix);
  }

  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (cause) {
    if (cause?.code === 'EEXIST') throw credentialExists();
    throw storageFailure('could not create the credential file', 'PROTECTION_UNVERIFIED', cause);
  }

  let created = null;
  try {
    created = await handle.stat();
    assertRegularFile(created, 'the new credential file');
    await handle.writeFile(`${token}\n`, 'utf8');
    await handle.sync();
    // Flushed and revalidated before success is reported: a changed identity,
    // object type or ancestry is a failure, not a completed provision.
    assertRegularFile(await handle.stat(), 'the new credential file');
    assertCreatedIdentity(await inspect(file), created);
    assertDirectoryEntry(await inspect(parent), 'the credential directory');
    await assertAncestors(file, { allowMissingTail: false });
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
  assertRegularFile(provisioned, 'the provisioned credential file');
  assertDirectoryEntry(await inspect(parent), 'the credential directory');
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

// Broker-only load: the path and the actual regular-file identity are checked
// before the content read, and identity and ancestry are rechecked before the
// token is returned. No validation-then-following-read shortcut is used, and no
// permission-protection snapshot is taken (design decision 3).
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
  assertRegularFile(before, 'the automatic-startup credential file');
  assertDirectoryEntry(await inspect(parent), 'the credential directory');

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
    assertRegularFile(opened, 'the opened automatic-startup credential file');
    if (opened.size > MAX_TOKEN_INPUT_BYTES) throw malformedCredential();
    bytes = await readBoundedContent(handle);
  } finally {
    await handle.close().catch(() => {});
  }

  // Post-access revalidation: a changed identity, kind or ancestry discards the
  // loaded value instead of releasing it to broker startup.
  const after = await inspect(file);
  if (after === null || after.dev !== before.dev || after.ino !== before.ino) {
    throw storageFailure(
      'the automatic-startup credential changed identity while it was read',
      'PROTECTION_UNVERIFIED',
    );
  }
  assertRegularFile(after, 'the automatic-startup credential file');
  assertDirectoryEntry(await inspect(parent), 'the credential directory');
  await assertAncestors(file, { allowMissingTail: false });

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
