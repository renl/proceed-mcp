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
  const { createSecureLocalClient } = await import('../../src/http/local-client.js');
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
    const token = (await readFile(c.key_file, 'utf8')).trim();
    if (!['owner', 'control'].includes(c.id))
      assert.equal(
        /^hop_[a-f0-9]{64}$/.test(token),
        true,
        'invalid synthetic operator credential shape',
      );
    const client = createSecureLocalClient({
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
