// TEST ONLY: design5 C3 activated boundary. Offline client proof, not live Telegram.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJournal } from '../src/journal/framing.js';
import { portable, success, ask, get, until } from './support/portable-waiting.mjs';

const unavailable = 'This request is not available.';
const guidance = 'No response was recorded. Select Respond on the intended request, then reply to its prompt or send /respond <request_id> <text>. Text is instructions, not approval.';
const transactions = async h => readJournal(await readFile(join(h.state, 'journal.log'))).transactions.map(t => t.mutations);
const consumed = (h, id) => until(async () => (await transactions(h)).find(ms =>
  ms.some(m => m.op === 'telegram.cursor' && m.last_update_id === id)), 'committed input cursor', h.signal);
const cursorOnly = async (h, id) => assert.deepEqual(await consumed(h, id),
  [{ op: 'telegram.cursor', last_update_id: id }], 'refusal has exactly one cursor and no business mutation');
const questionFor = (h, prepared) => until(() => h.fixture.messages.find(m =>
  m.text.includes(prepared.request_id) && m.reply_markup?.inline_keyboard), 'mapped question', h.signal);
const promptFor = (h, prepared) => until(() => h.fixture.messages.find(m =>
  m.text.includes(prepared.request_id) && m.reply_markup?.force_reply), 'mapped prompt', h.signal);
const start = async (h, id, open = false) => {
  const prepared = await h.prepare(), wait = ask(h.shared, prepared, id);
  const question = await questionFor(h, prepared);
  if (!open) return { prepared, wait, question, id };
  h.fixture.choose(question, 't');
  const prompt = await promptFor(h, prepared);
  // Transport result visibility precedes receipt. Wait for the actual durable role.
  await until(async () => (await transactions(h)).flat().some(m => m.op === 'telegram.prompt.sent'
    && m.request_id === prepared.request_id && m.message_id === prompt.message_id), 'prompt receipt', h.signal);
  return { prepared, wait, question, prompt, id };
};
const callback = (entry, kind = 'a') => ({ id: 'negative', from: { id: 7, is_bot: false },
  message: entry.question, data: entry.question.reply_markup.inline_keyboard.flat()
    .find(b => b.callback_data.startsWith(`${kind}:`)).callback_data });
const rawText = (text, prompt) => ({ message_id: 8000, date: 1,
  from: { id: 7, is_bot: false }, chat: { id: 7, type: 'private' }, text,
  ...(prompt ? { reply_to_message: { message_id: prompt.message_id } } : {}) });
const pending = async (h, entries) => {
  for (const entry of entries) assert.equal((await get(h.shared, entry.prepared)).resolution, 'pending');
};
const resolved = async (h, entry, resolution, text = null) => {
  const outcome = await entry.wait.outcome;
  assert.equal(h.shared.resource.failed, undefined, `MCP harness output cap: ${h.shared.resource.outputBytes} bytes`);
  const value = success(outcome);
  assert.equal(outcome.frame.id, entry.id, 'same original RPC identity');
  assert.equal(value.request_id, entry.prepared.request_id);
  assert.equal(value.resolution, resolution);
  assert.equal(value.response_text, text);
  const reread = await get(h.shared, entry.prepared);
  assert.equal(reread.decision_id, value.decision_id);
  assert.equal(reread.response_text, text);
  assert.equal((await transactions(h)).flat().filter(m => m.op === 'request.resolve.telegram'
    && m.request_id === entry.prepared.request_id).length, 1, 'one durable human winner');
};

