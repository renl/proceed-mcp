// Release-policy record readers: read-only parsing of the acceptance record at
// release/evidence/<version>.json and the configuration record at
// release/configuration.json. Absence, unparseable content and a non-object
// payload are reported as states, never thrown, so the evaluator turns them into
// blockers. An existing path that cannot be read for any other reason raises
// RECORD_UNREADABLE. These readers never validate the record schema: shape and
// tiering belong to the evaluator, and the readers add no collector-only fact.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReleasePolicyError, isObject, isRepoRelative, isText } from './release-policy-schema.mjs';

// Absent record -> the caller's absence state. Any other read failure ->
// RECORD_UNREADABLE. Invalid JSON or a non-object -> malformed.
async function readRecord(path, absentState) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { state: absentState, record: null };
    throw new ReleasePolicyError('RECORD_UNREADABLE', 'record path is not readable');
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { state: 'malformed', record: null };
  }
  if (!isObject(record)) return { state: 'malformed', record: null };
  return { state: 'present', record };
}

export async function readAcceptanceRecord({ root, version } = {}) {
  if (!isText(root) || !isText(version) || !isRepoRelative(`release/evidence/${version}.json`)) {
    throw new ReleasePolicyError('RECORD_UNREADABLE', 'acceptance record path');
  }
  return readRecord(join(root, 'release', 'evidence', `${version}.json`), 'missing');
}

// The declared configuration state selects the returned state, so an
// unrecognised value can never reach the evaluator as a verified record.
export async function readConfigurationRecord({ root } = {}) {
  if (!isText(root)) throw new ReleasePolicyError('RECORD_UNREADABLE', 'configuration record path');
  const read = await readRecord(join(root, 'release', 'configuration.json'), 'unknown');
  if (read.state !== 'present') return read;
  const { state } = read.record;
  if (state !== 'verified' && state !== 'unconfigured' && state !== 'unknown') {
    return { state: 'malformed', record: null };
  }
  return { state, record: read.record };
}
