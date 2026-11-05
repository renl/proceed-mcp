// Telegram pairing, resolution and presentation (design section 5).
//
// The poller is the only consumer of this bot's updates. Every accepted
// decision is committed together with the update cursor, before any Telegram
// acknowledgement; presentation work is re-derived from durable fields so a
// restart resumes it instead of losing it.
import { TelegramError } from './client.js';
import {
  assertTelegramLength,
  renderReplyPrompt,
  renderRequestMessage,
  renderResolvedMessage,
  requestKeyboard,
} from './render.js';
import { CALLBACK_TOKEN_PATTERN, REQUEST_ID_PATTERN, scalarLength } from '../util/values.js';

export const PRESENTATION_TICK_MS = 500;
const PAIRING_ATTEMPTS_PER_MINUTE = 5;
const MAX_CALLBACK_ACK_TEXT = 200;

const sleep = (milliseconds, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

function decimalId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?[0-9]{1,20}$/.test(value)) return value;
  return null;
}

function ackText(text) {
  return [...text].slice(0, MAX_CALLBACK_ACK_TEXT).join('');
}

export function createTelegramService({
  broker,
  telegram,
  clock = () => Date.now(),
  logger = () => {},
}) {
  const pairingAttempts = new Map();
  const presentationRetryAt = new Map();
  let pollAbort = null;
  let polling = null;
  let presentationTimer = null;
  let stopped = false;
  let fatalDiagnostic = null;

  const state = broker.state;

  const requestByToken = (token) => {
    for (const request of state.requests.values()) {
      if (request.callback_token === token) return request;
    }
    return null;
  };

  const requestByReplyPrompt = (messageId) => {
    for (const request of state.requests.values()) {
      if (request.presentation?.reply_prompt_ids?.includes(messageId)) return request;
    }
    return null;
  };

  const answer = async (callbackQueryId, text, showAlert = false) => {
    try {
      await telegram.answerCallbackQuery({
        callback_query_id: callbackQueryId,
        text: ackText(text),
        show_alert: showAlert,
      });
    } catch (error) {
      // An acknowledgement failure never undoes a committed decision.
      logger(`callback acknowledgement failed (${error?.code ?? 'UNKNOWN'})`);
    }
  };

  const pairingAttemptAllowed = (senderId) => {
    const now = clock();
    const entry = pairingAttempts.get(senderId);
    if (entry === undefined || now >= entry.resetAt) {
      pairingAttempts.set(senderId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= PAIRING_ATTEMPTS_PER_MINUTE) return false;
    entry.count += 1;
    return true;
  };

  const authorizedSender = (senderId, chat) => {
    if (state.pairing === null) return false;
    if (chat?.type !== 'private') return false;
    if (decimalId(chat?.id) !== state.pairing.chat_id) return false;
    return senderId === state.pairing.user_id;
  };

  // ---------------------------------------------------------------------
  // Update handling
  // ---------------------------------------------------------------------

  const handleCallback = async (update) => {
    const callback = update.callback_query;
    const callbackId = typeof callback?.id === 'string' ? callback.id : null;
    const senderId = decimalId(callback?.from?.id);
    const chat = callback?.message?.chat;
    const messageId = Number.isInteger(callback?.message?.message_id)
      ? callback.message.message_id
      : null;

    if (callbackId !== null && !authorizedSender(senderId, chat)) {
      await answer(callbackId, 'This request is not available.');
      await broker.advanceCursor(update.update_id);
      return;
    }

    const data = typeof callback?.data === 'string' ? callback.data : '';
    const [action, token] = data.split(':');
    if (!['a', 'r', 't'].includes(action) || !CALLBACK_TOKEN_PATTERN.test(token ?? '')) {
      if (callbackId !== null) await answer(callbackId, 'This request is not available.');
      await broker.advanceCursor(update.update_id);
      return;
    }

    const request = requestByToken(token);
    if (request === null) {
      if (callbackId !== null) await answer(callbackId, 'This request is not available.');
      await broker.advanceCursor(update.update_id);
      return;
    }
    if (
      request.presentation?.message_id !== null &&
      request.presentation?.message_id !== undefined &&
      messageId !== null &&
      request.presentation.message_id !== messageId
    ) {
      if (callbackId !== null) await answer(callbackId, 'This request is not available.');
      await broker.advanceCursor(update.update_id);
      return;
    }

    if (action === 't') {
      if (request.resolution !== 'pending') {
        if (callbackId !== null) await answer(callbackId, 'This request is already resolved.');
        await broker.advanceCursor(update.update_id);
        return;
      }
      await openResponseWindow(request, update.update_id);
      if (callbackId !== null) await answer(callbackId, 'Reply with your instructions.');
      return;
    }

    const resolution = action === 'a' ? 'approved' : 'rejected';
    const result = await broker.resolveFromTelegram({
      requestId: request.request_id,
      resolution,
      responseText: null,
      userId: senderId,
      chatId: decimalId(chat.id),
      updateId: update.update_id,
    });
    if (result.expired) {
      if (callbackId !== null)
        await answer(callbackId, 'This request expired; no decision was recorded.');
      return;
    }
    if (!result.changed) {
      if (callbackId !== null) await answer(callbackId, 'This request is already resolved.');
      return;
    }
    if (callbackId !== null) {
      await answer(callbackId, 'Decision recorded. Session delivery is pending confirmation.');
    }
  };

  // Respond opens a durable response window before the prompt is sent, so a
  // crash cannot leave an accept-in-progress mapping without its flag.
  const openResponseWindow = async (request, updateId) => {
    const presentation = {
      ...request.presentation,
      response_opened: true,
    };
    await broker.recordPresentation(request.request_id, presentation, undefined, updateId);
    if (state.pairing === null) return;
    try {
      const sent = await telegram.sendMessage({
        chat_id: state.pairing.chat_id,
        text: assertTelegramLength(renderReplyPrompt(request)),
        reply_markup: { force_reply: true, selective: true },
      });
      const messageId = Number.isInteger(sent?.message_id) ? sent.message_id : null;
      if (messageId !== null) {
        const fresh = state.requests.get(request.request_id);
        await broker.recordPresentation(request.request_id, {
          ...fresh.presentation,
          reply_prompt_ids: [...fresh.presentation.reply_prompt_ids, messageId],
        });
      }
    } catch (error) {
      logger(`response prompt could not be sent (${error?.code ?? 'UNKNOWN'})`);
    }
  };

  const handleMessage = async (update) => {
    const message = update.message;
    const senderId = decimalId(message?.from?.id);
    const chat = message?.chat;
    const text = typeof message?.text === 'string' ? message.text : null;

    if (text === null) {
      await broker.advanceCursor(update.update_id);
      return;
    }

    if (text.startsWith('/start')) {
      if (authorizedSender(senderId, chat)) {
        await sendPlain(chat.id, 'This chat is paired. Requests arrive here.');
      } else {
        await sendPlain(
          chat.id,
          'Ask the operator running proceed-mcp for a pairing code, then send /pair <code>.',
        );
      }
      await broker.advanceCursor(update.update_id);
      return;
    }

    if (text.startsWith('/pair')) {
      const code = text.slice('/pair'.length).trim();
      if (chat?.type !== 'private' || state.pairing !== null) {
        await sendPlain(chat.id, 'Pairing was not accepted.');
        await broker.advanceCursor(update.update_id);
        return;
      }
      if (senderId === null || !pairingAttemptAllowed(senderId)) {
        await sendPlain(chat.id, 'Pairing was not accepted.');
        await broker.advanceCursor(update.update_id);
        return;
      }
      const result = await broker.completePairing({
        code,
        userId: senderId,
        chatId: decimalId(chat.id),
        updateId: update.update_id,
      });
      await sendPlain(
        chat.id,
        result.paired
          ? 'Paired. Approval requests for this machine will arrive in this chat.'
          : 'Pairing was not accepted. Ask the operator for a fresh code.',
      );
      return;
    }

    if (text.startsWith('/respond')) {
      await handleExplicitResponse(update, text, senderId, chat);
      return;
    }

    const replyTo = Number.isInteger(message?.reply_to_message?.message_id)
      ? message.reply_to_message.message_id
      : null;
    if (replyTo !== null) {
      const request = requestByReplyPrompt(replyTo);
      if (request !== null && authorizedSender(senderId, chat)) {
        await resolveResponse(request, update, senderId, chat, text);
        return;
      }
    }

    // Uncorrelated text never selects a request.
    if (authorizedSender(senderId, chat)) {
      await sendPlain(
        chat.id,
        'Reply to a Respond prompt or use /respond <request_id> <text> to answer a request.',
      );
    }
    await broker.advanceCursor(update.update_id);
  };

  const handleExplicitResponse = async (update, text, senderId, chat) => {
    const rest = text.slice('/respond'.length);
    const trimmed = rest.replace(/^\s+/, '');
    const separator = trimmed.indexOf(' ');
    const requestId = separator === -1 ? trimmed : trimmed.slice(0, separator);
    const responseText = separator === -1 ? '' : trimmed.slice(separator + 1);

    if (!REQUEST_ID_PATTERN.test(requestId) || responseText === '') {
      await broker.advanceCursor(update.update_id);
      return;
    }
    if (!authorizedSender(senderId, chat)) {
      await broker.advanceCursor(update.update_id);
      return;
    }
    const request = state.requests.get(requestId);
    if (request === null || request === undefined) {
      await sendPlain(chat.id, 'That request is not available.');
      await broker.advanceCursor(update.update_id);
      return;
    }
    if (request.presentation?.response_opened !== true) {
      await sendPlain(chat.id, 'Select Respond for this request before sending text.');
      await broker.advanceCursor(update.update_id);
      return;
    }
    await resolveResponse(request, update, senderId, chat, responseText);
  };

  const resolveResponse = async (request, update, senderId, chat, responseText) => {
    const text = responseText;
    if (text === '' || scalarLength(text) > 4096) {
      await sendPlain(chat.id, 'That reply was not accepted.');
      await broker.advanceCursor(update.update_id);
      return;
    }
    const result = await broker.resolveFromTelegram({
      requestId: request.request_id,
      resolution: 'responded',
      responseText: text,
      userId: senderId,
      chatId: decimalId(chat.id),
      updateId: update.update_id,
    });
    if (result.expired) {
      await sendPlain(chat.id, 'This request expired; no response was recorded.');
      return;
    }
    if (!result.changed) {
      await sendPlain(chat.id, 'This request is already resolved.');
      return;
    }
    await sendPlain(chat.id, 'Instructions recorded. Session delivery is pending confirmation.');
  };

  const sendPlain = async (chatId, text) => {
    if (chatId === undefined || chatId === null) return;
    try {
      await telegram.sendMessage({ chat_id: chatId, text: ackText(text) });
    } catch (error) {
      logger(`Telegram message could not be sent (${error?.code ?? 'UNKNOWN'})`);
    }
  };

  const handleUpdate = async (update) => {
    if (typeof update?.update_id !== 'number') return;
    if (state.lastUpdateId !== null && update.update_id <= state.lastUpdateId) return;
    if (update.callback_query !== undefined) return handleCallback(update);
    if (update.message !== undefined) return handleMessage(update);
    // Stale or unsupported update types are harmlessly consumed.
    return broker.advanceCursor(update.update_id);
  };

  const pollLoop = async (signal) => {
    let backoff = 0;
    while (!stopped && !signal.aborted) {
      const offset = state.lastUpdateId === null ? null : state.lastUpdateId + 1;
      let updates;
      try {
        updates = await telegram.updates(offset, { signal });
      } catch (error) {
        if (error instanceof TelegramError && error.code === 'CANCELLED') return;
        if (error instanceof TelegramError && error.code === 'POLLER_CONFLICT') {
          fatalDiagnostic =
            'another consumer (webhook or poller) owns this bot; stop it and restart';
          logger(fatalDiagnostic);
          return;
        }
        if (error instanceof TelegramError && error.code === 'TOKEN_REJECTED') {
          fatalDiagnostic = 'the Telegram bot token was rejected; set PROCEED_TELEGRAM_BOT_TOKEN';
          logger(fatalDiagnostic);
          return;
        }
        const wait = error?.retryAfter
          ? error.retryAfter * 1000
          : [1, 2, 4, 8, 16, 30][Math.min(backoff, 5)] * 1000;
        backoff += 1;
        logger(`Telegram polling failed (${error?.code ?? 'UNKNOWN'}); retrying in ${wait}ms`);
        await sleep(wait, signal);
        continue;
      }
      backoff = 0;
      const ordered = Array.isArray(updates)
        ? [...updates].sort((left, right) => left.update_id - right.update_id)
        : [];
      for (const update of ordered) {
        if (stopped) return;
        try {
          await handleUpdate(update);
        } catch (error) {
          if (error?.name === 'CliError' || error?.code === 'STORAGE_FAILURE') {
            fatalDiagnostic = 'durable state could not be committed; the broker must stop';
            logger(fatalDiagnostic);
            throw error;
          }
          logger(`Telegram update ${update.update_id} could not be processed`);
        }
      }
    }
  };

  // ---------------------------------------------------------------------
  // Presentation worker
  // ---------------------------------------------------------------------

  const sendRequestMessage = async (request) => {
    const sent = await telegram.sendMessage({
      chat_id: state.pairing.chat_id,
      text: assertTelegramLength(renderRequestMessage(request)),
      reply_markup: requestKeyboard(request),
    });
    if (!Number.isInteger(sent?.message_id)) {
      throw new TelegramError('TELEGRAM_REJECTED', 'sendMessage returned no message id');
    }
    await broker.recordPresentation(
      request.request_id,
      { ...request.presentation, chat_id: state.pairing.chat_id, message_id: sent.message_id },
      'sent',
    );
  };

  const retireKeyboardAndAnnounce = async (request) => {
    const chatId = request.presentation.chat_id ?? state.pairing.chat_id;
    try {
      await telegram.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: request.presentation.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    } catch (error) {
      logger(`keyboard retirement failed (${error?.code ?? 'UNKNOWN'})`);
    }
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: request.presentation.message_id,
      text: assertTelegramLength(renderResolvedMessage(request)),
    });
    const fresh = state.requests.get(request.request_id);
    await broker.recordPresentation(request.request_id, {
      ...fresh.presentation,
      resolved_announced_at: broker.nowIso(),
    });
  };

  const announceDelivery = async (request) => {
    const chatId = request.presentation.chat_id ?? state.pairing.chat_id;
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: request.presentation.message_id,
      text: assertTelegramLength(renderResolvedMessage(request)),
    });
    const fresh = state.requests.get(request.request_id);
    await broker.recordPresentation(request.request_id, {
      ...fresh.presentation,
      delivered_announced_at: broker.nowIso(),
    });
  };

  const presentationTick = async () => {
    if (stopped || state.pairing === null) return;
    const now = clock();
    for (const request of [...state.requests.values()]) {
      const retryAt = presentationRetryAt.get(request.request_id) ?? 0;
      if (now < retryAt) continue;
      const presentation = request.presentation;
      if (presentation === undefined) continue;
      try {
        if (presentation.message_id === null && request.telegram_state === 'pending') {
          await sendRequestMessage(request);
          presentationRetryAt.delete(request.request_id);
          continue;
        }
        if (
          request.resolution !== 'pending' &&
          presentation.message_id !== null &&
          presentation.resolved_announced_at === null
        ) {
          await retireKeyboardAndAnnounce(request);
          presentationRetryAt.delete(request.request_id);
          continue;
        }
        if (
          ['delivered', 'blocked'].includes(request.delivery_state) &&
          presentation.message_id !== null &&
          presentation.resolved_announced_at !== null &&
          presentation.delivered_announced_at === null
        ) {
          await announceDelivery(request);
          presentationRetryAt.delete(request.request_id);
        }
      } catch (error) {
        presentationRetryAt.set(request.request_id, clock() + 30_000);
        logger(`presentation for ${request.request_id} failed (${error?.code ?? 'UNKNOWN'})`);
      }
    }
  };

  return {
    start() {
      if (polling !== null) return;
      pollAbort = new AbortController();
      polling = pollLoop(pollAbort.signal).catch((error) => {
        fatalDiagnostic =
          fatalDiagnostic ?? 'Telegram polling stopped after a durable-state failure';
        logger(`Telegram polling stopped: ${error?.message ?? 'storage failure'}`);
      });
      presentationTimer = setInterval(() => {
        presentationTick().catch(() => {});
      }, PRESENTATION_TICK_MS);
      presentationTimer.unref?.();
    },
    async stop() {
      stopped = true;
      pollAbort?.abort();
      if (presentationTimer !== null) clearInterval(presentationTimer);
      presentationTimer = null;
      await polling?.catch(() => {});
      polling = null;
    },
    diagnostic: () => fatalDiagnostic,
  };
}
