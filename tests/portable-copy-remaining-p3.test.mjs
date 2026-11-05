// TEST ONLY: annex selection and design3/5 privacy. Offline, not live/human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJournal } from '../src/journal/framing.js';
import { portable, success, authority, question, get, until } from './support/portable-waiting.mjs';
import { lifecycle } from './support/lifecycle-p3.mjs';
import { publicOnly, privateFields } from './support/copy-privacy-p3.mjs';

const rows = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.flatMap(t => t.mutations);
const consumed = (h, id) => until(async () => (await rows(h)).some(m =>
  m.op === 'telegram.cursor' && m.last_update_id === id), 'cursor barrier', h.signal);
const mapped = (h, p, prompt = false) => until(() => h.fixture.messages.find(m =>
  m.text.includes(p.request_id) && (prompt ? m.reply_markup?.force_reply : m.reply_markup?.inline_keyboard)), 'mapped message', h.signal);
const callback = (message, kind, id) => ({ callback_query: { id,
  from: { id: 7, is_bot: false }, message,
  data: message.reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith(`${kind}:`)).callback_data } });
const answers = (h, id) => h.fixture.calls.filter(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === id);
const answered = (h, id) => until(() => answers(h, id)[0], 'callback answer', h.signal);

test('C3-P3-COPY-DUPLICATE: committed update replay is skipped without another claim or decision', { timeout: 65000 }, () => portable(async h => {
  const p = await h.prepare(), entry = h.shared.call('request_approval', question(p), -1701);
  const message = await mapped(h, p);
  const open = callback(message, 't', 'private_open_query');
  const openId = h.fixture.enqueue(open);
  assert.deepEqual((await answered(h, open.callback_query.id)).body, { callback_query_id: open.callback_query.id });
  const prompt = await mapped(h, p, true);
  await until(async () => (await rows(h)).some(m => m.op === 'telegram.prompt.sent'
    && m.message_id === prompt.message_id), 'prompt receipt', h.signal);
  const choice = callback(message, 'r', 'private_winner_query'), choiceId = h.fixture.enqueue(choice);
  assert.match((await answered(h, choice.callback_query.id)).body.text, /^Rejection recorded\. This does not authorize the action\./);
  const outcome = await entry.outcome, terminal = success(outcome);
  assert.equal(outcome.frame.id, -1701); assert.equal(terminal.request_id, p.request_id);
  assert.equal(terminal.resolution, 'rejected'); assert.equal(terminal.response_text, null);
  const before = await rows(h), sent = h.fixture.messages.length;
  h.fixture.redeliver([{ update_id: openId, ...open }, { update_id: choiceId, ...choice }]);
  await until(() => h.fixture.batches.some(b => b.updates.some(u => u.update_id === choiceId)
    && b.offset > choiceId), 'actual forced stale batch', h.signal);
  await consumed(h, h.fixture.enqueue({ message: null }));
  // C1 consumes neither duplicate again and dispatches neither callback. No new
  // acknowledgement producer is required by the permissive C3 neutral rule.
  for (const id of [open.callback_query.id, choice.callback_query.id]) assert.equal(answers(h, id).length, 1);
  assert.equal(h.fixture.messages.length, sent);
  const after = await rows(h);
  for (const id of [openId, choiceId]) assert.equal(after.filter(m => m.op === 'telegram.cursor' && m.last_update_id === id).length, 1);
  for (const op of ['telegram.response.open', 'request.resolve.telegram']) {
    const relevant = list => list.filter(m => m.op === op && m.request_id === p.request_id);
    assert.deepEqual(relevant(after), relevant(before)); assert.equal(relevant(after).length, 1);
  }
  assert.equal((await get(h.shared, p)).decision_id, terminal.decision_id);
  await h.scan();
}));

