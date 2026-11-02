// TEST ONLY: public executable + real broker behind an observing HTTP fault relay.
// No production imports, private executor seam, clock changes or test endpoints.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { Journal } from '../../src/journal/journal.js';
import { join, resolve, basename } from 'node:path';
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
export function outputGuard(child, secrets, { requestSecrets = [], prepareOutput = false } = {}) {
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
    assert.ok((prepareOutput ? logs.slice(1) : logs).every(chunks => requestSecrets.every(secret =>
      !Buffer.concat(chunks).includes(Buffer.from(secret)))), 'request capability absent outside preparation output');
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
export async function publicRegistration(work, { paired = false, foreign = false, totalMs = 50000,
  transportErrors = false } = {}) {
  const finalChecks = [];
  let progress;
  const result = await bounded(() => managed(async context => {
    await mkdir(resolve('.scratch/public-registration'), { recursive: true });
    progress = phase => writeFile(resolve('.scratch/public-registration', `${basename(context.directory)}.json`),
      JSON.stringify({ phase, namespace: basename(context.directory) }));
    await progress('setup');
    const executable = resolve('bin/proceed-mcp.js'), state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: context.directory, TEMP: context.directory, TMPDIR: context.directory });
    const secrets = [], requestSecrets = [], resources = [], connections = [], checks = [], calls = [], sockets = new Set(), cliOutput = [];
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
    if (foreign) cli('owner', 'add', 'foreign', '--label', 'Other principal');
    if (paired) {
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
      const at = '2026-01-01T00:00:00.000Z', hash = 'a'.repeat(64);
      const seed = await Journal.open(join(state, 'journal.log'));
      try {
        await seed.append([{ op: 'pairing.challenge', hash, created_at: at, expires_at: '2026-01-01T00:05:00.000Z' }]);
        await seed.append([{ op: 'pairing.challenge.consume', hash, consumed_at: at },
          { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: at } }]);
      } finally { await seed.close(); }
    }
    for (const name of ['control.token', 'owner.shared.token'])
      secrets.push((await readFile(join(state, 'credentials', name), 'utf8')).trim());
    const [control, owner] = secrets;
    if (foreign) secrets.push((await readFile(join(state, 'credentials', 'owner.foreign.token'), 'utf8')).trim());
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
      checks.push(outputGuard(child, secrets, { requestSecrets, prepareOutput: args[0] === 'mcp' })); finalChecks.push(checks.at(-1));
      return resource;
    };
    const http = (path, token = owner, options = {}) => fetch(`http://127.0.0.1:${backend}${path}`, {
      ...options, headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), 'content-type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(1000), redirect: 'error' });
    let broker, hold = () => false, mutate = value => value;
    const upstreams = new Set();
    const relay = createServer(async (req, res) => {
      const record = { method: req.method, path: req.url, at: performance.now(), closed: false,
        header: req.headers['x-proceed-registration'], token: req.headers.authorization,
        capability: req.headers['x-proceed-request-capability'] };
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
            record.release = () => {
              if (record.released || res.destroyed) return;
              record.released = true;
              const changed = mutate({ status: reply.statusCode, body }, record);
              res.writeHead(changed.status, { 'content-type': 'application/json' });
              res.end(changed.body === null ? '' : JSON.stringify(changed.body));
            };
            if (hold(record)) {
              record.held = true; record.heldAt = performance.now();
              record.heldSocketOpen = !req.socket.destroyed;
              return;
            }
            record.release();
          });
        });
        upstreams.add(up); up.on('close', () => { record.upstreamClosed = true; upstreams.delete(up); });
        up.on('error', () => {
          record.upstreamErrorAt = performance.now();
          if (transportErrors) res.destroy();
          else if (!res.destroyed) { res.writeHead(503); res.end('{}'); }
        });
        up.end(Buffer.concat(input));
      } catch { res.destroy(); }
    });
    relay.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(done => relay.listen(0, '127.0.0.1', done));
    const port = relay.address().port;
    const stop = async () => {
      if (broker) await stopped(broker);
      broker = null;
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
    };
    const restart = async () => {
      await stop();
      await save(backend); broker = spawnProduct(['serve'], true);
      await observe(async () => { try { return (await http('/v1/status', control)).ok; } catch { return false; } },
        'real broker authenticated readiness', 8000);
      await save(port);
    };
    const connect = async (ownerId = 'shared', { observeOutput = () => {} } = {}) => {
      const resource = spawnProduct(['mcp', '--owner', ownerId]);
      observeOutput(resource.child); // Independent observer attaches before protocol/setup events.
      const peer = catalogPeer(resource.child, { secrets, ms: 3000 });
      connections.push({ resource, peer });
      const init = initializeResult(await peer.call('initialize', { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'public-lifecycle', version: '0' } }).outcome);
      resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const tools = await allTools(peer); assert.equal(tools.length, 5);
      return { resource, peer, init, tools, call: (name, args = {}, options) => peer.call('tools/call', { name, arguments: args }, options).outcome };
    };
    const eof = async c => {
      let lateOutput = false;
      c.resource.child.stdout.on('data', () => { lateOutput = true; });
      const start = performance.now(); c.resource.child.stdin.end();
      await observe(() => c.resource.closed, 'EOF exits within shared 2s plus 750ms process tolerance', 2750);
      assert.equal(c.resource.child.exitCode, 0, 'normal EOF exit'); c.peer.assertComplete();
      assert.ok(!lateOutput, 'no stdout frames after EOF');
      return start;
    };
    try {
      await save(port);
      await progress('execution');
      await work({ connect, restart, stop, eof, http, calls, secrets, requestSecrets, state, owner, control,
        phase: progress,
        hold: fn => { hold = fn; }, mutate: fn => { mutate = fn; },
        journal: () => readFile(join(state, 'journal.log')) });
    } finally {
      await progress('teardown');
      // Teardown cannot stand in for the tested EOF deadline. Outer harness owns forced recovery.
      for (const c of connections) if (!c.resource.closed) {
        c.resource.child.stdin.end();
        await bounded(() => new Promise(done => c.resource.closed ? done() : c.resource.child.once('close', done)),
          3500, 'recovery EOF deadline').catch(() => {});
      }
      if (broker && !broker.closed) await stopped(broker);
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
      for (const up of upstreams) up.destroy();
      relay.closeAllConnections();
      await new Promise(done => relay.close(done));
      await observe(() => sockets.size === 0, 'relay accepted sockets closed');
      const probe = createServer();
      await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
      const backendProbe = createServer();
      await new Promise((done, reject) => { backendProbe.once('error', reject); backendProbe.listen(backend, '127.0.0.1', done); });
      await new Promise(done => backendProbe.close(done));
    }
  }, { totalMs }), totalMs + 10000, 'public registration aggregate setup/execution/teardown deadline');
  if (progress) await progress(result.cleanupError ? 'cleanup-failed' : 'cleaned');
  assert.ifError(result.cleanupError);
  for (const check of finalChecks) check();
  assert.ifError(result.assertionError);
}
