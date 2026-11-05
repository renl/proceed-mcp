// TEST ONLY: annex copy through real producers. Offline transport, not human receipt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJournal } from '../src/journal/framing.js';
import { renderPortableHumanOutcome } from '../src/telegram/portable-render.js';
import { lifecycle, gate } from './support/lifecycle-p3.mjs';
import { portable, success, ask, get, authority, until } from './support/portable-waiting.mjs';
import { publicOnly } from './support/copy-privacy-p3.mjs';

// Expected text is independently transcribed from the approved annex, not imported labels.
const prefixes = {
  approved: 'Approval recorded.',
  rejected: 'Rejection recorded. This does not authorize the action.',
  responded: 'Instructions recorded, not approval.',
};
const suffixes = {
  pending: 'Delivery is pending, not confirmed.',
  returned: 'The adapter reported writing the result to the original call. Receipt is not confirmed.',
  confirmed: 'Receipt acknowledged by a request-capability holder.',
  unavailable: 'Automatic delivery is unavailable. Authorized retrieval requires the retained request capability.',
};
const copy = (resolution, state) => `${prefixes[resolution]} ${suffixes[state]}`;
const exact = '  approved yes\nplease inspect /pair handling and scripts/pair.js  ';
const opts = { timeout: 65000 };
const history = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.flatMap(t => t.mutations);
const mapped = (h, p, prompt = false) => until(() => h.fixture.messages.find(m => m.text.includes(p.request_id)
  && (prompt ? m.reply_markup?.force_reply : m.reply_markup?.inline_keyboard)), 'actual message', h.signal);
const consumed = async (h, id) => until(async () => (await history(h)).some(m =>
  m.op === 'telegram.cursor' && m.last_update_id === id), 'cursor barrier', h.signal);
const promptText = id => `Respond to request ${id}\n\nReply to this message with instructions for this request only.\nYour reply is instructions, not approval: any action that still needs approval\nrequires a separate request.`;
const callback = (message, kind, id, foreign = false) => ({ callback_query: {
  id, from: { id: foreign ? 8 : 7, is_bot: false }, message,
  data: message.reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith(`${kind}:`)).callback_data,
} });
const ack = (h, id) => until(() => h.fixture.calls.find(c => c.method === 'answerCallbackQuery'
  && c.body.callback_query_id === id), 'actual callback answer', h.signal);
const statusCopy = async (h, p, resolution, state) => {
  const text = await h.cli('status', '--request', p.request_id);
  assert.ok(text.includes(`  ${copy(resolution, state)}\n`), `current ${resolution}/${state} copy`);
  assert.ok(text.includes(`delivery_state=${state}`));
  assert.ok(!text.includes(exact), 'status never echoes response text');
  return text;
};

test('C3-P3-COPY-INITIAL: three real human outcomes select pending or unavailable without inferred receipt', opts, () => lifecycle(async h => {
  const runtime = await h.start(); await h.pair();
  const registration = await h.request('/v1/adapter', { method: 'POST', body: {} });
  assert.equal(registration.status, 201);
  for (const state of ['pending', 'unavailable']) for (const [kind, resolution] of [['a', 'approved'], ['r', 'rejected'], ['t', 'responded']]) {
    const p = await h.create(`${resolution}_${state}`), message = await h.mapped(p);
    await until(async () => (await h.records('telegram.presentation.sent', p)).length, 'question receipt', h.signal);
    let waiting;
    if (state === 'pending') {
      // Observe admission, never replace a result or create private state. A subsequent
      // public read is the serialized barrier after the real wait's entry.
      const entered = gate(), original = runtime.broker.waitRequest;
      runtime.broker.waitRequest = function (...args) { const result = original.apply(this, args); entered.release(); return result; };
      try {
        waiting = h.request(`/v1/requests/${p.request_id}/wait`, { method: 'POST', capability: p.request_capability,
          headers: { 'X-Proceed-Registration': registration.body.registration_secret },
          body: { registration_id: registration.body.registration_id }, timeout: 8000 });
        waiting.catch(() => {});
        await entered.promise;
        assert.equal((await h.request(`/v1/requests/${p.request_id}`, { capability: p.request_capability })).body.resolution, 'pending');
      } finally { delete runtime.broker.waitRequest; }
    }
    const id = `${resolution}_${state}`;
    h.fixture.enqueue(callback(message, kind, id));
    if (kind === 't') {
      const prompt = await mapped(h, p, true);
      assert.equal(prompt.text, promptText(p.request_id));
      await until(async () => (await h.records('telegram.prompt.sent', p)).length, 'prompt mapping', h.signal);
      h.fixture.text(exact, prompt);
      await until(() => h.fixture.messages.some(m => m.text === copy(resolution, state)), 'instruction confirmation', h.signal);
    } else assert.deepEqual((await ack(h, id)).body, { callback_query_id: id, text: copy(resolution, state) });
    const view = (await h.request(`/v1/requests/${p.request_id}`, { capability: p.request_capability })).body;
    assert.equal(view.resolution, resolution); assert.equal(view.delivery_state, state);
    assert.equal(view.response_text, resolution === 'responded' ? exact : null);
    assert.equal((await h.records('request.resolve.telegram', p))[0].delivery_state, state, 'real initial reachability producer');
    if (waiting) { const response = await waiting; assert.equal(response.status, 200); assert.equal(response.body.decision_id, view.decision_id); }
    assert.equal((await h.records('request.returned', p)).length, 0, 'HTTP observation is not an adapter write');
    await statusCopy(h, p, resolution, state);
  }
}));

