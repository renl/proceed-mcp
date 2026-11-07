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
  compositionCurrentFrame,
} from './support/harness-composition-readiness.mjs';

const readyFrame = `2.2.5\n┃  ${productReadyText}  ┃`;

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
      rendered: compositionRenderEvidence(tick < 2 ? '' : tick < 3 ? '2.2.5' : readyFrame),
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
          rendered: compositionRenderEvidence(readyFrame),
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

test('ready toast reconstructs only exact adjacent aligned current rows', () => {
  const row = (s) => `┃  ${s.padEnd(54)}┃`;
  const wrapped = [
    row('Proceed harness ready for qualification (owner'),
    row('shared). Operator key fingerprint'),
  ].join('\n');
  assert.equal(compositionRenderEvidence(wrapped).productReadySeen, true);
  assert.equal(compositionRenderEvidence(row(productReadyText)).productReadySeen, true);
  const narrow = ['Proceed harness ready', 'for qualification (owner', 'shared).']
    .map((s) => `┃  ${s.padEnd(25)}┃`)
    .join('\n');
  assert.equal(compositionRenderEvidence(narrow).productReadySeen, true);
  for (const text of [
    '',
    productReadyText,
    wrapped.replace('shared).', 'Shared).'),
    wrapped.replace('shared).', ''),
    wrapped.replace('\n', '\n\n'),
    wrapped.replace('\n', '\n '),
    wrapped.split('\n').reverse().join('\n'),
    wrapped.replace('owner', 'own er'),
    wrapped.replace('┃  shared', '|  shared'),
  ])
    assert.equal(compositionRenderEvidence(text).productReadySeen, false, text);
  const paint = `\x1b[?2026h\x1b[2J\x1b[1;1H2.2.5\x1b[3;1H\x1b[32m${row('Proceed harness ready for qualification (owner')}\x1b[0m\x1b[4;1H${row('shared). Operator key fingerprint')}\x1b[?2026l`;
  assert.equal(compositionRenderEvidence(compositionCurrentFrame(paint)).productReadySeen, true);
  for (const update of [
    '\x1b[?2026h\x1b[3;1H\x1b[2K\x1b[?2026l',
    '\x1b[?2026h\x1b[4;4Hmissing\x1b[?2026l',
    '\x1b[?2026h\x1b[2J\x1b[?2026l',
    '\x1b[?2026h\x1b[3;1H' + row('Other toast') + '\x1b[?2026l',
  ])
    assert.equal(
      compositionRenderEvidence(compositionCurrentFrame(paint + update)).productReadySeen,
      false,
    );
  assert.equal(compositionCurrentFrame(paint.slice(0, -8)), '');
  assert.equal(compositionCurrentFrame(paint + '\x1b[?2026h'), '');
  // The retained run rendered the ready toast before the host footer, then
  // overwrote it with a different toast. Never union readiness across frames.
  const noFooter = paint.replace('2.2.5', '     ');
  const laterFooter = '\x1b[?2026h\x1b[1;1H2.2.5\x1b[3;1H' + row('Other toast') + '\x1b[?2026l';
  const first = compositionRenderEvidence(compositionCurrentFrame(noFooter));
  const second = compositionRenderEvidence(compositionCurrentFrame(noFooter + laterFooter));
  assert.equal(first.productReadySeen, true);
  assert.equal(first.hostFrameSeen, false);
  assert.equal(second.productReadySeen, false);
  assert.equal(second.hostFrameSeen, true);
});
