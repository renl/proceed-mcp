// TEST ONLY. Called inside the actual TUI runtime, never a substitute operator UI.
// The compiled host owns the production parent. Only its Node child consumes TLS.
import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runHelperExchange } from '../../src/harness/node-helper.js';

export function helperTransportClient(options) {
  return {
    request(_method, _path, body, _headers, { signal } = {}) {
      assert.equal(_method, 'POST');
      assert.equal(_path, '/v1/harness/pending');
      assert.deepEqual(_headers, {});
      return runHelperExchange({
        operation: 'pending',
        body,
        port: options.port,
        lockFile: options.lockFile,
        operatorCredential: options.token,
        signal,
      });
    },
  };
}

const diagnosticCases = [
  'unknown',
  'enrolled',
  'unenrolled',
  'owner',
  'control',
  'foreign',
  'plaintext',
  'wrong-psk',
  'product-controls',
  'limit-exact',
  'limit-over',
  'redirect',
  'handshake-stall',
  'original-budget',
  'abort',
  'reconnect',
  'record-next',
  'relay',
  'record-during',
  'product-loader-unsafe-files',
];
const diagnosticPhases = [
  'role-response',
  'product-response',
  'budget-assertion',
  'handshake-assertion',
  'abort-assertion',
  'reconnect-assertion',
  'record-assertion',
  'loader-refusal',
  'setup',
  'key-protection',
  'key-load',
  'client-create',
  'exchange',
  'response-assertion',
  'product-controls',
];
const safeCodes = [
  'BROKER_UNAVAILABLE',
  'BROKER_INSTANCE_CONFLICT',
  'CREDENTIAL_UNAVAILABLE',
  'INVALID_REQUEST',
  'PROTECTION_UNVERIFIED',
  'STORAGE_FAILURE',
  'ENOENT',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
  'ERR_SSL_NO_CIPHERS_AVAILABLE',
  'ERR_SSL_NO_SHARED_CIPHER',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_UNSUPPORTED_PROTOCOL',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_INVALID_ARG_TYPE',
  'ERR_NOT_IMPLEMENTED',
  'ERR_ASSERTION',
  'ABORT_ERR',
  'HELPER_PROTOCOL_INVALID',
  'EXCHANGE_DEADLINE',
  'EXCHANGE_CANCELLED',
  'NODE_UNAVAILABLE',
  'NODE_UNSUPPORTED',
  'HELPER_LIMIT_EXCEEDED',
];
const safeNames = [
  'Error',
  'TypeError',
  'AssertionError',
  'AbortError',
  'LocalRequestError',
  'SecureChannelError',
  'CliError',
  'BrokerError',
  'HelperChannelError',
];
const pick = (value, allowed) => (allowed.includes(value) ? value : 'REDACTED');
// Read only explicitly named own data properties. Never invoke error getters,
// stringify errors or inspect arbitrary object fields, messages, stacks or paths.
function own(value, key) {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}
export function transportDiagnostic(error, state = {}, versions = process.versions) {
  const chain = [];
  const seen = new Set();
  for (
    let current = error;
    current && chain.length < 4 && !seen.has(current);
    current = own(current, 'cause')
  ) {
    seen.add(current);
    chain.push({
      name: pick(own(current, 'name'), safeNames),
      code: pick(own(current, 'code'), safeCodes),
    });
  }
  const runtime = {};
  for (const key of ['bun', 'node', 'openssl']) {
    const value = own(versions, key);
    runtime[key] =
      typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[a-z]{1,2})?$/.test(value)
        ? value
        : null;
  }
  return {
    schema_version: 1,
    case: pick(state.case, diagnosticCases),
    phase: pick(state.phase, diagnosticPhases),
    classification: error ? 'CONTROL_FAILURE' : 'FIRST_EXCHANGE_PASS',
    elapsed_ms: Number.isFinite(state.elapsed_ms)
      ? Math.min(100000, Math.max(0, Math.round(state.elapsed_ms)))
      : 0,
    chain,
    runtime,
  };
}
export function assertTransportDiagnostic(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'case',
    'chain',
    'classification',
    'elapsed_ms',
    'phase',
    'runtime',
    'schema_version',
  ]);
  assert.equal(value.schema_version, 1);
  assert.ok([...diagnosticCases, 'REDACTED'].includes(value.case));
  assert.ok([...diagnosticPhases, 'REDACTED'].includes(value.phase));
  assert.ok(['CONTROL_FAILURE', 'FIRST_EXCHANGE_PASS'].includes(value.classification));
  assert.ok(
    Number.isInteger(value.elapsed_ms) && value.elapsed_ms >= 0 && value.elapsed_ms <= 100000,
  );
  assert.ok(Array.isArray(value.chain) && value.chain.length <= 4);
  for (const entry of value.chain) {
    assert.deepEqual(Object.keys(entry).sort(), ['code', 'name']);
    assert.ok([...safeCodes, 'REDACTED'].includes(entry.code));
    assert.ok([...safeNames, 'REDACTED'].includes(entry.name));
  }
  assert.deepEqual(Object.keys(value.runtime).sort(), ['bun', 'node', 'openssl']);
  for (const version of Object.values(value.runtime))
    assert.ok(
      version === null ||
        (typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[a-z]{1,2})?$/.test(version)),
    );
  return value;
}
// Separate safety floor, NOT the full raw-capture scan or permission to export it.
export function diagnosticExport(value, secrets) {
  assertTransportDiagnostic(value);
  assert.ok(Array.isArray(secrets) && secrets.length > 0);
  const bytes = JSON.stringify(value);
  for (const secret of secrets) {
    assert.ok(typeof secret === 'string' && secret.length > 0);
    assert.equal(bytes.includes(secret), false, 'diagnostic authority exclusion failed');
  }
  return bytes;
}
export function assertDetailedTransportExport(scan) {
  assert.equal(scan?.status, 'PASS', 'required complete raw-capture scan marker missing or failed');
}

