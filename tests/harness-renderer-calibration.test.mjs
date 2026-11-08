import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rendererScan,
  rendererSurfaces,
  assertRendererExport,
  emittedLabels,
  rendererPayload,
  safeRendererDiagnostic,
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
