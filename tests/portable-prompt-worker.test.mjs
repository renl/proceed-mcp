// TEST ONLY: design5 C3 G1. Controlled client + real Journal, not Telegram/human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { renderPortableReplyPrompt } from '../src/telegram/portable-render.js';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 10000 };
const realTimer = setTimeout, realClear = clearTimeout, turn = () => new Promise(r => setImmediate(r));
const message = () => ({ message_id: 70, date: 1793750400, chat: { id: 81, type: 'private' } });
async function until(check) { const end = performance.now() + 1500;
  while (performance.now() < end) { if (await check()) return; await turn(); } assert.fail('condition deadline'); }
async function native(t, work, load = true) {
  const factory = load ? (await import('../src/telegram/portable-prompt.js')).createPortablePromptWorker : null;
  const root = resolve('.scratch/c3-prompt-worker'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let b, j, file, worker, deadline; const releases = [], calls = [], logs = [];
  const h = { factory, calls, logs, now: at, sync: async () => {}, get b() { return b; },
    rows: async () => readJournal(await readFile(path)).transactions.flatMap(x => x.mutations),
    defer() { let release; const promise = new Promise(r => { release = r; }); releases.push(release); return { promise, release }; },
    holdSync() { const entered = h.defer(), held = h.defer();
      h.sync = async () => { entered.release(); await held.promise; }; return { entered: entered.promise, release: held.release }; },
    async create(opened = true) { const k = await b.reserveHandle({ ownerId: 'a' });
      h.key = { ownerId: 'a', requestId: k.request_id, capability: k.request_capability };
      await b.createRequest({ ownerId: 'a', requestHandle: k.request_handle, capability: k.request_capability,
        clientRequestId: 'question', action: 'Question? <&>', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: k.request_id });
      await b.recordPresentationSent({ requestId: k.request_id, callbackToken: p.callback_token, chatId: '81', messageId: 7 });
      if (opened) await b.openResponse({ requestId: k.request_id, callbackToken: p.callback_token,
        chatId: '81', messageId: 7, userId: '71', callbackQueryId: 'private-query', updateId: 2 });
      return b.snapshot().requests[0]; },
    start(send = async () => message(), broker = b) {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at });
      worker = factory({ broker, telegram: { sendMessage: (payload, options) => {
        calls.push({ payload, ...options }); return send(payload, options); } }, logger: line => logs.push(line) });
      assert.equal(worker.diagnostic(), null); assert.equal(worker.failed, false);
      assert.equal(worker.start(), undefined); return worker;
    } };
  try {
    j = await Journal.open(path); await j.close(); file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, 0);
    b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => h.now });
    await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '71', chatId: '81', updateId: 1 }); h.now = at + 1000;
    await Promise.race([work(h), new Promise((_, reject) => { deadline = realTimer(() => reject(Error('fixture deadline')), 7000); })]);
  } finally {
    releases.forEach(release => release()); h.sync = async () => {};
    try { if (worker) { const p = worker.stop(); assert.equal(worker.stop(), p); await p; assert.equal(worker.stop(), p); } }
    finally { t.mock.timers.reset(); realClear(deadline); await b?.close(); await j?.close(); await file?.close().catch(() => {});
      await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
  }
}
test('CAL-PROMPT: real open/admission has no append, actual receipt waits for sync', opts, t => native(t, async h => {
  const request = await h.create(), rows = await h.rows();
  assert.deepEqual(await h.b.prepareResponsePrompt({ requestId: request.request_id }), { chat_id: '81', request });
  assert.deepEqual(await h.rows(), rows);
  const held = h.holdSync(); let done = false;
  const p = h.b.recordPromptSent({ requestId: request.request_id, chatId: '81', messageId: 70 }).then(r => { done = true; return r; });
  await held.entered; assert.equal(done, false); assert.equal(h.b.responseWork().prompts.length, 1);
  held.release(); assert.equal((await p).sent, true); assert.equal(h.b.responseWork().prompts.length, 0);
}, false));
test('CAL-TIMERS: native timeout/interval/Date controls', opts, t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at }); let scans = 0, retries = 0;
  const interval = setInterval(() => scans++, 1000); setTimeout(() => retries++, 3000);
  try { t.mock.timers.tick(3000); assert.equal(scans, 3); assert.equal(retries, 1); assert.equal(Date.now(), at + 3000); }
  finally { clearInterval(interval); t.mock.timers.reset(); }
});
test('PW-DEPENDENCIES: selected worker construction', opts, async () => {
  const { createPortablePromptWorker: factory } = await import('../src/telegram/portable-prompt.js');
  const broker = Object.fromEntries(['responseWork', 'prepareResponsePrompt', 'recordPromptSent', 'recordPromptFailed'].map(k => [k, () => {}]));
  const telegram = { sendMessage() {} };
  for (const name of Object.keys(broker)) assert.throws(() => factory({ broker: { ...broker, [name]: null }, telegram }), TypeError);
  for (const args of [undefined, {}, { broker }, { broker, telegram: {} }, { broker, telegram, logger: null }]) assert.throws(() => factory(args), TypeError);
});
test('PW-PAYLOAD: only ID from candidate, fresh admission payload, one send, durable success', opts, t => native(t, async h => {
  const request = await h.create(), result = h.defer(), prepared = [];
  const broker = { responseWork: () => ({ prompts: [{ request_id: request.request_id, chat_id: '99', request: {} }] }),
    prepareResponsePrompt: async input => { prepared.push(input); return h.b.prepareResponsePrompt(input); },
    recordPromptSent: input => h.b.recordPromptSent(input), recordPromptFailed: input => h.b.recordPromptFailed(input) };
  const w = h.start(() => result.promise, broker); w.start(); await until(() => h.calls.length === 1);
  assert.deepEqual(prepared, [{ requestId: request.request_id }]);
  assert.deepEqual(h.calls[0].payload, { chat_id: '81', text: renderPortableReplyPrompt(request), reply_markup: { force_reply: true } });
  assert.ok(h.calls[0].signal instanceof AbortSignal); t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 1);
  result.release(message()); await until(() => h.b.responseWork().prompts.length === 0);
  t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 1);
  const view = h.b.snapshot().requests[0]; assert.equal(view.resolution, 'pending'); assert.equal(view.decision_id, null);
  assert.equal(view.telegram_state, 'sent'); assert.equal(h.b.telegramCursor(), 2);
  assert.equal((await h.rows()).filter(r => r.op === 'telegram.prompt.sent').length, 1); assert.deepEqual(h.logs, []);
}));
test('PW-PREPARE: serialized turn held behind cursor, stop recheck prevents wire', opts, t => native(t, async h => {
  await h.create(); const held = h.holdSync(), cursor = h.b.advanceCursor(3); await held.entered;
  let admissions = 0; const broker = { responseWork: () => h.b.responseWork(),
    prepareResponsePrompt: input => { admissions++; return h.b.prepareResponsePrompt(input); },
    recordPromptSent: input => h.b.recordPromptSent(input), recordPromptFailed: input => h.b.recordPromptFailed(input) };
  const w = h.start(undefined, broker); await until(() => admissions === 1); assert.equal(h.calls.length, 0);
  const stopped = w.stop(); assert.equal(w.stop(), stopped); held.release(); await cursor; await stopped;
  t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 0);
  assert.equal((await h.rows()).some(r => r.op.startsWith('telegram.prompt.')), false);
}));
test('PW-DUE: stale candidate expires through core admission, no send or invented cursor', opts, t => native(t, async h => {
  await h.create(); h.now = at + 61000; const w = h.start();
  await until(() => h.b.snapshot().requests[0].resolution === 'expired'); await w.stop();
  assert.equal(h.calls.length, 0); assert.equal(h.b.telegramCursor(), 2);
  assert.equal((await h.rows()).at(-1).op, 'request.expire');
}));
test('PW-INELIGIBLE: unopened target has no prompt attempt', opts, t => native(t, async h => {
  await h.create(false); const before = await h.rows(), w = h.start();
  t.mock.timers.tick(3000); await turn(); await w.stop(); assert.equal(h.calls.length, 0); assert.deepEqual(await h.rows(), before);
}));
test('PW-DRAIN: admitted valid late Message persists after terminal/stop and waits for native sync', opts, t => native(t, async h => {
  await h.create(); const result = h.defer(), w = h.start(() => result.promise);
  await until(() => h.calls.length === 1); await h.b.cancelRequest(h.key);
  const view = h.b.snapshot(), held = h.holdSync(); let drained = false;
  const stopped = w.stop(); stopped.then(() => { drained = true; }); assert.equal(w.stop(), stopped);
  assert.equal(h.calls[0].signal.aborted, true); result.release(message()); await held.entered;
  assert.equal(drained, false); assert.deepEqual(h.b.snapshot(), view); held.release(); await stopped;
  assert.equal((await h.rows()).at(-1).op, 'telegram.prompt.sent'); assert.deepEqual(h.b.snapshot(), view);
  t.mock.timers.tick(30000); await turn(); assert.equal(h.calls.length, 1); assert.equal(h.b.telegramCursor(), 2);
}));
