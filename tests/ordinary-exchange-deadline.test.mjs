// TEST ONLY. Memory-only model of the ordinary authenticated local exchange: a
// synthetic protected ownership record, clock, TLS-PSK socket and HTTP reply, with
// no filesystem, credential, process or network access. Production CLI dispatch,
// exchange sequencing and deadline accounting execute unchanged.
// Traceability: opencode-session-continuation requirement "Automatic broker
// availability for normal MCP use". The measured Windows protected-read cost is
// modelled here; these units are proxies for real platform I/O and do not prove
// real TLS negotiation, native reads or the actual wire.
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';

const source = (path) => new URL(`../src/${path}`, import.meta.url).href;
const cliMain = source('cli/main.js');
const localClient = source('http/local-client.js');
const token = 'SYNTHETIC_CONTROL_VALUE';
const stateDir = '/synthetic/state';
const record = {
  schemaVersion: 2,
  path: '/synthetic/ownership',
  bytes: Buffer.from('synthetic protected identity'),
  port: 43189,
  pid: 4242,
  instance: '1'.repeat(32),
  channel: { protocol: 'tls-psk-v1', psk: '2'.repeat(64) },
};

let clock, timers, reads, sockets, agents, requests, output, scenario, controller;
const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

// Monotonic fake clock: due timers fire in order, including timers a callback
// creates, so a deadline or cancellation signal is observed at its own instant.
function advance(ms) {
  clock += ms;
  for (;;) {
    const due = [...timers]
      .filter((entry) => entry[1].at <= clock)
      .sort((left, right) => left[1].at - right[1].at)[0];
    if (due === undefined) return;
    timers.delete(due[0]);
    due[1].callback();
  }
}

const fake = {
  async read(path) {
    assert.equal(
      path === record.path || /broker\.lock$/.test(path),
      true,
      'the exchange reads a configured ownership record path',
    );
    const index = reads++;
    advance(scenario.readCosts[index] ?? 0);
    if (scenario.destroyedDuringRead === index) {
      assert.equal(
        sockets.at(-1)?.destroyed,
        true,
        'an owned socket is destroyed while its protected read is still pending',
      );
    }
    if (scenario.absent === true) return { absent: true };
    if (scenario.changedRead === index) return { ...record, bytes: Buffer.from('replacement') };
    return record;
  },
  credential: () => token,
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
      destroy() {
        this.destroyed = true;
      },
    });
    sockets.push(socket);
    queueMicrotask(() => {
      advance(scenario.handshakeCost ?? 0);
      socket.emit('connect');
      socket.emit('secureConnect');
    });
    return socket;
  },
  Agent: class {
    constructor() {
      this.destroyed = false;
      agents.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  },
  http(requestOptions, respond) {
    assert.equal(sockets.at(-1)?.destroyed, false, 'no Authorization byte leaves on a dead socket');
    assert.equal(requestOptions.host, '127.0.0.1');
    assert.equal(requestOptions.port, record.port);
    assert.equal(requestOptions.headers.authorization, `Bearer ${token}`);
    requests.push(requestOptions.path);
    const request = new EventEmitter();
    request.end = () =>
      queueMicrotask(() => {
        advance(scenario.httpCost ?? 0);
        const response = new EventEmitter();
        response.statusCode = scenario.httpStatus ?? 200;
        respond(response);
        const body = scenario.httpBody ?? {
          broker: { pid: record.pid, port: record.port },
          requests: [],
        };
        response.emit('data', Buffer.from(JSON.stringify(body)));
        response.emit('end');
      });
    return request;
  },
};
globalThis.__ordinaryExchange = fake;

const wrappers = {
  ownership:
    'export const readSecureOwnership = (...a) => globalThis.__ordinaryExchange.read(...a);',
  credentials:
    'export const readLocalCredential = async () => globalThis.__ordinaryExchange.credential();',
  store: [
    'export const loadPortableConfiguration = async () => ({ broker: { port: 43189 }, owners: [] });',
    'export const initializeState = async () => {};',
    'export const addOwner = async () => {};',
    'export const addOrigin = async () => {};',
  ].join('\n'),
  tls: 'export default { connect: (...a) => globalThis.__ordinaryExchange.tls(...a) };',
  http:
    'export default { Agent: globalThis.__ordinaryExchange.Agent, ' +
    'request: (...a) => globalThis.__ordinaryExchange.http(...a) };',
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL;
    const fromCli = parent === cliMain;
    const fromClient = parent === localClient;
    let key;
    if ((fromCli || fromClient) && specifier === '../state/ownership.js') key = 'ownership';
    if (fromCli && specifier === '../state/credentials.js') key = 'credentials';
    if (fromCli && specifier === '../state/store.js') key = 'store';
    if (fromClient && specifier === 'node:tls') key = 'tls';
    if (fromClient && specifier === 'node:http') key = 'http';
    return key === undefined
      ? next(specifier, context)
      : { url: `ordinary-exchange:${key}`, shortCircuit: true };
  },
  load(url, context, next) {
    if (!url.startsWith('ordinary-exchange:')) return next(url, context);
    return { format: 'module', source: wrappers[url.split(':')[1]], shortCircuit: true };
  },
});

const { run } = await import('../src/cli/main.js');
const { createSecureLocalClient } = await import('../src/http/local-client.js');

