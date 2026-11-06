// Exclusive state-directory ownership (design sections 2-4). The record is
// created atomically before the journal is opened, and startup never reads,
// replaces, repairs or deletes an existing record: a live, stale, malformed or
// uncertain record all block startup identically. There is no force flag,
// recovery path or PID-based takeover; disposal of a fully run-owned test
// namespace is not operator recovery authority.
//
// Secure local mode publishes a per-instance random channel key only inside this
// exclusively created record. The schema-1 record stays exactly as it was for
// legacy foreground serving, which gains no key publication.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { utcTimestamp } from '../util/values.js';

const POSIX_FILE_MODE = 0o600;
const CHANNEL_PROTOCOL = 'tls-psk-v1';
const CHANNEL_KEY_PATTERN = /^[a-f0-9]{64}$/;
const INSTANCE_PATTERN = /^[a-f0-9]{32}$/;
const MAX_RECORD_BYTES = 4096;

function formatOwnershipRecord({ pid, port, startedAt, instance, channel }) {
  const record = {
    schema_version: channel === undefined ? 1 : 2,
    pid,
    port,
    started_at: startedAt,
    instance,
  };
  if (channel !== undefined) {
    record.channel = { protocol: channel.protocol, psk: channel.psk };
  }
  return `${JSON.stringify(record)}\n`;
}

function channelProblem(channel) {
  if (channel === undefined) return null;
  if (channel === null || typeof channel !== 'object') return 'the channel must be an object';
  if (channel.protocol !== CHANNEL_PROTOCOL) return 'the channel protocol is not supported';
  if (typeof channel.psk !== 'string' || !CHANNEL_KEY_PATTERN.test(channel.psk)) {
    return 'the channel key must be 64 lowercase hexadecimal characters';
  }
  return null;
}

function assertOwnerOnlyRecord(info) {
  if (info.nlink !== 1 || !info.isFile() || info.isSymbolicLink()) {
    throw storageFailure('the ownership record is not one regular file', 'PROTECTION_UNVERIFIED');
  }
  if (process.platform === 'win32') return;
  if ((info.mode & 0o777) !== POSIX_FILE_MODE) {
    throw storageFailure('the ownership record is not owner-only', 'PROTECTION_UNVERIFIED');
  }
  if (typeof process.geteuid === 'function' && info.uid !== process.geteuid()) {
    throw storageFailure(
      'the ownership record is not owned by the current account',
      'PROTECTION_UNVERIFIED',
    );
  }
}

// Creates the ownership record with an exclusive create, so concurrent starts
// against the same directory cannot both acquire it even when they are
// configured with different ports. The record is flushed before the caller
// opens the journal.
export async function acquireStateOwnership({ lockFile, port, channel }) {
  const problem = channelProblem(channel);
  if (problem !== null) throw storageFailure(problem, 'PROTECTION_UNVERIFIED');
  const instance = randomBytes(16).toString('hex');
  const contents = formatOwnershipRecord({
    pid: process.pid,
    port,
    startedAt: utcTimestamp(),
    instance,
    channel,
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
    if (channel !== undefined) {
      // The secret key is written only after the record and its directory are
      // verified owner-only, and the complete record is flushed before return.
      if (process.platform !== 'win32') await handle.chmod(POSIX_FILE_MODE);
      assertOwnerOnlyRecord(await handle.stat());
    }
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    if (channel !== undefined) assertOwnerOnlyRecord(await handle.stat());
  } catch (cause) {
    await handle.close().catch(() => {});
    // The exclusive create succeeded, so this incomplete file is this
    // invocation's own; removing it takes ownership from nobody else.
    await unlink(lockFile).catch(() => {});
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(
      `could not write the ownership record at ${lockFile}`,
      'STORAGE_FAILURE',
      cause,
    );
  }
  await handle.close().catch(() => {});

  return {
    lockFile,
    instance,
    contents,
    bytes: Buffer.from(contents),
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

function conflictRecord(message) {
  return blockedPrerequisite(message, 'BROKER_INSTANCE_CONFLICT');
}

// Reads the protected ownership record without sending any credential anywhere.
// A schema-1 record is reported as legacy so the caller can refuse with upgrade
// guidance before any connection; a schema-2 record returns its stable bytes so
// a client can compare them again around a handshake and a readiness exchange.
export async function readSecureOwnership(lockFile) {
  let info;
  try {
    info = await lstat(lockFile);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return { absent: true };
    throw conflictRecord('the broker ownership record cannot be inspected');
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw conflictRecord('the broker ownership record is not a regular file');
  }
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw conflictRecord('the broker ownership record is not protected');
  }

  let bytes;
  try {
    const handle = await open(lockFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MAX_RECORD_BYTES) {
        throw conflictRecord('the broker ownership record changed identity or is too large');
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close().catch(() => {});
    }
  } catch (cause) {
    if (cause?.name === 'CliError') throw cause;
    if (cause?.code === 'ENOENT') return { absent: true };
    throw conflictRecord('the broker ownership record cannot be read');
  }
  if (bytes.length > MAX_RECORD_BYTES) {
    throw conflictRecord('the broker ownership record is too large');
  }

  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw conflictRecord('the broker ownership record is not valid JSON');
  }
  if (record?.schema_version === 1) {
    return { schemaVersion: 1, bytes, path: lockFile };
  }
  if (record?.schema_version !== 2) {
    throw conflictRecord('the broker ownership record declares an unsupported schema');
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== 'channel' ||
    keys[1] !== 'instance' ||
    keys[2] !== 'pid' ||
    keys[3] !== 'port' ||
    keys[4] !== 'schema_version' ||
    keys[5] !== 'started_at'
  ) {
    throw conflictRecord('the broker ownership record does not have the supported shape');
  }
  const channelKeys = Object.keys(record.channel ?? {}).sort();
  if (channelKeys.length !== 2 || channelKeys[0] !== 'protocol' || channelKeys[1] !== 'psk') {
    throw conflictRecord('the broker channel publication is not supported');
  }
  if (
    record.channel.protocol !== CHANNEL_PROTOCOL ||
    !CHANNEL_KEY_PATTERN.test(record.channel.psk)
  ) {
    throw conflictRecord('the broker channel publication is not supported');
  }
  if (!INSTANCE_PATTERN.test(record.instance)) {
    throw conflictRecord('the broker instance identity is malformed');
  }
  if (!Number.isInteger(record.pid) || record.pid <= 0) {
    throw conflictRecord('the broker process identity is malformed');
  }
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535) {
    throw conflictRecord('the broker port is malformed');
  }
  if (typeof record.started_at !== 'string') {
    throw conflictRecord('the broker start time is malformed');
  }
  return { ...record, schemaVersion: 2, bytes, path: lockFile };
}
