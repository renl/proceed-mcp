// TEST ONLY: approved annex127/131, design3, continuation capability boundary.
// Each rule relates subjects to an action/limit in a sentence. Not an NLP oracle.
const rule = (id, pattern, example) => ({ id, pattern, example });
const limits = [
  rule('bounded-wait', /(?:client|transport)[^.\n]*(?:timeouts?|time limits?)[^.\n]*(?:limit|bound|constrain)[^.\n]*wait/i,
    'Client and transport timeouts limit how long the call can wait.'),
  rule('timeout-not-cancellation', /(?:timeout|timed out)[^.\n]*(?:does not|do not|never|neither)[^.\n]*(?:cancel|close|expire)[^.\n]*(?:durable|request|approval)/i,
    'A client timeout does not cancel the durable request.'),
  rule('lost-call-not-cancellation', /(?:lost call|call is lost|lost waiting call)[^.\n]*(?:does not|do not|never|neither)[^.\n]*(?:cancel|close|expire)[^.\n]*(?:durable|request|approval)/i,
    'A lost call never closes the durable approval.'),
  rule('unsupported-events', /(?:Events[^.\n]*(?:unsupported|not supported|unavailable|not implemented)|(?:unsupported|not supported|unavailable|not implemented)[^.\n]*Events)/i,
    'MCP Events are unsupported in this build.'),
  rule('no-automatic-resumption', /(?:automatic|automatically)[^.\n]*(?:resum|continu|wake)[^.\n]*(?:unavailable|not supported|not promised)|(?:no|cannot|does not)[^.\n]*(?:automatic|automatically)[^.\n]*(?:resum|continu|wake)/i,
    'Automatic post-timeout resumption is unavailable.'),
];
export const cliRules = [
  rule('available-baseline', /(?:local )?waiting[^.\n]*Telegram[^.\n]*Approve[^.\n]*Reject[^.\n]*Respond[^.\n]*(?:available|supported)/i,
    'Local waiting, Telegram question display and paired-human Approve, Reject and Respond are available.'),
  rule('respond-not-approval', /Respond[^.\n]*instructions[^.\n]*(?:not|never)[^.\n]*approval/i,
    'Respond text is instructions, not approval.'),
  ...limits,
];
export const mcpRules = [
  rule('prepare-before-wait', /(?:first[^.\n]*prepare_approval|prepare_approval[^.\n]*first)/i,
    'First call prepare_approval before the waiting request.'),
  rule('prepare-no-question', /prepare_approval[^.\n]*(?:no question|without[^.\n]*question|does not send[^.\n]*question)/i,
    'prepare_approval reserves authority without sending a question.'),
  rule('private-retention', /(?:keep|retain)[^.\n]*capability[^.\n]*private[^.\n]*(?:retain|keep)[^.\n]*(?:handle|request_handle)[^.\n]*(?:request_id|ID)/i,
    'Keep the request capability private and retain it with the request_handle and request_id.'),
  rule('no-authority-echo', /(?:never|do not)[^.\n]*(?:echo|expose|print)[^.\n]*capability[^.\n]*assistant[^.\n]*Telegram/i,
    'Never echo the request capability in assistant acknowledgements or Telegram messages.'),
  rule('same-principal-transfer', /(?:sharing|transfer|shared)[^.\n]*capability[^.\n]*same[^.\n]*principal[^.\n]*(?:grants|permits|authorizes)[^.\n]*(?:request|access|authority)/i,
    'Sharing a valid capability under the same transport principal grants authority for that request.'),
  rule('original-call-not-redirected', /(?:sharing|transfer|capability)[^.\n]*(?:does not|cannot|never)[^.\n]*(?:redirect|transfer|change)[^.\n]*original[^.\n]*(?:call|response)/i,
    'Capability transfer cannot redirect the original call response.'),
  rule('not-event-route', /(?:principal|capability)[^.\n]*(?:does not|cannot|never)[^.\n]*(?:establish|grant|prove|provide)[^.\n]*event[^.\n]*rout/i,
    'The principal or capability alone cannot establish an event route.'),
  rule('retained-authorized-retrieval', /(?:retained|retain|stored)[^.\n]*(?:outcome|decision)[^.\n]*(?:capability[^.\n]*(?:authorized|retrieval)|authorized[^.\n]*retrieval)/i,
    'The retained outcome remains available through capability-authorized retrieval.'),
  rule('retrieval-no-wake', /(?:retrieval|get_approval)[^.\n]*(?:does not|never|cannot)[^.\n]*(?:wake|trigger[^.\n]*turn|start[^.\n]*turn)/i,
    'Retrieval does not wake an agent.'),
  rule('observation-no-new-decision', /(?:retriev|observ)[^.\n]*acknowledg[^.\n]*(?:neither|does not|do not|never|not)[^.\n]*(?:new|another|second)[^.\n]*decision/i,
    'Retrieval and acknowledgement do not create another decision.'),
  rule('matching-terminal-ack', /(?:terminal|received)[^.\n]*decision_id[^.\n]*(?:acknowledge_approval|acknowledged)/i,
    'A received terminal decision_id must be acknowledged with acknowledge_approval.'),
  rule('exact-decision-ack', /acknowledge_approval[^.\n]*(?:exact|matching|same)[^.\n]*decision_id/i,
    'Call acknowledge_approval with the matching decision_id.'),
  rule('subsequent-assistant-ack', /(?:subsequent|next)[^.\n]*assistant[^.\n]*(?:acknowledge|report)[^.\n]*request[^.\n]*outcome/i,
    'In the subsequent assistant turn acknowledge the matching request_id and outcome.'),
  rule('deduplicate-before-acting', /deduplicat[^.\n]*request_id[^.\n]*decision_id[^.\n]*before[^.\n]*act/i,
    'Deduplicate by request_id and decision_id before acting.'),
  rule('explicit-approve-only', /only[^.\n]*explicit[^.\n]*Approve[^.\n]*(?:grant|permit|authoriz)[^.\n]*approval/i,
    'Only an explicit Approve grants approval.'),
  rule('reject-is-rejection', /Reject[^.\n]*(?:records rejection|not[^.\n]*authoriz|forbids)/i,
    'Reject records rejection.'),
  rule('correlated-instructions', /Respond[^.\n]*instructions[^.\n]*(?:valid|correlated)[^.\n]*text/i,
    'Respond records instructions only after valid correlated text.'),
  rule('response-words-no-approval', /approval-like[^.\n]*Respond[^.\n]*(?:never|not)[^.\n]*approval/i,
    'Approval-like words in Respond text never grant approval.'),
  rule('new-request-still-required', /(?:still needs|still needing|still requires)[^.\n]*approval[^.\n]*(?:requires|needs)[^.\n]*new[^.\n]*request/i,
    'An action that still needs approval requires a new explicit request.'),
  ...limits,
];

export function missingMeanings(text, rules) {
  return rules.filter(({ pattern }) => !pattern.test(text)).map(({ id }) => id);
}
