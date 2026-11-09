// TEST ONLY. Fixed product-boundary scenario for the maintained PTY lifecycle.
// Driver I/O below is internal test plumbing, never a product endpoint/context.
import assert from 'node:assert/strict';
import { confirmRenderedNavigation } from './harness-navigation-observation.mjs';
import {
  assertAttackNonEffect,
  assertBoundRetainedOutcome,
} from './harness-qualification-assertions.mjs';

export const ordinaryAttackCases = Object.freeze([
  'native-form-reply',
  'synthetic-record',
  'public-rpc',
  'direct-broker-basic',
  'direct-broker-owner',
  'direct-broker-capability',
]);

// Programmatic open is a separate replacement/navigation scenario. It is not a
// forged reply that must leave the existing question visible. The integrated
// driver must prove its navigation-only successor and inert old completions
// separately, before beginning the fresh genuine-decision path below.
export const replacementAttackCase = 'programmatic-command';

// Compose only with real PTY stdin, actual rendered-output waits and independent
// public broker wire observations. Unit controls of this procedure are not proof
// that those I/O adapters or the genuine product exist.
export async function exerciseRenderedProduct(driver, presentation, choice, session) {
  assert.ok(['dismiss', 'reject', 'respond', 'approve'].includes(choice));
  assert.equal(session.id, presentation.session_id, 'picker must target the bound host ID');
  assert.ok(typeof session.title === 'string' && session.title.length > 0);
  assert.ok(typeof session.id === 'string' && session.id.length > 0);
  assert.doesNotMatch(session.id, /[\x00-\x1f\x7f]/, 'host ID must be safe PTY search input');
  const before = await driver.observe(presentation);
  assert.equal(before.presentation.request_id, presentation.request_id);
  assert.equal(before.presentation.presentation_id, presentation.presentation_id);
  assert.equal(before.presentation.session_id, presentation.session_id);
  assertAttackNonEffect(before, before);

  // Provisional highlighted ordinal -> complete current identity -> question.
  // The driver moves/searches by ordinal, never by the no-longer-visible full ID.
  driver.stdin.write('\x07'); // Product ctrl+g, not a fixture control.
  assertAttackNonEffect(before, await driver.observe(presentation));
  await confirmRenderedNavigation(driver, session);
  assertAttackNonEffect(before, await driver.observe(presentation));
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
  await driver.waitCurrentProductDialog(presentation);
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

  // No reopen between forged-reply attacks and selection. Replacement attacks
  // are separate and never send a decision key into a picker or composer.
  await driver.waitCurrentProductDialog(presentation);
  if (choice === 'dismiss') {
    // This is the separate replacement scenario, not a rescue of a failed
    // same-question assertion. It must finish before a new genuine interaction.
    assert.equal(typeof driver.programmaticCommandAttack, 'function');
    assert.equal(typeof driver.waitReplacementNavigation, 'function');
    await driver.programmaticCommandAttack(presentation);
    assertAttackNonEffect(before, await driver.observe(presentation));
    await driver.waitReplacementNavigation(presentation);
    assertAttackNonEffect(before, await driver.observe(presentation));
    // Escape only. Never send Approve/Reject/Respond/Enter into the successor.
    driver.stdin.write('\x1b');
    await driver.waitDismissed();
    assertAttackNonEffect(before, await driver.observe(presentation));
    return;
  }
  if (typeof driver.chooseCurrentQuestion === 'function') {
    // Integrated actual-host adapters own fresh current selection/Enter fences.
    // A text search or `current` option alone is not selected-role proof.
    await driver.chooseCurrentQuestion(presentation, choice);
  } else {
    // Legacy memory-driver orchestration controls only. Integrated orchestration
    // requires chooseCurrentQuestion and never takes this synthetic fallback.
    driver.stdin.write(
      choice === 'reject' ? '\r' : `${choice === 'approve' ? 'Approve' : 'Respond'}\r`,
    );
  }
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
