// TEST ONLY. Existing automatic-startup contract, with no filesystem or network I/O.
// Traceability: opencode-session-continuation requirements "Automatic broker
// availability for normal MCP use" and "Automatic startup preserves
// credential and readiness boundaries". Mock transports do not prove real TLS.
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';

const source = (path) => new URL(`../src/${path}`, import.meta.url).href;
const token = 'SYNTHETIC_PRIVATE_CONTROL';
const record = {
  schemaVersion: 2,
  path: '/synthetic/ownership',
  bytes: Buffer.from('synthetic protected identity'),
  port: 43189,
  pid: 123,
  instance: '1'.repeat(32),
  channel: { protocol: 'tls-psk-v1', psk: '2'.repeat(64) },
};
const envelope = () => ({
  schema_version: 1,
  service: 'proceed-mcp',
  lifecycle_version: 1,
  instance: record.instance,
  pid: record.pid,
  port: record.port,
  local_ready: true,
  paired: false,
  telegram: { state: 'disabled', code: null },
});
let clock, timers, timerCalls, reads, sockets, agents, requests, logs, options, controller;
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
  async read(path) {
    assert.equal(path, record.path);
    const index = reads++;
    advance(options.readCosts[index] ?? 0);
    if (index >= 2 && options.readCosts[index] === 150000) {
      assert.equal(sockets.at(-1).destroyed, true, 'deadline guard destroys socket during read');
    }
    if (options.abortRead === index) controller.abort();
    if (options.changedRead === index) return { ...record, bytes: Buffer.from('replacement') };
    if (options.absent) return { absent: true };
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
    assert.equal(authority.psk.equals(Buffer.from(record.channel.psk, 'hex')), true);
    const socket = new EventEmitter();
    Object.assign(socket, {
      authorized: true,
      destroyed: false,
      getProtocol: () => 'TLSv1.2',
      getCipher: () => ({ name: 'PSK-AES256-GCM-SHA384' }),
      isSessionReused: () => false,
      disableRenegotiation() {},
      destroy() { this.destroyed = true; },
    });
    sockets.push(socket);
    queueMicrotask(() => {
      advance(options.handshakeCost);
      socket.emit('connect');
      socket.emit('secureConnect');
    });
    return socket;
  },
  Agent: class {
    constructor() { this.destroyed = false; agents.push(this); }
    destroy() { this.destroyed = true; }
  },
  http(requestOptions, respond) {
    assert.equal(sockets.at(-1).destroyed, false);
    assert.equal(requestOptions.host, '127.0.0.1');
    assert.equal(requestOptions.port, record.port);
    assert.equal(requestOptions.path, '/v1/ready');
    assert.equal(requestOptions.method, 'GET');
    assert.equal(requestOptions.headers.authorization === `Bearer ${token}`, true);
    requests.push(requestOptions.path);
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      advance(options.httpCost);
      const response = new EventEmitter();
      response.statusCode = 200;
      respond(response);
      response.emit('data', Buffer.from(JSON.stringify({ ...envelope(), ...options.envelope })));
      response.emit('end');
    });
    return request;
  },
  occupancy() {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    sockets.push(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  },
  async delay(ms) { advance(ms); },
};
globalThis.__readinessDeadlineUnit = fake;
const wrappers = {
  ownership: 'export const readSecureOwnership = (...a) => globalThis.__readinessDeadlineUnit.read(...a);',
  tls: 'export default { connect: (...a) => globalThis.__readinessDeadlineUnit.tls(...a) };',
  http: 'export default { Agent: globalThis.__readinessDeadlineUnit.Agent, request: (...a) => globalThis.__readinessDeadlineUnit.http(...a) };',
  net: 'export const connect = (...a) => globalThis.__readinessDeadlineUnit.occupancy(...a);',
  delay: 'export const setTimeout = (...a) => globalThis.__readinessDeadlineUnit.delay(...a);',
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL;
    const client = parent === source('http/local-client.js');
    const availability = parent === source('broker/availability.js');
    let key;
    if ((client || availability) && specifier === '../state/ownership.js') key = 'ownership';
    if (client && specifier === 'node:tls') key = 'tls';
    if (client && specifier === 'node:http') key = 'http';
    if (availability && specifier === 'node:net') key = 'net';
    if (availability && specifier === 'node:timers/promises') key = 'delay';
    return key ? { url: `readiness-unit:${key}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith('readiness-unit:')
      ? { format: 'module', source: wrappers[url.split(':')[1]], shortCircuit: true }
      : next(url, context);
  },
});
const { awaitSecureAvailability } = await import('../src/broker/availability.js');
beforeEach(() => {
  clock = reads = 0;
  timers = new Map();
  timerCalls = []; sockets = []; agents = []; requests = []; logs = [];
  options = { readCosts: [], handshakeCost: 0, httpCost: 0 };
  controller = new AbortController();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  globalThis.setTimeout = (callback, ms) => {
    const id = Symbol('owned timer');
    timerCalls.push(ms);
    timers.set(id, { callback, at: clock + ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
});
afterEach(() => {
  // Assert cleanup before restoring globals, even for expected RED assertions.
  const timerCount = timers.size;
  const unclosed = sockets.filter((socket) => !socket.destroyed).length;
  const liveAgents = agents.filter((agent) => !agent.destroyed).length;
  const listeners = getEventListeners(controller.signal, 'abort').length;
  Object.defineProperty(globalThis, 'performance', originalPerformance);
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  assert.equal(timerCount, 0, 'all exchange timers cleared');
  assert.equal(unclosed, 0, 'all owned sockets destroyed');
  assert.equal(liveAgents, 0, 'all HTTP agents destroyed');
  assert.equal(listeners, 0, 'all cancellation listeners detached');
  assert.equal(logs.some((line) => line.includes(token) || line.includes(record.channel.psk)), false);
});
after(() => { hooks.deregister(); delete globalThis.__readinessDeadlineUnit; });
const call = () => awaitSecureAvailability({
  lockFile: record.path, port: record.port, token,
  signal: controller.signal, logger: (line) => logs.push(line),
  launch() { assert.fail('a published ownership record must never launch another broker'); },
});
async function refuses(code) {
  await assert.rejects(call(), (error) => {
    assert.equal(error.message.includes(token) || error.message.includes(record.channel.psk), false);
    return error.code === code;
  });
}

test('authenticated readiness spends the remaining 150-second deadline, not the occupancy cap', async () => {
  options.readCosts = [50, 1200, 1300, 1400];
  options.handshakeCost = 20;
  options.httpCost = 30;
  assert.equal(await call(), record);
  assert.equal(reads, 4, 'initial read plus all three stable-record guards');
  assert.deepEqual(requests, ['/v1/ready']);
  assert.deepEqual(timerCalls, [1000, 148730, 147430]);
  assert.equal(clock, 4000);
});

test('initial ownership work is subtracted, never replaced by a fresh exchange budget', async () => {
  options.readCosts = [149500];
  options.handshakeCost = 20;
  assert.equal(await call(), record);
  assert.deepEqual(timerCalls, [500, 480, 480]);
});

test('a fast authenticated exchange receives the entire unspent budget with its TLS subcap intact', async () => {
  options.readCosts = [20];
  assert.equal(await call(), record);
  assert.deepEqual(timerCalls, [1000, 149980, 149980]);
});

for (const [phase, index, expectedRequests] of [
  ['initial ownership', 0, 0], ['pre-TLS ownership', 1, 0],
  ['pre-Authorization ownership', 2, 0], ['final ownership', 3, 1],
]) {
  test(`expiry during ${phase} refuses adoption and later phases`, async () => {
    options.readCosts[index] = 150000;
    await refuses('BROKER_STARTUP_TIMEOUT');
    assert.equal(reads, index + 1);
    assert.equal(requests.length, expectedRequests);
  });
  test(`cancellation during ${phase} refuses adoption and later phases`, async () => {
    options.abortRead = index;
    await refuses('BROKER_UNAVAILABLE');
    assert.equal(reads, index + 1);
    assert.equal(requests.length, expectedRequests);
  });
}

test('HTTP settlement at the original deadline cannot authorize final identity read or adoption', async () => {
  options.httpCost = 150000;
  await refuses('BROKER_STARTUP_TIMEOUT');
  assert.equal(reads, 3);
  assert.equal(requests.length, 1);
});

for (const [phase, index] of [['pre-TLS', 1], ['pre-Authorization', 2], ['final', 3]]) {
  test(`${phase} ownership replacement remains a conflict`, async () => {
    options.changedRead = index;
    await refuses('BROKER_INSTANCE_CONFLICT');
    assert.equal(reads, index + 1);
    assert.equal(requests.length, index === 3 ? 1 : 0);
  });
}

test('authenticated but mismatched lifecycle identity cannot be adopted', async () => {
  options.envelope = { instance: '3'.repeat(32) };
  await refuses('BROKER_INSTANCE_CONFLICT');
  assert.equal(reads, 4);
});

for (const remaining of [150000, 500]) {
  test(`credential-free occupancy retains its own cap with ${remaining}ms remaining`, async () => {
    options.absent = true;
    options.readCosts = [150000 - remaining];
    await refuses('BROKER_INSTANCE_CONFLICT');
    assert.deepEqual(timerCalls, [Math.min(1000, remaining)]);
    assert.equal(requests.length, 0);
  });
}
