// Empty-state setup operations: `init` and `origin add` (design section 2).
// Neither command starts a service, contacts Telegram, or contacts OpenCode.
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import {
  createEmptyConfig,
  createOriginBinding,
  parseConfigDocument,
  serializeConfig,
  withOrigin,
} from '../config/config.js';
import { blockedPrerequisite, invalidArgument, storageFailure } from '../errors.js';
import { createFileHeader } from '../journal/framing.js';
import { generateCredentialToken } from './credentials.js';
import { writeFileAtomically } from './files.js';
import { createProtectedDirectory, verifyOwnerOnly } from './protection.js';

async function readConfigIfPresent(paths) {
  let text;
  try {
    text = await readFile(paths.configFile, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw storageFailure(`could not read ${paths.configFile}`, 'STORAGE_FAILURE', cause);
  }
  return parseConfigDocument(text);
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

export async function initializeState(paths) {
  if ((await readConfigIfPresent(paths)) !== null) {
    throw invalidArgument(
      `state is already initialized at ${paths.stateDir}; init never overwrites existing state`,
      'STATE_ALREADY_INITIALIZED',
    );
  }

  const existing = await directoryContents(paths.stateDir);
  if (existing !== null && existing.length > 0) {
    throw invalidArgument(
      `${paths.stateDir} already contains files; init never overwrites existing state`,
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
