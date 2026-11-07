// Durable append-only journal (design section 4). The broker is the only
// writer: one process opens the file for append, writes one framed record per
// transaction and awaits a file flush before the caller may acknowledge or
// perform any external effect. Replay discards only an incomplete final frame.
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { storageFailure } from '../errors.js';
import { utcTimestamp } from '../util/values.js';
import {
  FILE_FORMAT_VERSION,
  HARNESS_FILE_FORMAT_VERSION,
  HARNESS_RECORD_SCHEMA_VERSION,
  JournalFormatError,
  createFileHeader,
  encodeFrame,
  readJournal,
  recordSchemaFor,
} from './framing.js';

const POSIX_FILE_MODE = 0o600;

export class Journal {
  #handle;

  #sequence;

  #formatVersion;

  #closed = false;

  constructor(filePath, handle, sequence, formatVersion) {
    this.filePath = filePath;
    this.#handle = handle;
    this.#sequence = sequence;
    this.#formatVersion = formatVersion;
  }

  static async open(filePath) {
    let handle;
    try {
      handle = await open(filePath, 'a', POSIX_FILE_MODE);
    } catch (cause) {
      throw storageFailure(`could not open the journal at ${filePath}`, 'STORAGE_FAILURE', cause);
    }

    const journal = new Journal(filePath, handle, 0, FILE_FORMAT_VERSION);
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

  get formatVersion() {
    return this.#formatVersion;
  }

  // Reads and validates every committed record, returning the mutations in
  // commit order. The file is created with its header when it does not exist.
  // The recovered sequence is acknowledged only after the handle has actually
  // been flushed: an unconfirmed flush is an uncertain storage state, so it is
  // refused instead of reported as a usable tail.
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

    // Durability boundary of recovery: the valid history is only reported once
    // the underlying handle has flushed it. A failure here leaves the previous
    // sequence untouched, so no recovered sequence is acknowledged from an
    // unconfirmed file, and no caller may treat the tail as ready.
    try {
      await this.#handle.sync();
    } catch (cause) {
      throw storageFailure(
        `could not confirm the journal at ${this.filePath} is durable`,
        'STORAGE_FAILURE',
        cause,
      );
    }

    this.#sequence = result.transactions.length;
    this.#formatVersion = result.formatVersion;
    return {
      transactions: result.transactions,
      validLength: result.validLength,
      fileBytes: buffer.length,
      formatVersion: result.formatVersion,
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
    const frame = encodeFrame({
      sequence,
      committedAt,
      mutations,
      schemaVersion: recordSchemaFor(this.#formatVersion),
    });
    await this.#writeAndFlush(frame);
    this.#sequence = sequence;
    return { sequence, committedAt, bytes: frame.length };
  }

  // Raises this history to the harness-capable format before the first harness
  // record is committed (design section 2). The rewrite is durable and
  // failure-safe: a completely written and flushed replacement is renamed over
  // the old file, so a crash leaves either the recoverable old history or the
  // complete new one, never two writable histories. Existing records keep their
  // exact committed bytes and meaning; only the declared format and schema rise.
  async ensureHarnessFormat() {
    if (this.#closed) throw storageFailure('the journal is closed', 'STORAGE_FAILURE');
    if (this.#formatVersion === HARNESS_FILE_FORMAT_VERSION) return false;

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

    let parsed;
    try {
      parsed = readJournal(buffer);
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
    if (parsed.formatVersion === HARNESS_FILE_FORMAT_VERSION) {
      this.#formatVersion = HARNESS_FILE_FORMAT_VERSION;
      return false;
    }
    if (buffer.length !== parsed.validLength) {
      throw storageFailure(
        'the journal must be reopened to remove an unrepaired incomplete final record before upgrade',
        'STORAGE_FAILURE',
      );
    }

    // Re-encoding must be one declared schema for the whole file. Sequence
    // numbers, commit instants and mutations are carried over exactly.
    const rewritten = Buffer.concat([
      createFileHeader(HARNESS_FILE_FORMAT_VERSION),
      ...parsed.transactions.map((transaction) =>
        encodeFrame({
          sequence: transaction.sequence,
          committedAt: transaction.committed_at,
          mutations: transaction.mutations,
          schemaVersion: HARNESS_RECORD_SCHEMA_VERSION,
        }),
      ),
    ]);

    const temporary = `${this.filePath}.upgrade`;
    let tempHandle;
    try {
      await unlink(temporary).catch((cause) => {
        if (cause?.code !== 'ENOENT') throw cause;
      });
      tempHandle = await open(temporary, 'wx', POSIX_FILE_MODE);
      let written = 0;
      while (written < rewritten.length) {
        const { bytesWritten } = await tempHandle.write(
          rewritten,
          written,
          rewritten.length - written,
        );
        if (bytesWritten <= 0) throw new Error('journal upgrade write made no progress');
        written += bytesWritten;
      }
      await tempHandle.sync();
      const created = await tempHandle.stat();
      if (created.size !== rewritten.length) {
        throw new Error('journal upgrade replacement length mismatch');
      }
      await tempHandle.close();
      tempHandle = null;
    } catch (cause) {
      await tempHandle?.close().catch(() => {});
      throw storageFailure(
        'could not write the harness-capable journal replacement',
        'STORAGE_FAILURE',
        cause,
      );
    }

    // The old append handle must not hold the destination while it is replaced.
    await this.#handle.close().catch(() => {});
    this.#handle = null;
    try {
      await rename(temporary, this.filePath);
      await syncDirectory(dirname(this.filePath));
    } catch (cause) {
      // The replacement never became the history; reopen the original so this
      // instance can still report the concrete failure without a second writer.
      try {
        this.#handle = await open(this.filePath, 'a', POSIX_FILE_MODE);
      } catch {
        this.#handle = null;
      }
      throw storageFailure(
        'could not install the harness-capable journal',
        'STORAGE_FAILURE',
        cause,
      );
    }

    try {
      this.#handle = await open(this.filePath, 'a', POSIX_FILE_MODE);
    } catch (cause) {
      // The complete version-3 history is already installed; the next ordinary
      // open reads it. This instance reports the uncertain handle only.
      throw storageFailure(
        'the harness-capable journal could not be reopened',
        'STORAGE_FAILURE',
        cause,
      );
    }
    this.#formatVersion = HARNESS_FILE_FORMAT_VERSION;
    return true;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle?.close().catch(() => {});
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
