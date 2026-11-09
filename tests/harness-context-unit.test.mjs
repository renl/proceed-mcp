// TEST ONLY. Design sections 2/3, real core with injected memory journal.
// This is not disk durability, restart, wire, host or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryHarness, scope, boundDecision } from './support/harness-memory-unit.mjs';

const route = { harnessId: scope.harnessId, sessionId: scope.sessionId };
const unavailable = (reason) => ({ state: 'unavailable', reason });
const routed = unavailable('OPERATOR_NOT_ENROLLED');
const eligible = { state: 'eligible', reason: null };
const inputFor = (authority, extra = {}) => ({
  ownerId: scope.ownerId,
  capability: authority.request_capability,
  requestHandle: authority.request_handle,
  clientRequestId: 'context-unit',
  action: 'Unit question',
  context: 'Memory only',
  ...extra,
});

for (const [name, context, creation, expected] of [
  ['explicit unconfigured', { hostConfigured: false }, {}, unavailable('HOST_NOT_CONFIGURED')],
  ['configured unroutable', { hostConfigured: true }, {}, unavailable('SESSION_ROUTE_UNAVAILABLE')],
  ['legacy unknown unrouted', {}, {}, unavailable('SESSION_ROUTE_UNAVAILABLE')],
  [
    'configured disabled route',
    { hostConfigured: true, harnessRoute: route },
    {},
    unavailable('SESSION_ROUTE_UNAVAILABLE'),
  ],
  ['legacy disabled route', { harnessRoute: route }, {}, unavailable('SESSION_ROUTE_UNAVAILABLE')],
  [
    'configured enabled route',
    { hostConfigured: true, harnessRoute: route },
    { harnessRoute: route },
    routed,
  ],
  ['legacy enabled route', { harnessRoute: route }, { harnessRoute: route }, routed],
]) {
  test(`${name}: reservation transaction, common view and memory reconstruction agree`, async (t) => {
    const f = await memoryHarness(t, { enrolled: false });
    const authority = await f.core.reserveHandle({ ownerId: scope.ownerId, ...context });
    const transaction = f.transactions.at(-1);
    const reservation = transaction.mutations.find((m) => m.op === 'handle.reserve');
    assert.equal(
      Object.hasOwn(reservation, 'host_configured'),
      Object.hasOwn(context, 'hostConfigured'),
    );
    if (Object.hasOwn(context, 'hostConfigured'))
      assert.equal(reservation.host_configured, context.hostConfigured);
    assert.equal(
      transaction.mutations.some((m) => m.op === 'harness.route'),
      !!context.harnessRoute,
    );
    assert.deepEqual(Object.keys(authority).sort(), [
      'request_capability',
      'request_handle',
      'request_id',
      'schema_version',
    ]);
    const input = inputFor(authority, creation);
    const { request } = await f.core.createRequest(input);
    assert.deepEqual(request.harness_channel, expected);
    const before = structuredClone(f.transactions);
    const recovered = await f.make();
    for (const core of [f.core, recovered]) {
      const observed = await core.readRequest({
        ownerId: scope.ownerId,
        capability: input.capability,
        requestId: request.request_id,
      });
      assert.deepEqual(observed.harness_channel, expected);
      assert.equal(observed.request_id, request.request_id);
      assert.equal(observed.expires_at, request.expires_at);
    }
    assert.deepEqual(
      f.transactions,
      before,
      'observation/reconstruction must not backfill context or enable routes',
    );
  });
}

for (const value of [null, 0, 1, 'true', 'false', {}, []]) {
  test(`core refuses nonboolean hostConfigured ${JSON.stringify(value)} before append`, async (t) => {
    const f = await memoryHarness(t);
    const before = structuredClone(f.transactions);
    await assert.rejects(f.core.reserveHandle({ ownerId: scope.ownerId, hostConfigured: value }), {
      code: 'INVALID_ARGUMENT',
    });
    assert.deepEqual(f.transactions, before);
    assert.equal(await f.core.pendingPresentation(scope), null);
  });
}

test('core false plus route refuses without issuing or persisting authority', async (t) => {
  const f = await memoryHarness(t);
  const before = structuredClone(f.transactions);
  await assert.rejects(
    f.core.reserveHandle({ ownerId: scope.ownerId, hostConfigured: false, harnessRoute: route }),
    { code: 'INVALID_ARGUMENT' },
  );
  assert.deepEqual(f.transactions, before);
});

