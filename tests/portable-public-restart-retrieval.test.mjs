// TEST ONLY: design3/7. Pairing is setup; every request is public POST-created.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { open, readFile, writeFile, access } from 'node:fs/promises';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { startExpirySchedule, SWEEP_INTERVAL_MS } from '../src/broker/expiry-schedule.js';
import { managed, bounded } from './support/managed-spike.mjs';
import { freePort, stopped, completed } from './support/startup-guards.mjs';
import { outputGuard, observe, success, toolError } from './support/public-registration.mjs';
import { catalogPeer, initializeResult, allTools } from './support/catalog-consumer.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const rows = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const closures = bytes => rows(bytes).filter(m => m.op === 'request.expire');
const headers = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
const auth = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const input = p => ({ request_handle: p.request_handle, client_request_id: 'key', action: 'Offline question?', context: '', expires_in_seconds: 60 });
const denied = { status: 404, body: { schema_version: 1, error: { code: 'NOT_FOUND', message: 'no such request', retryable: false } } };
const storage = { status: 500, body: { schema_version: 1, error: { code: 'STORAGE_FAILURE', message: 'the broker could not complete the request', retryable: false } } };
const logLine = 'expiry scheduling stopped after a storage failure; stop and restart serve';
async function seedPairing(path) {
  const j = await Journal.open(path), at = '2026-01-01T00:00:00.000Z', hash = 'a'.repeat(64);
  try {
    await j.append([{ op: 'pairing.challenge', hash, created_at: at, expires_at: '2026-01-01T00:05:00.000Z' }]);
    await j.append([{ op: 'pairing.challenge.consume', hash, consumed_at: at },
      { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: at } }]);
  } finally { await j.close(); }
}
function privateOutput(text, secrets) {
  assert.ok(secrets.every(s => !text.includes(s)), 'bounded raw output contains no private authority');
  assert.doesNotMatch(text, /capability_hash|pairing_snapshot|registration_secret/);
}
async function rebind(port) {
  const probe = createServer();
  try { await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); }); }
  finally { if (probe.listening) await new Promise(done => probe.close(done)); }
}
async function watched(work, totalMs) {
  const rejections = [], warnings = [];
  const rejection = e => rejections.push(e), warning = e => warnings.push(e);
  process.on('unhandledRejection', rejection); process.on('warning', warning);
  let result;
  try { result = await managed(work, { totalMs }); }
  finally { process.off('unhandledRejection', rejection); process.off('warning', warning); }
  assert.ifError(result.cleanupError); assert.deepEqual(rejections, []); assert.deepEqual(warnings, []);
  assert.ifError(result.assertionError);
}

