// TEST ONLY: design5/7 C3 and proposal C3 Product-Copy Annex. Offline, not live proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { readJournal } from '../src/journal/framing.js';
import { createTelegramClient } from '../src/telegram/client.js';
import { portable, success, ask, get, until } from './support/portable-waiting.mjs';

test('C3-ACT: complete command/open/refusal/commit-copy wiring preserves legitimate secret-like text', { timeout: 65000 }, () => portable(async h => {
  const rows = async () => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.flatMap(t => t.mutations);
  const a = await h.prepare(), wait = ask(h.shared, a, -501);
  const message = await until(() => h.fixture.messages.find(m => m.text.includes(a.request_id) && m.reply_markup?.inline_keyboard), 'question', h.signal);
  assert.deepEqual(message.reply_markup.inline_keyboard.flat().map(b => b.text), ['Approve', 'Reject', 'Respond']);
  const status = await h.cli('status');
  assert.ok(status.includes('Telegram accepted a question message. Human receipt is not confirmed, and no decision was recorded.'));
  assert.ok(status.includes('wait for the paired human to select Approve, Reject or Respond'));
  const commitsAtAck = [];
  h.fixture.observe(async call => { if (call.method === 'answerCallbackQuery') commitsAtAck.push(await rows()); });
  const raw = text => ({ message: { message_id: 900, date: 1, from: { id: 7, is_bot: false }, chat: { id: 7, type: 'private' }, text } });
  const before = h.fixture.messages.length;
  for (const text of ['/pair bad', '/pair  bad', '/pair@bot bad', '/pair\tbad', '/pair bad\n']) h.fixture.enqueue(raw(text));
  h.fixture.enqueue({ edited_message: raw('ignored').message });
  h.fixture.enqueue({ message: { ...raw('ignored').message, text: undefined, caption: 'ignored' } });
  h.fixture.enqueue({ ...raw('foreign'), message: { ...raw('foreign').message, from: { id: 8, is_bot: false } } });
  h.fixture.enqueue(raw('uncorrelated'));
  const guidance = 'No response was recorded. Select Respond on the intended request, then reply to its prompt or send /respond <request_id> <text>. Text is instructions, not approval.';
  await until(() => h.fixture.messages.slice(before).some(m => m.text === guidance), 'paired guidance', h.signal);
  assert.deepEqual(h.fixture.messages.slice(before).map(m => m.text), [guidance], 'malformed pair intent and nontext stay silent');
  assert.equal((await get(h.shared, a)).resolution, 'pending');
  h.fixture.enqueue({ callback_query: { id: 'bad', from: { id: 7, is_bot: false }, message: { ...message, date: 0 }, data: message.reply_markup.inline_keyboard.flat()[0].callback_data } });
  await until(() => h.fixture.calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'bad'), 'refusal ack', h.signal);
  assert.equal(h.fixture.calls.find(c => c.body.callback_query_id === 'bad').body.text, 'This request is not available.');
  h.fixture.choose(message, 't');
  const prompt = await until(() => h.fixture.messages.find(m => m.reply_markup?.force_reply), 'runtime prompt worker', h.signal);
  assert.deepEqual(prompt.reply_markup, { force_reply: true });
  assert.equal(prompt.text, `Respond to request ${a.request_id}\n\nReply to this message with instructions for this request only.\nYour reply is instructions, not approval: any action that still needs approval\nrequires a separate request.`);
  assert.equal((await get(h.shared, a)).resolution, 'pending', 'opening is not resolution');
  h.fixture.text(`/respond ${a.request_id} refused`, { message_id: 999999 });
  await until(() => h.fixture.messages.filter(m => m.text === guidance).length === 2, 'unknown context cannot fallback', h.signal);
  h.fixture.text('/respond malformed', prompt);
  await until(() => h.fixture.messages.filter(m => m.text === guidance).length === 3, 'malformed command cannot become reply', h.signal);
  assert.equal((await get(h.shared, a)).resolution, 'pending');
  const text = ` cap_${'a'.repeat(64)} bot123:synthetic\n yes approved `;
  h.fixture.text(`/respond ${a.request_id} ${text}`, prompt);
  const result = success(await wait.outcome);
  assert.equal(result.resolution, 'responded'); assert.equal(result.response_text, text);
  assert.equal((await wait.outcome).frame.id, -501);
  assert.equal(commitsAtAck.length, 2);
  assert.equal(commitsAtAck[0].at(-1).op, 'telegram.cursor');
  assert.ok(commitsAtAck[1].some(m => m.op === 'telegram.response.open'), 'open ack follows flushed opening');
  assert.ok(!h.fixture.calls.filter(c => c.method === 'answerCallbackQuery').at(-1).body.text, 'open ack neutral');
  const terminal = await h.cli('status'); assert.ok(terminal.includes('Instructions recorded, not approval.'));
}));

