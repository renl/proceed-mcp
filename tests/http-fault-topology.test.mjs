import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { managed, bounded, alive } from './support/managed-spike.mjs';
import { authenticatedReader } from './support/spike-runner.mjs';

const fixture = resolve('tests/fixtures/http-spike-process.mjs');
const origin = (port) => `http://127.0.0.1:${port}`;
const read = (url, options = {}) => fetch(url, { ...options, redirect: 'error',
  signal: AbortSignal.timeout(1500) });
async function assertReleased(ports) {
  for (const port of ports) {
    const socket = net.createServer();
    try {
      await bounded(() => new Promise((done, fail) => {
        socket.once('error', fail);
        socket.listen(port, '127.0.0.1', done);
      }), 1000, 'listener not released');
    } finally {
      if (socket.listening) await new Promise((done) => socket.close(done));
    }
  }
}

test('HTTP-FAULT: separate fixed-origin fault loses only selected response after admission', async () => {
  const ports = [];
  const result = await managed(async (ctx) => {
    const host = await ctx.start([process.execPath, fixture, 'host']);
    const hostPort = host.events[0].port;
    ports.push(hostPort);
    const fault = await ctx.start([process.execPath, fixture, 'fault', origin(hostPort)]);
    const port = fault.events[0].port;
    ports.push(port);
    const fixedOrigin = origin(port); // configured once, before any request
    const headers = { authorization: 'Basic fixture-only', 'content-type': 'application/json' };
    const health = await (await read(`${fixedOrigin}/api/session/target/inbox`, { headers })).json();
    assert.equal(health.fixtureAuthorization, headers.authorization);
    const authenticated = authenticatedReader(fixedOrigin, headers.authorization);
    assert.equal((await authenticated('/api/session/target/inbox')).fixtureAuthorization, headers.authorization);
    await assert.rejects(authenticated('/redirect'), /no redirects/);
    fault.child.send({ kind: 'arm', id: 'msg_selected' });
    await fault.wait('armed');
    const payload = { id: 'msg_selected', text: 'fixture exact bytes\n ', delivery: 'steer', resume: true };
    const post = () => read(`${fixedOrigin}/api/session/target/prompt`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    await assert.rejects(post());
    assert.equal((await fault.wait('response-lost')).id, payload.id);
    // Same origin and destination on retry; no inline fixture fallback.
    assert.equal((await (await post()).json()).data.id, payload.id);
    const history = await (await read(`${fixedOrigin}/api/session/target/message?type=user`, { headers })).json();
    assert.deepEqual(history.data, [payload]);
    const unrelated = await read(`${fixedOrigin}/api/session/target/prompt`, {
      method: 'POST', headers, body: JSON.stringify({ ...payload, id: 'msg_unrelated' }),
    });
    assert.equal(unrelated.status, 200);
    assert.ok(alive(host.pid) && alive(fault.pid));
  });
  assert.ifError(result.assertionError);
  assert.ifError(result.cleanupError);
  await assertReleased(ports);
});

for (const fail of [false, true]) {
  test(`TOPOLOGY: registered listener survives intermediate exit; failure=${fail}; all listeners released`, async () => {
    const ports = [];
    const result = await managed(async (ctx) => {
      // Logical host, broker, HTTP fault, MCP supervisor/leaf. These are
      // controlled fixtures, NOT arbitrary real executable containment proof.
      for (const role of ['host', 'host', 'fault', 'intermediate']) {
        const resource = await ctx.start([process.execPath, fixture, role,
          ...(role === 'fault' ? [origin(ports[0])] : [])]);
        ports.push(resource.events[0].port);
        assert.equal((await read(`${origin(ports.at(-1))}/api/session/target/inbox`)).status, 200);
        if (role === 'intermediate') {
          assert.ok(alive(resource.knownPids[0]), JSON.stringify(resource.events));
          resource.child.send({ kind: 'exit-intermediate' });
          await bounded(async () => {
            while (!resource.closed) await delay(10);
          }, 1500, 'intermediate did not exit');
          assert.equal(alive(resource.knownPids[0]), true,
            await readFile(resolve(ctx.directory, 'leaf-stderr.log'), 'utf8'));
        }
      }
      if (fail) assert.fail('injected assertion failure after readiness');
    });
    assert.ifError(result.cleanupError);
    await assertReleased(ports);
    if (fail) assert.match(result.assertionError?.message, /injected assertion failure/);
    else assert.ifError(result.assertionError);
  });
}

test('TOPOLOGY-READINESS: listening is not ready; finite readiness failure releases reserved listener', async () => {
  const result = await managed(async (ctx) => {
    await ctx.start([process.execPath, fixture, 'never-ready']);
  }, { readyMs: 500 });
  assert.ifError(result.cleanupError);
  const event = result.resources[0].events.find((item) => item.kind === 'listening');
  assert.ok(event, 'fixture must reach listening but withhold readiness');
  await assertReleased([event.port]);
  assert.match(result.assertionError?.message, /deadline waiting for ready/);
});
