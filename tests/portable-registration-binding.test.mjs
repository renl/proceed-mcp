// TEST ONLY: selected internal SE interfaces; design 3/7, not public MCP proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
const load = () => import('../src/mcp/registration.js');
const authority = n => ({ registration_id: `reg_${String(n).repeat(32)}`,
  registration_secret: String(n).repeat(64) });
const reply = n => ({ status: 201, body: authority(n) });
const failure = (code, message = 'safe diagnostic', retryable = false) =>
  ({ status: 409, body: { schema_version: 1, error: { code, message, retryable } } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {
  resolve = a; reject = b;
}); return { promise, resolve, reject }; };
async function until(predicate) {
  const deadline = performance.now() + 1000;
  while (!predicate()) { assert.ok(performance.now() < deadline, 'bounded lifecycle observation'); await delay(2); }
}
function fixture(m, handler) {
  const calls = [], logs = [], secrets = [];
  const client = { request(...args) {
    const [method, path, body, headers = {}, options = {}] = args;
    const call = { method, path, body, headers, options }; calls.push(call);
    return Promise.resolve().then(() => handler(call, calls)).then(result => {
      if (typeof result?.body?.registration_secret === 'string') secrets.push(result.body.registration_secret);
      return result;
    });
  } };
  const binding = m.createRegistrationBinding({ client, heartbeatMs: 15,
    shutdownBudgetMs: 60, logger: (...v) => logs.push(v) });
  return { binding, calls, logs, secrets };
}
function privateOutput(f, errors = []) {
  // Join all captured values before searching: chunk boundaries cannot hide a secret.
  const strings = [];
  const collect = value => {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect([f.logs, errors.map(e => ({ message: e.message, stack: e.stack }))]);
  const output = strings.join('');
  assert.ok(f.secrets.every(secret => !output.includes(secret)), 'no consumed secret in errors/logger');
}
const creates = f => f.calls.filter(c => c.path === '/v1/adapter');
const deletes = f => f.calls.filter(c => c.method === 'DELETE');

test('PORT-BIND-CONSUMER: split-secret logger/error negatives cannot evade scan', () => {
  const secret = authority(3).registration_secret;
  for (const logs of [[secret.slice(0, 17), secret.slice(17)], [{ nested: secret }]]) {
    assert.throws(() => privateOutput({ logs, secrets: [secret] }), /no consumed secret/);
  }
  assert.throws(() => privateOutput({ logs: [], secrets: [secret] },
    [{ message: secret.slice(0, 17), stack: secret.slice(17) }]), /no consumed secret/);
});

test('PORT-BIND-SINGLE: selected exports, concurrent ensure is one private create', { timeout: 3000 }, async () => {
  const m = await load(), gate = deferred();
  assert.equal(m.REGISTRATION_HEARTBEAT_MS, 10000);
  assert.equal(m.REGISTRATION_SHUTDOWN_BUDGET_MS, 2000);
  assert.equal(m.REGISTRATION_HEADER, 'X-Proceed-Registration');
  const sample = new m.RegistrationError('OWNER_IN_USE', 'safe');
  assert.equal(sample.code, 'OWNER_IN_USE'); assert.equal(sample.retryable, false);
  assert.equal(new m.RegistrationError('BROKER_UNAVAILABLE', 'safe', { retryable: true }).retryable, true);
  const f = fixture(m, c => c.method === 'DELETE' || c.path.endsWith('/heartbeat')
    ? { status: 204, body: null } : gate.promise);
  try {
    const pending = Array.from({ length: 8 }, () => f.binding.ensure());
    await until(() => creates(f).length === 1);
    assert.deepEqual(creates(f)[0].body, {});
    gate.resolve(reply(1));
    const records = await Promise.all(pending);
    assert.ok(records.every(r => JSON.stringify(r) === JSON.stringify(authority(1))));
    assert.ok(JSON.stringify(await f.binding.ensure()) === JSON.stringify(authority(1)));
    assert.equal(creates(f).length, 1);
    await until(() => f.calls.some(c => c.path.endsWith('/heartbeat')));
    const beat = f.calls.find(c => c.path.endsWith('/heartbeat'));
    assert.deepEqual(beat.body, {});
    assert.ok(beat.headers[m.REGISTRATION_HEADER] === authority(1).registration_secret);
  } finally { gate.resolve(reply(1)); await f.binding.close(); privateOutput(f); }
});

test('PORT-BIND-INVALID: wrong status/malformed authority never adopted, renewed or released', { timeout: 5000 }, async () => {
  const m = await load();
  for (const result of [{ status: 200, body: authority(1) }, { status: 204, body: null },
    { status: 201, body: [] }, { status: 201, body: { ...authority(1), registration_id: 'bad' } },
    { status: 201, body: { ...authority(1), registration_secret: 'bad' } },
    { status: 201, body: { registration_id: authority(1).registration_id } }]) {
    const f = fixture(m, () => result), errors = [];
    try {
      await assert.rejects(f.binding.ensure(), e => { errors.push(e);
        return e.code === 'BROKER_UNAVAILABLE' && e.retryable === true; });
      await delay(45); assert.equal(f.calls.length, 1);
    } finally { await f.binding.close(); assert.equal(f.calls.length, 1); privateOutput(f, errors); }
  }
});

test('PORT-BIND-ERROR: OWNER_IN_USE never steals/retries; closed error vocabulary', { timeout: 5000 }, async () => {
  const m = await load();
  const known = ['INVALID_ARGUMENT', 'NOT_PAIRED', 'BROKER_UNAVAILABLE', 'AUTH_REQUIRED', 'FORBIDDEN',
    'OWNER_IN_USE', 'WAIT_ALREADY_ACTIVE', 'IDEMPOTENCY_CONFLICT', 'DECISION_MISMATCH', 'NOT_FOUND',
    'ENHANCEMENT_UNAVAILABLE', 'STORAGE_FAILURE', 'UNSUPPORTED_SCHEMA'];
  for (const code of known) {
    const f = fixture(m, () => failure(code, 'safe diagnostic', true));
    try {
      await assert.rejects(f.binding.ensure(), e => e.code === code && e.message === 'safe diagnostic' && e.retryable === true);
      await delay(20); assert.equal(f.calls.length, 1);
    } finally { await f.binding.close(); assert.equal(deletes(f).length, 0); privateOutput(f); }
  }
  for (const result of [failure('BROKER_REJECTED', authority(2).registration_secret),
    { status: 401, body: { schema_version: 1, error: { code: 'AUTH_REQUIRED', message: 1, retryable: false } } },
    { status: 503, body: { schema_version: 1, error: { code: 'NOT_PAIRED', message: 'safe' } } },
    { status: 401, body: { ...failure('AUTH_REQUIRED').body, schema_version: 2 } },
    { status: 500, body: null }, new Error(authority(2).registration_secret)]) {
    const f = fixture(m, () => { if (result instanceof Error) throw result; return result; });
    f.secrets.push(authority(2).registration_secret); const errors = [];
    try { await assert.rejects(f.binding.ensure(), e => { errors.push(e);
      return e.code === 'BROKER_UNAVAILABLE' && e.retryable === true; });
    } finally { await f.binding.close(); privateOutput(f, errors); }
  }
});

test('PORT-BIND-RENEW: transport failure retains authority; 401 re-registers once', { timeout: 3000 }, async () => {
  const m = await load(), replacement = deferred(); let beats = 0;
  const f = fixture(m, (c, calls) => {
    if (c.method === 'DELETE') return { status: 204, body: null };
    if (c.path === '/v1/adapter') return calls.filter(v => v.path === c.path).length === 1 ? reply(1) : replacement.promise;
    if (++beats === 1) throw new Error(authority(1).registration_secret);
    return beats === 2 ? { ...failure('AUTH_REQUIRED'), status: 401 } : { status: 204, body: null };
  });
  try {
    await f.binding.ensure(); await until(() => beats === 1);
    assert.ok(JSON.stringify(await f.binding.ensure()) === JSON.stringify(authority(1)));
    await until(() => creates(f).length === 2);
    const pending = Array.from({ length: 5 }, () => f.binding.ensure());
    replacement.resolve(reply(2));
    assert.ok((await Promise.all(pending)).every(r => JSON.stringify(r) === JSON.stringify(authority(2))));
    assert.equal(creates(f).length, 2);
  } finally { replacement.resolve(reply(2)); await f.binding.close(); privateOutput(f); }
  assert.equal(deletes(f).length, 1);
  assert.ok(deletes(f)[0].path.endsWith(authority(2).registration_id));
  assert.ok(deletes(f)[0].headers[m.REGISTRATION_HEADER] === authority(2).registration_secret);
});

test('PORT-BIND-RELEASE: stalled release shares finite close budget and aborts', { timeout: 3000 }, async () => {
  const m = await load(), held = deferred(); let release;
  const f = fixture(m, c => {
    if (c.method === 'DELETE') { release = c; return held.promise; }
    return c.path === '/v1/adapter' ? reply(1) : { status: 204, body: null };
  });
  try {
    await f.binding.ensure(); const start = performance.now();
    await Promise.all([f.binding.close(), f.binding.close()]);
    assert.ok(performance.now() - start < 500);
    assert.equal(deletes(f).length, 1);
    assert.ok(release.options.signal instanceof AbortSignal && release.options.signal.aborted);
    assert.ok(release.headers[m.REGISTRATION_HEADER] === authority(1).registration_secret);
    const count = f.calls.length;
    held.resolve({ status: 204, body: null }); await delay(40);
    await assert.rejects(f.binding.ensure()); assert.equal(deletes(f).length, 1);
    assert.equal(f.calls.length, count, 'late release cannot start new HTTP');
  } finally { held.resolve({ status: 204, body: null }); await f.binding.close(); privateOutput(f); }
});

test('PORT-BIND-CLOSE: delayed create/heartbeat fenced; captured release and terminal close', { timeout: 5000 }, async () => {
  const m = await load();
  for (const phase of ['create', 'heartbeat', 'replacement']) {
    const held = deferred(); let blocked;
    const f = fixture(m, (c, calls) => {
      if (c.method === 'DELETE') return { status: 204, body: null };
      if ((phase === 'create' && c.path === '/v1/adapter') ||
        (phase === 'heartbeat' && c.path.endsWith('/heartbeat')) ||
        (phase === 'replacement' && c.path === '/v1/adapter' && creates({ calls }).length === 2)) {
        blocked = c; return held.promise;
      }
      return c.path === '/v1/adapter' ? reply(1) : { ...failure('AUTH_REQUIRED'), status: 401 };
    });
    const pending = f.binding.ensure(); pending.catch(() => {});
    try {
      await until(() => blocked);
      const start = performance.now(); await Promise.all([f.binding.close(), f.binding.close()]);
      assert.ok(performance.now() - start < 500, 'small injected shared shutdown budget');
      assert.ok(blocked.options.signal instanceof AbortSignal && blocked.options.signal.aborted, 'tracked HTTP cancellation');
      const count = f.calls.length; // After close, BEFORE the held response can trigger immediate work.
      held.resolve(phase === 'heartbeat' ? { status: 204, body: null } : reply(2));
      await Promise.allSettled([pending]);
      assert.equal(f.calls.length, count, 'settlement cannot start immediate HTTP');
      await assert.rejects(f.binding.ensure()); await delay(50);
      assert.equal(f.calls.length, count, 'late completion cannot create timers or new HTTP');
      assert.ok(deletes(f).every(c => c.path.endsWith(authority(1).registration_id) &&
        c.headers[m.REGISTRATION_HEADER] === authority(1).registration_secret), 'never release late replacement');
      assert.equal(deletes(f).length, phase === 'heartbeat' ? 1 : 0);
    } finally { held.resolve(reply(2)); await f.binding.close(); privateOutput(f); }
  }
});
