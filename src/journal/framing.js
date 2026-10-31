// Binary framing for the append-only transaction journal (design section 4).
//
// File layout:
//   header   8 bytes magic "PROCEEDJ" + uint32be file format version (1)
//   records  repeated frames
//
// Frame layout (all integers big-endian):
//   0..3    uint32  frame_length   total bytes of this frame, including this field
//   4..7    uint32  payload_length payload bytes (UTF-8 JSON object)
//   8..15   uint64  sequence       monotonic record sequence, starting at 1
//   16..    payload
//   ...    32 bytes SHA-256 over bytes [0, 16 + payload_length)
//
// The trailing digest covers the lengths and the sequence, so a truncated,
// reordered or edited record cannot pass validation. A reader accepts only
// complete frames; the incomplete final frame is discarded on recovery.
import { createHash } from 'node:crypto';

export const FILE_MAGIC = Buffer.from('PROCEEDJ', 'ascii');
export const FILE_FORMAT_VERSION = 1;
export const FILE_HEADER_LENGTH = 12;
export const RECORD_SCHEMA_VERSION = 1;
export const FRAME_PREFIX_LENGTH = 16;
export const DIGEST_LENGTH = 32;
export const MIN_FRAME_LENGTH = FRAME_PREFIX_LENGTH + DIGEST_LENGTH;
export const MAX_PAYLOAD_LENGTH = 1024 * 1024;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

export class JournalFormatError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'JournalFormatError';
    this.code = details.code ?? 'JOURNAL_INVALID';
    this.offset = details.offset;
    this.incomplete = details.incomplete === true;
  }
}

export function createFileHeader() {
  const header = Buffer.alloc(FILE_HEADER_LENGTH);
  FILE_MAGIC.copy(header, 0);
  header.writeUInt32BE(FILE_FORMAT_VERSION, 8);
  return header;
}

export function readFileHeader(buffer) {
  if (buffer.length < FILE_HEADER_LENGTH) {
    throw new JournalFormatError('journal file is shorter than its header', {
      code: 'JOURNAL_HEADER_TRUNCATED',
      incomplete: true,
      offset: 0,
    });
  }
  if (!buffer.subarray(0, 8).equals(FILE_MAGIC)) {
    throw new JournalFormatError('journal file does not start with the expected magic', {
      code: 'JOURNAL_MAGIC_MISMATCH',
      offset: 0,
    });
  }
  const version = buffer.readUInt32BE(8);
  if (version !== FILE_FORMAT_VERSION) {
    throw new JournalFormatError(
      `journal format version ${version} is not supported by this build (${FILE_FORMAT_VERSION})`,
      { code: 'JOURNAL_VERSION_UNSUPPORTED', offset: 8 },
    );
  }
}

// Encodes one committed transaction. `mutations` is the ordered list of
// operations that make up the transaction; the caller has already sampled
// `committedAt` from the broker clock.
export function encodeFrame({ sequence, committedAt, mutations }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new JournalFormatError('journal sequence must be a positive safe integer', {
      code: 'JOURNAL_SEQUENCE_INVALID',
    });
  }
  const payload = Buffer.from(
    JSON.stringify({
      schema_version: RECORD_SCHEMA_VERSION,
      sequence,
      committed_at: committedAt,
      mutations,
    }),
    'utf8',
  );
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new JournalFormatError('journal record payload exceeds the maximum length', {
      code: 'JOURNAL_RECORD_TOO_LARGE',
    });
  }

  const frameLength = FRAME_PREFIX_LENGTH + payload.length + DIGEST_LENGTH;
  const frame = Buffer.alloc(frameLength);
  frame.writeUInt32BE(frameLength, 0);
  frame.writeUInt32BE(payload.length, 4);
  frame.writeBigUInt64BE(BigInt(sequence), 8);
  payload.copy(frame, FRAME_PREFIX_LENGTH);
  const digest = createHash('sha256').update(
    frame.subarray(0, FRAME_PREFIX_LENGTH + payload.length),
  );
  digest.digest().copy(frame, FRAME_PREFIX_LENGTH + payload.length);
  return frame;
}