test('B-SCHEDULE: actual fixed scheduler preappend fault latches before queued public followers; no effects or denial masking',
  { timeout: 20000 }, () => watched(async ctx => {
    const path = join(ctx.directory, 'journal.log'), port = await freePort(); await seedPairing(path);
    let samples = 0, fault = false, allocations = 0, appends = 0, syncs = 0, armed = false;
    const entered = deferred(), release = deferred(), scheduled = deferred();
    const originalRandom = crypto.randomBytes;
    // Instrument the ordinary FileHandle used by a separate Journal, not a fake append.
    const recovered = await Journal.open(path), sequence = recovered.sequence; await recovered.close();
    const handle = await open(path, 'a');
    const journal = new Journal(path, { write: async (...args) => { appends++; return handle.write(...args); },
      sync: async () => { syncs++; if (armed) { entered.resolve(); await release.promise; } return handle.sync(); },
      close: () => handle.close() }, sequence);
    const owner = '1'.repeat(64), foreign = '2'.repeat(64), control = '3'.repeat(64), secrets = [owner, foreign, control];
    const b = createPortableBroker({ journal, owners: [{ owner_id: 'a', label: 'A' }, { owner_id: 'b', label: 'B' }], port,
      clock: () => { samples++; if (fault) throw new Error('private-clock-path'); return Date.now(); } });
    const logs = [], serverLogs = [], sockets = new Set(), pending = []; let schedule, server;
    const raw = (method, path, body, token = owner, extra = {}) => {
      const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const p = new Promise((done, reject) => {
        const req = request({ host: '127.0.0.1', port, method, path, headers: { ...extra,
          ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(bytes ? { 'content-length': bytes.length } : {}) } }, res => {
          const chunks = []; let size = 0;
          res.on('data', c => { size += c.length; if (size > 65536) res.destroy(new Error('HTTP overflow')); else chunks.push(c); });
          res.on('error', reject); res.on('end', () => {
            try { const text = Buffer.concat(chunks).toString(); privateOutput(text, secrets); done({ status: res.statusCode, body: JSON.parse(text) }); }
            catch (e) { reject(e); }
          });
        });
        req.on('error', reject); req.on('socket', s => { if (!sockets.has(s)) { sockets.add(s); s.once('close', () => sockets.delete(s)); } });
        req.setTimeout(5000, () => req.destroy(new Error('HTTP deadline'))); req.end(bytes);
      });
      p.catch(() => {}); pending.push(p); return p;
    };
    const post = (p, value = input(p), token = owner, extra = headers(p)) => raw('POST', '/v1/requests', value, token, extra);
    const get = (p, token = owner, extra = headers(p)) => raw('GET', `/v1/requests/${p.request_id}`, undefined, token, extra);
    try {
      await b.recover(); server = createPortableServer({ broker: b, port,
        credentials: { control, owners: new Map([['a', owner], ['b', foreign]]) }, logger: line => serverLogs.push(line) });
      await server.listen(); server.markReady();
      const reserve = async () => { const r = await raw('POST', '/v1/handles', {}); assert.equal(r.status, 201); secrets.push(r.body.request_capability); return r.body; };
      const p = await reserve(), q = await reserve(); assert.equal((await post(p)).status, 201);
      const beforeSnapshot = b.snapshot();
      crypto.randomBytes = (...args) => { allocations++; return originalRandom(...args); }; syncBuiltinESMExports();
      armed = true; const held = raw('POST', '/v1/handles', {});
      await bounded(() => entered.promise, 1500, 'public admitted reservation held at actual sync');
      assert.equal(allocations, 3); const sweep = b.scheduledSweep.bind(b); let sweepCalls = 0;
      b.scheduledSweep = () => { sweepCalls++; const p = sweep(); scheduled.resolve(); return p; };
      assert.equal(SWEEP_INTERVAL_MS, 1000);
      schedule = startExpirySchedule({ broker: b, logger: (...args) => logs.push(args) });
      await bounded(() => scheduled.promise, 2500, 'production fixed scheduler queued behind admitted sync');
      let invoked = 0, settled = 0;
      for (const name of ['createRequest', 'readRequest', 'reserveHandle', 'status']) {
        const original = b[name].bind(b);
        b[name] = (...args) => { invoked++; return original(...args); };
      }
      const followers = [post(p), post(q), get(p), raw('POST', '/v1/handles', {}), raw('GET', '/v1/status', undefined, control)];
      followers.forEach(p => p.then(() => settled++, () => settled++));
      await observe(() => invoked === 5, 'all five HTTP followers reached real queued core', 1500);
      await delay(20); assert.equal(settled, 0);
      const bytes = await readFile(path), counts = { samples, allocations, appends, syncs };
      fault = true;
      assert.deepEqual(await get(p, foreign), denied); assert.deepEqual(await post(q, input(q), owner, {}), denied);
      for (const [token, extra, status, code] of [[null, {}, 401, 'AUTH_REQUIRED'], [control, {}, 403, 'FORBIDDEN'],
        [null, { origin: 'https://browser.invalid' }, 403, 'FORBIDDEN']]) {
        const r = await raw('POST', '/v1/requests', '{', token, extra); assert.equal(r.status, status); assert.equal(r.body.error.code, code);
      }
      const invalid = await post(q, { ...input(q), action: '' }, owner, {});
      assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, 'INVALID_ARGUMENT');
      assert.deepEqual({ samples, allocations, appends, syncs }, counts);
      release.resolve(); const admitted = await held; assert.equal(admitted.status, 201); secrets.push(admitted.body.request_capability);
      for (const r of await Promise.all(followers)) assert.deepEqual(r, storage);
      await observe(() => schedule.failed, 'actual scheduled failure contained');
      assert.deepEqual(logs, [[logLine]]); assert.equal(samples, counts.samples + 1);
      assert.equal(allocations, counts.allocations); assert.equal(appends, counts.appends); assert.equal(syncs, counts.syncs);
      assert.deepEqual(b.snapshot().requests, beforeSnapshot.requests); assert.equal(b.snapshot().prepared.length, beforeSnapshot.prepared.length + 1);
      assert.equal(closures(await readFile(path)).length, 0); assert.deepEqual(await readFile(path), bytes);
      for (const r of [await post(q), await get(p), await raw('POST', '/v1/handles', {}), await raw('GET', '/v1/status', undefined, control)]) assert.deepEqual(r, storage);
      assert.deepEqual(await get(p, foreign), denied); assert.deepEqual(await post(q, input(q), owner, {}), denied);
      const afterInvalid = await post(q, { ...input(q), context: null }); assert.equal(afterInvalid.status, 400);
      await delay(2200); assert.equal(sweepCalls, 1); assert.deepEqual(logs, [[logLine]]);
      assert.deepEqual({ samples, allocations, appends, syncs }, { ...counts, samples: counts.samples + 1 });
      assert.deepEqual(await readFile(path), bytes); privateOutput(JSON.stringify([logs, serverLogs]), secrets);
      assert.ok(serverLogs.every(line => line === 'broker request failed: STORAGE_FAILURE'), 'HTTP diagnostics stay fixed and redacted');
    } finally {
      release.resolve(); await Promise.allSettled(pending);
      try { await schedule?.stop(); await server?.close(); await b.close(); }
      finally { await journal.close(); crypto.randomBytes = originalRandom; syncBuiltinESMExports(); }
      await assert.rejects(handle.stat(), { code: 'EBADF' });
      await observe(() => sockets.size === 0, 'composition sockets absent'); await rebind(port);
    }
  }, 16000));

