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

// P2 remainder: same invariant suite and real producers, no public/network proof.
const failure = (code, retryAfter) => Object.assign(Error('secret URL/request/description'), { code, retryAfter });
const INVALID = 'Telegram question presentation blocked after an invalid response; stop and restart serve';
const PROCESSING = 'Telegram presentation processing stopped; stop and restart serve';
const STORAGE = 'Telegram presentation stopped after a storage failure; stop and restart serve';
const CREDENTIAL = 'Telegram presentation stopped after credential rejection; repair configuration and restart serve';
const REJECTED = 'Telegram question presentation blocked after rejection; repair Telegram access and restart serve';
const promptRows = async h => (await h.rows()).filter(r => r.op.startsWith('telegram.prompt.'));
function observed(h, overrides = {}) {
  const counts = { scans: 0, prepares: 0, receipts: [], failures: [] };
  const broker = { responseWork: () => { counts.scans++; return h.b.responseWork(); },
    prepareResponsePrompt: input => { counts.prepares++; return h.b.prepareResponsePrompt(input); },
    recordPromptSent: async input => { const r = await h.b.recordPromptSent(input); counts.receipts.push(r); return r; },
    recordPromptFailed: async input => { const r = await h.b.recordPromptFailed(input); counts.failures.push(input); return r; }, ...overrides };
  return { broker, counts };
}
async function tick(t, ms) { t.mock.timers.tick(ms); await turn(); await turn(); }
async function quiet(t, h, w, expected, counts) {
  await w.stop(); const scans = counts?.scans, prepares = counts?.prepares;
  await tick(t, 120000); w.start(); await turn(); assert.equal(h.calls.length, expected);
  if (counts) { assert.equal(counts.scans, scans); assert.equal(counts.prepares, prepares); }
}
async function selfFenced(t, h, counts) {
  if (h.calls.length) assert.equal(h.calls.at(-1).signal.aborted, true, 'worker must fence itself before explicit stop');
  const calls = h.calls.length, scans = counts.scans, prepares = counts.prepares;
  await tick(t, 120000);
  assert.equal(h.calls.length, calls); assert.equal(counts.scans, scans); assert.equal(counts.prepares, prepares);
}
const invalidMessages = [
  ['null', null], ['undefined', undefined], ['boolean', true], ['string', '70'], ['number', 70],
  ['array', []], ['date-instance', new Date(at)], ['custom-prototype', Object.assign(Object.create({}), message())],
  ['missing-chat', { message_id: 70, date: 1 }], ['null-chat', { ...message(), chat: null }],
  ['array-chat', { ...message(), chat: [] }], ['instance-chat', { ...message(), chat: Object.assign(new Date(), message().chat) }],
  ...['message_id', 'date'].flatMap(field => [undefined, null, '70', true, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
    .map(value => [`${field}:${String(value)}`, { ...message(), [field]: value }])),
  ...[undefined, null, '81', true, 0, -81, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 82]
    .map(value => [`chat.id:${String(value)}`, { ...message(), chat: { ...message().chat, id: value } }]),
  ...[undefined, null, 'group', 'supergroup', 'channel', true].map(type => [`chat.type:${String(type)}`, { ...message(), chat: { id: 81, type } }])
];
test('PW-INVALID: complete raw Message domain stops only prompt worker with actual failure and no retries', opts, async t => {
  for (const [label, value] of invalidMessages) await native(t, async h => {
    const first = await h.create(); await h.create(); const before = h.b.snapshot(), traffic = sharedTraffic(); let peerStops = 0;
    const peer = () => peerStops++; traffic.add(peer); const { broker, counts } = observed(h);
    const w = h.start(async () => value, broker, { traffic, logger: (...args) => { h.logs.push(args); throw Error('private logger'); } });
    await until(() => w.failed); await selfFenced(t, h, counts); await w.stop();
    assert.equal(w.diagnostic(), INVALID, label); assert.deepEqual(h.logs, [[INVALID]], label);
    assert.equal(peerStops, 0, label); assert.equal(traffic.size, 1, label);
    assert.equal(h.calls.length, 1, label); assert.equal(counts.prepares, 1, label);
    assert.deepEqual(counts.failures, [{ requestId: first.request_id, errorCode: 'invalid_response' }], label);
    assert.deepEqual((await promptRows(h)).map(r => [r.op, r.request_id, r.error_code]),
      [['telegram.prompt.failed', first.request_id, 'invalid_response']], label);
    assert.deepEqual(h.b.snapshot(), before, label); await h.b.status();
    await quiet(t, h, w, 1, counts);
    await h.b.cancelRequest(h.key); assert.equal(h.b.snapshot().requests[1].resolution, 'cancelled');
    traffic.remove(peer); assert.equal(traffic.size, 0);
  });
});
test('PW-COLLISION: real cross-request prompt and request-message role preserve mappings and allow siblings', opts, async t => {
  for (const role of ['prompt', 'request', 'request-other']) await native(t, async h => {
    const owner = await h.create();
    if (role !== 'request') await h.b.recordPromptSent({ requestId: owner.request_id, chatId: '81', messageId: 70 });
    const blocked = await h.create(), sibling = await h.create(), before = h.b.snapshot(), { broker, counts } = observed(h);
    const collision = role === 'prompt' ? 70 : 7;
    let sends = 0; const w = h.start(async () => ({ ...message(), message_id: sends++ === 0 ? collision : 90 + sends }), broker);
    await until(() => counts.failures.length === 1 && counts.receipts.length === (role === 'request' ? 3 : 2));
    assert.equal(w.diagnostic(), INVALID); assert.equal(counts.receipts[0], null);
    assert.equal(counts.failures[0].requestId, role === 'request' ? owner.request_id : blocked.request_id);
    // The request-role case starts with the owner's still-unmapped prompt, which collides with its own question.
    const rows = await promptRows(h), mapping = rows.filter(r => r.op === 'telegram.prompt.sent');
    if (role !== 'request') {
      assert.deepEqual(mapping.find(r => r.message_id === 70)?.request_id, owner.request_id);
      assert.equal((await h.b.recordPromptSent({ requestId: owner.request_id, chatId: '81', messageId: 70 })).sent, false);
    }
    if (role !== 'prompt') assert.equal(mapping.some(r => r.message_id === 7), false);
    assert.ok(mapping.some(r => r.request_id === sibling.request_id));
    assert.deepEqual(h.b.snapshot(), before); await h.b.status();
    const n = h.calls.length, p = counts.prepares, scans = counts.scans; await tick(t, 120000);
    assert.equal(h.calls.length, n); assert.equal(counts.prepares, p);
    assert.ok(counts.scans <= scans + 121);
    await quiet(t, h, w, n, counts);
  });
});
test('PW-IDEMPOTENT: actual competing producer maps own admitted tuple, sent:false is success without resend', opts, t => native(t, async h => {
  const request = await h.create(), result = h.defer(), { broker, counts } = observed(h);
  const w = h.start(() => result.promise, broker); await until(() => h.calls.length === 1);
  assert.equal((await h.b.recordPromptSent({ requestId: request.request_id, chatId: '81', messageId: 70 })).sent, true);
  result.release(message()); await until(() => counts.receipts.length === 1);
  assert.equal(counts.receipts[0].sent, false); assert.equal(w.failed, false); assert.deepEqual(h.logs, []);
  await tick(t, 120000); assert.equal(h.calls.length, 1); assert.equal(counts.prepares, 1);
  assert.deepEqual((await promptRows(h)).map(r => r.op), ['telegram.prompt.sent']);
  await quiet(t, h, w, 1, counts);
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
test('PW-RETRY: full ladder repeats30, transient vocabulary, native scan cannot beat timers, restart resets', opts, t => native(t, async h => {
  await h.create(); const { broker, counts } = observed(h), times = [];
  const codes = ['TELEGRAM_UNAVAILABLE', 'TELEGRAM_TIMEOUT', 'TELEGRAM_RATE_LIMITED'];
  const w = h.start(async () => { times.push(Date.now()); throw failure(codes[(times.length - 1) % 3]); }, broker);
  const ladder = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
  for (let i = 0; i < ladder.length; i++) {
    await until(() => counts.failures.length === i + 1); await turn();
    await tick(t, ladder[i] - 1); assert.equal(h.calls.length, i + 1);
    await tick(t, 1); await until(() => h.calls.length === i + 2);
    assert.equal(times[i + 1] - times[i], ladder[i]);
  }
  await until(() => counts.failures.length === 9); await quiet(t, h, w, 9, counts);
  const { broker: next, counts: reset } = observed(h); let n = 0;
  const restarted = h.own(h.factory({ broker: next, telegram: { sendMessage: async () => {
    n++; if (n === 1) throw failure('TELEGRAM_TIMEOUT'); return message(); } } }));
  restarted.start(); await until(() => reset.failures.length === 1); await turn();
  await tick(t, 999); assert.equal(n, 1); await tick(t, 1); await until(() => reset.receipts.length === 1);
  assert.equal(n, 2); assert.equal(reset.receipts[0].sent, true); assert.equal(restarted.failed, false);
  assert.deepEqual((await promptRows(h)).filter(r => r.op.endsWith('failed')).map(r => r.error_code),
    [...Array.from({ length: 9 }, (_, i) => i % 3 === 2 ? 'rate_limited' : 'unavailable'), 'unavailable']);
}));
test('PW-RATE: raw retry floors accept nonnegative integers only and never shorten ladder', opts, async t => {
  for (const [floor, delay] of [[5, 5000], [0, 1000], [-1, 1000], [1.5, 1000], ['5', 1000], [NaN, 1000], [Infinity, 1000], [undefined, 1000]]) {
    await native(t, async h => {
      await h.create(); const { broker, counts } = observed(h); let n = 0;
      const w = h.start(async () => { if (++n === 1) throw failure('TELEGRAM_RATE_LIMITED', floor); return message(); }, broker);
      await until(() => counts.failures.length === 1); await turn();
      await tick(t, delay - 1); assert.equal(n, 1, String(floor));
      await tick(t, 1); await until(() => counts.receipts.length === 1);
      assert.equal(n, 2); assert.equal(w.failed, false); await quiet(t, h, w, 2, counts);
    });
  }
});
test('PW-RESCAN: retry/interval overlap coalesces sequentially and reexamines newly eligible sibling', opts, t => native(t, async h => {
  const first = await h.create(), second = await h.create(), held = h.defer(), { broker, counts } = observed(h);
  let n = 0, active = 0, peak = 0;
  const w = h.start(async () => { const i = ++n; peak = Math.max(peak, ++active);
    try { if (i === 1) throw failure('TELEGRAM_TIMEOUT'); if (i === 2) return await held.promise;
      return { ...message(), message_id: 100 + i }; } finally { active--; } }, broker);
  await until(() => n === 2); await tick(t, 5000); assert.equal(n, 2); assert.equal(counts.scans, 1);
  const third = await h.create(); held.release({ ...message(), message_id: 90 });
  await until(() => counts.receipts.length === 3); assert.equal(peak, 1); assert.equal(n, 4);
  assert.equal(counts.scans, 2); assert.equal(counts.prepares, 4);
  assert.deepEqual((await promptRows(h)).filter(r => r.op.endsWith('sent')).map(r => r.request_id),
    [second.request_id, first.request_id, third.request_id]);
  await tick(t, 10000); assert.equal(n, 4); await quiet(t, h, w, 4, counts);
}));
test('PW-REJECTION: definite request-local block skips preparation forever while sibling progresses', opts, t => native(t, async h => {
  const blocked = await h.create(), sibling = await h.create(), traffic = sharedTraffic(); let peerStops = 0;
  const peer = () => peerStops++; traffic.add(peer); const { broker, counts } = observed(h); let n = 0;
  const w = h.start(async () => { if (++n === 1) throw failure('TELEGRAM_REJECTED'); return message(); }, broker,
    { traffic, logger: (...args) => { h.logs.push(args); throw Error('private logger'); } });
  await until(() => counts.receipts.length === 1); assert.deepEqual(h.logs, [[REJECTED]]); assert.equal(w.diagnostic(), REJECTED);
  assert.deepEqual(counts.failures, [{ requestId: blocked.request_id, errorCode: 'rejected' }]);
  assert.equal((await promptRows(h)).find(r => r.op.endsWith('sent')).request_id, sibling.request_id);
  const scans = counts.scans; await tick(t, 120000); assert.equal(n, 2); assert.equal(counts.prepares, 2);
  assert.ok(counts.scans <= scans + 121); assert.equal(peerStops, 0); await h.b.status();
  await quiet(t, h, w, 2, counts); traffic.remove(peer); assert.equal(traffic.size, 0);
}));
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

test('PW-CREDENTIAL-HEALTHY: own and both actual reverse peer origins contain log throws without local fence', opts, async t => {
  for (const origin of ['prompt', 'presentation', 'poller']) await native(t, async h => {
    await h.create(); await h.create(false, false);
    const traffic = sharedTraffic(), results = { prompt: h.defer(), presentation: h.defer(), poller: h.defer() };
    const signals = {}, calls = [], logStates = [], log = kind => (...args) => {
      logStates.push({ kind, args, aborted: Object.values(signals).map(s => s.aborted) }); throw Error('private logger text'); };
    const send = kind => (_payload, { signal }) => {
      calls.push(kind); signals[kind] = signal;
      return new Promise((resolve, reject) => {
        results[kind].promise.then(resolve, reject);
        signal.addEventListener('abort', () => reject(cancelled()), { once: true });
      });
    };
    const w = h.start(send('prompt'), h.b, { traffic, logger: log('prompt') });
    const presentation = h.own(createPortablePresentationWorker({ broker: h.b, traffic, logger: log('presentation'),
      telegram: { sendMessage: send('presentation'), editMessageText() { assert.fail('edit'); }, editMessageReplyMarkup() { assert.fail('edit'); } } }));
    const poller = h.own(createPortableTelegramPoller({ broker: h.b, traffic, logger: log('poller'),
      telegram: { updates: send('poller') } }));
    presentation.start(); poller.start(); await until(() => calls.length === 3);
    assert.equal(traffic.size, 3); results[origin].release(Promise.reject(failure('TOKEN_REJECTED')));
    await until(() => Object.values(signals).every(s => s.aborted) && logStates.length >= 1);
    await Promise.all([w.stop(), presentation.stop(), poller.stop()]);
    assert.equal(w.diagnostic(), CREDENTIAL); assert.equal(traffic.size, 0);
    assert.ok(logStates.every(entry => entry.args.length === 1 && !String(entry.args[0]).includes('secret')));
    const promptLog = logStates.filter(entry => entry.kind === 'prompt');
    assert.equal(promptLog.length, 1); assert.deepEqual(promptLog[0].args, [CREDENTIAL]);
    assert.ok(promptLog[0].aborted.every(Boolean));
    const rows = await promptRows(h); assert.equal(rows.length, origin === 'prompt' ? 1 : 0);
    if (rows.length) assert.equal(rows[0].error_code, 'rejected');
    await h.b.status(); await h.b.cancelRequest(h.key);
    assert.equal(h.b.snapshot().requests[1].resolution, 'cancelled');
    const logs = logStates.length; await tick(t, 120000); w.start(); presentation.start(); poller.start();
    assert.equal(calls.length, 3); assert.equal(logStates.length, logs);
    // Actual owned listeners plus throwing owned loggers. Foreign-listener recovery is an explicit owner-review assumption, not proof.
  });
});
test('PW-CONSTRUCT-STOPPED: already-fenced construction installs diagnostic synchronously and pending callback runs once', opts, t => native(t, async h => {
  await h.create(); const traffic = sharedTraffic(); traffic.stop(); let calls = 0; const logs = [];
  const w = h.own(h.factory({ broker: h.b, traffic, telegram: { sendMessage() { calls++; } },
    logger: (...args) => { logs.push(args); throw Error('logger'); } }));
  assert.equal(w.diagnostic(), CREDENTIAL); assert.equal(w.failed, true); assert.equal(logs.length, 0);
  const stopped = w.stop(); assert.equal(w.stop(), stopped); w.start(); await stopped; await turn();
  assert.deepEqual(logs, [[CREDENTIAL]]); assert.equal(calls, 0); assert.equal(traffic.size, 0);
  traffic.stop(); await turn(); assert.equal(logs.length, 1); assert.deepEqual(await promptRows(h), []); await h.b.status();
}));
test('PW-LATER-CAUSE: installed processing diagnostic survives peer credential and contains one throwing log', opts, t => native(t, async h => {
  await h.create(); const traffic = sharedTraffic(), { broker } = observed(h); const logs = [];
  const w = h.start(async () => { throw failure('UNKNOWN'); }, broker, { traffic, logger: (...args) => {
    logs.push(args); throw Error('logger'); } });
  await until(() => w.failed); traffic.stop(); await w.stop(); await turn();
  assert.equal(w.diagnostic(), PROCESSING); assert.deepEqual(logs, [[PROCESSING]]); assert.equal(traffic.size, 0);
  assert.deepEqual(await promptRows(h), []); await quiet(t, h, w, 1); assert.deepEqual(logs, [[PROCESSING]]); await h.b.status();
}));
test('PW-PROCESSING: unexpected scan/admission/receipt/transport stops prompt only, never a fake storage fence', opts, async t => {
  for (const phase of ['scan', 'prepare', 'receipt', 'failure-receipt', 'transport', 'TOKEN_MISSING', 'POLLER_CONFLICT']) await native(t, async h => {
    await h.create(); const traffic = sharedTraffic(); let stops = 0; const peer = () => stops++; traffic.add(peer);
    const explode = () => { throw failure(phase === 'TOKEN_MISSING' || phase === 'POLLER_CONFLICT' ? phase : 'UNKNOWN_PRIVATE_CODE'); };
    const overrides = phase === 'scan' ? { responseWork: explode } : phase === 'prepare' ? { prepareResponsePrompt: explode } :
      phase === 'receipt' ? { recordPromptSent: explode } : phase === 'failure-receipt' ? { recordPromptFailed: explode } : {};
    const { broker, counts } = observed(h, overrides);
    const send = phase === 'failure-receipt' ? () => { throw failure('TELEGRAM_TIMEOUT'); } :
      ['transport', 'TOKEN_MISSING', 'POLLER_CONFLICT'].includes(phase) ? explode : async () => message();
    const w = h.start(send, broker,
      { traffic, logger: (...args) => { h.logs.push(args); throw Error('logger'); } });
    await until(() => w.failed); await selfFenced(t, h, counts); await w.stop(); assert.equal(w.diagnostic(), PROCESSING);
    assert.deepEqual(h.logs, [[PROCESSING]]); assert.equal(stops, 0); assert.deepEqual(await promptRows(h), []);
    await h.b.status(); await quiet(t, h, w, phase === 'scan' || phase === 'prepare' ? 0 : 1, counts);
    traffic.remove(peer); assert.equal(traffic.size, 0);
  });
});
test('PW-STORAGE: actual Journal write and sync faults on success and failure receipts fence core and drain', opts, async t => {
  for (const receipt of ['success', 'failure']) for (const phase of ['write', 'sync']) await native(t, async h => {
    await h.create(); const before = h.b.snapshot(), held = h.defer(), { broker, counts } = observed(h);
    const traffic = sharedTraffic(); let peerStops = 0, attempts = 0; const peer = () => peerStops++; traffic.add(peer);
    const w = h.start(() => held.promise, broker, { traffic, logger: (...args) => { h.logs.push(args); throw Error('logger'); } });
    await until(() => h.calls.length === 1);
    h[phase] = async () => { attempts++; throw Error('actual Journal receipt fault with secret'); };
    held.release(receipt === 'success' ? message() : Promise.reject(failure('TELEGRAM_TIMEOUT')));
    await until(() => w.failed); await selfFenced(t, h, counts); const stopped = w.stop(); assert.equal(w.stop(), stopped); await stopped;
    assert.equal(w.diagnostic(), STORAGE); assert.deepEqual(h.logs, [[STORAGE]]); assert.equal(attempts, 1);
    assert.deepEqual(h.b.snapshot(), before); await assert.rejects(h.b.status(), e => e.code === 'STORAGE_FAILURE');
    assert.equal(peerStops, 0); assert.equal(h.calls[0].signal.aborted, true);
    // A failed sync may leave uncertain bytes, but must never install its receipt.
    if (phase === 'write') assert.deepEqual(await promptRows(h), []);
    await quiet(t, h, w, 1, counts); assert.equal(attempts, 1);
    traffic.remove(peer); assert.equal(traffic.size, 0);
  });
});
test('PW-STOP-FAILURE: stop aborts admitted send and drains held actual failure write/flush without timer or late callback', opts, async t => {
  for (const phase of ['write', 'sync']) await native(t, async h => {
    await h.create(); const result = h.defer(), { broker, counts } = observed(h), before = h.b.snapshot();
    const w = h.start(() => result.promise, broker); await until(() => h.calls.length === 1);
    let held;
    if (phase === 'sync') held = h.holdSync();
    else { const entered = h.defer(), released = h.defer(), write = h.write;
      h.write = async (...args) => { entered.release(); await released.promise; return write(...args); };
      held = { entered: entered.promise, release: released.release };
    }
    result.release(Promise.reject(failure('TELEGRAM_RATE_LIMITED', 30))); await held.entered;
    let drained = false; const stopped = w.stop(); stopped.then(() => { drained = true; }); assert.equal(w.stop(), stopped);
    assert.equal(h.calls[0].signal.aborted, true); await tick(t, 120000); assert.equal(drained, false);
    assert.deepEqual(h.b.snapshot(), before); held.release(); await stopped;
    assert.equal(counts.failures.length, 1); assert.equal((await promptRows(h)).at(-1).error_code, 'rate_limited');
    assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.logs, []); assert.equal(w.failed, false);
    await quiet(t, h, w, 1, counts); assert.deepEqual(h.logs, []);
  });
});
test('PW-STOP-ABORT: hung controlled client cooperates with abort as CANCELLED, no receipt or re-admission', opts, t => native(t, async h => {
  await h.create(); const { broker, counts } = observed(h), traffic = sharedTraffic();
  const w = h.start((_payload, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(cancelled()), { once: true });
  }), broker, { traffic });
  await until(() => h.calls.length === 1); await tick(t, 30000); assert.equal(h.calls.length, 1);
  const stopped = w.stop(); assert.equal(h.calls[0].signal.aborted, true); assert.equal(w.stop(), stopped); await stopped;
  assert.equal(traffic.size, 0); assert.deepEqual(await promptRows(h), []); assert.deepEqual(h.logs, []);
  assert.equal(w.failed, false); await quiet(t, h, w, 1, counts);
}));
test('PW-STOP-BEFORE-START: preaborted worker never scans, constructs transport or installs late work', opts, t => native(t, async h => {
  await h.create(); const { broker, counts } = observed(h); let calls = 0;
  const w = h.own(h.factory({ broker, telegram: { sendMessage() { calls++; } } }));
  const stopped = w.stop(); w.start(); assert.equal(w.stop(), stopped); await stopped; await turn();
  assert.equal(counts.scans, 0); assert.equal(counts.prepares, 0); assert.equal(calls, 0);
  assert.deepEqual(await promptRows(h), []); assert.equal(w.diagnostic(), null);
}));
test('PW-RATE-RESET: floor belongs to one attempt, successful work does not donate its ladder to sibling', opts, t => native(t, async h => {
  await h.create(); const { broker, counts } = observed(h); let n = 0;
  const w = h.start(async () => { n++;
    if (n === 1) throw failure('TELEGRAM_RATE_LIMITED', 5);
    if (n === 2 || n === 4) throw failure('TELEGRAM_TIMEOUT');
    return { ...message(), message_id: 100 + n };
  }, broker);
  await until(() => counts.failures.length === 1); await turn(); await tick(t, 4999); assert.equal(n, 1);
  await tick(t, 1); await until(() => counts.failures.length === 2); await turn();
  await tick(t, 1999); assert.equal(n, 2); await tick(t, 1); await until(() => counts.receipts.length === 1);
  await h.create(); await tick(t, 1000); await until(() => counts.failures.length === 3); await turn();
  await tick(t, 999); assert.equal(n, 4); await tick(t, 1); await until(() => counts.receipts.length === 2);
  assert.equal(n, 5); assert.equal(w.failed, false); await quiet(t, h, w, 5, counts);
}));
test('PW-VALID-DOMAIN: plain/null-prototype complete Messages accept positive safe bounds and ignore extra authority', opts, async t => {
  for (const id of [1, Number.MAX_SAFE_INTEGER]) await native(t, async h => {
    await h.create(); const value = Object.assign(Object.create(null), message(), { message_id: id, date: Number.MAX_SAFE_INTEGER,
      chat: Object.assign(Object.create(null), message().chat), request_capability: 'never-log', resolution: 'approved' });
    const { broker, counts } = observed(h), before = h.b.snapshot(), w = h.start(async () => value, broker);
    await until(() => counts.receipts.length === 1); assert.equal(counts.receipts[0].sent, true);
    assert.equal((await promptRows(h))[0].message_id, id); assert.deepEqual(h.b.snapshot(), before);
    assert.equal(w.failed, false); assert.deepEqual(h.logs, []); await quiet(t, h, w, 1, counts);
  });
});
test('PW-LATE-CREDENTIAL: pending peer notification survives explicit stop, late own rejection cannot duplicate it', opts, t => native(t, async h => {
  await h.create(); const traffic = sharedTraffic(), result = h.defer(), { broker, counts } = observed(h);
  const w = h.start(() => result.promise, broker, { traffic, logger: (...args) => { h.logs.push(args); throw Error('logger'); } });
  await until(() => h.calls.length === 1); traffic.stop(); assert.equal(w.diagnostic(), CREDENTIAL); assert.deepEqual(h.logs, []);
  const stopped = w.stop(); assert.equal(w.stop(), stopped); assert.equal(h.calls[0].signal.aborted, true);
  result.release(Promise.reject(failure('TOKEN_REJECTED'))); await stopped;
  assert.deepEqual(h.logs, [[CREDENTIAL]]); assert.equal(counts.failures.length, 1);
  assert.equal((await promptRows(h))[0].error_code, 'rejected'); await h.b.status();
  await quiet(t, h, w, 1, counts); assert.deepEqual(h.logs, [[CREDENTIAL]]); assert.equal(traffic.size, 0);
}));
