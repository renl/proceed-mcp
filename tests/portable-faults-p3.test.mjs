// TEST ONLY: assembled public MCP/client proof, offline Telegram, real Journal.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJournal } from '../src/journal/framing.js';
import { portable, success, ask, get, until } from './support/portable-waiting.mjs';

const opts = { timeout: 65000 };
const rows = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.map(t => t.mutations);
const records = async (h, op) => (await rows(h)).flat().filter(m => m.op === op);
const cursor = (h, id) => until(async () => (await records(h, 'telegram.cursor')).some(m => m.last_update_id === id), 'committed cursor', h.signal);
const barrier = async h => cursor(h, h.fixture.enqueue({ message: null }));
const mapped = (h, p, prompt = false) => until(() => h.fixture.messages.find(m => m.text.includes(p.request_id)
  && (prompt ? m.reply_markup?.force_reply : m.reply_markup?.inline_keyboard)), 'actual produced message', h.signal);
const begin = async (h, id) => {
  const p = await h.prepare(), wait = ask(h.shared, p, id), message = await mapped(h, p);
  await until(async () => (await records(h, 'telegram.presentation.sent')).some(m => m.request_id === p.request_id), 'mapping installed', h.signal);
  return { p, wait, message, id };
};
const outcome = async (h, e, kind, text = null) => {
  const response = await e.wait.outcome;
  assert.equal(response.frame?.id, e.id, 'original invocation owns exact RPC response');
  const value = success(response);
  assert.equal(value.request_id, e.p.request_id);
  assert.equal(value.resolution, kind); assert.equal(value.response_text, text);
  const winners = (await records(h, 'request.resolve.telegram')).filter(m => m.request_id === e.p.request_id);
  assert.equal(winners.length, 1); assert.equal(winners[0].decision_id, value.decision_id);
  const transaction = (await rows(h)).find(ms => ms.some(m => m.decision_id === value.decision_id && m.op === 'request.resolve.telegram'));
  assert.deepEqual(transaction.map(m => m.op).sort(), ['request.resolve.telegram', 'telegram.cursor']);
  return value;
};
const arm = async (h, op, mode) => {
  h.broker.events.length = 0;
  h.broker.child.send({ kind: 'arm-journal', op, mode });
  await h.broker.wait('journal-armed');
};
const release = h => h.broker.child.send({ kind: 'release-journal' });
const failReply = (res, status, code = status, parameters) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error_code: code, description: 'SYNTHETIC_PRIVATE_PLATFORM_DETAIL', parameters }));
  return true;
};

