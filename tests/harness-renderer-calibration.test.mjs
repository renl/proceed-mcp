import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compositionCurrentFrame } from './support/harness-composition-readiness.mjs';
import {
  rendererScan,
  rendererSurfaces,
  assertRendererExport,
  emittedLabels,
  rendererPayload,
  safeRendererDiagnostic,
  rendererStep,
  rendererCheckpoint,
  rendererCursor,
  rendererCaptureCheck,
  assertRendererCursor,
  assertRendererStyles,
  rendererStyleFacts,
  rendererSize,
  rendererDiagnostics,
  rendererCells,
  rendererDiagnosticSequence,
  rendererDiagnosticAnalysis,
} from './support/harness-renderer-observation.mjs';
const alpha = '1 SYNTHETIC ALPHA',
  beta = '2 SYNTHETIC BETA';
const begin = '\x1b[?2026h',
  end = '\x1b[?2026l';
// SYNTHETIC operands, not an actual-host theme or emitted-color profile.
const selected = '\x1b[0;1;38;2;10;10;10;48;2;250;178;131m';
const current = '\x1b[0;38;2;250;178;131m';
const ordinary = '\x1b[0;38;2;238;238;238m';
const paint = (row, style, label) => `\x1b[${row};3H${style}${label}`;
const initialCells = begin + paint(3, selected, alpha) + paint(4, ordinary, beta) + end;
const movedCells = begin + paint(3, current, alpha) + paint(4, selected, beta) + end;
const marker = '\u25cf';

test('capture-first sequence retains callbacks despite unsupported pre/post movement rendering', async () => {
  for (const [first, second, values] of [
    ['\u754c', initialCells + movedCells, ['alpha', 'beta']],
    [initialCells, '\x1b[31munsupported', ['alpha', 'beta']],
    ['\u754c', '\u25cf\ufe0f', ['beta', 'alpha']],
    [initialCells, initialCells + movedCells, ['private', undefined]],
  ]) {
    const keys = [],
      records = [],
      budgets = [],
      result = {};
    let observed = 0;
    await rendererDiagnosticSequence(
      {
        key(name) {
          keys.push(name);
          if (name === 'ctrlG') records.push({ phase: 'opening' });
          if (name === 'observe') records.push({ phase: 'cursor', value: values[observed++] });
          if (name === 'escape') records.push({ phase: 'dismissed' });
        },
        async wait(predicate, budget) {
          budgets.push(budget);
          assert.ok(await predicate());
        },
        async events() {
          return records;
        },
        mark() {},
        async progress() {},
        raw: () => (observed === 1 ? first : second),
      },
      result,
    );
    assert.deepEqual(keys, ['ctrlG', 'observe', 'arrowDown', 'observe', 'escape']);
    assert.ok(budgets.every((b, i) => b <= 15000 && (!i || b <= budgets[i - 1])));
    assert.equal(result.ALPHA.present, true);
    assert.equal(result.BETA.present, true);
    assert.equal(rendererDiagnosticAnalysis(result, false), 'UNPROVEN');
    assert.equal(rendererDiagnosticAnalysis(result, true), 'FAIL');
    assert.ok(!JSON.stringify([result.ALPHA, result.BETA]).includes('private'));
  }
});

