// TEST ONLY. Fixed product-boundary scenario for the maintained PTY lifecycle.
// Driver I/O below is internal test plumbing, never a product endpoint/context.
import assert from 'node:assert/strict';
import {
  assertAttackNonEffect,
  assertBoundRetainedOutcome,
} from './harness-qualification-assertions.mjs';

export const ordinaryAttackCases = Object.freeze([
  'native-form-reply',
  'synthetic-record',
  'public-rpc',
  'programmatic-command',
  'direct-broker-basic',
  'direct-broker-owner',
  'direct-broker-capability',
]);

// Compose only with real PTY stdin, actual rendered-output waits and independent
// public broker wire observations. Unit controls of this procedure are not proof
// that those I/O adapters or the genuine product exist.
export async function exerciseRenderedProduct(driver, presentation, choice, openKeys) {
  assert.ok(['dismiss', 'reject', 'respond', 'approve'].includes(choice));
  assert.ok(typeof openKeys === 'string' && openKeys.length > 0);
  const before = await driver.observe(presentation);
  assert.equal(before.presentation.request_id, presentation.request_id);
  assert.equal(before.presentation.presentation_id, presentation.presentation_id);
  assert.equal(before.presentation.session_id, presentation.session_id);
  assertAttackNonEffect(before, before);

  driver.stdin.write(openKeys); // Actual documented product control, not fixture UI.
  await driver.waitRendered([
    presentation.request_id,
    presentation.session_label,
    presentation.action,
    presentation.context,
    presentation.expires_at,
    'Approve',
    'Reject',
    'Respond',
  ]);
  const attacks = [];
  await driver.ordinaryAttacks(presentation, async (id) => {
    assert.ok(ordinaryAttackCases.includes(id), 'unknown ordinary-API attack');
    assert.equal(attacks.includes(id), false, 'duplicate attack observation');
    assertAttackNonEffect(before, await driver.observe(presentation));
    // Current rendered UI, not a stale title in accumulated PTY output. Stop
    // before Enter could reach the composer or start a provider after dismissal.
    await driver.waitCurrentProductDialog(presentation);
    attacks.push(id);
  });
  assert.deepEqual(
    attacks.sort(),
    [...ordinaryAttackCases].sort(),
    'missing real ordinary-API attack',
  );

  // No reopen between attacks and selection. A fresh callback or handler call
  // cannot rescue an API-settled/dismissed product dialog to make the test pass.
  if (choice === 'dismiss') {
    driver.stdin.write('\x1b');
    await driver.waitDismissed();
    assertAttackNonEffect(before, await driver.observe(presentation));
    return;
  }
  driver.stdin.write(
    choice === 'reject' ? '\r' : `${choice === 'approve' ? 'Approve' : 'Respond'}\r`,
  );
  if (choice === 'respond') {
    await driver.waitResponsePrompt(presentation);
    driver.stdin.write('approved\r');
  }
  // Poll the public presentation-status wire for the immutable retained outcome.
  // Do not require decrypted interception or a test API to expose the TUI's
  // private response. This proves the outcome, not its accepted-response flag.
  const retained = await driver.waitRetainedOutcome(presentation);
  assertBoundRetainedOutcome(
    presentation,
    retained,
    choice,
    choice === 'respond' ? 'approved' : null,
  );
  const after = await driver.observe(presentation);
  assert.equal(after.status.request_id, retained.request_id);
  assert.equal(after.status.decision_id, retained.decision_id);
  assert.equal(after.status.resolution, retained.resolution);
  assert.equal(after.status.response_text, retained.response_text);
}
