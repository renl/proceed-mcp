// TEST ONLY. Scripted frames prove observer refusal, not actual host rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import {
  assertIdentityMessage,
  highlightedOrdinal,
  assertCurrentIdentityFrame,
  confirmRenderedNavigation,
  productPickerObservation,
  productPickerInterval,
  captureProductPicker,
  productPickerDismissal,
  issueProductPickerExit,
  assertProductPickerDeadline,
  readProductPickerClock,
} from './support/harness-navigation-observation.mjs';
import {
  compositionCurrentFrame,
  compositionSourceFrame,
} from './support/harness-composition-readiness.mjs';

// Synthetic RGB operands, NOT evidence of the pinned host's actual theme.
const profile = {
  renderer: 'normal',
  selected: { fg: '10,20,30', bg: '40,50,60', bold: true },
  normal: { fg: '70,80,90', bg: '1,2,3', bold: false },
};
const sgr = (s) =>
  `\x1b[0;38;2;${s.fg.replaceAll(',', ';')};48;2;${s.bg.replaceAll(',', ';')}${s.bold ? ';1' : ''}m`;
const ansiPicker = (selected = 2) =>
  '\x1b[?2026h\x1b[2J\x1b[H' +
  'Select the Proceed session\r\n' +
  [1, 2]
    .map(
      (n) =>
        sgr(profile[n === selected ? 'selected' : 'normal']) + `    Session ${n} equal preview`,
    )
    .join('\r\n') +
  '\x1b[0m\x1b[?2026l';
const styledPicker = (n = 2) => compositionCurrentFrame(ansiPicker(n), { styled: true });

const session = {
  ordinal: 'Session 2',
  title: 'EqualLongTitle'.repeat(5),
  id: 'ses_' + 'a'.repeat(60),
};
const wrap = (s) => s.match(/.{1,40}/g).join('\n');
const message = (s = session) =>
  [
    s.ordinal,
    'Navigation only - no decision',
    'Title:',
    wrap(s.title),
    '',
    'Exact session ID:',
    wrap(s.id),
  ].join('\n');
const geometry = { width: 100, height: 50, resizeSequence: 0 };
const frame = (s = session) =>
  ['Open Proceed question?', message(s), '', 'Open question   Cancel'].join('\n');
const picker = styledPicker().text;

// Indexed operands from the admitted fixture, not a product theme/profile.
const fixtureStyles = {
  selected: { fg: 'index:232', bg: 'index:216', bold: true },
  inactive: {
    current: { fg: 'index:216', bg: 'index:233', bold: false },
    ordinary: { fg: 'index:255', bg: 'index:233', bold: false },
  },
};
const indexSgr = (s) => `\x1b[0;38;5;${s.fg.slice(6)};48;5;${s.bg.slice(6)}${s.bold ? ';1' : ''}m`;
function fixtureCase({
  selected = 0,
  current = 0,
  labels = ['Session 1', 'Session 2'],
  styles = fixtureStyles,
} = {}) {
  const raw =
    '\x1b[?1049h\x1b[?2026h\x1b[HSelect the Proceed session' +
    labels
      .map(
        (label, n) =>
          `\x1b[${n + 3};3H` +
          (n === current ? '\u25cf ' : '  ') +
          indexSgr(
            n === selected
              ? styles.selected
              : styles.inactive[n === current ? 'current' : 'ordinary'],
          ) +
          label,
      )
      .join('') +
    '\x1b[?2026l';
  return boundFixture(raw, labels, styles);
}
function boundFixture(raw, labels, styles = fixtureStyles) {
  const binding = {
    host: 'synthetic-host-not-qualified',
    theme: 'synthetic-indexed-not-qualified',
    geometry: { rows: 40, columns: 120 },
    generation: 1,
    transcriptHash: createHash('sha256').update(raw).digest('hex'),
    bytes: Buffer.byteLength(raw),
    frames: 1,
  };
  return {
    raw,
    labels,
    binding,
    profile: {
      renderer: 'normal',
      scope: 'fixture-only',
      ...structuredClone(styles),
      binding: structuredClone(binding),
    },
  };
}
const fixtureSelection = (c) =>
  highlightedOrdinal(c.raw, c.profile, {
    offlineFixture: { labels: c.labels, binding: c.binding },
  });

