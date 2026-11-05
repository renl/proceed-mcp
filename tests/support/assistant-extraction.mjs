// TEST ONLY source-based consumer, not a completion or compatibility contract.
// Source SHA256: 92CC33EF9A107C8AF6295E6FCBDF6D339D4374955910924456BD91A76844A5DB
// Pointers/research: active change assistant-schema-research.md sections 5-6/10.
import assert from 'node:assert/strict';

export const assistantSchemaHash = '92CC33EF9A107C8AF6295E6FCBDF6D339D4374955910924456BD91A76844A5DB';
export function extractAssistant(raw) {
  assert.equal(raw.type, 'assistant', 'not an assistant record');
  assert.match(raw.id, /^msg_/);
  assert.equal(typeof raw.time?.created, 'number');
  assert.equal(typeof raw.agent, 'string');
  assert.equal(typeof raw.model?.id, 'string');
  assert.equal(typeof raw.model?.providerID, 'string');
  assert.ok(Array.isArray(raw.content), 'missing public assistant content');
  const textParts = [];
  for (const part of raw.content) {
    assert.ok(['text', 'reasoning', 'tool'].includes(part.type), 'unknown assistant content type');
    if (part.type === 'text' || part.type === 'reasoning') {
      assert.equal(typeof part.text, 'string');
      if (part.type === 'text') textParts.push(part.text);
    } else {
      assert.equal(typeof part.id, 'string');
      assert.equal(typeof part.name, 'string');
      assert.equal(typeof part.time?.created, 'number');
      assert.ok(['streaming', 'running', 'completed', 'error'].includes(part.state?.status),
        'invalid tool state');
    }
  }
  if (raw.finish !== undefined) assert.ok(['stop', 'length', 'tool-calls',
    'content-filter', 'error', 'unknown'].includes(raw.finish), 'unknown finish');
  // Keep parts separate: the source specifies no separator/merge rule.
  return { textParts, completionEstablished: false,
    observations: { finish: raw.finish, completed: raw.time.completed,
      error: raw.error, retry: raw.retry }, sourceHash: assistantSchemaHash };
}
