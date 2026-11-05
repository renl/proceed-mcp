// TEST ONLY: raw syntactic admission, not pairing, correlation, a wire or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
const token = '0123456789abcdef0123456789abcdef', requestId = `req_${token}`;
const max = Number.MAX_SAFE_INTEGER;
const actor = () => ({ id: 71, is_bot: false });
const chat = () => ({ id: 81, type: 'private' });
const message = () => ({ message_id: 700, date: 1793577600, from: actor(), chat: chat(), text: ' yes\n' });
const callback = () => ({ update_id: 9, callback_query: { id: 'query', from: actor(),
  message: { ...message(), from: { id: 99, is_bot: true } }, data: `a:${token}` } });
const textUpdate = () => ({ update_id: 9, message: message() });
const callbackResult = (kind = 'approve') => ({ status: 'callback', kind, token, updateId: 9,
  callbackQueryId: 'query', userId: '71', chatId: '81', messageId: 700 });
const common = { updateId: 9, messageId: 700, userId: '71', chatId: '81' };
const textResult = (status, text, extras = {}) => ({ status, ...common, text, ...extras });
const callbackRefused = (reason, callbackQueryId = 'query') => ({ status: 'refused', reason, callbackQueryId });
const textRefused = (reason, userId = '71', chatId = '81') => ({ status: 'refused', reason, userId, chatId });
const ignored = reason => ({ status: 'ignored', reason });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
async function check(which, cases) {
  const api = await import('../src/telegram/portable-admission.js');
  for (const [label, input, expected] of cases) {
    const before = structuredClone(input); freeze(input);
    let actual;
    assert.doesNotThrow(() => { actual = api[which](input); }, label);
    assert.deepEqual(actual, expected, label);
    assert.deepEqual(input, before, `${label}: immutable`);
  }
}
const cb = cases => check('admitCallbackUpdate', cases);
const tx = cases => check('admitTextUpdate', cases);
const change = (make, edit) => { const u = make(); edit(u); return u; };
const callbackCase = (label, edit, reason, id = 'query') =>
  [label, change(callback, edit), callbackRefused(reason, id)];
const textCase = (label, edit, reason, user = '71', room = '81') =>
  [label, change(textUpdate, edit), textRefused(reason, user, room)];
const withText = text => change(textUpdate, u => { u.message.text = text; });
const withReply = (text, context = { message_id: 800 }) =>
  change(() => withText(text), u => { u.message.reply_to_message = context; });