const productBinding = {
  scope: 'product-capture',
  run: 'synthetic-run',
  setup: 'synthetic-setup',
  executable: 'synthetic-binary-hash',
  config: 'synthetic-config-hash',
  geometry: { width: 120, height: 40, resizeSequence: 0 },
  designMode: null,
  resolvedTheme: null,
  effectiveColorDepth: null,
};
const productSnapshot = [1, 2].map((n) => ({
  id: `synthetic-id-${n}`,
  ordinal: `Session ${n}`,
  title: 'duplicate preview',
}));
const productUpdate = (selected, reset = false) =>
  '\x1b[?2026h' +
  (reset ? '\x1b[2J' : '') +
  '\x1b[HSelect the Proceed session' +
  [1, 2]
    .map(
      (n) =>
        `\x1b[${n + 2};3H` +
        indexSgr(n === selected ? fixtureStyles.selected : fixtureStyles.inactive.ordinary) +
        `Session ${n} - duplicate preview`,
    )
    .join('') +
  '\x1b[?2026l';
const productRaw = () => Buffer.from('\x1b[?1049h' + productUpdate(1));
function productPair() {
  const raw = productRaw();
  const initial = productPickerObservation(raw, productBinding, productSnapshot);
  const moved = productPickerObservation(
    Buffer.concat([raw, Buffer.from(productUpdate(2))]),
    productBinding,
    productSnapshot,
    initial,
  );
  return { initial, moved };
}

test('actual product capture adapter maps zero-marker duplicate previews by immutable ordinal, never qualifies unknown semantics', () => {
  const { initial, moved } = productPair();
  assert.equal(initial.supported, true);
  assert.equal(moved.supported, true);
  assert.deepEqual(
    initial.rows.map((r) => r.id),
    productSnapshot.map((s) => s.id),
  );
  assert.equal(initial.rows[0].style.bold, true); // Source initial index zero.
  assert.deepEqual(productPickerInterval(initial, moved), {
    qualification: 'UNQUALIFIED',
    reason: 'MISSING_SEMANTIC_BINDING',
    emittedTransfer: true,
    selectionProfile: null,
  });
  for (const mutate of [
    (s) => (s.binding.executable = 'wrong-host'),
    (s) => (s.binding.config = 'changed-config'),
    (s) => (s.binding.setup = 'replaced-setup'),
    (s) => s.binding.geometry.resizeSequence++,
    (s) => (s.binding.designMode = 'changed'),
    (s) => (s.binding.resolvedTheme = 'changed'),
    (s) => (s.binding.effectiveColorDepth = 24),
    (s) => s.snapshot.reverse(),
    (s) => (s.rows[1].id = 'changed-identity'),
    (s) => (s.rows[1].style = s.rows[0].style),
    (s) => s.screen++,
    (s) => (s.frames = initial.frames),
    (s) => (s.previousSha256 = 'historical'),
  ]) {
    const candidate = structuredClone(moved);
    mutate(candidate);
    assert.equal(productPickerInterval(initial, candidate).emittedTransfer, false);
    assert.equal(productPickerInterval(initial, candidate).qualification, 'UNQUALIFIED');
  }
});

test('product adapter refuses fixture/historical binding, replaced prefix, incomplete cells and unsupported controls without fallback', () => {
  const raw = productRaw(),
    { initial } = productPair();
  for (const altered of [
    Buffer.from(raw.toString().replace('Session 2 -', 'Session 1 -')),
    Buffer.from(raw.toString().replace('duplicate preview', 'changed preview')),
    Buffer.from(raw.toString().replace('Session 1', '\u25cf Session 1')),
    Buffer.concat([raw, Buffer.from('\x1b[?2026h')]),
    Buffer.concat([raw, Buffer.from('\x1b[3m')]),
    Buffer.from(raw.toString().replace('Select the Proceed session', 'Open Proceed question?')),
  ])
    assert.equal(
      productPickerObservation(altered, productBinding, productSnapshot).supported,
      false,
    );
  for (const binding of [
    { ...productBinding, scope: 'fixture-only' },
    { ...productBinding, geometry: { width: 80, height: 24, resizeSequence: 1 } },
  ])
    assert.equal(productPickerObservation(raw, binding, productSnapshot).supported, false);
  assert.equal(
    productPickerObservation(
      Buffer.concat([Buffer.from('replaced'), raw]),
      productBinding,
      productSnapshot,
      initial,
    ).supported,
    false,
  );
});

