// Test-only binding to the implementation-selected additive seam; design 2.
import assert from 'node:assert/strict';
import test from 'node:test';

const load = () => import('../src/config/portable-config.js');
const invalid = { code: 'INVALID_ARGUMENT', exitCode: 2 };

test('PORT-HELPER-CONFIG: schema-2 empty document and canonical roundtrip', async () => {
  const m = await load(); // Missing production seam is RED, never skipped.
  assert.equal(m.CONFIG_SCHEMA_VERSION, 2);
  assert.equal(m.OWNER_LABEL_MAX_SCALARS, 128);
  const empty = {
    schema_version: 2,
    telegram: { token_env: 'PROCEED_TELEGRAM_BOT_TOKEN' },
    broker: { port: 43189 },
    owners: [],
  };
  assert.deepEqual(m.createEmptyConfig(), empty);
  const config = m.withOwner(empty, m.createOwner({ ownerId: 'owner_a', label: ' A 🛰️ ' }));
  assert.equal(m.serializeConfig(config), `${JSON.stringify(config, null, 2)}\n`);
  assert.deepEqual(m.parseConfigDocument(m.serializeConfig(config)), config);
  const extra = { ...config, origins: [{ url: 'obsolete' }], extra: true,
    owners: [{ ...config.owners[0], password_env: 'OBSOLETE' }],
    telegram: { ...config.telegram, extra: true }, broker: { port: 43189, extra: true } };
  assert.deepEqual(m.parseConfigDocument(JSON.stringify(extra)), config);
});

test('PORT-HELPER-CONFIG: owner IDs, scalar labels, exact text and immutable append', async () => {
  const m = await load();
  assert.ok(m.OWNER_ID_PATTERN instanceof RegExp);
  for (const id of ['a', 'a_0-z', 'a'.repeat(64)]) {
    assert.equal(m.validateOwnerId(id), id);
    assert.equal(m.OWNER_ID_PATTERN.test(id), true);
  }
  for (const id of ['', 'A', 'a b', '../a', 'a/b', 'a\\b', 'é', 'a\n', 'a'.repeat(65), null, 1]) {
    assert.throws(() => m.validateOwnerId(id), invalid);
  }
  for (const label of [' ', 'e\u0301', ' é\n ', '😀'.repeat(128)]) {
    assert.equal(m.validateOwnerLabel(label), label);
    assert.deepEqual(m.createOwner({ ownerId: 'a', label }), { owner_id: 'a', label });
  }
  for (const label of ['', '😀'.repeat(129), '\ud800', '\udc00', 'a\ud800b', null, 5]) {
    assert.throws(() => m.validateOwnerLabel(label), invalid);
    assert.throws(() => m.createOwner({ ownerId: 'a', label }), invalid);
  }
  assert.throws(() => m.createOwner({ ownerId: '../bad', label: 'ok' }), invalid);
  const first = Object.freeze(m.createOwner({ ownerId: 'a', label: 'same' }));
  const original = Object.freeze({ ...m.createEmptyConfig(), owners: Object.freeze([first]) });
  const second = m.createOwner({ ownerId: 'b', label: 'same' });
  const next = m.withOwner(original, second);
  assert.notEqual(next, original);
  assert.notEqual(next.owners, original.owners);
  assert.deepEqual(next.owners, [first, second]);
  assert.throws(() => m.withOwner(original, m.createOwner({ ownerId: 'a', label: 'changed' })), invalid);
  assert.deepEqual(original.owners, [first]);
});

test('PORT-HELPER-CONFIG: corrupt, old/unknown schema and invalid structures fail closed', async () => {
  const m = await load();
  assert.throws(() => m.parseConfigDocument('{'), { code: 'CONFIG_CORRUPT', exitCode: 4 });
  for (const version of [1, 3, 999, '2', null]) {
    assert.throws(() => m.parseConfigDocument(JSON.stringify({ ...m.createEmptyConfig(), schema_version: version })),
      { code: 'UNSUPPORTED_CONFIG_VERSION', exitCode: 4 });
  }
  for (const value of [null, [], 1, 'text']) {
    assert.throws(() => m.parseConfigDocument(JSON.stringify(value)), invalid);
  }
  const base = m.createEmptyConfig();
  const bad = [
    ...[0, 65536, 1.5, '43189', null].map(port => ({ ...base, broker: { port } })),
    ...['OTHER_TOKEN', '', null].map(token_env => ({ ...base, telegram: { token_env } })),
    ...[null, {}, 'owners'].map(owners => ({ ...base, owners })),
    ...[null, [], {}, { owner_id: 'BAD', label: 'x' }, { owner_id: 'a', label: '' }]
      .map(entry => ({ ...base, owners: [entry] })),
    { ...base, owners: [{ owner_id: 'a', label: 'x' }, { owner_id: 'a', label: 'y' }] },
    { schema_version: 2 },
  ];
  for (const value of bad) assert.throws(() => m.parseConfigDocument(JSON.stringify(value)), invalid);
  for (const port of [1, 65535]) {
    const value = { ...base, broker: { port } };
    assert.deepEqual(m.parseConfigDocument(JSON.stringify(value)), value);
  }
});