test('C3-P3A-CALLBACK: actor/chat/token/message/role refusals stay generic and original calls survive', { timeout: 65000 }, () => portable(async h => {
  const a = await start(h, -801, true), b = await start(h, -802);
  const base = callback(a), foreignToken = callback(b).data;
  const open = callback(b, 't');
  const cases = [
    ['foreign actor', { ...base, from: { id: 8, is_bot: false } }],
    ['foreign chat', { ...base, message: { ...a.question, chat: { id: 8, type: 'private' } } }],
    ['bot actor', { ...base, from: { id: 7, is_bot: true } }],
    ['string actor', { ...base, from: { id: '7', is_bot: false } }],
    ['unsafe actor', { ...base, from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false } }],
    ['group chat', { ...base, message: { ...a.question, chat: { id: 7, type: 'group' } } }],
    ['inaccessible message', { ...base, message: { ...a.question, date: 0 } }],
    ['unknown message', { ...base, message: { ...a.question, message_id: 999999 } }],
    ['string message ID', { ...base, message: { ...a.question, message_id: String(a.question.message_id) } }],
    ['prompt role cannot approve', { ...base, message: a.prompt }],
    ['cross-request token', { ...base, data: foreignToken }],
    ['unknown token', { ...base, data: `a:${'0'.repeat(32)}` }],
    ['uppercase token', { ...base, data: `a:${'A'.repeat(32)}` }],
    ['trailing data', { ...base, data: `${base.data}\n` }],
    ['inline-only', { ...base, message: undefined, inline_message_id: 'offline' }],
    ['nonobject message', { ...base, message: [] }],
    ['Respond foreign actor', { ...open, from: { id: 8, is_bot: false } }],
    ['Respond foreign chat', { ...open, message: { ...b.question, chat: { id: 8, type: 'private' } } }],
    ['Respond prompt role', { ...open, message: a.prompt }],
    ['Respond cross-request message', { ...open, message: a.question }],
  ];
  for (const [label, query] of cases) {
    const id = h.fixture.enqueue({ callback_query: { ...query, id: label } });
    await cursorOnly(h, id);
    const ack = await until(() => h.fixture.calls.find(c => c.method === 'answerCallbackQuery'
      && c.body.callback_query_id === label), label, h.signal);
    assert.deepEqual(ack.body, { callback_query_id: label, text: unavailable }, label);
  }
  // Without a usable callback ID there is no acknowledgement target.
  const before = h.fixture.calls.filter(c => c.method === 'answerCallbackQuery').length;
  await cursorOnly(h, h.fixture.enqueue({ callback_query: { ...base, id: '' } }));
  // A later acknowledged input is a positive serial-processing barrier, not a sleep.
  const barrier = h.fixture.enqueue({ callback_query: { ...base, id: 'barrier', data: 'bad' } });
  await cursorOnly(h, barrier);
  await until(() => h.fixture.calls.some(c => c.body.callback_query_id === 'barrier'), 'ack barrier', h.signal);
  assert.equal(h.fixture.calls.filter(c => c.method === 'answerCallbackQuery').length, before + 1);
  await pending(h, [a, b]);
  assert.ok(!(await transactions(h)).flat().some(m => m.op === 'telegram.response.open'
    && m.request_id === b.prepared.request_id), 'refused Respond cannot open a window');
  h.fixture.choose(b.question, 'r'); await resolved(h, b, 'rejected');
  h.fixture.choose(a.question, 'a'); await resolved(h, a, 'approved');
  await h.scan();
}));

