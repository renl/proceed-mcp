// Native controls verify the scanner and W3 test completeness, NOT real TLS proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
import { exchangeProblem } from '../src/harness/helper-operations.js';
import {
  scanRequiredCaptures,
  transportFixtureOwner,
} from './support/harness-transport-fixtures.mjs';
import {
  transportDiagnostic,
  assertTransportDiagnostic,
  diagnosticExport,
  assertDetailedTransportExport,
  assertRuntimeRoleOutcome,
  assertIntegratedTransportGate,
  transportExpectations,
} from './support/harness-runtime-transport.mjs';
import {
  failureSnapshot,
  safeCompositionDiagnostic,
  admitIntegratedPrivateInventory,
} from './support/harness-composition-retention.mjs';
import { privateCaptureWriter } from './support/harness-transparent-capture.mjs';

// Event IO only: execute the maintained real-fixture owner without a listener,
// socket, filesystem fixture, service or wall-clock wait.
function closeControl() {
  let clock = 0;
  const timers = new Map();
  const owner = transportFixtureOwner({
    deadline: 100,
    now: () => clock,
    schedule: (fn, ms) => {
      const key = {};
      timers.set(key, { fn, at: clock + ms });
      return key;
    },
    cancel: (key) => timers.delete(key),
  });
  return {
    owner,
    at(value) {
      clock = value;
      for (const [key, timer] of [...timers])
        if (timer.at <= clock && timers.delete(key)) timer.fn();
    },
    socket(closed = false) {
      const socket = new EventEmitter();
      socket.closed = closed;
      socket.destroys = 0;
      socket.destroy = () => {
        socket.destroys++;
      };
      owner.own(socket);
      return socket;
    },
    server(listening = true) {
      const server = new EventEmitter();
      server.listening = listening;
      server.calls = 0;
      server.close = (done) => {
        server.calls++;
        server.done = done;
      };
      owner.server(server);
      return server;
    },
  };
}
const flushClose = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};

test('fixture close waits for accepted TCP and secure TLS close events after listener callbacks', async () => {
  const c = closeControl(),
    tcp = c.socket(),
    secure = c.socket(),
    server = c.server();
  c.owner.own(tcp); // Same identity is neither waited nor destroyed twice.
  let settled = false,
    seals = 0;
  const closing = c.owner.close();
  closing.then(() => {
    settled = true;
    seals++;
  });
  assert.strictEqual(c.owner.close(), closing);
  assert.equal(c.owner.active, false);
  server.done();
  await flushClose();
  assert.equal(settled, false);
  tcp.emit('close');
  await flushClose();
  assert.equal(seals, 0);
  secure.emit('close');
  await closing;
  assert.equal(seals, 1);
  assert.equal(tcp.destroys, 1);
  assert.equal(secure.destroys, 1);
  assert.equal(server.calls, 1);
  assert.strictEqual(c.owner.close(), closing);
});

