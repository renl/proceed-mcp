import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    const leak = clean();
    leak[surface] = Buffer.from(canaries[0]);
    assert.throws(() => rendererScan(leak, canaries, true, false));
    leak[surface] = Buffer.from('cap_' + 'a'.repeat(64));
    assert.throws(() => rendererScan(leak, canaries, true, false));
  }
  assert.throws(() => rendererScan(clean(), canaries, false, false));
  assert.throws(() => rendererScan(clean(), canaries, true, true));
  assert.throws(() => assertRendererExport({ status: 'PASS', scope: 'product' }));
  assert.ok(rendererPayload.every((p) => p.startsWith('tests/')));
  assert.ok(!rendererPayload.some((p) => p.startsWith('src/')));
});