test('diagnostic missing response, deadline, stream overflow or key write failure stops without retry', async () => {
  for (const fault of ['first', 'second', 'deadline', 'overflow', 'write']) {
    const keys = [],
      records = [],
      result = {},
      operation = {};
    let observed = 0;
    await assert.rejects(
      rendererDiagnosticSequence(
        {
          key(name) {
            keys.push(name);
            if (fault === 'write' && name === 'observe') throw new Error('synthetic');
            if (name === 'ctrlG') records.push({ phase: 'opening' });
            if (name === 'observe') {
              observed++;
              if (!(fault === 'first' || (fault === 'second' && observed === 2)))
                records.push({ phase: 'cursor', value: 'alpha' });
            }
          },
          async wait(predicate) {
            if (fault === 'overflow') rendererCaptureCheck(operation, true, false);
            if (fault === 'deadline' || !(await predicate())) {
              operation.reason = 'DEADLINE';
              throw new Error('synthetic');
            }
          },
          events: async () => records,
          mark: (stage, reason) => rendererCheckpoint(operation, stage, reason),
          async progress() {},
          raw: () => '\u754c',
        },
        result,
      ),
    );
    assert.equal(keys.filter((k) => k === 'ctrlG').length, 1);
    assert.ok(keys.filter((k) => k === 'arrowDown').length <= 1);
    assert.ok(keys.filter((k) => k === 'observe').length <= 2);
    assert.equal(rendererDiagnosticAnalysis(result, false), 'UNPROVEN');
    if (fault === 'second') {
      assert.equal(operation.stage, 'MOVED_CURSOR_WAIT');
      assert.equal(result.ALPHA.value, 'ALPHA');
      assert.equal(result.BETA, undefined);
    }
  }
});

test('diagnostic successful synthetic style analysis still cannot qualify a profile', () => {
  assert.equal(
    rendererDiagnosticAnalysis(
      {
        initialRaw: initialCells,
        movedRaw: initialCells + movedCells,
        ALPHA: { present: true, value: 'ALPHA' },
        BETA: { present: true, value: 'BETA' },
      },
      true,
    ),
    'UNPROVEN',
  );
});

