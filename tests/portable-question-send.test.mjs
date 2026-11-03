// TEST ONLY: design5/7 C2. Native client controls are NOT Telegram receipt/public proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, open, readFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { renderPortableRequestMessage } from '../src/telegram/portable-render.js';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createTelegramClient, TelegramError } from '../src/telegram/client.js';
import { questionRuntime } from './support/question-runtime.mjs';
const opts = { timeout: 9000 }, at = Date.parse('2026-11-02T00:00:00Z'), token = 'a'.repeat(32);
const realTimer = setTimeout, realClear = clearTimeout, turn = () => new Promise(r => setImmediate(r));
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const message = () => ({ message_id: 7, date: 1793577600, chat: { id: 81, type: 'private' } });
const processing = 'Telegram presentation processing stopped; stop and restart serve';
const invalid = 'Telegram question presentation blocked after an invalid response; stop and restart serve';
async function until(check, detail = () => 'bounded condition not reached') { const deadline = performance.now() + 1500; while (performance.now() < deadline) { if (await check()) return; await turn(); } assert.fail(detail()); }
async function native(t, work, load = true) {
  const factory = load ? (await import('../src/telegram/portable-presentation.js')).createPortablePresentationWorker : null;
  const root = resolve('.scratch/c2b'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  let b, j, file, worker, timer; const releases = [], logs = [], calls = [];
  const h = { factory, now: at, sync: async () => {}, calls, logs,
    defer() { const held = gate(); releases.push(held.release); return held; },
    get b() { return b; }, get worker() { return worker; }, rows: async () => readJournal(await readFile(path)).transactions.flatMap(x => x.mutations),
    holdSync() { const entered = gate(), held = gate(); releases.push(held.release);
      h.sync = async () => { entered.release(); await held.promise; }; return { entered: entered.promise, release: held.release }; },
    async create() { const key = await b.reserveHandle({ ownerId: 'a' }); h.key = { ownerId: 'a', requestId: key.request_id, capability: key.request_capability };
      return (await b.createRequest({ ownerId: 'a', capability: key.request_capability, requestHandle: key.request_handle,
        clientRequestId: 'x', action: 'Question? <&>', context: '', expiresInSeconds: 60 })).request; },
    start(send = async () => message(), broker = b) {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at });
      worker = factory({ broker, telegram: { sendMessage: (payload, options) => { calls.push({ payload, ...options }); return send(payload, options); } }, logger: x => logs.push(x) });
      assert.equal(worker.diagnostic(), null); assert.equal(worker.failed, false); assert.equal(worker.start(), undefined); return worker;
    } };
  try {
    j = await Journal.open(path); await j.close(); file = await open(path, 'a');
    j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.sync(); await file.sync(); }, close: () => file.close() }, 0);
    let tokens = 0;
    b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => h.now, generateCallbackToken: () => ++tokens === 1 ? token : tokens.toString(16).padStart(32, '0') });
    await b.recover(); const c = await b.pairingChallenge(); await b.completePairing({ code: c.code, userId: '71', chatId: '81', updateId: 1 });
    await Promise.race([work(h), new Promise((_, reject) => { timer = realTimer(() => reject(new Error('C2b aggregate deadline')), 6000); })]);
  } finally {
    for (const release of releases) release(); h.sync = async () => {};
    try { if (worker) { const p = worker.stop(); assert.equal(worker.stop(), p); await p; assert.equal(worker.stop(), p); } }
    finally { t.mock.timers.reset(); realClear(timer); await b?.close(); await j?.close(); await file?.close().catch(() => {});
      await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
  }
}
test('C2B-CAL: real create/prepare and durable Journal control', opts, t => native(t, async h => {
  const request = await h.create(); const prepared = await h.b.preparePresentation({ requestId: request.request_id });
  assert.equal(prepared.callback_token, token); assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.prepare');
  assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
}, false));
test('C2B-CAL-WRITER: actual sync hold prevents installation until release', opts, t => native(t, async h => {
  const hold = h.holdSync(), before = h.b.snapshot(); let done = false;
  const writing = h.b.reserveHandle({ ownerId: 'a' }).then(value => { done = true; return value; });
  await hold.entered; await turn(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before);
  hold.release(); assert.ok((await writing).request_id);
}, false));
test('C2B-CAL-TIMERS: native mock covers both scheduling primitives and Date', opts, t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at }); let scans = 0, retries = 0;
  const interval = setInterval(() => { scans++; }, 1000); setTimeout(() => { retries++; }, 3000);
  try { t.mock.timers.tick(3000); assert.equal(scans, 3); assert.equal(retries, 1); assert.equal(Date.now(), at + 3000); }
  finally { clearInterval(interval); t.mock.timers.reset(); }
});
test('C2B-DEPENDENCIES: selected factory rejects missing dependencies', opts, async () => {
  const { createPortablePresentationWorker: factory } = await import('../src/telegram/portable-presentation.js');
  const broker = Object.fromEntries(['presentationWork', 'preparePresentation', 'recordPresentationSent', 'recordPresentationFailed'].map(k => [k, () => {}]));
  for (const name of Object.keys(broker)) assert.throws(() => factory({ broker: { ...broker, [name]: null }, telegram: { sendMessage() {} } }), TypeError);
  for (const args of [undefined, {}, { broker }, { broker, telegram: {} }]) assert.throws(() => factory(args), TypeError);
});
test('C2B-SEND: prepare flush before exact payload, one admitted send, receipt is not approval', opts, t => native(t, async h => {
  const request = await h.create(), hold = h.holdSync(), result = h.defer();
  const w = h.start(() => result.promise); w.start(); await hold.entered; assert.equal(h.calls.length, 0);
  hold.release(); await until(() => h.calls.length === 1); t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 1);
  assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.prepare');
  assert.deepEqual(h.calls[0].payload, { chat_id: '81', text: renderPortableRequestMessage(request), reply_markup: { inline_keyboard: [[
    { text: 'Approve', callback_data: `a:${token}`, style: 'success' }, { text: 'Reject', callback_data: `r:${token}`, style: 'danger' },
    { text: 'Respond', callback_data: `t:${token}`, style: 'primary' } ]] } });
  assert.ok(h.calls[0].signal instanceof AbortSignal); result.release(message()); await until(() => h.b.snapshot().requests[0].telegram_state === 'sent');
  t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 1);
  const view = h.b.snapshot().requests[0]; assert.equal(view.resolution, 'pending'); assert.equal(view.telegram_state, 'sent'); assert.equal(view.decision_id, null);
}));
test('C2B-FRESH: snapshot only selects request_id, preparation supplies all actual send data', opts, t => native(t, async h => {
  const request = await h.create(); let scans = 0;
  const broker = { presentationWork() { scans++; return { sends: [{ request_id: request.request_id, chat_id: 'evil', callback_token: 'evil', request: {} }] }; },
    preparePresentation: a => h.b.preparePresentation(a), recordPresentationSent: a => h.b.recordPresentationSent(a), recordPresentationFailed: a => h.b.recordPresentationFailed(a) };
  h.start(undefined, broker); await until(() => h.calls.length === 1); assert.equal(h.calls[0].payload.chat_id, '81');
  assert.match(h.calls[0].payload.text, /Question\? <&>/); await until(() => h.b.snapshot().requests[0].telegram_state === 'sent');
  assert.equal(scans, 1);
}));
for (const mode of ['reservation', 'due', 'cancelled']) test(`C2B-SKIP-${mode}: fresh eligibility prevents sends`, opts, t => native(t, async h => {
  if (mode === 'reservation') await h.b.reserveHandle({ ownerId: 'a' });
  else { await h.create(); if (mode === 'due') h.now += 60000; else await h.b.cancelRequest(h.key); }
  const w = h.start(); await turn(); await w.stop(); assert.equal(h.calls.length, 0);
  assert.equal((await h.rows()).some(x => x.op === 'telegram.presentation.sent'), false);
}));
test('C2B-STOP-PREPARE: held allocation drains but cannot admit a send', opts, t => native(t, async h => {
  await h.create(); const hold = h.holdSync(), w = h.start(); await hold.entered;
  const p = w.stop(); let done = false; p.then(() => { done = true; }); await turn(); assert.equal(done, false);
  hold.release(); await p; t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 0);
}));
test('C2B-STOP-LATE: abort is synchronous, admitted valid result flushes before shared drain', opts, t => native(t, async h => {
  await h.create(); const result = h.defer(), w = h.start(() => result.promise); await until(() => h.calls.length === 1);
  const hold = h.holdSync(), p = w.stop(); assert.equal(h.calls[0].signal.aborted, true); assert.equal(w.stop(), p);
  result.release(message()); await hold.entered; let done = false; p.then(() => { done = true; }); await turn(); assert.equal(done, false);
  hold.release(); await p; assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.sent'); assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
}));
test('C2B-STOP-ABORT: no valid result means no synthetic receipt', opts, t => native(t, async h => {
  await h.create(); const w = h.start((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { code: 'CANCELLED' })), { once: true })));
  await until(() => h.calls.length === 1); await w.stop(); assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.prepare');
}));
test('C2B-UNKNOWN: unexpected exception is processing failure, never invented receipt', opts, t => native(t, async h => {
  await h.create(); const w = h.start(async () => { throw new Error('private platform secret'); });
  await until(() => w.failed); assert.equal(w.diagnostic(), processing); assert.deepEqual(h.logs, [processing]);
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1); assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.prepare');
}));
test('C2B-INVALID: full Message admission, exact numeric target, no coercion', opts, async t => {
  const bad = [null, [], {}, Object.assign([], message()), { ...message(), date: 0 }, { ...message(), date: '1' }, { ...message(), date: 1.5 },
    { ...message(), date: Number.MAX_SAFE_INTEGER + 1 }, { ...message(), message_id: 0 }, { ...message(), message_id: -1 }, { ...message(), message_id: 1.5 },
    { ...message(), message_id: Number.MAX_SAFE_INTEGER + 1 }, { ...message(), message_id: '7' },
    ...[{ id: 81, type: 'group' }, { id: '81', type: 'private' }, { id: 82, type: 'private' }, { id: -81, type: 'private' },
      { id: 1.5, type: 'private' }, { id: Number.MAX_SAFE_INTEGER + 1, type: 'private' }, Object.assign([], message().chat), []].map(chat => ({ ...message(), chat }))];
  for (const [n, value] of bad.entries()) await t.test(String(n), opts, t => native(t, async h => {
    await h.create(); const w = h.start(async () => value); await until(() => w.diagnostic() === invalid);
    assert.equal((await h.rows()).at(-1).error_code, 'invalid_response'); assert.equal(w.diagnostic(), invalid); assert.deepEqual(h.logs, [invalid]);
    t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1); assert.equal(h.b.snapshot().requests[0].resolution, 'pending');
  }));
});
test('C2B-STORAGE: actual receipt sync failure retains core fence and fixed diagnostic', opts, t => native(t, async h => {
  await h.create(); const result = h.defer(), w = h.start(() => result.promise); await until(() => h.calls.length === 1);
  h.sync = async () => { throw new Error('synthetic private sync fault'); }; result.release(message());
  await until(() => w.failed); assert.equal(w.diagnostic(), 'Telegram presentation stopped after a storage failure; stop and restart serve');
  await assert.rejects(h.b.status(), e => e.exitCode === 4); assert.equal(h.b.snapshot().requests[0].telegram_state, 'pending');
}));
test('C2B-CLIENT: UI403/404 are generic rejection, polling/ack credential classification unchanged', opts, async () => {
  const original = https.request; let status = 403;
  https.request = (_, options, callback) => { assert.equal(options.method, 'POST'); const request = new EventEmitter();
    request.setTimeout = () => {}; request.destroy = () => {}; request.end = () => {
      const response = new EventEmitter(); response.statusCode = status; callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ ok: false, error_code: status, description: 'synthetic' }))); response.emit('end');
    }; return request; };
  try { const client = createTelegramClient({ token: 'synthetic-token' });
    for (status of [403, 404]) for (const method of ['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'updates', 'answerCallbackQuery'])
      await assert.rejects(client[method]({}), e => e.code === (['updates', 'answerCallbackQuery'].includes(method) ? 'TOKEN_REJECTED' : 'TELEGRAM_REJECTED'));
  } finally { https.request = original; }
});
test('C2B-RETRY: only classified transient failures retry, suppression survives scan ticks', opts, t => native(t, async h => {
  await h.create(); let attempt = 0;
  h.start(async () => { attempt++; if (attempt <= 3) throw new TelegramError('TELEGRAM_RATE_LIMITED', 'synthetic', { retryable: true, retryAfter: 3 }); return message(); });
  for (let n = 1; n <= 3; n++) {
    await until(async () => (await h.rows()).filter(x => x.op === 'telegram.presentation.failed').length === n);
    await h.b.readRequest(h.key); await turn(); t.mock.timers.tick(2999); await turn(); assert.equal(h.calls.length, n);
    t.mock.timers.tick(n === 3 ? 1001 : 1); await until(() => h.calls.length === n + 1);
  }
  await until(() => h.b.snapshot().requests[0].telegram_state === 'sent');
  assert.deepEqual((await h.rows()).filter(x => x.op === 'telegram.presentation.failed').map(x => x.error_code), ['rate_limited', 'rate_limited', 'rate_limited']);
}));
test('C2B-REJECTED: terminal request rejection suppresses scans but local core stays usable', opts, t => native(t, async h => {
  await h.create(); const w = h.start(async () => { throw new TelegramError('TELEGRAM_REJECTED', 'synthetic'); });
  await until(() => w.diagnostic() !== null);
  assert.equal((await h.rows()).at(-1).error_code, 'rejected'); assert.equal(w.diagnostic(), 'Telegram question presentation blocked after rejection; repair Telegram access and restart serve');
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1);
  assert.equal((await h.b.readRequest(h.key)).resolution, 'pending'); assert.equal((await h.b.cancelRequest(h.key)).resolution, 'cancelled');
}));
test('C2B-EXTRAS-LATE: unknown Message data gives no decision authority after cancellation', opts, t => native(t, async h => {
  await h.create(); const result = h.defer(); h.start(() => result.promise); await until(() => h.calls.length === 1);
  await h.b.cancelRequest(h.key); const before = h.b.snapshot().requests[0];
  result.release({ ...message(), decision_id: 'fake', approved: true, request_capability: 'fake' });
  await until(() => h.b.snapshot().requests[0].telegram_state === 'sent');
  assert.deepEqual(h.b.snapshot().requests[0], { ...before, telegram_state: 'sent' });
}));
test('C2B-HELP: exact activation copy without decision availability claim', opts, () => {
  const result = spawnSync(process.execPath, ['bin/proceed-mcp.js', '--help'], { timeout: 3000, encoding: 'utf8', maxBuffer: 65536, windowsHide: true });
  assert.ifError(result.error); assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('Local waiting and Telegram question display are available. Human approvals, rejections and responses are not recorded in this setup stage yet.'));
});