export function transportFailureCategory(value) {
  return {
    case: pick(own(value, 'case'), diagnosticCases),
    phase: pick(own(value, 'phase'), diagnosticPhases),
    classification: pick(own(value, 'classification'), ['CONTROL_FAILURE', 'FIRST_EXCHANGE_PASS']),
  };
}

export async function assertIntegratedTransportGate(transport, expectedIds, assertObserved) {
  let check = 'transport-status';
  try {
    assert.notEqual(transport.status, 'FAIL');
    check = 'transport-case-inventory';
    assert.deepEqual(transport.observations.map((o) => o.id).sort(), [...expectedIds].sort());
    check = 'transport-listener-observation';
    await assertObserved();
  } catch (error) {
    Object.defineProperty(error, 'transportFailure', {
      value: {
        ...transportFailureCategory(transport.diagnostic),
        check,
      },
    });
    throw error;
  }
}

export function safeTransportFailure(value) {
  if (!value) return null;
  return {
    ...transportFailureCategory(value),
    check: pick(own(value, 'check'), [
      'transport-status',
      'transport-case-inventory',
      'transport-listener-observation',
    ]),
  };
}

export const transportExpectations = Object.freeze({
  enrolled: [200, null],
  unenrolled: [401, 'AUTH_REQUIRED'],
  owner: [null, 'HELPER_PROTOCOL_INVALID'],
  control: [null, 'HELPER_PROTOCOL_INVALID'],
  foreign: [403, 'FORBIDDEN'],
  plaintext: [null, 'BROKER_INSTANCE_CONFLICT'],
  'wrong-psk': [null, 'BROKER_INSTANCE_CONFLICT'],
});

export function assertRuntimeRoleOutcome(id, response, failure, elapsed_ms, observe) {
  const [status, code] = transportExpectations[id];
  // Retain the typed exchange error BEFORE assert.equal can replace it.
  observe({ case: id, phase: failure ? 'exchange' : 'role-response', elapsed_ms }, failure);
  if (status === null) {
    assert.equal(response, undefined, `${id} listener must never admit HTTP authority`);
    assert.equal(failure?.code, code, `${id} must fail secure admission`);
  } else {
    assert.equal(failure, undefined, `${id} secure runtime exchange failed`);
    assert.equal(response.status, status, `${id} public broker role refusal`);
    if (code) assert.equal(response.body.error.code, code);
    else assert.deepEqual(response.body, { schema_version: 1, presentation: null });
  }
}

