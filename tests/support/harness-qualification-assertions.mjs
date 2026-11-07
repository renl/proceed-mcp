// TEST ONLY. Shared assertions for actual runner observations, not attestation
// from a human:true flag. Synthetic unit calls establish assertion behavior only.
import assert from 'node:assert/strict';

export function assertAttackNonEffect(before, after) {
  assert.equal(before.status.resolution, 'pending');
  assert.equal(before.status.decision_id, null);
  assert.ok(before.presentation);
  assert.deepEqual(after, before, 'ordinary API traffic cannot settle or retarget pending work');
}

export function assertBoundOutcome(presentation, response, choice, text = null) {
  assert.equal(response.accepted, true);
  assertBoundRetainedOutcome(presentation, response, choice, text);
}

export function assertBoundRetainedOutcome(presentation, response, choice, text = null) {
  assert.equal(response.schema_version, 1);
  assert.equal(response.request_id, presentation.request_id);
  assert.ok(typeof response.decision_id === 'string' && response.decision_id.length > 0);
  const resolution = { approve: 'approved', reject: 'rejected', respond: 'responded' }[choice];
  assert.ok(resolution, 'unknown domain choice');
  assert.equal(response.resolution, resolution);
  assert.equal(response.response_text, choice === 'respond' ? text : null);
}

export function assertRetainedLoser(winner, loser) {
  assert.equal(winner.accepted, true);
  assert.deepEqual(loser, { ...winner, accepted: false });
}

// Feed raw ingress/egress JSON-RPC captured before tool invocation, never a
// reconstructed metadata record or a direct broker route fixture. Provenance is
// established by the maintained observer's placement, not this pure comparator.
export function assertOriginalCallRouting(calls, results, expected) {
  assert.equal(expected.length, 2);
  assert.notEqual(expected[0].session_id, expected[1].session_id);
  assert.notEqual(expected[0].request_id, expected[1].request_id);
  const usedIds = new Set();
  const connection = calls[0]?.connection;
  assert.ok(connection, 'capture the shared MCP connection before invocations');
  for (const e of expected) {
    for (const [id, tool] of [
      [e.prepare_id, 'prepare_approval'],
      [e.wait_id, 'request_approval'],
    ]) {
      assert.equal(usedIds.has(id), false, 'original JSON-RPC IDs must be distinct');
      usedIds.add(id);
      const matching = calls.filter((c) => c.message.id === id);
      assert.equal(matching.length, 1);
      const call = matching[0];
      assert.equal(call.connection, connection, 'distinct sessions share one adapter connection');
      assert.equal(call.message.method, 'tools/call');
      assert.equal(call.message.params.name, tool);
      assert.equal(call.message.params._meta?.['ai.opencode/sessionID'], e.session_id);
      assert.equal('harness_route' in call.message.params.arguments, false);
      assert.equal('session_id' in call.message.params.arguments, false);
    }
    const matching = results.filter((r) => r.message.id === e.wait_id);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].connection, connection);
    const body = matching[0].message.result?.structuredContent;
    assert.ok(body, 'original waiting-call structured result required');
    assert.equal(body.request_id, e.request_id);
    assert.equal(body.resolution, e.resolution);
    assert.equal(body.response_text, e.response_text);
  }
}

// Inspect complete raw run-owned captures before redaction/export. Never include
// secret values in assertion diagnostics. A redacted-only scan is not this check.
export function assertNoAuthorityLeak(captures, { operatorAndTransport, requestCapabilities }) {
  for (const name of ['tui', 'telegram', 'journal', 'diagnostics', 'mcp', 'evidence'])
    assert.ok(Object.hasOwn(captures, name), `missing raw ${name} capture`);
  assert.ok(operatorAndTransport.length > 0);
  for (const secret of [...operatorAndTransport, ...requestCapabilities]) {
    assert.ok(typeof secret === 'string' && secret.length > 0);
    for (const [name, raw] of Object.entries(captures)) {
      assert.ok(typeof raw === 'string' || Buffer.isBuffer(raw));
      // The baseline intentionally returns private request authority on the
      // authorized MCP preparation result and accepts it on management calls.
      // Do not turn that contract into an invented blanket MCP prohibition.
      if (name === 'mcp' && requestCapabilities.includes(secret)) continue;
      assert.equal(raw.includes(secret), false, `private authority leaked into ${name}`);
    }
  }
}

export function assertUnauthenticatedListener(capture, secrets) {
  assert.ok(Buffer.isBuffer(capture) && capture.length > 0, 'listener must observe a real attempt');
  assert.equal(capture.includes('Authorization:'), false);
  assert.equal(capture.includes('authorization:'), false);
  for (const secret of secrets) {
    assert.ok(typeof secret === 'string' && secret.length > 0);
    assert.equal(capture.includes(secret), false, 'unverified listener received private authority');
  }
}