const dismissedRaw = () =>
  Buffer.concat([
    productRaw(),
    Buffer.from(productUpdate(2)),
    Buffer.from(
      '\x1b[?2026h' +
        [1, 2, 3, 4, 5].map((r) => `\x1b[${r};1H` + ' '.repeat(120)).join('') +
        '\x1b[H2.2.5 Ask anything\x1b[?2026l',
    ),
  ]);

test('fresh completed dismissal admits exactly one owned exit, all stale or ambiguous controls refuse', () => {
  const { moved } = productPair();
  const raw = dismissedRaw();
  let exits = 0;
  const route = (candidate = raw, binding = productBinding) =>
    issueProductPickerExit({
      snapshot: () => ({
        raw: candidate,
        binding,
        previous: moved,
        hostFrame: '2.2.5 Ask anything',
        now: () => 4,
        deadline: 5,
      }),
      exitCount: () => exits,
      exit: () => exits++,
    });
  assert.equal(route().supported, true);
  assert.equal(exits, 1);
  assert.throws(() => route());
  assert.equal(exits, 1);
  for (const candidate of [
    productRaw(),
    Buffer.concat([productRaw(), Buffer.from(productUpdate(2))]),
    Buffer.concat([raw, Buffer.from('\x1b[?2026h')]),
    Buffer.concat([raw, Buffer.from('\x1b[')]),
    Buffer.concat([raw, Buffer.from('\x1b[?1049l')]),
    Buffer.concat([raw, Buffer.from('\x1b[2J')]),
    Buffer.concat([raw, Buffer.from('\x1b[3m')]),
    Buffer.from(raw.toString().replace('2.2.5 Ask anything', 'unknown host frame')),
    Buffer.from(raw.toString().replace('2.2.5 Ask anything', '2.2.5 Ask anything UNKNOWN DIALOG')),
    Buffer.from(raw.toString().replace('duplicate preview', 'replaced preview')),
    Buffer.concat([raw, Buffer.from(productUpdate(1))]),
  ]) {
    exits = 0;
    assert.equal(
      productPickerDismissal(candidate, productBinding, moved, '2.2.5 Ask anything').supported,
      false,
    );
    assert.throws(() => route(candidate));
    assert.equal(exits, 0);
  }
  for (const change of [
    { setup: 'replacement' },
    { run: 'replacement' },
    { geometry: { width: 120, height: 40, resizeSequence: 1 } },
    { geometry: { width: 80, height: 24, resizeSequence: 0 } },
  ]) {
    exits = 0;
    assert.throws(() => route(raw, { ...productBinding, ...change }));
    assert.equal(exits, 0);
  }
});

