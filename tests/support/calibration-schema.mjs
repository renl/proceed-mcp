// TEST ONLY: exact JSON node digests, recursively including every local $ref.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sourceHash = '92cc33ef9a107c8af6295e6fcbdf6d339d4374955910924456bd91a76844a5db';
const digest = x => createHash('sha256').update(x).digest('hex');
const canonical = x => JSON.stringify(x && typeof x === 'object' ?
  Array.isArray(x) ? x.map(v => JSON.parse(canonical(v))) :
    Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))])) : x);
const escape = x => x.replaceAll('~', '~0').replaceAll('/', '~1');
export const roots = [
  ['/api/info', 'get'], ['/api/session/{sessionID}', 'get'],
  ['/api/session/{sessionID}/prompt', 'post'], ['/api/session/{sessionID}/inbox', 'get'],
  ['/api/session/{sessionID}/message', 'get'], ['/api/session/{sessionID}/message/{messageID}', 'get'],
].map(([path, method]) => `#/paths/${escape(path)}/${method}`).concat([
  'SessionMessagesResponse', 'Session.Message.Info', 'Session.Message.Assistant', 'Session.Message.Idle',
].map(x => `#/components/schemas/${escape(x)}`));
function resolve(schema, pointer) {
  assert.ok(pointer.startsWith('#/'), 'LOCAL_REFERENCE_REQUIRED');
  let node = schema;
  for (const part of pointer.slice(2).split('/')) node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  assert.ok(node && typeof node === 'object', `MISSING_SCHEMA_POINTER: ${pointer}`);
  return node;
}
export function extract(schema) {
  const nodes = {};
  function visit(pointer) {
    if (nodes[pointer]) return;
    const node = resolve(schema, pointer); nodes[pointer] = digest(canonical(node));
    function refs(value) {
      if (!value || typeof value !== 'object') return;
      if (value.$ref) visit(value.$ref);
      for (const child of Object.values(value)) refs(child);
    }
    refs(node);
  }
  roots.forEach(visit);
  return Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b)));
}
export function pinnedFixture(bytes) {
  assert.equal(digest(bytes), sourceHash, 'PUBLIC_SOURCE_PIN');
  return { source: 'https://opencode.ai/v2/openapi.json', sourceHash, nodes: extract(JSON.parse(bytes)) };
}
export function compareSchema(target, fixture) {
  assert.equal(fixture.sourceHash, sourceHash, 'FIXTURE_PIN');
  assert.deepEqual(extract(target), fixture.nodes, 'SCHEMA_POINTER_DIFFERENCE_REQUIRES_REVIEW');
  return { relevantPointersMatch: true, hostProof: false, supportEligible: false };
}