for (const rejected of [false, true]) test(`C2B-REJECTION-001-${rejected ? 'rejected' : 'healthy'}: A does not stop healthy sibling B or later C`, opts, t => native(t, async h => {
  const a = await h.create(), aKey = { ...h.key }, b = await h.create();
  h.start(async payload => { if (rejected && payload.reply_markup.inline_keyboard[0][0].callback_data === `a:${token}`) throw new TelegramError('TELEGRAM_REJECTED', 'synthetic'); return { ...message(), message_id: h.calls.length }; });
  await until(async () => (await h.rows()).some(x => x.op === (rejected ? 'telegram.presentation.failed' : 'telegram.presentation.sent')));
  await until(() => h.calls.length === 2, () => `request rejection must not terminate the pass before B: actual attempts ${h.calls.length}, expected 2`);
  await until(() => h.b.snapshot().requests.find(x => x.request_id === b.request_id).telegram_state === 'sent');
  const c = await h.create(); t.mock.timers.tick(1000);
  await until(() => h.calls.length === 3);
  await until(() => h.b.snapshot().requests.find(x => x.request_id === c.request_id).telegram_state === 'sent');
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 3, 'A remains blocked, mapped siblings are not resent');
  assert.equal((await h.b.readRequest(aKey)).resolution, 'pending');
  assert.equal(h.b.snapshot().requests.find(x => x.request_id === a.request_id).telegram_state, rejected ? 'failed' : 'sent');
  assert.ok(c.request_id);
}));

