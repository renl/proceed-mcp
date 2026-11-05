// Exclusive state-directory ownership (design section 4). The record is
// created atomically before the journal is opened, and startup never reads,
// replaces, repairs or deletes an existing record: a live, stale, malformed or
// uncertain record all block startup identically. There is no force flag,
// recovery path or PID-based takeover; disposal of a fully run-owned test
// namespace is not operator recovery authority.
import { randomBytes } from 'node:crypto';
import { open, readFile, unlink } from 'node:fs/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { utcTimestamp } from '../util/values.js';

const POSIX_FILE_MODE = 0o600;

// Private identity representation. pid/port/started_at describe the owner for
// diagnostics only; `instance` is what distinguishes this invocation's record
// from any record another invocation may have written.
function formatOwnershipRecord({ pid, port, startedAt, instance }) {
  return `${JSON.stringify({
    schema_version: 1,
    pid,
    port,
    started_at: startedAt,
    instance,
  })}\n`;
}

// Creates the ownership record with an exclusive create, so concurrent starts
// against the same directory cannot both acquire it even when they are
// configured with different ports. The record is flushed before the caller
// opens the journal.
export async function acquireStateOwnership({ lockFile, port }) {
  const contents = formatOwnershipRecord({
    pid: process.pid,
    port,
    startedAt: utcTimestamp(),
    instance: randomBytes(16).toString('hex'),
  });

  let handle;
  try {
    handle = await open(lockFile, 'wx', POSIX_FILE_MODE);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      // Existence alone is enough to refuse; the record is neither read nor
      // evaluated, and its bytes are left exactly as they are.
      throw blockedPrerequisite(
        `another broker may own ${lockFile}; startup never replaces an ownership record and no automatic recovery exists`,
        'STATE_NOT_OWNED',
      );
    }
    throw storageFailure(
      `could not create the ownership record at ${lockFile}`,
      'PROTECTION_UNAVAILABLE',
      cause,
    );
  }

  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => {});
    // The exclusive create succeeded, so this incomplete file is this
    // invocation's own; removing it takes ownership from nobody else.
    await unlink(lockFile).catch(() => {});
    throw storageFailure(
      `could not write the ownership record at ${lockFile}`,
      'STORAGE_FAILURE',
      cause,
    );
  }
  await handle.close().catch(() => {});

  return {
    lockFile,
    contents,
    // Callers invoke this only after journal activity has stopped. A record
    // that no longer holds these exact bytes is preserved untouched.
    async release() {
      let current;
      try {
        current = await readFile(lockFile, 'utf8');
      } catch (cause) {
        if (cause?.code === 'ENOENT') return false;
        throw storageFailure(
          `could not read the ownership record at ${lockFile}`,
          'STORAGE_FAILURE',
          cause,
        );
      }
      if (current !== contents) return false;
      try {
        await unlink(lockFile);
      } catch (cause) {
        if (cause?.code === 'ENOENT') return false;
        throw storageFailure(
          `could not release the ownership record at ${lockFile}`,
          'STORAGE_FAILURE',
          cause,
        );
      }
      return true;
    },
  };
}