test('fixture close fences callbacks and waits for accepted async work before allowing seals', async () => {
  const c = closeControl(),
    socket = c.socket();
  let release,
    calls = 0,
    seals = 0;
  const task = c.owner.task(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await flushClose();
  c.owner.later(() => {
    calls++;
  }, 1);
  const closing = c.owner.close();
  closing.then(() => {
    seals++;
  });
  socket.emit('close');
  await flushClose();
  assert.equal(seals, 0);
  await c.owner.task(() => {
    calls++;
  });
  c.at(1);
  assert.equal(calls, 0);
  release();
  await task;
  await closing;
  assert.equal(seals, 1);
});

test('fixture close preserves callback first failure across retries, deadline and late callbacks', async () => {
  const c = closeControl(),
    socket = c.socket(),
    server = c.server();
  const closing = c.owner.close();
  server.done(Object.assign(Error('/private/raw-secret'), { code: 'RAW_SECRET' }));
  await flushClose();
  c.at(100);
  const error = await closing.catch((error) => error);
  assert.equal(error.code, 'FIXTURE_LISTENER_CLOSE');
  assert.equal(error.message, 'FIXTURE_LISTENER_CLOSE');
  assert.strictEqual(c.owner.close(), closing);
  assert.strictEqual(await c.owner.close().catch((error) => error), error);
  socket.emit('close');
  server.done();
  await flushClose();
  assert.strictEqual(await closing.catch((error) => error), error);
  assert.equal(socket.destroys, 1);
});

test('fixture close refuses ignoring destroy, missing callback and exact deadline without renewal', async () => {
  for (const kind of ['socket', 'callback', 'task', 'edge']) {
    const c = closeControl();
    if (kind === 'socket') c.socket();
    if (kind === 'callback') c.server();
    if (kind === 'task') {
      c.owner.task(() => new Promise(() => {}));
      await flushClose();
    }
    if (kind === 'edge') c.at(100);
    const closing = c.owner.close();
    c.at(100);
    await assert.rejects(closing, { code: 'FIXTURE_CLOSE_DEADLINE' });
    c.at(1000);
    assert.strictEqual(c.owner.close(), closing);
  }
});

test('fixture close handles source-observed already closed and never-listening cases only', async () => {
  for (const kind of ['never', 'closed', 'live']) {
    const c = closeControl(),
      socket = c.socket(true),
      server = c.server(kind !== 'never');
    if (kind === 'closed') server.emit('close');
    const closing = c.owner.close();
    server.done(Object.assign(Error('not exported'), { code: 'ERR_SERVER_NOT_RUNNING' }));
    if (kind === 'live') await assert.rejects(closing, { code: 'FIXTURE_LISTENER_CLOSE' });
    else await closing;
    assert.equal(socket.destroys, 0);
  }
});

test('fixture close owns aborted and late accepted identities without permitting activity', async () => {
  const c = closeControl(),
    socket = c.socket();
  socket.emit('close');
  const server = c.server();
  const closing = c.owner.close();
  const late = c.socket();
  assert.equal(c.owner.own(late), false);
  assert.equal(late.destroys, 1);
  server.done();
  let settled = false;
  closing.then(() => {
    settled = true;
  });
  await flushClose();
  assert.equal(settled, false);
  late.emit('close');
  await closing;
  assert.equal(socket.destroys, 0);
});

test('fixture close settles pending listener startup before its close callback without a new budget', async () => {
  const c = closeControl(),
    server = new EventEmitter();
  let started;
  server.listen = (_port, _host, done) => {
    started = done;
  };
  server.address = () => ({ port: 1 });
  server.close = (done) => {
    server.done = done;
  };
  const starting = c.owner.listen(server);
  await flushClose();
  const closing = c.owner.close();
  assert.equal(server.done, undefined);
  server.emit('listening');
  started();
  await starting;
  await flushClose();
  assert.equal(typeof server.done, 'function');
  server.done();
  await closing;
});

test('fixture close waits for already aborted in-flight sockets and retains task or sync callback failures', async () => {
  const c = closeControl(),
    socket = c.socket();
  socket.destroyed = true;
  const closing = c.owner.close();
  let settled = false;
  closing.then(() => {
    settled = true;
  });
  await flushClose();
  assert.equal(settled, false);
  assert.equal(socket.destroys, 0);
  socket.emit('close');
  await closing;
  for (const kind of ['task', 'sync']) {
    const c = closeControl();
    if (kind === 'task') {
      await c.owner
        .task(() => {
          throw Error('private');
        })
        .catch(() => {});
    } else {
      const server = c.server();
      server.close = () => {
        throw Error('private');
      };
    }
    const closing = c.owner.close();
    await assert.rejects(closing, {
      code: kind === 'task' ? 'FIXTURE_TASK_CLOSE' : 'FIXTURE_LISTENER_CLOSE',
    });
    assert.strictEqual(c.owner.close(), closing);
  }
});

test('fixture close actual composition collection and finally preserve first refusal and block producer seals', async () => {
  const source = await readFile(
    new URL('./support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const collection = source.slice(
    source.indexOf("collectionStage('LISTENER_CLOSE');"),
    source.indexOf("collectionStage('PROCESS_ABSENCE');"),
  );
  const finalizer = source.slice(
    source.indexOf('if (!controlsClosed) {'),
    source.indexOf('\n      }\n    },', source.indexOf('if (!controlsClosed) {')),
  );
  assert.ok(collection.includes('await controls.close()'));
  assert.ok(finalizer.includes('CAPTURE_SCAN_REFUSED'));
  for (const first of ['LISTENER_CLOSE', 'PRODUCER_CLOSE', 'SEAL_RECEIPT']) {
    const c = closeControl(),
      server = c.server();
    const closing = c.owner.close();
    server.done(Error('raw secret and private path'));
    await closing.catch(() => {});
    let seals = 0;
    const context = {
      controls: { close: c.owner.close },
      controlsClosed: false,
      integratedScenario: true,
      h: {
        finalizeCapture: () => {
          seals++;
        },
      },
      collectionStage: () => {},
      scanStatus: 'REFUSED',
      scanReason: first,
      compositionScanReason: (_error, stage) => stage,
    };
    await assert.rejects(runInNewContext(`(async () => { ${collection} })()`, context), {
      code: 'FIXTURE_LISTENER_CLOSE',
    });
    assert.equal(seals, 0);
    await assert.rejects(runInNewContext(`(async () => { ${finalizer} })()`, context), {
      code: 'CAPTURE_SCAN_REFUSED',
    });
    assert.equal(context.scanReason, first);
    const safe = safeCompositionDiagnostic({
      rawScan: context.scanStatus,
      scanReason: context.scanReason,
    });
    assert.equal(safe.scanReason, first);
    assert.equal(JSON.stringify(safe).includes('raw secret'), false);
    assert.equal(server.calls, 1);
  }
});

test('fixture close actual consumers reuse their existing lifetime without changing close signatures', async () => {
  for (const name of ['harness-composition-inner.mjs', 'harness-transport-inner.mjs']) {
    const source = await readFile(new URL(`./support/${name}`, import.meta.url), 'utf8');
    assert.match(source, /transportFixtures\(h, \{ deadline: end \}\)/);
    assert.match(source, /(?:controls|fixture)\.close\(\)/);
    assert.doesNotMatch(source, /(?:controls|fixture)\.close\(\s*\{/);
  }
});

test('W3 enrolled failure retains typed cause before the assertion and export refusal', () => {
  const secret = 'hop_' + 'c'.repeat(64);
  const error = Object.assign(new Error(secret), {
    name: 'SecureChannelError',
    code: 'BROKER_INSTANCE_CONFLICT',
    cause: { code: 'ECONNRESET' },
  });
  let retained;
  assert.throws(
    () =>
      assertRuntimeRoleOutcome('enrolled', undefined, error, 21, (state, caught) => {
        retained = transportDiagnostic(caught, state, {
          bun: '1.3.2',
          node: '24.3.0',
          openssl: '3.0.18',
        });
      }),
    { code: 'ERR_ASSERTION' },
  );
  assert.equal(retained.phase, 'exchange');
  assert.deepEqual(
    retained.chain.map((item) => item.code),
    ['BROKER_INSTANCE_CONFLICT', 'ECONNRESET'],
  );
  assert.doesNotThrow(() => diagnosticExport(retained, [secret]));
  assert.throws(() => assertDetailedTransportExport(undefined));
});

test('W3 diagnostic retains only fixed case/phase/codes and bounded runtime identity', () => {
  const secrets = [
    'hop_' + 'a'.repeat(64),
    'owner-secret',
    'psk-' + 'b'.repeat(64),
    '/private/secret-path',
  ];
  const malicious = Object.assign(new Error(secrets.join(' ')), {
    name: 'SecureChannelError',
    code: 'BROKER_INSTANCE_CONFLICT',
    stack: secrets.join(' '),
    request: { headers: { Authorization: secrets[0] } },
    cause: Object.assign(new Error(secrets[1]), {
      code: secrets[2],
      cause: { name: 'TypeError', code: 'ERR_NOT_IMPLEMENTED' },
    }),
  });
  const value = transportDiagnostic(
    malicious,
    { case: 'enrolled', phase: 'exchange', elapsed_ms: 123.7 },
    { bun: '1.3.2', node: '24.3.0', openssl: '3.0.18', secret: secrets[0] },
  );
  assertTransportDiagnostic(value);
  assert.equal(value.case, 'enrolled');
  assert.equal(value.phase, 'exchange');
  assert.equal(value.elapsed_ms, 124);
  assert.deepEqual(
    value.chain.map((e) => e.code),
    ['BROKER_INSTANCE_CONFLICT', 'REDACTED', 'ERR_NOT_IMPLEMENTED'],
  );
  assert.deepEqual(value.runtime, { bun: '1.3.2', node: '24.3.0', openssl: '3.0.18' });
  const bytes = diagnosticExport(value, secrets);
  for (const secret of secrets) assert.equal(bytes.includes(secret), false);
  assert.equal(bytes.includes('Authorization'), false);
  assert.equal(bytes.includes('stack'), false);
  assert.throws(() => diagnosticExport(value, []));
  assert.throws(() => diagnosticExport(value, ['BROKER_INSTANCE_CONFLICT']));
  assert.throws(() => diagnosticExport({ ...value, message: secrets[0] }, secrets));
  assert.throws(() =>
    diagnosticExport({ ...value, chain: [{ name: 'Error', code: secrets[0] }] }, secrets),
  );
});

test('W3 diagnostic traversal is bounded, ignores accessors and redacts unknown metadata', () => {
  const cyclic = { name: 'Error', code: 'ECONNRESET' };
  cyclic.cause = cyclic;
  assert.equal(transportDiagnostic(cyclic).chain.length, 1);
  let deep = cyclic;
  for (let i = 0; i < 20; i++) deep = { code: 'ETIMEDOUT', cause: deep };
  assert.equal(transportDiagnostic(deep).chain.length, 4);
  const trap = Object.defineProperties(
    {},
    {
      code: {
        get() {
          throw Error('must not read');
        },
      },
      cause: {
        get() {
          throw Error('must not read');
        },
      },
    },
  );
  const value = transportDiagnostic(
    trap,
    { case: 'operator-secret', phase: '/private/path', elapsed_ms: Infinity },
    { bun: 'secret', node: '24.0.0/secret', openssl: undefined },
  );
  assert.equal(value.case, 'REDACTED');
  assert.equal(value.phase, 'REDACTED');
  assert.equal(value.elapsed_ms, 0);
  assert.deepEqual(value.runtime, { bun: null, node: null, openssl: null });
  assert.deepEqual(value.chain, [{ name: 'REDACTED', code: 'REDACTED' }]);
  assert.equal(
    transportDiagnostic(null, { case: 'enrolled', phase: 'response-assertion' }).classification,
    'FIRST_EXCHANGE_PASS',
  );
});

test('W3 safe diagnostic does not authorize detailed export without required raw scan', () => {
  const diagnostic = transportDiagnostic(
    { code: 'BROKER_INSTANCE_CONFLICT' },
    { case: 'enrolled', phase: 'exchange' },
  );
  assert.doesNotThrow(() => diagnosticExport(diagnostic, ['synthetic-private-authority']));
  for (const marker of [undefined, null, {}, { status: 'FAIL' }, { status: 'SKIPPED' }])
    assert.throws(() => assertDetailedTransportExport(marker));
  assert.doesNotThrow(() => assertDetailedTransportExport({ status: 'PASS' }));
});

test('W3 raw scanner fails closed on missing, malformed or leaking complete capture', () => {
  const surfaces = ['tui', 'telegram', 'journal', 'diagnostics', 'evidence'];
  const safe = Object.fromEntries(surfaces.map((s) => [s, Buffer.from('safe complete bytes')]));
  assert.equal(scanRequiredCaptures(safe, ['private-marker'], surfaces).status, 'PASS');
  for (const surface of surfaces) {
    const missing = { ...safe };
    delete missing[surface];
    assert.throws(
      () => scanRequiredCaptures(missing, ['private-marker'], surfaces),
      /missing raw capture/,
    );
    assert.throws(() =>
      scanRequiredCaptures(
        { ...safe, [surface]: 'not a raw buffer' },
        ['private-marker'],
        surfaces,
      ),
    );
    assert.throws(
      () =>
        scanRequiredCaptures(
          { ...safe, [surface]: Buffer.from('prefix private-marker suffix') },
          ['private-marker'],
          surfaces,
        ),
      /authority leaked/,
    );
  }
});

test('W3 maintained composition uses actual product loader/operator client and fail-closed export', async () => {
  const helper = await readFile(
    new URL('./support/harness-runtime-transport.mjs', import.meta.url),
    'utf8',
  );
  assert.match(helper, /loadOperatorKeyFile/);
  assert.match(helper, /runHelperExchange/);
  assert.doesNotMatch(helper, /createOperatorLocalClient|createSecureLocalClient/);
  const fixtures = await readFile(
    new URL('./support/harness-transport-fixtures.mjs', import.meta.url),
    'utf8',
  );
  for (const id of [
    'limit-exact',
    'limit-over',
    'original-budget',
    'handshake-stall',
    'abort',
    'reconnect',
    'record-next',
    'record-during',
    'relay',
    'redirect',
  ])
    assert.ok(fixtures.includes(`'${id}'`));
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(runner.indexOf('scan-pass.json') < runner.indexOf("'transport-summary.json'"));
  assert.match(runner, /created && !transport/);
});

test('actual transport fixture calls production helper adapter before integrated decisions, using exact private protocol inputs', async () => {
  const supportSource = await readFile(
    new URL('./support/harness-runtime-transport.mjs', import.meta.url),
    'utf8',
  );
  const fixtureSource = await readFile(
    new URL('./fixtures/harness-transport/tui.ts', import.meta.url),
    'utf8',
  );
  const calls = [],
    files = new Map();
  const roles = {
    schema_version: 1,
    cases: Object.keys(transportExpectations).map((id, n) => ({
      id,
      port: 20000 + n,
      key_file: `/run/proceed/qualification-private/role-${id}/key`,
      lock_file: `/run/proceed/qualification-private/role-${id}/broker.lock`,
      body: {
        harness_id: 'qualification',
        owner_id: id === 'foreign' ? 'foreign' : 'shared',
        session_id: 'transport-session',
      },
    })),
  };
  const product = {
    key_file: '/run/proceed/qualification-private/operator/key',
    state_dir: '/run/proceed/host-state',
    controls: [],
    rejected_keys: [],
  };
  const credential = 'hop_' + '1'.repeat(64);
  const support = runInNewContext(
    supportSource
      .replace(/^import .*;$/gm, '')
      .replaceAll("await import('../../src/harness/operator-key.js')", '__keyLoader')
      .replaceAll('export ', '') +
      '\n({exerciseRuntimeTransport,exerciseProductTransport,transportDiagnostic})',
    {
      assert: {
        ...assert,
        deepEqual: (a, b, message) =>
          assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message),
      },
      Buffer,
      dirname,
      AbortSignal,
      AbortController,
      setTimeout,
      clearTimeout,
      performance,
      process: {
        platform: 'linux',
        geteuid: () => 1000,
        versions: { node: '24.22.2', bun: '1.4.4' },
      },
      lstat: async (path) => ({
        isDirectory: () => !path.endsWith('/key'),
        isFile: () => path.endsWith('/key'),
        isSymbolicLink: () => false,
        mode: path.endsWith('/key') ? 0o600 : 0o700,
        uid: 1000,
        nlink: 1,
      }),
      readFile: async () => 'not-an-operator-token',
      __keyLoader: { loadOperatorKeyFile: async () => ({ credential }) },
      runHelperExchange: async (input) => {
        const c = roles.cases.find((v) => v.port === input.port);
        assert.ok(c);
        calls.push(c.id);
        const frame = {
          schema_version: 1,
          type: 'exchange',
          exchange_id: '0'.repeat(32),
          port: input.port,
          lock_file: input.lockFile,
          operator_credential: input.operatorCredential,
          operation: input.operation,
          presentation_id: null,
          body: input.body,
        };
        const problem = exchangeProblem(frame, frame.exchange_id);
        if (['owner', 'control'].includes(c.id)) {
          assert.notEqual(problem, null);
          throw Object.assign(Error('closed local refusal'), { code: 'HELPER_PROTOCOL_INVALID' });
        }
        assert.equal(problem, null);
        assert.equal(input.signal.aborted, false);
        assert.equal(input.lockFile, c.lock_file);
        const [status, code] = transportExpectations[c.id];
        if (status === null) throw Object.assign(Error('closed local refusal'), { code });
        return {
          status,
          body: code ? { error: { code } } : { schema_version: 1, presentation: null },
        };
      },
    },
  );
  const fixture = runInNewContext(
    fixtureSource.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', ''),
    {
      Plugin: { define: (v) => v },
      ...support,
      AbortController,
      setTimeout,
      clearTimeout,
      readFile: async () => JSON.stringify({ roles, product }),
      writeFile: async (path, bytes) => files.set(path, JSON.parse(bytes)),
    },
  );
  const cleanup = await fixture.setup({
    app: { version: '2.2.5' },
    options: {
      cases_file: '/run/proceed/qualification-private/cases.json',
      evidence_directory: '/run/proceed/evidence',
    },
    ui: { toast: { show() {} } },
  });
  const result = files.get('/run/proceed/evidence/runtime-transport.json');
  assert.notEqual(result.status, 'FAIL');
  assert.deepEqual(calls, Object.keys(transportExpectations));
  await assertIntegratedTransportGate(
    JSON.parse(JSON.stringify(result)),
    [...calls, 'product-loader-unsafe-files'],
    async () => {},
  );
  await cleanup();
  assert.equal(files.get('/run/proceed/evidence/transport-cleanup.json').timerCleared, true);
  const inner = await readFile(
    new URL('./support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    inner.indexOf('await assertIntegratedTransportGate(') <
      inner.indexOf('await integratedWire.beginScenario()'),
  );
  assert.ok(
    inner.indexOf('await integratedWire.beginScenario()') <
      inner.indexOf('await compositionIntegratedScenario('),
  );
});

test('integrated gate forwards only fixed case/category, never assertion operands or credentials', async () => {
  const secret = 'hop_' + 'a'.repeat(64);
  const diagnostic = transportDiagnostic(
    { code: 'ERR_ASSERTION' },
    { case: 'record-next', phase: 'record-assertion' },
  );
  let caught;
  await assert.rejects(
    assertIntegratedTransportGate({ status: 'FAIL', diagnostic, message: secret }, [], async () => {
      throw Error(secret);
    }),
    (error) => {
      caught = error;
      return true;
    },
  );
  const snap = failureSnapshot({
    error: caught,
    phase: 'integrated-transport-outcomes',
    keys: {},
    state: {},
    now: 0,
    deadline: 1,
  });
  const forwarded = safeCompositionDiagnostic({ status: 'FAIL', failureAt: snap });
  assert.equal(forwarded.failureAt.transport.case, 'record-next');
  assert.equal(forwarded.failureAt.transport.phase, 'record-assertion');
  assert.equal(forwarded.failureAt.transport.check, 'transport-status');
  assert.equal(JSON.stringify(forwarded).includes(secret), false);
});

test('private inventory requires real writer receipts even for zero bytes and never substitutes missing writers', () => {
  const empty = Buffer.alloc(0);
  const seal = () => {
    const w = privateCaptureWriter();
    w.written(empty);
    return w.seal();
  };
  const captures = new Map(
    ['mcp.jsonl', 'wrapper.jsonl', 'composition-public-api.jsonl'].map((n) => [n, empty]),
  );
  const seals = {
    mcp: seal(),
    callbacks: seal(),
    api: { api: seal(), actionSequence: 0, serviceInventoryWritten: false },
  };
  assert.doesNotThrow(() => admitIntegratedPrivateInventory(captures, seals));
  for (const name of captures.keys()) {
    const missing = new Map(captures);
    missing.delete(name);
    assert.throws(() => admitIntegratedPrivateInventory(missing, seals));
  }
  for (const change of [{ actionSequence: 1 }, { serviceInventoryWritten: true }])
    assert.throws(() =>
      admitIntegratedPrivateInventory(captures, { ...seals, api: { ...seals.api, ...change } }),
    );
  const w = privateCaptureWriter();
  w.failed();
  assert.throws(() => admitIntegratedPrivateInventory(captures, { ...seals, mcp: w.seal() }));
  const over = privateCaptureWriter(0);
  assert.throws(() => over.written(Buffer.from('x')));
  assert.equal(over.seal().complete, false);
});

test('actual capture quiescence closes broker and Telegram writers before collection, without claiming scenario or product cleanup success', async () => {
  const source = await readFile(new URL('./support/portable-waiting.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async stopCaptureWriters() {');
  const end = source.indexOf('\n                },', start);
  assert.ok(start > 0 && end > start);
  const order = [];
  const broker = {
    closed: false,
    child: { stdout: { readableEnded: false }, stderr: { readableEnded: false } },
  };
  const close = runInNewContext('({' + source.slice(start, end) + '\n}}).stopCaptureWriters', {
    assert,
    connectAdapter: false,
    broker,
    stopped: async (resource) => {
      order.push('broker');
      resource.closed = true;
      resource.child.stdout.readableEnded = true;
      resource.child.stderr.readableEnded = true;
    },
    fixture: {
      close: async () => {
        order.push('telegram');
      },
    },
  });
  const result = await close();
  assert.deepEqual(order, ['broker', 'telegram']);
  assert.deepEqual(Object.keys(result), ['broker', 'telegram']);
  broker.child.stderr.readableEnded = false;
  await assert.rejects(close());
});
