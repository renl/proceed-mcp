// TEST ONLY. Lexical emission evidence, NOT a screen emulator or product profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
  'tests/support/harness-linux-plan.mjs',
  'tests/support/harness-host-plan.mjs',
]);
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
    ].sort(),
  );
  assert.ok(['PASS', 'FAIL'].includes(value.status));
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
  return value;
}

// Tracks only emitted SGR for contiguous literal labels. It does not reconstruct
// cells, infer transparency, ignore unsupported styles or qualify current frames.
export function emittedLabels(raw) {
  const style = { fg: 'unknown', bg: 'unknown', bold: false, supported: true };
  const labels = {};
  const controls = new Set();
  const glyphs = new Set();
  let frames = 0;
  const tokens =
    raw.match(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[^\[]|[^\x1b]+/g) ??
    [];
  for (const token of tokens) {
    if (token.startsWith('\x1b')) {
      controls.add(token);
      if (token === '\x1b[?2026l') frames++;
      if (!/^\x1b\[[0-9;]*m$/.test(token)) continue;
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
        if (token.includes(label)) labels[label] = { ...structuredClone(style), frame: frames + 1 };
      }
    }
  }
  return {
    labels,
    frames,
    controls: [...controls],
    glyphs: [...glyphs],
    cellWidths: 'UNKNOWN - no cell-width inference from codepoints',
    profileInstalled: false,
  };
}
