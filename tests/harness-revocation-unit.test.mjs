// TEST ONLY. Approved design enrollment/revocation and serialized admission.
// All IO is injected memory, no Telegram, files, network, process or real time.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memoryHarness,
  boundDecision,
  scope,
  keyId,
  turns,
} from './support/harness-memory-unit.mjs';

test('memory replay control retains the existing enrollment and pending request', async (t) => {
  const f = await memoryHarness(t);
  const { request, input } = await f.create();
  const replay = await f.make();
  assert.deepEqual(replay.operatorScope(keyId), f.core.operatorScope(keyId));
  assert.deepEqual((await replay.createRequest(input)).request, request);
});

test('paired revoke is idempotent, survives memory replay and permits a freshly confirmed key', async (t) => {
  const f = await memoryHarness(t);
  const { request, input } = await f.create();
  const decision = await boundDecision(f.core, request);
  await f.consume([f.command()]).done();
  assert.equal(f.core.operatorScope(keyId), null, 'paired revoke removes active authority');
  await assert.rejects(f.core.decideThroughHarness(decision), { code: 'AUTH_REQUIRED' });
  await f.consume([f.command()]).done();
  assert.equal(f.core.operatorScope(keyId), null);
  assert.equal(
    (await f.core.createRequest(input)).request.resolution,
    'pending',
    'Telegram request remains pending',
  );
  const replay = await f.make();
  assert.equal(replay.operatorScope(keyId), null, 'committed revocation survives replay');
  await assert.rejects(replay.decideThroughHarness(decision), { code: 'AUTH_REQUIRED' });
  await f.enroll('c'.repeat(64));
  assert.deepEqual(f.core.operatorScope('c'.repeat(64)), {
    harness_id: scope.harnessId,
    owner_id: scope.ownerId,
  });
});

test('foreign sender/chat, group, unknown key and malformed revoke grant no revocation or request resolution', async (t) => {
  const f = await memoryHarness(t);
  const { request, input } = await f.create();
  await f
    .consume([
      f.command(undefined, 72),
      f.command(undefined, 71, 82),
      f.command(undefined, 71, 81, 'group'),
      f.command(`/harness_revoke ${keyId.toUpperCase()}`),
      f.command(`/harness_revoke ${keyId} trailing`),
      f.command(`/harness_revoke  ${keyId}`),
      f.command(`/harness_revoke@bot ${keyId}`),
      f.command(`/harness_revoke ${'d'.repeat(64)}`),
    ])
    .done();
  assert.deepEqual(f.core.operatorScope(keyId), {
    harness_id: scope.harnessId,
    owner_id: scope.ownerId,
  });
  assert.equal((await f.core.createRequest(input)).request.request_id, request.request_id);
  assert.equal((await f.core.createRequest(input)).request.resolution, 'pending');
  assert.equal((await f.core.createRequest(input)).request.response_text, null);
});

test('revoke queued before a decision denies that decision after the held memory commit', async (t) => {
  const f = await memoryHarness(t);
  const { request } = await f.create();
  const decision = await boundDecision(f.core, request);
  const held = f.hold();
  const batch = f.consume([f.command()]);
  await turns();
  assert.equal(held.entered, true, 'revoke update must own the held append before the decision');
  const result = f.core.decideThroughHarness(decision).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  held.release();
  await batch.done();
  assert.equal((await result).error?.code, 'AUTH_REQUIRED');
  assert.equal(f.core.operatorScope(keyId), null);
});

test('decision queued before revoke retains its one outcome through revocation and memory replay', async (t) => {
  const f = await memoryHarness(t);
  const { request, input } = await f.create();
  const decision = await boundDecision(f.core, request);
  const held = f.hold();
  const result = f.core.decideThroughHarness(decision);
  await turns();
  assert.equal(held.entered, true, 'decision must own the held append before the revoke update');
  const batch = f.consume([f.command()]);
  held.release();
  const winner = await result;
  assert.equal(winner.accepted, true);
  await batch.done();
  assert.equal(f.core.operatorScope(keyId), null);
  const replay = await f.make();
  const { request: retained } = await replay.createRequest(input);
  assert.equal(retained.decision_id, winner.decision_id);
  assert.equal(retained.resolution, 'rejected');
});

test('failed revocation memory append fences further decisions without pretending revocation committed', async (t) => {
  const f = await memoryHarness(t);
  const { request } = await f.create();
  const decision = await boundDecision(f.core, request);
  f.failAppend();
  await f.consume([f.command()]).done({ stopped: true });
  await assert.rejects(f.core.decideThroughHarness(decision), { code: 'STORAGE_FAILURE' });
  const replay = await f.make();
  assert.notEqual(replay.operatorScope(keyId), null, 'failed append is not a committed revocation');
});