test('C3-P3-COPY-EVIDENCE: original MCP writes and matching capability acks select current suffixes for every human outcome', opts, () => portable(async h => {
  for (const [index, [kind, resolution]] of [['a', 'approved'], ['r', 'rejected'], ['t', 'responded']].entries()) {
    const p = await h.prepare(), entry = ask(h.shared, p, -1500 - index), message = await mapped(h, p);
    await until(async () => (await history(h)).some(m => m.op === 'telegram.presentation.sent' && m.request_id === p.request_id), 'question receipt', h.signal);
    h.fixture.choose(message, kind);
    if (kind === 't') {
      const prompt = await mapped(h, p, true);
      assert.equal(prompt.text, promptText(p.request_id));
      await until(async () => (await history(h)).some(m => m.op === 'telegram.prompt.sent' && m.message_id === prompt.message_id), 'prompt receipt', h.signal);
      h.fixture.text(exact, prompt);
    }
    const outcome = await entry.outcome, value = success(outcome);
    publicOnly(outcome.frame.result);
    assert.equal(outcome.frame.id, -1500 - index); assert.equal(value.request_id, p.request_id);
    assert.equal(value.resolution, resolution); assert.equal(value.response_text, kind === 't' ? exact : null);
    await until(async () => (await history(h)).some(m => m.op === 'request.returned' && m.request_id === p.request_id), 'actual original-write report', h.signal);
    await statusCopy(h, p, resolution, 'returned');
    const confirmed = success(await h.shared.call('acknowledge_approval', { ...authority(p), decision_id: value.decision_id }).outcome);
    publicOnly(confirmed); publicOnly(await get(h.shared, p));
    assert.equal(confirmed.delivery_state, 'confirmed'); assert.equal(confirmed.decision_id, value.decision_id);
    await statusCopy(h, p, resolution, 'confirmed');
    const rows = (await history(h)).filter(m => m.request_id === p.request_id);
    for (const op of ['request.resolve.telegram', 'request.returned', 'request.acknowledge']) assert.equal(rows.filter(m => m.op === op).length, 1);
    assert.equal((await get(h.shared, p)).response_text, kind === 't' ? exact : null);
  }
  const visible = JSON.stringify(h.fixture.calls);
  assert.ok(!visible.includes(exact), 'no response echo in send, edit or callback bodies');
  await h.scan();
}));

