// TEST ONLY: design5 C3 G1. Controlled client + real Journal, not Telegram/human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { renderPortableReplyPrompt } from '../src/telegram/portable-render.js';
import { createPortablePresentationWorker } from '../src/telegram/portable-presentation.js';
import { createPortableTelegramPoller } from '../src/telegram/portable-poller.js';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 10000 };
const realTimer = setTimeout, realClear = clearTimeout, turn = () => new Promise(r => setImmediate(r));
const message = () => ({ message_id: 70, date: 1793750400, chat: { id: 81, type: 'private' } });
async function until(check) { const end = performance.now() + 1500;
  while (performance.now() < end) { if (await check()) return; await turn(); } assert.fail('condition deadline'); }
async function native(t, work, load = true) {
  const factory = load ? (await import('../src/telegram/portable-prompt.js')).createPortablePromptWorker : null;
  const root = resolve('.scratch/c3-prompt-worker'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let b, j, file, worker, deadline, sequence = 0; const releases = [], calls = [], logs = [], workers = [];
  const h = { factory, calls, logs, now: at, sync: async () => {}, write: async (...a) => file.write(...a), get b() { return b; },
    own(w) { workers.push(w); return w; },
    rows: async () => readJournal(await readFile(path)).transactions.flatMap(x => x.mutations),
    defer() { let release; const promise = new Promise(r => { release = r; }); releases.push(release); return { promise, release }; },
    holdSync() { const entered = h.defer(), held = h.defer();
      h.sync = async () => { entered.release(); await held.promise; }; return { entered: entered.promise, release: held.release }; },
    async create(opened = true, presented = true) { const index = ++sequence, k = await b.reserveHandle({ ownerId: 'a' });
      h.key = { ownerId: 'a', requestId: k.request_id, capability: k.request_capability };
      await b.createRequest({ ownerId: 'a', requestHandle: k.request_handle, capability: k.request_capability,
         clientRequestId: 'question', action: 'Question? <&>', context: '', expiresInSeconds: 60 });
      if (!presented) return b.snapshot().requests.find(r => r.request_id === k.request_id);
      const p = await b.preparePresentation({ requestId: k.request_id });
      await b.recordPresentationSent({ requestId: k.request_id, callbackToken: p.callback_token, chatId: '81', messageId: 6 + index });
      if (opened) await b.openResponse({ requestId: k.request_id, callbackToken: p.callback_token,
        chatId: '81', messageId: 6 + index, userId: '71', callbackQueryId: `private-query-${index}`, updateId: 1 + index });
      return b.snapshot().requests.find(r => r.request_id === k.request_id); },
    start(send = async () => message(), broker = b, extra = {}) {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at });
      worker = factory({ broker, telegram: { sendMessage: (payload, options) => {
         calls.push({ payload, ...options }); return send(payload, options); } }, logger: line => logs.push(line), ...extra });
      workers.push(worker);
      assert.equal(worker.diagnostic(), null); assert.equal(worker.failed, false);
      assert.equal(worker.start(), undefined); return worker;
    } };
  try {
    j = await Journal.open(path); await j.close(); file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => h.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, 0);
    b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => h.now });
    await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '71', chatId: '81', updateId: 1 }); h.now = at + 1000;
    await Promise.race([work(h), new Promise((_, reject) => { deadline = realTimer(() => reject(Error('fixture deadline')), 7000); })]);
  } finally {
    releases.forEach(release => release()); h.sync = async () => {};
    try { for (const w of workers) { const p = w.stop(); assert.equal(w.stop(), p); await p; assert.equal(w.stop(), p); } }
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

// Test-only replica of the runtime's private one-way fence, with listener accounting.
// It changes no worker contract and exposes no production testing interface.
function sharedTraffic() {
  const listeners = new Set(); let stopped = false;
  return {
    get size() { return listeners.size; },
    stop() { if (stopped) return; stopped = true;
      for (const listener of [...listeners]) listener(); listeners.clear(); },
    add(listener) { if (stopped) listener(); else listeners.add(listener); },
    remove(listener) { listeners.delete(listener); }
  };
}
const cancelled = () => Object.assign(Error('private transport text'), { code: 'CANCELLED' });
test('PW-CREDENTIAL-ORDER: all real peers fenced before own throwing logger despite actual failed receipt append', opts, t => native(t, async h => {
  await h.create(); await h.create(false, false);
  const traffic = sharedTraffic(), sent = h.defer(), peerSignals = [], logStates = [], peerCalls = [];
  const pendingPeer = (kind, signal) => new Promise((resolve, reject) => {
    peerCalls.push(kind); peerSignals.push(signal);
    signal.addEventListener('abort', () => reject(cancelled()), { once: true });
  });
  // Deliberately register prompt first. Correct global cessation must not depend
  // on construction order or defer peer abortion until after this logger runs.
  const w = h.start(() => sent.promise, h.b, { traffic, logger: (...args) => {
    logStates.push({ args, aborted: peerSignals.map(signal => signal.aborted) });
    throw Error('logger must not interrupt global cessation');
  } });
  const presentation = h.own(createPortablePresentationWorker({ broker: h.b, traffic,
    telegram: { sendMessage: (_payload, { signal }) => pendingPeer('presentation', signal),
      editMessageText() { assert.fail('unexpected edit'); }, editMessageReplyMarkup() { assert.fail('unexpected edit'); } } }));
  const poller = h.own(createPortableTelegramPoller({ broker: h.b, traffic,
    telegram: { updates: (_offset, { signal }) => pendingPeer('poller', signal) } }));
  presentation.start(); poller.start();
  await until(() => h.calls.length === 1 && peerSignals.length === 2);
  assert.equal(traffic.size, 3); assert.deepEqual(peerSignals.map(signal => signal.aborted), [false, false]);
  const before = h.b.snapshot(), rows = await h.rows(); let writeAttempts = 0;
  h.write = async () => { writeAttempts++; throw Error('actual receipt file write failure'); };
  sent.release(Promise.reject(Object.assign(Error('secret token URL must not log'), { code: 'TOKEN_REJECTED' })));
  await until(() => writeAttempts === 1 && peerSignals.every(signal => signal.aborted));
  const stopped = w.stop(); assert.equal(w.stop(), stopped); await stopped;
  await presentation.stop(); await poller.stop();
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(traffic.size, 0);
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(await h.rows(), rows);
  // Actual storage failure fences local service, unlike credential rejection alone.
  await assert.rejects(h.b.status(), error => error.code === 'STORAGE_FAILURE');
  t.mock.timers.tick(120000); await turn(); w.start(); presentation.start(); poller.start();
  assert.equal(h.calls.length, 1); assert.equal(peerCalls.length, 2); assert.equal(writeAttempts, 1);
  assert.equal(logStates.length, 1);
  assert.deepEqual(logStates[0].args, ['Telegram presentation stopped after credential rejection; repair configuration and restart serve']);
  assert.deepEqual(logStates[0].aborted, [true, true], 'credential fanout MUST finish before fallible own logging, regardless of registration order');
}));
