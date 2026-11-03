// TEST ONLY: assembled public consumer with offline Telegram, not live proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJournal } from '../src/journal/framing.js';
import { portable, success, ask, get, authority, until } from './support/portable-waiting.mjs';

const journal = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.map(t => t.mutations);
const cursor = (h, id) => until(async () => (await journal(h)).find(ms =>
  ms.some(m => m.op === 'telegram.cursor' && m.last_update_id === id)), 'durable cursor', h.signal);
const cursorOnly = async (h, id) => assert.deepEqual(await cursor(h, id), [{ op: 'telegram.cursor', last_update_id: id }]);
const mutations = async (h, request) => (await journal(h)).flat().filter(m => m.request_id === request.request_id);
const closures = async (h, request) => (await mutations(h, request)).filter(m =>
  ['request.resolve.telegram', 'request.cancel', 'request.expire'].includes(m.op));
const mapped = (h, request, prompt = false) => until(() => h.fixture.messages.find(m =>
  m.text.includes(request.request_id) && (prompt ? m.reply_markup?.force_reply : m.reply_markup?.inline_keyboard)), 'actual mapped message', h.signal);
const begin = async (h, id, open = true) => {
  const prepared = await h.prepare(h.shared), wait = ask(h.shared, prepared, id);
  const question = await mapped(h, prepared);
  let prompt;
  if (open) {
    h.fixture.choose(question, 't');
    prompt = await mapped(h, prepared, true);
    await until(async () => (await mutations(h, prepared)).some(m => m.op === 'telegram.prompt.sent'
      && m.message_id === prompt.message_id), 'durable prompt receipt', h.signal);
  }
  return { prepared, wait, question, prompt, id };
};
const query = (entry, kind, id) => ({ id, from: { id: 7, is_bot: false }, message: entry.question,
  data: entry.question.reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith(`${kind}:`)).callback_data });
const choose = (h, entry, kind, id) => h.fixture.enqueue({ callback_query: query(entry, kind, id) });
const result = async (h, entry, expected, text = null) => {
  const outcome = await entry.wait.outcome;
  assert.equal(h.shared.resource.failed, undefined, `MCP runner cap: ${h.shared.resource.outputBytes}`);
  assert.equal(outcome.frame?.id, entry.id, 'original waiting RPC ID');
  const value = success(outcome);
  assert.equal(value.request_id, entry.prepared.request_id);
  assert.equal(value.resolution, expected);
  assert.equal(value.response_text, text);
  assert.match(value.decision_id, /^dec_[a-f0-9]{32}$/);
  const records = await closures(h, entry.prepared);
  assert.equal(records.length, 1, 'exactly one durable winner');
  assert.equal(records[0].decision_id, value.decision_id);
  if (records[0].op === 'request.resolve.telegram') {
    const row = (await journal(h)).find(ms => ms.some(m => m.decision_id === value.decision_id));
    assert.equal(row.length, 2, 'human winner and its cursor are one transaction');
    assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), { op: 'telegram.cursor', last_update_id: records[0].update_id });
  }
  const reread = await get(h.shared, entry.prepared);
  for (const key of ['decision_id', 'resolution', 'response_text', 'resolved_at', 'expires_at']) {
    assert.deepEqual(reread[key], value[key], `stable ${key}`);
  }
  return value;
};
const barrier = async h => cursorOnly(h, h.fixture.enqueue({ message: null }));

