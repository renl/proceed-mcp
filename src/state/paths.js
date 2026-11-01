// State directory resolution: --state-dir, then PROCEED_STATE_DIR, then
// <home>/.proceed-mcp (design section 2). The directory is operator-owned and
// independent of the working repository.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { invalidArgument } from '../errors.js';
import { ownerCredentialPath } from './owner-credentials.js';

export const DEFAULT_STATE_DIR_NAME = '.proceed-mcp';

export function resolveStateDir({ option, env = process.env, home = homedir() } = {}) {
  const chosen = option ?? env.PROCEED_STATE_DIR ?? join(home, DEFAULT_STATE_DIR_NAME);
  if (typeof chosen !== 'string' || chosen.trim() === '') {
    throw invalidArgument('state directory must be a non-empty path');
  }
  return resolve(chosen);
}

export function statePaths(stateDir) {
  const dir = resolve(stateDir);
  const credentialsDir = join(dir, 'credentials');
  return {
    stateDir: dir,
    configFile: join(dir, 'config.json'),
    credentialsDir,
    controlCredentialFile: join(credentialsDir, 'control.token'),
    originCredentialFile: (originId) => join(credentialsDir, `origin.${originId}.token`),
    // Derived from the validated owner record only: a caller-supplied path, id
    // shape or label never selects a credential file (design section 2).
    ownerCredentialFile: (ownerId) => ownerCredentialPath(credentialsDir, ownerId),
    brokerLockFile: join(dir, 'broker.lock'),
    journalFile: join(dir, 'journal.log'),
  };
}
