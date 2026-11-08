// TEST ONLY. Scripted fault controls, never actual host/cleanup/privacy proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  waitCompositionPhase,
  failureSnapshot,
  settleCompositionHost,
  scanFrozenComposition,
  retainProgress,
  safeCompositionDiagnostic,
  assertCompositionExport,
  persistCompositionDiagnostic,
  compositionScanReason,
} from './support/harness-composition-retention.mjs';

test('picker assertion, typed deadline and unlisted IO remain distinct without exception text', async () => {
  for (const [predicate, expected] of [
    [() => assert.fail('SECRET'), 'ERR_ASSERTION'],
    [() => false, 'PHASE_DEADLINE'],
    [
      () => {
        throw Error('SECRET');
      },
      'CONTROL_ASSERTION_OR_IO',
    ],
  ]) {
    let tick = 0;
    let failure;
    try {
      await waitCompositionPhase({
        predicate,
        now: () => tick,
        deadline: 2,
        pause: async () => {
          tick++;
        },
        overflow: () => false,
      });
    } catch (error) {
      failure = failureSnapshot({
        error,
        phase: 'rendered-product-session-picker',
        keys: { ctrlG: 1, enter: 0, exit: 0 },
        state: { exited: false, overflow: false },
        now: tick,
        deadline: 2,
      });
    }
    assert.equal(failure.errorCode, expected);
    assert.equal(failure.phase, 'rendered-product-session-picker');
    assert.equal(failure.keys.enter, 0);
    assert.equal(failure.guard.checks.hostRunning, true);
    assert.equal(
      failure.guard.failed.length,
      Object.values(failure.guard.checks).filter((v) => !v).length,
    );
    assert.equal(JSON.stringify(failure).includes('SECRET'), false);
    assert.throws(() => {
      failure.keys.exit++;
    });
  }
});

test('one Ctrl+C can dismiss the dialog without host exit, termination observations stay separate', async () => {
  let tick = 0;
  const state = { exited: false, closed: false };
  const events = [];
  const result = await settleCompositionHost({
    observe: () => state,
    exitSent: false,
    requestExit: () => events.push('ctrlC'),
    terminate: (signal) => {
      events.push(signal);
      if (signal === 'SIGKILL') Object.assign(state, { exited: true, closed: true });
    },
    now: () => tick,
    deadline: 6,
    pause: async () => {
      tick++;
    },
    graceMs: 2,
    termMs: 2,
  });
  assert.deepEqual(events, ['ctrlC', 'SIGTERM', 'SIGKILL']);
  assert.deepEqual(result, {
    exitObserved: true,
    closeObserved: true,
    termination: 'SIGKILL_REQUESTED',
  });
  assert.equal(tick, 4);
  const prior = await settleCompositionHost({
    observe: () => ({ exited: true, closed: true }),
    exitSent: true,
    requestExit: () => assert.fail(),
    terminate: () => assert.fail(),
    now: () => 0,
    deadline: 1,
    pause: async () => assert.fail(),
  });
  assert.equal(prior.termination, 'NOT_REQUESTED');
});

const captures = () =>
  Object.fromEntries(
    ['tui', 'telegram', 'journal', 'diagnostics', 'evidence', 'api'].map((name) => [
      name,
      Buffer.from('complete synthetic bytes'),
    ]),
  );