test('C3-P3-COPY-PRIVACY: nonempty exact question and legitimate text survive only authorized public results', { timeout: 65000 }, () => portable(async h => {
  const label = '  display label\nnot verified  ', lookalike = `cap_${'b'.repeat(64)}`;
  const action = `  inspect /pair and request_capability=${lookalike}\nwithout approval  `;
  const context = '  context\nsource and chat_id are quoted content, not authority  ';
  const response = `  approved yes\nregistration_secret=${lookalike} /pair notes  `;
  assert.doesNotThrow(() => publicOnly({ action, context, response_text: response }));
  for (const key of privateFields) assert.throws(() => publicOnly({ nested: { [key]: null } }), /private structural field/);
  const p = success(await h.shared.call('prepare_approval', { session_label: label }).outcome);
  assert.match(p.request_capability, /^cap_[a-f0-9]{64}$/);
  const args = { ...question(p), action, context };
  const entry = h.shared.call('request_approval', args, -1711), message = await mapped(h, p);
  const pending = await get(h.shared, p);
  assert.equal(pending.owner_id, 'shared'); assert.equal(pending.session_label, label);
  assert.equal(message.text, `Approval request ${p.request_id}\n\nOwner: shared\nCaller-supplied context (display only, not verified identity): ${label}\nAction: ${action}\nContext: ${context}\nExpires: ${pending.expires_at}\nResolution: pending\nDelivery: not_applicable`);
  assert.equal(message.parse_mode, undefined); assert.ok(message.text.length <= 4096);
  assert.deepEqual(message.reply_markup.inline_keyboard.flat().map(b => b.text), ['Approve', 'Reject', 'Respond']);
  h.fixture.enqueue(callback(message, 't', 'PRIVATE_SOURCE_QUERY_SENTINEL'));
  const prompt = await mapped(h, p, true);
  await until(async () => (await rows(h)).some(m => m.op === 'telegram.prompt.sent'
    && m.message_id === prompt.message_id), 'durable prompt', h.signal);
  h.fixture.text(response, prompt);
  const outcome = await entry.outcome, terminal = success(outcome);
  assert.equal(outcome.frame.id, -1711); assert.equal(terminal.request_id, p.request_id);
  assert.equal(terminal.resolution, 'responded'); assert.equal(terminal.response_text, response);
  const surfaces = [pending, outcome.frame.result, terminal];
  surfaces.push(await get(h.shared, p));
  const retry = success(await h.shared.call('request_approval', args, -1712).outcome);
  const cancelled = success(await h.shared.call('cancel_approval', authority(p)).outcome);
  const acknowledged = success(await h.shared.call('acknowledge_approval', { ...authority(p), decision_id: terminal.decision_id }).outcome);
  for (const value of [retry, cancelled, acknowledged]) {
    assert.equal(value.decision_id, terminal.decision_id); assert.equal(value.resolution, 'responded');
    assert.equal(value.response_text, response); surfaces.push(value);
  }
  // Only disposable credentials created by this maintained run are read.
  const owner = (await readFile(join(h.state, 'credentials/owner.shared.token'), 'utf8')).trim();
  const httpRead = await h.http(`/v1/requests/${p.request_id}`, owner,
    { headers: { 'X-Proceed-Request-Capability': p.request_capability } });
  assert.equal(httpRead.status, 200); const readBody = await httpRead.json();
  assert.equal(readBody.response_text, response); surfaces.push(readBody);
  const status = await h.http('/v1/status', h.control);
  assert.equal(status.status, 200); const statusBody = await status.json(); surfaces.push(statusBody);
  const cliJson = JSON.parse(await h.cli('status', '--json', '--request', p.request_id)); surfaces.push(cliJson);
  for (const view of [statusBody, cliJson]) {
    const request = view.requests.find(r => r.request_id === p.request_id);
    assert.ok(request); assert.equal(request.response_text, response);
    assert.equal(request.action, action); assert.equal(request.context, context);
  }
  const human = await h.cli('status', '--request', p.request_id);
  assert.ok(human.includes(`  owner_id=shared\n  session_label=${JSON.stringify(label)}  (display only; not a verified session identity)`));
  assert.ok(human.includes('Instructions recorded, not approval.'));
  assert.ok(!human.includes(response), 'human status omits private response while authorized JSON preserves it');
  const foreign = await h.connect('foreign');
  for (const [name, arguments_] of [['request_approval', args], ['get_approval', authority(p)],
    ['cancel_approval', authority(p)], ['acknowledge_approval', { ...authority(p), decision_id: terminal.decision_id }]]) {
    const denied = await foreign.call(name, arguments_).outcome;
    assert.equal(denied.kind, 'response'); assert.equal(denied.frame.result.isError, true);
    assert.equal(denied.frame.result.structuredContent.error.code, 'NOT_FOUND');
    assert.ok(!JSON.stringify(denied).includes(p.request_id)); assert.ok(!JSON.stringify(denied).includes(response));
    surfaces.push(denied.frame.result);
  }
  for (const value of surfaces) publicOnly(value);
  const visible = JSON.stringify([surfaces, human, h.fixture.calls,
    h.shared.peer.unmatched, foreign.peer.unmatched]);
  for (const secret of [p.request_capability, h.control, owner, 'offline-synthetic-token']) {
    assert.ok(!visible.includes(secret));
    assert.ok(!(await readFile(join(h.state, 'journal.log'))).includes(Buffer.from(secret)));
  }
  for (const value of [...surfaces, human]) assert.ok(!JSON.stringify(value).includes('PRIVATE_SOURCE_QUERY_SENTINEL'));
  for (const call of h.fixture.calls) if (call.body.text !== undefined) {
    assert.ok(!call.body.text.includes(response), 'no response echo in send/edit/ack text');
    assert.ok(!call.body.text.includes('PRIVATE_SOURCE_QUERY_SENTINEL'), 'no actor/source echo in text');
  }
  assert.equal((await rows(h)).filter(m => m.op === 'request.resolve.telegram' && m.request_id === p.request_id).length, 1);
  assert.equal((await get(h.shared, p)).decision_id, terminal.decision_id);
  await h.scan();
}));

