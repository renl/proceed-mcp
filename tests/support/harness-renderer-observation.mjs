// TEST ONLY. Bounded current-cell evidence, NOT a host-qualified product profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { compositionCurrentFrame } from './harness-composition-readiness.mjs';

export const rendererSurfaces = Object.freeze([
  'tui',
  'diagnostics',
  'fixture',
  'inventory',
  'state',
  'evidence',
]);
export const rendererPayload = Object.freeze([
  'tests/fixtures/harness-renderer/tui.ts',
  'tests/support/harness-renderer-inner.mjs',
  'tests/support/harness-renderer-observation.mjs',
  'tests/support/harness-composition-readiness.mjs',
  'tests/support/harness-linux-plan.mjs',
  'tests/support/harness-host-plan.mjs',
]);
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const calibrationLabels = ['1 SYNTHETIC ALPHA', '2 SYNTHETIC BETA'];

// Collection has no dependency on the cell/style parser being investigated.
// The adapter sends normal UI input. It never invokes a fixture callback itself.
export async function rendererDiagnosticSequence(
  { key, wait, events, mark, progress, raw },
  result,
) {
  const deadline = Date.now() + 15000;
  const until = (predicate) => wait(predicate, Math.max(0, deadline - Date.now()));
  await progress('initial');
  key('ctrlG', '\x07');
  mark('INITIAL_WAIT', 'DEADLINE');
  await until(async () => (await events()).some((e) => e.phase === 'opening'));
  for (const [index, stage] of [
    [0, 'INITIAL_CURSOR_WAIT'],
    [1, 'MOVED_CURSOR_WAIT'],
  ]) {
    if (index) {
      await progress('moved');
      key('arrowDown', '\x1b[B');
    }
    key('observe', '\x19');
    mark(stage, 'DEADLINE');
    await until(
      async () => (await events()).filter((e) => e.phase === 'cursor').length === index + 1,
    );
    result[index ? 'BETA' : 'ALPHA'] = rendererCursor(
      (await events()).filter((e) => e.phase === 'cursor')[index],
    );
    result[index ? 'movedRaw' : 'initialRaw'] = raw();
  }
  await progress('dismissed');
  key('escape', '\x1b');
  mark('DISMISS', 'DEADLINE');
  await until(async () => (await events()).some((e) => e.phase === 'dismissed'));
}

export function rendererDiagnosticAnalysis(result, scanPassed) {
  if (!scanPassed) return 'UNPROVEN';
  // Callback contradictions are independent of decoder support.
  try {
    assertRendererCursor({}, result.ALPHA, 'ALPHA');
    assertRendererCursor({}, result.BETA, 'BETA', true);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    return 'FAIL';
  }
  let before, after;
  try {
    before = rendererCells(result.initialRaw);
    after = rendererCells(result.movedRaw, before);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    // A refused/incomplete cell model establishes no style contradiction.
    return 'UNPROVEN';
  }
  try {
    assertRendererStyles(before.labels, after.labels, {});
    // Diagnostic collection can never qualify or install a selection profile.
    return 'UNPROVEN';
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    return 'FAIL';
  }
}