for (const code of ['TELEGRAM_UNAVAILABLE', 'TELEGRAM_RATE_LIMITED']) test(`C2B-STOP-001-${code}: admitted failure drains without scheduling after stop`, opts, t => native(t, async h => {
  await h.create(); const result = h.defer(), w = h.start(() => result.promise); await until(() => h.calls.length === 1);
  const hold = h.holdSync(); result.release(Promise.reject(new TelegramError(code, 'synthetic', { retryable: true, retryAfter: 3 })));
  await hold.entered; const p = w.stop(); let drained = false; p.then(() => { drained = true; });
  await turn(); assert.equal(drained, false, 'stop must await admitted failure flush');
  const timers = [], timeout = globalThis.setTimeout, interval = globalThis.setInterval;
  globalThis.setTimeout = (...args) => { timers.push('timeout'); return timeout(...args); };
  globalThis.setInterval = (...args) => { timers.push('interval'); return interval(...args); };
  try { hold.release(); await p; assert.equal((await h.rows()).at(-1).op, 'telegram.presentation.failed');
    t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1);
    assert.deepEqual(timers, [], 'draining failure must not allocate any new timer');
  } finally { globalThis.setTimeout = timeout; globalThis.setInterval = interval; }
}));

test('C2B-STOP-001-runtime: synchronously fence BOTH workers before either held drain', { timeout: 22000 }, () => questionRuntime(async h => {
  const poll = h.defer(), send = h.defer(); let pollSignal, sendSignal;
  const runtime = await h.start({ updates: (_, { signal }) => { pollSignal = signal; return poll.promise; },
    sendMessage: (_, { signal }) => { sendSignal = signal; return send.promise; } });
  await until(() => sendSignal); const entered = h.defer(), flush = h.defer();
  h.sync(async () => { entered.release(); await flush.promise; });
  let closed = false; const close = runtime.broker.close.bind(runtime.broker);
  runtime.broker.close = () => { closed = true; return close(); };
  const stop = runtime.stop(); assert.equal(runtime.stop(), stop);
  const fenced = [pollSignal.aborted, sendSignal.aborted];
  send.release(message());
  await boundedGate(entered.promise); assert.equal(closed, false, 'receipt sync must precede core close');
  poll.release([]); flush.release(); await stop;
  assert.equal(runtime.broker.snapshot().requests[0].telegram_state, 'sent', 'admitted valid late Message still installs');
  assert.deepEqual(fenced, [true, true], 'both transport fences must be synchronous, not poller-drain sequential');
}));

