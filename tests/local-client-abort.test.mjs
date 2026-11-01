// TEST ONLY: finite in-process real node:http fixture; no product test hook.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once, getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createLocalClient } from '../src/http/local-client.js';
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('HTTP did not settle within 500ms'), { code: 'TEST_DEADLINE' })), 500);
  })]); } finally { clearTimeout(timer); }
}
async function fixture(run) {
  const sockets = new Set(); let connections = 0;
  const server = http.createServer();
  server.on('connection', socket => { connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await bounded(once(server, 'listening'));
  const port = server.address().port;
  const client = createLocalClient({ port, token: 'test-only-owner', timeoutMs: 2000 });
  try { await run({ server, client, sockets, connections: () => connections }); }
  finally {
    const closed = [...sockets].map(socket => { const done = once(socket, 'close'); socket.destroy(); return done; });
    await bounded(Promise.all(closed));
    await bounded(new Promise(resolve => server.close(resolve)));
    assert.equal(server.listening, false); assert.equal(sockets.size, 0, 'owned fixture sockets closed');
    const probe = http.createServer(); probe.listen(port, '127.0.0.1');
    await bounded(once(probe, 'listening')); await new Promise(resolve => probe.close(resolve));
  }
}
test('PORT-HTTP-ABORT: pre-aborted signal opens no socket; cancellation listener removed', { timeout: 4000 }, async () => {
  await fixture(async ({ client, connections }) => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(bounded(client.request('POST', '/v1/adapter', {}, {}, { signal: controller.signal })),
      error => error.code !== 'TEST_DEADLINE');
    await delay(30); assert.equal(connections(), 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
});
test('PORT-HTTP-ABORT: actual stalled request/partial response transport is destroyed', { timeout: 5000 }, async () => {
  for (const partial of [false, true]) await fixture(async ({ server, client, sockets }) => {
    const received = once(server, 'request'), controller = new AbortController();
    const pending = client.request('POST', '/v1/adapter', {}, {}, { signal: controller.signal });
    pending.catch(() => {});
    const [request, response] = await bounded(received); request.resume();
    assert.equal(request.headers.authorization, 'Bearer test-only-owner');
    if (partial) { response.writeHead(201, { 'content-type': 'application/json' }); response.write('{'); }
    const socket = request.socket, closed = once(socket, 'close');
    controller.abort(); await assert.rejects(bounded(pending), error => error.code !== 'TEST_DEADLINE'); await bounded(closed);
    assert.equal(socket.destroyed, true); assert.equal(sockets.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
});
test('PORT-HTTP-ABORT: post-settlement abort is no-op and listener is detached', { timeout: 4000 }, async () => {
  await fixture(async ({ server, client, connections }) => {
    server.on('request', (req, res) => { req.resume(); res.writeHead(204); res.end(); });
    const controller = new AbortController();
    assert.equal((await client.request('POST', '/v1/adapter', {}, {}, { signal: controller.signal })).status, 204);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    controller.abort(); await delay(20); assert.equal(connections(), 1);
  });
});
