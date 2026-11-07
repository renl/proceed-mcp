// TEST ONLY. Admission/source wiring, not a compiled-host or wire verdict.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { qualificationPayload } from './support/harness-linux-plan.mjs';

test('composition stages its maintained runner and uses the actual public product entry/context', async () => {
  const payload = qualificationPayload(['src/harness/tui-entry.js', 'bin/proceed-mcp.js']);
  for (const path of [
    'tests/support/harness-composition-inner.mjs',
    'tests/fixtures/harness-composition/tui.ts',
    'tests/fixtures/harness-composition/broker-observer.mjs',
  ])
    assert.ok(payload.includes(path));
  const fixture = await readFile(
    new URL('fixtures/harness-composition/tui.ts', import.meta.url),
    'utf8',
  );
  assert.match(fixture, /from '@meshimize\/proceed-mcp\/tui'/);
  assert.match(fixture, /product\.setup\(context\)/);
  assert.match(fixture, /await cleanup\(\)/);
  assert.doesNotMatch(
    fixture,
    /runHelperExchange|createOperatorLocalClient|createSecureLocalClient/,
  );
  const inner = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    inner.indexOf('scanRequiredCaptures(captures') < inner.indexOf("'composition-summary.json'"),
  );
  assert.match(inner, /physical-helper-absence/);
  assert.match(inner, /exact-product-PluginCleanup/);
  assert.match(inner, /selected session has no pending question/);
});
