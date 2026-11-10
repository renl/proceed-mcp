// Durable file replacement for state and credential files. Content is written
// to a sibling temporary file inside the protected directory, flushed, and
// renamed into place, so a reader never observes a partial file.
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { storageFailure } from '../errors.js';
import { posix } from './path-trust.js';
import { verifyWindowsProtection } from './protection.js';

const POSIX_FILE_MODE = 0o600;

export async function writeFileAtomically(path, contents) {
  // The destination directory must already be admitted on Windows before a new
  // sibling is created, and the new empty sibling is admitted before any secret
  // byte is written into it.
  await verifyWindowsProtection([dirname(path)]);
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  let handle;
  try {
    handle = await open(tempPath, 'wx', POSIX_FILE_MODE);
    await verifyWindowsProtection([tempPath]);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    // Re-observe the flushed sibling before it is published over the destination.
    await verifyWindowsProtection([tempPath]);
  } catch (cause) {
    await handle?.close().catch(() => {});
    if (posix()) await unlink(tempPath).catch(() => {});
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(`could not write ${path}`, 'STORAGE_FAILURE', cause);
  }

  try {
    await handle.close();
    await rename(tempPath, path);
    // The published destination is re-observed before a caller treats it as
    // usable durable state; a failed recheck discards the result.
    await verifyWindowsProtection([path]);
  } catch (cause) {
    if (posix()) await unlink(tempPath).catch(() => {});
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(`could not finalize ${path}`, 'STORAGE_FAILURE', cause);
  }
}
