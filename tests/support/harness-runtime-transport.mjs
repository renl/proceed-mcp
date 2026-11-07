// TEST ONLY. Called inside the actual TUI runtime, never a substitute operator UI.
// This exercises the existing protected-lock secure client, not an invented wire.
import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';

export const transportExpectations = Object.freeze({
  enrolled: [200, null],
  unenrolled: [401, 'AUTH_REQUIRED'],
  owner: [403, 'FORBIDDEN'],
  control: [403, 'FORBIDDEN'],
  foreign: [403, 'FORBIDDEN'],
  plaintext: [null, 'BROKER_INSTANCE_CONFLICT'],
  'wrong-psk': [null, 'BROKER_INSTANCE_CONFLICT'],
});

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

export async function exerciseRuntimeTransport(plan, signal) {
  assert.equal(process.platform, 'linux', 'requires the controlled actual Linux TUI');
  assertTransportPlan(plan);
  const { createOperatorLocalClient, createSecureLocalClient } =
    await import('../../src/http/local-client.js');
  const { loadOperatorKeyFile } = await import('../../src/harness/operator-key.js');
  const observations = [];
  for (const c of plan.cases) {
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
    const client = (
      ['owner', 'control'].includes(c.id) ? createSecureLocalClient : createOperatorLocalClient
    )({
      port: c.port,
      lockFile: c.lock_file,
      token,
      timeoutMs: 10000,
    });
    const [status, code] = transportExpectations[c.id];
    let response;
    let failure;
    const start = performance.now();
    try {
      response = await client.request('POST', '/v1/harness/pending', c.body, {}, { signal });
    } catch (error) {
      failure = error;
    }
    if (status === null) {
      assert.equal(response, undefined, `${c.id} listener must never admit HTTP authority`);
      assert.equal(failure?.code, code, `${c.id} must fail secure admission`);
    } else {
      assert.equal(failure, undefined, `${c.id} secure runtime exchange failed`);
      assert.equal(response.status, status, `${c.id} public broker role refusal`);
      if (code) assert.equal(response.body.error.code, code);
      else assert.deepEqual(response.body, { schema_version: 1, presentation: null });
    }
    observations.push({ id: c.id, status, code, elapsed: performance.now() - start });
  }
  return observations;
}

// Real fixture endpoints, product implementation. This is capability proof, not
// evidence of a human choice or the lifecycle of the production TUI generation.
export async function exerciseProductTransport(plan, signal) {
  const { createOperatorLocalClient } = await import('../../src/http/local-client.js');
  const { loadOperatorKeyFile } = await import('../../src/harness/operator-key.js');
  const { credential } = await loadOperatorKeyFile({
    file: plan.key_file,
    stateDir: plan.state_dir,
  });
  const observations = [];
  for (const c of plan.controls) {
    signal.throwIfAborted();
    const client = createOperatorLocalClient({
      port: c.port,
      lockFile: c.lock_file,
      token: credential,
    });
    const start = performance.now();
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
    if (c.error) {
      assert.equal(value, undefined, `${c.id}: unexpected admission`);
      assert.equal(error?.code, c.error, `${c.id}: wrong refusal`);
    } else {
      assert.equal(error, undefined, `${c.id}: product exchange failed`);
      assert.equal(value.status, c.status);
      if (c.id === 'limit-exact')
        assert.equal(Buffer.byteLength(JSON.stringify(value.body)), 65536);
    }
    if (c.id === 'original-budget')
      assert.ok(
        elapsed >= 9500 && elapsed < 10500,
        'original 10000 ms budget, not restarted after TLS',
      );
    if (c.id === 'handshake-stall')
      assert.ok(elapsed >= 900 && elapsed < 1500, '1000 ms handshake ceiling');
    if (c.id === 'abort') assert.ok(elapsed < 1500, 'abort must destroy owned socket');
    if (c.id === 'reconnect') {
      const next = await client.request('POST', '/v1/harness/pending', {}, {}, { signal });
      assert.equal(next.status, 200, 'explicit observation reconnect succeeds on a fresh channel');
    }
    if (c.id === 'record-next') {
      // Same client must reread the protected record on every connection.
      const { writeFile } = await import('node:fs/promises');
      const original = await readFile(c.lock_file);
      try {
        const changed = JSON.parse(original);
        changed.channel.psk = 'f'.repeat(64);
        await writeFile(c.lock_file, JSON.stringify(changed));
        await assert.rejects(client.request('POST', '/v1/harness/pending', {}, {}, { signal }), {
          code: 'BROKER_INSTANCE_CONFLICT',
        });
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
  for (const file of plan.rejected_keys) {
    await assert.rejects(loadOperatorKeyFile({ file, stateDir: plan.state_dir }));
  }
  observations.push({ id: 'product-loader-unsafe-files', refused: plan.rejected_keys.length });
  return observations;
}
