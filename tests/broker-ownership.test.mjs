// SPIKE-OWNERSHIP-001: active design sections 4/7; public CLI, offline only.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded } from './support/managed-spike.mjs';
import { guards, completed, stopped, freePort } from './support/startup-guards.mjs';

const record = (pid) => `${JSON.stringify({ schema_version: 1, pid,
  port: 1, started_at: '2026-01-01T00:00:00.000Z' })}\n`;
for (const [name, bytes] of [
  ['live different-port owner', record(process.pid)],
  ['stale owner', record(2147483647)],
  ['stale owner with incomplete tail', record(2147483647)],
  ['malformed owner', '{not-json\n'],
  ['unreadable owner', 'READ_DENIED'],
]) {
  test(`OWN-REFUSE: ${name} is preserved before journal recovery`, () => guards(
    async ({ state, start }) => {
      const lock = join(state, 'broker.lock');
      const journal = join(state, 'journal.log');
      await writeFile(lock, bytes, { mode: 0o600 });
      // Recovery would either initialize empty bytes or truncate this tail.
      const beforeJournal = name.includes('tail')
        ? Buffer.concat([await readFile(journal), Buffer.from([0])]) : Buffer.alloc(0);
      await writeFile(journal, beforeJournal);
      const child = await start();
      // Current defective startup may become ready; stop it without a timeout.
      await bounded(async () => {
        while (!child.closed && !child.events.some((event) => event.kind === 'broker-ready')) {
          await delay(10);
        }
      }, 8000, 'startup must refuse or reach readiness');
      if (child.events.some((event) => event.kind === 'broker-ready')) await stopped(child);
      const exit = await completed(child);
      const afterLock = await readFile(lock).catch(() => null);
      const afterJournal = await readFile(journal);
      // Existence-only refusal need not attempt a read. If it does read,
      // injected EACCES may instead surface as storage failure (design 4).
      assert.ok((name === 'unreadable owner' ? [3, 4] : [3]).includes(exit),
        `ownership refusal exits 3 (or 4 for an encountered read failure), received ${exit}`);
      assert.deepEqual({ lockPreserved: afterLock?.equals(Buffer.from(bytes)) ?? false,
        journalPreserved: afterJournal.equals(beforeJournal),
        recoveryOpened: child.events.some((event) => event.kind === 'journal-open') },
      { lockPreserved: true,
        journalPreserved: true, recoveryOpened: false });
    }));
}

test('OWN-ORDER: acquire before journal open; release own record after graceful stop', () => guards(
  async ({ state, start }) => {
    const child = await start();
    await child.wait('broker-ready');
    const observations = child.events.filter((event) => event.kind === 'journal-open');
    await access(join(state, 'broker.lock'));
    await stopped(child);
    await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
    assert.ok(observations.length > 0, 'observer reached actual journal open');
    assert.ok(observations.every((event) => event.ownerPresent),
      'ownership must exist before any journal recovery/open');
  }));

test('OWN-ASSEMBLY: corrupt journal never deletes another owner record', () => guards(
  async ({ state, start }) => {
    const lock = join(state, 'broker.lock');
    const journal = join(state, 'journal.log');
    const bytes = record(process.pid);
    await writeFile(lock, bytes, { mode: 0o600 });
    const corrupt = Buffer.from('not a journal');
    await writeFile(journal, corrupt);
    const child = await start();
    await completed(child);
    assert.deepEqual(await readFile(journal), corrupt);
    assert.equal(await readFile(lock, 'utf8').catch(() => null), bytes,
      'partial assembly must not release ownership it never acquired');
  }));

test('OWN-REPLACED: shutdown preserves a record no longer demonstrably its own', () => guards(
  async ({ state, start }) => {
    const child = await start();
    await child.wait('broker-ready');
    const replacement = record(process.pid);
    await writeFile(join(state, 'broker.lock'), replacement);
    await stopped(child);
    assert.equal(await readFile(join(state, 'broker.lock'), 'utf8').catch(() => null), replacement);
  }));

test('OWN-CONCURRENT: another port cannot acquire the running broker state', () => guards(
  async ({ state, config, save, start }) => {
    const owner = await start();
    await owner.wait('broker-ready');
    const before = await readFile(join(state, 'broker.lock'));
    const journal = await readFile(join(state, 'journal.log'));
    config.broker.port = await freePort();
    await save();
    const contender = await start();
    assert.equal(await completed(contender), 3);
    assert.deepEqual(await readFile(join(state, 'broker.lock')).catch(() => null), before,
      'contender refusal must not delete the running owner record');
    assert.deepEqual(await readFile(join(state, 'journal.log')), journal);
    await stopped(owner);
  }));

test('OWN-FAILED-OWN: assembly failure releases only its own newly acquired record', () => guards(
  async ({ state, start }) => {
    await writeFile(join(state, 'journal.log'), 'invalid journal');
    const child = await start();
    assert.equal(await completed(child), 4);
    await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
  }));