test('C3-P3B-REPLAY: repeated Respond, duplicate/stale updates and retained controls never replace the winner', { timeout: 65000 }, () => portable(async h => {
  const a = await begin(h, -901), untouched = await begin(h, -902, false);
  const before = await get(h.shared, a.prepared);
  const opened = (await mutations(h, a.prepared)).find(m => m.op === 'telegram.response.open');
  const repeat = choose(h, a, 't', 'repeat-open');
  await cursorOnly(h, repeat);
  await barrier(h);
  const ms = await mutations(h, a.prepared);
  assert.deepEqual(ms.filter(m => m.op === 'telegram.response.open'), [opened]);
  assert.equal(ms.filter(m => m.op === 'telegram.prompt.sent').length, 1);
  assert.equal(h.fixture.messages.filter(m => m.text.includes(a.prepared.request_id) && m.reply_markup?.force_reply).length, 1);
  const pending = await get(h.shared, a.prepared);
  assert.equal(pending.resolution, 'pending');
  assert.equal(pending.expires_at, before.expires_at, 'Respond never renews lifetime');
  // Duplicate old update and a changed stale payload. A newer serial barrier
  // proves neither is merely still waiting in the poller.
  const replay = [
    { update_id: repeat, callback_query: query(a, 'a', 'duplicate-changed') },
    { update_id: opened.update_id, callback_query: query(a, 'r', 'stale-changed') },
  ];
  h.fixture.redeliver(replay);
  await barrier(h);
  assert.ok(h.fixture.batches.some(b => b.offset > repeat && b.updates === replay), 'stale payloads actually cross client boundary despite committed offset');
  assert.equal((await journal(h)).flat().filter(m => m.op === 'telegram.cursor' && m.last_update_id === repeat).length, 1);
  assert.equal((await closures(h, a.prepared)).length, 0);
  const winning = choose(h, a, 'r', 'first-reject');
  const value = await result(h, a, 'rejected');
  const committed = await cursor(h, winning);
  assert.equal(committed.filter(m => m.op === 'request.resolve.telegram').length, 1, 'winner and cursor atomic');
  const duplicate = [{ update_id: winning, callback_query: query(a, 'r', 'first-reject') }];
  h.fixture.redeliver(duplicate);
  await barrier(h);
  assert.ok(h.fixture.batches.some(b => b.offset > winning && b.updates === duplicate), 'identical winner update actually redelivered');
  assert.equal((await journal(h)).flat().filter(m => m.op === 'telegram.cursor' && m.last_update_id === winning).length, 1);
  for (const kind of ['a', 'r', 't']) await cursorOnly(h, choose(h, a, kind, `retained-${kind}`));
  await cursorOnly(h, h.fixture.text('late private text', a.prompt));
  await barrier(h);
  assert.equal((await get(h.shared, a.prepared)).decision_id, value.decision_id);
  assert.equal((await closures(h, a.prepared)).length, 1);
  assert.equal((await get(h.shared, untouched.prepared)).resolution, 'pending');
  choose(h, untouched, 'a', 'positive-approve');
  await result(h, untouched, 'approved');
  assert.deepEqual(h.shared.peer.unmatched, [], 'no second result or unsolicited decision frame');
  await h.scan();
}));

test('C3-P3B-COMPETE: ordered callback/text contenders and actual concurrent cancellation share one winner', { timeout: 65000 }, () => portable(async h => {
  for (const [index, first] of ['callback', 'text', 'cancel', 'concurrent'].entries()) {
    const a = await begin(h, -910 - index);
    const text = '  yes approved\nresponse instructions only  ';
    let expected, cancellation;
    if (first === 'callback') {
      choose(h, a, 'a', 'callback-first'); h.fixture.text(text, a.prompt); expected = 'approved';
    } else if (first === 'text') {
      h.fixture.text(text, a.prompt); choose(h, a, 'r', 'text-first'); expected = 'responded';
    } else {
      cancellation = h.shared.call('cancel_approval', authority(a.prepared));
      if (first === 'cancel') {
        assert.equal(success(await cancellation.outcome).resolution, 'cancelled');
        expected = 'cancelled';
      }
      choose(h, a, 'a', 'cancel-competitor'); h.fixture.text(text, a.prompt);
    }
    const observed = success(await a.wait.outcome);
    if (first === 'concurrent') {
      assert.ok(['approved', 'cancelled'].includes(observed.resolution));
      expected = observed.resolution;
    }
    const value = await result(h, a, expected, expected === 'responded' ? text : null);
    if (cancellation) {
      const cancelled = success(await cancellation.outcome);
      assert.equal(cancelled.decision_id, value.decision_id, 'competing cancel observes same winner');
    }
    await barrier(h);
    for (const kind of ['r', 't']) await cursorOnly(h, choose(h, a, kind, `after-${first}-${kind}`));
    await cursorOnly(h, h.fixture.text(`/respond ${a.prepared.request_id} later`, a.prompt));
    assert.equal((await closures(h, a.prepared)).length, 1);
    assert.equal((await get(h.shared, a.prepared)).decision_id, value.decision_id);
  }
  assert.deepEqual(h.shared.peer.unmatched, [], 'no second result or unsolicited decision frame');
  await h.scan();
}));

