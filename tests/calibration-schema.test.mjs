import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { roots, extract, pinnedFixture, compareSchema, sourceHash } from './support/calibration-schema.mjs';

// Small synthetic document tests the comparator, not the public contract.
function synthetic() {
  const schema = { paths: {}, components: { schemas: {
    SessionMessagesResponse: { $ref: '#/components/schemas/Session.Message.Info' },
    'Session.Message.Info': { anyOf: [{ $ref: '#/components/schemas/Session.Message.Assistant' },
      { $ref: '#/components/schemas/Session.Message.Idle' }] },
    'Session.Message.Assistant': { type: 'object' }, 'Session.Message.Idle': { type: 'object' },
  } } };
  for (const pointer of roots.filter(p => p.startsWith('#/paths'))) {
    const [, , escaped, method] = pointer.split('/');
    const path = escaped.replaceAll('~1', '/').replaceAll('~0', '~');
    schema.paths[path] = { [method]: { responses: { 200: { $ref: '#/components/schemas/SessionMessagesResponse' } } } };
  }
  return schema;
}
test('B-SCHEMA: recursively compares operations and all referenced schemas, detects changed/missing pointers', () => {
  const schema = synthetic(), fixture = { sourceHash, nodes: extract(schema) };
  assert.equal(compareSchema(schema, fixture).hostProof, false);
  const changed = structuredClone(schema);
  changed.components.schemas['Session.Message.Assistant'].type = 'string';
  assert.throws(() => compareSchema(changed, fixture), /SCHEMA_POINTER_DIFFERENCE/);
  delete changed.components.schemas['Session.Message.Idle'];
  assert.throws(() => compareSchema(changed, fixture), /MISSING_SCHEMA_POINTER/);
  assert.throws(() => pinnedFixture(Buffer.from('{}')), /PUBLIC_SOURCE_PIN/);
});
test('B-PUBLIC-PIN: supplied public source is required; missing fixture is RED, not host proof', async () => {
  const path = new URL('../../../.tools/handoffs/opencode-v2-openapi.json', import.meta.url);
  const fixture = pinnedFixture(await readFile(path));
  assert.ok(Object.keys(fixture.nodes).length >= roots.length);
  assert.equal(compareSchema(JSON.parse(await readFile(path)), fixture).supportEligible, false);
});
