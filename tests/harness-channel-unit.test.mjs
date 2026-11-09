// TEST ONLY. Design section 2 common representation, injected in-memory client.
// No broker server, transport, filesystem lifecycle, host or human qualification.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolExecutor } from '../src/mcp/execution.js';
import { memoryHarness, scope } from './support/harness-memory-unit.mjs';

for (const resolution of ['approved', 'rejected', 'responded', 'expired', 'cancelled']) {
  test(`terminal ${resolution} replay preserves closed harness status in both MCP projections`, async () => {
    const args = {
      request_handle: `hdl_${'a'.repeat(32)}`,
      request_capability: `cap_${'b'.repeat(64)}`,
      client_request_id: 'unit-replay',
      action: 'Read the recorded result',
      context: '',
    };
    const body = {
      schema_version: 1,
      request_handle: args.request_handle,
      request_id: `req_${'c'.repeat(32)}`,
      client_request_id: args.client_request_id,
      owner_id: 'shared',
      session_label: 'Unit only',
      action: args.action,
      context: '',
      created_at: '2026-11-09T00:00:00Z',
      expires_at: '2026-11-09T01:00:00Z',
      resolution,
      resolved_at: '2026-11-09T00:01:00Z',
      response_text: resolution === 'responded' ? 'approved' : null,
      decision_id: `dec_${'d'.repeat(32)}`,
      telegram_state: 'sent',
      delivery_state: 'unavailable',
      delivery_error: null,
      event_capability: {
        status: 'unverified',
        revision: null,
        reason: 'No verified Events contract or host support',
      },
      harness_channel: { state: 'closed', reason: null },
    };
    let calls = 0;
    const executor = createToolExecutor({
      client: {
        async request() {
          calls++;
          return { status: 200, body: structuredClone(body) };
        },
      },
      waitClient: { request: () => assert.fail('terminal replay must not wait') },
      registration: {
        ensure: async () => ({
          registration_id: `reg_${'e'.repeat(32)}`,
          registration_secret: 'f'.repeat(64),
        }),
        close() {},
      },
    });
    try {
      const result = await executor.execute('request_approval', args);
      assert.equal(result.isError, false);
      assert.equal(calls, 1);
      assert.deepEqual(result.structuredContent.harness_channel, body.harness_channel);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      assert.ok(!JSON.stringify(result).includes(args.request_capability));
    } finally {
      await executor.close();
    }
  });
}

const pendingView = (harnessChannel) => ({
  schema_version: 1,
  request_handle: `hdl_${'a'.repeat(32)}`,
  request_id: `req_${'c'.repeat(32)}`,
  client_request_id: 'unit-status',
  owner_id: 'shared',
  session_label: 'Unit only',
  action: 'Unit question',
  context: '',
  created_at: '2026-11-09T00:00:00Z',
  expires_at: '2026-11-09T01:00:00Z',
  resolution: 'pending',
  resolved_at: null,
  response_text: null,
  decision_id: null,
  telegram_state: 'pending',
  delivery_state: 'not_applicable',
  delivery_error: null,
  event_capability: {
    status: 'unverified',
    revision: null,
    reason: 'No verified Events contract or host support',
  },
  harness_channel: harnessChannel,
});

// Design's status precedence is HOST_NOT_CONFIGURED, then
// SESSION_ROUTE_UNAVAILABLE, then OPERATOR_NOT_ENROLLED. These are broker-supplied
// eligibility observations, not assertions of human display or delivery.
const statusCases = [
  ['host unavailable', { state: 'unavailable', reason: 'HOST_NOT_CONFIGURED' }],
  ['route unavailable', { state: 'unavailable', reason: 'SESSION_ROUTE_UNAVAILABLE' }],
  ['operator unavailable', { state: 'unavailable', reason: 'OPERATOR_NOT_ENROLLED' }],
  ['eligible', { state: 'eligible', reason: null }],
];

for (const [name, channel] of statusCases) {
  test(`pending ${name}: MCP keeps the exact declared eligibility in both projections`, async () => {
    const body = pendingView(channel);
    const executor = createToolExecutor({
      client: { request: async () => ({ status: 200, body }) },
      registration: { async ensure() {}, close() {} },
    });
    try {
      const result = await executor.execute('get_approval', {
        request_id: body.request_id,
        request_capability: `cap_${'b'.repeat(64)}`,
      });
      assert.equal(result.isError, false);
      assert.deepEqual(result.structuredContent.harness_channel, channel);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      assert.ok(!JSON.stringify(result).includes(`cap_${'b'.repeat(64)}`));
    } finally {
      await executor.close();
    }
  });
}

for (const [name, channel] of [
  ['missing', undefined],
  ['unknown state', { state: 'displayed', reason: null }],
  ['unavailable without reason', { state: 'unavailable', reason: null }],
  ['eligible with refusal reason', { state: 'eligible', reason: 'OPERATOR_NOT_ENROLLED' }],
  ['pending closed', { state: 'closed', reason: null }],
  ['unknown reason', { state: 'unavailable', reason: 'OTHER' }],
]) {
  test(`pending ${name}: malformed eligibility cannot be promoted as a successful request view`, async () => {
    const body = pendingView(channel);
    if (channel === undefined) delete body.harness_channel;
    const executor = createToolExecutor({
      client: { request: async () => ({ status: 200, body }) },
      registration: { async ensure() {}, close() {} },
    });
    try {
      const result = await executor.execute('get_approval', {
        request_id: body.request_id,
        request_capability: `cap_${'b'.repeat(64)}`,
      });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, 'BROKER_UNAVAILABLE');
    } finally {
      await executor.close();
    }
  });
}

for (const enrolled of [false, true]) {
  test(`routed pending core with enrolled=${enrolled} produces the corresponding eligibility`, async (t) => {
    const f = await memoryHarness(t, { enrolled });
    const { request } = await f.create();
    assert.deepEqual(
      request.harness_channel,
      enrolled
        ? { state: 'eligible', reason: null }
        : { state: 'unavailable', reason: 'OPERATOR_NOT_ENROLLED' },
    );
  });
}

test('terminal memory-core representation is closed regardless of remaining operator enrollment', async (t) => {
  const f = await memoryHarness(t);
  const { request, input } = await f.create();
  const presentation = await f.core.pendingPresentation(scope);
  await f.core.decideThroughHarness({
    ...scope,
    keyId: 'a'.repeat(64),
    requestId: request.request_id,
    presentationId: presentation.presentation_id,
    choice: 'respond',
    responseText: 'approved',
  });
  const { request: retained } = await f.core.createRequest(input);
  assert.equal(retained.resolution, 'responded');
  assert.deepEqual(retained.harness_channel, { state: 'closed', reason: null });
});

test('pending status reflects enrollment then revocation without changing the retained request', async (t) => {
  const f = await memoryHarness(t, { enrolled: false });
  const { input, request } = await f.create();
  assert.deepEqual(request.harness_channel, {
    state: 'unavailable',
    reason: 'OPERATOR_NOT_ENROLLED',
  });
  await f.enroll();
  const eligible = (await f.core.createRequest(input)).request;
  assert.equal(eligible.request_id, request.request_id);
  assert.deepEqual(eligible.harness_channel, { state: 'eligible', reason: null });
  await f.consume([f.command()]).done();
  const revoked = (await f.core.createRequest(input)).request;
  assert.equal(revoked.request_id, request.request_id);
  assert.equal(revoked.resolution, 'pending');
  assert.deepEqual(revoked.harness_channel, {
    state: 'unavailable',
    reason: 'OPERATOR_NOT_ENROLLED',
  });
});