test('C3-P3-COPY-PRESENTATION: pending, failed and sent notes follow actual mapping state and next actions', opts, () => lifecycle(async h => {
  const entered = gate(), release = gate(); h.releaseOnCleanup(release);
  h.fixture.observe(async (call, res) => {
    if (call.method !== 'sendMessage' || !call.body.reply_markup?.inline_keyboard) return;
    entered.release(); await release.promise;
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error_code: 403, description: 'PRIVATE_PLATFORM_SENTINEL' })); return true;
  });
  const runtime = await h.start(); await h.pair();
  const p = await h.create('legitimate_pair_action'), before = p.request;
  await entered.promise;
  let text = await h.cli('status', '--request', p.request_id);
  assert.ok(text.includes('Presentation is still pending: not yet sent, and no decision was recorded.'));
  assert.ok(text.includes('next action: wait for the pending Telegram presentation; it is not yet sent'));
  release.release();
  await until(async () => (await h.records('telegram.presentation.failed', p)).length, 'actual failed attempt', h.signal);
  text = await h.cli('status', '--request', p.request_id);
  assert.ok(text.includes('A Telegram presentation attempt failed. No successful message mapping is recorded, and no decision was recorded.'));
  assert.ok(text.includes('next action: review the recorded Telegram and delivery state above'));
  await until(() => h.logs.includes('Telegram question presentation blocked after rejection; repair Telegram access and restart serve'), 'actionable rejection diagnostic', h.signal);
  assert.ok(!JSON.stringify(h.logs).includes('PRIVATE_PLATFORM_SENTINEL'));
  await runtime.stop(); h.fixture.observe(() => false); await h.start();
  const message = await h.mapped(p);
  await until(async () => (await h.records('telegram.presentation.sent', p)).length, 'mapping after restart', h.signal);
  assert.equal(message.text, `Approval request ${p.request_id}\n\nOwner: a\nCaller-supplied context (display only, not verified identity): A\nAction: legitimate_pair_action\nContext: (none)\nExpires: ${before.expires_at}\nResolution: pending\nDelivery: not_applicable`);
  assert.equal(message.parse_mode, undefined);
  assert.deepEqual(message.reply_markup.inline_keyboard.flat().map(b => b.text), ['Approve', 'Reject', 'Respond']);
  text = await h.cli('status', '--request', p.request_id);
  assert.ok(text.includes('Telegram accepted a question message. Human receipt is not confirmed, and no decision was recorded.'));
  assert.ok(text.includes('next action: wait for the paired human to select Approve, Reject or Respond'));
  assert.ok(!/Approval recorded\.|Instructions recorded/.test(text));
}));