test('C3-P3C-ORDER: actual opening and resolution flush precede prompt, installed wake and acknowledgement', opts, () => portable(async h => {
  const e = await begin(h, -1101), unrelated = await begin(h, -1102);
  await arm(h, 'telegram.response.open', 'hold');
  h.fixture.choose(e.message, 't');
  try {
    const entered = await h.broker.wait('flush-entered');
    assert.equal(entered.requests.find(r => r.request_id === e.p.request_id).resolution, 'pending');
    assert.equal(h.fixture.messages.some(m => m.reply_markup?.force_reply), false);
    assert.equal(h.broker.events.some(v => v.kind === 'ack-start'), false);
    h.shared.peer.beforeDeadline(e.wait, 'held opening');
  } finally { release(h); }
  const prompt = await mapped(h, e.p, true);
  await until(async () => (await records(h, 'telegram.prompt.sent')).some(m => m.message_id === prompt.message_id), 'real prompt mapping', h.signal);
  const opening = h.broker.events, openedFlush = opening.findIndex(v => v.kind === 'flush-complete');
  assert.ok(openedFlush >= 0 && opening.findIndex(v => v.kind === 'ack-start') > openedFlush, 'opening flush before neutral ack');
  assert.ok(opening.findIndex(v => v.kind === 'ui-start' && v.role === 'prompt') > openedFlush, 'opening flush before actual prompt send');
  await arm(h, 'request.resolve.telegram', 'hold');
  const exact = '  yes approved\ninstructions, not approval  ';
  h.fixture.text(exact, prompt);
  try {
    const entered = await h.broker.wait('flush-entered');
    assert.equal(entered.requests.find(r => r.request_id === e.p.request_id).resolution, 'pending');
    h.shared.peer.beforeDeadline(e.wait, 'held resolution');
    assert.equal(h.broker.events.some(v => v.kind === 'wait-settled'), false);
    assert.equal(h.fixture.calls.some(c => c.method === 'sendMessage' && c.body.text.startsWith('Instructions recorded')), false);
  } finally { release(h); }
  await outcome(h, e, 'responded', exact);
  await until(() => h.fixture.calls.some(c => c.method === 'sendMessage' && c.body.text.startsWith('Instructions recorded')), 'post-commit human copy', h.signal);
  const events = h.broker.events, flush = events.findIndex(v => v.kind === 'flush-complete'), wake = events.findIndex(v => v.kind === 'wait-settled');
  assert.ok(flush >= 0 && wake > flush, 'actual waiter settlement follows real sync');
  assert.equal(events[wake].requests.find(r => r.request_id === e.p.request_id).resolution, 'responded', 'installed before wake');
  assert.ok(events.findIndex(v => v.kind === 'ui-start' && v.role === 'outcome') > wake, 'installed wake before text confirmation send');
  assert.equal((await get(h.shared, unrelated.p)).resolution, 'pending');
  await arm(h, 'request.resolve.telegram', 'hold');
  h.fixture.choose(unrelated.message, 'a');
  try { await h.broker.wait('flush-entered'); assert.equal(h.broker.events.some(v => v.kind === 'ack-start'), false); }
  finally { release(h); }
  await outcome(h, unrelated, 'approved'); await barrier(h);
  const sequence = h.broker.events.map(v => v.kind);
  assert.ok(sequence.indexOf('flush-complete') < sequence.indexOf('wait-settled'));
  assert.ok(sequence.indexOf('wait-settled') < sequence.indexOf('ack-start'), 'wake before recorded-choice ack request');
  assert.equal(h.broker.events.find(v => v.kind === 'ack-start').requests.find(r => r.request_id === unrelated.p.request_id).resolution, 'approved');
  assert.deepEqual(h.shared.peer.unmatched, []);
}, { journalFaults: true }));

for (const mode of ['write-fail', 'sync-fail']) test(`C3-P3C-${mode}: no failed-append success, replay or offset skip, explicit recovery only`, opts, () => portable(async h => {
  const e = await begin(h, -1110), other = await h.prepare();
  const before = await readFile(join(h.state, 'journal.log'));
  await arm(h, 'request.resolve.telegram', mode);
  const calls = h.fixture.calls.length;
  h.fixture.choose(e.message, 'a');
  await h.broker.wait(mode === 'write-fail' ? 'write-failed' : 'flush-entered');
  const response = await e.wait.outcome;
  assert.equal(response.frame?.id, e.id);
  assert.equal(response.frame.result.isError, true, 'storage failure cannot deliver terminal success');
  assert.match(JSON.stringify(response.frame.result), /STORAGE_FAILURE/);
  assert.equal(h.broker.events.some(v => v.kind === 'ack-start'), false);
  const denied = await h.shared.call('prepare_approval', { session_label: 'unrelated fenced writer' }).outcome;
  assert.equal(denied.frame.result.isError, true); assert.match(JSON.stringify(denied), /STORAGE_FAILURE/);
  const after = await readFile(join(h.state, 'journal.log'));
  if (mode === 'write-fail') assert.deepEqual(after, before, 'no bytes written');
  else assert.equal((await records(h, 'request.resolve.telegram')).length, 1, 'complete valid but unacknowledged frame survives');
  assert.equal(h.fixture.calls.slice(calls).some(c => c.method === 'getUpdates'), false, 'no batch advancement after failure');
  // Hold remote delivery during explicit restart so storage replay is observed
  // independently of normal consumption of the still-uncommitted backlog.
  let releasePoll;
  const pollGate = new Promise(done => { releasePoll = done; });
  h.fixture.observe(async call => { if (call.method === 'getUpdates') await pollGate; });
  h.shared = await h.restart();
  let recovered;
  try {
    recovered = await get(h.shared, e.p);
    assert.equal(recovered.resolution, mode === 'sync-fail' ? 'approved' : 'pending');
    e.id = -1111; e.wait = ask(h.shared, e.p, e.id);
  } finally { releasePoll(); }
  const value = await outcome(h, e, 'approved');
  if (mode === 'sync-fail') assert.equal(value.decision_id, recovered.decision_id);
  assert.equal((await records(h, 'handle.reserve')).filter(m => m.request_id === other.request_id).length, 1);
  await barrier(h); assert.deepEqual(h.shared.peer.unmatched, []);
}, { journalFaults: true }));

