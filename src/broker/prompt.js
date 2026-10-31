// Exact decision prompt text delivered into the requesting session (design
// section 6). The heading states the outcome in plain language; the JSON data
// record preserves the human intent byte-for-byte and is the durable outbox
// payload replayed on every retry.
const HEADINGS = {
  approved:
    'Approval recorded for the identified action in this session. This is an approval for that action only.',
  rejected:
    'Rejection recorded for the identified action. This is a rejection: it grants no approval and does not authorize the action.',
  responded:
    'Instructions only for the identified action. This is not approval; any action that still needs approval requires a new request.',
};

export const DECISION_RECORD_FIELDS = [
  'schema_version',
  'request_id',
  'origin_id',
  'session_id',
  'action',
  'context',
  'resolution',
  'response_text',
  'resolved_at',
];

export function decisionRecord(request) {
  return {
    schema_version: 1,
    request_id: request.request_id,
    origin_id: request.origin_id,
    session_id: request.session_id,
    action: request.action,
    context: request.context,
    resolution: request.resolution,
    response_text: request.response_text,
    resolved_at: request.resolved_at,
  };
}

export function decisionPromptText(request) {
  const heading = HEADINGS[request.resolution];
  if (heading === undefined) {
    throw new Error(`no decision prompt heading for resolution ${request.resolution}`);
  }
  return `${heading}\n\n${JSON.stringify(decisionRecord(request))}`;
}