beforeEach(() => {
  clock = 0;
  reads = 0;
  timers = new Map();
  sockets = [];
  agents = [];
  requests = [];
  output = { stdout: '', stderr: '' };
  scenario = { readCosts: [], handshakeCost: 0, httpCost: 0 };
  controller = new AbortController();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  globalThis.setTimeout = (callback, ms) => {
    const id = Symbol('owned timer');
    timers.set(id, { callback, at: clock + Math.max(0, ms) });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
});
afterEach(() => {
  // Assert teardown before restoring globals so a refusal case still proves it.
  const pendingTimers = timers.size;
  const liveSockets = sockets.filter((socket) => !socket.destroyed).length;
  const liveAgents = agents.filter((agent) => !agent.destroyed).length;
  const listeners = getEventListeners(controller.signal, 'abort').length;
  Object.defineProperty(globalThis, 'performance', originalPerformance);
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  assert.equal(pendingTimers, 0, 'all exchange timers cleared');
  assert.equal(liveSockets, 0, 'all owned sockets destroyed');
  assert.equal(liveAgents, 0, 'all HTTP agents destroyed');
  assert.equal(listeners, 0, 'all cancellation listeners detached');
  for (const text of [output.stdout, output.stderr]) {
    assert.equal(text.includes(token), false, 'no credential in command output');
    assert.equal(text.includes(record.channel.psk), false, 'no channel key in command output');
  }
});
after(() => {
  hooks.deregister();
  delete globalThis.__ordinaryExchange;
});

function subject(timeoutMs = 20_000) {
  return createSecureLocalClient({ port: record.port, lockFile: record.path, token, timeoutMs });
}

async function status() {
  const stdout = {
    write(chunk) {
      output.stdout += String(chunk);
      return true;
    },
  };
  const stderr = {
    write(chunk) {
      output.stderr += String(chunk);
      return true;
    },
  };
  const code = await run(['status'], { stdout, stderr, env: { PROCEED_STATE_DIR: stateDir } });
  return { code, stdout: output.stdout, stderr: output.stderr };
}

async function refusal(work) {
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'the exchange must refuse rather than return a response');
  assert.equal(String(caught.message).includes(token), false, 'refusal text carries no credential');
  assert.equal(
    String(caught.message).includes(record.channel.psk),
    false,
    'refusal text carries no channel key',
  );
  return caught;
}

// The field failure: one ordinary command path performs three protected reads of
// about 11 seconds each on Windows, and the exchange's own budget must cover them.
test('ORDINARY-EXCHANGE: status completes when its protected reads cost the measured 33 seconds', async () => {
  scenario.readCosts = [11_000, 11_000, 11_000];
  scenario.handshakeCost = 20;
  scenario.httpCost = 30;
  const result = await status();
  assert.equal(
    result.code,
    0,
    `status must complete within one ordinary deadline; stderr=${JSON.stringify(result.stderr)} ` +
      `reads=${reads} requests=${requests.length} elapsed=${clock}ms`,
  );
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^Broker 4242 on port 43189\nNo requests\.\n$/);
  assert.ok(reads >= 3, `protected reads of this exchange were performed (${reads})`);
  assert.ok(clock >= 33_000, `protected-read time is charged to the deadline (${clock}ms)`);
  assert.deepEqual(requests, ['/v1/status'], 'exactly one authenticated exchange');
});

test('ORDINARY-EXCHANGE: a slow protected read before any socket still ends the exchange', async () => {
  scenario.readCosts = [25_000];
  const error = await refusal(() => subject().request('GET', '/v1/status'));
  assert.equal(error.code, 'BROKER_UNAVAILABLE');
  assert.equal(reads, 1);
  assert.equal(sockets.length, 0, 'no socket is opened after the caller deadline');
  assert.equal(requests.length, 0);
});

test('ORDINARY-EXCHANGE: a deadline spent by in-exchange reads refuses before any Authorization byte', async () => {
  scenario.readCosts = [0, 10_000, 20_000];
  scenario.destroyedDuringRead = 2;
  const error = await refusal(() => subject().request('GET', '/v1/status'));
  assert.equal(error.code, 'BROKER_UNAVAILABLE');
  assert.equal(reads, 3);
  assert.equal(requests.length, 0, 'the bearer authority is never sent');
});

test('ORDINARY-EXCHANGE: an unspent caller deadline still admits one authenticated exchange', async () => {
  const response = await subject().request('GET', '/v1/status');
  assert.equal(response.status, 200);
  assert.equal(reads, 3, 'initial read plus both stable-record comparisons');
  assert.deepEqual(requests, ['/v1/status']);
});

test('ORDINARY-EXCHANGE: ownership substitution during the exchange stays a conflict', async () => {
  scenario.changedRead = 2;
  const error = await refusal(() => subject().request('GET', '/v1/status'));
  assert.equal(error.code, 'BROKER_INSTANCE_CONFLICT');
  assert.equal(requests.length, 0, 'a replaced record never receives the bearer authority');
});

test('ORDINARY-EXCHANGE: a cancelled caller reads no record and opens no socket', async () => {
  controller.abort();
  const error = await refusal(() =>
    subject().request('GET', '/v1/status', undefined, {}, { signal: controller.signal }),
  );
  assert.equal(error.code, 'BROKER_UNAVAILABLE');
  assert.equal(reads, 0);
  assert.equal(sockets.length, 0);
  assert.equal(requests.length, 0);
});

test('ORDINARY-EXCHANGE: an absent ownership record refuses without a socket', async () => {
  scenario.absent = true;
  const error = await refusal(() => subject().request('GET', '/v1/status'));
  assert.equal(error.code, 'BROKER_UNAVAILABLE');
  assert.equal(reads, 1);
  assert.equal(sockets.length, 0);
  assert.equal(requests.length, 0);
});
