import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTimeoutObservations } from './support/spike-assertions.mjs';

function fixture() {
  const request_id = `req_${'a'.repeat(32)}`;
  const decision = { request_id, origin_id: 'fixture', session_id: 'fixture_session',
    resolution: 'responded', response_text: ' yes, approved\n', resolved_at: '2026-10-31T00:00:00Z' };
  const host = { origin_id: 'fixture', version: 'fixture', pid: 1,
    session_id: 'fixture_session', created: 1 };
  return { events: ['observation-started', 'host-call-started', 'durable-created',
    'receipt-withheld', 'host-tool-timeout', 'telegram-decision', 'history-confirmed',
    'assistant-acknowledged', 'replay-observed'], hostBefore: host, hostAfter: { ...host },
    hostRunningAtTimeout: true, pendingAtTimeout: { resolution: 'pending' },
    accepted: decision, afterReplay: { ...decision },
    prompt: { id: `msg_${'a'.repeat(32)}`, text: 'fixture only' },
    history: { id: `msg_${'a'.repeat(32)}`, text: 'fixture only', type: 'user' },
    inbox: { data: [] }, otherSessionDecisionInputs: 0,
    decisionDrivenAcknowledgements: [{ session_id: 'fixture_session', text: request_id }],
    intentVerified: true, duplicateObservationMs: 30000 };
}

test('PROOF-CHECKER-01: synthetic observations exercise assertions, never attest live proof', () => {
  assert.doesNotThrow(() => assertTimeoutObservations(fixture()));
  for (const mutate of [
    (f) => f.events.push('host-call-completed'),
    (f) => f.events.reverse(),
    (f) => { f.hostRunningAtTimeout = false; },
    (f) => { f.afterReplay.response_text = 'changed'; },
    (f) => { f.hostAfter.pid = 2; },
    (f) => { f.history.text = 'rewritten'; },
    (f) => { f.inbox.data.push({ id: f.prompt.id }); },
    (f) => { f.otherSessionDecisionInputs = 1; },
    (f) => { f.decisionDrivenAcknowledgements.push(f.decisionDrivenAcknowledgements[0]); },
    (f) => { f.intentVerified = false; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => assertTimeoutObservations(data));
  }
});
