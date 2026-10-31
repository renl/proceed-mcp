// Durable append-only journal (design section 4). The broker is the only
// writer: one process opens the file for append, writes one framed record per
// transaction and awaits a file flush before the caller may acknowledge or
// perform any external effect. Replay discards only an incomplete final frame.
import { open, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { storageFailure } from '../errors.js';
import { utcTimestamp } from '../util/values.js';
import { JournalFormatError, createFileHeader, encodeFrame, readJournal } from './framing.js';

const POSIX_FILE_MODE = 0o600;

export class Journal {
  #handle;

  #sequence;

  #closed = false;

  constructor(filePath, handle, sequence) {
    this.filePath = filePath;
    this.#handle = handle;
    this.#sequence = sequence;
  }

  static async open(filePath) {
    let handle;
    try {
      handle = await open(filePath, 'a', POSIX_FILE_MODE);
    } catch (cause) {
      throw storageFailure(`could not open the journal at ${filePath}`, 'STORAGE_FAILURE', cause);
    }

    const journal = new Journal(filePath, handle, 0);
    try {
      const { validLength } = await journal.recover();
      await journal.#truncateTail(validLength);
    } catch (error) {
      await journal.close().catch(() => {});
      throw error;
    }
    return journal;
  }

  get sequence() {
    return this.#sequence;
  }

  // Reads and validates every committed record, returning the mutations in
  // commit order. The file is created with its header when it does not exist.
  async recover() {
    let buffer;
    try {
      buffer = await readFile(this.filePath);
    } catch (cause) {
      throw storageFailure(
        `could not read the journal at ${this.filePath}`,
        'STORAGE_FAILURE',
        cause,
      );
    }

    if (buffer.length === 0) {
      const header = createFileHeader();
      await this.#writeAndFlush(header);
      buffer = header;
    }

    let result;
    try {
      result = readJournal(buffer);
    } catch (error) {
      if (error instanceof JournalFormatError) {
        throw storageFailure(
          `journal integrity failure: ${error.message}`,
          error.code ?? 'JOURNAL_INVALID',
          error,
        );
      }
      throw error;
    }

    this.#sequence = result.transactions.length;
    return {
      transactions: result.transactions,
      validLength: result.validLength,
      fileBytes: buffer.length,
    };
  }

  // Commits one transaction. The returned promise resolves only after the file
  // flush completes; the caller performs effects afterwards, never before.
  async append(mutations, { committedAt = utcTimestamp() } = {}) {
    if (this.#closed) throw storageFailure('the journal is closed', 'STORAGE_FAILURE');
    if (!Array.isArray(mutations) || mutations.length === 0) {
      throw storageFailure('a journal transaction needs at least one mutation', 'STORAGE_FAILURE');
    }

    const sequence = this.#sequence + 1;
    const frame = encodeFrame({ sequence, committedAt, mutations });
    await this.#writeAndFlush(frame);
    this.#sequence = sequence;
    return { sequence, committedAt, bytes: frame.length };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close().catch(() => {});
  }

  async #writeAndFlush(buffer) {
    try {
      let written = 0;
      while (written < buffer.length) {
        const { bytesWritten } = await this.#handle.write(buffer, written, buffer.length - written);
        if (bytesWritten <= 0) throw new Error('journal write made no progress');
        written += bytesWritten;
      }
      // File flush, not a page-cache write: this is the durability boundary a
      // test observer may intercept to prove commit-before-effect ordering.
      await this.#handle.sync();
    } catch (cause) {
      throw storageFailure('could not commit a journal record', 'STORAGE_FAILURE', cause);
    }
  }

  // Removes the incomplete tail left by an interrupted append so the next
  // record starts at a frame boundary. Only a shorter-than-file length is
  // truncated; a longer one would mean the file changed underneath us. A
  // dedicated read/write handle is used because an append-only handle cannot
  // truncate the file on Windows.
  async #truncateTail(validLength) {
    const info = await stat(this.filePath).catch(() => null);
    if (info === null || info.size <= validLength) return;
    let handle;
    try {
      handle = await open(this.filePath, 'r+', POSIX_FILE_MODE);
      await handle.truncate(validLength);
      await handle.sync();
      await syncDirectory(dirname(this.filePath));
    } catch (cause) {
      throw storageFailure(
        'could not remove an incomplete journal tail during recovery',
        'STORAGE_FAILURE',
        cause,
      );
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}

// Best-effort directory flush so a newly created journal is durable. Windows
// cannot flush a directory handle; the failure is not treated as data loss.
export async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  try {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory flush is unavailable on this filesystem; the file flush stands.
  }
}