test('C3-P3A-TEXT: independent tuple and same-request prompt context are required before writing', { timeout: 65000 }, () => portable(async h => {
  const a = await start(h, -811, true), b = await start(h, -812, true), closed = await start(h, -813);
  const command = `/respond ${a.prepared.request_id} private instructions`;
  const base = rawText(command, a.prompt);
  for (const message of [
    { ...base, from: { id: 8, is_bot: false } },
    { ...base, chat: { id: 8, type: 'private' } },
    { ...base, from: { id: 7, is_bot: true } },
    { ...base, chat: { id: 7, type: 'supergroup' } },
    { ...base, from: { id: '7', is_bot: false } },
  ]) {
    const before = h.fixture.messages.length;
    await cursorOnly(h, h.fixture.enqueue({ message }));
    // Next cursor proves the prior silent branch finished.
    await cursorOnly(h, h.fixture.enqueue({ message: null }));
    assert.equal(h.fixture.messages.length, before, 'unauthorized text is silent');
  }
  for (const [label, text, context] of [
    ['unknown prompt', command, { message_id: 999999 }],
    ['other request prompt', command, { message_id: b.prompt.message_id }],
    ['question role', command, { message_id: a.question.message_id }],
    ['malformed present context', command, { message_id: '1' }],
    ['nonobject context', command, []],
    ['foreign context chat', command, { message_id: a.prompt.message_id, chat: { id: 8, type: 'private' } }],
    ['group context chat', command, { message_id: a.prompt.message_id, chat: { id: 7, type: 'group' } }],
    ['unopened command', `/respond ${closed.prepared.request_id} no opening`, undefined],
    ['unknown request command', `/respond req_${'0'.repeat(32)} unknown`, undefined],
    ['question-role reply', 'not a response prompt', { message_id: a.question.message_id }],
    ['no recency fallback', `instructions for ${a.prepared.request_id}`, undefined],
    ['malformed command cannot become reply', `/respond  ${a.prepared.request_id} invalid`, { message_id: a.prompt.message_id }],
  ]) {
    const before = h.fixture.messages.length;
    await cursorOnly(h, h.fixture.enqueue({ message: { ...rawText(text), reply_to_message: context } }));
    await until(() => h.fixture.messages.length > before, label, h.signal);
    assert.deepEqual(h.fixture.messages.slice(before).map(m => m.text), [guidance], label);
  }
  // Cursor-only transactions already discriminate every refusal above. Read the
  // unchanged public state once, avoiding repeated output that exhausts the runner cap.
  await pending(h, [a, b, closed]);
  const exact = '  yes approved\nthese are instructions, not approval  ';
  h.fixture.text(exact, b.prompt); await resolved(h, b, 'responded', exact);
  h.fixture.text(`/respond ${a.prepared.request_id} ${exact}`); await resolved(h, a, 'responded', exact);
  h.fixture.choose(closed.question, 'r'); await resolved(h, closed, 'rejected');
  await cursorOnly(h, h.fixture.enqueue({ message: null }));
  const texts = h.fixture.calls.filter(c => c.method === 'sendMessage').map(c => c.body.text);
  assert.ok(texts.every(text => !text.includes(exact) && !text.includes('private instructions')), 'no response text echo');
  await h.scan();
}));

test('C3-P3A-SCALAR: raw malformed text is refused but 4096 non-BMP scalars survive exactly', { timeout: 65000 }, () => portable(async h => {
  const a = await start(h, -821, true);
  for (const [label, message, silent] of [
    ['empty', rawText('', a.prompt), false],
    ['null text', rawText(null, a.prompt), false],
    ['array text', rawText([], a.prompt), false],
    ['lone high surrogate', rawText('\ud800', a.prompt), false],
    ['lone low surrogate', rawText('\udc00', a.prompt), false],
    ['4097 scalars', rawText('x'.repeat(4097), a.prompt), false],
    ['4097 non-BMP scalars', rawText('\u{1f642}'.repeat(4097), a.prompt), false],
    ['zero incoming ID', { ...rawText('bad', a.prompt), message_id: 0 }, false],
    ['inaccessible date', { ...rawText('bad', a.prompt), date: 0 }, false],
    ['caption only', { ...rawText(undefined, a.prompt), caption: 'not text' }, true],
  ]) {
    const before = h.fixture.messages.length;
    await cursorOnly(h, h.fixture.enqueue({ message }));
    if (!silent) await until(() => h.fixture.messages.length > before, label, h.signal);
    await cursorOnly(h, h.fixture.enqueue({ message: null }));
    assert.deepEqual(h.fixture.messages.slice(before).map(m => m.text), silent ? [] : [guidance], label);
    await pending(h, [a]);
  }
  const before = h.fixture.messages.length;
  await cursorOnly(h, h.fixture.enqueue({ edited_message: rawText('edited', a.prompt) }));
  await cursorOnly(h, h.fixture.enqueue({ message: null }));
  assert.equal(h.fixture.messages.length, before, 'edited text is silent');
  const exact = '\u{1f642}'.repeat(4096);
  assert.equal(exact.length, 8192, 'discriminates scalar count from UTF-16 units');
  h.fixture.text(exact, a.prompt); await resolved(h, a, 'responded', exact);
  await cursorOnly(h, h.fixture.enqueue({ message: null }));
  assert.ok(h.fixture.calls.filter(c => c.method === 'sendMessage').every(c => !c.body.text.includes(exact)), 'no response echo');
  await h.scan();
}));
