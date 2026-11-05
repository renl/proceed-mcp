// 03A.1a ONLY: retire/rebind at the authorized consumer switch, not before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import * as config from '../src/config/config.js';
import * as framing from '../src/journal/framing.js';

test('PORT-HELPER-OLD: active config and journal consumers retain schema/format 1', () => {
  assert.equal(config.CONFIG_SCHEMA_VERSION, 1);
  const empty = config.createEmptyConfig();
  assert.equal(empty.schema_version, 1);
  assert.deepEqual(empty.origins, []);
  assert.deepEqual(config.parseConfigDocument(config.serializeConfig(empty)), empty);
  assert.equal(framing.FILE_FORMAT_VERSION, 1);
  assert.equal(framing.RECORD_SCHEMA_VERSION, 1);
  const header = framing.createFileHeader();
  assert.equal(header.readUInt32BE(8), 1);
  assert.deepEqual(framing.readJournal(header), { transactions: [], validLength: 12 });
  const frame = framing.encodeFrame({ sequence: 1, committedAt: '2026-10-31T00:00:00Z',
    mutations: [{ op: 'telegram.cursor', update_id: 1 }] });
  assert.equal(framing.readJournal(Buffer.concat([header, frame])).transactions[0].schema_version, 1);
});

test('PORT-HELPER-UNUSED: no existing production consumer references the additive seams', async () => {
  const root = new URL('../src/', import.meta.url);
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of files.filter(entry => entry.isFile() && entry.name.endsWith('.js'))) {
    if (['portable-config.js', 'owner-credentials.js'].includes(entry.name)) continue;
    const text = await readFile(`${entry.parentPath}/${entry.name}`, 'utf8');
    assert.ok(!/\b(?:portable-config|owner-credentials)\.js\b/.test(text),
      `existing consumer must remain unchanged: ${entry.name}`);
  }
});