async function boundedGate(promise) {
  let timer; try { await Promise.race([promise, new Promise((_, reject) => { timer = realTimer(() => reject(new Error('receipt gate deadline')), 1500); })]); }
  finally { realClear(timer); }
}
for (const origin of ['healthy', 'presentation', 'poller']) test(`C2B-CREDENTIAL-001-${origin}: actual runtime shares traffic fence, not local authority fence`, { timeout: 22000 }, () => questionRuntime(async h => {
  const poll = h.defer(), idle = h.defer(), send = h.defer(); let pollSignal, sendSignal, polls = 0, sends = 0;
  const runtime = await h.start({ updates: (_, { signal }) => { polls++; pollSignal ??= signal; return polls === 1 ? poll.promise : idle.promise; },
    sendMessage: (_, { signal }) => { sends++; sendSignal ??= signal; return sends === 1 ? send.promise : idle.promise; } });
  await until(() => sendSignal);
  if (origin !== 'healthy') {
    (origin === 'presentation' ? send : poll).release(Promise.reject(new TelegramError('TOKEN_REJECTED', 'synthetic')));
    await until(() => h.logs.some(line => origin === 'presentation' ? line.includes('credential rejection') : line.includes('TOKEN_REJECTED')));
  }
  const fenced = [pollSignal.aborted, sendSignal.aborted];
  if (origin !== 'presentation') { send.release(message()); await until(() => runtime.broker.snapshot().requests[0].telegram_state === 'sent'); }
  else poll.release([]);
  assert.equal(runtime.ready, true); assert.equal(await h.status(), 200);
  const waiting = runtime.broker.waitRequest(h.key);
  assert.equal((await runtime.broker.cancelRequest(h.key)).resolution, 'cancelled');
  assert.equal((await waiting).request.resolution, 'cancelled', 'local wait/cancel survive credential rejection');
  await h.create();
  await new Promise(r => realTimer(r, 1100));
  assert.deepEqual([polls, sends], origin === 'healthy' ? [1, 2] : [1, 1], 'only healthy runtime may admit new Telegram traffic');
  assert.deepEqual(fenced, origin === 'healthy' ? [false, false] : [true, true], 'only credential rejection must abort both actual worker transports');
}));