// design5 "Pairing-intent boundary and text precedence" / C3-PAIR-TEXT-001.
const guidance = 'No response was recorded. Select Respond on the intended request, then reply to its prompt or send /respond <request_id> <text>. Text is instructions, not approval.';
const transactions = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.map(t => t.mutations);
const consumed = async (h, id) => until(async () => (await transactions(h)).find(ms =>
  ms.some(m => m.op === 'telegram.cursor' && m.last_update_id === id)), 'input cursor committed', h.signal);
const opened = async (h, id) => {
  const prepared = await h.prepare(), wait = ask(h.shared, prepared, id);
  const question = await until(() => h.fixture.messages.find(m => m.text.includes(prepared.request_id)
    && m.reply_markup?.inline_keyboard), 'question', h.signal);
  h.fixture.choose(question, 't');
  const prompt = await until(() => h.fixture.messages.find(m => m.text.includes(prepared.request_id)
    && m.reply_markup?.force_reply), 'response prompt', h.signal);
  return { prepared, wait, prompt, id };
};

test('C3-PAIR-TEXT: exact original-call outcomes for non-command content', { timeout: 65000 }, t => portable(async h => {
  const entries = [];
  for (const [name, mode, text] of [
    ['reported mapped reply', 'reply', 'please inspect /pair handling'],
    ['reported matching-context command', 'command-reply', 'please inspect /pair handling'],
    ['reported absent-context command', 'command', 'please inspect /pair handling'],
    ['prefix is content, not pairing authority', 'reply', `x/pair ${'a'.repeat(32)}`],
    ['later line and path content', 'reply', ' inspect scripts/pair.js\n/pair handling\n '],
    ['near command token', 'reply', '/pairing notes'],
    ['ordinary positive control', 'reply', ' control instructions\n '],
  ]) {
    const entry = await opened(h, -710 - entries.length);
    const raw = mode === 'reply' ? text : `/respond ${entry.prepared.request_id} ${text}`;
    const updateId = h.fixture.text(raw, mode === 'command' ? undefined : entry.prompt);
    entries.push({ ...entry, name, text, updateId });
  }
  const outcomes = await Promise.all(entries.map(e => e.wait.outcome));
  for (const [i, e] of entries.entries()) await t.test(e.name, async () => {
    const outcome = outcomes[i], value = success(outcome);
    assert.equal(outcome.frame.id, e.id, 'same original waiting RPC');
    assert.equal(value.request_id, e.prepared.request_id);
    assert.equal(value.resolution, 'responded'); assert.equal(value.response_text, e.text);
    const reread = await get(h.shared, e.prepared);
    assert.equal(reread.decision_id, value.decision_id); assert.equal(reread.response_text, e.text);
    const matches = (await transactions(h)).filter(ms => ms.some(m => m.op === 'request.resolve.telegram'
      && m.request_id === e.prepared.request_id));
    assert.equal(matches.length, 1, 'one durable human resolution');
    assert.ok(matches[0].some(m => m.op === 'request.resolve.telegram' && m.response_text === e.text && m.update_id === e.updateId));
    assert.ok(matches[0].some(m => m.op === 'telegram.cursor' && m.last_update_id === e.updateId), 'atomic matching cursor');
  });
}));

