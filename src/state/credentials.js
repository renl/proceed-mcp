// 256-bit random local credentials (control and per-origin). Generated into
// protected files only: never command arguments, configuration, or logs.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';

export const LOCAL_CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;

export function generateCredentialToken() {
  return randomBytes(32).toString('hex');
}

export async function readLocalCredential(file, description = 'local credential') {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      throw blockedPrerequisite(
        `${description} is missing; run the documented setup commands`,
        'CREDENTIAL_MISSING',
      );
    }
    throw storageFailure(`could not read ${description}`, 'STORAGE_FAILURE', cause);
  }
  const value = text.trim();
  if (!LOCAL_CREDENTIAL_PATTERN.test(value)) {
    throw storageFailure(`${description} is not a valid local credential`, 'CREDENTIAL_INVALID');
  }
  return value;
}
