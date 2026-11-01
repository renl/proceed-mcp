// TEST ONLY actual private HTTP lifecycle, not adapter binding or Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portable } from './support/portable-waiting.mjs';

test('PORT-REG-HTTP: roles, validation, secret, release, restart and state preservation',
  { timeout: 65000 }, () => portable(async h => {
    const credentials = join(h.state, 'credentials');
    const names = (await readdir(credentials)).sort();
    const owners = await Promise.all(names.filter(n => n !== 'control.token')
      .map(async n => (await readFile(join(credentials, n), 'utf8')).trim()));
    assert.equal(owners.length, 2);
    const [owner, foreign] = owners;
    // Durable reservation exists BEFORE registration; expiry/release may not cancel it.
    const prepared = await h.http('/v1/handles', owner, { method: 'POST', body: {} });
    assert.equal(prepared.status, 201);
    const reservation = await prepared.json();
    const stateNames = (await readdir(h.state)).sort();
    const paths = ['config.json', 'journal.log', ...names.map(n => `credentials/${n}`)];
    const snapshot = await Promise.all(paths.map(p => readFile(join(h.state, p))));
    assert.equal(snapshot[1].readUInt32BE(8), 2);
    const secrets = [h.control, ...owners, reservation.request_capability], logs = [];
    for (const stream of [h.broker.child.stdout, h.broker.child.stderr]) stream.on('data', b => logs.push(String(b)));
    const error = async (response, status, code, registration = false) => {
      assert.equal(response.status, status);
      assert.equal(response.headers.has('access-control-allow-origin'), false);
      const value = await response.json();
      assert.deepEqual(Object.keys(value).sort(), ['error', 'schema_version']);
      assert.equal(value.schema_version, 1);
      assert.deepEqual(Object.keys(value.error).sort(), ['code', 'message', 'retryable']);
      assert.equal(value.error.code, code);
      assert.equal(typeof value.error.message, 'string');
      assert.equal(typeof value.error.retryable, 'boolean');
      if (registration) assert.deepEqual(value.error, { code: 'AUTH_REQUIRED',
        message: 'registration authentication required', retryable: false });
      assert.ok(secrets.every(s => !JSON.stringify(value).includes(s)), 'redacted error');
    };
    const create = async (bearer = owner, body = {}) => h.http('/v1/adapter', bearer, { method: 'POST', body });
    const fresh = async (bearer = owner) => {
      const response = await create(bearer);
      assert.equal(response.status, 201);
      const r = await response.json();
      assert.deepEqual(Object.keys(r).sort(), ['registration_id', 'registration_secret']);
      assert.equal(typeof r.registration_id, 'string');
      assert.match(r.registration_secret, /^[a-f0-9]{64}$/);
      secrets.push(r.registration_secret);
      return r;
    };
    const route = (r, heartbeat) => `/v1/adapter/${r.registration_id}${heartbeat ? '/heartbeat' : ''}`;
    const activity = (r, heartbeat, bearer = owner, secret = r.registration_secret, body = {}) =>
      h.http(route(r, heartbeat), bearer, { method: heartbeat ? 'POST' : 'DELETE',
        ...(heartbeat ? { body } : {}), headers: { 'X-Proceed-Registration': secret } });
    const empty = async response => { assert.equal(response.status, 204); assert.equal(await response.text(), ''); };
    // Positive admission first: a generic 404 stub cannot pass later negative checks.
    const a = await fresh(), b = await fresh(foreign);
    for (const [path, options] of [['/v1/adapter', { method: 'POST', body: {} }],
      [route(a, true), { method: 'POST', body: {} }], [route(a, false), { method: 'DELETE' }]]) {
      for (const token of ['', 'invalid']) await error(await h.http(path, token,
        { ...options, headers: { authorization: token ? `Bearer ${token}` : '' } }), 401, 'AUTH_REQUIRED');
      await error(await h.http(path, h.control, options), 403, 'FORBIDDEN');
      await error(await h.http(path, owner, { ...options, headers: { Origin: 'https://example.invalid' } }), 403, 'FORBIDDEN');
    }
    await error(await create(), 409, 'OWNER_IN_USE');
    await error(await create(owner, { owner_id: 'foreign' }), 400, 'INVALID_ARGUMENT');
    const port = JSON.parse(snapshot[0]).broker.port;
    for (const path of ['/v1/adapter', route(a, true)]) {
      for (const raw of ['{', '[]', `${' '.repeat(65536)}{}`]) {
        await error(await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
          body: raw, redirect: 'error', signal: AbortSignal.timeout(1000),
        }), 400, 'INVALID_ARGUMENT'); // Body parsing precedes missing registration secret.
      }
    }
    for (const heartbeat of [true, false]) {
      for (const [r, token, secret] of [[a, owner, ''], [a, owner, 'bad'],
        [a, owner, '0'.repeat(64)], [a, foreign, a.registration_secret],
        [{ ...a, registration_id: 'malformed' }, owner, a.registration_secret],
        [{ ...a, registration_id: `reg_${'0'.repeat(32)}` }, owner, a.registration_secret]]) {
        await error(await activity(r, heartbeat, token, secret), 401, 'AUTH_REQUIRED', true);
      }
    }
    await error(await activity(a, true, owner, '', { extra: true }), 401, 'AUTH_REQUIRED', true);
    await error(await activity(a, true, owner, a.registration_secret, { extra: true }), 400, 'INVALID_ARGUMENT');
    await empty(await activity(a, true));
    await empty(await activity(b, true, foreign));
    for (const [path, method] of [['/v1/adapter', 'GET'], ['/v1/adapter/heartbeat', 'POST'],
      [`${route(a, true)}/extra`, 'POST'], [route(a, false), 'POST']]) {
      await error(await h.http(path, h.control, { method, body: {} }), 404, 'NOT_FOUND');
    }
    await empty(await activity(a, false));
    const replacement = await fresh();
    assert.notEqual(replacement.registration_id, a.registration_id);
    for (const heartbeat of [true, false]) await error(await activity(a, heartbeat), 401, 'AUTH_REQUIRED', true);
    await empty(await activity(replacement, true)); // Stale delete did not delete replacement.
    const unchanged = async () => {
      assert.deepEqual((await readdir(h.state)).sort(), stateNames, 'no persisted registration file');
      assert.deepEqual((await readdir(credentials)).sort(), names, 'credential inventory unchanged');
      for (let i = 0; i < paths.length; i++) assert.ok(snapshot[i].equals(await readFile(join(h.state, paths[i]))), 'state bytes unchanged');
      const status = await (await h.http('/v1/status', h.control)).json();
      assert.deepEqual(Object.keys(status).sort(), ['broker', 'requests', 'schema_version']);
      assert.deepEqual(Object.keys(status.broker).sort(), ['pid', 'port', 'started_at']);
      assert.equal(status.schema_version, 1);
      assert.deepEqual(status.requests, []);
      assert.ok(secrets.every(s => !JSON.stringify([status, logs, h.fixture.calls]).includes(s)
        && !snapshot[1].includes(Buffer.from(s))), 'no authority in journal/status/logs/Telegram');
    };
    await unchanged();
    await h.restart(); // Graceful own-lock release; never delete a stale ownership record.
    for (const r of [a, replacement]) await error(await activity(r, true), 401, 'AUTH_REQUIRED', true);
    const afterRestart = await fresh();
    await empty(await activity(afterRestart, true));
    await empty(await activity(afterRestart, false));
    await unchanged();
    assert.equal(h.fixture.messages.length, 0);
    await h.scan();
  }, { pair: false, strictProtocol: true }));
