// 256-bit random local credentials (control and per-origin). Generated into
// protected files only: never command arguments, configuration, or logs.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { verifyWindowsProtection } from './protection.js';

export const LOCAL_CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;

export function generateCredentialToken() {
  return randomBytes(32).toString('hex');
}

// Protected read: on Windows the credential and its existing ancestry are
// admitted before the bytes are opened, and the same admission is re-observed
// before the value is returned. A failed recheck discards the result rather than
// handing private authority to the caller.
export async function readLocalCredential(file, description = 'local credential') {
  await verifyWindowsProtection([file], { allowMissingTail: true });
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
  await verifyWindowsProtection([file]);
  const value = text.trim();
  if (!LOCAL_CREDENTIAL_PATTERN.test(value)) {
    throw storageFailure(`${description} is not a valid local credential`, 'CREDENTIAL_INVALID');
  }
  return value;
}
