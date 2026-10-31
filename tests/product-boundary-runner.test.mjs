// All successes in this file are OFFLINE PROXIES, not OpenCode/Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { publicHTTP, hostAdapters, exactTool, assertTimeout } from './support/public-host.mjs';
import { alive, bounded } from './support/managed-spike.mjs';
import { runProductAcceptance } from './product-boundary-acceptance.mjs';

test('PROXY: missing environment or containment prevents launch; cleanup is independently reported', async () => {
  for (const stage of ['environment', 'containment']) {
    const calls = [];
    const binding = {
      async assertEnvironment() { calls.push('environment'); if (stage === 'environment') throw Error('missing env'); },
      async prepare() { assert.fail('must not launch/prepare'); },
      containment: {
        async verify() { calls.push('containment'); throw Error('missing job containment'); },
        async cleanupAndVerify() { calls.push('cleanup'); },
      },
    };
    await assert.rejects(runProductAcceptance(binding), /assertions=RED\(BINDING_OR_HARNESS\) cleanup=PASS/);
    assert.deepEqual(calls, stage === 'environment' ? ['environment', 'cleanup'] :
      ['environment', 'containment', 'cleanup']);
  }
});

test('PROXY: concrete public host routes, fixed auth, pagination, invocation and timeout extraction', async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Basic Zml4dHVyZQ==');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    seen.push({ method: request.method, path: request.url,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined });
    response.setHeader('content-type', 'application/json');
    if (request.url.includes('/message?')) response.end(JSON.stringify({ data: [{ type: 'assistant',
      content: [{ type: 'tool', id: 'tool1', name: 'proceed_request_approval',
        state: { status: 'error', input: { client_request_id: 'case1' },
          error: { type: 'calibrated-fixture', message: 'fixture timeout' } } }] }], cursor: {} }));
    else response.end(JSON.stringify({ data: { id: 'msg_fixture' } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const host = hostAdapters(publicHTTP(`http://127.0.0.1:${server.address().port}`, 'Basic Zml4dHVyZQ=='), 'ses_fixture');
    await host.info(); await host.session();
    await host.invoke('msg_fixture', 'controlled text');
    const part = exactTool(await host.tools(), 'proceed_request_approval', 'case1')[0];
    assertTimeout(part, { type: 'calibrated-fixture', message: 'fixture timeout' });
    assert.throws(() => assertTimeout(part, { type: 'network-error', message: 'fixture timeout' }));
    assert.deepEqual(seen.slice(0, 3), [
      { method: 'GET', path: '/api/info', body: undefined },
      { method: 'GET', path: '/api/session/ses_fixture', body: undefined },
      { method: 'POST', path: '/api/session/ses_fixture/prompt', body: {
        id: 'msg_fixture', text: 'controlled text', delivery: 'steer', resume: true } },
    ]);
  } finally { await new Promise((done) => server.close(done)); }
});

test('PROXY: HTTP invocation distinguishes environment/auth from behavior/redirect/schema errors', async () => {
  const server = http.createServer((request, response) => {
    response.statusCode = Number(request.url.slice(1)); response.end('not json');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const call = publicHTTP(`http://127.0.0.1:${server.address().port}`, 'Basic Zml4dHVyZQ==');
    for (const [status, kind] of [[401, 'ENVIRONMENT'], [503, 'ENVIRONMENT'], [302, 'BEHAVIOR'],
      [400, 'BEHAVIOR'], [200, 'BEHAVIOR']]) {
      await assert.rejects(call('POST', `/${status}`, {}), (error) => error.kind === kind);
    }
  } finally { await new Promise((done) => server.close(done)); }
});

test('PROXY: separately managed direct client suppresses selected real completion, no forwarding listener', async () => {
  const hits = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Basic Zml4dHVyZQ==');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    hits.push({ path: request.url, body });
    response.end(JSON.stringify({ data: { id: body.id, sessionID: 'ses_fixture', type: 'user',
      payload: { text: body.text }, delivery: body.delivery } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const child = fork(resolve('tests/support/direct-host-gate.mjs'), [], { env: {}, silent: true });
  const events = []; child.on('message', (message) => events.push(message));
  child.stdout.resume(); child.stderr.resume();
  const wait = (kind, serial) => bounded(async () => {
    const match = (event) => event.kind === kind && (serial === undefined || event.serial === serial);
    while (!events.some(match)) {
      assert.equal(child.exitCode, null);
      await new Promise((done) => setTimeout(done, 5));
    }
    return events.find(match);
  }, 3000, `gate ${kind} deadline`);
  try {
    child.send({ kind: 'configure', origin: `http://127.0.0.1:${port}`, authorization: 'Basic Zml4dHVyZQ==' });
    await wait('ready');
    const id = `msg_${'c'.repeat(32)}`;
    const path = '/api/session/ses_fixture/prompt';
    child.send({ kind: 'select', path, id }); await wait('armed');
    child.send({ kind: 'exchange', serial: 'unrelated:0', method: 'POST', path,
      body: { id: 'msg_unrelated', text: 'other input', delivery: 'steer', resume: true } });
    assert.equal((await wait('result', 'unrelated:0')).body.data.payload.text, 'other input');
    child.send({ kind: 'exchange', serial: 'old:1', method: 'POST', path,
      body: { id, text: 'unchanged', delivery: 'steer', resume: true } });
    await wait('suppressed');
    assert.equal((await wait('host-completed')).body.data.payload.text, 'unchanged');
    assert.equal((await wait('result', 'old:1')).transportLoss, true);
    // Production reconciliation is fenced; independent reads are NOT gated.
    child.send({ kind: 'exchange', serial: 'new:2', method: 'GET', path: '/api/info' });
    await wait('reconciliation-fenced');
    assert.equal(hits.length, 2);
    child.send({ kind: 'discard-held' }); await wait('discarded');
    await publicHTTP(`http://127.0.0.1:${port}`, 'Basic Zml4dHVyZQ==')('GET', '/api/info');
    assert.equal(events.some((event) => event.kind === 'result' && event.serial === 'new:2'), false);
    child.send({ kind: 'exchange', serial: 'new:3', method: 'GET', path: '/api/info' });
    await wait('result', 'new:3');
    assert.equal(hits.length, 4);
  } finally {
    const exited = once(child, 'exit'); child.kill();
    await bounded(() => exited, 3000, 'gate cleanup deadline');
    assert.equal(alive(child.pid), false);
    await new Promise((done) => server.close(done));
    const probe = http.createServer();
    await new Promise((done, fail) => probe.once('error', fail).listen(port, '127.0.0.1', done));
    await new Promise((done) => probe.close(done));
  }
});