test('CAL: fixtures and intended outputs are independent of the missing source', () => {
  assert.match(token, /^[a-f0-9]{32}$/); assert.equal(`/respond ${requestId} `.length, 46);
  assert.notEqual(callback().callback_query.from.id, callback().callback_query.message.chat.id);
  assert.equal(callback().callback_query.message.from.is_bot, true);
  assert.deepEqual(callbackResult(), { status: 'callback', kind: 'approve', token, updateId: 9,
    callbackQueryId: 'query', userId: '71', chatId: '81', messageId: 700 });
  assert.equal(Array.from('😀'.repeat(4096)).length, 4096);
  assert.equal('😀'.repeat(4096).isWellFormed(), true);
  assert.deepEqual(textResult('command', ' yes\n', { requestId, replyPromptId: null }),
    { status: 'command', ...common, text: ' yes\n', requestId, replyPromptId: null });
  assert.deepEqual(textRefused('invalid_sender', null, null),
    { status: 'refused', reason: 'invalid_sender', userId: null, chatId: null });
});
test('RAW: sole module exports only the two selected inert entry points', async () => {
  const api = await import('../src/telegram/portable-admission.js');
  assert.deepEqual(Object.keys(api).sort(), ['admitCallbackUpdate', 'admitTextUpdate']);
});
test('RAW: JSON top-level domain and safe next-offset boundary', async () => {
  const invalid = [null, false, 0, '', [], { update_id: '9' }, { update_id: -1 },
    { update_id: 0.5 }, { update_id: max }, { update_id: max + 1 }, {}];
  await cb(invalid.map((u, i) => [`invalid ${i}`, u, callbackRefused('invalid_update', null)]));
  await tx(invalid.map((u, i) => [`invalid ${i}`, u, textRefused('invalid_update', null, null)]));
  for (const update_id of [0, max - 1]) {
    await cb([['usable ID', { ...callback(), update_id }, { ...callbackResult(), updateId: update_id }]]);
    await tx([['usable ID', { ...textUpdate(), update_id }, textResult('uncorrelated', ' yes\n', { updateId: update_id })]]);
  }
});
test('RAW-CB: absent callbacks ignored and malformed query IDs never usable', async () => {
  await cb([['absent', { update_id: 9 }, ignored('not_callback_update')],
    ['null', { update_id: 9, callback_query: null }, ignored('not_callback_update')],
    ...[false, [], 'query', 5].map(v => ['query shape', { update_id: 9, callback_query: v }, callbackRefused('invalid_callback', null)]),
    ...[undefined, null, '', 7, {}].map(v => callbackCase('query id', u => { u.callback_query.id = v; }, 'invalid_callback_id', null)),
    ['no trim query ID', change(callback, u => { u.callback_query.id = ' '; }), { ...callbackResult(), callbackQueryId: ' ' }]]);
});
test('RAW-CB: human query sender, independently valid private chat, accessible message', async () => {
  await cb([['bot-authored message is valid', callback(), callbackResult()],
    ...[undefined, null, [], {}].map(v => callbackCase('sender shape', u => { u.callback_query.from = v; }, 'invalid_sender')),
    ...[undefined, null, true, 0].map(v => callbackCase('non-bot exact', u => { u.callback_query.from.is_bot = v; }, 'invalid_sender')),
    ...[undefined, null, []].map(v => callbackCase('chat shape', u => { u.callback_query.message.chat = v; }, 'invalid_chat')),
    callbackCase('group', u => { u.callback_query.message.chat.type = 'group'; }, 'invalid_chat'),
    ...[undefined, null, [], false].map(v => callbackCase('message shape', u => { u.callback_query.message = v; }, 'invalid_message')),
    ...[0, -1, 0.5, '700', max + 1, null].flatMap(v => [
      callbackCase('message ID', u => { u.callback_query.message.message_id = v; }, 'invalid_message'),
      callbackCase('date', u => { u.callback_query.message.date = v; }, 'invalid_message')])]);
});
test('RAW: numeric sender/chat domain, no string coercion or equality authority', async () => {
  const invalid = [undefined, null, 0, -1, 0.5, '71', max + 1, true];
  await cb(invalid.flatMap(v => [
    callbackCase('sender ID', u => { u.callback_query.from.id = v; }, 'invalid_sender'),
    callbackCase('chat ID', u => { u.callback_query.message.chat.id = v; }, 'invalid_chat')]));
  await tx(invalid.flatMap(v => [
    textCase('sender ID', u => { u.message.from.id = v; }, 'invalid_sender', null, null),
    textCase('chat ID', u => { u.message.chat.id = v; }, 'invalid_chat', '71', null)]));
  await cb([['maximum actor IDs', change(callback, u => { u.callback_query.from.id = max; u.callback_query.message.chat.id = max - 1; }),
    { ...callbackResult(), userId: String(max), chatId: String(max - 1) }]]);
});
test('RAW-CB: exact full data grammar and action map, not a prefix parser', async () => {
  await cb(Object.entries({ a: 'approve', r: 'reject', t: 'respond' }).map(([a, kind]) =>
    [a, change(callback, u => { u.callback_query.data = `${a}:${token}`; }), callbackResult(kind)]));
  await cb([undefined, null, 7, {}, '', `a:${token}:`, `a:${token}\n`, ` a:${token}`,
    `A:${token}`, `a:${token.toUpperCase()}`, `a:${token.slice(1)}`, `a:${token}0`, `x:${token}`]
    .map(v => callbackCase('data', u => { u.callback_query.data = v; }, 'invalid_data')));
});
test('RAW-TEXT: update variants and actor/message admission', async () => {
  await tx([['absent', { update_id: 9 }, ignored('not_message_update')],
    ['edited', { update_id: 9, edited_message: message() }, ignored('edited_message')],
    ...[false, [], 7, 'message'].map(v => ['message', { update_id: 9, message: v }, textRefused('invalid_message', null, null)]),
    ...[null, [], {}].map(v => textCase('sender', u => { u.message.from = v; }, 'invalid_sender', null, null)),
    ...[undefined, null, true, 0].map(v => textCase('bot', u => { u.message.from.is_bot = v; }, 'invalid_sender', null, null)),
    ...[null, [], {}].map(v => textCase('chat', u => { u.message.chat = v; }, 'invalid_chat', '71', null)),
    textCase('group', u => { u.message.chat.type = 'group'; }, 'invalid_chat', '71', null),
    ...[0, -1, 1.5, '700', max + 1, null].flatMap(v => [
      textCase('message ID', u => { u.message.message_id = v; }, 'invalid_message'),
      textCase('date', u => { u.message.date = v; }, 'invalid_message')]),
    ['caption is not text', change(textUpdate, u => { delete u.message.text; u.message.caption = 'yes'; }), ignored('non_text_message')]]);
});
test('RAW-TEXT: scalar ceiling, well-formed Unicode and verbatim whitespace', async () => {
  await tx([' ', '\n', 'yes', 'APPROVE', 'e\u0301', '😀'.repeat(4096)].map(text =>
    ['exact reply', withReply(text), textResult('reply', text, { replyPromptId: 800 })]));
  await tx(['', null, 7, {}, '\ud800', '\udc00', 'a\ud800b', '😀'.repeat(4097)].map(text =>
    ['invalid text', withText(text), textRefused('invalid_text')]));
});
test('RAW-TEXT: exact command payload, whole-message ceiling and nullable context', async () => {
  await tx(['x', ' yes\n', '\n', '😀'.repeat(4050)].flatMap(text => [
    ['command', withText(`/respond ${requestId} ${text}`), textResult('command', text, { requestId, replyPromptId: null })],
    ['command with prompt', withReply(`/respond ${requestId} ${text}`), textResult('command', text, { requestId, replyPromptId: 800 })]]));
  await tx([['null context', withReply(`/respond ${requestId} x`, null), textResult('command', 'x', { requestId, replyPromptId: null })],
    ['whole message too long', withText(`/respond ${requestId} ${'😀'.repeat(4051)}`), textRefused('invalid_text')]]);
});
test('RAW-TEXT: anchored intent malformed commands cannot fall back to replies', async () => {
  const malformed = ['/respond', '/respond ', `/respond\t${requestId} x`, `/respond\n${requestId} x`,
    `/respond\r${requestId} x`, `/respond@bot ${requestId} x`, `/respond  ${requestId} x`,
    `/respond ${requestId}`, `/respond ${requestId} `, `/respond ${requestId}x x`,
    `/respond req_${token.toUpperCase()} x`, `/respond ${requestId}\tx`];
  await tx(malformed.flatMap(text => [[text, withText(text), textRefused('malformed_command')],
    [text, withReply(text), textRefused('malformed_command')]]));
});
test('RAW-TEXT: ordinary text never infers a command or approval', async () => {
  await tx(['/respondent', '/respondX', '/respond!', '/RESPOND x', ` /respond ${requestId} x`,
    'ordinary space', 'yes', 'approve', requestId].flatMap(text => [
    ['uncorrelated', withText(text), textResult('uncorrelated', text)],
    ['reply verbatim', withReply(text), textResult('reply', text, { replyPromptId: 800 })]]));
});
test('RAW-TEXT: present reply context must be valid, even on explicit commands', async () => {
  const bad = [false, [], 5, {}, { message_id: 0 }, { message_id: '800' }, { message_id: max + 1 },
    { message_id: 800, chat: {} }, { message_id: 800, chat: [] },
    { message_id: 800, chat: { id: 81, type: 'group' } },
    { message_id: 800, chat: { id: '81', type: 'private' } },
    { message_id: 800, chat: { id: 82, type: 'private' } }];
  await tx(bad.flatMap(context => ['yes', `/respond ${requestId} x`].map(text =>
    ['invalid present context', withReply(text, context), textRefused('invalid_reply_context')])));
  await tx([undefined, null, chat()].map(room => ['valid context', withReply('yes', { message_id: 800, chat: room }),
    textResult('reply', 'yes', { replyPromptId: 800 })]));
});
test('RAW: syntactic output contains no pairing, request lookup or hidden authority', async () => {
  const u = callback(); u.callback_query.request_id = 'untrusted'; u.pairing = { user_id: 'different' };
  u.callback_query.message.chat_instance = 'not authority';
  await cb([['unknown fields grant nothing and do not deny syntax', u, callbackResult()]]);
  const t = withText('yes'); t.message.request_id = requestId; t.message.entities = [{ type: 'bot_command' }];
  await tx([['no entity/request inference', t, textResult('uncorrelated', 'yes')]]);
});
