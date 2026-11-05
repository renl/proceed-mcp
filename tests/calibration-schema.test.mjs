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
test('B-PUBLIC-PIN: exact public source reproduces tracked relevant-node fixture, not host proof', async () => {
  // Resolve from this module, never cwd. The source is the active-worktree copy.
  const bytes = await readFile(new URL('../.tools/handoffs/opencode-v2-openapi.json', import.meta.url));
  assert.equal(bytes.length, 726513);
  const fixture = JSON.parse(await readFile(new URL('./fixtures/calibration-schema-pin.json', import.meta.url)));
  assert.deepEqual(pinnedFixture(bytes), fixture);
  assert.equal(Object.keys(fixture.nodes).length, 85);
  assert.equal(compareSchema(JSON.parse(bytes), fixture).supportEligible, false);
});
