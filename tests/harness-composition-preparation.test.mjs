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
  compositionActivation,
  compositionAdmission,
  observeCompositionSelectors,
  openTitle,
} from './support/harness-composition-readiness.mjs';

const readyFrame = `2.2.5\nAsk anything\n┃  ${productReadyText}  ┃`;

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
  assert.match(fixture, /observeCompositionSelectors\(context, session.id\)/);
  assert.match(fixture, /live = false;[\s\S]*publish\(\);[\s\S]*await cleanup\(\)/);
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

test('render gate waits for activation and a fresh observation after the current frame', async () => {
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
      admitted: tick >= 4,
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
    [{ admitted: false }, 'READINESS_DEADLINE'],
    [{ admitted: false, rendered: compositionRenderEvidence('') }, 'READINESS_DEADLINE'],
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
          admitted: true,
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
  const paint = `\x1b[?2026h\x1b[2J\x1b[1;1H2.2.5\x1b[2;1HAsk anything\x1b[3;1H\x1b[32m${row('Proceed harness ready for qualification (owner')}\x1b[0m\x1b[4;1H${row('shared). Operator key fingerprint')}\x1b[?2026l`;
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

const origin = { target: '/fixture', entry: '/fixture/tui.ts' };
const loaderLine = (message, fields = '') =>
  `run=live message="${message}" component=plugin ${fields} role=cli`;
const activationLog = [
  loaderLine(
    'plugin operation completed',
    'id=4 stage=read target=/fixture entrypoint=file:///fixture/tui.ts',
  ),
  loaderLine(
    'plugin operation started',
    'id=21 stage=setup plugin=proceed.harness target=/fixture',
  ),
  loaderLine(
    'plugin operation completed',
    'id=21 stage=setup plugin=proceed.harness target=/fixture',
  ),
  loaderLine('plugin reconciliation completed', 'id=1 plugins=17'),
].join('\n');
const frame = compositionCurrentFrame(
  '\x1b[?2026h\x1b[2J\x1b[1;1HAsk anything\x1b[5;1H2.2.5\x1b[?2026l',
);
const binding = {
  run: 'attempt3',
  hostRun: 'live',
  generation: 'generation1',
  session: 'exact-session',
};
function admission() {
  return {
    binding,
    activation: compositionActivation(activationLog, origin),
    frame,
    frameToken: 100,
    request: { ...binding, request: 1, frame, frameToken: 100 },
    response: { ...binding, request: 1, live: true, commandEligible: true },
    live: { ...binding, live: true },
    exited: false,
    now: 5,
    deadline: 10,
  };
}

test('one-key admission needs current input/footer plus fresh same-generation selectors, not a visible toast', () => {
  const state = admission();
  assert.equal(compositionRenderEvidence(frame).productReadySeen, false);
  assert.equal(compositionAdmission(state), true);
  const overwritten = admission();
  overwritten.frame = compositionCurrentFrame(
    '\x1b[?2026h\x1b[2J\x1b[1;1HAsk anything\x1b[5;1H2.2.5\x1b[3;1H' +
      `┃  ${productReadyText}  ┃` +
      '\x1b[?2026l' +
      '\x1b[?2026h\x1b[3;1H\x1b[2KOther toast\x1b[?2026l',
  );
  overwritten.request.frame = overwritten.frame;
  assert.equal(compositionRenderEvidence(overwritten.frame).productReadySeen, false);
  assert.equal(compositionAdmission(overwritten), true);
  let keys = 0;
  if (compositionAdmission(state)) {
    keys++;
    state.exited = true;
  }
  if (compositionAdmission(state)) keys++;
  assert.equal(keys, 1);
  for (const mutate of [
    (s) => (s.activation = null),
    (s) => (s.activation.run = 'old-host-run'),
    (s) => (s.response.run = 'old-run'),
    (s) => (s.response.generation = 'old-generation'),
    (s) => (s.live.live = false),
    (s) => (s.live.generation = 'replacement'),
    (s) => (s.response.commandEligible = false),
    (s) => (s.response.session = null),
    (s) => (s.response.session = 'other-session'),
    (s) => (s.request.frame = 'old-frame'),
    (s) => (s.frameToken = 101),
    (s) => (s.response.request = 0),
    (s) => (s.frame = ''),
    (s) => (s.exited = true),
    (s) => (s.now = s.deadline),
  ]) {
    const candidate = structuredClone(admission());
    mutate(candidate);
    assert.equal(compositionAdmission(candidate), false);
  }
  const old = admission().response;
  const replaced = admission();
  replaced.binding = { ...binding, generation: 'generation2' };
  replaced.response = old; // Delayed old-generation response cannot reauthorize.
  assert.equal(compositionAdmission(replaced), false);
  for (const update of ['\x1b[?2026h\x1b[2J\x1b[?2026l', '\x1b[?2026h', '\x1b[1A', '\x1b[']) {
    const candidate = admission();
    candidate.frame = compositionCurrentFrame(
      '\x1b[?2026h\x1b[2J\x1b[1;1HAsk anything\x1b[5;1H2.2.5\x1b[?2026l' + update,
    );
    assert.equal(compositionAdmission(candidate), false);
  }
});

test('actual public selector projection refuses missing, disabled, inactive commands and wrong sessions', () => {
  const observe = ({
    command = { id: 'proceed.harness.open', title: openTitle },
    active = [{ key: 'ctrl+g', title: openTitle }],
    session = { id: binding.session },
  } = {}) =>
    observeCompositionSelectors(
      {
        keymap: { commands: () => (command ? [command] : []), active: () => active },
        data: {
          session: {
            get: (id) => {
              assert.equal(id, binding.session);
              return session;
            },
          },
        },
      },
      binding.session,
    );
  assert.deepEqual(observe(), { commandEligible: true, session: binding.session });
  for (const option of [
    { command: null },
    { command: { id: 'other', title: openTitle } },
    { command: { id: 'proceed.harness.open', title: 'wrong title' } },
    { command: { id: 'proceed.harness.open', title: openTitle, enabled: false } },
    { command: { id: 'proceed.harness.open', title: openTitle, enabled: () => false } },
    { active: [] },
    { active: [{ key: 'ctrl+x', title: openTitle }] },
  ])
    assert.equal(observe(option).commandEligible, false);
  for (const session of [null, { id: 'other' }]) assert.equal(observe({ session }).session, null);
});

test('host activation requires exact run/entry/setup then reconcile and invalidates at cleanup start or replacement', () => {
  assert.deepEqual(compositionActivation(activationLog, origin), { run: 'live', setup: '21' });
  assert.equal(
    compositionActivation(activationLog.split('\n').slice(0, 3).join('\n'), origin),
    null,
  );
  for (const log of [
    activationLog.replace('file:///fixture/tui.ts', 'file:///other/tui.ts'),
    activationLog.replace('run=live', 'run=old'),
    activationLog +
      '\n' +
      loaderLine(
        'plugin operation started',
        'id=57 stage=cleanup plugin=proceed.harness target=/fixture',
      ),
    activationLog +
      '\n' +
      loaderLine(
        'plugin operation started',
        'id=58 stage=setup plugin=proceed.harness target=/fixture',
      ),
    activationLog +
      '\n' +
      loaderLine(
        'plugin operation failed',
        'id=21 stage=setup plugin=proceed.harness target=/fixture',
      ),
  ])
    assert.equal(compositionActivation(log, origin), null);
  assert.deepEqual(
    compositionActivation(
      activationLog + '\n' + loaderLine('plugin reconciliation completed', 'id=2 plugins=17'),
      origin,
    ),
    { run: 'live', setup: '21' },
  );
});

test('actual wrapper fences selector observations at Cleanup entry before awaiting product cleanup', async () => {
  let tick,
    finish,
    cleared = false;
  const files = new Map([
    ['/run/proceed/evidence/composition-binding.json', JSON.stringify({ run: binding.run })],
  ]);
  const write = (path, bytes) => files.set(path, bytes);
  const source = (
    await readFile(new URL('fixtures/harness-composition/tui.ts', import.meta.url), 'utf8')
  )
    .replace(/import \* as Plugin[^;]+;/, 'const Plugin = { define: value => value };')
    .replace(/import product[^;]+;/, 'const product = globalThis.__compositionFixtureTEST.product;')
    .replace(
      /import \{ writeFile \}[^;]+;/,
      'const { writeFile } = globalThis.__compositionFixtureTEST;',
    )
    .replace(
      /import \{ readFileSync, writeFileSync \}[^;]+;/,
      'const { readFileSync, writeFileSync, setInterval, clearInterval } = globalThis.__compositionFixtureTEST;',
    )
    .replace(/import \{ randomUUID \}[^;]+;/, "const randomUUID = () => 'generation1';")
    .replace(
      "'/payload/tests/support/harness-composition-readiness.mjs'",
      JSON.stringify(new URL('support/harness-composition-readiness.mjs', import.meta.url).href),
    );
  globalThis.__compositionFixtureTEST = {
    writeFile: async (...args) => write(...args),
    writeFileSync: write,
    readFileSync: (path) => {
      if (!files.has(path)) throw Error('missing');
      return files.get(path);
    },
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
    product: {
      id: 'proceed.harness',
      setup: async () => () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  };
  try {
    const wrapper = (
      await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
    ).default;
    const context = {
      app: { version: '2.2.5' },
      client: { session: { create: async () => ({ data: { id: binding.session } }) } },
      data: { session: { sync: async () => {}, get: () => ({ id: binding.session }) } },
      keymap: {
        commands: () => [{ id: 'proceed.harness.open', title: openTitle }],
        active: () => [{ key: 'ctrl+g', title: openTitle }],
      },
    };
    const cleanup = await wrapper.setup(context);
    const requestPath = '/run/proceed/evidence/composition-selector-request.json';
    const responsePath = '/run/proceed/evidence/composition-selector-response.json';
    write(requestPath, JSON.stringify({ ...binding, request: 1 }));
    tick();
    assert.equal(JSON.parse(files.get(responsePath)).commandEligible, true);
    const pending = cleanup();
    assert.equal(cleared, true);
    assert.equal(JSON.parse(files.get('/run/proceed/evidence/composition-live.json')).live, false);
    write(requestPath, JSON.stringify({ ...binding, request: 2 }));
    tick();
    assert.equal(JSON.parse(files.get(responsePath)).request, 1);
    finish();
    await pending;
  } finally {
    delete globalThis.__compositionFixtureTEST;
  }
});