export function assertTransportPlan(plan) {
  assert.equal(plan.schema_version, 1);
  assert.deepEqual(Object.keys(plan).sort(), ['cases', 'schema_version']);
  assert.deepEqual(plan.cases.map((c) => c.id).sort(), Object.keys(transportExpectations).sort());
  for (const c of plan.cases) {
    assert.deepEqual(Object.keys(c).sort(), ['body', 'id', 'key_file', 'lock_file', 'port']);
    for (const path of [c.key_file, c.lock_file])
      assert.match(path, /^\/run\/proceed\/qualification-private\/[a-zA-Z0-9_./-]+$/);
    for (const path of [c.key_file, c.lock_file])
      assert.equal(path.split('/').includes('..'), false, 'private fixture path escape');
    assert.ok(Number.isInteger(c.port) && c.port > 0 && c.port <= 65535);
    assert.deepEqual(Object.keys(c.body).sort(), ['harness_id', 'owner_id', 'session_id']);
    assert.equal(c.body.harness_id, 'qualification');
    assert.equal(c.body.owner_id, c.id === 'foreign' ? 'foreign' : 'shared');
    assert.equal(c.body.session_id, 'transport-session');
  }
}

export async function exerciseRuntimeTransport(
  plan,
  signal,
  observe = () => {},
  firstOnly = false,
) {
  assert.equal(process.platform, 'linux', 'requires the controlled actual Linux TUI');
  assertTransportPlan(plan);
  const { loadOperatorKeyFile } = await import('../../src/harness/operator-key.js');
  const observations = [];
  for (const c of firstOnly ? plan.cases.filter((c) => c.id === 'enrolled') : plan.cases) {
    const state = { case: c.id, phase: 'key-protection', elapsed_ms: 0 };
    observe(state);
    signal.throwIfAborted();
    // Synthetic files stay outside payload/package/state/config. This test read
    // proves runtime file capability only. Production must independently verify
    // full ancestor, identity and protection rules before loading an operator key.
    const parent = await lstat(dirname(c.key_file));
    const file = await lstat(c.key_file);
    assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
    assert.equal(parent.mode & 0o777, 0o700);
    assert.equal(parent.uid, process.geteuid());
    assert.ok(file.isFile() && !file.isSymbolicLink());
    assert.equal(file.mode & 0o777, 0o600);
    assert.equal(file.uid, process.geteuid());
    assert.equal(file.nlink, 1);
    state.phase = 'key-load';
    observe(state);
    const token = ['owner', 'control'].includes(c.id)
      ? (await readFile(c.key_file, 'utf8')).trim()
      : (await loadOperatorKeyFile({ file: c.key_file, stateDir: '/run/proceed/host-state' }))
          .credential;
    if (!['owner', 'control'].includes(c.id))
      assert.equal(
        /^hop_[a-f0-9]{64}$/.test(token),
        true,
        'invalid synthetic operator credential shape',
      );
    state.phase = 'client-create';
    observe(state);
    const client = helperTransportClient({
      port: c.port,
      lockFile: c.lock_file,
      token,
      timeoutMs: 10000,
    });
    const [status, code] = transportExpectations[c.id];
    let response;
    let failure;
    const start = performance.now();
    state.phase = 'exchange';
    observe(state);
    try {
      response = await client.request('POST', '/v1/harness/pending', c.body, {}, { signal });
    } catch (error) {
      failure = error;
    }
    assertRuntimeRoleOutcome(c.id, response, failure, performance.now() - start, observe);
    observations.push({ id: c.id, status, code, elapsed: performance.now() - start });
  }
  return observations;
}

