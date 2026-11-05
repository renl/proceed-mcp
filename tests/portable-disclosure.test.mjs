// TEST ONLY: public disclosure restoration. No Telegram or resumption proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { portable } from './support/portable-waiting.mjs';
import { cliRules, mcpRules, missingMeanings } from './support/disclosure-contract.mjs';

test('DISCLOSURE-ORACLE: meaning examples, omissions and contradictory timeout controls', () => {
  for (const rules of [mcpRules, cliRules]) {
    const sentences = rules.map(({ example }) => example);
    assert.deepEqual(missingMeanings(sentences.join('\n'), rules), []);
    // Changed formatting/case and ordinary wording variation are not exact copy.
    const paraphrase = sentences.join(' ').replaceAll('does not', 'never')
      .replaceAll('grants', 'permits').replaceAll('unavailable', 'not supported').toUpperCase();
    assert.deepEqual(missingMeanings(paraphrase, rules), []);
    for (const [index, { id }] of rules.entries()) {
      assert.ok(missingMeanings(sentences.filter((_, i) => i !== index).join('\n'), rules).includes(id), id);
    }
  }
  const wrong = 'Client timeout cancels the durable request. A lost call closes the durable approval. Events support automatic resumption.';
  assert.ok(missingMeanings(wrong, cliRules).includes('timeout-not-cancellation'));
  assert.ok(missingMeanings(wrong, cliRules).includes('lost-call-not-cancellation'));
  assert.ok(missingMeanings(wrong, cliRules).includes('unsupported-events'));
  assert.ok(missingMeanings('timeout lost Events cancel', mcpRules).length > 0, 'keywords are not disclosure');
});

for (const [surface, rules] of [['MCP initialize', mcpRules], ['CLI help', cliRules]]) {
  test(`C3-MCP-DISCLOSURE-001: ${surface} communicates approved meanings`, { timeout: 65000 }, () => portable(async h => {
    const text = surface === 'MCP initialize' ? h.shared.initialization.instructions : await h.cli('--help');
    assert.equal(typeof text, 'string', 'actual public output');
    // Existing meanings are positive controls on real output, not fixture-only proof.
    const controls = surface === 'MCP initialize'
      ? ['prepare-before-wait', 'private-retention', 'explicit-approve-only', 'deduplicate-before-acting']
      : ['available-baseline', 'respond-not-approval'];
    assert.deepEqual(missingMeanings(text, rules.filter(({ id }) => controls.includes(id))), [], 'preserved public meanings');
    assert.deepEqual(missingMeanings(text, rules), [], `${surface}: missing approved relational disclosures`);
  }, { pair: false }));
}