test('retained route enables only on authorized matching replay and survives metadata loss', async (t) => {
  const f = await memoryHarness(t);
  const authority = await f.core.reserveHandle({
    ownerId: scope.ownerId,
    hostConfigured: true,
    harnessRoute: route,
  });
  const input = inputFor(authority);
  const first = (await f.core.createRequest(input)).request;
  assert.deepEqual(first.harness_channel, unavailable('SESSION_ROUTE_UNAVAILABLE'));
  const before = structuredClone(f.transactions);
  const conflicting = { harnessRoute: { ...route, sessionId: 'different' } };
  for (const denied of [{ ownerId: 'foreign' }, { capability: `cap_${'0'.repeat(64)}` }]) {
    assert.equal(await f.core.createRequest({ ...input, ...conflicting, ...denied }), null);
  }
  await assert.rejects(f.core.createRequest({ ...input, ...conflicting }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(f.transactions, before);
  const enabled = (await f.core.createRequest({ ...input, harnessRoute: route })).request;
  assert.deepEqual(enabled.harness_channel, eligible);
  assert.equal(enabled.request_id, first.request_id);
  assert.equal(enabled.expires_at, first.expires_at);
  const committed = structuredClone(f.transactions);
  const recovered = await f.make();
  for (const core of [f.core, recovered]) {
    const replay = (await core.createRequest(input)).request;
    assert.deepEqual(replay.harness_channel, eligible);
    assert.equal(replay.request_id, first.request_id);
    assert.equal(replay.expires_at, first.expires_at);
  }
  assert.deepEqual(f.transactions, committed);
});

test('route-less prepared context cannot acquire a route on creation or replay', async (t) => {
  const f = await memoryHarness(t);
  const authority = await f.core.reserveHandle({ ownerId: scope.ownerId, hostConfigured: false });
  const input = inputFor(authority);
  const before = structuredClone(f.transactions);
  await assert.rejects(f.core.createRequest({ ...input, harnessRoute: route }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(f.transactions, before);
  const first = (await f.core.createRequest(input)).request;
  const after = structuredClone(f.transactions);
  await assert.rejects(f.core.createRequest({ ...input, harnessRoute: route }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(f.transactions, after);
  assert.deepEqual(
    (await f.core.createRequest(input)).request.harness_channel,
    unavailable('HOST_NOT_CONFIGURED'),
  );
  assert.equal(await f.core.pendingPresentation(scope), null);
  const cancelled = await f.core.cancelRequest({
    ownerId: scope.ownerId,
    capability: input.capability,
    requestId: first.request_id,
  });
  assert.deepEqual(cancelled.harness_channel, { state: 'closed', reason: null });
  const acknowledged = await f.core.acknowledgeRequest({
    ownerId: scope.ownerId,
    capability: input.capability,
    requestId: first.request_id,
    decisionId: cancelled.decision_id,
  });
  assert.deepEqual(acknowledged.harness_channel, { state: 'closed', reason: null });
});

for (const kind of ['nonboolean', 'false plus route', 'duplicate reservation', 'duplicate route']) {
  test(`recovery refuses ${kind} rather than repairing preparation history`, async (t) => {
    const f = await memoryHarness(t);
    await f.create();
    const history = structuredClone(f.transactions);
    const transaction = history.find((tx) => tx.mutations.some((m) => m.op === 'handle.reserve'));
    const reservation = transaction.mutations.find((m) => m.op === 'handle.reserve');
    const binding = transaction.mutations.find((m) => m.op === 'harness.route');
    if (kind === 'nonboolean') reservation.host_configured = 'true';
    if (kind === 'false plus route') reservation.host_configured = false;
    if (kind === 'duplicate reservation') transaction.mutations.push(structuredClone(reservation));
    if (kind === 'duplicate route') transaction.mutations.push(structuredClone(binding));
    const before = structuredClone(f.transactions);
    await assert.rejects(f.make(history));
    assert.deepEqual(f.transactions, before, 'invalid replay never appends a repair');
  });
}

test('reservation remains unavailable until its one context/route transaction commits', async (t) => {
  const f = await memoryHarness(t);
  const before = structuredClone(f.transactions);
  f.failAppend();
  await assert.rejects(
    f.core.reserveHandle({ ownerId: scope.ownerId, hostConfigured: true, harnessRoute: route }),
  );
  assert.deepEqual(f.transactions, before);
  await assert.rejects(f.core.pendingPresentation(scope), { code: 'STORAGE_FAILURE' });
});

for (const resolution of ['approved', 'rejected', 'responded', 'cancelled', 'expired']) {
  test(`core ${resolution} takes closed precedence in read, replay and acknowledgement`, async (t) => {
    const f = await memoryHarness(t);
    const { request, input } = await f.create();
    const authority = {
      ownerId: scope.ownerId,
      capability: input.capability,
      requestId: request.request_id,
    };
    if (resolution === 'cancelled') await f.core.cancelRequest(authority);
    else if (resolution === 'expired')
      t.mock.timers.tick(Date.parse(request.expires_at) - Date.now());
    else {
      const binding = await boundDecision(f.core, request);
      await f.core.decideThroughHarness({
        ...binding,
        choice: { approved: 'approve', rejected: 'reject', responded: 'respond' }[resolution],
        responseText: resolution === 'responded' ? 'instructions only' : null,
      });
    }
    const closed = await f.core.readRequest(authority);
    assert.equal(closed.resolution, resolution);
    assert.deepEqual(closed.harness_channel, { state: 'closed', reason: null });
    const acknowledged = await f.core.acknowledgeRequest({
      ...authority,
      decisionId: closed.decision_id,
    });
    assert.deepEqual(acknowledged.harness_channel, { state: 'closed', reason: null });
    const recovered = await f.make();
    assert.deepEqual((await recovered.readRequest(authority)).harness_channel, {
      state: 'closed',
      reason: null,
    });
  });
}
