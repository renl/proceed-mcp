// Portable approval presentation (design sections 4-5). These are pure
// functions: no I/O, no mutation and no transport. Caller-supplied strings are
// rendered exactly as received -- never trimmed, escaped, normalized or cut --
// and length is counted in UTF-16 code units over the complete message.
//
// The broker rejects over-limit input before persisting a request; this module
// still renders and measures even over-limit text intact.

export const MAX_TELEGRAM_TEXT = 4096;

export const PORTABLE_RESOLUTION_LABELS = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  responded: 'responded (instructions only)',
  expired: 'expired',
  cancelled: 'cancelled',
});

export const PORTABLE_DELIVERY_LABELS = Object.freeze({
  not_applicable: 'not_applicable',
  pending: 'pending',
  returned: 'returned',
  confirmed: 'confirmed',
  unavailable: 'unavailable',
  blocked: 'blocked',
});

const PENDING_RESOLUTION = 'pending';
const NO_DELIVERY = 'not_applicable';

// A request is presented once while pending and then once per terminal
// resolution/delivery pair, so the bound covers every presentation rather than
// only the status a caller happens to hold.
const TERMINAL_RESOLUTIONS = Object.freeze(
  Object.keys(PORTABLE_RESOLUTION_LABELS).filter((label) => label !== PENDING_RESOLUTION),
);
const TERMINAL_DELIVERIES = Object.freeze(
  Object.keys(PORTABLE_DELIVERY_LABELS).filter((label) => label !== NO_DELIVERY),
);

function requestLines(request, resolution, deliveryState) {
  return [
    `Approval request ${request.request_id}`,
    '',
    `Owner: ${request.owner_id}`,
    `Caller-supplied context (display only, not verified identity): ${request.session_label}`,
    `Action: ${request.action}`,
    `Context: ${request.context === '' ? '(none)' : request.context}`,
    `Expires: ${request.expires_at}`,
    `Resolution: ${PORTABLE_RESOLUTION_LABELS[resolution]}`,
    `Delivery: ${PORTABLE_DELIVERY_LABELS[deliveryState]}`,
  ];
}

export function renderPortableRequestMessage(request) {
  return requestLines(request, request.resolution, request.delivery_state).join('\n');
}

export function renderPortableReplyPrompt(request) {
  return [
    `Respond to request ${request.request_id}`,
    '',
    'Reply to this message with instructions for this request only.',
    'Your reply is instructions, not approval: any action that still needs approval',
    'requires a separate request.',
  ].join('\n');
}

export function measurePortablePresentation(request) {
  let requestLength = 0;
  const measure = (resolution, deliveryState) => {
    const length = requestLines(request, resolution, deliveryState).join('\n').length;
    requestLength = Math.max(requestLength, length);
  };

  measure(PENDING_RESOLUTION, NO_DELIVERY);
  for (const resolution of TERMINAL_RESOLUTIONS) {
    for (const deliveryState of TERMINAL_DELIVERIES) {
      measure(resolution, deliveryState);
    }
  }

  const replyPromptLength = renderPortableReplyPrompt(request).length;
  const worst =
    requestLength >= replyPromptLength
      ? { kind: 'request', length: requestLength }
      : { kind: 'reply_prompt', length: replyPromptLength };

  return { request: requestLength, reply_prompt: replyPromptLength, worst };
}
