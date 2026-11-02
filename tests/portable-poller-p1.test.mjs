// TEST ONLY: design 5 C1 + research 3 (Bot API 10.3). Fake transport is NOT Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, open, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import https from 'node:https';
import { createPortableBroker } from '../src/broker/portable.js';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createTelegramClient, TelegramError } from '../src/telegram/client.js';
import { bounded } from './support/managed-spike.mjs';
const code = '0123456789abcdef'.repeat(2), opts = { timeout: 15000 };
const messages = ['Paired. Approval requests are not available in this setup stage yet.',
  'Pairing was not accepted. Ask the operator for a fresh code.',
  'To pair, ask the operator for a pairing code. Send /pair <code> here before it expires.',
  'You are paired with this local broker. Approval requests are not available in this setup stage yet.'];
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const tick = () => new Promise(r => setImmediate(r));
const update = (id, text = `/pair ${code}`, from = { id: 71, is_bot: false }, chat = { id: 81, type: 'private' }) =>
  ({ update_id: id, message: { from, chat, text } });
const waitAbort = signal => new Promise((_, reject) => {
  const abort = () => reject(new TelegramError('CANCELLED', 'stopped'));
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
// Maintained real-file runner: 12s aggregate, 9s setup/assertions, 3s teardown.
async function native(work, load = true) {
  const factory = load ? (await import('../src/telegram/portable-poller.js')).createPortableTelegramPoller : null;
  const root = resolve('.scratch/c1-poller-p1'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  const phase = value => writeFile(join(dir, 'progress.json'), JSON.stringify({ phase: value }));
  let j, b, file, poller, sync = async () => {}; const releases = [], calls = [], logs = [], queue = [];
  const cleanup = new AbortController(), waiting = signal => waitAbort(AbortSignal.any([cleanup.signal, ...(signal ? [signal] : [])]));
  const rows = async () => readJournal(await readFile(path)).transactions.map(t => t.mutations);
  const telegram = { async updates(offset, { signal } = {}) { calls.push(['poll', offset, signal]);
      assert.ok(signal instanceof AbortSignal); if (queue.length) { const value = queue.shift(); if (value instanceof Error) throw value; return value; }
      return waiting(signal); },
    async sendMessage(payload, { signal } = {}) { calls.push(['send', payload, signal, await rows()]); return { message_id: 1 }; },
    async answerCallbackQuery(payload, { signal } = {}) { calls.push(['ack', payload, signal, await rows()]); return true; } };
  const h = { calls, logs, queue, telegram, rows, get b() { return b; }, get poller() { return poller; },
    waiting, defer: release => releases.push(release),
    fault() { sync = async () => { throw new Error(`sensitive ${code}`); }; },
    hold() { const entered = gate(), release = gate(); releases.push(release.release);
      sync = async () => { entered.release(); await release.promise; };
      return { entered: () => bounded(() => entered.promise, 1000, 'actual flush gate'), release: () => { sync = async () => {}; release.release(); } }; },
    start() { poller = factory({ broker: b, telegram, logger: (...a) => logs.push(a) }); poller.start(); poller.start(); },
    async until(check) { const deadline = performance.now() + 1500;
      while (!await check()) { assert.ok(performance.now() < deadline, 'poller observable deadline'); await tick(); } } };
  let assertionError, cleanupError;
  try { await bounded(async () => { await phase('setup'); j = await Journal.open(path); await j.close(); file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await sync(); await file.sync(); }, close: () => file.close() }, 0);
    b = createPortableBroker({ journal: j, owners: [], port: 43189, clock: () => Date.parse('2026-11-02T00:00:00Z'), generatePairingCode: () => code });
    await b.recover(); await b.pairingChallenge(); await phase('assertions'); await work(h);
  }, 9000, 'setup/assertion deadline'); } catch (e) { assertionError = e; }
  finally { try { await bounded(async () => { for (const release of releases) release(); sync = async () => {};
    cleanup.abort();
    await phase('teardown'); await poller?.stop(); await b?.close(); await j?.close(); await file?.close().catch(() => {});
    await rm(dir, { recursive: true }); await assert.rejects(access(dir), { code: 'ENOENT' });
  }, 3000, 'cleanup deadline'); } catch (e) { cleanupError = e; } }
  assert.ifError(cleanupError); assert.ifError(assertionError);
}
test('C1P-CAL: real core producer/Journal held flush, installation and durable reopen', opts, () => native(async h => {
  const hold = h.hold(); const p = h.b.completePairing({ code, userId: '71', chatId: '81', updateId: 7 });
  try { await hold.entered(); assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null); }
  finally { hold.release(); } assert.deepEqual(await p, { paired: true });
  await h.b.recover(); assert.equal(h.b.pairing().chat_id, '81'); assert.equal(h.b.telegramCursor(), 7);
}, false));
test('C1P-ORDER: sorted serial atomic pairing, no early send/offset, stale skip, gap and no second cursor', opts, () => native(async h => {
  h.queue.push([update(12, '/start'), update(7), update(7)]); const hold = h.hold(); h.start();
  try { await hold.entered(); await tick(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1], null); assert.equal(h.b.pairing(), null); }
  finally { hold.release(); }
  await h.until(() => h.calls.filter(c => c[0] === 'poll').length === 2);
  assert.deepEqual((await h.rows()).map(r => r.map(m => m.op)), [['pairing.challenge'], ['pairing.challenge.consume', 'pairing.set', 'telegram.cursor'], ['telegram.cursor']]);
  assert.deepEqual(h.calls.filter(c => c[0] === 'send').map(c => [c[1].chat_id, c[1].text]), [['81', messages[0]], ['81', messages[3]]]);
  assert.equal(h.calls.at(-1)[1], 13); assert.equal(h.b.pairing().user_id, '71');
  assert.ok(h.calls.filter(c => c[0] === 'send').every(c => c[2] instanceof AbortSignal && c[3].length >= 2));
  const stop = h.poller.stop(); assert.equal(h.poller.stop(), stop); await stop; h.poller.start(); await tick(); assert.equal(h.calls.length, 4);
}));
test('C1P-SILENT: raw identity/grammar refusals are cursor-only and spend no quota', opts, () => native(async h => {
  const invalid = [undefined, true, 0, 'false']; let id = 0;
  const batch = invalid.map(is_bot => update(++id, undefined, { id: 71, is_bot }));
  for (const value of [undefined, '71', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    batch.push(update(++id, undefined, { id: value, is_bot: false })); batch.push(update(++id, undefined, undefined, { id: value, type: 'private' })); }
  for (const text of [`/pair  ${code}`, `/pair ${code} x`, `/pair@bot ${code}`, `/pair ${code.toUpperCase()}`, `/pair\t${code}`, `x/pair ${code}`]) batch.push(update(++id, text));
  batch.push(update(++id, undefined, undefined, { id: 81, type: 'group' }), update(++id)); h.queue.push(batch); h.start();
  await h.until(() => h.calls.filter(c => c[0] === 'poll').length === 2); assert.equal(h.b.telegramCursor(), id); assert.equal(h.b.pairing().user_id, '71');
  assert.deepEqual(h.calls.filter(c => c[0] === 'send').map(c => c[1].text), [messages[0]]);
  assert.equal((await h.rows()).filter(r => r.some(m => m.op === 'pairing.set')).length, 1);
  assert.deepEqual((await h.rows()).slice(1, -1), batch.slice(0, -1).map(u => [{ op: 'telegram.cursor', last_update_id: u.update_id }]));
  assert.equal((await h.rows()).at(-1).find(m => m.op === 'telegram.cursor').last_update_id, id);
}));
test('C1P-REPLIES: onboarding, generic refusal, matching and independently nonmatching paired tuples', opts, () => native(async h => {
  h.queue.push([update(1, '/start'), update(2, `/pair ${'f'.repeat(32)}`), update(3), update(4), update(5, '/start'),
    update(6, undefined, { id: 72, is_bot: false }), update(7, undefined, undefined, { id: 82, type: 'private' }),
    update(8, '/start', { id: 72, is_bot: false }), update(9, '/start', undefined, { id: 82, type: 'private' })]); h.start();
  await h.until(() => h.calls.filter(c => c[0] === 'poll').length === 2);
  assert.deepEqual(h.calls.filter(c => c[0] === 'send').map(c => c[1].text), [messages[2], messages[1], messages[0], messages[1], messages[3], messages[2], messages[2]]);
  assert.equal(h.b.telegramCursor(), 9);
}));
for (const invalid of [null, {}, [update(1), { update_id: -1 }], [update(1), { update_id: '2' }],
  [update(1), { update_id: Number.MAX_SAFE_INTEGER }], [update(1), null]]) test(`C1P-BATCH-${JSON.stringify(invalid)}: validates whole envelope before effects`, opts, () => native(async h => {
  h.queue.push(invalid); h.start(); await h.until(() => h.logs.length > 0);
  assert.equal(h.b.telegramCursor(), null); assert.equal(h.b.pairing(), null); assert.equal((await h.rows()).length, 1);
  assert.equal(h.calls.some(c => c[0] === 'send'), false);
}));
test('C1P-ACK: neutral callback only after actual cursor flush, no approvals', opts, () => native(async h => {
  h.queue.push([{ update_id: 8, callback_query: { id: 'opaque', data: 'a:any' } }]); h.start();
  await h.until(() => h.calls.some(c => c[0] === 'ack'));
  const ack = h.calls.find(c => c[0] === 'ack'); assert.equal(ack[1].callback_query_id, 'opaque'); assert.ok(!ack[1].text);
  assert.deepEqual(ack[3].at(-1), [{ op: 'telegram.cursor', last_update_id: 8 }]); assert.deepEqual(h.b.snapshot().requests, []);
}));
test('C1P-HANDLER: unexpected pre-cursor failure terminal, fixed redaction, no skip/retry', opts, () => native(async h => {
  h.b.completePairing = async () => { throw new Error(`sensitive ${code} 71 81`); }; h.queue.push([update(7), update(9, '/start')]); h.start();
  await h.until(() => h.logs.length > 0); await tick(); assert.deepEqual(h.logs, [['Telegram update processing stopped; stop and restart serve']]);
  assert.equal(h.b.telegramCursor(), null); assert.equal(h.calls.length, 1); assert.ok(h.poller.diagnostic());
}));
test('C1P-POSTCOMMIT: rejected UI operation logs fixed code, next offset without replay', opts, () => native(async h => {
  h.telegram.sendMessage = async () => { throw new TelegramError('TELEGRAM_REJECTED', `sensitive ${code}`); };
  h.queue.push([update(7)]); h.start(); await h.until(() => h.calls.filter(c => c[0] === 'poll').length === 2);
  assert.equal(h.b.telegramCursor(), 7); assert.equal(h.b.pairing().user_id, '71'); assert.equal((await h.rows()).length, 2);
  assert.ok(h.logs.length); assert.ok(h.logs.every(args => args.length === 1 && !args[0].includes(code) && !args[0].includes('sensitive')));
  assert.ok(h.logs.some(args => args[0].includes('TELEGRAM_REJECTED')));
  assert.equal(h.calls.at(-1)[1], 8);
}));
test('C1P-STOP: abort poll and fence late batch, shared stop, drain admitted actual append', opts, () => native(async h => {
  h.queue.push([update(7), update(9, '/start')]); const hold = h.hold(); h.start();
  try { await hold.entered(); const stop = h.poller.stop(); assert.equal(h.poller.stop(), stop); let done = false; stop.then(() => { done = true; });
    await tick(); assert.equal(done, false); assert.equal(h.calls[0][2].aborted, true); hold.release(); await stop;
    assert.equal(h.b.telegramCursor(), 7); assert.equal(h.b.pairing().user_id, '71'); assert.equal(h.calls.length, 1);
  } finally { hold.release(); }
}));
test('C1P-LATE: stopped long poll returning a batch cannot admit or repoll', opts, () => native(async h => {
  const entered = gate(), response = gate(); let signal;
  h.defer(() => response.release([]));
  h.telegram.updates = async (_, options) => { signal = options.signal; h.calls.push(['poll']); entered.release(); return response.promise; };
  h.start(); await bounded(() => entered.promise, 1000, 'poll entered');
  const stop = h.poller.stop(); assert.equal(signal.aborted, true); response.release([update(7)]); await stop;
  assert.equal(h.b.pairing(), null); assert.equal(h.b.telegramCursor(), null); assert.equal(h.calls.length, 1);
}));
for (const method of ['sendMessage', 'answerCallbackQuery']) test(`C1P-ABORT-${method}: stop cancels admitted UI transport, retains committed cursor`, opts, () => native(async h => {
  const entered = gate(); let signal;
  h.telegram[method] = async (_, options) => { signal = options.signal; entered.release(); return h.waiting(signal); };
  h.queue.push([method === 'sendMessage' ? update(7) : { update_id: 7, callback_query: { id: 'opaque' } }]); h.start();
  await bounded(() => entered.promise, 1000, 'UI transport entered'); const stop = h.poller.stop();
  assert.equal(signal.aborted, true); await stop; assert.equal(h.b.telegramCursor(), 7); assert.equal(h.calls.length, 1);
  assert.equal(h.b.pairing() !== null, method === 'sendMessage');
}));
test('C1P-TRANSIENT: actual first backoff delays retry, committed offset retained, stop aborts retry poll', opts, () => native(async h => {
  h.queue.push(new TelegramError('TELEGRAM_UNAVAILABLE', 'sensitive', { retryable: true })); const before = performance.now(); h.start();
  await h.until(() => h.calls.filter(c => c[0] === 'poll').length === 2);
  assert.ok(performance.now() - before >= 950); assert.equal(h.b.telegramCursor(), null);
  assert.deepEqual(h.calls.map(c => c[1]), [null, null]); await h.poller.stop(); assert.equal(h.calls.at(-1)[2].aborted, true);
}));
test('C1P-BACKOFF-STOP: rate retry wait aborts without another platform call', opts, () => native(async h => {
  h.queue.push(new TelegramError('TELEGRAM_RATE_LIMITED', 'sensitive', { retryable: true, retryAfter: 30 })); h.start();
  await tick(); await tick(); await h.poller.stop(); assert.equal(h.calls.length, 1); assert.equal(h.b.telegramCursor(), null);
}));
// TEST ONLY: Node's native mock clock controls global setTimeout, not production
// timing knobs. This small broker double isolates scheduling, NOT durability.
async function clocked(t, work) {
  const { createPortableTelegramPoller } = await import('../src/telegram/portable-poller.js');
  const queue = [], offsets = [], logs = []; let cursor = 7, writes = 0, signal;
  const broker = { telegramCursor: () => cursor, pairing: () => null,
    completePairing: async () => { throw new Error('timing fixture must not pair'); },
    advanceCursor: async id => { cursor = id; writes++; } };
  const telegram = { async updates(offset, options) { offsets.push(offset); signal = options.signal;
    if (!queue.length) return waitAbort(signal);
    const value = queue.shift(); if (value instanceof Error) throw value; return value; } };
  const poller = createPortableTelegramPoller({ broker, telegram, logger: (...args) => logs.push(args) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = async () => { await tick(); await tick(); };
  const h = { queue, offsets, poller, settle, get writes() { return writes; }, get signal() { return signal; },
    async advance(ms) { t.mock.timers.tick(ms); await settle(); } };
  try { await work(h); } finally {
    try { await poller.stop(); } finally { t.mock.timers.reset(); }
    assert.ok(!JSON.stringify([logs, poller.diagnostic()]).includes(privateMarker));
  }
}
const unavailable = () => new TelegramError('TELEGRAM_UNAVAILABLE', privateMarker, { retryable: true });
test('C1P-RETRY-LADDER: each rung boundary including 30 and repeated 30', opts, t => clocked(t, async h => {
  h.queue.push(...Array.from({ length: 8 }, (_, i) => new TelegramError(recognized[i % 3], privateMarker, { retryable: true })));
  h.poller.start(); await h.settle();
  for (const [index, ms] of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000].entries()) {
    assert.equal(h.offsets.length, index + 1);
    await h.advance(ms - 1); assert.equal(h.offsets.length, index + 1, `no early retry at rung ${index + 1}`);
    await h.advance(1); assert.equal(h.offsets.length, index + 2, `retry at rung ${index + 1}`);
  }
  assert.deepEqual(h.offsets, Array(9).fill(8)); assert.equal(h.writes, 0);
  await h.poller.stop(); assert.equal(h.signal.aborted, true);
}));
test('C1P-RETRY-RESET: empty and committed valid batches reset, malformed batch does not', opts, t => clocked(t, async h => {
  h.queue.push(unavailable(), null, [], unavailable(), [{ update_id: 9 }], unavailable());
  h.poller.start(); await h.settle(); await h.advance(1000);
  await h.advance(1999); assert.equal(h.offsets.length, 2);
  await h.advance(1); assert.equal(h.offsets.length, 4);
  await h.advance(999); assert.equal(h.offsets.length, 4);
  await h.advance(1); assert.equal(h.offsets.length, 6); assert.equal(h.writes, 1);
  await h.advance(999); assert.equal(h.offsets.length, 6);
  await h.advance(1); assert.deepEqual(h.offsets, [8, 8, 8, 8, 8, 10, 10]);
}));
test('C1P-RETRY-RATE-ABORT: retry_after lower bound, next rung, abort cancels pending wait', opts, t => clocked(t, async h => {
  h.queue.push(new TelegramError('TELEGRAM_RATE_LIMITED', privateMarker, { retryAfter: 45 }), unavailable());
  h.poller.start(); await h.settle(); await h.advance(44999); assert.equal(h.offsets.length, 1);
  await h.advance(1); assert.equal(h.offsets.length, 2);
  await h.advance(1999); assert.equal(h.offsets.length, 2);
  const stop = h.poller.stop(); assert.equal(h.poller.stop(), stop); await stop;
  await h.advance(100000); assert.equal(h.offsets.length, 2); assert.equal(h.writes, 0);
}));
const recognized = ['TELEGRAM_UNAVAILABLE', 'TELEGRAM_TIMEOUT', 'TELEGRAM_RATE_LIMITED',
  'TOKEN_REJECTED', 'POLLER_CONFLICT', 'TELEGRAM_REJECTED'];
const privateMarker = 'SYNTHETIC_SECRET_ACTOR_71';
const faultCases = [...recognized, 'CANCELLED', `${privateMarker}\nforged diagnostic`, '', { nested: privateMarker }, undefined];
for (const path of ['poll', 'handler', 'sendMessage', 'answerCallbackQuery']) {
  for (const [index, faultCode] of faultCases.entries()) {
    if (path === 'poll' && (recognized.slice(0, 3).includes(faultCode) || faultCode === 'CANCELLED')) continue;
    test(`C1P-REDACTION-${path}-${index}: classified behavior without exception disclosure`, opts, () => native(async h => {
      const error = Object.assign(new Error(`${privateMarker} message ${code}`, { cause: new Error(`${privateMarker} cause`) }), { code: faultCode });
      const fatalUI = ['TOKEN_REJECTED', 'POLLER_CONFLICT'].includes(faultCode);
      if (path === 'poll') h.queue.push(error);
      else {
        if (path === 'handler') h.b.completePairing = async () => { throw error; };
        else h.telegram[path] = async () => { throw error; };
        h.queue.push([path === 'answerCallbackQuery' ? { update_id: 7, callback_query: { id: 'opaque' } } : update(7)]);
      }
      h.start();
      await h.until(() => path === 'poll' || path === 'handler' || fatalUI
        ? h.logs.length > 0 : h.calls.filter(c => c[0] === 'poll').length === 2);
      await h.poller.stop();
      const committed = path === 'sendMessage' || path === 'answerCallbackQuery';
      assert.equal(h.b.telegramCursor(), committed ? 7 : null);
      assert.equal(h.b.pairing() !== null, path === 'sendMessage');
      assert.equal((await h.rows()).length, committed ? 2 : 1);
      assert.deepEqual(h.calls.filter(c => c[0] === 'poll').map(c => c[1]), committed && !fatalUI ? [null, 8] : [null]);
      assert.ok(h.logs.length); assert.ok(h.logs.every(args => args.length === 1 && typeof args[0] === 'string'));
      const observed = JSON.stringify([h.logs, h.poller.diagnostic()]);
      assert.ok(!observed.includes(privateMarker) && !observed.includes(code), 'code/message/cause never enter diagnostics');
      if (path === 'handler') assert.deepEqual(h.logs, [['Telegram update processing stopped; stop and restart serve']]);
      else if (recognized.includes(faultCode) || faultCode === 'CANCELLED') {
        assert.ok(h.logs.some(args => args[0].includes(faultCode)), 'recognized diagnostic retained');
        if (path === 'poll' || fatalUI) assert.equal(h.poller.diagnostic(), faultCode);
      }
      else {
        // Existing private generic fallback, not a new public error code.
        assert.ok(h.logs.some(args => args[0].includes(': UNKNOWN')), 'unknown codes use fixed generic fallback');
        if (path === 'poll') assert.equal(h.poller.diagnostic(), 'UNKNOWN');
      }
      if (committed && !fatalUI) assert.equal(h.poller.diagnostic(), null);
    }));
  }
}
for (const code of ['TOKEN_REJECTED', 'POLLER_CONFLICT', 'TELEGRAM_REJECTED']) test(`C1P-FATAL-${code}: terminal consumption diagnostic without local state mutation`, opts, () => native(async h => {
  h.queue.push(new TelegramError(code, 'sensitive actor token code')); h.start(); await h.until(() => h.poller.diagnostic());
  await tick(); assert.equal(h.calls.length, 1); assert.equal(h.b.telegramCursor(), null); assert.equal((await h.rows()).length, 1);
  assert.ok(h.logs.length); assert.ok(h.logs.every(a => a.length === 1 && !a[0].includes('sensitive')));
}));
test('C1P-STORAGE: actual failed sync fences core and stops batch without confirmation or later cursor', opts, () => native(async h => {
  h.fault(); h.queue.push([update(7), update(9, '/start')]); h.start(); await h.until(() => h.poller.diagnostic());
  await h.poller.stop(); assert.equal(h.b.telegramCursor(), null); assert.equal(h.b.pairing(), null); assert.equal(h.calls.length, 1);
  await assert.rejects(h.b.status(), e => e.code === 'STORAGE_FAILURE');
}));
for (const method of ['sendMessage', 'answerCallbackQuery']) test(`C1P-SIGNAL-${method}: actual client refuses preaborted operation without HTTPS`, opts, async () => {
  const original = https.request; let calls = 0;
  https.request = () => { calls++; throw new Error('offline guard'); };
  try { const client = createTelegramClient({ token: 'synthetic-token' }), c = new AbortController(); c.abort();
    await assert.rejects(client[method]({}, { signal: c.signal }), e => e.code === 'CANCELLED'); assert.equal(calls, 0);
  } finally { https.request = original; }
});
