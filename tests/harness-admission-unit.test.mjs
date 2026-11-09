// TEST ONLY. Actual portable-server application handler with node:http replaced
// BEFORE import. No HTTP parser, listener, socket, TLS, filesystem or resource is created.
// These are memory body/role admission units, not wire-security proof.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

let handler;
globalThis.__sdetAdmissionServer = (callback) => {
  handler = callback;
  return Object.assign(new EventEmitter(), {
    listen(_options, done) {
      done();
    },
    close(done) {
      done();
    },
    closeIdleConnections() {},
  });
};
after(() => {
  delete globalThis.__sdetAdmissionServer;
  handler = undefined;
});
const hook = registerHooks({
  load(url, context, next) {
    if (url === 'node:http')
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const createServer = (callback) => globalThis.__sdetAdmissionServer(callback);',
      };
    return next(url, context);
  },
});
let createPortableServer;
try {
  ({ createPortableServer } = await import('../src/broker/portable-server.js?admission-unit'));
} finally {
  hook.deregister();
}

async function fixture(t) {
  const reservations = [],
    creations = [];
  const server = createPortableServer({
    broker: {
      async reserveHandle(input) {
        reservations.push(input);
        return { schema_version: 1 };
      },
      async createRequest(input) {
        creations.push(input);
        return null;
      },
    },
    credentials: { control: 'control-unit', owners: new Map([['shared', 'owner-unit']]) },
    port: 1,
  });
  await server.listen(); // Only the above no-resource fake is reachable.
  server.markReady();
  t.after(() => server.close());
  const invoke = (raw, token = 'owner-unit', path = '/v1/handles') =>
    new Promise((resolve) => {
      const request = {
        method: 'POST',
        url: path,
        headers: {
          authorization: `Bearer ${token}`,
          'x-proceed-request-capability': `cap_${'a'.repeat(64)}`,
        },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(raw);
        },
      };
      const response = Object.assign(new EventEmitter(), {
        headersSent: false,
        setHeader() {},
        end(payload) {
          this.headersSent = true;
          resolve({ status: this.statusCode, body: JSON.parse(payload) });
        },
      });
      handler(request, response);
    });
  return { invoke, reservations, creations };
}

const wireRoute = { harness_id: 'unit', session_id: 'exact-session' };
for (const body of [
  {},
  { host_configured: false },
  { host_configured: true },
  { harness_route: wireRoute },
  { host_configured: true, harness_route: wireRoute },
]) {
  test(`reservation body admits exact boolean/legacy combination ${JSON.stringify(body)}`, async (t) => {
    const f = await fixture(t);
    const result = await f.invoke(JSON.stringify(body));
    assert.equal(result.status, 201);
    assert.equal(f.reservations.length, 1);
    const input = f.reservations[0];
    assert.equal(input.ownerId, 'shared');
    assert.equal(input.hostConfigured, body.host_configured);
    assert.deepEqual(
      input.harnessRoute,
      body.harness_route ? { harnessId: 'unit', sessionId: 'exact-session' } : undefined,
    );
  });
}

for (const [name, raw] of [
  ...[null, 1, 0, 'true', {}, []].map((value) => [
    `nonboolean ${JSON.stringify(value)}`,
    JSON.stringify({ host_configured: value }),
  ]),
  ['false plus route', JSON.stringify({ host_configured: false, harness_route: wireRoute })],
  ['duplicate booleans', '{"host_configured":true,"host_configured":false}'],
  ['duplicate identical booleans', '{"host_configured":true,"host_configured":true}'],
  ['body principal', '{"owner_id":"foreign"}'],
  ['human flag', '{"human":true}'],
  [
    'extra route field',
    JSON.stringify({ host_configured: true, harness_route: { ...wireRoute, human: true } }),
  ],
  ['null route', '{"host_configured":true,"harness_route":null}'],
  [
    'unsafe session',
    JSON.stringify({
      host_configured: true,
      harness_route: { ...wireRoute, session_id: '\ud800' },
    }),
  ],
]) {
  test(`reservation refuses ${name} before core mutation`, async (t) => {
    const f = await fixture(t);
    const result = await f.invoke(raw);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(f.reservations, []);
  });
}

for (const [token, status, code] of [
  ['wrong-unit', 401, 'AUTH_REQUIRED'],
  ['control-unit', 403, 'FORBIDDEN'],
  [`hop_${'b'.repeat(64)}`, 403, 'FORBIDDEN'],
]) {
  test(`non-owner admission ${code} precedes context body parsing`, async (t) => {
    const f = await fixture(t);
    const result = await f.invoke('not-json', token);
    assert.equal(result.status, status);
    assert.equal(result.body.error.code, code);
    assert.deepEqual(f.reservations, []);
  });
}

test('creation rejects host_configured as an unlisted field, not a context update', async (t) => {
  const f = await fixture(t);
  const result = await f.invoke(
    JSON.stringify({
      request_handle: `hdl_${'a'.repeat(32)}`,
      client_request_id: 'unit',
      action: 'Question',
      context: '',
      host_configured: true,
    }),
    'owner-unit',
    '/v1/requests',
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(f.creations, []);
});
