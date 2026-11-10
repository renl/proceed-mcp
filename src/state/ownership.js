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
import { dirname } from 'node:path';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { utcTimestamp } from '../util/values.js';
import { assertProtectedAncestors, removeExactCreated } from './path-trust.js';
import { verifyWindowsProtection } from './protection.js';

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

function recordPathFailure(message, cause) {
  return storageFailure(message, 'PROTECTION_UNVERIFIED', cause);
}

// Design section 4 applies section 2's non-redirection and ancestor-protection
// conditions to the protected trust publication and its reads. An unsafe state
// ancestry is refused before any key byte is written or read, and the existing
// ancestors are never repaired or re-permissioned here.
async function assertRecordPath(lockFile, fail) {
  await assertProtectedAncestors(lockFile, {
    allowMissingTail: false,
    label: 'the broker state directory',
    fail,
  });
}

// Creates the ownership record with an exclusive create, so concurrent starts
// against the same directory cannot both acquire it even when they are
// configured with different ports. The record is flushed before the caller
// opens the journal.
export async function acquireStateOwnership({ lockFile, port, channel }) {
  const problem = channelProblem(channel);
  if (problem !== null) throw storageFailure(problem, 'PROTECTION_UNVERIFIED');
  // The secure record carries a secret, so its whole path is trusted before the
  // exclusive create: a redirected or replaceable ancestry refuses first and no
  // record is created at all. Windows admission applies the same rule to the
  // owner, ACL, type and volume evidence of that ancestry.
  if (channel !== undefined) {
    await assertRecordPath(lockFile, recordPathFailure);
    await verifyWindowsProtection([lockFile], {
      allowMissingTail: true,
      fail: () =>
        conflictRecord('the secure broker ownership record cannot be verified as protected'),
    });
  }
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

  let created = null;
  try {
    created = await handle.stat();
    if (channel !== undefined) {
      // The secret key is written only after the record and its directory are
      // verified owner-only, and the empty record this attempt created is
      // admitted before its first byte.
      if (process.platform !== 'win32') await handle.chmod(POSIX_FILE_MODE);
      created = await handle.stat();
      assertOwnerOnlyRecord(created);
      await verifyWindowsProtection([lockFile], {
        fail: () =>
          conflictRecord('the secure broker ownership record cannot be verified as protected'),
      });
    }
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    if (channel !== undefined) {
      assertOwnerOnlyRecord(await handle.stat());
      // Re-observe the flushed record before the key is treated as published.
      await verifyWindowsProtection([lockFile], {
        fail: () =>
          conflictRecord('the secure broker ownership record cannot be verified as protected'),
      });
    }
  } catch (cause) {
    await handle.close().catch(() => {});
    // The exclusive create proved this attempt owned the object it opened, but
    // the destination may have been renamed away and replaced since. Remove only
    // the exact object still proven to be this attempt's; preserve a replacement
    // or an uncertain entry and report the incomplete cleanup.
    const removed = await removeExactCreated(lockFile, created);
    if (cause?.name === 'CliError') throw cause;
    throw storageFailure(
      removed
        ? `could not write the ownership record at ${lockFile}`
        : `could not write the ownership record at ${lockFile}; an object created during acquisition could not be proven safe to remove`,
      removed ? 'STORAGE_FAILURE' : 'PROTECTION_UNVERIFIED',
      cause,
    );
  }
  await handle.close().catch(() => {});

  return {
    lockFile,
    instance,
    contents,
    bytes: Buffer.from(contents),
    // Callers invoke this only after journal activity has stopped. A record that
    // no longer holds these exact bytes, or whose protection can no longer be
    // verified, is preserved untouched.
    async release() {
      try {
        await verifyWindowsProtection([lockFile]);
      } catch {
        // Unverifiable protection is an uncertain release, so the record stays.
        return false;
      }
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
      // Release deletes the record, so its protection is re-observed after the
      // exact-byte comparison and before the removal: a failed recheck leaves
      // the record in place as an uncertain release.
      try {
        await verifyWindowsProtection([lockFile]);
      } catch {
        return false;
      }
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

// The opened trust record must be the protected single-link regular file owned by
// the current account. This runs before the key bytes are read and again through
// the pathname checks before the record is returned.
function assertOpenedRecord(info) {
  if (info.nlink !== 1 || !info.isFile()) {
    throw conflictRecord('the broker ownership record is not one protected regular file');
  }
  if (process.platform === 'win32') return;
  if ((info.mode & 0o777) !== POSIX_FILE_MODE) {
    throw conflictRecord('the broker ownership record is not owner-only');
  }
  if (typeof process.geteuid === 'function' && info.uid !== process.geteuid()) {
    throw conflictRecord('the broker ownership record is not owned by the current account');
  }
}

async function inspectRecordParent(lockFile) {
  try {
    return await lstat(dirname(lockFile));
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw conflictRecord('the broker ownership record cannot be inspected');
  }
}

// Reads the protected ownership record without sending any credential anywhere.
// A schema-1 record is reported as legacy so the caller can refuse with upgrade
// guidance before any connection; a schema-2 record returns its stable bytes so
// a client can compare them again around a handshake and a readiness exchange.
export async function readSecureOwnership(lockFile) {
  // A missing state directory stays "no record" rather than a conflict; an
  // existing but redirected or replaceable ancestry is refused before any record
  // bytes are read (design section 4 applying section 2).
  const parent = await inspectRecordParent(lockFile);
  if (parent === null) return { absent: true };
  await assertRecordPath(lockFile, conflictRecord);

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
  // Windows: the record's owner, ACL, type and volume are admitted before any
  // key byte is opened. A refusal keeps the existing conflict classification so
  // a protected record is never reported as a retryable reachability failure.
  await verifyWindowsProtection([lockFile], {
    fail: () => conflictRecord('the broker ownership record cannot be verified as protected'),
  });

  let bytes;
  try {
    const handle = await open(lockFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MAX_RECORD_BYTES) {
        throw conflictRecord('the broker ownership record changed identity or is too large');
      }
      // The opened handle itself must be the protected single-link regular file
      // before any key content is read: a pathname check cannot prove the object
      // that will be read. A later refusal never stands in for this check.
      assertOpenedRecord(opened);
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
  // The key bytes are private authority only while the object that produced them
  // is still admitted: a failed re-observation discards the read result.
  await verifyWindowsProtection([lockFile], {
    fail: () => conflictRecord('the broker ownership record cannot be verified as protected'),
  });

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
