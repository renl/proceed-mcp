// Owner transport-principal credentials (design section 2). Each owner gets an
// independent 256-bit random token in its own protected file, named from the
// validated owner record rather than supplied by a tool or a model argument.
// Additive for the portable owner model; the authorized consumer switch wires
// creation into setup and reads into the MCP adapter.
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { invalidArgument, storageFailure } from '../errors.js';
import { generateCredentialToken, readLocalCredential } from './credentials.js';
import { validateOwnerId } from '../config/portable-config.js';

export const OWNER_CREDENTIAL_PREFIX = 'owner.';
export const OWNER_CREDENTIAL_SUFFIX = '.token';

const POSIX_FILE_MODE = 0o600;

export function ownerCredentialFileName(ownerId) {
  return `${OWNER_CREDENTIAL_PREFIX}${validateOwnerId(ownerId)}${OWNER_CREDENTIAL_SUFFIX}`;
}

// The directory is explicit so the caller decides which protected credentials
// directory applies; only the file name is derived from the owner record.
export function ownerCredentialPath(credentialsDir, ownerId) {
  return join(credentialsDir, ownerCredentialFileName(ownerId));
}

// An existing credential file is never replaced, so a repeated owner setup
// leaves the original bytes untouched. The token stays in the file: the caller
// receives the path only, and the value never enters a result, argument or log.
export async function writeOwnerCredential(file) {
  let handle;
  try {
    handle = await open(file, 'wx', POSIX_FILE_MODE);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw invalidArgument(
        `the owner credential file ${file} already exists; owner credentials are immutable`,
        'OWNER_ALREADY_CONFIGURED',
      );
    }
    throw storageFailure(
      `could not create the owner credential file ${file}`,
      'STORAGE_FAILURE',
      cause,
    );
  }

  try {
    await handle.writeFile(`${generateCredentialToken()}\n`, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (cause) {
    await handle.close().catch(() => {});
    // Remove the partial file this call created so a retry starts clean; the
    // exclusive create above guarantees it was not a pre-existing credential.
    await unlink(file).catch(() => {});
    throw storageFailure(
      `could not write the owner credential file ${file}`,
      'STORAGE_FAILURE',
      cause,
    );
  }

  return { file };
}

// Read failures stay distinguishable and redacted: a missing file is a blocked
// prerequisite, a malformed file is integrity loss, and neither message repeats
// the file contents.
export async function readOwnerCredential(file, ownerId) {
  const owner = typeof ownerId === 'string' && ownerId !== '' ? ownerId : 'unknown';
  return readLocalCredential(file, `the credential for owner ${owner}`);
}