test('actual composition final-exit closure refuses live replacement, deadline and geometry drift', async () => {
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('productExitSnapshot = () => {');
  const finish = source.indexOf('\n          };', start);
  assert.ok(start > 0 && finish > start);
  const closure = source.slice(start + 'productExitSnapshot = '.length, finish) + '\n}';
  const exitStart = source.indexOf('const ownedExit = () => {');
  const exitFinish = source.indexOf('\n        };', exitStart);
  assert.ok(exitStart > finish && exitFinish > exitStart);
  const exitClosure = source.slice(exitStart + 'const ownedExit = '.length, exitFinish) + '\n}';
  const { moved } = productPair();
  const unsafe = [
    ['infinity', Infinity],
    ['negative-infinity', -Infinity],
    ['nan', NaN],
    ['string', '4'],
    [
      'object',
      {
        valueOf() {
          throw Error('coercion must not run');
        },
      },
    ],
    ['null', null],
    ['undefined', undefined],
  ];
  const cases = [
    ...[
      'none',
      'deadline',
      'validation-before',
      'validation-exact',
      'validation-late',
      'exit',
      'overflow',
      'run',
      'setup',
      'resize',
      'snapshot',
      'partial',
    ].map((mutation) => ({ mutation })),
    { mutation: 'fractional', deadline: 5.125, initial: 4.25, final: 5.124 },
    ...['initial', 'final', 'deadline'].flatMap((stage) =>
      unsafe.map(([name, value]) => ({
        mutation: `${stage}-${name}`,
        stage,
        value: stage === 'deadline' && name === 'string' ? '50' : value,
      })),
    ),
    ...['initial', 'final'].flatMap((stage) =>
      ['throwing', 'accessor', 'missing', 'noncallable'].map((kind) => ({
        mutation: `${stage}-${kind}`,
        stage,
        kind,
      })),
    ),
  ];
  for (const scenario of cases) {
    const { mutation, stage, value, kind } = scenario;
    const live = {
      live: true,
      run: productBinding.run,
      generation: productBinding.setup,
      geometry: structuredClone(productBinding.geometry),
      snapshot: structuredClone(productSnapshot),
    };
    const keys = { exit: 0 };
    const writes = [];
    const events = [];
    let tick = mutation === 'deadline' ? 5 : (scenario.initial ?? 4);
    let clockStage = 'initial';
    let validationReads = 0;
    const previous = { ...moved };
    // This operand is read by the actual dismissal validator after snapshot
    // acquisition and hash/decode. Move the injected clock DURING validation.
    Object.defineProperty(previous, 'screen', {
      get() {
        validationReads++;
        clockStage = 'final';
        if (mutation === 'fractional') tick = scenario.final;
        if (mutation.startsWith('validation-')) {
          tick = { 'validation-before': 4.999, 'validation-exact': 5, 'validation-late': 6 }[
            mutation
          ];
        }
        return moved.screen;
      },
    });
    const context = {
      assert,
      Buffer,
      assertProductPickerDeadline,
      performance: {
        get now() {
          if (stage === clockStage) {
            if (kind === 'accessor') throw Error('private-clock-detail');
            if (kind === 'throwing')
              return () => {
                throw Error('private-clock-detail');
              };
            if (kind === 'missing') return undefined;
            if (kind === 'noncallable') return 4;
            return () => value;
          }
          return () => tick;
        },
      },
      pickerEnd: stage === 'deadline' ? value : (scenario.deadline ?? 5),
      exited: mutation === 'exit',
      overflow: mutation === 'overflow',
      readObservation: () => live,
      run: productBinding.run,
      binding: { generation: productBinding.setup },
      captureBinding: productBinding,
      snapshot: productSnapshot,
      transcript:
        mutation === 'partial'
          ? Buffer.concat([dismissedRaw(), Buffer.from('\x1b[?2026h')])
          : dismissedRaw(),
      pickerEvidence: { dismissalBaseline: previous },
      readinessFrame: '2.2.5 Ask anything',
      keys,
      cleanupTiming: { record: (event) => events.push(event) },
      child: { stdin: { write: (key) => writes.push(key) } },
    };
    if (mutation === 'run') live.run = 'replacement';
    if (mutation === 'setup') live.generation = 'replacement';
    if (mutation === 'resize') live.geometry.resizeSequence++;
    if (mutation === 'snapshot') live.snapshot.reverse();
    const snapshot = runInNewContext('(' + closure + ')', context, { timeout: 100 });
    const exit = runInNewContext('(' + exitClosure + ')', context, { timeout: 100 });
    const execute = () => issueProductPickerExit({ snapshot, exitCount: () => keys.exit, exit });
    const admitted = ['none', 'validation-before', 'fractional'].includes(mutation);
    if (admitted) {
      execute();
      assert.throws(execute); // No second key or retry, even before cutoff.
    } else if (stage)
      assert.throws(execute, (error) => {
        assert.match(error.message, /picker (deadline|clock)/);
        assert.equal(error.message.includes('private-clock-detail'), false);
        return true;
      });
    else if (mutation.startsWith('validation-')) assert.throws(execute, /deadline elapsed/);
    else assert.throws(execute);
    assert.equal(keys.exit, admitted ? 1 : 0);
    assert.deepEqual(writes, admitted ? ['\x03'] : []);
    assert.deepEqual(events, admitted ? ['EXIT_KEY'] : []);
    if (mutation.startsWith('validation-')) assert.equal(validationReads, 1);
    if (stage === 'final') assert.equal(validationReads, 1);
    if (stage === 'initial' || stage === 'deadline') assert.equal(validationReads, 0);
  }
  assert.match(source, /allowExit: !pickerCapture \|\| dismissalAdmitted/);
  assert.match(source, /pickerEvidence.dismissal = issueProductPickerExit\(/);
  const deadlineStart = source.indexOf('const pickerEnd =');
  const deadlineEnd = source.indexOf(';', deadlineStart);
  const deadlineExpression = source.slice(deadlineStart + 'const pickerEnd ='.length, deadlineEnd);
  assert.match(deadlineExpression, /readProductPickerClock\(\(\) => performance.now\(\)\)/);
  assert.match(deadlineExpression, /Math.min\(5000,/);
  for (const [name, tick] of [...unsafe, ['fractional', 4.25]]) {
    const evaluate = () =>
      runInNewContext(
        deadlineExpression,
        {
          readProductPickerClock,
          performance: { now: () => tick },
          end: 10000,
          Date: { now: () => 6000 },
        },
        { timeout: 100 },
      );
    if (name === 'fractional') assert.equal(evaluate(), 4004.25);
    else assert.throws(evaluate, /picker clock invalid/);
  }
});

test('capture-only actual dispatch has no Enter, identity or decision capability and requires dismissal before returning', async () => {
  for (const fail of ['none', 'observe', 'move', 'moved', 'unsupported', 'dismissal']) {
    const events = [],
      pair = productPair();
    let observations = 0;
    const run = captureProductPicker({
      selectionProfile: null,
      observe: async () => {
        events.push('observe');
        if (fail === 'observe' || (fail === 'moved' && observations))
          throw Error('synthetic failure');
        return fail === 'unsupported'
          ? { supported: false, qualification: 'UNQUALIFIED' }
          : observations++
            ? pair.moved
            : pair.initial;
      },
      moveDown: async () => {
        events.push('down');
        if (fail === 'move') throw Error('synthetic failure');
      },
      dismiss: async () => {
        events.push('escape');
        return pair.moved;
      },
      observeDismissal: async (previous) => {
        events.push('dismissal');
        if (fail === 'dismissal') return { supported: false };
        return productPickerDismissal(
          dismissedRaw(),
          productBinding,
          previous,
          '2.2.5 Ask anything',
        );
      },
      // Poison unused operations: the route must never call any of these.
      stdin: { write: () => assert.fail('generic key forbidden') },
      acceptIdentity: () => assert.fail('identity forbidden'),
      exchange: () => assert.fail('pending/decision forbidden'),
      qualify: () => assert.fail('automatic qualification forbidden'),
    });
    if (['observe', 'move', 'moved', 'unsupported', 'dismissal'].includes(fail))
      await assert.rejects(run);
    else {
      const result = await run;
      assert.equal(result.enter, 0);
      assert.equal(result.selectionProfile, null);
      assert.equal(result.qualification, 'UNQUALIFIED');
    }
    if (fail === 'none') assert.equal(events.at(-1), 'dismissal');
    else if (fail === 'dismissal') assert.equal(events.filter((s) => s === 'escape').length, 1);
    else assert.ok(!events.includes('escape'));
    assert.ok(events.filter((s) => s === 'down').length <= 1);
    if (fail === 'unsupported') assert.deepEqual(events, ['observe']);
  }
});

test('indexed fixture selection follows style, not marker or label, with asymmetric inactive roles', () => {
  for (const labels of [
    ['Session 1', 'Session 2'],
    ['OTHER', 'UNRELATED'],
  ])
    for (const selected of [0, 1])
      for (const current of [0, 1])
        assert.equal(
          fixtureSelection(fixtureCase({ selected, current, labels })),
          labels[selected],
        );
  // The observer compares supplied finite identities, not pinned palette operands.
  const styles = structuredClone(fixtureStyles);
  styles.selected = { fg: 'index:0', bg: 'index:7', bold: false };
  assert.equal(fixtureSelection(fixtureCase({ selected: 1, styles })), 'Session 2');
});

test('indexed fixture profiles refuse role/style ambiguity, missing/duplicate labels and mixed/default/RGB identities', () => {
  for (const mutate of [
    (c) => {
      c.labels.push(c.labels[0]);
    },
    (c) => {
      c.labels[1] = 'absent';
    },
    (c) => {
      c.profile.inactive.current = c.profile.inactive.ordinary;
    },
    (c) => {
      c.profile.inactive.ordinary = c.profile.selected;
    },
    (c) => {
      delete c.profile.inactive.current;
    },
    (c) => {
      c.profile.selected.bg = c.profile.inactive.current.bg;
    },
    (c) => {
      c.profile.selected.fg = 'index:256';
    },
    (c) => {
      c.profile.selected.fg = 'index:0232';
    },
    (c) => {
      c.profile.selected.fg = '232,232,232';
    },
    (c) => {
      c.profile.selected.fg = null;
    },
    (c) => {
      c.profile.selected.bg = null;
    },
    (c) => {
      c.profile.selected.italic = true;
    },
    (c) => {
      c.profile.inactive.unknown = c.profile.inactive.current;
    },
  ]) {
    const c = fixtureCase({ selected: 1 });
    mutate(c);
    assert.throws(() => fixtureSelection(c));
  }
  const c = fixtureCase();
  for (const raw of [
    c.raw.replace('\u25cf ', '  '),
    c.raw.replace('Session 2', 'Session 1'),
    c.raw.replace('Session 1', 'Session 1\u25cf'),
    c.raw.replace('Session 2', '\u25cf Session 2'),
    c.raw.replace('Session 1', 'Sess\x1b[0mion 1'),
    c.raw.replace(indexSgr(fixtureStyles.inactive.ordinary), indexSgr(fixtureStyles.selected)),
    c.raw.replace(indexSgr(fixtureStyles.selected), indexSgr(fixtureStyles.inactive.current)),
    c.raw.replace('Session 1', '\x1b[3mSession 1'),
    c.raw.replace('Session 1', '\x1b[38;2;232;232;232mSession 1'),
    c.raw.replace('Select the Proceed session', 'Open Proceed question?'),
  ])
    assert.throws(() => fixtureSelection(boundFixture(raw, c.labels)));
});

test('fixture prefix/host/theme/geometry/generation bindings and incomplete/reset updates refuse', () => {
  for (const key of [
    'host',
    'theme',
    'geometry',
    'generation',
    'transcriptHash',
    'bytes',
    'frames',
  ]) {
    const c = fixtureCase();
    c.binding[key] = key === 'geometry' ? { rows: 41, columns: 120 } : 'changed';
    assert.throws(() => fixtureSelection(c));
  }
  for (const mutate of [
    (c) => {
      c.raw += '\x1b[?2026h';
    },
    (c) => {
      c.raw += '\x1b[';
    },
    (c) => {
      c.raw += '\x1b[?1049h';
    },
    (c) => {
      c.raw += '\x1b[2J';
    },
    (c) => {
      c.binding.generation = c.profile.binding.generation = 2;
    },
    (c) => {
      c.binding.frames = c.profile.binding.frames = 2;
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 41, columns: 120 };
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 24, columns: 80 };
      c.raw = c.raw.replace('[3;3H', '[30;3H');
    },
  ]) {
    const c = fixtureCase();
    mutate(c);
    // Rebinding bytes cannot make an incomplete/reset/stale generation valid.
    c.binding.bytes = c.profile.binding.bytes = Buffer.byteLength(c.raw);
    c.binding.transcriptHash = c.profile.binding.transcriptHash = createHash('sha256')
      .update(c.raw)
      .digest('hex');
    assert.throws(() => fixtureSelection(c));
  }
});

