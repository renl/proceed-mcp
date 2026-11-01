// TEST ONLY focused calibration of the new shutdown-inclusive output guard.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { outputGuard } from './support/public-registration.mjs';
test('PORT-PUBLIC-CONSUMER: split/dynamically learned shutdown secrets and overflow fail closed', () => {
  for (const name of ['stdout', 'stderr']) {
    const child = { stdout: new PassThrough(), stderr: new PassThrough(), kill() {} };
    const secrets = [], check = outputGuard(child, secrets), secret = 'e'.repeat(64);
    child[name].write(secret.slice(0, 31));
    secrets.push(secret); // Authority may be learned after capture starts.
    child[name].end(secret.slice(31));
    assert.throws(check, /private authority absent/);
  }
  let killed = false;
  const child = { stdout: new PassThrough(), stderr: new PassThrough(), kill() { killed = true; } };
  const check = outputGuard(child, []);
  child.stderr.write(Buffer.alloc(65537));
  assert.ok(killed); assert.throws(check, /bounded output consumer/);
});

test('PORT-PUBLIC-REQUEST-GUARD: only preparation stdout may contain keys, including keys learned after capture', () => {
  for (const prepareOutput of [false, true]) for (const stream of ['stdout', 'stderr']) {
    const child = { stdout: new PassThrough(), stderr: new PassThrough(), kill() {} };
    const requestSecrets = [], check = outputGuard(child, [], { requestSecrets, prepareOutput });
    child[stream].write('cap_'); requestSecrets.push('cap_synthetic'); child[stream].write('synthetic');
    if (prepareOutput && stream === 'stdout') assert.doesNotThrow(check);
    else assert.throws(check, /request capability absent/);
  }
});
