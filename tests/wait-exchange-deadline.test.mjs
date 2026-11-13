// TEST ONLY. Memory-only proof of the local client's two exchange-deadline modes.
// Nothing here reads a real file, opens a socket, waits on an OS timer or queries a
// native store: the protected ownership record, node:tls, node:http, the clock and
// the timer table are substituted, so the run is identical on Windows and Linux.
// Traceability: opencode-session-continuation, requirement "Portable waiting-call
// outcome delivery", scenarios "Waiting call outlives internal durations" and
// "Return actual outcomes within documented waiting limits". Mock transports do not
// prove real TLS-PSK behaviour, real protected-read cost, installed adapter
// operation, Telegram receipt or a live outcome reaching an MCP call.
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';

const source = (path) => new URL(`../src/${path}`, import.meta.url).href;
const token = 'SYNTHETIC_PRIVATE_CONTROL';
const channelKey = '2'.repeat(64);
const capability = `cap_${'3'.repeat(64)}`;
const registrationId = `reg_${'1'.repeat(32)}`;
const waitPath = `/v1/requests/req_${'1'.repeat(32)}/wait`;
const record = {
  schemaVersion: 2,
  path: '/synthetic/ownership',
  bytes: Buffer.from('synthetic protected identity'),
  port: 43189,
  pid: 123,
  instance: '1'.repeat(32),
  channel: { protocol: 'tls-psk-v1', psk: channelKey },
};
const brokerBody = () => ({
  schema_version: 1,
  request_id: `req_${'1'.repeat(32)}`,
  resolution: 'approved',
  decision_id: `dec_${'1'.repeat(32)}`,
  response_text: null,
});

let clock,
  timers,
  timerCalls,
  reads,
  sockets,
  agents,
  requests,
  authorizations,
  readCountAtAuthorization,
  clockAtAuthorization,
  errors,
  options,
  controller;
const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

function advance(ms) {
  clock += ms;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= clock && timers.delete(id)) timer.callback();
  }
}

