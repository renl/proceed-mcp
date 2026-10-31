// TEST ONLY observation model, NOT a product schema or real-boundary attestation.
// Live runner must collect these observations from the public boundaries; a
// fabricated object passing this checker proves nothing about a running host.
import assert from 'node:assert/strict';

export function assertTimeoutObservations(observed) {
  const order = ['observation-started', 'host-call-started', 'durable-created',
    'receipt-withheld', 'host-tool-timeout', 'telegram-decision',
    'history-confirmed', 'assistant-acknowledged', 'replay-observed'];
  let previous = -1;
  for (const step of order) {
    const index = observed.events.indexOf(step);
    assert.ok(index > previous, `missing/out-of-order observation: ${step}`);
    previous = index;
  }
  assert.ok(!observed.events.includes('host-call-completed'), 'completed receipt is not timeout');
  assert.deepEqual(observed.hostAfter, observed.hostBefore, 'same origin/version/PID/session incarnation');
  assert.equal(observed.hostRunningAtTimeout, true);
  assert.equal(observed.pendingAtTimeout.resolution, 'pending');
  assert.ok(['approved', 'rejected', 'responded'].includes(observed.accepted.resolution));
  const { request_id, session_id, origin_id, resolution, response_text, resolved_at } = observed.accepted;
  const decision = { request_id, session_id, origin_id, resolution, response_text, resolved_at };
  assert.deepEqual(observed.afterReplay, decision, 'accepted decision preserved after restart/replay');
  assert.equal(observed.prompt.id, `msg_${request_id.slice(4)}`);
  assert.equal(observed.history.id, observed.prompt.id);
  assert.equal(observed.history.type, 'user');
  assert.equal(observed.history.text, observed.prompt.text);
  assert.ok(!observed.inbox.data.some((item) => item.id === observed.prompt.id));
  assert.equal(observed.otherSessionDecisionInputs, 0);
  assert.equal(observed.decisionDrivenAcknowledgements.length, 1, 'no duplicate within declared window');
  const acknowledgement = observed.decisionDrivenAcknowledgements[0];
  assert.equal(acknowledgement.session_id, session_id);
  assert.ok(acknowledgement.text.includes(request_id));
  // Outcome/intent inspection is a required live assertion, not inferred from
  // a keyword or from HTTP history. Phase B supplies the actual content check.
  assert.equal(observed.intentVerified, true);
  assert.ok(observed.duplicateObservationMs >= 30000, 'bounded duplicate observation >=30s');
}
