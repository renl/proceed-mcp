// Synthetic controls of test assertions only. This suite imports no production.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  syntheticOperator,
  closedExchangeVectors,
  invalidChildVectors,
  ready,
  frame,
} from './support/harness-helper-vectors.mjs';
import {
  assertParentPrivacy,
  assertParentAdmission,
  assertNoSpawn,
  assertParentRefusal,
  assertParentLifetime,
  assertUncertainCommit,
} from './support/harness-parent-observations.mjs';

test('PARENT-VECTORS: closed-operation restrictions have valid synthetic authority independently', () => {
  const vectors = closedExchangeVectors();
  assert.ok(vectors.length > 0);
  for (const [, value] of vectors) {
    assert.match(value.operator_credential, /^hop_[a-f0-9]{64}$/);
    assert.equal(value.body.harness_id, 'qualification');
  }
  assert.equal(ready().runtime, 'node');
  assert.equal(ready().node_version, '24.22.2');
  assert.equal(frame(ready()).includes(Buffer.from(syntheticOperator)), false);
});

test('PARENT-FRAMING: child attack bytes preserve preallocation and strict-decoder failures', () => {
  const vectors = new Map(invalidChildVectors());
  assert.equal(vectors.get('child-oversized-length').readUInt32BE(), 81921);
  assert.equal(vectors.get('child-direction-limit').length, 98305);
  assert.equal(vectors.get('child-partial-prefix').length, 2);
  assert.throws(() =>
    new TextDecoder('utf-8', { fatal: true }).decode(vectors.get('child-invalid-utf8').subarray(4)),
  );
  assert.equal(
    vectors
      .get('child-duplicate-key')
      .toString()
      .match(/"runtime"/g).length,
    2,
  );
  assert.deepEqual(
    vectors.get('child-extra-ready'),
    Buffer.concat([frame(ready()), frame(ready())]),
  );
});

test('PARENT-PRIVACY: every required raw capture fails missing or leaked, including discarded noise', () => {
  const safe = Object.fromEntries(
    ['argv', 'environment', 'stdout', 'stderr', 'diagnostics'].map((key) => [key, Buffer.alloc(0)]),
  );
  assertParentPrivacy(safe, [syntheticOperator]);
  for (const key of Object.keys(safe)) {
    assert.throws(() => assertParentPrivacy({ ...safe, [key]: undefined }, [syntheticOperator]));
    assert.throws(() =>
      assertParentPrivacy({ ...safe, [key]: Buffer.from(syntheticOperator) }, [syntheticOperator]),
    );
  }
  assert.throws(() => assertParentPrivacy(safe, []));
});

test('PARENT-ADMISSION: actual identity, clean env, private descriptors and ordered handoff required', () => {
  const expected = { executable: '/trusted/bin/node', helper: '/payload/src/harness/selected.js' };
  const safe = {
    spawn: {
      executable: expected.executable,
      realExecutable: expected.executable,
      helper: expected.helper,
      realHelper: expected.helper,
      shell: false,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
      environment: {},
      requiredOSVariables: [],
    },
    runtime: { bun: null, node: '24.22.2', executable: expected.executable },
    pipes: {
      private: true,
      lifetimeClosedBeforeResponseExit: false,
      helloAt: 1,
      readyAt: 2,
      authorityAt: 3,
      authorityFrames: 1,
    },
  };
  assertParentAdmission(safe, expected);
  for (const runtime of [
    { ...safe.runtime, bun: '1.4.4' },
    { ...safe.runtime, node: '23.0.0' },
    { ...safe.runtime, executable: '/other/node' },
  ])
    assert.throws(() => assertParentAdmission({ ...safe, runtime }, expected));
  for (const patch of [
    { shell: true },
    { realHelper: '/replaced/helper.js' },
    { environment: { NODE_OPTIONS: '--inspect' } },
    { stdio: ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'] },
  ])
    assert.throws(() =>
      assertParentAdmission({ ...safe, spawn: { ...safe.spawn, ...patch } }, expected),
    );
  for (const patch of [
    { authorityAt: 1 },
    { lifetimeClosedBeforeResponseExit: true },
    { authorityFrames: 2 },
    { private: false },
  ])
    assert.throws(() =>
      assertParentAdmission({ ...safe, pipes: { ...safe.pipes, ...patch } }, expected),
    );
});

test('PARENT-NOSPAWN: preaborted or failed executable admission cannot start a child', () => {
  const safe = { spawnedPids: [], authorityFrames: 0, acceptedResponses: 0 };
  assertNoSpawn(safe);
  for (const patch of [{ spawnedPids: [123] }, { authorityFrames: 1 }, { acceptedResponses: 1 }])
    assert.throws(() => assertNoSpawn({ ...safe, ...patch }));
});

const absent = {
  acceptedResponses: 0,
  authorityFrames: 0,
  ownedChildrenRemaining: 0,
  openOwnedPipes: 0,
  openOwnedSockets: 0,
  liveOwnedTimers: 0,
};
test('PARENT-REFUSAL: noise/malformed output is not success or confirmed cleanup', () => {
  assertParentRefusal(absent, { beforeAuthority: true });
  for (const key of Object.keys(absent))
    assert.throws(() => assertParentRefusal({ ...absent, [key]: 1 }, { beforeAuthority: true }));
});

test('PARENT-LIFETIME: EOF/cancel/reload/deadline/hung-child fencing requires exit and owned absence', () => {
  const safe = {
    ...absent,
    entryAt: 0,
    fenceAt: 9000,
    terminateAt: 9000,
    forceAt: 9500,
    exitAt: 9600,
    closedAt: 9700,
    deadlineAt: 10000,
    admittedAt: null,
    nextPhaseAfterFence: 0,
    unrelatedSignals: 0,
  };
  assertParentLifetime(safe);
  for (const patch of [
    { terminateAt: 9501 },
    { forceAt: 9501 },
    { forceAt: 9510.808594 },
    { forceAt: 9500.000001 },
    { exitAt: 10001 },
    { closedAt: 10000.000001 },
    { closedAt: 10001 },
    { deadlineAt: 10001 },
    { nextPhaseAfterFence: 1 },
    { ownedChildrenRemaining: 1 },
    { unrelatedSignals: 1 },
    { admittedAt: 9800, cleanExit: true, generationActive: false },
  ])
    assert.throws(() => assertParentLifetime({ ...safe, ...patch }));
  assertParentLifetime({ ...safe, admittedAt: 9800, cleanExit: true, generationActive: true });
});

test('PARENT-UNCERTAINTY: lost commit response refreshes exact binding without replay', () => {
  const binding = { request_id: 'retained-request', presentation_id: 'retained-presentation' };
  const winner = { decision_id: 'retained-decision', outcome: 'rejected' };
  const safe = {
    decisionRequests: [{ binding }],
    refreshRequests: [{ operation: 'presentation', binding }],
    retainedWinner: winner,
    refreshedWinner: winner,
    acceptedAfterFence: 0,
  };
  assertUncertainCommit(safe, binding);
  for (const patch of [
    { decisionRequests: [{ binding }, { binding }] },
    { refreshRequests: [] },
    { refreshRequests: [{ operation: 'decisions', binding }] },
    {
      refreshRequests: [
        { operation: 'presentation', binding: { ...binding, request_id: 'foreign' } },
      ],
    },
    { refreshedWinner: { ...winner, outcome: 'approved' } },
    { acceptedAfterFence: 1 },
  ])
    assert.throws(() => assertUncertainCommit({ ...safe, ...patch }, binding));
});