test('C3-PAIR-CONTEXT: malformed intent stays silent, non-command needs authorized context', { timeout: 65000 }, () => portable(async h => {
  const { prepared, wait, prompt, id } = await opened(h, -730);
  const before = h.fixture.messages.length, code = 'a'.repeat(32);
  for (const text of [`/pair ${code}\n`, `\u2003/pair ${code}`, `/pair@fixture_bot ${code}`,
    `/pair  ${code}`, `/pair\t${code}`, `/pair ${code.toUpperCase()}`, `/pair ${code} extra`, '/pair prose']) {
    const updateId = h.fixture.text(text, prompt), row = await consumed(h, updateId);
    assert.deepEqual(row, [{ op: 'telegram.cursor', last_update_id: updateId }]);
  }
  assert.equal(h.fixture.messages.length, before, 'intended malformed controls silent even when mapped');
  assert.equal((await get(h.shared, prepared)).resolution, 'pending');
  for (const [text, context] of [[`x/pair ${code}`, undefined],
    [`/respond ${prepared.request_id} please inspect /pair handling`, { message_id: 999999 }]]) {
    const prior = h.fixture.messages.filter(m => m.text === guidance).length;
    const updateId = h.fixture.text(text, context); await consumed(h, updateId);
    await until(() => h.fixture.messages.filter(m => m.text === guidance).length === prior + 1, 'uncorrelated guidance', h.signal);
    assert.equal((await get(h.shared, prepared)).resolution, 'pending', 'no context fallback');
  }
  h.fixture.text('control instructions', prompt);
  const outcome = await wait.outcome;
  assert.equal(outcome.frame.id, id); assert.equal(success(outcome).response_text, 'control instructions');
}));

test('C3-PAIR-CHALLENGE: malformed command-position input cannot consume challenge or quota', { timeout: 65000 }, () => portable(async h => {
  const code = /Pairing code: (\S+)/.exec(await h.cli('pair'))?.[1];
  assert.match(code, /^[a-f0-9]{32}$/);
  const before = h.fixture.messages.length;
  for (const text of [`/pair ${code}\n`, ` /pair ${code}`, `\u0085/pair ${code}`, `/pair@fixture_bot ${code}`,
    `/pair  ${code}`, `/pair\t${code}`, `/pair ${'A'.repeat(32)}`, `/pair ${code} extra`, `x/pair ${code}`]) {
    const updateId = h.fixture.text(text), row = await consumed(h, updateId);
    assert.deepEqual(row, [{ op: 'telegram.cursor', last_update_id: updateId }]);
  }
  assert.equal(h.fixture.messages.length, before, 'unpaired malformed and non-command text silent');
  assert.ok(!(await transactions(h)).flat().some(m => ['pairing.challenge.consume', 'pairing.set'].includes(m.op)));
  const updateId = h.fixture.text(`/pair ${code}`);
  const row = await consumed(h, updateId);
  assert.ok(row.some(m => m.op === 'pairing.challenge.consume'));
  assert.ok(row.some(m => m.op === 'pairing.set'), 'exact command succeeds after more than five non-attempts');
  await until(() => h.fixture.messages.length === before + 1, 'pairing confirmation', h.signal);
}, { pair: false }));

test('C3-ACK-CLASS: actual client HTTP/API ack refusal, credential, conflict, rate floor and transient controls', { timeout: 5000 }, async t => {
  const original = https.request; let sample;
  https.request = (url, options, callback) => { assert.equal(new URL(url).origin, 'https://api.telegram.org');
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    req.end = () => { const res = new EventEmitter(); res.statusCode = sample.http; callback(res);
      res.emit('data', Buffer.from(JSON.stringify({ ok: false, error_code: sample.api, parameters: sample.parameters }))); res.emit('end'); }; return req; };
  try { const client = createTelegramClient({ token: 'offline-synthetic-token' });
    for (const [method, status, code, retry] of [
      ...[403, 404, 409].map(s => ['answerCallbackQuery', s, 'TELEGRAM_REJECTED', false]),
      ['answerCallbackQuery', 401, 'TOKEN_REJECTED', false], ['updates', 409, 'POLLER_CONFLICT', false],
      ['answerCallbackQuery', 429, 'TELEGRAM_RATE_LIMITED', true], ['answerCallbackQuery', 503, 'TELEGRAM_UNAVAILABLE', true],
    ]) for (const apiOnly of (method === 'updates' || status >= 500 ? [false] : [false, true])) await t.test(`${method}-${status}-${apiOnly ? 'API' : 'HTTP'}`, async () => {
      sample = { http: apiOnly ? 200 : status, api: apiOnly ? status : undefined, parameters: status === 429 ? { retry_after: 45 } : undefined };
      await assert.rejects(client[method]({}), e => e.code === code && Boolean(e.retryable) === retry && (status !== 429 || e.retryAfter === 45));
    });
  } finally { https.request = original; }
});
