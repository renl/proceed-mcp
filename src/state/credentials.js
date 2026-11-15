// 256-bit random local credentials (control and per-origin). Generated into
// dedicated files only: never command arguments, configuration, or logs.
import { randomBytes } from 'node:crypto';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { readStorageFile } from './protection.js';

export const LOCAL_CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;

export function generateCredentialToken() {
  return randomBytes(32).toString('hex');
}

// Ordinary read: on Windows the credential and its existing ancestry are
// observed before the bytes are opened, the opened handle is compared with that
// observation, and the path is re-observed before the value is returned, so a
// failed observation discards the result rather than handing private authority
// to the caller. POSIX keeps its existing plain read.
export async function readLocalCredential(file, description = 'local credential') {
  const bytes = await readStorageFile(file, {
    description: `the ${description}`,
    fail: (message, cause) => storageFailure(message, 'STORAGE_FAILURE', cause),
  });
  if (bytes === null) {
    throw blockedPrerequisite(
      `${description} is missing; run the documented setup commands`,
      'CREDENTIAL_MISSING',
    );
  }
  const value = bytes.toString('utf8').trim();
  if (!LOCAL_CREDENTIAL_PATTERN.test(value)) {
    throw storageFailure(`${description} is not a valid local credential`, 'CREDENTIAL_INVALID');
  }
  return value;
}