test('historical/forged indexed fixture profiles cannot authorize a live navigation Enter', async () => {
  const c = fixtureCase();
  const styledFrame = compositionSourceFrame(c.raw);
  const picked = { frame: styledFrame.text, styledFrame, token: 10, geometry };
  for (const selectionProfile of [
    c.profile,
    { ...c.profile, scope: 'live' },
    { renderer: 'normal', selected: c.profile.selected, normal: c.profile.inactive.ordinary },
    { ...profile, binding: c.binding },
    null,
  ]) {
    const writes = [];
    await assert.rejects(
      confirmRenderedNavigation(
        {
          selectionProfile,
          offlineFixture: { labels: c.labels, binding: c.binding },
          stdin: { write: (s) => writes.push(s) },
          waitHighlightedSession: async () => picked,
          currentNavigationFrame: async () => structuredClone(picked),
          waitIdentityConfirmation: async () => {
            throw Error('must not enter');
          },
        },
        session,
      ),
    );
    assert.deepEqual(writes, []);
  }
});

test('lossless labelled blocks reconstruct full title and exact ID, not prefix/includes', () => {
  assert.ok(assertIdentityMessage(message(), session) > 0);
  assert.doesNotThrow(() => assertCurrentIdentityFrame(frame(), session, geometry));
  for (const altered of [
    message().replace('Title:', 'Preview:'),
    message().replace('Exact session ID:', 'Hidden value:'),
    message().replace('ses_', 'ses_x'),
    message().replace('EqualLong', 'EqualShort'),
    message() + 'x',
    message().replace('Navigation only - no decision', 'Approve'),
    message().replace('Title:', '\x1b[31mTitle:'),
  ])
    assert.throws(() => assertIdentityMessage(altered, session));
  for (const altered of [
    frame().replace('Cancel', ''),
    frame({ ...session, id: session.id + 'x' }),
    picker + '\n' + frame(),
    'Old confirmation\n' + message(),
  ])
    assert.throws(() => assertCurrentIdentityFrame(altered, session, geometry));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 79, height: 50 }));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 80, height: 24 }));
});