test('C3-P3B-EQUALITY: opened calls at deadline-1 expire at exact equality, never approve/reject/respond', { timeout: 65000 }, () => portable(async h => {
  const entries = [];
  for (const [index, kind] of ['a', 'r', 't', 'text'].entries()) entries.push({ ...await begin(h, -920 - index), kind });
  const beforeDeadline = await begin(h, -924);
  const deadline = Date.parse((await get(h.shared, entries[0].prepared)).expires_at);
  for (const entry of entries) assert.equal(Date.parse((await get(h.shared, entry.prepared)).expires_at), deadline);
  h.shared = await h.restart({ whileStopped: () => h.setTime(deadline - 1) });
  beforeDeadline.id = -1024; beforeDeadline.wait = ask(h.shared, beforeDeadline.prepared, beforeDeadline.id);
  choose(h, beforeDeadline, 'a', 'deadline-minus-one-positive');
  const positive = await result(h, beforeDeadline, 'approved');
  assert.equal(Date.parse(positive.resolved_at), deadline - 1, 'positive control at the nearest valid instant');
  for (const entry of entries) {
    assert.equal((await get(h.shared, entry.prepared)).resolution, 'pending', 'one millisecond before expiry remains actionable');
    entry.id -= 100;
    entry.wait = ask(h.shared, entry.prepared, entry.id);
  }
  // Public management after each wait write supplies an adapter processing barrier.
  for (const entry of entries) assert.equal((await get(h.shared, entry.prepared)).resolution, 'pending');
  await h.setTime(deadline);
  const cancellation = h.shared.call('cancel_approval', authority(entries[0].prepared));
  const ids = entries.map(entry => entry.kind === 'text' ? h.fixture.text('equality text', entry.prompt)
    : choose(h, entry, entry.kind, `equality-${entry.kind}`));
  for (const [index, entry] of entries.entries()) {
    const value = await result(h, entry, 'expired');
    assert.equal(Date.parse(value.resolved_at), deadline, 'exact equality, no rounding or enlarged deadline');
    await cursor(h, ids[index]);
    const records = await mutations(h, entry.prepared);
    assert.equal(records.filter(m => m.op === 'request.resolve.telegram').length, 0);
    assert.equal(records.filter(m => m.op === 'telegram.response.open').length, 1, 'equality cannot reopen');
    for (const kind of ['a', 'r', 't']) await cursorOnly(h, choose(h, entry, kind, `expired-${kind}`));
    await cursorOnly(h, h.fixture.text('terminal expired reply', entry.prompt));
    assert.equal((await closures(h, entry.prepared)).length, 1);
  }
  assert.equal((await get(h.shared, beforeDeadline.prepared)).decision_id, positive.decision_id, 'equality does not expire an earlier winner');
  const cancelled = success(await cancellation.outcome);
  assert.equal(cancelled.resolution, 'expired', 'cancel at equality cannot displace deadline closure');
  assert.equal(cancelled.decision_id, (await get(h.shared, entries[0].prepared)).decision_id);
  assert.deepEqual(h.shared.peer.unmatched, [], 'no second result or unsolicited decision frame');
  await h.scan();
}, { controlledClock: true }));

test('C3-P3B-BACKLOG: startup expiry precedes stopped backlog and retained human decisions survive restart', { timeout: 65000 }, () => portable(async h => {
  const late = await begin(h, -940), kept = await begin(h, -941);
  h.fixture.text('retained exact response', kept.prompt);
  const retained = await result(h, kept, 'responded', 'retained exact response');
  const deadline = Date.parse((await get(h.shared, late.prepared)).expires_at);
  let backlog;
  h.shared = await h.restart({ whileStopped: async () => {
    assert.equal((await closures(h, late.prepared)).length, 0, 'still pending when stopped');
    await h.setTime(deadline);
    backlog = choose(h, late, 'a', 'offline-approve');
    h.fixture.text('offline text', late.prompt);
    choose(h, kept, 'r', 'offline-retained-reject');
  }, beforeReadiness: () => until(async () => (await closures(h, late.prepared)).some(m => m.op === 'request.expire'),
    'expiry without any HTTP/MCP/status observation after startup', h.signal) });
  const after = await get(h.shared, late.prepared);
  assert.equal(after.resolution, 'expired');
  assert.equal(Date.parse(after.resolved_at), deadline);
  await cursorOnly(h, backlog);
  await barrier(h);
  const transactions = await journal(h);
  const expiry = transactions.findIndex(ms => ms.some(m => m.op === 'request.expire' && m.request_id === late.prepared.request_id));
  const consumption = transactions.findIndex(ms => ms.some(m => m.op === 'telegram.cursor' && m.last_update_id === backlog));
  assert.ok(expiry >= 0 && expiry < consumption, 'startup durable expiry strictly precedes backlog consumption');
  late.id = -1040; late.wait = ask(h.shared, late.prepared, late.id);
  const expired = await result(h, late, 'expired');
  assert.equal(expired.decision_id, after.decision_id);
  kept.id = -1041; kept.wait = ask(h.shared, kept.prepared, kept.id);
  assert.equal((await result(h, kept, 'responded', 'retained exact response')).decision_id, retained.decision_id);
  h.shared = await h.restart();
  assert.equal((await get(h.shared, late.prepared)).decision_id, expired.decision_id);
  assert.equal((await get(h.shared, kept.prepared)).decision_id, retained.decision_id);
  assert.equal((await closures(h, late.prepared)).length, 1);
  assert.equal((await closures(h, kept.prepared)).length, 1);
  const fresh = await begin(h, -1042, false);
  choose(h, fresh, 'a', 'post-restart-positive'); await result(h, fresh, 'approved');
  assert.deepEqual(h.shared.peer.unmatched, [], 'no second result or unsolicited decision frame');
  await h.scan();
}, { controlledClock: true }));
