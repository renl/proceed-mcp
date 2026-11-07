// Native controls verify the scanner and W3 test completeness, NOT real TLS proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { scanRequiredCaptures } from './support/harness-transport-fixtures.mjs';
import {
  transportDiagnostic,
  assertTransportDiagnostic,
  diagnosticExport,
  assertDetailedTransportExport,
  assertRuntimeRoleOutcome,
} from './support/harness-runtime-transport.mjs';

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
  assert.match(helper, /createOperatorLocalClient/);
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
