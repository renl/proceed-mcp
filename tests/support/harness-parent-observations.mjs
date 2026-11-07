// TEST ONLY. Driver-owned observations, never a production interface/schema.
// Populate from actual process/pipe/exit and broker observers before redaction.
// No production return value or private object is sufficient evidence here.
// argv/environment refer to the actual child. stdout/stderr/diagnostics refer
// to externally visible parent output, not intentionally injected child noise.
import assert from 'node:assert/strict';

export function assertParentPrivacy(captures, secrets) {
  assert.ok(secrets.length > 0);
  for (const name of ['argv', 'environment', 'stdout', 'stderr', 'diagnostics']) {
    assert.ok(Buffer.isBuffer(captures[name]), `missing raw ${name}`);
    for (const secret of secrets) {
      assert.equal(typeof secret, 'string');
      assert.ok(secret.length > 0);
      assert.equal(captures[name].includes(Buffer.from(secret)), false, `${name} authority leak`);
    }
  }
}

export function assertParentAdmission(observation, { executable, helper }) {
  const { spawn, runtime, pipes } = observation;
  assert.equal(spawn.executable, executable);
  assert.equal(spawn.realExecutable, executable);
  assert.equal(spawn.helper, helper);
  assert.equal(spawn.realHelper, helper);
  assert.equal(spawn.shell, false);
  assert.equal(spawn.detached, false);
  assert.deepEqual(spawn.stdio, ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']);
  // Environment is captured from the actual child, not the spawn options alone.
  assert.deepEqual(Object.keys(spawn.environment).sort(), [...spawn.requiredOSVariables].sort());
  assert.ok(spawn.requiredOSVariables.every((name) => ['SystemRoot', 'WINDIR'].includes(name)));
  assert.equal(runtime.bun, null);
  assert.equal(runtime.node, '24.22.2');
  assert.equal(runtime.executable, executable);
  assert.equal(pipes.private, true);
  assert.equal(pipes.lifetimeClosedBeforeResponseExit, false);
  assert.ok(pipes.helloAt < pipes.readyAt && pipes.readyAt < pipes.authorityAt);
  assert.equal(pipes.authorityFrames, 1);
}

export function assertNoSpawn(observation) {
  assert.deepEqual(observation.spawnedPids, []);
  assert.equal(observation.authorityFrames, 0);
  assert.equal(observation.acceptedResponses, 0);
}

export function assertParentRefusal(observation, { beforeAuthority = false } = {}) {
  assert.equal(observation.acceptedResponses, 0);
  if (beforeAuthority) assert.equal(observation.authorityFrames, 0);
  assert.equal(observation.ownedChildrenRemaining, 0);
  assert.equal(observation.openOwnedPipes, 0);
  assert.equal(observation.openOwnedSockets, 0);
  assert.equal(observation.liveOwnedTimers, 0);
}

export function assertParentLifetime(observation) {
  const { entryAt, fenceAt, terminateAt, forceAt, exitAt, closedAt, admittedAt, deadlineAt } =
    observation;
  for (const n of [entryAt, fenceAt, terminateAt, exitAt, closedAt, deadlineAt])
    assert.ok(Number.isFinite(n));
  assert.ok(deadlineAt <= entryAt + 10000);
  assert.ok(fenceAt >= entryAt && fenceAt <= terminateAt);
  if (forceAt !== null) assert.ok(forceAt >= terminateAt && forceAt <= fenceAt + 500);
  assert.ok(exitAt >= terminateAt && exitAt <= fenceAt + 1000);
  assert.ok(closedAt >= exitAt && closedAt <= fenceAt + 1000 && closedAt <= deadlineAt);
  assert.equal(observation.nextPhaseAfterFence, 0);
  assert.equal(observation.unrelatedSignals, 0);
  if (admittedAt !== null) {
    assert.ok(observation.cleanExit && observation.generationActive);
    assert.ok(admittedAt >= closedAt && admittedAt <= deadlineAt);
  }
  assertParentRefusal({
    ...observation,
    acceptedResponses: admittedAt === null ? observation.acceptedResponses : 0,
  });
}

export function assertUncertainCommit(observation, binding) {
  // Actual broker wire observations, not a reported retry count.
  assert.equal(observation.decisionRequests.length, 1);
  assert.deepEqual(observation.decisionRequests[0].binding, binding);
  assert.ok(observation.refreshRequests.length > 0);
  for (const request of observation.refreshRequests) {
    assert.equal(request.operation, 'presentation');
    assert.deepEqual(request.binding, binding);
  }
  assert.deepEqual(observation.retainedWinner, observation.refreshedWinner);
  assert.equal(observation.acceptedAfterFence, 0);
}

// Mandatory composition cases. The real driver must register observers before
// each stimulus. This is a test inventory, not a production configuration API.
export const parentCases = Object.freeze({
  admission: [
    'supported-node-positive',
    'missing-node',
    'unsupported-node',
    'bun-not-node',
    'relative-path',
    'empty-path-entry',
    'cwd-path',
    'wrapper-executable',
    'replaced-executable',
    'replaced-helper',
    'injected-environment',
  ],
  input: ['closed-operation-valid-authority', 'extra-parent-input-valid-authority'],
  protocol: [
    'ready-positive',
    'malformed-child',
    'oversized-child',
    'partial-child',
    'extra-child-frame',
    'wrong-id',
    'wrong-order',
    'wrong-version',
    'stdout-tripwire',
    'stderr-tripwire',
    'response-then-nonzero-exit',
    'response-with-open-pipes',
  ],
  lifecycle: [
    'preaborted-no-spawn',
    'parent-eof',
    'invocation-cancel',
    'dismissal',
    'replacement',
    'reload',
    'cleanup',
    'request-deadline',
    'exchange-deadline',
    'stalled-ready',
    'hung-child-force',
    'late-resolution',
    'late-spawn',
    'late-read',
    'late-pipe-result',
    'cleanup-failure-disables-generation',
  ],
  uncertainty: ['committed-response-lost-no-replay'],
});