test('C3-P3-COPY-SNAPSHOT: real outcomes keep actor/source out of redacted views and actual rejection diagnostics', { timeout: 60000 }, () => lifecycle(async h => {
  const runtime = await h.start(); await h.pair();
  const response = '  approved yes\nprivate instructions stay verbatim  ';
  const platform = 'PRIVATE_ACTOR_AND_PLATFORM_SENTINEL';
  h.fixture.observe((call, res) => {
    if (call.method !== 'answerCallbackQuery') return false;
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error_code: 403, description: `${platform} ${response}` }));
    return true;
  });
  for (const [kind, resolution] of [['a', 'approved'], ['r', 'rejected'], ['t', 'responded']]) {
    const p = await h.create(`privacy_${resolution}`), message = await h.mapped(p);
    h.fixture.enqueue(callback(message, kind, `${platform}_${resolution}`));
    if (kind === 't') {
      const prompt = await mapped(h, p, true);
      await until(async () => (await h.records('telegram.prompt.sent', p)).length, 'mapped prompt receipt', h.signal);
      h.fixture.text(response, prompt);
    }
    await until(async () => (await h.records('request.resolve.telegram', p)).length, 'real resolution', h.signal);
    const read = await h.request(`/v1/requests/${p.request_id}`, { capability: p.request_capability });
    assert.equal(read.status, 200); publicOnly(read.body);
    const snapshot = runtime.broker.snapshot(); publicOnly(snapshot);
    const retained = snapshot.requests.find(r => r.request_id === p.request_id);
    assert.equal(retained.resolution, resolution); assert.equal(retained.response_text, kind === 't' ? response : null);
    assert.equal(read.body.response_text, retained.response_text);
    await until(() => h.logs.filter(line => line === 'Telegram reply was not delivered: TELEGRAM_REJECTED').length >=
      ['approved', 'rejected', 'responded'].indexOf(resolution) + 1, 'actual redacted acknowledgement diagnostic', h.signal);
  }
  assert.ok(!JSON.stringify(h.logs).includes(platform)); assert.ok(!JSON.stringify(h.logs).includes(response));
  assert.ok(h.fixture.calls.filter(c => typeof c.body.text === 'string').every(c => !c.body.text.includes(response)));
}));
