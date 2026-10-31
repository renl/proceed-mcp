// Durable file replacement for state and credential files. Content is written
// to a sibling temporary file inside the protected directory, flushed, and
// renamed into place, so a reader never observes a partial file.
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { storageFailure } from '../errors.js';

const POSIX_FILE_MODE = 0o600;

export async function writeFileAtomically(path, contents) {
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  let handle;
  try {
    handle = await open(tempPath, 'wx', POSIX_FILE_MODE);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch (cause) {
    await handle?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw storageFailure(`could not write ${path}`, 'STORAGE_FAILURE', cause);
  }

  try {
    await handle.close();
    await rename(tempPath, path);
  } catch (cause) {
    await unlink(tempPath).catch(() => {});
    throw storageFailure(`could not finalize ${path}`, 'STORAGE_FAILURE', cause);
  }
}
