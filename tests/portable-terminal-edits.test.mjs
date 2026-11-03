// TEST ONLY: design5 C2c/7. Controlled clients are not actual Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { terminalEdits, until, turn, message, at } from './support/terminal-edits.mjs';
import { renderPortableRequestMessage } from '../src/telegram/portable-render.js';
import { createPortablePresentationWorker } from '../src/telegram/portable-presentation.js';
import { createTelegramClient, TelegramError } from '../src/telegram/client.js';
import { questionRuntime } from './support/question-runtime.mjs';
const opts = { timeout: 8500 }, run = (t, f) => terminalEdits(t, f);
const rejectLine = 'Telegram question presentation blocked after rejection; repair Telegram access and restart serve';
const invalidLine = 'Telegram question presentation blocked after an invalid response; stop and restart serve';
const receipts = rows => rows.filter(r => ['telegram.controls.retired', 'telegram.status.shown'].includes(r.op));
test('E-CAL: actual terminal producers, separate receipts, clock-free restart derivation', opts, t => run(t, async h => {
  await h.create([7, 8]); assert.deepEqual(h.b.presentationWork().edits.map(e => e.kind), ['controls', 'controls']);
  const count = h.samples(); h.now = NaN; await h.retire();
  for (const e of h.b.presentationWork().edits) assert.equal((await h.b.recordStatusShown(h.fields(e))).shown, true);
  assert.equal(h.samples(), count); assert.equal(receipts(await h.rows()).length, 4); h.now = at; await h.reopen(); assert.deepEqual(h.b.presentationWork().edits, []);
}));
test('E-DEPS: construction requires actual selected writers and both edit methods', opts, () => {
  const broker = Object.fromEntries(['presentationWork', 'preparePresentation', 'recordPresentationSent', 'recordPresentationFailed', 'recordControlsRetired', 'recordStatusShown'].map(k => [k, () => {}]));
  const telegram = Object.fromEntries(['sendMessage', 'editMessageReplyMarkup', 'editMessageText'].map(k => [k, () => {}]));
  for (const name of ['recordControlsRetired', 'recordStatusShown']) assert.throws(() => createPortablePresentationWorker({ broker: { ...broker, [name]: null }, telegram }), TypeError);
  for (const name of ['editMessageReplyMarkup', 'editMessageText']) assert.throws(() => createPortablePresentationWorker({ broker, telegram: { ...telegram, [name]: null } }), TypeError);
});
test('E-ORDER: per-copy retirement flush before exact captured status, sequential pass and no duplicate', opts, t => run(t, async h => {
  await h.create([7, 8]); const held = h.defer(), entered = h.defer(); let active = 0, maximum = 0;
  h.syncing = async () => { entered.release(); await held.promise; };
  h.start(async (_, p) => { maximum = Math.max(maximum, ++active); await turn(); active--; return message(p.message_id); });
  await until(() => h.calls.length === 1); await until(() => entered.settled); t.mock.timers.tick(5000); await turn(); assert.equal(h.calls.length, 1);
  held.release(); await until(() => h.calls.length >= 2); await until(async () => receipts(await h.rows()).length >= 2);
  t.mock.timers.tick(1000); await until(() => h.calls.length >= 4); await until(() => h.b.presentationWork().edits.length === 0);
  assert.equal(maximum, 1);
  for (const id of [7, 8]) {
    const copy = h.calls.filter(c => c.payload.message_id === id);
    assert.deepEqual(copy.map(c => c.method), ['editMessageReplyMarkup', 'editMessageText']);
    assert.deepEqual(copy[0].payload, { chat_id: '81', message_id: id, reply_markup: { inline_keyboard: [] } });
    assert.deepEqual(copy[1].payload, { chat_id: '81', message_id: id, text: renderPortableRequestMessage(h.view()) });
    assert.ok(copy.every(c => c.signal instanceof AbortSignal));
  }
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 4); assert.equal(h.view().telegram_state, 'sent');
}));
for (const kind of ['controls', 'status']) test(`E-INVALID-${kind}: full addressed Message only, tuple-local block`, { timeout: 45000 }, async t => {
  const bad = [true, null, {}, [], { ...message(), message_id: 8 }, { ...message(), date: 0 }, { ...message(), date: '1' },
    ...[0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(message_id => ({ ...message(), message_id })),
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(date => ({ ...message(), date })),
    ...[{ id: 82, type: 'private' }, { id: '81', type: 'private' }, { id: 81, type: 'group' },
      ...[0, -81, 1.5, Number.MAX_SAFE_INTEGER + 1].map(id => ({ id, type: 'private' })), Object.assign([], message().chat),
      Object.assign(new Date(), message().chat)].map(chat => ({ ...message(), chat })), Object.assign([], message()), Object.assign(new Date(), message())];
  for (const [i, value] of bad.entries()) await t.test(String(i), opts, t => run(t, async h => {
    await h.create(); if (kind === 'status') await h.retire(); const before = receipts(await h.rows()).length;
    const w = h.start(async () => value); await until(() => w.diagnostic() !== null); assert.equal(w.diagnostic(), invalidLine);
    t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1); assert.equal(receipts(await h.rows()).length, before);
    assert.equal(h.b.presentationWork().edits[0].kind, kind); assert.equal(h.view().telegram_state, 'sent');
  }));
});
for (const kind of ['controls', 'status']) test(`E-PARTIAL-${kind}: rejection/not-modified blocks only its tuple, sibling finishes`, opts, t => run(t, async h => {
  await h.create([7, 8]); if (kind === 'status') await h.retire();
  h.start(async (_, p) => { if (p.message_id === 7) throw new TelegramError('TELEGRAM_REJECTED', 'message is not modified PRIVATE'); return message(8); });
  await until(() => h.calls.length === 2); t.mock.timers.tick(1000); await until(() => h.b.presentationWork().edits.length === 1);
  assert.deepEqual(h.logs, [rejectLine]); assert.equal(h.b.presentationWork().edits[0].message_id, 7);
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.filter(c => c.payload.message_id === 7).length, 1);
  assert.equal((await h.b.status()).requests[0].resolution, 'cancelled');
}));
test('E-STALE: captured status result discarded across actual acknowledgement, next scan renders new pair', opts, t => run(t, async h => {
  await h.create([7], true); await h.retire(); const captured = h.view(), held = h.defer();
  h.start(async () => h.calls.length === 1 ? held.promise : message()); await until(() => h.calls.length === 1);
  await h.evidence('ack'); held.release(message()); await turn(); await h.b.readRequest(h.key);
  assert.equal(receipts(await h.rows()).filter(r => r.op === 'telegram.status.shown').length, 0);
  assert.equal(h.calls[0].payload.text, renderPortableRequestMessage(captured)); t.mock.timers.tick(1000);
  await until(() => h.b.presentationWork().edits.length === 0); assert.equal(h.calls[1].payload.text, renderPortableRequestMessage(h.view()));
  assert.equal(receipts(await h.rows()).at(-1).delivery_state, 'confirmed');
}));
test('E-LEDGER-FLUSH: status installs before queued acknowledgement, then current pair rederives', opts, t => run(t, async h => {
  await h.create([7], true); await h.retire(); const entered = h.defer(), flush = h.defer();
  h.syncing = async () => { entered.release(); await flush.promise; }; h.start(); await until(() => entered.settled);
  let acknowledged = false; const ack = h.evidence('ack').then(() => { acknowledged = true; });
  await turn(); assert.equal(acknowledged, false); assert.equal(h.view().delivery_state, 'pending');
  flush.release(); await ack; const shown = receipts(await h.rows()).filter(r => r.op === 'telegram.status.shown');
  assert.equal(shown.length, 1); assert.equal(shown[0].delivery_state, 'pending');
  assert.equal(h.b.presentationWork().edits[0].delivery_state, 'confirmed'); t.mock.timers.tick(1000);
  await until(() => h.b.presentationWork().edits.length === 0); assert.equal(h.calls[1].payload.text, renderPortableRequestMessage(h.view()));
}));
for (const kind of ['controls', 'status']) test(`E-LOST-${kind}: aborted unknown receipt stays unfinished and restart rederives safe edit`, opts, t => run(t, async h => {
  await h.create(); if (kind === 'status') await h.retire(); const before = receipts(await h.rows()).length;
  const held = h.defer(), w = h.start(() => held.promise); await until(() => h.calls.length === 1);
  const stop = w.stop(); held.release(Promise.reject(new TelegramError('CANCELLED', 'private'))); await stop;
  assert.equal(receipts(await h.rows()).length, before); await h.reopen(); h.start(); await until(async () => receipts(await h.rows()).length === before + 1);
  assert.equal(h.calls[1].method, kind === 'controls' ? 'editMessageReplyMarkup' : 'editMessageText');
}));
for (const kind of ['controls', 'status']) test(`E-STOP-${kind}: valid admitted result flush drains, no later edit/retry`, opts, t => run(t, async h => {
  await h.create(); if (kind === 'status') await h.retire(); const held = h.defer(), entered = h.defer(), flush = h.defer();
  const w = h.start(() => held.promise); await until(() => h.calls.length === 1); const stop = w.stop(); assert.equal(w.stop(), stop); assert.equal(h.calls[0].signal.aborted, true);
  h.syncing = async () => { entered.release(); await flush.promise; }; held.release(message()); await until(() => entered.settled);
  let done = false; stop.then(() => { done = true; }); await turn(); assert.equal(done, false); flush.release(); await stop;
  assert.equal(receipts(await h.rows()).at(-1).op, kind === 'controls' ? 'telegram.controls.retired' : 'telegram.status.shown');
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1);
}));
test('E-STOP-STALE: late valid old pair creates no completion and no replacement during drain', opts, t => run(t, async h => {
  await h.create([7], true); await h.retire(); const held = h.defer(), w = h.start(() => held.promise);
  await until(() => h.calls.length === 1); await h.evidence('ack'); const stop = w.stop(); held.release(message()); await stop;
  assert.equal(receipts(await h.rows()).filter(r => r.op === 'telegram.status.shown').length, 0);
  t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1); assert.equal(h.b.presentationWork().edits[0].delivery_state, 'confirmed');
}));
test('E-RETRY: per-tuple transient ladder, rate floor, siblings independent, stop clears timers', opts, t => run(t, async h => {
  await h.create([7, 8]); let attempts = 0;
  const w = h.start(async (_, p) => { if (p.message_id === 7) { attempts++; throw new TelegramError('TELEGRAM_RATE_LIMITED', 'private', { retryAfter: 3 }); } return message(8); });
  await until(() => h.calls.length === 2); await turn();
  for (const delay of [3000, 3000, 4000, 8000, 16000, 30000, 30000]) {
    const before = attempts; t.mock.timers.tick(delay - 1); await turn(); assert.equal(attempts, before);
    t.mock.timers.tick(1); await until(() => attempts === before + 1); await turn();
  }
  assert.equal(receipts(await h.rows()).some(r => r.message_id === 7), false); await w.stop(); const count = attempts;
  t.mock.timers.tick(60000); await turn(); assert.equal(attempts, count);
}));
for (const fault of ['unknown', 'storage']) test(`E-FAULT-${fault}: distinct worker stop and redacted diagnostic`, opts, t => run(t, async h => {
  await h.create(); const held = h.defer(), w = h.start(() => held.promise); await until(() => h.calls.length === 1);
  if (fault === 'storage') { h.syncing = async () => { throw new Error('PRIVATE'); }; held.release(message()); }
  else held.release(Promise.reject(new Error('PRIVATE')));
  await until(() => w.failed); assert.deepEqual(h.logs, [fault === 'storage' ? 'Telegram presentation stopped after a storage failure; stop and restart serve' : 'Telegram presentation processing stopped; stop and restart serve']);
  assert.equal(h.b.presentationWork().edits.length, 1); t.mock.timers.tick(60000); await turn(); assert.equal(h.calls.length, 1);
}));
test('E-SEND-FIRST: pending send and terminal edits share one sequential pass', opts, t => run(t, async h => {
  await h.create(); const key = await h.b.reserveHandle({ ownerId: 'a' });
  await h.b.createRequest({ ownerId: 'a', capability: key.request_capability, requestHandle: key.request_handle, clientRequestId: 'pending', action: 'Pending?', context: '', expiresInSeconds: 60 });
  const held = h.defer(), calls = [], client = { sendMessage: async () => { calls.push('send'); return held.promise; },
    editMessageReplyMarkup: async p => { calls.push('controls'); return message(p.message_id); }, editMessageText: async p => { calls.push('status'); return message(p.message_id); } };
  const w = createPortablePresentationWorker({ broker: h.b, telegram: client });
  try { w.start(); await until(() => calls.length === 1); t.mock.timers.tick(1000); await turn(); assert.deepEqual(calls, ['send']);
    held.release(message(9)); await until(() => calls.includes('controls')); assert.deepEqual(calls.slice(0, 2), ['send', 'controls']);
  } finally { held.release(message(9)); await w.stop(); }
}));
for (const method of ['editMessageReplyMarkup', 'editMessageText']) test(`E-CLIENT-${method}: actual fixed-origin call forwards pre/inflight abort`, opts, async () => {
  const original = https.request; let destroyed = 0, payload;
  https.request = (url, options) => { assert.equal(url, `https://api.telegram.org/botsynthetic/${method}`); assert.equal(options.method, 'POST'); const req = new EventEmitter();
    req.setTimeout = ms => assert.equal(ms, 20000); req.destroy = () => { destroyed++; }; req.end = bytes => { payload = JSON.parse(bytes); }; return req; };
  try { const client = createTelegramClient({ token: 'synthetic' }), c = new AbortController();
    const body = { chat_id: '81', message_id: 7, ...(method === 'editMessageText' ? { text: 'terminal' } : { reply_markup: { inline_keyboard: [] } }) };
    const pending = client[method](body, { signal: c.signal }); c.abort();
    const result = await Promise.race([pending.then(() => 'resolved', e => e.code), new Promise(r => setTimeout(() => r('signal not forwarded'), 100))]);
    assert.equal(result, 'CANCELLED'); assert.equal(destroyed, 1); assert.deepEqual(payload, body);
    await assert.rejects(client[method](body, { signal: c.signal }), e => e.code === 'CANCELLED'); assert.equal(destroyed, 1);
  } finally { https.request = original; }
});
test('E-RUNTIME: edit credential rejection fences poll/edit, local wait/cancel remains usable', { timeout: 22000 }, () => questionRuntime(async h => {
  const idle = h.defer(), edited = h.defer(); let pollSignal, editSignal, edits = 0;
  const runtime = await h.start({ updates: (_, { signal }) => { pollSignal = signal; return idle.promise; }, sendMessage: async () => message(),
    editMessageReplyMarkup: (_, { signal }) => { edits++; editSignal = signal; return edited.promise; }, editMessageText: async () => { edits++; return message(); } });
  await until(() => runtime.broker.snapshot().requests[0].telegram_state === 'sent', 2500); await runtime.broker.cancelRequest(h.key);
  await until(() => editSignal, 2500); edited.release(Promise.reject(new TelegramError('TOKEN_REJECTED', 'PRIVATE')));
  await until(() => pollSignal.aborted); assert.equal(editSignal.aborted, true); assert.equal(runtime.ready, true); assert.equal(await h.status(), 200);
  await h.create(); const waiting = runtime.broker.waitRequest(h.key); await runtime.broker.cancelRequest(h.key); assert.equal((await waiting).state, 'terminal');
  await new Promise(r => setTimeout(r, 1100)); assert.equal(edits, 1); assert.ok(h.logs.every(line => !line.includes('PRIVATE')));
}));
for (const localOnly of [true, false]) test(`E-RUNTIME-LOCAL-${localOnly}: tokenless/incomplete UI preserves local service`, { timeout: 22000 }, () => questionRuntime(async h => {
  const idle = h.defer(); let sends = 0;
  const runtime = await h.start(localOnly ? null : { updates: () => idle.promise, sendMessage: async () => { sends++; return message(); }, editMessageText: null, editMessageReplyMarkup: null });
  assert.equal(runtime.ready, true); assert.equal(await h.status(), 200); await runtime.broker.cancelRequest(h.key); assert.equal(sends, 0);
}));
