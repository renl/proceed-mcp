// TEST ONLY. Admission/source wiring, not a compiled-host or wire verdict.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { qualificationPayload } from './support/harness-linux-plan.mjs';
import {
  awaitCompositionRender,
  compositionRenderEvidence,
  compositionErrorCode,
  productReadyText,
} from './support/harness-composition-readiness.mjs';

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
  assert.ok(
    inner.indexOf('await awaitCompositionRender(') < inner.indexOf("child.stdin.write('\\x07')"),
  );
  assert.match(fixture, /context\.keymap\s*\.commands\(\)/);
  assert.match(fixture, /context\.keymap\s*\.active\(\)/);
  assert.doesNotMatch(fixture, /keymap\.dispatch|command\.run/);
  const failureCapture = inner.slice(inner.indexOf('// Failure captures'));
  assert.ok(
    failureCapture.indexOf('scanRequiredCaptures(captures') <
      failureCapture.indexOf("'transcript.ansi'"),
  );
  assert.match(failureCapture, /closed && !overflow/);
  assert.match(failureCapture, /currentScreen: 'UNPROVEN'/);
  const runner = await readFile(
    new URL('support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const failureExport = runner.slice(runner.indexOf('if (created && composition)'));
  assert.ok(
    failureExport.indexOf('assertDetailedTransportExport(') <
      failureExport.indexOf("'transcript.ansi'"),
  );
});

test('render gate waits for delayed first frame, product rendering and public command eligibility', async () => {
  let tick = 0;
  const seen = [];
  await awaitCompositionRender({
    now: () => tick,
    deadline: 10,
    pause: async () => {
      tick++;
    },
    observe: async () => ({
      exited: false,
      overflow: false,
      commandEligible: tick >= 4,
      rendered: compositionRenderEvidence(
        tick < 2 ? '' : tick < 3 ? '2.2.5' : `2.2.5 ${productReadyText}`,
      ),
    }),
    record: (value) => seen.push(value),
  });
  assert.equal(tick, 4);
  assert.equal(seen[0].hostFrameSeen, false);
  assert.equal(seen[2].productReadySeen, false);
  assert.equal(seen[3].commandEligible, false);
  assert.equal(seen[4].commandEligible, true);
});

test('failure paths refuse readiness and retain fixed nonsecret codes', async () => {
  for (const [state, code] of [
    [{ exited: true }, 'HOST_EXITED'],
    [{ overflow: true }, 'CAPTURE_LIMIT'],
    [{ commandEligible: false }, 'READINESS_DEADLINE'],
    [{ rendered: compositionRenderEvidence('') }, 'READINESS_DEADLINE'],
  ]) {
    let tick = 0;
    await assert.rejects(
      awaitCompositionRender({
        now: () => tick,
        deadline: 3,
        pause: async () => {
          tick++;
        },
        record: () => {},
        observe: async () => ({
          rendered: compositionRenderEvidence(`2.2.5 ${productReadyText}`),
          commandEligible: true,
          exited: false,
          overflow: false,
          ...state,
        }),
      }),
      (error) => compositionErrorCode(error) === code,
    );
  }
  assert.equal(compositionErrorCode(new Error('synthetic-secret')), 'CONTROL_ASSERTION_OR_IO');
});