test('C3-P3-COPY-SELECTION: activation disclosures, neutral opening, retained closures and foreign terminal privacy', opts, () => portable(async h => {
  const paired = 'Paired. Approval questions can be sent to this chat. Select Approve, Reject or Respond on a request. Respond text is instructions, not approval.';
  assert.ok(h.fixture.messages.some(m => m.text === paired));
  const startId = h.fixture.text('/start'); await consumed(h, startId);
  await until(() => h.fixture.messages.some(m => m.text === 'You are paired with this local broker. Select Approve, Reject or Respond on an approval request. Respond text is instructions, not approval.'), 'paired onboarding', h.signal);
  const instructions = h.shared.initialization.instructions;
  for (const expected of ['Only an explicit Approve grants approval. Reject records rejection. Respond records request-specific instructions only after valid correlated text. Approval-like words in Respond text never grant approval.',
    'Never echo, print or otherwise expose the request capability', 'deduplicate by request_id and decision_id']) assert.ok(instructions.includes(expected), expected);
  // Annex131 retains timeout/lost-call and event-routing disclosures. Accept
  // wording variation, but their subjects cannot be entirely absent from the wire.
  const missing = [/timeout|timed out/i, /lost/i, /Events/i].filter(pattern => !pattern.test(instructions)).map(String);
  assert.deepEqual(missing, [], 'MCP initialization must disclose client timeout, lost-call semantics and Events limits (annex131)');
  const catalog = (await h.shared.peer.call('tools/list', {}).outcome).frame.result.tools;
  assert.match(catalog.find(t => t.name === 'request_approval').description, /paired human Approve, Reject or Respond/);
  const help = await h.cli('--help');
  assert.ok(help.includes('Local waiting, Telegram question display and paired-human Approve, Reject and Respond are available. Respond text is instructions, not approval.'));
  assert.match(help, /[Ee]vents/); assert.match(help, /timeout/); assert.match(help, /cancel/);
  for (const closure of ['approved', 'rejected', 'responded', 'cancelled', 'expired']) {
    const p = await h.prepare(), entry = ask(h.shared, p, `selection_${closure}`), message = await mapped(h, p);
    await until(async () => (await history(h)).some(m => m.op === 'telegram.presentation.sent' && m.request_id === p.request_id), 'question receipt', h.signal);
    const open = `open_${closure}`;
    h.fixture.enqueue(callback(message, 't', open));
    assert.deepEqual((await ack(h, open)).body, { callback_query_id: open });
    const prompt = await mapped(h, p, true);
    await until(async () => (await history(h)).some(m => m.op === 'telegram.prompt.sent' && m.message_id === prompt.message_id), 'prompt receipt', h.signal);
    const again = `again_${closure}`; h.fixture.enqueue(callback(message, 't', again));
    assert.deepEqual((await ack(h, again)).body, { callback_query_id: again });
    if (closure === 'approved') h.fixture.choose(message, 'a');
    if (closure === 'rejected') h.fixture.choose(message, 'r');
    if (closure === 'responded') h.fixture.text(exact, prompt);
    if (closure === 'cancelled') success(await h.shared.call('cancel_approval', authority(p)).outcome);
    if (closure === 'expired') {
      const v = await get(h.shared, p); await h.setTime(Date.parse(v.expires_at));
      assert.equal((await get(h.shared, p)).resolution, 'expired');
    }
    const outcome = await entry.outcome, terminal = success(outcome);
    assert.equal(outcome.frame.id, `selection_${closure}`);
    assert.equal(terminal.request_id, p.request_id); assert.equal(terminal.resolution, closure);
    assert.equal(terminal.response_text, closure === 'responded' ? exact : null);
    const expected = prefixes[closure] ? 'This request is already resolved. The recorded outcome is unchanged.'
      : `This request was ${closure}. No new choice was recorded. A new request is needed if approval is still required.`;
    // Expiry's selected grammar is "expired", not "was expired".
    const selected = closure === 'expired' ? 'This request expired. No new choice was recorded. A new request is needed if approval is still required.' : expected;
    for (const kind of ['a', 'r', 't']) {
      const id = `${closure}_${kind}`; h.fixture.enqueue(callback(message, kind, id));
      assert.deepEqual((await ack(h, id)).body, { callback_query_id: id, text: selected });
      const foreign = `foreign_${id}`; h.fixture.enqueue(callback(message, kind, foreign, true));
      assert.deepEqual((await ack(h, foreign)).body, { callback_query_id: foreign, text: 'This request is not available.' });
    }
    for (const text of ['terminal private response', `/respond ${p.request_id} terminal private response`]) {
      const before = h.fixture.messages.length;
      h.fixture.text(text, prompt);
      await until(() => h.fixture.messages.length > before, 'retained text selection', h.signal);
      assert.deepEqual(h.fixture.messages.slice(before).map(m => m.text), [selected]);
      const foreign = h.fixture.enqueue({ message: { message_id: 9100, date: 1,
        from: { id: 8, is_bot: false }, chat: { id: 7, type: 'private' }, text,
        reply_to_message: { message_id: prompt.message_id } } });
      await consumed(h, foreign); await consumed(h, h.fixture.enqueue({ message: null }));
      assert.equal(h.fixture.messages.length, before + 1, 'foreign terminal text is silent');
    }
    const v = await get(h.shared, p); assert.equal(v.decision_id, terminal.decision_id);
    assert.equal(v.response_text, terminal.response_text);
    assert.equal((await history(h)).filter(m => m.op === 'request.resolve.telegram' && m.request_id === p.request_id).length, prefixes[closure] ? 1 : 0);
    if (closure === 'cancelled' || closure === 'expired') {
      const text = await h.cli('status', '--request', p.request_id);
      assert.ok(text.includes(`${p.request_id}  ${closure}\n`));
      assert.ok(text.includes(`  resolution=${closure}  telegram_state=sent`));
      assert.ok(text.includes('  next action: create a new approval request if approval is still needed\n'));
      if (closure === 'expired') assert.ok(text.includes('  Expired is a non-approval outcome: this request closed without a decision.\n'));
      assert.doesNotMatch(text, /Approval recorded\.|Rejection recorded\.|Instructions recorded/);
    }
  }
  await h.scan();
}, { controlledClock: true }));

test('C3-P3-COPY-FALLBACK: blocked rendering and invalid pairs are pure fallback, NOT reachable ledger proof', () => {
  for (const resolution of Object.keys(prefixes)) assert.equal(renderPortableHumanOutcome(resolution, 'blocked'),
    `${prefixes[resolution]} Delivery is blocked. Ask the operator to check proceed-mcp status.`);
  for (const [resolution, state] of [['pending', 'pending'], ['expired', 'confirmed'], ['cancelled', 'returned'],
    ['approved', 'not_applicable'], ['approved', 'unknown']]) assert.equal(renderPortableHumanOutcome(resolution, state), null);
});