const fake = {
  // The protected ownership read is the only uncancellable phase. Its configured
  // cost moves the fake clock, so "the wait outlives N ms of protected work" is
  // proven by advancing a counter in near-zero real time.
  async read(path) {
    assert.equal(path, record.path);
    const index = reads;
    reads += 1;
    advance(options.readCosts[index] ?? 0);
    if ((options.destroyedDuringRead ?? []).includes(index)) {
      assert.equal(sockets.at(-1).destroyed, true, 'the guard destroys its owned socket');
    }
    if (options.abortRead === index) controller.abort();
    if (options.changedRead === index) return { ...record, bytes: Buffer.from('replacement') };
    if (index === 0 && options.absent === true) return { absent: true };
    if (index === 0 && options.legacy === true) return { ...record, schemaVersion: 1 };
    return record;
  },
  tls(connectOptions) {
    assert.equal(connectOptions.host, '127.0.0.1');
    assert.equal(connectOptions.port, record.port);
    assert.equal(connectOptions.rejectUnauthorized, true);
    assert.equal(connectOptions.minVersion, 'TLSv1.2');
    assert.equal(connectOptions.maxVersion, 'TLSv1.2');
    assert.equal(connectOptions.ciphers, 'PSK-AES256-GCM-SHA384');
    const authority = connectOptions.pskCallback();
    assert.equal(authority.identity, 'proceed-mcp-local-v1');
    assert.equal(authority.psk.equals(Buffer.from(channelKey, 'hex')), true);
    const problem = options.profile;
    const socket = new EventEmitter();
    Object.assign(socket, {
      authorized: problem !== 'unauthorized',
      authorizationError: problem === 'authorizationError' ? 'SELF_SIGNED_CERT_IN_CHAIN' : undefined,
      destroyed: false,
      renegotiationDisabled: false,
      getProtocol: () => (problem === 'protocol' ? 'TLSv1.3' : 'TLSv1.2'),
      getCipher: () => ({
        name: problem === 'cipher' ? 'AES256-GCM-SHA384' : 'PSK-AES256-GCM-SHA384',
      }),
      isSessionReused: () => problem === 'resumed',
      disableRenegotiation() {
        this.renegotiationDisabled = true;
      },
      destroy() {
        this.destroyed = true;
      },
    });
    sockets.push(socket);
    queueMicrotask(() => {
      socket.emit('connect');
      // A listener that never proves its channel emits no secureConnect, so only a
      // product-internal timer could ever end that handshake.
      if (options.stallHandshake === true) return;
      advance(options.handshakeCost ?? 0);
      socket.emit('secureConnect');
    });
    return socket;
  },
  Agent: class FakeAgent {
    constructor() {
      this.destroyed = false;
      agents.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  },
  http(requestOptions, respond) {
    assert.equal(sockets.at(-1).destroyed, false, 'no Authorization is sent over a dead socket');
    assert.equal(requestOptions.host, '127.0.0.1');
    assert.equal(requestOptions.port, record.port);
    assert.equal(requestOptions.path, waitPath);
    assert.equal(requestOptions.method, 'POST');
    assert.equal(requestOptions.headers.authorization, `Bearer ${token}`);
    assert.equal(requestOptions.headers['X-Proceed-Request-Capability'], capability);
    authorizations += 1;
    requests.push(requestOptions.path);
    readCountAtAuthorization = reads;
    clockAtAuthorization = clock;
    const request = new EventEmitter();
    const settle = () => {
      advance(options.httpCost ?? 0);
      const response = new EventEmitter();
      response.statusCode = options.status ?? 200;
      respond(response);
      response.emit('data', Buffer.from(options.rawBody ?? JSON.stringify(brokerBody())));
      response.emit('end');
    };
    request.end = () => {
      // A held response keeps the exchange open, so a product-internal duration is
      // the only thing that could end it.
      if (options.holdResponse === true) options.release = settle;
      else queueMicrotask(settle);
    };
    return request;
  },
};
globalThis.__waitExchangeDeadlineUnit = fake;
const wrappers = {
  ownership:
    'export const readSecureOwnership = (...a) => globalThis.__waitExchangeDeadlineUnit.read(...a);',
  tls: 'export default { connect: (...a) => globalThis.__waitExchangeDeadlineUnit.tls(...a) };',
  http: 'export default { Agent: globalThis.__waitExchangeDeadlineUnit.Agent, request: (...a) => globalThis.__waitExchangeDeadlineUnit.http(...a) };',
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const client = context.parentURL === source('http/local-client.js');
    let key;
    if (client && specifier === '../state/ownership.js') key = 'ownership';
    if (client && specifier === 'node:tls') key = 'tls';
    if (client && specifier === 'node:http') key = 'http';
    return key ? { url: `wait-exchange-deadline:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith('wait-exchange-deadline:')
      ? { format: 'module', source: wrappers[url.split(':')[1]], shortCircuit: true }
      : next(url, context);
  },
});
const local = await import('../src/http/local-client.js');

beforeEach(() => {
  clock = reads = authorizations = 0;
  readCountAtAuthorization = clockAtAuthorization = undefined;
  timers = new Map();
  timerCalls = [];
  sockets = [];
  agents = [];
  requests = [];
  errors = [];
  options = { readCosts: [], handshakeCost: 0, httpCost: 0 };
  controller = new AbortController();
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => clock },
  });
  globalThis.setTimeout = (callback, ms) => {
    const id = Symbol('owned timer');
    timerCalls.push(ms);
    timers.set(id, { callback, at: clock + ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
});
afterEach(() => {
  // Cleanup is asserted before globals are restored, so a RED expectation still
  // proves teardown and secret-free diagnostics.
  const timerCount = timers.size;
  const unclosed = sockets.filter((socket) => !socket.destroyed).length;
  const liveAgents = agents.filter((agent) => !agent.destroyed).length;
  const listeners = getEventListeners(controller.signal, 'abort').length;
  Object.defineProperty(globalThis, 'performance', originalPerformance);
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  assert.equal(timerCount, 0, 'every owned timer is cleared');
  assert.equal(unclosed, 0, 'every owned socket is destroyed');
  assert.equal(liveAgents, 0, 'every HTTP agent is destroyed');
  assert.equal(listeners, 0, 'every abort listener is detached');
  assert.equal(
    errors.some((line) => line.includes(token) || line.includes(channelKey)),
    false,
    'no diagnostic carries the protected credential or channel key',
  );
});
after(() => {
  hooks.deregister();
  delete globalThis.__waitExchangeDeadlineUnit;
});

function client(mode, extra = {}) {
  return local.createSecureLocalClient({
    port: record.port,
    lockFile: record.path,
    token,
    ...(mode === undefined ? {} : { mode }),
    ...extra,
  });
}
const operator = () =>
  local.createOperatorLocalClient({ port: record.port, lockFile: record.path, token });
const call = (instance) =>
  instance.request(
    'POST',
    waitPath,
    { registration_id: registrationId },
    { 'X-Proceed-Request-Capability': capability },
    { signal: controller.signal },
  );
const turns = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
async function refuses(promise, code) {
  await assert.rejects(promise, (error) => {
    errors.push(error.message);
    assert.equal(error instanceof local.LocalRequestError, true, 'a local-client error');
    assert.equal(error.message.includes(token) || error.message.includes(channelKey), false);
    assert.equal(error.code, code);
    return true;
  });
}
function refusesConstruction(build, code) {
  assert.throws(build, (error) => {
    errors.push(error.message);
    assert.equal(error instanceof local.LocalRequestError, true, 'an invalid local-client argument');
    assert.equal(error.message.includes(token) || error.message.includes(channelKey), false);
    assert.equal(error.code, code);
    return true;
  });
}

// The ordinary path must be reachable only through its absolute budget, so its
// schedule, per-phase refusal and teardown stay exactly as they were.
test('WXD-BUDGET-SCHEDULE: budget mode keeps its absolute exchange schedule and teardown', async () => {
  options.readCosts = [50, 1200, 1200];
  options.handshakeCost = 20;
  options.httpCost = 30;
  const response = await call(client());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, brokerBody());
  assert.deepEqual(requests, [waitPath]);
  assert.equal(authorizations, 1);
  assert.equal(readCountAtAuthorization, 3, 'the header follows the third record comparison');
  assert.equal(clockAtAuthorization, 2470);
  assert.deepEqual(timerCalls, [1000, 8730, 7530], 'handshake, socket guard and response timers');
  assert.equal(clock, 2500);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].renegotiationDisabled, true);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const [label, setup, code, expectedReads, expectedTimers] of [
  ['an overrun initial ownership read', { readCosts: [10000] }, 'BROKER_UNAVAILABLE', 1, []],
  ['an overrun pre-TLS record comparison', { readCosts: [0, 10000] }, 'BROKER_UNAVAILABLE', 2, []],
  [
    'an overrun pre-Authorization record comparison',
    { readCosts: [0, 0, 20000], destroyedDuringRead: [2] },
    'BROKER_UNAVAILABLE',
    3,
    [1000, 10000],
  ],
  [
    'a cancellation during the pre-Authorization record comparison',
    { abortRead: 2 },
    'BROKER_UNAVAILABLE',
    3,
    [1000, 10000],
  ],
]) {
  test(`WXD-BUDGET-REFUSAL: budget mode still refuses on ${label}`, async () => {
    Object.assign(options, setup);
    await refuses(call(client()), code);
    assert.equal(reads, expectedReads);
    assert.equal(requests.length, 0);
    assert.equal(authorizations, 0);
    assert.deepEqual(timerCalls, expectedTimers);
    assert.equal(sockets.every((socket) => socket.destroyed), true);
  });
}

test('WXD-BUDGET-ABORT-HELD: budget mode abort during the held response tears down', async () => {
  options.holdResponse = true;
  const pending = call(client());
  // Observed below; the no-op handler keeps a RED expectation from leaving an
  // unhandled rejection behind.
  pending.catch(() => {});
  await turns();
  assert.equal(requests.length, 1);
  assert.equal(sockets[0].destroyed, false);
  controller.abort();
  await refuses(pending, 'BROKER_UNAVAILABLE');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents[0].destroyed, true);
});

test('WXD-BUDGET-STALLED-HANDSHAKE: budget mode still fails a stalled handshake as a conflict', async () => {
  options.stallHandshake = true;
  const pending = call(client());
  pending.catch(() => {});
  await turns();
  assert.equal(authorizations, 0);
  assert.deepEqual(timerCalls, [1000]);
  assert.equal(sockets[0].destroyed, false);
  advance(1000);
  await refuses(pending, 'BROKER_INSTANCE_CONFLICT');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(requests.length, 0);
});

for (const [label, extra, expected] of [
  ['LOCAL_REQUEST_TIMEOUT_MS', {}, [1000, 10000, 10000]],
  ['an explicit budget mode', { mode: 'budget' }, [1000, 10000, 10000]],
  ['an explicit 5,000 ms timeout', { timeoutMs: 5000 }, [1000, 5000, 5000]],
  ['an explicit 32,000 ms budget', { timeoutMs: 32000 }, [1000, 32000, 32000]],
]) {
  test(`WXD-BUDGET-DEFAULT: budget mode still applies ${label}`, async () => {
    const response = await call(client(undefined, extra));
    assert.deepEqual(response.body, brokerBody());
    assert.deepEqual(timerCalls, expected);
    assert.equal(clock, 0);
  });
}

// Caller mode is the adapter's waiting client: it installs no exchange, handshake
// or socket-guard timer, so no product-internal duration can end the wait.
for (const [label, readCosts, exceeds, within] of [
  ['one ordinary 10,000 ms budget', [7000, 7000, 7000], 10000, 32000],
  ['the deleted 32,000 ms waiting ceiling', [14000, 14000, 14000], 32000, 150000],
  ['the 150,000 ms startup window', [60000, 60000, 60000], 150000, null],
]) {
  test(`WXD-CALLER-OUTLIVES: caller mode outlives ${label} and returns the broker body`, async () => {
    options.readCosts = readCosts;
    options.handshakeCost = 5000;
    options.httpCost = 30;
    const total = readCosts.reduce((sum, cost) => sum + cost, 0);
    const response = await call(client('caller'));
    assert.deepEqual(response.body, brokerBody());
    assert.deepEqual(requests, [waitPath]);
    assert.equal(authorizations, 1);
    assert.equal(readCountAtAuthorization, 3);
    assert.equal(
      clockAtAuthorization,
      total + 5000,
      'the header follows every record comparison and the handshake',
    );
    assert.deepEqual(timerCalls, [], 'no exchange, handshake or guard timer is scheduled');
    assert.equal(timers.size, 0);
    assert.equal(clock, total + 5000 + 30);
    assert.equal(clock > exceeds, true, `the exchange outlives ${exceeds} ms`);
    if (within !== null) {
      assert.equal(clock < within, true, `the exchange stays inside ${within} ms`);
    }
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].renegotiationDisabled, true);
    assert.equal(sockets[0].destroyed, true);
    assert.equal(agents[0].destroyed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('WXD-CALLER-HELD: caller mode holds an open exchange with a guard listener only', async () => {
  options.readCosts = [60000, 60000, 60000];
  options.handshakeCost = 5000;
  options.holdResponse = true;
  options.httpCost = 30;
  const pending = call(client('caller'));
  pending.catch(() => {});
  await turns();
  assert.deepEqual(requests, [waitPath]);
  assert.deepEqual(timerCalls, [], 'no internal timer exists to end the held exchange');
  assert.equal(timers.size, 0);
  assert.equal(
    getEventListeners(controller.signal, 'abort').length >= 1,
    true,
    'the guard keeps an abort listener',
  );
  assert.equal(sockets[0].destroyed, false);
  advance(300000);
  await turns();
  assert.equal(sockets[0].destroyed, false, 'no internal duration ends a held exchange');
  assert.deepEqual(timerCalls, []);
  options.release();
  const response = await pending;
  assert.deepEqual(response.body, brokerBody());
  assert.equal(clock, 185000 + 300000 + 30);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents[0].destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const [where, setup, expectedReads] of [
  ['the initial ownership read', { abortRead: 0 }, 1],
  ['the pre-TLS record comparison', { abortRead: 1 }, 2],
  ['the pre-Authorization record comparison', { abortRead: 2 }, 3],
]) {
  test(`WXD-CALLER-ABORT: caller mode abort during ${where} rejects unavailable`, async () => {
    Object.assign(options, setup);
    await refuses(call(client('caller')), 'BROKER_UNAVAILABLE');
    assert.equal(reads, expectedReads);
    assert.equal(requests.length, 0);
    assert.equal(authorizations, 0);
    assert.deepEqual(timerCalls, []);
    assert.equal(sockets.every((socket) => socket.destroyed), true);
  });
}

test('WXD-CALLER-ABORT-HELD: caller mode abort destroys the socket and rejects unavailable', async () => {
  options.holdResponse = true;
  const pending = call(client('caller'));
  pending.catch(() => {});
  await turns();
  assert.equal(requests.length, 1);
  assert.deepEqual(timerCalls, []);
  controller.abort();
  await refuses(pending, 'BROKER_UNAVAILABLE');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents[0].destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('WXD-CALLER-STALLED-HANDSHAKE: caller mode never times out a listener that cannot handshake', async () => {
  options.stallHandshake = true;
  const pending = call(client('caller'));
  pending.catch(() => {});
  await turns();
  assert.equal(authorizations, 0, 'no Authorization byte leaves an unproven channel');
  assert.deepEqual(timerCalls, [], 'no handshake timer is installed');
  assert.equal(sockets[0].destroyed, false);
  advance(600000);
  await turns();
  assert.equal(sockets[0].destroyed, false, 'a product timer does not end the handshake');
  assert.equal(requests.length, 0);
  controller.abort();
  await refuses(pending, 'BROKER_UNAVAILABLE');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(authorizations, 0);
});

// Admission is state-based: identity, profile, key and record stability still refuse
// on their own terms and never let an Authorization byte precede them.
for (const [label, setup, code, expectedReads] of [
  ['an unauthorized channel', { profile: 'unauthorized' }, 'BROKER_INSTANCE_CONFLICT', 2],
  ['a verification error', { profile: 'authorizationError' }, 'BROKER_INSTANCE_CONFLICT', 2],
  ['a different TLS version', { profile: 'protocol' }, 'BROKER_INSTANCE_CONFLICT', 2],
  ['a different cipher', { profile: 'cipher' }, 'BROKER_INSTANCE_CONFLICT', 2],
  ['a resumed session', { profile: 'resumed' }, 'BROKER_INSTANCE_CONFLICT', 2],
  ['an absent ownership record', { absent: true }, 'BROKER_UNAVAILABLE', 1],
  ['a schema-1 ownership record', { legacy: true }, 'BROKER_INSTANCE_CONFLICT', 1],
  ['a replaced record before TLS', { changedRead: 1 }, 'BROKER_INSTANCE_CONFLICT', 2],
  [
    'a replaced record before the Authorization header',
    { changedRead: 2 },
    'BROKER_INSTANCE_CONFLICT',
    3,
  ],
]) {
  test(`WXD-CALLER-ADMISSION: caller mode still refuses ${label} before any Authorization`, async () => {
    Object.assign(options, setup);
    await refuses(call(client('caller')), code);
    assert.equal(reads, expectedReads);
    assert.equal(authorizations, 0);
    assert.equal(requests.length, 0);
    assert.deepEqual(timerCalls, []);
    assert.equal(sockets.every((socket) => socket.destroyed), true);
  });
}

test('WXD-CALLER-PREABORT: caller mode refuses an already-cancelled call before protected state', async () => {
  controller.abort();
  await refuses(call(client('caller')), 'BROKER_UNAVAILABLE');
  assert.equal(reads, 0);
  assert.equal(sockets.length, 0);
  assert.equal(requests.length, 0);
});

test('WXD-CALLER-CEILING: caller mode still fails an oversized response as unavailable', async () => {
  options.rawBody = JSON.stringify({ ...brokerBody(), padding: 'x'.repeat(200) });
  await refuses(call(client('caller', { maxResponseBytes: 64 })), 'BROKER_UNAVAILABLE');
  assert.equal(requests.length, 1);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents[0].destroyed, true);
  assert.deepEqual(timerCalls, []);
});

test('WXD-CALLER-ALLOWANCE: caller mode keeps the general response allowance', async () => {
  options.rawBody = JSON.stringify({ ...brokerBody(), padding: 'x'.repeat(200000) });
  const response = await call(client('caller'));
  assert.equal(response.body.padding.length, 200000);
  assert.equal(response.body.resolution, 'approved');
  assert.equal(sockets[0].destroyed, true);
  assert.deepEqual(timerCalls, []);
});

test('WXD-OPERATOR-CEILING: the operator client keeps its 64 KiB ceiling in budget mode', async () => {
  options.rawBody = JSON.stringify({ ...brokerBody(), padding: 'x'.repeat(70000) });
  await refuses(call(operator()), 'BROKER_UNAVAILABLE');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(agents[0].destroyed, true);
});

test('WXD-OPERATOR-ALLOWANCE: the operator client returns a body below its ceiling', async () => {
  options.rawBody = JSON.stringify({ ...brokerBody(), padding: 'x'.repeat(60000) });
  const response = await call(operator());
  assert.equal(response.body.padding.length, 60000);
  assert.equal(sockets[0].destroyed, true);
});

// One closed mode value set: only an explicit, duration-free caller mode is open,
// and every other construction is refused as an invalid local-client argument.
test('WXD-CONSTRUCTION-TIMEOUT: caller mode refuses an explicit timeout at construction', () => {
  for (const timeoutMs of [10_000, 32_000, 1, 0, -1]) {
    refusesConstruction(
      () =>
        local.createSecureLocalClient({
          port: record.port,
          lockFile: record.path,
          token,
          mode: 'caller',
          timeoutMs,
        }),
      'INVALID_REQUEST',
    );
  }
});

test('WXD-CONSTRUCTION-MODE: the exchange-deadline mode is a closed value set', () => {
  for (const mode of ['open', 'unbounded', '', 'Caller', 'BUDGET']) {
    refusesConstruction(
      () =>
        local.createSecureLocalClient({ port: record.port, lockFile: record.path, token, mode }),
      'INVALID_REQUEST',
    );
  }
});

test('WXD-CONSTRUCTION-EXCHANGE: secureExchange refuses caller mode with a numeric timeout', async () => {
  await refuses(
    local.secureExchange({
      lock: record,
      token,
      method: 'POST',
      path: waitPath,
      headers: { 'X-Proceed-Request-Capability': capability },
      mode: 'caller',
      timeoutMs: 10_000,
    }),
    'INVALID_REQUEST',
  );
  assert.equal(reads, 0, 'an invalid argument is refused before any protected read');
  assert.equal(sockets.length, 0);
});

test('WXD-CONSTANT-DELETED: the 32,000 ms waiting ceiling is deleted, not raised', () => {
  assert.equal(
    Object.hasOwn(local, 'LOCAL_WAIT_TIMEOUT_MS'),
    false,
    'no product-internal waiting constant may exist',
  );
  assert.equal(local.LOCAL_REQUEST_TIMEOUT_MS, 10_000);
  assert.equal(local.LOCAL_HANDSHAKE_TIMEOUT_MS, 1000);
  assert.equal(local.LOCAL_LIFECYCLE_BYTES, 16384);
  assert.equal(local.LOCAL_PRODUCT_RESPONSE_BYTES, 65_536);
});

test('WXD-CALLER-NO-DURATION: caller mode is accepted with no duration of any kind', () => {
  for (const extra of [{}, { timeoutMs: undefined }]) {
    const instance = client('caller', extra);
    assert.equal(typeof instance.request, 'function');
  }
});
