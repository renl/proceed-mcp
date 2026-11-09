// Native controls verify the scanner and W3 test completeness, NOT real TLS proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { dirname } from 'node:path';
import { exchangeProblem } from '../src/harness/helper-operations.js';
import { scanRequiredCaptures } from './support/harness-transport-fixtures.mjs';
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