// Decodes one frame starting at `offset`. A frame that runs past the end of the
// buffer is reported as incomplete (a crash during append), never as corrupt.
export function decodeFrame(buffer, offset) {
  const remaining = buffer.length - offset;
  if (remaining < 4) {
    throw new JournalFormatError('journal frame has an incomplete length prefix', {
      code: 'JOURNAL_FRAME_TRUNCATED',
      incomplete: true,
      offset,
    });
  }
  const frameLength = buffer.readUInt32BE(offset);
  if (
    frameLength < MIN_FRAME_LENGTH ||
    frameLength > FRAME_PREFIX_LENGTH + MAX_PAYLOAD_LENGTH + DIGEST_LENGTH
  ) {
    throw new JournalFormatError(`journal frame length ${frameLength} is out of bounds`, {
      code: 'JOURNAL_FRAME_LENGTH_INVALID',
      offset,
    });
  }
  if (remaining < frameLength) {
    throw new JournalFormatError('journal final frame is incomplete', {
      code: 'JOURNAL_FRAME_TRUNCATED',
      incomplete: true,
      offset,
    });
  }

  const payloadLength = buffer.readUInt32BE(offset + 4);
  if (payloadLength !== frameLength - MIN_FRAME_LENGTH) {
    throw new JournalFormatError('journal frame payload length does not match its frame length', {
      code: 'JOURNAL_PAYLOAD_LENGTH_MISMATCH',
      offset,
    });
  }

  const bodyEnd = offset + FRAME_PREFIX_LENGTH + payloadLength;
  const expected = createHash('sha256').update(buffer.subarray(offset, bodyEnd)).digest();
  if (!expected.equals(buffer.subarray(bodyEnd, bodyEnd + DIGEST_LENGTH))) {
    throw new JournalFormatError('journal frame checksum does not match', {
      code: 'JOURNAL_CHECKSUM_MISMATCH',
      offset,
    });
  }

  let payload;
  try {
    payload = JSON.parse(buffer.subarray(offset + FRAME_PREFIX_LENGTH, bodyEnd).toString('utf8'));
  } catch {
    throw new JournalFormatError('journal frame payload is not valid JSON', {
      code: 'JOURNAL_PAYLOAD_INVALID',
      offset,
    });
  }
  if (payload?.schema_version !== RECORD_SCHEMA_VERSION) {
    throw new JournalFormatError(
      `journal record schema_version ${JSON.stringify(payload?.schema_version)} is not supported`,
      { code: 'JOURNAL_RECORD_VERSION_UNSUPPORTED', offset },
    );
  }

  const sequence = Number(buffer.readBigUInt64BE(offset + 8));
  if (payload.sequence !== sequence) {
    throw new JournalFormatError('journal frame sequence does not match its payload', {
      code: 'JOURNAL_SEQUENCE_MISMATCH',
      offset,
    });
  }
  if (!Array.isArray(payload.mutations) || payload.mutations.length === 0) {
    throw new JournalFormatError('journal record contains no mutations', {
      code: 'JOURNAL_RECORD_EMPTY',
      offset,
    });
  }

  return { record: payload, sequence, nextOffset: offset + frameLength };
}

// Replays every complete record. Returns the applied mutations in commit order
// together with the byte length of valid content, so recovery can truncate an
// incomplete tail instead of leaving garbage before the next append.
export function readJournal(buffer) {
  readFileHeader(buffer);
  const transactions = [];
  let offset = FILE_HEADER_LENGTH;
  let lastSequence = 0;

  while (offset < buffer.length) {
    let decoded;
    try {
      decoded = decodeFrame(buffer, offset);
    } catch (error) {
      // An interrupted append leaves an incomplete final frame; only that tail
      // may be discarded. Any other failure is corruption that stops recovery.
      if (error.incomplete === true) return { transactions, validLength: offset };
      throw error;
    }
    if (decoded.sequence !== lastSequence + 1) {
      throw new JournalFormatError(
        `journal sequence gap: expected ${lastSequence + 1}, found ${decoded.sequence}`,
        { code: 'JOURNAL_SEQUENCE_GAP', offset },
      );
    }
    lastSequence = decoded.sequence;
    offset = decoded.nextOffset;
    transactions.push(decoded.record);
  }

  return { transactions, validLength: offset };
}
