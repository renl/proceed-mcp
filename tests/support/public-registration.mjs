// TEST ONLY: public executable + real broker behind an observing HTTP fault relay.
// No production imports, private executor seam, clock changes or test endpoints.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { managed, bounded } from './managed-spike.mjs';
import { freePort, stopped } from './startup-guards.mjs';
import { catalogPeer, initializeResult, allTools } from './catalog-consumer.mjs';
export { success } from './portable-waiting.mjs';

export async function observe(check, label, ms = 3000) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail(label);
}
export function outputGuard(child, secrets) {
  const logs = [[], []]; let bytes = 0, overflow = false;
  [child.stdout, child.stderr].forEach((stream, i) => stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= 65536) logs[i].push(Buffer.from(chunk));
    else { overflow = true; child.kill(); }
  }));
  return () => {
    assert.ok(!overflow, 'bounded output consumer, no silent truncation');
    assert.ok(logs.every(chunks => secrets.every(secret =>
      !Buffer.concat(chunks).includes(Buffer.from(secret)))), 'private authority absent through shutdown');
  };
}
export function toolError(outcome, code) {
  assert.ok(outcome.kind === 'response' && !outcome.frame.error, 'tool result, not protocol failure');
  const r = outcome.frame.result;
  assert.ok(r?.isError === true && r.structuredContent?.schema_version === 1, 'versioned tool error');
  assert.equal(r.structuredContent.error.code, code);
  assert.equal(typeof r.structuredContent.error.message, 'string');
  assert.equal(typeof r.structuredContent.error.retryable, 'boolean');
  assert.ok(r.content?.some(b => {
    try { return b.type === 'text' && isDeepStrictEqual(JSON.parse(b.text), r.structuredContent); }
    catch { return false; }
  }), 'matching text and structured error, without printing private output');
  return r.structuredContent.error;
}
export async function publicRegistration(work) {
  const finalChecks = [];
  const result = await managed(async context => {
    const executable = resolve('bin/proceed-mcp.js'), state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: context.directory, TEMP: context.directory, TMPDIR: context.directory });
    const secrets = [], resources = [], connections = [], checks = [], calls = [], sockets = new Set(), cliOutput = [];
    finalChecks.push(() => assert.ok(cliOutput.every(b => secrets.every(s => !b.includes(Buffer.from(s)))),
      'all setup output inspected after credentials become known'));
    const cli = (...args) => {
      const r = spawnSync(process.execPath, [executable, ...args, '--state-dir', state],
        { cwd: context.directory, env, timeout: 10000, maxBuffer: 65536, windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0, 'public fixture CLI succeeds');
      cliOutput.push(Buffer.concat([r.stdout, r.stderr]));
      assert.ok(secrets.every(s => !Buffer.concat([r.stdout, r.stderr]).includes(Buffer.from(s))), 'private setup output');
    };
    cli('init'); cli('owner', 'add', 'shared', '--label', 'Lifecycle test');
    for (const name of ['control.token', 'owner.shared.token'])
      secrets.push((await readFile(join(state, 'credentials', name), 'utf8')).trim());
    const [control, owner] = secrets;
    const configPath = join(state, 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const backend = await freePort();
    const save = port => writeFile(configPath, JSON.stringify({ ...config, broker: { ...config.broker, port } }) + '\n');
    const spawnProduct = (args, preload = false) => {
      const argv = [...(preload ? ['--import', pathToFileURL(resolve('tests/fixtures/startup-guards-preload.mjs')).href] : []),
        executable, ...args, '--state-dir', state];
      const child = spawn(process.execPath, argv, { cwd: context.directory, env, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
      const resource = { child, pid: child.pid, knownPids: [] };
      context.resources.push(resource); resources.push(resource);
      child.on('close', () => { resource.closed = true; });
      checks.push(outputGuard(child, secrets)); finalChecks.push(checks.at(-1));
      return resource;
    };
    const http = (path, token = owner, options = {}) => fetch(`http://127.0.0.1:${backend}${path}`, {
      ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(1000), redirect: 'error' });
    let broker, hold = () => false, mutate = value => value;
    const upstreams = new Set();
    const relay = createServer(async (req, res) => {
      const record = { method: req.method, path: req.url, at: performance.now(), closed: false,
        header: req.headers['x-proceed-registration'], token: req.headers.authorization };
      calls.push(record);
      req.socket.once('close', () => { record.socketClosed = true; record.socketClosedAt = performance.now(); });
      res.on('close', () => { record.closed = true; record.closedAt = performance.now(); });
      try {
        const input = []; for await (const b of req) input.push(b);
        record.body = JSON.parse(Buffer.concat(input).toString() || 'null');
        const up = request({ hostname: '127.0.0.1', port: backend, path: req.url,
          method: req.method, headers: req.headers }, reply => {
          const chunks = []; let size = 0;
          reply.on('data', b => { size += b.length; if (size <= 65536) chunks.push(b); else up.destroy(); });
          reply.on('end', () => {
            const raw = Buffer.concat(chunks); let body;
            try { body = JSON.parse(raw.toString()); } catch { body = null; }
            record.status = reply.statusCode; record.reply = body; record.committed = true;
            if (body?.registration_secret) secrets.push(body.registration_secret);
            // Hold AFTER real server completion: this can lose a committed mutation.
            if (hold(record)) { record.held = true; return; }
            const changed = mutate({ status: reply.statusCode, body }, record);
            res.writeHead(changed.status, { 'content-type': 'application/json' });
            res.end(changed.body === null ? '' : JSON.stringify(changed.body));
          });
        });
        upstreams.add(up); up.on('close', () => upstreams.delete(up));
        up.on('error', () => { if (!res.destroyed) { res.writeHead(503); res.end('{}'); } });
        up.end(Buffer.concat(input));
      } catch { res.destroy(); }
    });
    relay.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(done => relay.listen(0, '127.0.0.1', done));
    const port = relay.address().port;
    const restart = async () => {
      if (broker) await stopped(broker);
      await save(backend); broker = spawnProduct(['serve'], true);
      await observe(async () => { try { return (await http('/v1/status', control)).ok; } catch { return false; } },
        'real broker authenticated readiness', 8000);
      await save(port);
    };
    const connect = async () => {
      const resource = spawnProduct(['mcp', '--owner', 'shared']);
      const peer = catalogPeer(resource.child, { secrets: [control, owner], ms: 3000 });
      connections.push({ resource, peer });
      initializeResult(await peer.call('initialize', { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'public-lifecycle', version: '0' } }).outcome);
      resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      assert.equal((await allTools(peer)).length, 5);
      return { resource, peer, call: (name, args = {}) => peer.call('tools/call', { name, arguments: args }).outcome };
    };
    const eof = async c => {
      const start = performance.now(); c.resource.child.stdin.end();
      await observe(() => c.resource.closed, 'EOF exits within shared 2s plus 750ms process tolerance', 2750);
      assert.equal(c.resource.child.exitCode, 0, 'normal EOF exit'); c.peer.assertComplete();
      return start;
    };
    try {
      await save(port);
      await work({ connect, restart, eof, http, calls, secrets, state, owner, control,
        hold: fn => { hold = fn; }, mutate: fn => { mutate = fn; },
        journal: () => readFile(join(state, 'journal.log')) });
    } finally {
      // Teardown cannot stand in for the tested EOF deadline. Outer harness owns forced recovery.
      for (const c of connections) if (!c.resource.closed) {
        c.resource.child.stdin.end();
        await bounded(() => new Promise(done => c.resource.closed ? done() : c.resource.child.once('close', done)),
          3500, 'recovery EOF deadline').catch(() => {});
      }
      if (broker && !broker.closed) await stopped(broker);
      for (const up of upstreams) up.destroy();
      relay.closeAllConnections();
      await new Promise(done => relay.close(done));
      await observe(() => sockets.size === 0, 'relay accepted sockets closed');
      const probe = createServer();
      await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
    }
  }, { totalMs: 50000 });
  assert.ifError(result.cleanupError);
  for (const check of finalChecks) check();
  assert.ifError(result.assertionError);
}