const secrets = ['operator-secret', 'transport-secret', 'control-secret', 'owner-secret'];
test('scan refusal projects only closed causes, never exception content or match values', () => {
  for (const [change, reason] of [
    [{ complete: false }, 'INCOMPLETE'],
    [{ overflow: true }, 'OVERFLOW'],
    [{ secrets: [] }, 'SECRET_SET'],
    [{ captures: { ...captures(), api: undefined } }, 'MISSING'],
    [{ captures: { ...captures(), tui: Buffer.alloc(8388609) } }, 'OVERFLOW'],
    [{ captures: { ...captures(), telegram: Buffer.from(secrets[0]) } }, 'SECRET_MATCH'],
  ]) {
    let caught;
    try {
      scanFrozenComposition({
        captures: captures(),
        secrets,
        complete: true,
        overflow: false,
        ...change,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught);
    const scanReason = compositionScanReason(caught, 'SCAN');
    assert.equal(scanReason, reason);
    const projected = safeCompositionDiagnostic({
      rawScan: 'REFUSED',
      scanReason,
      message: secrets[0],
      path: secrets[1],
      headers: secrets[2],
      id: secrets[3],
    });
    assert.equal(projected.scanReason, reason);
    for (const secret of secrets) assert.equal(JSON.stringify(projected).includes(secret), false);
    assert.throws(() => assertCompositionExport({ status: 'REFUSED', scanReason }));
  }
  for (const [error, stage, reason] of [
    [Error(secrets[0]), 'COLLECTION', 'COLLECTION'],
    [{ code: 'ENOENT', path: secrets[0] }, 'COLLECTION', 'MISSING'],
    [Error(secrets[0]), 'WRITE', 'WRITE'],
    [{ code: 'SECRET_MATCH' }, 'SCAN', 'UNKNOWN'],
    [null, 'SECRET', 'UNKNOWN'],
  ])
    assert.equal(compositionScanReason(error, stage), reason);
  assert.equal(safeCompositionDiagnostic({ rawScan: 'REFUSED' }).scanReason, 'UNKNOWN');
  assert.equal(
    safeCompositionDiagnostic({ rawScan: 'REFUSED', scanReason: secrets[0] }).scanReason,
    'UNKNOWN',
  );
});
test('termination does not imply completeness, but complete frozen captures can actually scan', () => {
  const input = captures();
  const result = scanFrozenComposition({
    captures: input,
    secrets,
    complete: true,
    overflow: false,
  });
  input.tui.fill(0);
  assert.equal(result.captures.tui.toString(), 'complete synthetic bytes');
  assert.equal(result.scan.status, 'PASS');
  assert.doesNotThrow(() => assertCompositionExport(result.scan));
  for (const change of [
    { complete: false },
    { overflow: true },
    { captures: { ...captures(), api: undefined } },
    { secrets: [] },
    { secrets: secrets.slice(1) },
    { captures: { ...captures(), tui: Buffer.from(secrets[0]) } },
  ])
    assert.throws(() =>
      scanFrozenComposition({
        captures: captures(),
        secrets,
        complete: true,
        overflow: false,
        ...change,
      }),
    );
  for (const surface of Object.keys(captures()))
    for (const secret of secrets)
      assert.throws(() =>
        scanFrozenComposition({
          captures: { ...captures(), [surface]: Buffer.from(secret) },
          secrets,
          complete: true,
          overflow: false,
        }),
      );
});

test('safe failure snapshot drops paths, IDs, accessors, raw errors and arbitrary phases', () => {
  let reads = 0;
  const error = Object.defineProperty({}, 'code', {
    get() {
      reads++;
      throw Error('SECRET');
    },
  });
  const result = failureSnapshot({
    error,
    phase: 'SECRET',
    keys: { ctrlG: 'SECRET', enter: 0, exit: 1 },
    state: { frame: 'SECRET', binding: { session: 'SECRET' } },
    now: 2,
    deadline: 3,
  });
  assert.equal(reads, 0);
  assert.equal(result.phase, 'UNLISTED_PHASE');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('outer progress appends phase history and preserves the first observed container exit', () => {
  let value = retainProgress(undefined, 'evidence', { containerExit: '1' });
  value = retainProgress(value, 'teardown');
  value = retainProgress(value, 'complete', { containerExit: '0', cleanup: 'PASS' });
  assert.equal(value.containerExit, '1');
  assert.deepEqual(value.phases, ['evidence', 'teardown', 'complete']);
});

test('safe failure persists without host close and failed final replacement keeps the earlier record', async () => {
  let retained, next;
  const io = {
    write: async (bytes) => {
      next = bytes;
    },
    commit: async () => {
      retained = next;
    },
  };
  const input = {
    status: 'FAIL',
    phase: 'rendered-product-session-picker',
    rawScan: 'UNRUN',
    lifecycle: { exitObserved: false, closeObserved: false },
    message: 'SECRET',
  };
  await persistCompositionDiagnostic(io, input);
  const before = retained;
  await assert.rejects(
    persistCompositionDiagnostic(
      {
        ...io,
        commit: async () => {
          throw Error('simulated failure');
        },
      },
      { ...input, rawScan: 'REFUSED' },
    ),
  );
  assert.equal(retained, before);
  assert.equal(JSON.parse(retained).lifecycle.closeObserved, false);
  assert.doesNotMatch(retained, /SECRET|message/);
});

test('ungated diagnostic retains the frozen failure guard, not cleanup-time operands or raw metadata', () => {
  const state = {
    exited: false,
    overflow: false,
    binding: { session: 'PUBLIC-ID' },
    frame: 'SECRET',
  };
  const keys = { ctrlG: 1, enter: 0, exit: 0 };
  const failureAt = failureSnapshot({
    error: { code: 'PHASE_DEADLINE' },
    phase: 'rendered-product-session-picker',
    state,
    keys,
    now: 2,
    deadline: 3,
  });
  state.exited = true;
  keys.exit++;
  const diagnostic = safeCompositionDiagnostic({
    status: 'FAIL',
    failureAt,
    keys,
    phase: 'SECRET',
    error: Error('SECRET'),
    message: 'SECRET',
    stack: 'SECRET',
    frame: 'SECRET',
    session: 'PUBLIC-ID',
    rawScan: 'REFUSED',
    lifecycle: { exitObserved: true, closeObserved: true, termination: 'SIGKILL_REQUESTED' },
  });
  assert.equal(diagnostic.failureAt.guard.checks.hostRunning, true);
  assert.equal(diagnostic.failureAt.keys.exit, 0);
  assert.equal(diagnostic.keys.exit, 1);
  assert.equal(diagnostic.lifecycle.closeObserved, true);
  assert.equal(diagnostic.lifecycle.termination, 'SIGKILL_REQUESTED');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|PUBLIC-ID|stack|message/);
  assert.throws(() => safeCompositionDiagnostic({ failureAt: { guard: {} } }));
  for (const marker of [null, {}, { status: 'PASS', surfaces: ['tui'] }, { status: 'REFUSED' }])
    assert.throws(() => assertCompositionExport(marker));
});