test('B-RESTART: real public creation crosses unchanged60s deadline stopped; flush before earliest listen; expired MCP/EOF/status retention',
  { timeout: 105000 }, () => watched(async ctx => {
    const executable = resolve('bin/proceed-mcp.js'), state = join(ctx.directory, 'state'), path = join(state, 'journal.log');
    const preload = pathToFileURL(resolve('tests/fixtures/public-restart-preload.mjs')).href;
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: ctx.directory, TEMP: ctx.directory, TMPDIR: ctx.directory });
    const setupOutput = [], checks = [], connections = [], secrets = [], requestSecrets = [], children = [];
    const cli = (...args) => {
      const r = spawnSync(process.execPath, [executable, ...args, '--state-dir', state], { cwd: ctx.directory, env, timeout: 10000, maxBuffer: 65536, windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0); setupOutput.push(Buffer.concat([r.stdout, r.stderr]));
    };
    cli('init'); cli('owner', 'add', 'shared', '--label', 'Restart'); cli('owner', 'add', 'foreign', '--label', 'Foreign');
    for (const name of ['control.token', 'owner.shared.token', 'owner.foreign.token']) secrets.push((await readFile(join(state, 'credentials', name), 'utf8')).trim());
    const [control, owner] = secrets, configPath = join(state, 'config.json'), config = JSON.parse(await readFile(configPath));
    const port = await freePort(); config.broker.port = port; await writeFile(configPath, JSON.stringify(config) + '\n');
    await seedPairing(path);
    const start = args => {
      const serve = args[0] === 'serve';
      const child = spawn(process.execPath, [...(serve ? ['--import', preload] : []), executable, ...args, '--state-dir', state],
        { cwd: ctx.directory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
      const r = { child, pid: child.pid, knownPids: [], events: [] }; ctx.resources.push(r); children.push(r);
      child.on('close', () => { r.closed = true; }); child.on('error', e => { r.error = e; });
      child.on('message', e => { assert.ok(r.events.length < 100, 'bounded startup events'); r.events.push(e); });
      checks.push(outputGuard(child, secrets, { requestSecrets, prepareOutput: args[0] === 'mcp' })); return r;
    };
    const sockets = new Set(), pending = [];
    const wire = (method, route, body, token = owner, extra = {}) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const p = new Promise((done, reject) => {
        const req = request({ host: '127.0.0.1', port, method, path: route,
          headers: { authorization: `Bearer ${token}`, ...extra, ...(bytes ? { 'content-length': bytes.length } : {}) } }, res => {
          const chunks = []; let size = 0;
          res.on('data', c => { size += c.length; if (size > 65536) res.destroy(new Error('HTTP overflow')); else chunks.push(c); });
          res.on('error', reject); res.on('end', () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject); req.on('socket', s => { if (!sockets.has(s)) { sockets.add(s); s.once('close', () => sockets.delete(s)); } });
        req.setTimeout(2000, () => req.destroy(new Error('HTTP deadline'))); req.end(bytes);
      });
      p.catch(() => {}); pending.push(p); return p;
    };
    const http = async (...args) => {
      const r = await wire(...args); privateOutput(r.text, [...secrets, ...requestSecrets]); return { status: r.status, body: JSON.parse(r.text) };
    };
    let broker;
    const boot = async inspect => {
      broker = start(['serve']);
      // No HTTP/status before the prearmed listener + completed-sync proof is consumed.
      await observe(() => broker.events.some(e => e.kind === 'startup-proof'), 'earliest listen evidence', 8000);
      const proof = broker.events.find(e => e.kind === 'startup-proof');
      assert.ok(proof.syncs >= 2); assert.equal(proof.flushed, proof.bytes, 'entire startup journal passed actual sync before listen');
      await inspect(Buffer.from(proof.bytes, 'base64'));
      await observe(() => broker.events.some(e => e.kind === 'listening'), 'actual listen event');
      await observe(async () => { try { return (await http('GET', '/v1/status', undefined, control)).status === 200; } catch { return false; } }, 'postproof readiness', 8000);
    };
    const connect = async (id = 'shared') => {
      const resource = start(['mcp', '--owner', id]), peer = catalogPeer(resource.child, { secrets, ms: 3000 });
      const c = { resource, peer, call: (name, args) => peer.call('tools/call', { name, arguments: args }).outcome }; connections.push(c);
      initializeResult(await peer.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'restart-proof', version: '0' } }).outcome);
      resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      assert.equal((await allTools(peer)).length, 5); return c;
    };
    const eof = async c => { c.resource.child.stdin.end(); assert.equal(await completed(c.resource), 0); c.peer.assertComplete(); };
    try {
      await boot(async bytes => assert.equal(closures(bytes).length, 0));
      const first = await connect(), p = success(await first.call('prepare_approval', {})); requestSecrets.push(p.request_capability);
      const beforeCreate = Date.now(), made = await http('POST', '/v1/requests', input(p), owner, headers(p)); assert.equal(made.status, 201);
      const value = made.body, deadline = Date.parse(value.expires_at);
      assert.equal(value.resolution, 'pending'); assert.equal(deadline - Date.parse(value.created_at), 60000);
      assert.ok(Date.parse(value.created_at) >= beforeCreate && Date.parse(value.created_at) <= Date.now());
      const createdRows = rows(await readFile(path)).filter(m => m.op === 'request.create'); assert.equal(createdRows.length, 1);
      assert.equal(createdRows[0].expires_at, value.expires_at); assert.equal(createdRows[0].request_handle, p.request_handle);
      await eof(first); await stopped(broker); assert.ok(Date.now() < deadline, 'gracefully stopped while future');
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
      const stoppedBytes = await readFile(path); assert.equal(closures(stoppedBytes).length, 0);
      await delay(Math.max(0, deadline - Date.now() + 30), undefined, { signal: ctx.signal });
      assert.ok(Date.now() >= deadline); assert.deepEqual(await readFile(path), stoppedBytes, 'stopped wait never rewrites deadline/history');
      let terminalRows;
      await boot(async bytes => {
        terminalRows = closures(bytes); assert.equal(terminalRows.length, 1); const [m] = terminalRows;
        assert.equal(m.request_id, p.request_id); assert.match(m.decision_id, /^dec_[a-f0-9]{32}$/);
        assert.ok(Date.parse(m.resolved_at) >= deadline); assert.equal(m.delivery_state, 'unavailable');
        assert.deepEqual(rows(bytes).filter(m => m.op === 'request.create'), createdRows);
      });
      const terminal = { ...value, resolution: 'expired', resolved_at: terminalRows[0].resolved_at,
        decision_id: terminalRows[0].decision_id, delivery_state: 'unavailable' };
      const bytes = await readFile(path), a = await connect();
      const outcome = await a.call('get_approval', auth(p)); privateOutput(JSON.stringify(outcome), [...secrets, ...requestSecrets]); assert.deepEqual(success(outcome), terminal);
      const foreign = await connect('foreign'), denial = await foreign.call('get_approval', auth(p));
      privateOutput(JSON.stringify(denial), [...secrets, ...requestSecrets]); toolError(denial, 'NOT_FOUND'); await eof(foreign);
      await eof(a); const replacement = await connect(), transferred = await replacement.call('get_approval', auth(p));
      privateOutput(JSON.stringify(transferred), [...secrets, ...requestSecrets]); assert.deepEqual(success(transferred), terminal);
      toolError(await replacement.call('request_approval', { ...input(p), request_capability: p.request_capability }), 'ENHANCEMENT_UNAVAILABLE');
       for (const [name, args] of [['acknowledge_approval', { ...auth(p), decision_id: terminal.decision_id }]])
        assert.equal((await replacement.call(name, args)).frame.result.isError, true);
      await eof(replacement);
       // Only after EOF/release: valid ephemeral authority must not enable A2b/B.
      const registrationResponse = await wire('POST', '/v1/adapter', {});
      assert.equal(registrationResponse.status, 201); const registration = JSON.parse(registrationResponse.text);
      assert.equal(typeof registration.registration_secret, 'string'); secrets.push(registration.registration_secret);
      try {
         for (const suffix of ['wait', 'returned', 'acknowledge']) {
          const body = suffix === 'wait' ? { registration_id: registration.registration_id }
            : suffix === 'returned' ? { registration_id: registration.registration_id, decision_id: terminal.decision_id }
            : suffix === 'acknowledge' ? { decision_id: terminal.decision_id } : {};
          const r = await http('POST', `/v1/requests/${p.request_id}/${suffix}`, body, owner,
            { ...headers(p), 'X-Proceed-Registration': registration.registration_secret }); assert.ok(r.status >= 400);
        }
      } finally {
        const released = await wire('DELETE', `/v1/adapter/${registration.registration_id}`, undefined, owner,
          { 'X-Proceed-Registration': registration.registration_secret });
        assert.equal(released.status, 204); assert.equal(released.text, '');
      }
      const status = start(['status', '--json']); const output = [], errors = [];
      status.child.stdout.on('data', c => output.push(Buffer.from(c))); status.child.stderr.on('data', c => errors.push(Buffer.from(c)));
      assert.equal(await completed(status), 0); assert.equal(Buffer.concat(errors).length, 0);
      const raw = Buffer.concat(output).toString(); assert.ok(raw.endsWith('\n')); privateOutput(raw, [...secrets, ...requestSecrets]);
      assert.deepEqual(JSON.parse(raw), { schema_version: 1, requests: [terminal] });
      assert.deepEqual(await readFile(path), bytes, 'terminal MCP/EOF/denials/status never append business evidence');
      await stopped(broker);
      const recovered = await Journal.open(path);
      try { assert.deepEqual((await recovered.recover()).transactions.flatMap(t => t.mutations).filter(m => m.op === 'request.expire'), terminalRows); }
      finally { await recovered.close(); }
      await boot(async startupBytes => { assert.deepEqual(closures(startupBytes), terminalRows); assert.deepEqual(startupBytes, bytes); });
      assert.deepEqual(await http('GET', `/v1/requests/${p.request_id}`, undefined, owner, headers(p)), { status: 200, body: terminal });
      assert.deepEqual(await http('POST', '/v1/requests', input(p), owner, headers(p)), { status: 200, body: terminal });
      assert.deepEqual(await readFile(path), bytes);
    } finally {
      for (const c of connections) if (!c.resource.closed) await eof(c);
      if (broker && !broker.closed) await stopped(broker);
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
      for (const r of children) { assert.ifError(r.error); assert.equal(r.events.some(e => e.kind === 'network-attempt'), false); }
      for (const check of checks) check();
      for (const raw of setupOutput) privateOutput(raw.toString(), [...secrets, ...requestSecrets]);
      await Promise.allSettled(pending); await observe(() => sockets.size === 0, 'public TCP sockets absent'); await rebind(port);
    }
  }, 100000));