// Real fixture endpoints, product implementation. This is capability proof, not
// evidence of a human choice or the lifecycle of the production TUI generation.
export async function exerciseProductTransport(plan, signal, observe = () => {}) {
  observe({ case: 'product-controls', phase: 'key-load', elapsed_ms: 0 });
  const { loadOperatorKeyFile } = await import('../../src/harness/operator-key.js');
  const { credential } = await loadOperatorKeyFile({
    file: plan.key_file,
    stateDir: plan.state_dir,
  });
  const observations = [];
  for (const c of plan.controls) {
    observe({ case: c.id, phase: 'client-create', elapsed_ms: 0 });
    signal.throwIfAborted();
    const client = helperTransportClient({
      port: c.port,
      lockFile: c.lock_file,
      token: credential,
    });
    const start = performance.now();
    observe({ case: c.id, phase: 'exchange', elapsed_ms: 0 });
    let value, error;
    const controller = new AbortController();
    const timer = c.id === 'abort' ? setTimeout(() => controller.abort(), 250) : undefined;
    try {
      value = await client.request(
        'POST',
        '/v1/harness/pending',
        { harness_id: 'qualification', owner_id: 'shared', session_id: 'transport-session' },
        {},
        { signal: AbortSignal.any([signal, controller.signal]) },
      );
    } catch (caught) {
      error = caught;
    } finally {
      clearTimeout(timer);
    }
    const elapsed = performance.now() - start;
    observe(
      { case: c.id, phase: error ? 'exchange' : 'response-assertion', elapsed_ms: elapsed },
      error,
    );
    const expectedError =
      c.id === 'original-budget'
        ? 'EXCHANGE_DEADLINE'
        : c.id === 'abort'
          ? 'EXCHANGE_CANCELLED'
          : c.error;
    observe({ case: c.id, phase: 'product-response', elapsed_ms: elapsed });
    if (expectedError) {
      assert.equal(value, undefined, `${c.id}: unexpected admission`);
      assert.equal(error?.code, expectedError, `${c.id}: wrong refusal`);
    } else {
      assert.equal(error, undefined, `${c.id}: product exchange failed`);
      assert.equal(value.status, c.status);
      if (c.id === 'limit-exact')
        assert.equal(Buffer.byteLength(JSON.stringify(value.body)), 65536);
    }
    observe({ case: c.id, phase: 'response-assertion', elapsed_ms: elapsed });
    if (c.id === 'original-budget') {
      observe({ case: c.id, phase: 'budget-assertion', elapsed_ms: elapsed });
      assert.ok(
        elapsed >= 8500 && elapsed < 10000,
        'original helper 10000 ms budget includes reserved cleanup, never restarted after TLS',
      );
    }
    if (c.id === 'handshake-stall') {
      observe({ case: c.id, phase: 'handshake-assertion', elapsed_ms: elapsed });
      assert.ok(elapsed >= 900 && elapsed < 1500, '1000 ms handshake ceiling');
    }
    if (c.id === 'abort') {
      observe({ case: c.id, phase: 'abort-assertion', elapsed_ms: elapsed });
      assert.ok(elapsed < 1500, 'abort must destroy owned socket');
    }
    if (c.id === 'reconnect') {
      observe({ case: c.id, phase: 'reconnect-assertion', elapsed_ms: elapsed });
      const next = await client.request(
        'POST',
        '/v1/harness/pending',
        { harness_id: 'qualification', owner_id: 'shared', session_id: 'transport-session' },
        {},
        { signal },
      );
      assert.equal(next.status, 200, 'explicit observation reconnect succeeds on a fresh channel');
    }
    if (c.id === 'record-next') {
      observe({ case: c.id, phase: 'record-assertion', elapsed_ms: elapsed });
      // Same client must reread the protected record on every connection.
      const { writeFile } = await import('node:fs/promises');
      const original = await readFile(c.lock_file);
      try {
        const changed = JSON.parse(original);
        changed.channel.psk = 'f'.repeat(64);
        await writeFile(c.lock_file, JSON.stringify(changed));
        await assert.rejects(
          client.request(
            'POST',
            '/v1/harness/pending',
            { harness_id: 'qualification', owner_id: 'shared', session_id: 'transport-session' },
            {},
            { signal },
          ),
          {
            code: 'BROKER_INSTANCE_CONFLICT',
          },
        );
      } finally {
        await writeFile(c.lock_file, original);
      }
    }
    observations.push({
      id: c.id,
      status: value?.status ?? null,
      code: error?.code ?? null,
      elapsed,
    });
  }
  // Production loader rejection tests are separate from fixture lstat capability.
  observe({ case: 'product-loader-unsafe-files', phase: 'loader-refusal', elapsed_ms: 0 });
  for (const file of plan.rejected_keys) {
    await assert.rejects(loadOperatorKeyFile({ file, stateDir: plan.state_dir }));
  }
  observations.push({ id: 'product-loader-unsafe-files', refused: plan.rejected_keys.length });
  return observations;
}