test('C3-P3C-UI: HTTP/API ack403/404/409 and rate/transient failures retain winner and continue polling without business replay', opts, () => portable(async h => {
  const e = await begin(h, -1120);
  const variants = [[403, 400], [404, 400], [409, 400], [200, 403], [200, 404], [200, 409], [429, 429], [503, 503]];
  let current, attempts = 0;
  h.fixture.observe((call, res) => {
    if (call.method === 'answerCallbackQuery') { attempts++; return failReply(res, ...current); }
  });
  let value;
  for (const [i, variant] of variants.entries()) {
    current = variant;
    const previous = attempts;
    h.fixture.choose(e.message, i === 0 ? 'r' : 'a');
    if (i === 0) value = await outcome(h, e, 'rejected');
    await barrier(h);
    assert.ok(attempts > previous, 'the error envelope actually reached the real client');
    assert.equal((await get(h.shared, e.p)).decision_id, value.decision_id);
  }
  assert.equal((await records(h, 'request.resolve.telegram')).length, 1);
  assert.equal((await records(h, 'request.create')).length, 1);
  h.fixture.observe(async () => {});
  const text = await begin(h, -1122); h.fixture.choose(text.message, 't');
  const prompt = await mapped(h, text.p, true);
  await until(async () => (await records(h, 'telegram.prompt.sent')).some(m => m.message_id === prompt.message_id), 'prompt receipt', h.signal);
  let replyFailed = false;
  h.fixture.observe((call, res) => {
    if (call.method === 'sendMessage' && call.body.text.startsWith('Instructions recorded')) {
      replyFailed = true; return failReply(res, 403);
    }
  });
  h.fixture.text('private instructions after UI failure', prompt);
  await outcome(h, text, 'responded', 'private instructions after UI failure');
  await barrier(h); assert.equal(replyFailed, true);
  assert.equal((await records(h, 'request.resolve.telegram')).filter(m => m.request_id === text.p.request_id).length, 1);
  h.fixture.observe(async () => {});
  const positive = await begin(h, -1121); h.fixture.choose(positive.message, 'a');
  await outcome(h, positive, 'approved'); await barrier(h);
  assert.deepEqual(h.shared.peer.unmatched, []);
}));