test('diagnostic capture admission is separate from analysis and refuses incomplete controls', () => {
  const value = {
    status: 'PASS',
    failure: 'NONE',
    phase: 'dismissed',
    scanReason: 'NONE',
    bytes: 10,
    frames: 0,
    counts: { ctrlG: 1, arrowDown: 1, observe: 2, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: 'UNKNOWN' },
    cleanup: true,
    hostExit: true,
    diagnostic: {
      capture: 'DIAGNOSTIC_CAPTURE_PASS',
      analysis: 'FAIL',
      profile: 'UNPROVEN',
      ALPHA: { present: true, value: 'BETA' },
      BETA: { present: true, value: 'OTHER' },
    },
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  for (const patch of [
    { hostExit: false },
    { cleanup: false },
    { scanReason: 'SCAN_REFUSED' },
    { counts: { ...value.counts, observe: 1 } },
    { diagnostic: { ...value.diagnostic, profile: 'PASS' } },
    { diagnostic: { ...value.diagnostic, analysis: 'PASS' } },
    { diagnostic: { ...value.diagnostic, BETA: { present: false, value: 'NONE' } } },
    { diagnostic: { ...value.diagnostic, ALPHA: { present: true, value: 'private' } } },
  ])
    assert.throws(() => safeRendererDiagnostic({ ...value, ...patch }));
});

test('maintained diagnostic wiring keeps qualification, scan/export and lifecycle boundaries', async () => {
  const inner = await readFile(
    new URL('./support/harness-renderer-inner.mjs', import.meta.url),
    'utf8',
  );
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const entry = await readFile(new URL('./run-harness-host.mjs', import.meta.url), 'utf8');
  assert.match(entry, /--renderer-diagnostic-preflight/);
  assert.match(entry, /--renderer-diagnostic-run/);
  assert.match(runner, /preflight && rendererDiagnostic[\s\S]*command\(\['--version'\]\)/);
  assert.match(runner, /rendererDiagnostic \? \['--diagnostic-capture'\] : \[\]/);
  assert.ok(
    inner.indexOf('rendererDiagnosticAnalysis(diagnosticSamples, true)') >
      inner.indexOf("'EXPORT_SCAN'"),
  );
  assert.match(
    inner,
    /if \(diagnosticMode\) \{[\s\S]*rendererDiagnosticSequence\([\s\S]*\} else \{[\s\S]*assertRendererStyles\(before, after, operation\)/,
  );
  assert.match(inner, /if \(!diagnosticMode\)/);
  assert.match(inner, /hostExit = exited && closed && !!hostPid/);
  assert.ok(
    runner.indexOf(
      'assertRendererExport(',
      runner.indexOf('if (renderer) {', runner.indexOf("await progress('evidence'")),
    ) < runner.indexOf("'binding.json'"),
  );
});
// Source-buffer model only. The marker remains on current A after selection moves.
const decorated = (a, b, absolute = false) =>
  begin +
  `\x1b[3;1H${a}${marker} ${absolute ? '\x1b[3;3H' : ''}${alpha}` +
  `\x1b[4;1H${b}  ${beta}` +
  end;

test('bare current marker has a separate source-cell region, never selection authority', () => {
  for (const absolute of [false, true]) {
    const raw = decorated(selected, ordinary, absolute);
    const before = rendererCells(raw);
    const after = rendererCells(raw + decorated(current, selected, absolute), before);
    assertRendererStyles(before.labels, after.labels, {});
    assertRendererCursor({}, rendererCursor({ value: 'beta' }), 'BETA', true);
    assert.deepEqual(before.markers, { [alpha]: { row: 2, col: 0 } });
    assert.deepEqual(after.markers, before.markers);
    assert.equal(before.cellModel, 'OPENTUI_0_8_0_BARE_25CF_SOURCE_LAYOUT_NOT_TERMINAL_WIDTH');
    assert.equal(after.profileInstalled, false);
    assert.deepEqual(after.positions, { [alpha]: { row: 2, col: 2 }, [beta]: { row: 3, col: 2 } });
    // The marker stays on A, so it cannot satisfy B's style or cursor evidence.
    assert.throws(() => assertRendererStyles(before.labels, before.labels, {}));
    assert.throws(() => assertRendererCursor({}, rendererCursor({ value: 'alpha' }), 'BETA', true));
  }
});

test('decorated title cells survive fragmented style/cursor repaint, not mixed profiles', () => {
  const raw = decorated(selected, ordinary);
  const before = rendererCells(raw);
  const repaint =
    begin +
    '\x1b[2 q' +
    [...alpha].map((ch, i) => `\x1b[3;${i + 3}H${current}${ch}`).join('') +
    [...beta].map((ch, i) => `\x1b[4;${i + 3}H${selected}${ch}`).join('') +
    end;
  assertRendererStyles(before.labels, rendererCells(raw + repaint, before).labels, {});
  assert.throws(() => rendererCells(raw + begin + '\x1b[3;3H' + current + '1' + end, before));
  // Marker styling is not title styling. Only the ASCII span supplies attributes.
  const splitRun = raw.replace(`${selected}${marker} `, `${current}${marker} ${selected}`);
  assert.deepEqual(rendererCells(splitRun).labels, before.labels);
  assert.equal(compositionCurrentFrame(raw, { styled: true }), '', 'no composition opt-in');
});

test('marker variants, unknown width, unsupported controls and forged associations refuse', () => {
  const raw = decorated(selected, ordinary);
  for (const invalid of [
    raw.replace(marker, marker + '\ufe0f'),
    raw.replace(marker, marker + '\ufe0e'),
    raw.replace(marker, marker + '\u200d'),
    raw.replace(marker, '\u25cb'),
    raw.replace(marker, '\u754c'),
    raw.replace(alpha, alpha + '\u0301'),
    raw.replace(alpha, '\u754c' + alpha),
    raw.replace(marker, '\x1b]66;w=1;' + marker + '\x1b\\'),
    raw.replace(marker, marker + '\x1b[2C'),
    raw.replace(marker, marker + marker),
    raw.replace('  ' + beta, marker + ' ' + beta),
    raw.replace(alpha, alpha + ' ' + marker),
    raw.replace(alpha, 'prefix ' + alpha),
    raw.replace(alpha, alpha + alpha),
    raw.replace('\x1b[4;1H', '\x1b[5;1H'),
    raw.replace('  ' + beta, '   ' + beta),
    raw + begin + '\x1b[1;1H' + marker + end,
    raw + begin + '\x1b[3;120H' + marker + ' ' + end,
  ])
    assert.throws(() => rendererCells(invalid));
  const before = rendererCells(raw);
  assert.throws(
    () => rendererCells(raw + begin + '\x1b[3;1H  ' + end + movedCells, before),
    'missing marker after repaint',
  );
});

test('unknown earlier decoration cannot be ignored or revive historic labels after reset', () => {
  const raw = decorated(selected, ordinary);
  const earlier = begin + '\x1b[1;1H\u754c' + end;
  // Conservative refusal, even with a later CUP/reset. No guessed width recovery.
  for (const reset of ['', '\x1b[2J', '\x1b[3J', '\x1b[?1049h'])
    assert.throws(() => rendererCells(earlier + reset + raw));
  for (const reset of ['\x1b[2J', '\x1b[3J', '\x1b[?1049h']) {
    assert.throws(() => rendererCells(raw + reset));
    assert.throws(() => rendererCells(raw + reset + begin + '\x1b[1;1Hnew' + end));
    assert.deepEqual(rendererCells(raw + reset + raw).positions, rendererCells(raw).positions);
    assert.throws(() => rendererCells(raw + reset + raw, rendererCells(raw)));
  }
});

test('finite fixture keeps current ALPHA, observes live selection through Ctrl+Y and sends physical Down', async () => {
  const fixture = await readFile(
    new URL('./fixtures/harness-renderer/tui.ts', import.meta.url),
    'utf8',
  );
  const inner = await readFile(
    new URL('./support/harness-renderer-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.match(fixture, /current: 'alpha'/);
  assert.match(
    fixture,
    /bind: 'ctrl\+y',[\s\S]*onTrigger: \(value\) => record\(\{ phase: 'cursor', value \}\)/,
  );
  assert.ok(inner.includes("key('arrowDown', '\\x1b[B')"));
  assert.ok(rendererPayload.includes('tests/support/harness-composition-readiness.mjs'));
  const projector = await readFile(
    new URL('./support/harness-composition-readiness.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(projector, /^import /m, 'staged projector has no unstaged dependencies');
});

test('completed current cells bind unique finite rows, positions, transcript and independent roles', () => {
  const before = rendererCells(initialCells);
  const after = rendererCells(initialCells + movedCells, before);
  assertRendererCursor({}, rendererCursor({ value: 'alpha' }), 'ALPHA');
  assertRendererCursor({}, rendererCursor({ value: 'beta' }), 'BETA', true);
  assertRendererStyles(before.labels, after.labels, {});
  assert.notEqual(before.labels[beta].fg, after.labels[alpha].fg);
  assert.deepEqual(after.positions, { [alpha]: { row: 2, col: 2 }, [beta]: { row: 3, col: 2 } });
  assert.equal(after.frames, 2);
  assert.equal(after.byteEnd, Buffer.byteLength(initialCells + movedCells));
  assert.equal(after.profileInstalled, false);
});

test('fragmented cursor/SGR repaint and split labels need no fresh whole literal emission', () => {
  const before = rendererCells(initialCells);
  const fragments =
    begin +
    [...alpha].map((ch, i) => paint(3, current, ch).replace('[3;3H', `[3;${i + 3}H`)).join('') +
    [...beta].map((ch, i) => paint(4, selected, ch).replace('[4;3H', `[4;${i + 3}H`)).join('') +
    end;
  assert.equal(fragments.includes('SYNTHETIC'), false);
  const after = rendererCells(initialCells + fragments, before);
  assertRendererStyles(before.labels, after.labels, {});
  const split = initialCells.replace('SYNTHETIC', 'SYN\x1b[1mTHETIC');
  assert.deepEqual(rendererCells(split).labels, before.labels);
  // An incomplete transport fragment is refused until the same bytes complete.
  for (const cut of [begin.length + 2, initialCells.length - 1])
    assert.throws(() => rendererCells(initialCells.slice(0, cut)));
});

test('stale emissions, missing/duplicate/misplaced rows and unsupported updates fail closed', () => {
  const before = rendererCells(initialCells);
  const invalid = [
    initialCells, // No completed update after the pinned sample.
    initialCells + begin + selected + end, // SGR does not restyle existing cells.
    initialCells + begin + paint(8, selected, alpha) + end,
    initialCells + begin + '\x1b[3;1H\x1b[2K' + paint(8, selected, alpha) + end,
    initialCells + begin + '\x1b[4;1H\x1b[2K' + end,
    initialCells + begin + '\x1b[3;3H\x1b[31m1' + end,
    initialCells + begin + '\x1b[3;3H\u25031' + end,
    initialCells + begin + '\x1b[3;3H\x1b[2C' + end,
    initialCells + begin + paint(3, current, alpha) + end.slice(0, -1),
    initialCells + begin + '\x1b[41;1H' + end,
    initialCells + begin + '\x1b[3;120HXX' + end,
    initialCells + '\x1b[?1049h' + movedCells,
    initialCells + '\x1b[2J' + movedCells,
    initialCells + begin + begin + end + end,
    initialCells.replace('238;238;238', '237;238;238') + movedCells,
  ];
  for (const raw of invalid)
    assert.throws(() => {
      const after = rendererCells(raw, before);
      assertRendererStyles(before.labels, after.labels, {});
    });
  for (const raw of [
    begin + paint(3, selected, alpha) + end,
    begin + paint(3, selected, alpha + alpha) + paint(4, ordinary, beta) + end,
    begin + paint(3, selected, 'prefix ' + alpha) + paint(4, ordinary, beta) + end,
    begin + paint(3, selected, alpha) + paint(5, ordinary, beta) + end,
    begin +
      paint(3, selected, alpha.slice(0, 1)) +
      current +
      alpha.slice(1) +
      paint(4, ordinary, beta) +
      end,
    'x'.repeat(1048577),
  ])
    assert.throws(() => rendererCells(raw));
  assert.throws(() => rendererCells(initialCells + movedCells, before, { rows: 41, columns: 120 }));
  assert.throws(() =>
    rendererCells(initialCells + movedCells, { ...before, geometry: { rows: 41, columns: 120 } }),
  );
});
test('synthetic renderer emission preserves RGB/default/bold and never installs a profile', () => {
  const result = emittedLabels(
    '\x1b[0m\x1b[38;2;238;238;238m2 SYNTHETIC BETA\x1b[1;48;2;250;178;131;38;2;10;10;10m1 SYNTHETIC ALPHA\x1b[?2026l',
  );
  assert.equal(result.frames, 1);
  assert.deepEqual(result.labels['1 SYNTHETIC ALPHA'].bg, [250, 178, 131]);
  assert.equal(result.labels['1 SYNTHETIC ALPHA'].bold, true);
  assert.equal(result.labels['2 SYNTHETIC BETA'].bg, 'default');
  assert.equal(result.profileInstalled, false);
  assert.equal(
    emittedLabels('\x1b[31m1 SYNTHETIC ALPHA').labels['1 SYNTHETIC ALPHA'].supported,
    false,
  );
});
test('collection size, missing logs and stream overflow retain distinct closed facts', () => {
  for (const [size, total, stage] of [
    [4194305, false, 'PER_FILE_SIZE'],
    [16777217, true, 'TOTAL_SIZE'],
  ]) {
    const state = {};
    assert.throws(() => rendererSize(state, size, total));
    assert.deepEqual(state, { stage, reason: 'OVERFLOW' });
  }
  const state = {};
  assert.throws(() => rendererDiagnostics(state, []));
  assert.deepEqual(state, { stage: 'NO_DIAGNOSTICS', reason: 'INCOMPLETE' });
  rendererCheckpoint(state, 'MOVED_WAIT', 'DEADLINE');
  assert.throws(() => rendererCaptureCheck(state, true, false));
  assert.deepEqual(state, { stage: 'MOVED_WAIT', reason: 'CAPTURE' });
  assert.throws(() => rendererCaptureCheck(state, false, true));
  assert.deepEqual(state, { stage: 'MOVED_WAIT', reason: 'IO' });
});
test('native injected read/write/parse/scan/export failures retain stage without inspecting exceptions', async () => {
  const secret = 'cap_' + 'a'.repeat(64);
  const unsafe = Object.defineProperty({}, 'message', {
    get() {
      assert.fail('must not read');
    },
  });
  for (const [stage, reason, action] of [
    [
      'READ_FILE',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    [
      'WRITE_TRANSCRIPT',
      'IO',
      () => {
        throw new Error(secret);
      },
    ],
    [
      'WRITE_OBSERVATIONS',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    ['PARSE_EVENTS', 'PARSE', () => JSON.parse('invalid')],
    ['SCAN', 'REFUSED', () => rendererScan({}, ['a'.repeat(40), 'b'.repeat(40)], false, false)],
    [
      'EXPORT_DIAGNOSTICS',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    [
      'EXPORT_SCAN',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    ['HOST_EXIT', 'INCOMPLETE', () => assert.equal(false, true)],
    ['SYMLINK', 'INCOMPLETE', () => assert.equal(true, false)],
  ]) {
    const state = {};
    await assert.rejects(rendererStep(state, stage, reason, action));
    assert.deepEqual(state, { stage, reason });
    assert.ok(!JSON.stringify(state).includes(secret));
  }
});
test('missing/wrong cursor and missing/unsupported/style assertions cannot mask one another', () => {
  const state = {};
  for (const event of [undefined, { value: 'alpha' }, { value: 'secret' }]) {
    const cursor = rendererCursor(event);
    assert.throws(() => assertRendererCursor(state, cursor, 'BETA', true));
    assert.deepEqual(state, { stage: 'MOVED_CURSOR_VALUE', reason: 'ASSERT' });
    assert.ok(!JSON.stringify(cursor).includes('secret'));
  }
  const label = '1 SYNTHETIC ALPHA',
    other = '2 SYNTHETIC BETA';
  const active = { supported: true, fg: 'dark', bg: 'orange', bold: true };
  const normal = { supported: true, fg: 'light', bg: 'default', bold: false };
  const before = { [label]: active, [other]: normal };
  const after = { [label]: normal, [other]: active };
  assertRendererStyles(before, after, state);
  for (const [changed, expected] of [
    [{ [label]: normal }, 'LABEL_SET'],
    [{ ...after, [label]: { ...normal, supported: false } }, 'STYLE_SUPPORTED'],
    [before, 'STYLE_BACKGROUND'],
    [{ ...after, [label]: { ...normal, bold: true } }, 'STYLE_BOLD'],
    [{ ...after, [other]: { ...active, fg: 'other' } }, 'STYLE_SWAP'],
  ]) {
    assert.throws(
      () => assertRendererStyles(before, changed, state),
      (error) => error.code === 'ERR_ASSERTION',
    );
    assert.deepEqual(state, { stage: expected, reason: 'ASSERT' });
  }
});
test('extended diagnostic schema rejects unsafe values, accessors, exception objects and unknown keys', () => {
  const value = {
    status: 'FAIL',
    failure: 'CONTROL_OR_IO',
    phase: 'moved',
    scanReason: 'COLLECTION_OR_INCOMPLETE',
    bytes: 0,
    frames: 0,
    counts: { ctrlG: 1, arrowDown: 1, observe: 2, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: 'UNKNOWN' },
    cleanup: true,
    hostExit: true,
    operation: { stage: 'LABEL_SET', reason: 'ASSERT' },
    collection: { stage: 'PER_FILE_SIZE', reason: 'OVERFLOW' },
    cursor: { present: false, value: 'NONE' },
    styles: rendererStyleFacts(),
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  let accessed = false;
  const accessor = Object.defineProperty({ ...value }, 'phase', {
    enumerable: true,
    get() {
      accessed = true;
      return 'moved';
    },
  });
  for (const unsafe of [
    accessor,
    { ...value, operation: new Error('private') },
    { ...value, cursor: { present: true, value: 'private' } },
    { ...value, collection: { stage: 'READ_FILE', reason: 'private' } },
    { ...value, path: '/private' },
    { ...value, frames: Infinity },
    { ...value, styles: { ...value.styles, OTHER: {} } },
  ])
    assert.throws(() => safeRendererDiagnostic(unsafe));
  assert.equal(accessed, false);
  for (const extra of [
    Object.defineProperty({ ...value }, 'toJSON', { value: () => 'private' }),
    Object.assign({ ...value }, { [Symbol('private')]: 'private' }),
    { ...value, operation: { stage: 'LABEL_SET', reason: 'ASSERT', error: 'private' } },
  ])
    assert.throws(() => safeRendererDiagnostic(extra));
  const cyclic = { ...value };
  cyclic.cursor = cyclic;
  assert.throws(() => safeRendererDiagnostic(cyclic));
  const accessorEvent = Object.defineProperty({}, 'value', {
    get() {
      assert.fail('must not execute');
    },
  });
  assert.deepEqual(rendererCursor(accessorEvent), { present: true, value: 'NONE' });
});
test('lexical repaint counters do not infer a missing literal label or current cell style', () => {
  const diff = emittedLabels('\x1b[1m\x1b[?2026l');
  assert.equal(diff.sgrTokens, 1);
  assert.equal(diff.frames, 1);
  assert.deepEqual(diff.literalEmissions, { ALPHA: 0, BETA: 0 });
  assert.deepEqual(diff.labels, {});
  assert.deepEqual(emittedLabels('1 SYNTHETIC ALPHA1 SYNTHETIC ALPHA').literalEmissions, {
    ALPHA: 2,
    BETA: 0,
  });
});
test('ungated renderer diagnostics allow only fixed reasons, counts and normalized identity', () => {
  const value = {
    status: 'FAIL',
    failure: 'PHASE_DEADLINE',
    phase: 'initial',
    scanReason: 'SCAN_REFUSED',
    frames: 2,
    bytes: 300,
    counts: { ctrlG: 1, arrowDown: 0, observe: 0, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: '1.4.4' },
    cleanup: true,
    hostExit: true,
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  for (const extra of [
    { ...value, error: 'private' },
    { ...value, phase: 'raw frame' },
    { ...value, runtime: { host: '2.2.5', bun: 'secret' } },
    { ...value, counts: { ...value.counts, session: 'secret' } },
  ])
    assert.throws(() => safeRendererDiagnostic(extra));
});
test('renderer full-scope privacy controls refuse each missing or leaking surface', () => {
  const canaries = ['a'.repeat(40), 'b'.repeat(40)];
  const clean = () =>
    Object.fromEntries(rendererSurfaces.map((s) => [s, Buffer.from('synthetic')]));
  assertRendererExport(rendererScan(clean(), canaries, true, false));
  for (const surface of rendererSurfaces) {
    const missing = clean();
    delete missing[surface];
    assert.throws(() => rendererScan(missing, canaries, true, false));
    for (const secret of [
      ...canaries,
      'cap_' + 'a'.repeat(64),
      'sk-' + 'x'.repeat(32),
      'ghp_' + 'x'.repeat(32),
      'Bearer ' + 'x'.repeat(32),
      '-----BEGIN SYNTHETIC PRIVATE KEY-----',
    ]) {
      const leak = clean();
      leak[surface] = Buffer.from(secret);
      assert.throws(() => rendererScan(leak, canaries, true, false));
    }
  }
  assert.throws(() => rendererScan(clean(), canaries, false, false));
  assert.throws(() => rendererScan(clean(), canaries, true, true));
  assert.throws(() => assertRendererExport({ status: 'PASS', scope: 'product' }));
  assert.ok(rendererPayload.every((p) => p.startsWith('tests/')));
  assert.ok(!rendererPayload.some((p) => p.startsWith('src/')));
});
