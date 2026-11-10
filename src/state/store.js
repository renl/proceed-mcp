// Empty-state setup operations: `init` and `owner add` (design section 2).
// Neither command starts a service, contacts Telegram, or contacts OpenCode.
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { createOriginBinding, parseConfigDocument, withOrigin } from '../config/config.js';
import {
  createEmptyConfig,
  createOwner,
  parseConfigDocument as parsePortableConfigDocument,
  serializeConfig,
  withOwner,
} from '../config/portable-config.js';
import { blockedPrerequisite, invalidArgument, storageFailure } from '../errors.js';
import { createFileHeader } from '../journal/framing.js';
import { generateCredentialToken } from './credentials.js';
import { writeFileAtomically } from './files.js';
import { writeOwnerCredential } from './owner-credentials.js';
import {
  createProtectedDirectory,
  verifyOwnerOnly,
  verifyWindowsProtection,
} from './protection.js';

async function readConfigText(paths) {
  // Windows: the configuration file and its existing ancestry are admitted
  // before any configuration byte is read, so unsafe storage cannot select
  // authority. A missing configuration is still reported as absent.
  await verifyWindowsProtection([paths.configFile], { allowMissingTail: true });
  try {
    return await readFile(paths.configFile, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw storageFailure(`could not read ${paths.configFile}`, 'STORAGE_FAILURE', cause);
  }
}

// The schema-1 readers below still serve the broker, pairing, status, retry and
// MCP consumers until their own authorized switch. A schema-2 document is
// refused rather than reinterpreted, so no legacy consumer silently reads
// portable state (design Migration Plan 5).
async function readConfigIfPresent(paths) {
  const text = await readConfigText(paths);
  return text === null ? null : parseConfigDocument(text);
}

async function readPortableConfigIfPresent(paths) {
  const text = await readConfigText(paths);
  return text === null ? null : parsePortableConfigDocument(text);
}

// Read access for commands that need an existing configuration.
export async function loadConfiguration(paths) {
  const config = await readConfigIfPresent(paths);
  if (config === null) {
    throw blockedPrerequisite(
      `no configuration at ${paths.configFile}; run "proceed-mcp init" first`,
      'STATE_NOT_INITIALIZED',
    );
  }
  return config;
}

// Portable schema-2 read access for the setup commands switched by this
// checkpoint (init, owner add).
export async function loadPortableConfiguration(paths) {
  const config = await readPortableConfigIfPresent(paths);
  if (config === null) {
    throw blockedPrerequisite(
      `no configuration at ${paths.configFile}; run "proceed-mcp init" first`,
      'STATE_NOT_INITIALIZED',
    );
  }
  return config;
}

async function directoryContents(directory) {
  try {
    return await readdir(directory);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw storageFailure(`could not inspect ${directory}`, 'STORAGE_FAILURE', cause);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause?.code === 'EPERM';
  }
}

// A stopped broker is required before an origin binding is added: a running
// broker owns the configuration it already loaded.
async function assertBrokerStopped(paths) {
  // The record may carry the channel key, so Windows admission precedes its
  // content read; a missing record is an ordinary "no broker" answer.
  await verifyWindowsProtection([paths.brokerLockFile], { allowMissingTail: true });
  let raw;
  try {
    raw = await readFile(paths.brokerLockFile, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return;
    throw storageFailure(`could not read ${paths.brokerLockFile}`, 'STORAGE_FAILURE', cause);
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (cause) {
    throw storageFailure(
      'broker.lock is not valid JSON; a broker may be running with damaged ownership state',
      'BROKER_STATE_CORRUPT',
      cause,
    );
  }

  if (Number.isInteger(record?.pid) && record.pid > 0 && processIsAlive(record.pid)) {
    throw blockedPrerequisite(
      `a broker is running for this state directory (pid ${record.pid}); stop it before adding an origin`,
      'BROKER_RUNNING',
    );
  }
}

// Design section 2 owner-add stopped-state prerequisite: any existing
// broker.lock record blocks the mutation, including a stale, malformed, empty or
// unreadable one. Only an inability to establish existence or absence is a
// storage failure, and refusing never needs the record content, so this asks
// only whether the entry exists: no PID probe, deletion, force or recovery.
async function assertBrokerOwnershipAbsent(paths) {
  try {
    await stat(paths.brokerLockFile);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return;
    throw storageFailure(
      `could not establish whether ${paths.brokerLockFile} exists; owner setup needs a definite answer`,
      'BROKER_STATE_UNKNOWN',
      cause,
    );
  }
  throw blockedPrerequisite(
    `${paths.brokerLockFile} exists, so this state directory may belong to a running broker; stop the broker and keep that record before adding an owner`,
    'BROKER_STATE_PRESENT',
  );
}

export async function initializeState(paths) {
  // Windows: the state directory is admitted (a missing tail is this attempt's
  // creation) before its contents are inspected. Emptiness is established
  // before any existing configuration is parsed, and nothing is repaired.
  await verifyWindowsProtection([paths.stateDir], { allowMissingTail: true });

  const existing = await directoryContents(paths.stateDir);
  if (existing !== null && existing.length > 0) {
    throw invalidArgument(
      `${paths.stateDir} already contains files; init never overwrites existing state`,
      'STATE_ALREADY_INITIALIZED',
    );
  }

  if ((await readPortableConfigIfPresent(paths)) !== null) {
    throw invalidArgument(
      `state is already initialized at ${paths.stateDir}; init never overwrites existing state`,
      'STATE_ALREADY_INITIALIZED',
    );
  }

  const createdStateDir = existing === null;
  const writtenFiles = [];

  try {
    await createProtectedDirectory(paths.stateDir);
    await createProtectedDirectory(paths.credentialsDir, { inheritsProtection: true });

    const config = createEmptyConfig();
    await writeFileAtomically(paths.controlCredentialFile, `${generateCredentialToken()}\n`);
    writtenFiles.push(paths.controlCredentialFile);
    await writeFileAtomically(paths.journalFile, createFileHeader());
    writtenFiles.push(paths.journalFile);
    await writeFileAtomically(paths.configFile, serializeConfig(config));
    writtenFiles.push(paths.configFile);

    await verifyOwnerOnly([
      paths.stateDir,
      paths.credentialsDir,
      paths.controlCredentialFile,
      paths.journalFile,
      paths.configFile,
    ]);
    return { stateDir: paths.stateDir, config, controlCredentialFile: paths.controlCredentialFile };
  } catch (error) {
    await rollbackInitialization(paths, writtenFiles, createdStateDir);
    throw error;
  }
}

// A failed init must not leave an unprotected credential behind.
async function rollbackInitialization(paths, writtenFiles, createdStateDir) {
  for (const file of writtenFiles) {
    await rm(file, { force: true }).catch(() => {});
  }
  if (createdStateDir) {
    await rm(paths.stateDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function addOrigin(paths, { originId, url, passwordEnv }) {
  const origin = createOriginBinding({ originId, url, passwordEnv });

  const config = await readConfigIfPresent(paths);
  if (config === null) {
    throw blockedPrerequisite(
      `no configuration at ${paths.configFile}; run "proceed-mcp init" first`,
      'STATE_NOT_INITIALIZED',
    );
  }

  const nextConfig = withOrigin(config, origin);
  await assertBrokerStopped(paths);
  await verifyOwnerOnly([paths.stateDir, paths.credentialsDir, paths.configFile]);

  const originCredentialFile = paths.originCredentialFile(origin.origin_id);
  if ((await stat(originCredentialFile).catch(() => null)) !== null) {
    throw invalidArgument(
      `credential file ${originCredentialFile} already exists; bindings are immutable`,
      'ORIGIN_ALREADY_CONFIGURED',
    );
  }

  await writeFileAtomically(originCredentialFile, `${generateCredentialToken()}\n`);
  await writeFileAtomically(paths.configFile, serializeConfig(nextConfig));
  await verifyOwnerOnly([
    paths.stateDir,
    paths.credentialsDir,
    paths.configFile,
    originCredentialFile,
  ]);

  return { origin, originCredentialFile };
}

// Owner addition (design section 2): an immutable transport principal plus its
// own protected 256-bit credential. Identifiers and labels are validated, and a
// repeated owner_id is refused, before any state is touched; the record and the
// credential then commit together or not at all, and no token leaves its file.
export async function addOwner(paths, { ownerId, label }) {
  const config = await loadPortableConfiguration(paths);
  const owner = createOwner({ ownerId, label });
  const nextConfig = withOwner(config, owner);
  await assertBrokerOwnershipAbsent(paths);
  await verifyOwnerOnly([paths.stateDir, paths.credentialsDir, paths.configFile]);

  const ownerCredentialFile = paths.ownerCredentialFile(owner.owner_id);
  const created = await writeOwnerCredential(ownerCredentialFile);
  try {
    await writeFileAtomically(paths.configFile, serializeConfig(nextConfig));
  } catch (error) {
    // The owner record never committed, so the credential this call created
    // names no principal: remove it rather than leave an unrecorded secret.
    await rm(created.file, { force: true }).catch(() => {});
    throw error;
  }
  await verifyOwnerOnly([
    paths.stateDir,
    paths.credentialsDir,
    paths.configFile,
    ownerCredentialFile,
  ]);

  return { owner, ownerCredentialFile };
}
