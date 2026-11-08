// TEST ONLY. Admission/source wiring, not a compiled-host or wire verdict.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { qualificationPayload } from './support/harness-linux-plan.mjs';
import {
  awaitCompositionRender,
  compositionRenderEvidence,
  compositionErrorCode,
  productReadyText,
  compositionCurrentFrame,
  compositionActivation,
  compositionAdmission,
  compositionSnapshot,
  compositionCanRequestFresh,
  awaitCompositionKeyAdmission,
  compositionGuardJournal,
  observeCompositionSelectors,
  openTitle,
} from './support/harness-composition-readiness.mjs';
import { scanRequiredCaptures } from './support/harness-transport-fixtures.mjs';
import { assertDetailedTransportExport } from './support/harness-runtime-transport.mjs';

const readyFrame = `2.2.5\nAsk anything\n┃  ${productReadyText}  ┃`;

test('composition stages its maintained runner and uses the actual public product entry/context', async () => {
  const payload = qualificationPayload(['src/harness/tui-entry.js', 'bin/proceed-mcp.js']);
  for (const path of [
    'tests/support/harness-composition-inner.mjs',
    'tests/support/harness-navigation-observation.mjs',
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
  assert.ok(/scanFrozenComposition\(\{\s*captures/.test(inner));
  assert.match(inner, /physical-helper-absence/);
  assert.match(inner, /confirmRenderedNavigation\(/);
  assert.match(inner, /geometry: live.geometry/);
  assert.doesNotMatch(inner, /includes\(runtime.session\)/);
  assert.match(inner, /exact-product-PluginCleanup/);
  assert.match(inner, /selected session has no pending question/);
  assert.ok(
    inner.indexOf('await awaitCompositionKeyAdmission(') <
      inner.indexOf("child.stdin.write('\\x07')"),
  );
  assert.match(inner, /deadline: readinessEnd/);
  assert.match(inner, /compositionCanRequestFresh\(state, snapshot\)/);
  assert.match(inner, /onAdmit: \(state\) =>/);
  assert.equal((inner.match(/child\.stdin\.write\('\\x07'\)/g) ?? []).length, 1);
  assert.match(fixture, /observeCompositionSelectors\(context, session.id\)/);
  assert.match(fixture, /live = false;[\s\S]*publish\(\);[\s\S]*await cleanup\(\)/);
  assert.doesNotMatch(fixture, /keymap\.dispatch|command\.run/);
  const failureCapture = inner.slice(
    inner.indexOf("const diagnosticBytes = await logs('/run/proceed/host-state')"),
  );
  const catchStart = inner.indexOf('} catch (error) {');
  const catchBlock = inner.slice(catchStart, inner.indexOf('} finally {', catchStart));
  assert.ok(
    catchBlock.indexOf('failureSnapshot({') < catchBlock.indexOf('persistCompositionDiagnostic('),
  );
  assert.ok(
    catchBlock.indexOf('persistCompositionDiagnostic(') < catchBlock.indexOf('throw error'),
  );
  assert.ok(
    failureCapture.indexOf('scanFrozenComposition({') < failureCapture.indexOf("'transcript.ansi'"),
  );
  assert.match(inner, /complete = closed && remainingPids.length === 0/);
  assert.ok(
    failureCapture.indexOf('JSON.stringify(guardJournal.value())') <
      failureCapture.indexOf('scanFrozenComposition({'),
  );
  assert.ok(
    failureCapture.indexOf('guardJournal: guardJournal.value()') <
      failureCapture.indexOf('scanFrozenComposition({'),
  );
  assert.match(failureCapture, /currentScreen: 'UNPROVEN'/);
  const runner = await readFile(
    new URL('support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const failureExport = runner.slice(runner.indexOf('if (created && composition)'));
  assert.ok(
    failureExport.indexOf('assertCompositionExport(') < failureExport.indexOf("'transcript.ansi'"),
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
  hostSetup: '21',
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
    overflow: false,
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

test('full final operand projection reports every refusal without raw values or accessor reads', () => {
  const secret = 'synthetic-private-authority';
  let reads = 0;
  const trap = Object.defineProperty({}, 'run', {
    get() {
      reads++;
      throw Error(secret);
    },
  });
  const state = admission();
  state.binding = {
    run: secret,
    generation: secret,
    hostRun: secret,
    hostSetup: secret,
    session: secret,
  };
  state.activation = trap;
  state.request = { run: { deep: { secret } }, frame: secret, frameToken: Infinity };
  state.response = { commandEligible: secret, session: { deep: secret } };
  state.live = trap;
  state.frame = '';
  state.exited = true;
  state.overflow = true;
  state.now = state.deadline;
  const result = compositionSnapshot(state);
  assert.equal(reads, 0);
  assert.equal(result.admitted, false);
  assert.equal(result.failed.length, Object.values(result.checks).filter((v) => !v).length);
  for (const name of [
    'hostRunning',
    'captureWithinLimit',
    'hostRunMatch',
    'setupMatch',
    'originalDeadlineOpen',
    'frameEquality',
    'exactPositionMatch',
    'sessionMatch',
    'commandEligible',
  ])
    assert.ok(result.failed.includes(name), name);
  assert.equal(JSON.stringify(result).includes(secret), false);
  for (const value of [null, undefined, secret, 5, { binding: trap }, { binding: { run: {} } }]) {
    const projected = compositionSnapshot(value);
    assert.equal(projected.admitted, false);
    assert.equal(JSON.stringify(projected).includes(secret), false);
  }
  const timed = compositionSnapshot({ ...admission(), requestWrittenAt: 1, responseReadAt: 4 });
  assert.equal(timed.localRequestAgeMs, 4);
  assert.equal(timed.localResponseAgeMs, 1);
  assert.equal(timed.originalRemainingMs, 5);
  assert.match(timed.clockProvenance, /NOT_SELECTOR_SAMPLE/);
  assert.equal(compositionSnapshot({ ...admission(), responseReadAt: 6 }).localResponseAgeMs, null);
});

test('operand history is bounded and full raw scan remains the export floor', () => {
  const journal = compositionGuardJournal();
  for (let i = 0; i < 140; i++) journal.record('loopadmit', compositionSnapshot(admission()));
  journal.record('finalrefuse', compositionSnapshot({ ...admission(), frameToken: 101 }));
  journal.record('CleanupENTRY', compositionSnapshot({ ...admission(), exited: true }));
  const value = journal.value();
  assert.equal(value.records.length, 128);
  assert.equal(value.dropped, 14);
  assert.equal(value.records[0].sequence, 15);
  assert.equal(value.records.at(-2).stage, 'finalrefuse');
  assert.equal(value.records.at(-1).stage, 'CleanupENTRY');
  assert.equal(value.records.at(-1).sequence, 142);
  assert.equal(value.lastFinalRefusal.sequence, 141);
  assert.throws(() => journal.record('arbitrary-private-path', {}));
  for (const raw of [
    'synthetic-private-authority',
    { checks: { deep: { secret: 'private' } } },
    Object.defineProperty({}, 'checks', {
      get() {
        throw Error('never read accessor');
      },
    }),
  ])
    assert.throws(() => journal.record('finalrefuse', raw), /unsafe guard projection/);
  const injected = {
    ...compositionSnapshot(admission()),
    error: new Error('private'),
    frame: 'private',
    clockProvenance: 'private',
  };
  journal.record('finaladmit', injected);
  assert.equal(JSON.stringify(journal.value()).includes('private'), false);
  for (let i = 0; i < 150; i++) journal.record('loopadmit', compositionSnapshot(admission()));
  assert.equal(journal.value().lastFinalRefusal.sequence, 141);
  assert.equal(
    journal.value().records.some((r) => r.stage === 'finalrefuse'),
    false,
  );
  const secret = 'synthetic-private-authority';
  const captures = {
    evidence: Buffer.from(JSON.stringify(value)),
    tui: Buffer.from('complete-raw'),
  };
  const scan = scanRequiredCaptures(captures, [secret], ['evidence', 'tui']);
  assert.doesNotThrow(() => assertDetailedTransportExport(scan));
  assert.throws(() =>
    scanRequiredCaptures({ ...captures, tui: Buffer.from(secret) }, [secret], ['evidence', 'tui']),
  );
  assert.throws(() => scanRequiredCaptures(captures, [secret], ['evidence', 'tui', 'missing']));
  assert.throws(() => assertDetailedTransportExport(null));
});

// Scripted async loader reads, selector responses and monotonic test clock.
// No real host, wall-clock wait, process, product, broker or helper is involved.
async function scriptedAdmission({
  mutateFinal = (s) => {
    s.frameToken = 101;
  },
  continuing = false,
  finalTick,
} = {}) {
  let tick = 0,
    observations = 0,
    keys = 0,
    fresh = 0;
  let current = structuredClone(admission());
  const records = [],
    events = [];
  const deadline = 8;
  try {
    await awaitCompositionKeyAdmission({
      now: () => tick,
      deadline,
      observe: async () => {
        await Promise.resolve(); // Models output arriving during async log read.
        observations++;
        if (observations === 2 || (continuing && observations % 2 === 0)) {
          mutateFinal(current);
          if (finalTick !== undefined) tick = finalTick;
        }
        events.push('observe:' + current.frameToken);
        return structuredClone(current);
      },
      requestFresh: (state, snapshot) => {
        assert.equal(keys, 0);
        if (!compositionCanRequestFresh(state, snapshot)) return;
        fresh++;
        events.push('requestfresh:' + state.frameToken);
        current.request = {
          ...state.binding,
          frame: state.frame,
          frameToken: state.frameToken,
          request: state.request.request + 1,
        };
        current.response = { ...current.response, request: current.request.request };
      },
      pause: async () => {
        tick++;
      },
      record: (phase, snapshot) => {
        records.push({ phase, snapshot });
        events.push(phase);
      },
      onAdmit: (state) => {
        assert.equal(compositionAdmission({ ...state, now: tick, deadline }), true);
        keys++;
        events.push('key');
      },
    });
    return { keys, fresh, records, events, tick };
  } catch (error) {
    return { keys, fresh, records, events, tick, code: compositionErrorCode(error) };
  }
}

test('async identical repaint 100->101 refuses final, requests fresh and admits before exactly one key', async () => {
  const result = await scriptedAdmission();
  assert.equal(result.keys, 1);
  assert.equal(result.fresh, 1);
  assert.deepEqual(result.events, [
    'observe:100',
    'loopadmit',
    'observe:101',
    'finalrefuse',
    'requestfresh:101',
    'observe:101',
    'loopadmit',
    'observe:101',
    'finaladmit',
    'key',
  ]);
  const refused = result.records[1].snapshot;
  assert.deepEqual(refused.failed, ['exactPositionMatch']);
  assert.equal(refused.checks.frameEquality, true);
  assert.equal(refused.currentOffset, 101);
  assert.equal(refused.requestedOffset, 100);
  assert.equal(result.tick, 1);
});

test('final invalidations never key and continuing output expires under the original budget', async () => {
  for (const mutateFinal of [
    (s) => {
      s.activation = null;
    }, // Cleanup ENTRY as interpreted by loader.
    (s) => {
      s.activation.setup = 'replacement';
    },
    (s) => {
      s.live.generation = 'replacement';
    },
    (s) => {
      s.live.live = false;
    },
    (s) => {
      s.response.commandEligible = false;
    },
    (s) => {
      s.response.session = 'wrong-session';
    },
    (s) => {
      s.response.request = 0;
    },
    (s) => {
      s.exited = true;
    },
    (s) => {
      s.overflow = true;
    },
    ...['\x1b[?2026h', '\x1b[?2026h\x1b[2J\x1b[?2026l', '\x1b[1A'].map((update) => (s) => {
      s.frame = compositionCurrentFrame(
        '\x1b[?2026h\x1b[1;1HAsk anything\x1b[5;1H2.2.5\x1b[?2026l' + update,
      );
    }),
  ]) {
    const result = await scriptedAdmission({ mutateFinal });
    assert.equal(result.keys, 0);
    assert.ok(['READINESS_DEADLINE', 'HOST_EXITED', 'CAPTURE_LIMIT'].includes(result.code));
    assert.ok(result.tick <= 8);
    assert.equal(result.records[1].phase, 'finalrefuse');
  }
  const noisy = await scriptedAdmission({
    continuing: true,
    mutateFinal: (s) => {
      s.frameToken++;
    },
  });
  assert.equal(noisy.keys, 0);
  assert.equal(noisy.code, 'READINESS_DEADLINE');
  assert.equal(noisy.tick, 8);
  assert.equal(noisy.fresh, 8);
  assert.ok(noisy.records.every((r) => r.snapshot.originalRemainingMs <= 8));
  const expired = await scriptedAdmission({ finalTick: 8 });
  assert.equal(expired.keys, 0);
  assert.equal(expired.fresh, 0);
  assert.equal(expired.code, 'READINESS_DEADLINE');
  assert.ok(expired.records[1].snapshot.failed.includes('originalDeadlineOpen'));
  const changedFrame = await scriptedAdmission({
    mutateFinal: (s) => {
      s.frame = s.frame + '\nOther toast';
      s.frameToken = 102;
    },
  });
  assert.equal(changedFrame.keys, 1);
  assert.equal(changedFrame.fresh, 1);
  assert.ok(changedFrame.records[1].snapshot.failed.includes('frameEquality'));
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
    [
      '/run/proceed/evidence/composition-binding.json',
      JSON.stringify({ run: binding.run, captureOnly: true }),
    ],
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
      data: {
        session: {
          sync: async () => {},
          get: () => ({ id: binding.session }),
          list: () => [
            { id: binding.session, title: 'same' },
            { id: 'second', title: 'same' },
          ],
        },
      },
      keymap: {
        commands: () => [{ id: 'proceed.harness.open', title: openTitle }],
        active: () => [{ key: 'ctrl+g', title: openTitle }],
      },
    };
    const cleanup = await wrapper.setup(context);
    assert.deepEqual(
      JSON.parse(files.get('/run/proceed/evidence/composition-live.json')).snapshot,
      [
        { id: binding.session, title: 'same', ordinal: 'Session 1' },
        { id: 'second', title: 'same', ordinal: 'Session 2' },
      ],
    );
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

test('capture host entry dispatch is separate, skips setup pending probe, freezes provenance and uses bounded product-only export', async () => {
  const source = async (name) => readFile(new URL(name, import.meta.url), 'utf8');
  const entry = await source('run-harness-host.mjs');
  assert.match(
    entry,
    /--product-picker-capture-run[\s\S]*runLinuxHost\(false, 'product-picker-capture'\)/,
  );
  const runner = await source('support/harness-linux-runner.mjs');
  assert.match(runner, /if \(pickerCapture\) assert.equal\(preflight, false\)/);
  assert.match(runner, /pickerCapture \? \['--product-picker-capture'\]/);
  assert.match(runner, /transferProductCapture\(/);
  assert.match(
    runner,
    /assert.equal\(productDetailsAttempted, false, 'NO_PRODUCT_TRANSFER_RETRY'\)/,
  );
  const setup = await source('support/harness-qualification-setup.mjs');
  assert.match(setup, /if \(!captureOnly\)\s*assert.equal\([\s\S]*await pending\(\)/);
  assert.match(setup, /pending: captureOnly \? undefined : pending/);
  const inner = await source('support/harness-composition-inner.mjs');
  const branch = inner.slice(
    inner.indexOf('pickerEvidence = await captureProductPicker('),
    inner.indexOf('const navigationEnd'),
  );
  assert.match(branch, /selectionProfile: null/);
  assert.match(branch, /moveDown:[\s\S]*\\x1b\[B/);
  assert.match(branch, /dismiss:[\s\S]*\\x1b/);
  assert.doesNotMatch(branch, /confirmRenderedNavigation|waitIdentity|stdin.write\('\\r'\)/);
  assert.match(inner, /brokerObserver: true, captureOnly: pickerCapture/);
  assert.match(inner, /configBytes:[\s\S]*environment: env/);
  assert.match(inner, /resolvedTheme: null,\s*designMode: null,\s*effectiveColorDepth: null/);
  assert.match(inner, /assert.equal\(api.length, 0\)/);
  assert.match(inner, /collectProductCapture\(/);
});

test('actual broker setup capture branch cannot send a pending probe or expose its callable, including failures', async () => {
  const credential = 'hop_' + 'a'.repeat(64); // Synthetic memory-only operand.
  const keyId = createHash('sha256').update(credential).digest('hex');
  let source = await readFile(
    new URL('support/harness-qualification-setup.mjs', import.meta.url),
    'utf8',
  );
  source = source
    .replace(
      /import \{ readFile, lstat, mkdir, mkdtemp, rm, access \}[^;]+;/,
      'const { readFile, lstat, mkdir, mkdtemp, rm, access } = globalThis.__captureSetupTEST;',
    )
    .replace(
      /import \{ portable, until \}[^;]+;/,
      'const { portable, until } = globalThis.__captureSetupTEST;',
    )
    .replaceAll('process.platform', "'linux'")
    .replaceAll('process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE', "'1'")
    .replaceAll('process.geteuid()', '1000');
  for (const failWork of [false, true]) {
    const requests = [];
    let removed = false,
      entered = false;
    globalThis.__captureSetupTEST = {
      mkdir: async () => {},
      mkdtemp: async (p) => p + 'memory',
      rm: async () => {
        removed = true;
      },
      access: async () => {
        throw Object.assign(Error('absent'), { code: 'ENOENT' });
      },
      readFile: async (p) =>
        p.endsWith('operator.token')
          ? credential + '\n'
          : p.endsWith('journal.log')
            ? 'safe journal'
            : 'synthetic-owner',
      lstat: async () => ({ mode: 0o600, uid: 1000, nlink: 1 }),
      portable: async (work) =>
        work({
          shared: null,
          state: '/synthetic-memory-state',
          control: 'synthetic-control',
          signal: null,
          fixture: { calls: [] },
          cli: async () => keyId,
          http: async (path, key) => {
            requests.push(path);
            assert.notEqual(path, '/v1/harness/pending');
            assert.notEqual(path, '/v1/harness/decisions');
            if (path === '/v1/status') return { status: 200, json: async () => ({ requests: [] }) };
            return key === credential
              ? { status: 202, json: async () => ({ state: 'pending', key_id: keyId }) }
              : { status: 403, json: async () => ({ error: { code: 'FORBIDDEN' } }) };
          },
        }),
    };
    try {
      const { withQualificationBroker } = await import(
        'data:text/javascript;base64,' +
          Buffer.from(source + `\n// case ${failWork}`).toString('base64')
      );
      const run = withQualificationBroker(
        async (h) => {
          entered = true;
          assert.equal(h.pending, undefined);
          if (failWork) throw Error('injected capture failure');
        },
        { brokerObserver: true, captureOnly: true },
      );
      if (failWork) await assert.rejects(run);
      else await run;
      assert.ok(entered && removed);
      assert.ok(requests.every((p) => ['/v1/status', '/v1/harness/enrollments'].includes(p)));
    } finally {
      delete globalThis.__captureSetupTEST;
    }
  }
});
