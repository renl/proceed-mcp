// Durable file replacement for state and credential files. Content is written
// to a sibling temporary file inside the destination directory, flushed, and
// renamed into place, so a reader never observes a partial file.
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { storageFailure } from '../errors.js';
import { posix } from './path-trust.js';
import { verifyStorageIdentity, verifyStorageObject } from './protection.js';

const POSIX_FILE_MODE = 0o600;

// Returns the identity of the published object so a caller can later remove only
// the file this attempt created.
export async function writeFileAtomically(path, contents) {
  const description = `the replacement file for ${path}`;
  // The destination directory must be a real directory with a contiguous,
  // unredirected ancestry before a new sibling is created.
  await verifyStorageObject(dirname(path), {
    expected: 'directory',
    description: `the destination directory of ${path}`,
  });
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  let handle;
  let created = null;
  try {
    handle = await open(tempPath, 'wx', POSIX_FILE_MODE);
    created = await handle.stat();
    // The new empty sibling is admitted as one regular file before any content
    // byte is written into it.
    await verifyStorageObject(tempPath, { expected: 'file', description });
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    // Re-observe the flushed sibling before it is published over the destination.
    await verifyStorageIdentity(tempPath, created, { expected: 'file', description });
  } catch (cause) {
    await handle?.close().catch(() => {});
    if (posix()) await unlink(tempPath).catch(() => {});
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(`could not write ${path}`, 'STORAGE_FAILURE', cause);
  }

  try {
    await handle.close();
    await rename(tempPath, path);
    // The published destination must still be the object this attempt wrote
    // before a caller treats it as usable durable state; a failed recheck
    // discards the result and never deletes the observed replacement.
    await verifyStorageIdentity(path, created, { expected: 'file', description });
  } catch (cause) {
    if (posix()) await unlink(tempPath).catch(() => {});
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(`could not finalize ${path}`, 'STORAGE_FAILURE', cause);
  }
  return created;
}
