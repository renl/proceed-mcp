import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAssistant, assistantSchemaHash } from './support/assistant-extraction.mjs';

const record = (content = [{ type: 'text', text: 'exact\n text ' }]) => ({
  id: 'msg_fixture', type: 'assistant', time: { created: 1 }, agent: 'fixture',
  model: { id: 'fixture', providerID: 'fixture' }, content,
});
test('ASSISTANT-SOURCE: ordered text parts only; no invented completion/merge semantics', () => {
  const raw = record([{ type: 'reasoning', text: 'not acknowledgement' },
    { type: 'text', text: 'first\n' }, { type: 'text', text: ' second ' },
    { type: 'tool', id: 'fixture', name: 'fixture', time: { created: 1 },
      state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'not prose' }] } }]);
  const extracted = extractAssistant(raw);
  assert.deepEqual(extracted.textParts, ['first\n', ' second ']);
  assert.equal(extracted.sourceHash, assistantSchemaHash);
  assert.equal(extracted.completionEstablished, false);
  for (const finish of [undefined, 'stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']) {
    assert.equal(extractAssistant({ ...record(), finish, time: { created: 1, completed: 2 } })
      .completionEstablished, false);
  }
});
test('ASSISTANT-NONTEXT: empty/reasoning/tool-only content supplies no acknowledgement', () => {
  for (const content of [[], [{ type: 'reasoning', text: 'req_marker approved' }],
    [{ type: 'tool', id: 'fixture', name: 'fixture', time: { created: 1 },
      state: { status: 'streaming', input: '{' } }]]) {
    const result = extractAssistant(record(content));
    assert.deepEqual(result.textParts, []);
    assert.equal(result.completionEstablished, false);
  }
});
test('ASSISTANT-NEG: absent/partial raw content and schema mismatches fail, flags do not supply prose', () => {
  for (const raw of [{ type: 'user', text: 'approved' }, { ...record(), content: undefined },
    record([{ type: 'text' }]), record([{ type: 'image', text: 'approved' }]),
    { ...record(), model: {} }, { ...record(), time: {} },
    { ...record(), finish: 'completed' }]) assert.throws(() => extractAssistant(raw));
  const result = extractAssistant({ ...record([]), complete: true, intentVerified: true });
  assert.deepEqual(result.textParts, []);
  assert.equal(result.completionEstablished, false);
});