for (const status of [401, 200]) test(`C3-P3C-401-${status}: committed choice survives global credential fence while local operations remain usable`, opts, () => portable(async h => {
  const e = await begin(h, -1130), opened = await begin(h, -1131);
  let failedPrompt = false;
  h.fixture.observe((call, res) => {
    if (call.method === 'sendMessage' && call.body.reply_markup?.force_reply) {
      failedPrompt = true; return failReply(res, 503);
    }
  });
  h.fixture.choose(opened.message, 't');
  await until(() => failedPrompt, 'actual eligible prompt fails before credential fence', h.signal);
  await until(async () => (await records(h, 'telegram.prompt.failed')).some(m => m.request_id === opened.p.request_id), 'prompt retry prerequisite installed', h.signal);
  let credentialAttempt = false;
  h.fixture.observe((call, res) => {
    if (call.method === 'answerCallbackQuery') { credentialAttempt = true; return failReply(res, status, 401); }
  });
  h.fixture.choose(e.message, 'a'); const value = await outcome(h, e, 'approved');
  await until(() => credentialAttempt, '401 attempted', h.signal);
  // Fresh question and previously failed eligible prompt would send/retry if
  // the shared fence were absent. Already-admitted valid results may still drain.
  const fresh = await h.prepare(); const waiting = ask(h.shared, fresh, -1132);
  const count = h.fixture.calls.length;
  await delay(1200, undefined, { signal: h.signal });
  assert.equal(h.fixture.calls.length, count, 'no poll, question, prompt, edit or ack after global fence');
  assert.equal((await get(h.shared, fresh)).resolution, 'pending');
  assert.equal((await get(h.shared, e.p)).decision_id, value.decision_id);
  assert.equal((await records(h, 'request.resolve.telegram')).length, 1);
  h.shared.peer.beforeDeadline(waiting, 'credential fence does not fabricate a result');
}));

test('C3-P3C-BACKOFF: actual poll429 floor then503 retry, ack transport abort and no post-stop call', opts, () => portable(async h => {
  const e = await begin(h, -1140);
  const polls = []; let fault = 0, ackClosed = false;
  h.fixture.observe((call, res) => {
    if (call.method === 'getUpdates') {
      polls.push(performance.now());
      if (fault++ === 0) return failReply(res, 429, 429, { retry_after: 2 });
      if (fault === 2) return failReply(res, 503);
    }
    if (call.method === 'answerCallbackQuery') { res.once('close', () => { ackClosed = true; }); return true; }
  });
  // Wake the already-admitted long poll so subsequent polls reach fault policy.
  const id = h.fixture.enqueue({ message: null }); await cursor(h, id);
  await until(() => polls.length >= 3, 'rate and transient retries', h.signal);
  assert.ok(polls[1] - polls[0] >= 1950, 'retry_after2 seconds is a floor');
  assert.ok(polls[2] - polls[1] >= 1950, 'second ladder rung survives consecutive transient failure');
  h.fixture.choose(e.message, 'a'); const value = await outcome(h, e, 'approved');
  await until(() => h.fixture.calls.some(c => c.method === 'answerCallbackQuery'), 'held actual ack socket', h.signal);
  h.broker.child.send({ kind: 'stop' });
  await until(() => h.broker.closed && ackClosed, 'graceful stop destroys actual ack transport', h.signal);
  const calls = h.fixture.calls.length; await delay(100, undefined, { signal: h.signal });
  assert.equal(h.fixture.calls.length, calls);
  const winners = await records(h, 'request.resolve.telegram');
  assert.equal(winners.length, 1); assert.equal(winners[0].decision_id, value.decision_id);
  assert.deepEqual(h.shared.peer.unmatched, []);
}));

test('C3-P3C-PAUSE-ABORT: stop during actual retry_after wait cannot repoll or replay the durable choice', opts, () => portable(async h => {
  const e = await begin(h, -1150);
  let limited = false;
  h.fixture.observe((call, res) => {
    if (call.method === 'getUpdates') { limited = true; return failReply(res, 429, 429, { retry_after: 30 }); }
  });
  h.fixture.choose(e.message, 'r'); const value = await outcome(h, e, 'rejected');
  await until(() => limited, 'actual retry_after30 response', h.signal);
  const before = performance.now(); h.broker.child.send({ kind: 'stop' });
  await until(() => h.broker.closed, 'backoff aborted during graceful shutdown', h.signal);
  assert.ok(performance.now() - before < 3000, 'stop does not wait for30 second retry floor');
  const calls = h.fixture.calls.length; await delay(100, undefined, { signal: h.signal });
  assert.equal(h.fixture.calls.length, calls);
  const winners = await records(h, 'request.resolve.telegram');
  assert.equal(winners.length, 1); assert.equal(winners[0].decision_id, value.decision_id);
  assert.deepEqual(h.shared.peer.unmatched, []);
}));
