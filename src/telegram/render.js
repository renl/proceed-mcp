// Plain-text Telegram rendering (design section 5). No parse mode is used, so
// text is sent exactly as shown here; every rendering is checked against the
// platform limit before a request may be persisted.
import { scalarLength } from '../util/values.js';

export const MAX_TELEGRAM_TEXT = 4096;

export function renderRequestMessage(request) {
  return [
    `Approval request ${request.request_id}`,
    '',
    `Session: ${request.session_label}`,
    `Session ID: ${request.session_id}`,
    `Origin: ${request.origin_id}`,
    `Action: ${request.action}`,
    `Context: ${request.context === '' ? '(none)' : request.context}`,
    `Expires: ${request.expires_at}`,
    'State: pending',
    'Delivery: not applicable',
  ].join('\n');
}

const DELIVERY_LABELS = {
  not_applicable: 'not applicable',
  pending: 'pending confirmation',
  admitted: 'admitted, awaiting delivery confirmation',
  delivered: 'delivered to session',
  blocked: 'blocked - see operator status',
};

export function renderResolvedMessage(request) {
  return [
    `Approval request ${request.request_id}`,
    '',
    `Session: ${request.session_label}`,
    `Session ID: ${request.session_id}`,
    `Origin: ${request.origin_id}`,
    `Action: ${request.action}`,
    `Context: ${request.context === '' ? '(none)' : request.context}`,
    `Expires: ${request.expires_at}`,
    `Resolution: ${request.resolution}`,
    `Delivery: ${DELIVERY_LABELS[request.delivery_state] ?? request.delivery_state}`,
  ].join('\n');
}

export function renderReplyPrompt(request) {
  return [
    `Respond to request ${request.request_id}`,
    '',
    'Reply to this message with instructions for this request only.',
    'Your reply is instructions, not approval: any action that still needs approval',
    'requires a separate request.',
  ].join('\n');
}

export function requestKeyboard(request) {
  const token = request.callback_token;
  return {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: `a:${token}`, style: 'success' },
        { text: 'Reject', callback_data: `r:${token}`, style: 'danger' },
        { text: 'Respond', callback_data: `t:${token}`, style: 'primary' },
      ],
    ],
  };
}

export function assertTelegramLength(text) {
  if (scalarLength(text) > MAX_TELEGRAM_TEXT) {
    throw new RangeError('the rendered Telegram message would exceed 4096 characters');
  }
  return text;
}
