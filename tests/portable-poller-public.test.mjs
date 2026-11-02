// TEST ONLY: design5/7 C1, Bot API10.3. Offline client construction, NOT TLS/human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publicPoller, rows, update, paired } from './support/poller-public.mjs';
import { completed } from './support/startup-guards.mjs';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createTelegramClient } from '../src/telegram/client.js';
const opts = { timeout: 28000 };
const polls = r => r.events.filter(e => e.kind === 'request' && e.url.endsWith('/getUpdates'));
const sends = r => r.events.filter(e => e.kind === 'request' && e.url.endsWith('/sendMessage'));
function envelope(req, method, deadline) {
  assert.equal(req.url, `https://api.telegram.org/botoffline-synthetic-token/${method}`);
  assert.equal(req.options.method, 'POST'); assert.equal(req.options.agent, false);
  assert.equal(req.options.headers['content-type'], 'application/json');
  assert.equal(req.options.headers.accept, 'application/json');
  assert.equal(Number(req.options.headers['content-length']), Buffer.byteLength(JSON.stringify(req.body)));
  assert.equal(req.options.headers.authorization, undefined); assert.equal(req.deadline, deadline);
}
function atomic(req, id = 7) {
  const history = rows(req.bytes); assert.equal(history.length, 2);
  assert.deepEqual(history[0].map(m => m.op), ['pairing.challenge']);
  assert.deepEqual(history[1].map(m => m.op), ['pairing.challenge.consume', 'pairing.set', 'telegram.cursor']);
  assert.equal(history[1][1].pairing.user_id, '71'); assert.equal(history[1][1].pairing.chat_id, '81');
  assert.equal(history[1][2].last_update_id, id); return history;
}
test('C1PP-LIFECYCLE: public challenge -> actual client -> atomic pair -> confirmation -> graceful restart', opts, () => publicPoller(async h => {
  envelope(h.initial, 'getUpdates', 40000);
  assert.deepEqual(h.initial.body, { limit: 100, timeout: 30, allowed_updates: ['message', 'callback_query'] });
  h.response(h.r, h.initial, [update(7, h.code)]);
  const send = await h.request(h.r, 'sendMessage'); envelope(send, 'sendMessage', 20000); atomic(send);
  assert.deepEqual(send.body, { chat_id: '81', text: paired }); assert.equal(send.body.reply_markup, undefined);
  const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'pairing.set'));
  assert.ok(commit >= 0 && commit < h.r.events.indexOf(send), 'actual append completes before confirmation');
  h.response(h.r, send, { message_id: 1 }); const next = await h.request(h.r, 'getUpdates', 1); atomic(next);
  assert.deepEqual(next.body, { ...h.initial.body, offset: 8 });
  await h.stop(h.r); const saved = await h.bytes(); const restarted = await h.start();
  const restored = await h.request(restarted, 'getUpdates'); atomic(restored); assert.equal(restored.body.offset, 8);
  assert.deepEqual(await h.bytes(), saved); const again = await h.cli('pair');
  assert.equal(again.code, 2); assert.match(again.output, /already paired/); assert.deepEqual(await h.bytes(), saved);
  assert.ok(again.events.some(e => e.kind === 'local-response' && e.path === '/v1/pairing' && e.status === 409));
  await h.stop(restarted);
}));
for (const method of ['getUpdates', 'sendMessage', 'answerCallbackQuery']) test(`C1PP-ABORT-${method}: actual in-flight destroy and no late send/admission`, opts, () => publicPoller(async h => {
  let active = h.initial;
  if (method !== 'getUpdates') {
    h.response(h.r, h.initial, method === 'sendMessage' ? [update(7, h.code)] : [{ update_id: 7, callback_query: { id: 'opaque', data: 'a:not-an-approval' } }]);
    active = await h.request(h.r, method); envelope(active, method, 20000);
    if (method === 'sendMessage') atomic(active);
    else { assert.deepEqual(active.body, { callback_query_id: 'opaque' }); assert.deepEqual(rows(active.bytes).at(-1), [{ op: 'telegram.cursor', last_update_id: 7 }]); }
  }
  h.r.child.send({ kind: 'stop' });
  await h.wait(h.r, e => e.kind === 'destroy' && e.id === active.id, 'actual in-flight transport destroyed');
  // Deliver after destroy deliberately. The real client's settled cancellation and poller fence must win.
  h.response(h.r, active, method === 'getUpdates' ? [update(7, h.code)] : true);
  assert.equal(await completed(h.r), 0, h.r.output);
  assert.ok(h.r.events.some(e => e.kind === 'response-delivered' && e.id === active.id), 'late client callback really delivered');
  assert.equal(polls(h.r).length, 1); assert.equal(sends(h.r).length, method === 'sendMessage' ? 1 : 0);
  const history = rows(await h.bytes());
  assert.equal(history.length, method === 'getUpdates' ? 1 : 2);
  assert.equal(history.flat().some(m => m.op === 'pairing.set'), method === 'sendMessage');
  assert.ok(h.r.events.some(e => e.kind === 'storage-close')); await h.stop(h.r);
}, 'late'));
test('C1PP-DRAIN: runtime stop holds real written consuming flush, drains before close and suppresses later update/send', opts, () => publicPoller(async h => {
  h.response(h.r, h.initial, [update(7, h.code), { update_id: 9, message: { from: { id: 71, is_bot: false }, chat: { id: 81, type: 'private' }, text: '/start' } }]);
  const entered = await h.wait(h.r, e => e.kind === 'flush-entered', 'actual consuming flush entered');
  atomic(entered); assert.ok(h.r.events.some(e => e.kind === 'write' && e.bytes === entered.bytes));
  assert.equal(h.r.events.some(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'pairing.set')), false);
  assert.equal(sends(h.r).length, 0); assert.equal(polls(h.r).length, 1);
  h.r.child.send({ kind: 'stop' });
  await h.wait(h.r, e => e.kind === 'destroy' && e.id === h.initial.id, 'stop abort reaches actual client');
  await h.wait(h.r, e => e.kind === 'stop-observed', 'runtime stop invoked');
  assert.equal(h.r.closed, undefined); assert.equal(h.r.events.some(e => e.kind === 'storage-close'), false);
  h.r.child.send({ kind: 'release' }); assert.equal(await completed(h.r), 0, h.r.output);
  const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'pairing.set'));
  const close = h.r.events.findIndex(e => e.kind === 'storage-close'); assert.ok(commit >= 0 && close > commit);
  atomic({ bytes: await h.bytes() }); assert.equal(sends(h.r).length, 0); assert.equal(polls(h.r).length, 1);
  await h.stop(h.r); const restarted = await h.start(); const req = await h.request(restarted, 'getUpdates');
  assert.equal(req.body.offset, 8); atomic(req); await h.stop(restarted);
}, 'hold'));
test('C1PP-UNCOMMITTED: actual failed consuming flush never confirms or advances offset', opts, () => publicPoller(async h => {
  h.response(h.r, h.initial, [update(7, h.code), update(9, h.code)]);
  await h.wait(h.r, e => e.kind === 'flush-entered', 'actual failed flush reached');
  // Status is not proof of commit. It only establishes the documented storage fence.
  const status = await h.cli('status', '--json'); assert.notEqual(status.code, 0);
  assert.equal(sends(h.r).length, 0); assert.equal(polls(h.r).length, 1);
  assert.equal(h.r.events.filter(e => e.kind === 'append-entered').length, 2);
  assert.equal(h.r.events.some(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'pairing.set')), false);
  await h.stop(h.r);
}, 'fail'));
test('C1PP-RAW: parsed raw identity/grammar refusals silent and quota-free, sorted gaps/stale/unsupported cursor only', opts, () => publicPoller(async h => {
  const bot = update(3, h.code); bot.message.from.is_bot = 'false';
  const sender = update(10, h.code); sender.message.from.id = '71';
  const chat = update(20, h.code); chat.message.chat.id = '81';
  const group = update(30, h.code); group.message.chat.type = 'group';
  const grammar = update(40, h.code); grammar.message.text = `/pair  ${h.code}`;
  const suffix = update(50, h.code); suffix.message.text += '\n';
  // Six refusals for the same synthetic tuple must not consume its five-attempt quota.
  h.response(h.r, h.initial, [update(90, h.code), suffix, group, chat, grammar, sender, bot, { update_id: 60, edited_message: { text: 'unsupported' } }]);
  const send = await h.request(h.r, 'sendMessage'); assert.deepEqual(send.body, { chat_id: '81', text: paired });
  const history = rows(send.bytes); assert.equal(history.length, 9);
  assert.deepEqual(history.slice(1, -1), [3, 10, 20, 30, 40, 50, 60].map(last_update_id => [{ op: 'telegram.cursor', last_update_id }]));
  assert.deepEqual(history.at(-1).map(m => m.op), ['pairing.challenge.consume', 'pairing.set', 'telegram.cursor']);
  h.response(h.r, send, { message_id: 1 }); const next = await h.request(h.r, 'getUpdates', 1); assert.equal(next.body.offset, 91);
  h.response(h.r, next, [{ update_id: 100 }, update(90, h.code), update(20, h.code)]);
  const final = await h.request(h.r, 'getUpdates', 2); assert.equal(final.body.offset, 101);
  assert.deepEqual(rows(final.bytes).slice(0, -1), history);
  assert.deepEqual(rows(final.bytes).at(-1), [{ op: 'telegram.cursor', last_update_id: 100 }]);
  assert.equal(sends(h.r).length, 1); await h.stop(h.r);
}));
for (const kind of ['envelope', 'id-string', 'id-successor', 'member']) test(`C1PP-BATCH-${kind}: actual result envelope validates entirely before effects`, opts, () => publicPoller(async h => {
  const invalid = kind === 'envelope' ? {} : [update(7, h.code), kind === 'member' ? null : { update_id: kind === 'id-string' ? '9' : Number.MAX_SAFE_INTEGER }];
  h.response(h.r, h.initial, invalid);
  const next = await h.request(h.r, 'getUpdates', 1);
  assert.deepEqual(next.body, h.initial.body); assert.deepEqual(rows(next.bytes).map(r => r.map(m => m.op)), [['pairing.challenge']]);
  assert.equal(sends(h.r).length, 0); assert.equal(h.r.events.filter(e => e.kind === 'append-entered').length, 1);
  await h.stop(h.r);
}));
for (const status of [401, 409]) test(`C1PP-FATAL-${status}: actual token/conflict envelope stops polling, local status remains available`, opts, () => publicPoller(async h => {
  h.response(h.r, h.initial, null, { status, raw: JSON.stringify({ ok: false, error_code: status, description: 'SYNTHETIC_PRIVATE_DETAIL' }) });
  await h.wait(h.r, e => e.kind === 'destroy' && e.id === h.initial.id, 'terminal client signal');
  const local = await h.cli('status', '--json'); assert.equal(local.code, 0); assert.deepEqual(JSON.parse(local.output), { schema_version: 1, requests: [] });
  await h.stop(h.r); assert.equal(polls(h.r).length, 1); assert.equal(sends(h.r).length, 0);
  assert.deepEqual(rows(await h.bytes()).map(r => r.map(m => m.op)), [['pairing.challenge']]);
  assert.ok(!h.r.output.includes('SYNTHETIC_PRIVATE_DETAIL'));
  assert.ok(h.r.events.filter(e => e.kind === 'request').every(e => e.url.endsWith('/getUpdates')), 'no deleteWebhook or drop updates');
}));
for (const method of ['sendMessage', 'answerCallbackQuery']) for (const status of [400, 401, 409]) test(`C1PP-UI-${method}-${status}: postcommit rejection cannot roll back, replay or falsely confirm`, opts, () => publicPoller(async h => {
  h.response(h.r, h.initial, method === 'sendMessage' ? [update(7, h.code)] : [{ update_id: 7, callback_query: { id: 'opaque' } }]);
  const ui = await h.request(h.r, method); const committed = rows(ui.bytes);
  assert.equal(committed.at(-1).at(-1).last_update_id, 7);
  h.response(h.r, ui, null, { status, raw: JSON.stringify({ ok: false, error_code: status, description: 'SYNTHETIC_PRIVATE_DETAIL' }) });
  if (status === 400) { const next = await h.request(h.r, 'getUpdates', 1); assert.equal(next.body.offset, 8); assert.deepEqual(rows(next.bytes), committed); }
  else await h.wait(h.r, e => e.kind === 'destroy' && e.id === ui.id, 'fatal UI abort');
  const local = await h.cli('status', '--json'); assert.equal(local.code, 0);
  await h.stop(h.r); assert.equal(polls(h.r).length, status === 400 ? 2 : 1);
  assert.equal(h.r.events.filter(e => e.kind === 'request' && !e.url.endsWith('/getUpdates')).length, 1, 'one attempted UI transport, not receipt');
  assert.deepEqual(rows(await h.bytes()), committed); assert.ok(!h.r.output.includes('SYNTHETIC_PRIVATE_DETAIL'));
  assert.ok(h.r.output.includes(status === 400 ? 'TELEGRAM_REJECTED' : status === 401 ? 'TOKEN_REJECTED' : 'POLLER_CONFLICT'));
}));
// Native actual-client response/error classification. No fake Telegram client or socket.
test('C1PP-CLIENT: actual response envelopes/errors classify without waiting production deadlines', opts, async t => {
  const cases = [
    { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 45 } }, code: 'TELEGRAM_RATE_LIMITED', retry: true, after: 45 },
    { status: 400, body: { ok: false, parameters: { retry_after: 2 } }, code: 'TELEGRAM_RATE_LIMITED', retry: true, after: 2 },
    ...[401, 403, 404].map(status => ({ status, body: { ok: false }, code: 'TOKEN_REJECTED' })),
    { status: 409, body: { ok: false }, code: 'POLLER_CONFLICT' },
    { status: 503, body: { ok: false }, code: 'TELEGRAM_UNAVAILABLE', retry: true },
    { status: 400, body: { ok: false }, code: 'TELEGRAM_REJECTED' },
    { raw: '{', code: 'TELEGRAM_UNAVAILABLE', retry: true },
    ...['request-error', 'response-error', 'timeout'].map(fault => ({ fault, code: fault === 'timeout' ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_UNAVAILABLE', retry: true })),
  ];
  for (const [index, sample] of cases.entries()) await t.test(`${index}-${sample.code}`, async () => {
    const original = https.request; let destroyed = 0, calls = 0;
    https.request = (url, options, callback) => {
      calls++; const req = new EventEmitter(); let deadline, timeout;
      req.setTimeout = (ms, cb) => { deadline = ms; timeout = cb; };
      req.destroy = () => { destroyed++; };
      req.end = bytes => {
        envelope({ url, options, deadline, body: JSON.parse(String(bytes)) }, 'getUpdates', 40000);
        queueMicrotask(() => {
          if (sample.fault === 'timeout') { timeout(); return; }
          if (sample.fault === 'request-error') { req.emit('error', Error('synthetic')); return; }
          const res = new PassThrough(); res.statusCode = sample.status ?? 200; callback(res);
          if (sample.fault === 'response-error') res.destroy(Error('synthetic'));
          else res.end(sample.raw ?? JSON.stringify(sample.body));
        });
      }; return req;
    };
    try {
      await assert.rejects(createTelegramClient({ token: 'offline-synthetic-token' }).updates(null), error => {
        assert.equal(error.code, sample.code); assert.equal(error.retryable, sample.retry ?? false);
        assert.equal(error.retryAfter, sample.after ?? null); return true;
      });
      assert.equal(calls, 1); assert.equal(destroyed, sample.fault === 'timeout' ? 1 : 0);
    } finally { https.request = original; }
  });
});
