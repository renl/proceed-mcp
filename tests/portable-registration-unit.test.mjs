// TEST ONLY: SE-selected registry seam; design 3/7. Clock evidence is a proxy,
// not 45 seconds of wall-clock scheduling or adapter lifecycle proof.
import assert from 'node:assert/strict';
import test from 'node:test';
const load = () => import('../src/broker/registration.js');
const bound = (r, ownerId = 'shared') => ({ ownerId,
  registrationId: r.registration_id, secret: r.registration_secret });

test('PORT-REG-UNIT: selected constants, independent authority and duplicate owner', async () => {
  const m = await load();
  assert.equal(m.REGISTRATION_LEASE_MS, 45000);
  assert.equal(m.REGISTRATION_ID_PATTERN.source, '^reg_[a-f0-9]{32}$');
  assert.equal(m.REGISTRATION_SECRET_PATTERN.source, '^[a-f0-9]{64}$');
  const logs = [], registry = m.createRegistrationRegistry({ logger: (...v) => logs.push(v) });
  try {
    const a = await registry.register({ ownerId: 'shared' });
    const b = await registry.register({ ownerId: 'foreign' });
    for (const r of [a, b]) {
      assert.deepEqual(Object.keys(r).sort(), ['registration_id', 'registration_secret']);
      assert.match(r.registration_id, /^reg_[a-f0-9]{32}$/);
      assert.match(r.registration_secret, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(logs).includes(r.registration_secret), false);
    }
    assert.notEqual(a.registration_id, b.registration_id);
    assert.notEqual(a.registration_secret, b.registration_secret);
    await assert.rejects(registry.register({ ownerId: 'shared' }), { code: 'OWNER_IN_USE' });
    assert.equal(registry.authenticate(bound(a)), true);
    for (const input of [bound(a, 'foreign'), { ...bound(a), secret: 'bad' },
      { ...bound(a), registrationId: 'bad' }]) assert.equal(registry.authenticate(input), false);
  } finally { registry.close(); }
});

test('PORT-REG-CLOCK: before/exact/after expiry and duplicate admission without sweep', async () => {
  const { createRegistrationRegistry } = await load();
  for (const elapsed of [44999, 45000, 45001]) {
    let now = 100000;
    const registry = createRegistrationRegistry({ clock: () => now });
    try {
      const a = await registry.register({ ownerId: 'shared' });
      now += elapsed;
      assert.equal(registry.authenticate(bound(a)), elapsed < 45000);
    } finally { registry.close(); }
  }
  let now = 0;
  const registry = createRegistrationRegistry({ clock: () => now });
  try {
    const a = await registry.register({ ownerId: 'shared' });
    now = 45000;
    const replacement = await registry.register({ ownerId: 'shared' });
    assert.notEqual(a.registration_id, replacement.registration_id);
    assert.equal(registry.release(bound(a)), false);
    assert.equal(registry.heartbeat(bound(a)), false);
    assert.equal(registry.authenticate(bound(replacement)), true);
  } finally { registry.close(); }
});

test('PORT-REG-RENEW: successful heartbeat renews; invalid activity cannot renew or release', async () => {
  const { createRegistrationRegistry } = await load();
  for (const valid of [false, true]) {
    let now = 0;
    const registry = createRegistrationRegistry({ clock: () => now });
    try {
      const a = await registry.register({ ownerId: 'shared' });
      now = 40000;
      assert.equal(registry.heartbeat({ ...bound(a), secret: valid ? a.registration_secret : '0'.repeat(64) }), valid);
      assert.equal(registry.authenticate({ ...bound(a), secret: 'bad' }), false);
      assert.equal(registry.release(bound(a, 'foreign')), false);
      now = 45000;
      assert.equal(registry.authenticate(bound(a)), valid);
    } finally { registry.close(); }
  }
  for (const elapsed of [44999, 45000, 45001]) {
    let now = 0;
    const registry = createRegistrationRegistry({ clock: () => now });
    try {
      const a = await registry.register({ ownerId: 'shared' });
      now = 40000;
      assert.equal(registry.heartbeat(bound(a)), true);
      now += elapsed;
      assert.equal(registry.authenticate(bound(a)), elapsed < 45000, 'renewed deadline is exact');
    } finally { registry.close(); }
  }
});

test('PORT-REG-CLOSE: captured release and terminal idempotent close, no new public error code', async () => {
  const { createRegistrationRegistry } = await load();
  const registry = createRegistrationRegistry();
  const a = await registry.register({ ownerId: 'shared' });
  assert.equal(registry.release(bound(a)), true);
  assert.equal(registry.release(bound(a)), false);
  const b = await registry.register({ ownerId: 'shared' });
  assert.equal(registry.release(bound(a)), false);
  assert.equal(registry.authenticate(bound(b)), true);
  registry.close(); registry.close();
  assert.equal(registry.authenticate(bound(b)), false);
  assert.equal(registry.heartbeat(bound(b)), false);
  assert.equal(registry.release(bound(b)), false);
  await assert.rejects(registry.register({ ownerId: 'shared' }));
});
