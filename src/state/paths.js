// State directory resolution: --state-dir, then PROCEED_STATE_DIR, then
// <home>/.proceed-mcp (design section 2). The directory is operator-owned and
// independent of the working repository.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { invalidArgument } from '../errors.js';

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
  return {
    stateDir: dir,
    configFile: join(dir, 'config.json'),
    credentialsDir: join(dir, 'credentials'),
    controlCredentialFile: join(dir, 'credentials', 'control.token'),
    originCredentialFile: (originId) => join(dir, 'credentials', `origin.${originId}.token`),
    brokerLockFile: join(dir, 'broker.lock'),
    journalFile: join(dir, 'journal.log'),
  };
}