test('identical plain frames retain different normal selection styles', () => {
  assert.equal(styledPicker(1).text, styledPicker(2).text);
  assert.equal(highlightedOrdinal(styledPicker(1), profile), 'Session 1');
  assert.equal(highlightedOrdinal(styledPicker(2), profile), 'Session 2');
  assert.throws(() => highlightedOrdinal(styledPicker(), null));
  assert.throws(() => highlightedOrdinal(picker, profile));
});

test('focus, bold alone, ambiguous/unknown styles and incomplete mutations refuse', () => {
  for (const edit of [
    (s) => {
      s.styles[1] = s.styles[2];
    },
    (s) => {
      s.styles[2] = s.styles[1];
    },
    (s) => {
      s.styles[2][5] = { ...profile.selected, bg: '9,9,9' };
    },
    (s) => {
      s.styles[2] = s.styles[2].map(() => ({ ...profile.normal, bold: true }));
    },
    (s) => {
      s.text += '\nOpen Proceed question?';
    },
  ]) {
    const s = structuredClone(styledPicker());
    edit(s);
    assert.throws(() => highlightedOrdinal(s, profile));
  }
  for (const suffix of [
    '\x1b[?2026h',
    '\x1b[',
    '\x1b[?2026h\x1b[2J\x1b[?2026l',
    '\x1b[?2026h\x1b[2;5H\x1b[0mSession 1\x1b[?2026l',
    '\x1b[?2026h\x1b[3m\x1b[?2026l',
    '\x1b[?2026h\x1b[1A\x1b[?2026l',
    '\x1b[?2026h\x1b[?3h\x1b[?2026l',
    '\x1b[?2026h\x1b[38;5;1m\x1b[?2026l',
    '\x1b]4;1;rgb:ff/00/00\x07',
    '\x1b[?2026h\x1b[38;2;;1;2m\x1b[?2026l',
    '\x1b[?2026h\x1b[1;301HX\x1b[?2026l',
    '\x1b[?2026h\x1b[1;1H\u0301\x1b[?2026l',
  ])
    assert.throws(() =>
      highlightedOrdinal(compositionCurrentFrame(ansiPicker() + suffix, { styled: true }), profile),
    );
  const focus = compositionCurrentFrame(
    ansiPicker() +
      '\x1b[?2026h\x1b[1;1H' +
      sgr(profile.selected) +
      'Select the Proceed session\x1b[?2026l',
    { styled: true },
  );
  assert.equal(highlightedOrdinal(focus, profile), 'Session 2');
  const repainted = compositionCurrentFrame(
    ansiPicker() + '\x1b[?2026h\x1b[3;1H\x1b[0m\x1b[2K' + '    Session 2 equal preview\x1b[?2026l',
    { styled: true },
  );
  assert.throws(() => highlightedOrdinal(repainted, profile));
});

