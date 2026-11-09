// TEST ONLY. Actual MCP executor with memory client, no transport or resources.
// Design section 3: only startup config and validated transport metadata produce context.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolExecutor } from '../src/mcp/execution.js';
import { PassThrough, Writable } from 'node:stream';
import { runMcpServer } from '../src/mcp/server.js';

const handle = `hdl_${'a'.repeat(32)}`;
const requestId = `req_${'b'.repeat(32)}`;
const capability = `cap_${'c'.repeat(64)}`;
const route = { harness_id: 'unit', session_id: 'session-exact' };
const metadata = (value) => ({ meta: { 'ai.opencode/sessionID': value } });
const args = {
  request_handle: handle,
  request_capability: capability,
  client_request_id: 'unit-context',
  action: 'Question',
  context: '',
};
const conflict = {
  status: 409,
  body: {
    schema_version: 1,
    error: { code: 'IDEMPOTENCY_CONFLICT', message: 'unit refusal', retryable: false },
  },
};

function fixture(t, harnessId) {
  const calls = [];
  const executor = createToolExecutor({
    harnessId,
    registration: {
      async ensure() {
        return {};
      },
      close() {},
    },
    client: {
      async request(method, path, body, headers) {
        calls.push({ method, path, body: structuredClone(body), headers });
        return path === '/v1/handles'
          ? {
              status: 201,
              body: {
                schema_version: 1,
                request_handle: handle,
                request_id: requestId,
                request_capability: capability,
              },
            }
          : conflict;
      },
    },
    waitClient: { request: () => assert.fail('refused creation must not wait') },
  });
  t.after(() => executor.close());
  return { calls, executor };
}

for (const [name, harnessId, context, expected] of [
  [
    'unconfigured even with valid metadata',
    null,
    metadata('session-exact'),
    { host_configured: false },
  ],
  ['configured absent metadata', 'unit', {}, { host_configured: true }],
  [
    'configured valid metadata',
    'unit',
    metadata('session-exact'),
    { host_configured: true, harness_route: route },
  ],
  ...[null, 42, '', '\ud800', 'x'.repeat(513), '\u{1f600}'.repeat(129)].map((value, n) => [
    `unsafe metadata ${n}`,
    'unit',
    metadata(value),
    { host_configured: true },
  ]),
  [
    'wrong metadata key',
    'unit',
    { meta: { session_id: 'session-exact' } },
    { host_configured: true },
  ],
]) {
  test(`producer ${name}: exact preparation body, no context in response`, async (t) => {
    const { executor, calls } = fixture(t, harnessId);
    const result = await executor.execute(
      'prepare_approval',
      { session_label: 'Display only' },
      context,
    );
    assert.equal(result.isError, false);
    assert.deepEqual(calls, [
      {
        method: 'POST',
        path: '/v1/handles',
        body: { session_label: 'Display only', ...expected },
        headers: undefined,
      },
    ]);
    assert.equal(Object.hasOwn(result.structuredContent, 'host_configured'), false);
  });
}

for (const extra of [{ host_configured: true }, { harness_route: route }, { human: true }]) {
  test(`model preparation cannot inject ${Object.keys(extra)[0]}`, async (t) => {
    const { executor, calls } = fixture(t, 'unit');
    const result = await executor.execute('prepare_approval', extra, metadata('session-exact'));
    assert.equal(result.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(calls, []);
  });
}

for (const [name, preparation, current, expectedRoute] of [
  ['route-less cannot attach', {}, metadata('session-exact'), undefined],
  ['metadata loss omits route', metadata('session-exact'), {}, undefined],
  ['same route forwarded', metadata('session-exact'), metadata('session-exact'), route],
  [
    'known conflict forwarded not retargeted',
    metadata('session-exact'),
    metadata('other'),
    { ...route, session_id: 'other' },
  ],
]) {
  test(`creation ${name}: capability header and exact body stay bounded`, async (t) => {
    const { executor, calls } = fixture(t, 'unit');
    await executor.execute('prepare_approval', {}, preparation);
    await executor.execute('request_approval', args, current);
    const body = {
      request_handle: handle,
      client_request_id: args.client_request_id,
      action: args.action,
      context: '',
    };
    if (expectedRoute !== undefined) body.harness_route = expectedRoute;
    assert.deepEqual(calls[1], {
      method: 'POST',
      path: '/v1/requests',
      body,
      headers: { 'X-Proceed-Request-Capability': capability },
    });
    assert.equal(Object.hasOwn(calls[1].body, 'host_configured'), false);
  });
}

test('new observer without preparation cache never reconstructs a route from foreground metadata', async (t) => {
  const { executor, calls } = fixture(t, 'unit');
  await executor.execute('request_approval', args, metadata('session-exact'));
  assert.equal(Object.hasOwn(calls[0].body, 'harness_route'), false);
  assert.equal(Object.hasOwn(calls[0].body, 'host_configured'), false);
});

test('initialization instructions explain admitted status without removing Telegram/retrieval guidance', async () => {
  const stdin = new PassThrough();
  let received;
  const frame = new Promise((resolve) => {
    received = resolve;
  });
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      received(JSON.parse(chunk.toString()));
      done();
    },
  });
  const serving = runMcpServer({
    stdin,
    stdout,
    execute: () => assert.fail('initialization must not execute tools'),
  });
  try {
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    const { result } = await frame;
    for (const reason of [
      'HOST_NOT_CONFIGURED',
      'SESSION_ROUTE_UNAVAILABLE',
      'OPERATOR_NOT_ENROLLED',
    ])
      assert.ok(result.instructions.includes(reason), `guidance must explain ${reason}`);
    assert.match(result.instructions, /Telegram/);
    assert.match(result.instructions, /get_approval/);
    assert.match(result.instructions, /harness_channel/);
  } finally {
    stdin.end();
    await serving;
    stdin.destroy();
    stdout.destroy();
  }
});
