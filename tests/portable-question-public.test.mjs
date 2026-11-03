// TEST ONLY: real public process/client/Journal. Interception is NOT TLS or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { publicPoller, rows, update, paired } from './support/poller-public.mjs';
import { success } from './support/portable-waiting.mjs';
import { completed } from './support/startup-guards.mjs';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createTelegramClient } from '../src/telegram/client.js';
const opts = { timeout: 28000 };
const message = { message_id: 700, date: 1793577600, chat: { id: 81, type: 'private' } };
const mutations = bytes => rows(bytes).flat();
const sends = r => r.events.filter(e => e.kind === 'request' && e.url.endsWith('/sendMessage'));
const receipts = bytes => mutations(bytes).filter(m => m.op === 'telegram.presentation.sent');
async function setup(h) {
  h.response(h.r, h.initial, [update(7, h.code)]);
  const confirmation = await h.request(h.r, 'sendMessage');
  assert.deepEqual(confirmation.body, { chat_id: '81', text: paired });
  h.response(h.r, confirmation, message);
  const poll = await h.request(h.r, 'getUpdates', 1);
  assert.equal(poll.body.offset, 8);
  const a = await h.connect();
  const p = success(await a.call('prepare_approval', { session_label: 'exact <caller>' }));
  const key = { request_id: p.request_id, request_capability: p.request_capability };
  let settled = false;
  const pending = a.call('request_approval', { request_handle: p.request_handle,
    request_capability: p.request_capability, client_request_id: 'question-public',
    action: 'Proceed <exact>?', context: 'line one\nline two & unchanged', expires_in_seconds: 60 }, { id: 'original', ms: 14000 });
  pending.then(() => { settled = true; });
  const send = await h.request(h.r, 'sendMessage', 1);
  const view = () => a.call('get_approval', key).then(success);
  const cancel = async () => {
    const expected = success(await a.call('cancel_approval', key));
    assert.equal(expected.resolution, 'cancelled'); assert.equal(expected.response_text, null);
    assert.match(expected.decision_id, /^dec_[a-f0-9]{32}$/);
    const outcome = await pending; assert.equal(outcome.frame.id, 'original');
    assert.equal(outcome.frame.result?.isError, false, outcome.frame.result?.structuredContent?.error?.code);
    assert.deepEqual(success(outcome), expected);
    return expected;
  };
  return { a, p, key, pending, send, poll, view, cancel, settled: () => settled };
}
function envelope(send) {
  assert.equal(send.url, 'https://api.telegram.org/botoffline-synthetic-token/sendMessage');
  assert.equal(send.options.method, 'POST'); assert.equal(send.options.agent, false);
  assert.deepEqual(send.options.headers, { 'content-type': 'application/json', accept: 'application/json',
    'content-length': String(Buffer.byteLength(JSON.stringify(send.body))) });
  assert.equal(send.deadline, 20000);
}
async function primary(h, q) {
  envelope(q.send);
  const history = mutations(q.send.bytes), prepared = history.find(m => m.op === 'telegram.presentation.prepare');
  assert.ok(history.some(m => m.op === 'request.create'), 'actual MCP creation, never seeded');
  assert.equal(prepared.request_id, q.p.request_id); assert.match(prepared.callback_token, /^[a-f0-9]{32}$/);
  const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.prepare'));
  assert.ok(commit >= 0 && commit < h.r.events.indexOf(q.send), 'real allocation flush/install BEFORE network admission');
  assert.equal(receipts(q.send.bytes).length, 0);
  const v = await q.view(); assert.equal(v.telegram_state, 'pending'); assert.equal(v.resolution, 'pending');
  assert.deepEqual(q.send.body, { chat_id: '81', text: [`Approval request ${q.p.request_id}`, '',
    'Owner: shared', 'Caller-supplied context (display only, not verified identity): exact <caller>',
    'Action: Proceed <exact>?', 'Context: line one\nline two & unchanged', `Expires: ${v.expires_at}`,
    'Resolution: pending', 'Delivery: not_applicable'].join('\n'), reply_markup: { inline_keyboard: [[
      { text: 'Approve', callback_data: `a:${prepared.callback_token}`, style: 'success' },
      { text: 'Reject', callback_data: `r:${prepared.callback_token}`, style: 'danger' },
      { text: 'Respond', callback_data: `t:${prepared.callback_token}`, style: 'primary' },
    ]] } });
  assert.ok(!JSON.stringify(q.send.body).includes(q.p.request_capability));
  assert.ok(!JSON.stringify(q.send.body).includes(h.code));
  await delay(150); assert.equal(q.settled(), false, 'no receipt/result for original pending call');
}
async function sent(h, q, r = h.r, req = q.send) {
  h.response(r, req, message);
  await h.wait(r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.sent'), 'real sent flush');
  const receipt = receipts(await h.bytes()).at(-1);
  assert.equal(receipt.request_id, q.p.request_id); assert.equal(receipt.chat_id, '81');
  assert.equal(receipt.message_id, 700);
}
const run = (work, mode = '') => publicPoller(work, mode, { mcp: true });
async function cancelRecovered(h, q) {
  const a = await h.connect();
  const v = success(await a.call('get_approval', q.key));
  assert.equal(v.resolution, 'pending'); assert.equal(v.telegram_state, 'sent');
  assert.equal(success(await a.call('cancel_approval', q.key)).resolution, 'cancelled');
  await h.stop(a.resource); a.peer.assertComplete();
}
test('C2PP-DISPLAY: public pair/create -> durable prepare -> exact HTTPS -> full Message -> sent -> original cancellation', opts, () => run(async h => {
  const q = await setup(h); await primary(h, q); await sent(h, q);
  const v = await q.view(); assert.equal(v.telegram_state, 'sent'); assert.equal(v.resolution, 'pending');
  assert.equal(v.decision_id, null); assert.equal(q.settled(), false);
  await q.cancel(); await h.stop(q.a.resource); q.a.peer.assertComplete();
}));
for (const status of [403, 404]) test(`C2PP-REJECT-${status}: request-local rejection leaves poller/local wait/cancel usable and restart eligible`, opts, () => run(async h => {
  const q = await setup(h); envelope(q.send);
  h.response(h.r, q.send, null, { status, raw: JSON.stringify({ ok: false, error_code: status, description: 'SYNTHETIC_PRIVATE_DETAIL' }) });
  await h.wait(h.r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.failed'), 'failed receipt');
  assert.equal((await q.view()).telegram_state, 'failed'); assert.equal(q.settled(), false);
  h.response(h.r, q.poll, [{ update_id: 8 }]);
  const poll = await h.request(h.r, 'getUpdates', 2); assert.equal(poll.body.offset, 9);
  await delay(1100); assert.equal(sends(h.r).length, 2, 'no busy retry or collateral poller shutdown');
  assert.ok(!h.r.output.includes('TOKEN_REJECTED') && !h.r.output.includes('credential rejection'));
  assert.ok(!h.r.output.includes('SYNTHETIC_PRIVATE_DETAIL'));
  await h.stop(q.a.resource); q.a.peer.assertComplete();
  await h.stop(h.r); const r = await h.start(); await h.request(r, 'getUpdates');
  const retry = await h.request(r, 'sendMessage'); envelope(retry); assert.deepEqual(retry.body, q.send.body);
  await sent(h, q, r, retry); await cancelRecovered(h, q); await h.stop(r);
}));
for (const status of [409, 200]) test(`C2PP-MESSAGE409-${status}: actual client refusal blocks A only, B and polling continue`, opts, () => run(async h => {
  const q = await setup(h);
  h.response(h.r, q.send, null, { status, raw: JSON.stringify({ ok: false, error_code: 409, description: 'PRIVATE_409' }) });
  const failed = await h.wait(h.r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.failed'), '409 attempt failure');
  assert.equal(failed.mutations[0].error_code, 'rejected');
  const a = await q.view(); assert.equal(a.telegram_state, 'failed'); assert.equal(a.resolution, 'pending');
  assert.equal(a.decision_id, null); assert.equal(q.settled(), false);
  h.response(h.r, q.poll, [{ update_id: 8 }]);
  assert.equal((await h.request(h.r, 'getUpdates', 2)).body.offset, 9);
  const p = success(await q.a.call('prepare_approval', { session_label: 'healthy sibling' }));
  const pending = q.a.call('request_approval', { request_handle: p.request_handle, request_capability: p.request_capability,
    client_request_id: 'sibling', action: 'B?', context: '', expires_in_seconds: 60 }, { id: 'sibling', ms: 14000 });
  const sibling = await h.request(h.r, 'sendMessage', 2); h.response(h.r, sibling, { ...message, message_id: 701 });
  await h.wait(h.r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.sent'), 'sibling mapping');
  await delay(1200); assert.equal(sends(h.r).length, 3);
  assert.deepEqual(receipts(await h.bytes()).map(m => m.request_id), [p.request_id]);
  assert.equal(h.r.output.split('Telegram question presentation blocked after rejection; repair Telegram access and restart serve').length - 1, 1);
  assert.ok(!/PRIVATE_409|processing stopped|credential rejection/.test(h.r.output));
  const key = { request_id: p.request_id, request_capability: p.request_capability };
  assert.equal(success(await q.a.call('cancel_approval', key)).resolution, 'cancelled');
  assert.equal(success(await pending).resolution, 'cancelled'); await q.cancel();
  await h.stop(q.a.resource); q.a.peer.assertComplete();
}));
test('C2PP-INVALID: ok:true malformed Message never supplies mapping and local cancellation still works', opts, () => run(async h => {
  const q = await setup(h); h.response(h.r, q.send, { message_id: 700, chat: message.chat });
  const failed = await h.wait(h.r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.failed'), 'invalid Message receipt');
  assert.equal(failed.mutations[0].error_code, 'invalid_response'); assert.equal(receipts(await h.bytes()).length, 0);
  await delay(1100); assert.equal(sends(h.r).length, 2); assert.equal((await q.view()).telegram_state, 'failed');
  await q.cancel(); await h.stop(q.a.resource); q.a.peer.assertComplete();
}));
for (const fault of ['rate', 'timeout', 'error']) test(`C2PP-RETRY-${fault}: actual client classification -> durable failure -> same payload recovery`, opts, () => run(async h => {
  const q = await setup(h), at = performance.now();
  if (fault === 'rate') h.response(h.r, q.send, null, { status: 429, raw: JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 2 } }) });
  else h.r.child.send({ kind: 'fault', id: q.send.id, fault });
  const failure = await h.wait(h.r, e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.failed'), 'actual client failure');
  assert.equal(failure.mutations[0].error_code, fault === 'rate' ? 'rate_limited' : 'unavailable');
  const retry = await h.request(h.r, 'sendMessage', 2);
  assert.ok(performance.now() - at >= (fault === 'rate' ? 1900 : 900), 'retry floor observed without clock substitution');
  assert.deepEqual(retry.body, q.send.body); assert.equal(q.settled(), false);
  await sent(h, q, h.r, retry); await q.cancel(); await h.stop(q.a.resource); q.a.peer.assertComplete();
}));
test('C2PP-MAPPED-RESTART: recovered pending mapping suppresses routine resend and public cancellation remains usable', opts, () => run(async h => {
  const q = await setup(h); await sent(h, q); await h.stop(q.a.resource); q.a.peer.assertComplete(); await h.stop(h.r);
  const before = await h.bytes(), r = await h.start(); await h.request(r, 'getUpdates');
  await delay(1200); assert.equal(sends(r).length, 0); assert.equal(await h.bytes(), before);
  await cancelRecovered(h, q); await h.stop(r);
}));
test('C2PP-STOP: actual in-flight abort, late valid transport callback cannot invent receipt or start another send', opts, () => run(async h => {
  const q = await setup(h); await h.stop(q.a.resource);
  h.r.child.send({ kind: 'stop' });
  await h.wait(h.r, e => e.kind === 'destroy' && e.id === q.send.id, 'question HTTPS abort');
  h.response(h.r, q.send, message); assert.equal(await completed(h.r), 0);
  assert.ok(h.r.events.some(e => e.kind === 'response-delivered' && e.id === q.send.id));
  assert.equal(receipts(await h.bytes()).length, 0); assert.equal(sends(h.r).length, 2);
  assert.ok(!mutations(await h.bytes()).some(m => m.op === 'request.cancel'), 'stop does not cancel business request');
}, 'late'));
test('C2PP-DRAIN: admitted valid receipt flush drains before storage close, with no shutdown edit/send', opts, () => run(async h => {
  const q = await setup(h); await h.stop(q.a.resource); h.response(h.r, q.send, message);
  const held = await h.wait(h.r, e => e.kind === 'flush-entered', 'real sent receipt held before fsync');
  assert.equal(receipts(held.bytes).length, 1);
  h.r.child.send({ kind: 'stop' }); await h.wait(h.r, e => e.kind === 'stop-observed', 'stop received');
  assert.equal(h.r.events.some(e => e.kind === 'storage-close'), false);
  h.r.child.send({ kind: 'release' }); assert.equal(await completed(h.r), 0);
  const commit = h.r.events.findIndex(e => e.kind === 'committed' && e.mutations.some(m => m.op === 'telegram.presentation.sent'));
  assert.ok(commit >= 0 && h.r.events.findIndex(e => e.kind === 'storage-close') > commit);
  assert.equal(sends(h.r).length, 2); assert.equal(receipts(await h.bytes()).length, 1);
}, 'receipt-hold'));
for (const origin of ['question', 'poll']) test(`C2PP-CREDENTIAL-${origin}: actual 401 fences both transports without withdrawing local original-call cancellation`, opts, () => run(async h => {
  const q = await setup(h), active = origin === 'question' ? q.send : q.poll;
  h.response(h.r, active, null, { status: 401, raw: JSON.stringify({ ok: false, error_code: 401, description: 'SYNTHETIC_PRIVATE_DETAIL' }) });
  for (const req of [q.send, q.poll]) await h.wait(h.r, e => e.kind === 'destroy' && e.id === req.id, 'shared credential abort');
  if (origin === 'poll') h.response(h.r, q.send, message);
  else h.response(h.r, q.poll, [update(8, h.code), { update_id: 9, callback_query: { id: 'late' } }]);
  await delay(1100); assert.equal(sends(h.r).length, 2);
  assert.equal(h.r.events.filter(e => e.kind === 'request').length, 4, 'no later poll, question, reply or ack');
  assert.equal((await q.view()).resolution, 'pending'); assert.equal(receipts(await h.bytes()).length, 0);
  await q.cancel(); await h.stop(q.a.resource); q.a.peer.assertComplete();
  assert.ok(!h.r.output.includes('SYNTHETIC_PRIVATE_DETAIL'));
}));
test('C2PP-LOST-REPLY: aborted unmapped send stays uncertain and restart may duplicate with same identity/token', opts, () => run(async h => {
  const q = await setup(h); await h.stop(q.a.resource); q.a.peer.assertComplete(); await h.stop(h.r);
  // Interception saw the request, not a platform result. No assertion that Telegram displayed nothing.
  assert.equal(receipts(await h.bytes()).length, 0);
  const r = await h.start(); await h.request(r, 'getUpdates');
  const retry = await h.request(r, 'sendMessage'); assert.deepEqual(retry.body, q.send.body);
  assert.equal(mutations(retry.bytes).filter(m => m.op === 'request.create').length, 1);
  assert.equal(mutations(retry.bytes).filter(m => m.op === 'telegram.presentation.prepare').length, 1);
  await sent(h, q, r, retry); await cancelRecovered(h, q); await h.stop(r);
}));
test('C2PP-PARTIAL-START: timer-construction failure fences async admission and releases owned storage/lock/listener', opts, () => run(async h => {
  const q = await setup(h); await h.stop(q.a.resource); q.a.peer.assertComplete(); await h.stop(h.r);
  const r = await h.start('partial-start'); assert.notEqual(await completed(r), 0);
  assert.ok(r.events.some(e => e.kind === 'startup-fault'), 'injected only at presentation timer construction');
  assert.equal(r.events.filter(e => e.kind === 'request').length, 0, 'stop beats asynchronous poll/send admission');
  assert.ok(r.events.some(e => e.kind === 'storage-close')); assert.equal(sends(r).length, 0);
  await h.stop(r); // Owned lock absence asserted independently of nonzero startup exit.
  const recovered = await h.start(); await h.request(recovered, 'getUpdates');
  const retry = await h.request(recovered, 'sendMessage'); await sent(h, q, recovered, retry);
  await cancelRecovered(h, q); await h.stop(recovered);
}));
// Actual client, not a fake Telegram client. The socket construction is intercepted.
test('C2PP-EDIT-REJECTION: send/edit 403/404 are method rejection, never rejected-token evidence', opts, async t => {
  for (const method of ['sendMessage', 'editMessageText', 'editMessageReplyMarkup']) for (const status of [403, 404]) await t.test(`${method}-${status}`, async () => {
    const original = https.request;
    https.request = (url, options, callback) => {
      assert.equal(url, `https://api.telegram.org/botoffline-synthetic-token/${method}`);
      const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req;
      req.end = () => queueMicrotask(() => {
        const res = new PassThrough(); res.statusCode = status; callback(res);
        res.end(JSON.stringify({ ok: false, error_code: status, description: 'SYNTHETIC_PRIVATE_DETAIL' }));
      }); return req;
    };
    try {
      const client = createTelegramClient({ token: 'offline-synthetic-token' });
      await assert.rejects(client[method]({ chat_id: '81', message_id: 700, text: 'synthetic' }), e => {
        assert.equal(e.code, 'TELEGRAM_REJECTED'); assert.equal(e.retryable, false);
        return true; // Public diagnostic redaction is asserted by the process rejection cases.
      });
    } finally { https.request = original; }
  });
});
