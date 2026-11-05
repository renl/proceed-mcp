// Inert raw Telegram admission (design section 5, C3). Pure, synchronous and
// clock/I/O free: it decodes one JSON-shaped update into a private tagged result
// and never mutates its input. Success proves syntax alone -- no pairing, token
// correlation, prompt mapping, request authority or resolution. Refusal reasons
// stay private: no consumer may log them or select human copy from them.
//
// Nothing here acknowledges, polls, sends, prompts or activates a consumer, so
// every result stays inert for the caller that owns cursor and business effects.

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
// Incoming text is measured in Unicode scalar values, never UTF-16 units.
const MAX_TEXT_SCALARS = 4096;
// Exact allocated callback data and the one typed command grammar. Neither is a
// prefix parser, and neither accepts trailing data, alternate case or padding.
const CALLBACK_DATA = /^([art]):([a-f0-9]{32})$/;
const COMMAND_WORD = '/respond';
const COMMAND = /^\/respond (req_[a-f0-9]{32}) ([\s\S]+)$/;
const INTENT_SEPARATORS = ' \t\n\r@';
const CALLBACK_KINDS = { a: 'approve', r: 'reject', t: 'respond' };

const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;
// The next offset must also be a safe integer before a cursor may advance.
const isUpdateId = (value) => Number.isSafeInteger(value) && value >= 0 && value < MAX_SAFE;
const isHumanSender = (value) => isPlain(value) && value.is_bot === false && isPositiveId(value.id);
const isPrivateChat = (value) =>
  isPlain(value) && value.type === 'private' && isPositiveId(value.id);

const ignored = (reason) => ({ status: 'ignored', reason });
const callbackRefused = (reason, callbackQueryId) => ({
  status: 'refused',
  reason,
  callbackQueryId,
});
const textRefused = (reason, userId, chatId) => ({ status: 'refused', reason, userId, chatId });

// Reply context is correlation syntax only, and a malformed one never becomes
// absent. Its single preserved field is the prompt message ID.
const replyPrompt = (message, chatId) => {
  const context = message.reply_to_message;
  if (context === undefined || context === null) return { replyPromptId: null };
  if (!isPlain(context) || !isPositiveId(context.message_id)) return null;
  const { chat } = context;
  if (chat !== undefined && chat !== null && (!isPrivateChat(chat) || String(chat.id) !== chatId)) {
    return null;
  }
  return { replyPromptId: context.message_id };
};

const isText = (text) =>
  typeof text === 'string' &&
  text !== '' &&
  text.isWellFormed() &&
  Array.from(text).length <= MAX_TEXT_SCALARS;

// Intent is anchored at character zero and needs a separator after the word, so
// near-misses remain ordinary text instead of guessing a command.
const isCommandIntent = (text) => {
  if (!text.startsWith(COMMAND_WORD)) return false;
  if (text.length === COMMAND_WORD.length) return true;
  return INTENT_SEPARATORS.includes(text.charAt(COMMAND_WORD.length));
};

export function admitCallbackUpdate(update) {
  if (!isPlain(update) || !isUpdateId(update.update_id)) {
    return callbackRefused('invalid_update', null);
  }
  const query = update.callback_query;
  if (query === undefined || query === null) return ignored('not_callback_update');
  if (!isPlain(query)) return callbackRefused('invalid_callback', null);
  const queryId = query.id;
  if (typeof queryId !== 'string' || queryId === '') {
    return callbackRefused('invalid_callback_id', null);
  }
  // A request message may be bot-authored; only the pressing sender is checked.
  const sender = query.from;
  if (!isHumanSender(sender)) return callbackRefused('invalid_sender', queryId);
  const message = query.message;
  if (!isPlain(message) || !isPositiveId(message.message_id) || !isPositiveId(message.date)) {
    return callbackRefused('invalid_message', queryId);
  }
  if (!isPrivateChat(message.chat)) return callbackRefused('invalid_chat', queryId);
  const data = typeof query.data === 'string' ? CALLBACK_DATA.exec(query.data) : null;
  if (!data) return callbackRefused('invalid_data', queryId);
  return {
    status: 'callback',
    kind: CALLBACK_KINDS[data[1]],
    token: data[2],
    updateId: update.update_id,
    callbackQueryId: queryId,
    userId: String(sender.id),
    chatId: String(message.chat.id),
    messageId: message.message_id,
  };
}

export function admitTextUpdate(update) {
  if (!isPlain(update) || !isUpdateId(update.update_id)) {
    return textRefused('invalid_update', null, null);
  }
  const message = update.message;
  if (message === undefined || message === null) {
    const edited = update.edited_message;
    return ignored(
      edited === undefined || edited === null ? 'not_message_update' : 'edited_message',
    );
  }
  if (!isPlain(message)) return textRefused('invalid_message', null, null);
  const sender = message.from;
  if (!isHumanSender(sender)) return textRefused('invalid_sender', null, null);
  const userId = String(sender.id);
  if (!isPrivateChat(message.chat)) return textRefused('invalid_chat', userId, null);
  const chatId = String(message.chat.id);
  // A caption is not text, and the actor IDs are only preserved once admitted.
  if (!isPositiveId(message.message_id) || !isPositiveId(message.date)) {
    return textRefused('invalid_message', userId, chatId);
  }
  const text = message.text;
  // A missing text is not text at all; a caption never substitutes for one.
  if (text === undefined) return ignored('non_text_message');
  if (!isText(text)) return textRefused('invalid_text', userId, chatId);
  const context = replyPrompt(message, chatId);
  if (context === null) return textRefused('invalid_reply_context', userId, chatId);
  const common = { updateId: update.update_id, messageId: message.message_id, userId, chatId };
  if (isCommandIntent(text)) {
    const command = COMMAND.exec(text);
    if (!command) return textRefused('malformed_command', userId, chatId);
    // Only the extracted payload is preserved, never the command prefix.
    return {
      status: 'command',
      ...common,
      text: command[2],
      requestId: command[1],
      replyPromptId: context.replyPromptId,
    };
  }
  if (context.replyPromptId === null) return { status: 'uncorrelated', ...common, text };
  return { status: 'reply', ...common, text, replyPromptId: context.replyPromptId };
}
