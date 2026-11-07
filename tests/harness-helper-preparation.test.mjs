import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  frame,
  hello,
  exchangeId,
  invalidHelloVectors,
  forbiddenExchangeVectors,
} from './support/harness-helper-vectors.mjs';

test('helper runner refuses missing selection and non-source paths without launch', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  for (const args of [
    ['--helper-contract-preflight'],
    ['--helper-contract-run'],
    ['--helper-contract-preflight', '../outside.js'],
    ['--helper-contract-preflight', 'tests/fixtures/not-production.js'],
    ['--helper-contract-preflight', 'src/helper.js', 'extra'],
  ]) {
    const result = spawnSync(process.execPath, ['tests/run-harness-host.mjs', ...args], {
      cwd,
      env: {},
      timeout: 5000,
      maxBuffer: 32768,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    if (args.length === 1) assert.match(result.stderr, /^HELPER_ENTRY_REQUIRED:/);
  }
});

test('helper vectors use byte lengths and exact nonsecret hello fields', () => {
  const value = hello(12345);
  assert.deepEqual(Object.keys(value).sort(), [
    'deadline_unix_ms',
    'exchange_id',
    'schema_version',
    'type',
  ]);
  assert.match(exchangeId, /^[a-f0-9]{32}$/);
  const bytes = frame(value);
  assert.equal(bytes.readUInt32BE(0), bytes.length - 4);
  assert.deepEqual(JSON.parse(bytes.subarray(4)), value);
  assert.equal(frame('é').readUInt32BE(0), 2);
});

test('adversarial hello vectors retain duplicate keys, invalid UTF-8 and preallocation limits', () => {
  const cases = new Map(invalidHelloVectors());
  assert.equal(cases.get('zero-length').readUInt32BE(), 0);
  assert.equal(cases.get('oversized-length').readUInt32BE(), 81921);
  assert.throws(() =>
    new TextDecoder('utf-8', { fatal: true }).decode(cases.get('invalid-utf8').subarray(4)),
  );
  assert.equal(
    (
      cases
        .get('duplicate-key')
        .toString()
        .match(/"schema_version"/g) ?? []
    ).length,
    2,
  );
  for (const bytes of cases.values()) assert.ok(bytes.length < 98304);
});

test('ordinary helper invocation vectors contain no usable authority or key loading permission', () => {
  for (const [, value] of forbiddenExchangeVectors()) {
    assert.equal(value.operator_credential, 'not-authority');
    assert.equal(frame(value).includes(Buffer.from('hop_')), false);
  }
  assert.ok(forbiddenExchangeVectors().some(([, value]) => value.operator_key_file));
});
