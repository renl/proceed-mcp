// TEST ONLY. Focused residual admission regressions in the existing bounded runner.
// Dependency hooks schedule faults, never supply production protection or TLS success.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import tls from 'node:tls';
import http from 'node:http';
import net from 'node:net';
import { profile, identity, listen, until } from './support/automatic-startup.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.versions.node, '24.22.2');
assert.equal(process.env.PROCEED_TEST_FIXTURES, '/fixtures');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
const baseline = new Set((await readdir('/proc')).filter((name) => /^\d+$/.test(name)));
const root = new URL('../', import.meta.url);
const source = (path) => new URL(path, root).href;
const realPerformance = globalThis.performance;
let offset = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => realPerformance.now() + offset },
});
const record = {
  schemaVersion: 2,
  path: '/fixtures/synthetic-lock',
  bytes: Buffer.from('synthetic-record'),
  port: 1,
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
let reads,
  probes,
  launches,
  exchanges,
  configurationReads,
  credentialReads,
  sockets,
  observed,
  read,
  probe,
  exchange,
  configRead,
  credentialRead;
const reset = () => {
  offset = 0;
  reads = probes = launches = exchanges = 0;
  configurationReads = credentialReads = 0;
  sockets = [];
  observed = {};
  read = async () => record;
  probe = () => 'refused';
  exchange = async ({ path }) =>
    path === '/v1/shutdown'
      ? { status: 202, body: { schema_version: 1, instance: record.instance, stopping: true } }
      : { status: 200, body: envelope() };
  configRead = async () => ({ broker: { port: record.port } });
  credentialRead = async () => 'SYNTHETIC_CONTROL';
};
reset();
globalThis.__startupAdmission = {
  read: (...args) => {
    reads++;
    return read(...args);
  },
  connect: (...args) => {
    const socket = tls.connect(...args);
    sockets.push(socket);
    return socket;
  },
  occupancy: () => {
    probes++;
    const socket = new EventEmitter();
    socket.destroy = () => {};
    queueMicrotask(() => {
      const result = probe();
      if (result === 'refused') socket.emit('error', { code: 'ECONNREFUSED' });
      else if (result === 'occupied') socket.emit('connect');
    });
    return socket;
  },
  probe: async (...args) => {
    probes++;
    return probe(...args);
  },
  exchange: async (...args) => {
    exchanges++;
    return exchange(...args);
  },
  config: (...args) => {
    configurationReads++;
    return configRead(...args);
  },
  credential: (...args) => {
    credentialReads++;
    return credentialRead(...args);
  },
};
const wrappers = {
  ownership: `export * from ${JSON.stringify(source('src/state/ownership.js') + '?actual')}; export const readSecureOwnership = (...a) => globalThis.__startupAdmission.read(...a);`,
  tls: 'import real from "node:tls"; export default {...real, connect: (...a) => globalThis.__startupAdmission.connect(...a)};',
  net: 'export const connect = (...a) => globalThis.__startupAdmission.occupancy(...a);',
  client: `export * from ${JSON.stringify(source('src/http/local-client.js') + '?actual')}; export const secureExchange = (...a) => globalThis.__startupAdmission.exchange(...a);`,
  availability: `export * from ${JSON.stringify(source('src/broker/availability.js') + '?actual')}; export const probeOccupancy = (...a) => globalThis.__startupAdmission.probe(...a);`,
  store: `export * from ${JSON.stringify(source('src/state/store.js') + '?actual')}; export const loadPortableConfiguration = (...a) => globalThis.__startupAdmission.config(...a);`,
  credentials: `export * from ${JSON.stringify(source('src/state/credentials.js') + '?actual')}; export const readLocalCredential = (...a) => globalThis.__startupAdmission.credential(...a);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? '';
    const client = parent.startsWith(source('src/http/local-client.js'));
    const availability = parent.startsWith(source('src/broker/availability.js'));
    const cli = parent === source('src/cli/main.js');
    let wrapper;
    if ((client || availability || cli) && specifier === '../state/ownership.js')
      wrapper = 'ownership';
    if (client && specifier === 'node:tls') wrapper = 'tls';
    if (availability && specifier === 'node:net') wrapper = 'net';
    if ((availability || cli) && specifier === '../http/local-client.js') wrapper = 'client';
    if (cli && specifier === '../broker/availability.js') wrapper = 'availability';
    if (cli && specifier === '../state/store.js') wrapper = 'store';
    if (cli && specifier === '../state/credentials.js') wrapper = 'credentials';
    return wrapper
      ? { url: `startup-admission:${wrapper}`, shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('startup-admission:'))
      return {
        format: 'module',
        source: wrappers[url.split(':')[1]],
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { secureExchange, createSecureLocalClient } = await import('../src/http/local-client.js');
const { awaitSecureAvailability } = await import('../src/broker/availability.js');
const { run } = await import('../src/cli/main.js');
const results = [];
const witnesses = [];
let cleanup = true;
const resources = new Set();
const watchdog = setTimeout(() => process.exit(1), 45000);
const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function check(id, work) {
  reset();
  await writeFile('/evidence/phase.json', JSON.stringify({ phase: id }));
  try {
    await work();
    results.push({ id, status: 'PASS' });
  } catch (error) {
    // Assertion diagnostics stay private. Export only this fixed failure class.
    results.push({ id, status: 'FAIL' });
    observed.assertionFailure = error?.code === 'ERR_ASSERTION';
  } finally {
    for (const socket of sockets) socket.destroy();
    witnesses.push({
      id,
      reads,
      probes,
      launches,
      exchanges,
      configurationReads,
      credentialReads,
      socketCount: sockets.length,
      ...observed,
    });
  }
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function peer({ handshake = true } = {}) {
  const connections = new Set();
  const plain = http.createServer((req, res) => {
    observed.httpRequests = (observed.httpRequests ?? 0) + 1;
    if (req.url === '/v1/shutdown') {
      assert.equal(req.method, 'POST');
      res.statusCode = 202;
      res.end(JSON.stringify({ schema_version: 1, instance: record.instance, stopping: true }));
    } else res.end(JSON.stringify(envelope()));
  });
  const server = handshake
    ? tls.createServer(
        {
          ...profile,
          pskCallback: (_socket, selector) =>
            selector === identity ? Buffer.from(record.channel.psk, 'hex') : null,
        },
        (socket) => {
          socket.disableRenegotiation();
          plain.emit('connection', socket);
        },
      )
    : net.createServer();
  server.on('tlsClientError', () => {});
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => connections.delete(socket));
  });
  record.port = await listen(server);
  const close = async () => {
    for (const socket of connections) socket.destroy();
    await new Promise((done) => server.close(done));
    await until(() => connections.size === 0, 1000, 'owned peer sockets close');
    assert.equal(connections.size, 0);
    resources.delete(close);
  };
  resources.add(close);
  return close;
}
const call = (options = {}) =>
  secureExchange({
    lock: record,
    token: 'SYNTHETIC_OWNER',
    method: 'GET',
    path: '/v1/ready',
    timeoutMs: 1000,
    ...options,
  });
async function stop() {
  return run(['stop', '--state-dir', '/fixtures/synthetic-state'], {
    env: {},
    stdout: { write() {} },
    stderr: { write() {} },
  });
}

try {
  await check('AUTO-INITIAL-READ-ABORT-ADMISSION', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createSecureLocalClient({
      port: 1,
      lockFile: record.path,
      token: 'SYNTHETIC_OWNER',
    });
    const outcome = await settled(
      client.request('GET', '/v1/status', undefined, {}, { signal: controller.signal }),
    );
    assert.ok(outcome.error);
    assert.equal(reads, 0, 'already-aborted operation must not start protected work');
  });
  await check('AUTO-INITIAL-READ-ORIGINAL-BUDGET', async () => {
    const close = await peer();
    read = async () => {
      if (reads === 1) {
        await delay(60);
        observed.slowRead = true;
      }
      return record;
    };
    const client = createSecureLocalClient({
      port: record.port,
      lockFile: record.path,
      token: 'SYNTHETIC_OWNER',
      timeoutMs: 20,
    });
    const outcome = await settled(client.request('GET', '/v1/status'));
    await close();
    assert.equal(observed.slowRead, true);
    assert.equal(sockets.length, 0, 'expired read must not admit TLS');
    assert.ok(outcome.error, 'initial read must consume original operation budget');
  });
  await check('AUTO-SECURE-EXCHANGE-POSITIVE-CONTROL', async () => {
    const close = await peer();
    const outcome = await call();
    await close();
    assert.equal(outcome.status, 200);
    assert.equal(observed.httpRequests, 1);
    assert.equal(reads, 3, 'all three protected-read boundaries observed');
    assert.equal(sockets.length, 1);
  });
  await check('AUTO-HANDSHAKE-CANCELLATION-SOCKET', async () => {
    const close = await peer({ handshake: false });
    const controller = new AbortController();
    const outcome = settled(call({ signal: controller.signal }));
    await until(() => sockets.length === 1, 500, 'real socket exists');
    controller.abort();
    await delay(30);
    observed.destroyedBeforeHandshakeTimeout = sockets[0].destroyed;
    sockets[0].destroy();
    await outcome;
    await close();
    assert.equal(observed.destroyedBeforeHandshakeTimeout, true);
  });
  for (const window of ['post-handshake', 'final-ready']) {
    for (const cause of ['cancel', 'deadline']) {
      await check(`AUTO-READ-WINDOW-${window.toUpperCase()}-${cause.toUpperCase()}`, async () => {
        const close = await peer();
        const gate = deferred();
        const entered = deferred();
        const controller = new AbortController();
        read = async () => {
          if (reads === (window === 'post-handshake' ? 2 : 3)) {
            entered.resolve();
            await gate.promise;
          }
          return record;
        };
        const outcome = settled(
          call({ timeoutMs: cause === 'deadline' ? 100 : 1000, signal: controller.signal }),
        );
        await Promise.race([
          entered.promise,
          delay(1000).then(() => {
            throw Error('read hook inactive');
          }),
        ]);
        observed.pendingRead = true;
        if (cause === 'cancel') controller.abort();
        await delay(cause === 'deadline' ? 130 : 30);
        observed.destroyedWhileReadPending = sockets[0].destroyed;
        const before = observed.httpRequests ?? 0;
        gate.resolve();
        const result = await outcome;
        await close();
        assert.ok(result.error, 'uncancellable read cannot authorize later success');
        assert.equal(observed.httpRequests ?? 0, before, 'no later HTTP authority');
        assert.equal(
          observed.destroyedWhileReadPending,
          true,
          'actual socket must close while read is pending',
        );
      });
    }
  }
  // Synchronous JSON parsing can cross the deadline before a timer gets a turn.
  // Block only the parsing callback so the real absolute timer cannot run yet.
  for (const cause of ['deadline', 'cancel']) {
    for (const path of ['/v1/ready', '/v1/status', '/v1/shutdown']) {
      await check(
        `AUTO-FINAL-HTTP-FENCE-${path.split('/').at(-1).toUpperCase()}-${cause.toUpperCase()}`,
        async () => {
          const close = await peer();
          const controller = new AbortController();
          const parse = JSON.parse;
          JSON.parse = function (text, ...args) {
            const value = parse(text, ...args);
            if (value?.service === 'proceed-mcp' || value?.stopping === true) {
              if (cause === 'deadline')
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
              else controller.abort();
              observed.parseExpired = true;
            }
            return value;
          };
          let outcome;
          try {
            outcome = await settled(
              call({
                path,
                timeoutMs: 200,
                signal: controller.signal,
                ...(path === '/v1/shutdown'
                  ? { method: 'POST', body: { instance: record.instance } }
                  : {}),
              }),
            );
          } finally {
            JSON.parse = parse;
            await close();
          }
          assert.equal(observed.parseExpired, true);
          assert.equal(reads, 2, 'expired completion must not admit final protected read');
          assert.ok(outcome.error, 'late response must not return success');
        },
      );
    }
  }
  for (const phase of ['record', 'occupancy', 'absence-recheck', 'readiness']) {
    await check(`AUTO-AVAILABILITY-CANCEL-${phase.toUpperCase()}`, async () => {
      const controller = new AbortController();
      read = async () => {
        if (phase === 'record' || (phase === 'absence-recheck' && reads === 2)) controller.abort();
        return phase === 'readiness' ? record : { absent: true };
      };
      probe = () => {
        if (phase === 'occupancy') controller.abort();
        return 'refused';
      };
      exchange = async () => {
        controller.abort();
        return { status: 200, body: envelope() };
      };
      const outcome = await settled(
        awaitSecureAvailability({
          lockFile: record.path,
          port: 1,
          token: 'SYNTHETIC_OWNER',
          signal: controller.signal,
          budgetMs: 50,
          launch: () => {
            launches++;
          },
        }),
      );
      assert.equal(controller.signal.aborted, true, 'selected await actually cancels');
      assert.ok(outcome.error, 'cancelled readiness cannot be adopted');
      assert.equal(launches, 0, 'cancelled attempt cannot launch');
      if (phase === 'record') assert.equal(probes, 0, 'cancelled read cannot admit occupancy');
      if (phase === 'occupancy')
        assert.equal(reads, 1, 'cancelled occupancy cannot admit another read');
    });
  }
  await check('AUTO-AVAILABILITY-POSITIVE-CONTROL', async () => {
    const result = await awaitSecureAvailability({
      lockFile: record.path,
      port: 1,
      token: 'SYNTHETIC_OWNER',
      budgetMs: 100,
    });
    assert.equal(result, record);
    assert.equal(reads, 1);
    assert.equal(exchanges, 1);
  });
  for (const phase of [
    'configuration',
    'credential',
    'initial-record',
    'readiness',
    'shutdown',
    'final-record',
    'final-probe',
  ]) {
    await check(`AUTO-STOP-WHOLE-BUDGET-${phase.toUpperCase()}`, async () => {
      const expire = () => {
        offset += 31000;
        observed.expiredAtSelectedPhase = true;
      };
      configRead = async () => {
        if (phase === 'configuration') expire();
        return { broker: { port: 1 } };
      };
      credentialRead = async () => {
        if (phase === 'credential') expire();
        return 'SYNTHETIC_CONTROL';
      };
      read = async () => {
        if (
          (phase === 'initial-record' && reads === 1) ||
          (phase === 'final-record' && reads === 2)
        )
          expire();
        return reads === 1 ? record : { absent: true };
      };
      exchange = async ({ path }) => {
        if (
          (phase === 'readiness' && path === '/v1/ready') ||
          (phase === 'shutdown' && path === '/v1/shutdown')
        )
          expire();
        return path === '/v1/ready'
          ? { status: 200, body: envelope() }
          : { status: 202, body: { schema_version: 1, instance: record.instance, stopping: true } };
      };
      probe = () => {
        if (phase === 'final-probe') expire();
        return 'refused';
      };
      const code = await stop();
      observed.exitCode = code;
      assert.equal(observed.expiredAtSelectedPhase, true, 'clock fault reached');
      assert.equal(code, 3, 'expired whole stop must refuse, not succeed');
      if (phase === 'configuration') assert.equal(credentialReads, 0);
      if (['configuration', 'credential'].includes(phase)) assert.equal(reads, 0);
      if (phase === 'initial-record') assert.equal(exchanges, 0);
      if (phase === 'readiness') assert.equal(exchanges, 1);
      if (phase === 'shutdown') assert.equal(reads, 1);
      if (phase === 'final-record') assert.equal(probes, 0);
    });
  }
  await check('AUTO-STOP-ABSENT-EXPIRED-READ-NO-PROBE', async () => {
    read = async () => {
      offset += 31000;
      observed.expiredRead = true;
      return { absent: true };
    };
    const code = await stop();
    observed.exitCode = code;
    assert.equal(observed.expiredRead, true);
    assert.equal(probes, 0, 'expired absence read cannot admit occupancy');
    assert.equal(code, 3, 'late already-stopped observation is not success');
  });
  await check('AUTO-STOP-ABSENT-PROBE-REMAINING-BUDGET', async () => {
    read = async () => {
      offset += 29500;
      return { absent: true };
    };
    probe = (_port, options) => {
      observed.probeBudget = options?.timeoutMs ?? -1;
      return 'refused';
    };
    assert.equal(await stop(), 0);
    assert.ok(
      observed.probeBudget > 0 && observed.probeBudget <= 500,
      'probe capped by actual remaining time',
    );
  });
  await check('AUTO-STOP-POSITIVE-CONTROL', async () => {
    read = async () => (reads === 1 ? record : { absent: true });
    assert.equal(await stop(), 0);
    assert.equal(reads, 2);
    assert.equal(exchanges, 2);
    assert.equal(probes, 1);
  });
} finally {
  for (const close of resources) {
    try {
      await close();
    } catch {
      cleanup = false;
    }
  }
  hooks.deregister();
  delete globalThis.__startupAdmission;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: realPerformance });
  clearTimeout(watchdog);
  await delay(30);
  const extra = (await readdir('/proc')).filter(
    (name) => /^\d+$/.test(name) && !baseline.has(name),
  );
  cleanup &&= extra.length === 0 && resources.size === 0;
  await writeFile('/evidence/admission-witnesses.json', JSON.stringify(witnesses));
  const summary = {
    assertions: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
    cleanup: cleanup ? 'PASS' : 'UNVERIFIED',
    results,
  };
  console.log(JSON.stringify(summary));
  process.exitCode = summary.assertions === 'PASS' && cleanup ? 0 : 1;
}
