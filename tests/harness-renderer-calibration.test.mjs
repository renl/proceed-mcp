import test from 'node:test';
import assert from 'node:assert/strict';
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
} from './support/harness-renderer-observation.mjs';
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
    [{ ...after, [label]: { ...normal, fg: 'other' } }, 'STYLE_SWAP'],
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