async function control(mutate = () => {}) {
  const writes = [];
  const selected = { frame: picker, styledFrame: styledPicker(), token: 10, geometry };
  const confirmed = { frame: frame(), token: 20, geometry };
  let stage = 'picker';
  const driver = {
    selectionProfile: profile,
    stdin: { write: (key) => writes.push(key) },
    waitHighlightedSession: async () => selected,
    waitIdentityConfirmation: async () => {
      stage = 'confirmation';
      return confirmed;
    },
    currentNavigationFrame: async () => {
      const observation = structuredClone(stage === 'picker' ? selected : confirmed);
      mutate(observation, stage);
      return observation;
    },
  };
  let error;
  try {
    await confirmRenderedNavigation(driver, session);
  } catch (caught) {
    error = caught;
  }
  return { writes, error };
}

test('screen reset invalidates completed picker until a supported fresh frame, with zero Enter', async () => {
  for (const reset of ['\x1b[?1049h', '\x1b[2J', '\x1b[3J']) {
    for (const styled of [false, true])
      assert.equal(compositionCurrentFrame(ansiPicker() + reset, { styled }), '');
    const result = await control((s, stage) => {
      if (stage !== 'picker') return;
      const ansi = ansiPicker() + reset;
      s.frame = compositionCurrentFrame(ansi);
      s.styledFrame = compositionCurrentFrame(ansi, { styled: true });
    });
    assert.ok(result.error, 'reset must refuse stale picker');
    assert.deepEqual(result.writes, []);
    const fresh = compositionCurrentFrame(ansiPicker() + reset + ansiPicker(1), {
      styled: true,
    });
    assert.equal(highlightedOrdinal(fresh, profile), 'Session 1');
  }
});

test('current interaction positive requires two separate navigation Enters', async () => {
  const result = await control();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, ['\r', '\r']);
});

test('stale, ambiguous or replaced picker refuses first Enter, stale/resize/foreign confirmation refuses second', async () => {
  for (const stage of ['picker', 'confirmation'])
    for (const mutate of [
      (s) => {
        s.token++;
      },
      (s) => {
        s.frame = '';
      },
      (s) => {
        s.frame += '\n\u2503    Session 1';
      },
      (s) => {
        s.geometry.resizeSequence++;
      },
      ...(stage === 'picker'
        ? [
            (s) => {
              s.styledFrame = styledPicker(1);
            },
          ]
        : []),
      ...(stage === 'confirmation'
        ? [
            (s) => {
              s.geometry.resizeSequence++;
            },
            (s) => {
              s.frame = frame({ ...session, id: 'foreign' });
            },
          ]
        : []),
    ]) {
      const result = await control((s, current) => {
        if (current === stage) mutate(s);
      });
      assert.ok(result.error, 'invalid current observation accepted');
      assert.deepEqual(result.writes, stage === 'picker' ? [] : ['\r']);
    }
});