// Reparse ASCII title spans plus the explicitly pinned bare-current-marker model.
// No lexical emission (including a new copy elsewhere) can replace current cells.
export function rendererCells(raw, previous, geometry = { rows: 40, columns: 120 }) {
  assert.equal(typeof raw, 'string');
  assert.ok(Buffer.byteLength(raw) <= 1048576, 'CAPTURE_LIMIT');
  assert.deepEqual(geometry, { rows: 40, columns: 120 }, 'RESIZED');
  const close = '\x1b[?2026l';
  const frameEnd = raw.lastIndexOf(close) + close.length;
  assert.ok(frameEnd >= close.length, 'NO_COMPLETED_UPDATE');
  let syncing = false,
    frames = 0;
  for (const token of raw.match(/\x1b\[\?2026[hl]/g) ?? []) {
    if (token.endsWith('h')) {
      assert.equal(syncing, false, 'NESTED_UPDATE');
      syncing = true;
    } else {
      assert.equal(syncing, true, 'UNMATCHED_UPDATE');
      syncing = false;
      frames++;
    }
  }
  assert.equal(syncing, false, 'INCOMPLETE_UPDATE');
  for (const match of raw.matchAll(/\x1b\[(\d*);?(\d*)[Hf]/g)) {
    assert.ok(+(match[1] || 1) >= 1 && +(match[1] || 1) <= geometry.rows);
    assert.ok(+(match[2] || 1) >= 1 && +(match[2] || 1) <= geometry.columns);
  }
  if (previous) {
    assert.deepEqual(previous.geometry, geometry, 'RESIZED');
    assert.equal(
      digest(raw.slice(0, previous.offset)),
      previous.transcriptHash,
      'TRANSCRIPT_REPLACED',
    );
    assert.ok(frameEnd > previous.offset && frames > previous.frames, 'STALE_UPDATE');
    assert.doesNotMatch(
      raw.slice(previous.offset),
      /\x1b\[(?:[23]J|\?1049[hl])/,
      'GENERATION_RESET',
    );
  }
  const frame = compositionCurrentFrame(raw, { styled: true, sourceMarkerCells: true });
  assert.ok(frame && typeof frame.text === 'string', 'UNSUPPORTED_OR_INCOMPLETE');
  const rows = frame.text.split('\n');
  assert.ok(
    rows.length <= geometry.rows && rows.every((r) => r.length <= geometry.columns),
    'FRAME_OVERFLOW',
  );
  const labels = {},
    positions = {},
    markers = {};
  for (const label of calibrationLabels) {
    const occurrences = [];
    rows.forEach((line, row) => {
      for (let col = line.indexOf(label); col >= 0; col = line.indexOf(label, col + 1))
        occurrences.push({ row, col });
    });
    assert.equal(occurrences.length, 1, 'MISSING_OR_DUPLICATE_LABEL');
    const position = occurrences[0];
    const prefix = rows[position.row].slice(0, position.col);
    const suffix = rows[position.row].slice(position.col + label.length);
    // Only current ALPHA may carry one bare marker before its exact ASCII title.
    // Whitespace is geometry, not part of the title or its selection style.
    assert.match(suffix, /^ *$/, 'MISPLACED_LABEL');
    if (prefix.includes('\u25cf')) {
      assert.equal(label, calibrationLabels[0], 'MISPLACED_MARKER');
      assert.match(prefix, /^ *\u25cf +$/, 'MISPLACED_MARKER');
      markers[label] = { row: position.row, col: prefix.indexOf('\u25cf') };
    } else assert.match(prefix, /^ *$/, 'MISPLACED_LABEL');
    const cells = frame.styles[position.row]?.slice(position.col, position.col + label.length);
    assert.equal(cells?.length, label.length, 'MISSING_STYLE');
    for (const cell of cells) assert.deepEqual(cell, cells[0], 'MIXED_STYLE');
    assert.ok(cells[0], 'MISSING_STYLE');
    labels[label] = { ...cells[0], supported: true };
    positions[label] = position;
  }
  assert.equal(
    rows.reduce((count, line) => count + [...line].filter((ch) => ch === '\u25cf').length, 0),
    Object.keys(markers).length,
    'UNASSOCIATED_MARKER',
  );
  assert.equal(
    positions[calibrationLabels[1]].row,
    positions[calibrationLabels[0]].row + 1,
    'ROW_ORDER',
  );
  assert.equal(
    positions[calibrationLabels[1]].col,
    positions[calibrationLabels[0]].col,
    'ROW_ALIGNMENT',
  );
  if (previous) {
    assert.deepEqual(positions, previous.positions, 'LABEL_MOVED');
    assert.deepEqual(markers, previous.markers, 'MARKER_MOVED');
  }
  return {
    labels,
    positions,
    markers,
    cellModel: Object.keys(markers).length
      ? 'OPENTUI_0_8_0_BARE_25CF_SOURCE_LAYOUT_NOT_TERMINAL_WIDTH'
      : 'ASCII_ONLY',
    geometry: { ...geometry },
    frames,
    frameEnd,
    offset: raw.length,
    byteEnd: Buffer.byteLength(raw),
    transcriptHash: digest(raw),
    profileInstalled: false,
  };
}
export const operationStages = Object.freeze([
  'UNRUN',
  'POLICY',
  'POLICY_WAIT',
  'READY_WAIT',
  'STAGE_FIXTURE',
  'HOST_VERSION',
  'WRITE_BINDING',
  'SETUP',
  'PROGRESS',
  'READ_EVENTS',
  'PARSE_EVENTS',
  'WRITE_KEY',
  'INITIAL_WAIT',
  'INITIAL_CURSOR_WAIT',
  'INITIAL_CURSOR_VALUE',
  'MOVED_WAIT',
  'MOVED_CURSOR_WAIT',
  'MOVED_CURSOR_VALUE',
  'LABEL_SET',
  'STYLE_SUPPORTED',
  'STYLE_BACKGROUND',
  'STYLE_BOLD',
  'STYLE_SWAP',
  'DISMISS',
  'CREDENTIALS',
]);
export const collectionStages = Object.freeze([
  'UNRUN',
  'HOST_EXIT',
  'WRITE_TRANSCRIPT',
  'WRITE_OBSERVATIONS',
  'ENUMERATE_STATE',
  'ENUMERATE_EVIDENCE',
  'SYMLINK',
  'READ_FILE',
  'PER_FILE_SIZE',
  'TOTAL_SIZE',
  'NO_DIAGNOSTICS',
  'BUILD_CAPTURE',
  'SCAN',
  'EXPORT_DIAGNOSTICS',
  'EXPORT_SCAN',
]);
export const rendererReasons = Object.freeze([
  'NONE',
  'ASSERT',
  'IO',
  'PARSE',
  'CAPTURE',
  'DEADLINE',
  'OVERFLOW',
  'INCOMPLETE',
  'REFUSED',
]);
// The stage, not arbitrary exception properties/messages, defines the category.
export function rendererCheckpoint(target, stage, reason) {
  assert.ok([...operationStages, ...collectionStages].includes(stage));
  assert.ok(rendererReasons.includes(reason));
  target.stage = stage;
  target.reason = reason;
}
export async function rendererStep(target, stage, reason, action) {
  rendererCheckpoint(target, stage, reason);
  const result = await action();
  target.reason = 'NONE';
  return result;
}
export function rendererCursor(event) {
  const descriptor = event && Object.getOwnPropertyDescriptor(event, 'value');
  const value = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  return {
    present: !!event,
    value:
      value === 'alpha'
        ? 'ALPHA'
        : value === 'beta'
          ? 'BETA'
          : value === undefined
            ? 'NONE'
            : 'OTHER',
  };
}
export function rendererCaptureCheck(state, overflow, ioFailure) {
  if (!overflow && !ioFailure) return;
  state.reason = overflow ? 'CAPTURE' : 'IO';
  assert.fail('CAPTURE_OR_IO');
}
export function assertRendererCursor(state, cursor, expected, moved = false) {
  rendererCheckpoint(state, moved ? 'MOVED_CURSOR_VALUE' : 'INITIAL_CURSOR_VALUE', 'ASSERT');
  assert.equal(cursor.present, true);
  assert.equal(cursor.value, expected);
  state.reason = 'NONE';
}
export function rendererStyleFacts(before = {}, after = {}) {
  return Object.fromEntries(
    ['1 SYNTHETIC ALPHA', '2 SYNTHETIC BETA'].map((label, i, labels) => {
      const a = before[label],
        b = after[label],
        opposite = after[labels[1 - i]];
      return [
        i === 0 ? 'ALPHA' : 'BETA',
        {
          beforePresent: !!a,
          afterPresent: !!b,
          beforeSupported: a?.supported === true,
          afterSupported: b?.supported === true,
          backgroundChanged: !!a && !!b && !isDeepStrictEqual(a.bg, b.bg),
          beforeBold: a?.bold === true,
          afterBold: b?.bold === true,
          swappedForegroundEqual: !!a && !!opposite && isDeepStrictEqual(a.fg, opposite.fg),
          swappedBackgroundEqual: !!a && !!opposite && isDeepStrictEqual(a.bg, opposite.bg),
        },
      ];
    }),
  );
}
export function rendererSize(state, size, total = false, surface) {
  rendererCheckpoint(state, total ? 'TOTAL_SIZE' : 'PER_FILE_SIZE', 'OVERFLOW');
  assert.equal(typeof total, 'boolean');
  assert.ok(Number.isSafeInteger(size) && size >= 0);
  assert.ok(total ? surface === undefined : ['state', 'evidence'].includes(surface));
  if (!total && size > 4194304 && !Object.hasOwn(state, 'overflow'))
    state.overflow = { surface, bytes: size };
  assert.ok(size <= (total ? 16777216 : 4194304));
  state.reason = 'NONE';
}
export function rendererDiagnostics(state, entries) {
  rendererCheckpoint(state, 'NO_DIAGNOSTICS', 'INCOMPLETE');
  const diagnostics = entries.filter((e) => /\.log(?:$|[.-])/.test(e.path));
  assert.ok(diagnostics.length > 0);
  state.reason = 'NONE';
  return diagnostics;
}
export function assertRendererStyles(before, after, state) {
  const labels = ['1 SYNTHETIC ALPHA', '2 SYNTHETIC BETA'];
  rendererCheckpoint(state, 'LABEL_SET', 'ASSERT');
  assert.deepEqual(Object.keys(before).sort(), labels);
  assert.deepEqual(Object.keys(after).sort(), labels);
  rendererCheckpoint(state, 'STYLE_SUPPORTED', 'ASSERT');
  for (const label of labels) {
    assert.equal(before[label].supported, true);
    assert.equal(after[label].supported, true);
  }
  rendererCheckpoint(state, 'STYLE_BACKGROUND', 'ASSERT');
  for (const label of labels) assert.notDeepEqual(before[label].bg, after[label].bg);
  rendererCheckpoint(state, 'STYLE_BOLD', 'ASSERT');
  assert.equal(before[labels[0]].bold, true);
  assert.equal(before[labels[1]].bold, false);
  assert.equal(after[labels[0]].bold, false);
  assert.equal(after[labels[1]].bold, true);
  rendererCheckpoint(state, 'STYLE_SWAP', 'ASSERT');
  // Selected styling transfers to BETA. ALPHA remains current, not ordinary
  // inactive: its form-field-selected foreground need not equal BETA's text.base.
  assert.deepEqual(before[labels[0]].fg, after[labels[1]].fg);
  assert.deepEqual(before[labels[0]].bg, after[labels[1]].bg);
  assert.deepEqual(before[labels[1]].bg, after[labels[0]].bg);
  state.reason = 'NONE';
}
export function rendererScan(captures, canaries, complete, overflow) {
  assert.equal(complete, true, 'INCOMPLETE');
  assert.equal(overflow, false, 'OVERFLOW');
  assert.ok(
    canaries.length >= 2 && canaries.every((s) => typeof s === 'string' && s.length >= 32),
    'CANARY_SET',
  );
  for (const surface of rendererSurfaces) {
    assert.ok(Buffer.isBuffer(captures[surface]), 'MISSING_SURFACE');
    for (const canary of canaries)
      assert.equal(captures[surface].includes(Buffer.from(canary)), false, 'SECRET_MATCH');
    assert.equal(
      /cap_[a-f0-9]{64}|(?:sk-|ghp_)[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
        captures[surface].toString('utf8'),
      ),
      false,
      'SECRET_PATTERN',
    );
  }
  return {
    status: 'PASS',
    scope: 'renderer-only',
    surfaces: rendererSurfaces,
    hashes: Object.fromEntries(rendererSurfaces.map((s) => [s, digest(captures[s])])),
    absentByDesign: ['broker', 'journal', 'telegram', 'approval-api'],
    productSixSurfaceGate: 'NOT_APPLICABLE_NOT_PASSED',
  };
}
export function assertRendererExport(scan) {
  assert.equal(scan.status, 'PASS');
  assert.equal(scan.scope, 'renderer-only');
  assert.deepEqual(scan.surfaces, rendererSurfaces);
  assert.equal(scan.productSixSurfaceGate, 'NOT_APPLICABLE_NOT_PASSED');
}
export function safeRendererDiagnostic(value) {
  // Reject accessors before reading even one value. Never execute diagnostic input.
  const seen = new Set();
  const inspect = (v, depth = 0) => {
    assert.ok(depth <= 4 && seen.size < 32);
    assert.ok(!seen.has(v));
    seen.add(v);
    assert.ok(
      v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)),
    );
    assert.ok(Reflect.ownKeys(v).length <= 20);
    for (const key of Reflect.ownKeys(v)) {
      assert.equal(typeof key, 'string');
      const d = Object.getOwnPropertyDescriptor(v, key);
      assert.ok('value' in d && d.enumerable && typeof d.value !== 'function');
      if (d.value && typeof d.value === 'object') inspect(d.value, depth + 1);
    }
  };
  inspect(value);
  const extended = Object.hasOwn(value, 'operation');
  const diagnostic = Object.hasOwn(value, 'diagnostic');
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'bytes',
      'cleanup',
      'counts',
      'failure',
      'frames',
      'hostExit',
      'phase',
      'runtime',
      'scanReason',
      'status',
      ...(extended ? ['operation', 'collection', 'cursor', 'styles'] : []),
      ...(diagnostic ? ['diagnostic'] : []),
    ].sort(),
  );
  assert.ok(['PASS', 'FAIL'].includes(value.status));
  if (diagnostic) {
    const d = value.diagnostic;
    assert.deepEqual(Object.keys(d).sort(), ['ALPHA', 'BETA', 'analysis', 'capture', 'profile']);
    assert.ok(['DIAGNOSTIC_CAPTURE_PASS', 'FAIL'].includes(d.capture));
    assert.ok(['UNPROVEN', 'FAIL'].includes(d.analysis));
    assert.equal(d.profile, 'UNPROVEN');
    for (const label of ['ALPHA', 'BETA']) {
      assert.deepEqual(Object.keys(d[label]).sort(), ['present', 'value']);
      assert.equal(typeof d[label].present, 'boolean');
      assert.ok(['ALPHA', 'BETA', 'OTHER', 'NONE'].includes(d[label].value));
    }
    if (d.capture === 'DIAGNOSTIC_CAPTURE_PASS') {
      assert.equal(value.status, 'PASS');
      assert.equal(value.failure, 'NONE');
      assert.equal(value.scanReason, 'NONE');
      assert.equal(value.cleanup, true);
      assert.equal(value.hostExit, true);
      assert.deepEqual(value.counts, { ctrlG: 1, arrowDown: 1, observe: 2, escape: 1, enter: 0 });
      assert.equal(d.ALPHA.present, true);
      assert.equal(d.BETA.present, true);
    }
  }
  assert.ok(
    [
      'NONE',
      'PHASE_DEADLINE',
      'CAPTURE_LIMIT',
      'CONTROL_OR_IO',
      'CLEANUP_FAILED',
      'SCAN_REFUSED',
    ].includes(value.failure),
  );
  assert.ok(
    ['policy', 'ready', 'initial', 'moved', 'dismissed', 'UNOBSERVED'].includes(value.phase),
  );
  assert.ok(
    ['UNRUN', 'NONE', 'SCAN_REFUSED', 'OVERFLOW', 'COLLECTION_OR_INCOMPLETE'].includes(
      value.scanReason,
    ),
  );
  for (const n of [value.bytes, value.frames, ...Object.values(value.counts)])
    assert.ok(n === null || (Number.isSafeInteger(n) && n >= 0 && n <= 1048576));
  assert.deepEqual(
    Object.keys(value.counts).sort(),
    ['ctrlG', 'arrowDown', 'observe', 'escape', 'enter'].sort(),
  );
  assert.equal(typeof value.cleanup, 'boolean');
  assert.equal(typeof value.hostExit, 'boolean');
  assert.deepEqual(Object.keys(value.runtime).sort(), ['bun', 'host']);
  assert.ok(['UNKNOWN', '2.2.5'].includes(value.runtime.host));
  assert.match(value.runtime.bun, /^(?:UNKNOWN|\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (extended) {
    for (const [field, stages] of [
      ['operation', operationStages],
      ['collection', collectionStages],
    ]) {
      const operands = field === 'collection' && Object.hasOwn(value[field], 'overflow');
      assert.deepEqual(Object.keys(value[field]).sort(), [
        ...(operands ? ['overflow'] : []),
        'reason',
        'stage',
      ]);
      assert.ok(stages.includes(value[field].stage));
      assert.ok(rendererReasons.includes(value[field].reason));
      if (operands) {
        const { overflow } = value[field];
        assert.equal(value[field].stage, 'PER_FILE_SIZE');
        assert.equal(value[field].reason, 'OVERFLOW');
        assert.equal(value.status, 'FAIL');
        assert.equal(value.scanReason, 'OVERFLOW');
        assert.deepEqual(Object.keys(overflow).sort(), ['bytes', 'surface']);
        assert.ok(['state', 'evidence'].includes(overflow.surface));
        assert.ok(Number.isSafeInteger(overflow.bytes) && overflow.bytes > 4194304);
      }
    }
    assert.deepEqual(Object.keys(value.cursor).sort(), ['present', 'value']);
    assert.equal(typeof value.cursor.present, 'boolean');
    assert.ok(['ALPHA', 'BETA', 'OTHER', 'NONE'].includes(value.cursor.value));
    assert.deepEqual(Object.keys(value.styles).sort(), ['ALPHA', 'BETA']);
    for (const facts of Object.values(value.styles)) {
      assert.deepEqual(Object.keys(facts).sort(), Object.keys(rendererStyleFacts().ALPHA).sort());
      for (const fact of Object.values(facts)) assert.equal(typeof fact, 'boolean');
    }
  }
  return value;
}

// Tracks only emitted SGR for contiguous literal labels. It does not reconstruct
// cells, infer transparency, ignore unsupported styles or qualify current frames.
export function emittedLabels(raw) {
  const style = { fg: 'unknown', bg: 'unknown', bold: false, supported: true };
  const labels = {};
  const controls = new Set();
  const glyphs = new Set();
  let frames = 0,
    sgrTokens = 0;
  const literalEmissions = { ALPHA: 0, BETA: 0 };
  const tokens =
    raw.match(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[^\[]|[^\x1b]+/g) ??
    [];
  for (const token of tokens) {
    if (token.startsWith('\x1b')) {
      controls.add(token);
      if (token === '\x1b[?2026l') frames++;
      if (!/^\x1b\[[0-9;]*m$/.test(token)) continue;
      sgrTokens++;
      const values = token
        .slice(2, -1)
        .split(';')
        .map((v) => Number(v || 0));
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === 0)
          Object.assign(style, { fg: 'default', bg: 'default', bold: false, supported: true });
        else if (v === 1) style.bold = true;
        else if (v === 22) style.bold = false;
        else if (v === 39) style.fg = 'default';
        else if (v === 49) style.bg = 'default';
        else if (
          (v === 38 || v === 48) &&
          values[i + 1] === 2 &&
          values.slice(i + 2, i + 5).length === 3
        ) {
          style[v === 38 ? 'fg' : 'bg'] = values.slice(i + 2, i + 5);
          i += 4;
        } else style.supported = false;
      }
    } else {
      for (const char of token)
        if (char.codePointAt(0) > 127)
          glyphs.add(`U+${char.codePointAt(0).toString(16).toUpperCase()}`);
      for (const label of ['1 SYNTHETIC ALPHA', '2 SYNTHETIC BETA']) {
        if (token.includes(label)) {
          labels[label] = { ...structuredClone(style), frame: frames + 1 };
          literalEmissions[label === '1 SYNTHETIC ALPHA' ? 'ALPHA' : 'BETA'] +=
            token.split(label).length - 1;
        }
      }
    }
  }
  return {
    labels,
    frames,
    sgrTokens,
    literalEmissions,
    controls: [...controls],
    glyphs: [...glyphs],
    cellWidths: 'UNKNOWN - no cell-width inference from codepoints',
    profileInstalled: false,
  };
}
