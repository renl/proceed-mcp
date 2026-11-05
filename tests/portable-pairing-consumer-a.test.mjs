// TEST ONLY: design 2/3/5/7. Synthetic local public consumers, not Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, open, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { sha256Hex } from '../src/util/values.js';
import { freePort } from './support/startup-guards.mjs';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-01T00:01:00Z'), expiry = new Date(at + 300000).toISOString();
const code = '0123456789abcdef'.repeat(2), next = 'fedcba9876543210'.repeat(2);
const challenge = { code, expires_at: expiry }, opts = { timeout: 45000 };
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const tick = () => new Promise(r => setImmediate(r));

// Maintained resource runner: 40s aggregate, 33s work, reserved 7s teardown.
// Only finite init/owner/pair children (no descendants after setup), no serve/poller.
async function consumer(work, fake = null) {
  const root = resolve('.scratch/c1-consumer-a'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), state = join(dir, 'state');
  const progress = phase => writeFile(join(dir, 'progress.json'), JSON.stringify({ phase }));
  const controller = new AbortController(), children = new Set(), pending = [], releases = [], logs = [];
  let server, b, j, file, port, generated = code, stdoutBytes = 0, assertionError, cleanupError;
  let syncing = async () => {}, samples = 0, generatedCount = 0;
  const timer = setTimeout(() => controller.abort(new Error('aggregate work deadline')), 33000);
  const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
    .filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { TEMP: dir, TMP: dir, TMPDIR: dir });
  const cli = (...args) => {
    controller.signal.throwIfAborted(); stdoutBytes = 0;
    const p = new Promise((done, reject) => {
      const child = execFile(process.execPath, [resolve('bin/proceed-mcp.js'), ...args, '--state-dir', state],
        { cwd: dir, env, timeout: 7000, signal: controller.signal, maxBuffer: 65536, windowsHide: true },
        (error, stdout, stderr) => {
          children.delete(child);
          if (error && typeof error.code !== 'number') reject(new Error('finite CLI execution failed'));
          else done({ code: error?.code ?? 0, stdout, stderr });
        });
      children.add(child);
      child.stdout.on('data', bytes => { stdoutBytes += bytes.length; });
    });
    pending.push(p.catch(() => {})); return p;
  };
  const h = { cli, logs, get b() { return b; }, get j() { return j; }, get stdoutBytes() { return stdoutBytes; },
    counts: () => ({ samples, generatedCount }),
    bytes: () => readFile(join(state, 'journal.log')),
    rows: async () => readJournal(await h.bytes()).transactions.map(t => t.mutations),
    setCode: value => { generated = value; }, ready: () => server.markReady(),
    hold() { const entered = gate(), released = gate(); releases.push(released.release);
      syncing = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 2000, 'flush gate not reached'),
        release() { syncing = async () => {}; released.release(); } }; },
    fault() { syncing = async () => { throw new Error(`sensitive ${code}`); }; },
    async start() {
      await b?.close(); await j?.close();
      const initial = await Journal.open(join(state, 'journal.log')), sequence = initial.sequence; await initial.close();
      file = await open(join(state, 'journal.log'), 'a');
      j = new Journal(join(state, 'journal.log'), { write: (...args) => file.write(...args),
        sync: async () => { await syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port,
        clock: () => { samples++; return at; }, generatePairingCode: () => { generatedCount++; return generated; }, logger: m => logs.push(m) });
      await b.recover();
    },
    request(raw = '{}', token, headers = {}, path = '/v1/pairing') {
      controller.signal.throwIfAborted();
      return fetch(`http://127.0.0.1:${port}${path}`, { method: path === '/v1/status' ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token === undefined ? h.control : token}`, 'content-type': 'application/json', ...headers },
        ...(path === '/v1/status' ? {} : { body: raw }), redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
    } };
  try {
    await progress('setup');
    await bounded(async () => {
      assert.equal((await cli('init')).code, 0); assert.equal((await cli('owner', 'add', 'a', '--label', 'A')).code, 0);
      const configPath = join(state, 'config.json'), config = JSON.parse(await readFile(configPath, 'utf8'));
      port = await freePort(); config.broker.port = port; await writeFile(configPath, JSON.stringify(config));
      h.control = (await readFile(join(state, 'credentials/control.token'), 'utf8')).trim();
      h.owner = (await readFile(join(state, 'credentials/owner.a.token'), 'utf8')).trim();
      await h.start();
      if (fake) {
        server = createServer(fake); server.listen(port, '127.0.0.1');
        await new Promise((done, reject) => { server.once('listening', done); server.once('error', reject); });
      } else {
        server = createPortableServer({ broker: { pairingChallenge: () => b.pairingChallenge(), status: () => b.status() },
          credentials: { control: h.control, owners: new Map([['a', h.owner]]) }, port, logger: m => logs.push(m) });
        await server.listen();
      }
      await progress('assertions'); await work(h);
    }, 33000, 'setup/assertion deadline');
  } catch (error) { assertionError = error; }
  finally {
    controller.abort(); for (const release of releases) release();
    try { await bounded(async () => {
      await progress('teardown'); await Promise.all(pending);
      assert.equal(children.size, 0, 'finite CLI children reaped');
      if (fake && server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
      else await server?.close();
      await b?.close(); await j?.close();
      await rm(dir, { recursive: true, maxRetries: 3, retryDelay: 100 });
      await assert.rejects(access(dir), { code: 'ENOENT' });
    }, 6500, 'cleanup deadline'); } catch (error) { cleanupError = error; }
    clearTimeout(timer);
  }
  assert.ifError(cleanupError); assert.ifError(assertionError);
}

async function error(response, status, name) {
  assert.equal(response.status, status); assert.equal(response.headers.has('access-control-allow-origin'), false);
  const value = await response.json(); assert.equal(value.schema_version, 1); assert.equal(value.error.code, name);
  assert.equal(typeof value.error.message, 'string'); assert.equal(typeof value.error.retryable, 'boolean'); return value;
}
function output(result, expected = challenge) {
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, `Pairing code: ${expected.code}\nExpires at: ${expected.expires_at}\n`);
}

test('C1CA-CAL: actual Journal gate/reopen, protected config and finite CLI', opts, () => consumer(async h => {
  const hold = h.hold(); let done = false;
  const p = h.b.pairingChallenge().then(v => { done = true; return v; });
  await hold.entered(); await tick(); assert.equal(done, false); hold.release(); assert.deepEqual(await p, challenge);
  await h.start(); assert.equal(h.b.pairing(), null); assert.equal((await h.rows()).length, 1);
}));

test('C1CA-PUBLIC: control HTTP then actual CLI issue only hashed five-minute challenges', opts, () => consumer(async h => {
  h.ready(); const response = await h.request(); assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), challenge);
  h.setCode(next); output(await h.cli('pair'), { code: next, expires_at: expiry });
  const rows = await h.rows(); assert.equal(rows.length, 2);
  for (const [i, c] of [code, next].entries()) assert.deepEqual(rows[i], [{ op: 'pairing.challenge', hash: sha256Hex(c),
    created_at: new Date(at).toISOString(), expires_at: expiry }]);
  const status = await (await h.request(undefined, undefined, {}, '/v1/status')).json();
  const surfaces = JSON.stringify([status, h.b.snapshot(), h.logs]);
  for (const c of [code, next, h.control, h.owner]) {
    assert.equal(surfaces.includes(c), false); assert.equal((await h.bytes()).includes(Buffer.from(c)), false);
  }
  assert.equal(surfaces.includes(sha256Hex(code)), false); assert.equal(h.b.pairing(), null);
  await h.start(); assert.equal(h.b.pairing(), null); assert.deepEqual(await h.rows(), rows);
}));

test('C1CA-ADMISSION: browser/readiness/auth/role then exact object and 64KiB limit without append', opts, () => consumer(async h => {
  const bytes = await h.bytes(), before = h.counts();
  await error(await h.request('{', '', { Origin: 'https://example.invalid' }), 403, 'FORBIDDEN');
  await error(await h.request('{', ''), 503, 'BROKER_NOT_READY'); h.ready();
  for (const token of ['', 'invalid']) await error(await h.request('{', token), 401, 'AUTH_REQUIRED');
  await error(await h.request('{', h.owner), 403, 'FORBIDDEN');
  for (const raw of ['{', 'null', '[]', 'true', '{"code":"injected"}', '{"owner_id":"a"}', `${' '.repeat(65536)}{}`])
    await error(await h.request(raw), 400, 'INVALID_ARGUMENT');
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.counts(), before, 'denials allocate neither clock nor code');
  const response = await h.request(`${' '.repeat(65534)}{}`); assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), challenge); // positive size boundary, not a blanket refusal
}));

test('C1CA-PAIRED: actual core consumption then HTTP409/CLI2 cannot replace or append', opts, () => consumer(async h => {
  h.ready(); assert.deepEqual(await h.b.pairingChallenge(), challenge); // prerequisite fixture, not public issuance proof
  assert.deepEqual(await h.b.completePairing({ code, userId: '71', chatId: '81', updateId: 7 }), { paired: true });
  const bytes = await h.bytes(), binding = h.b.pairing();
  const refused = await error(await h.request(), 409, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(refused, { schema_version: 1, error: { code: 'IDEMPOTENCY_CONFLICT',
    message: 'A human is already paired; pairing cannot be replaced', retryable: false } });
  const cli = await h.cli('pair'); assert.equal(cli.code, 2); assert.equal(cli.stdout, '');
  assert.equal(cli.stderr, 'proceed-mcp: A human is already paired; pairing cannot be replaced (IDEMPOTENCY_CONFLICT)\n');
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.pairing(), binding);
}));

for (const via of ['http', 'cli']) test(`C1CA-FLUSH-${via}: no201/code output before actual sync`, opts, () => consumer(async h => {
  h.ready(); const hold = h.hold(); let done = false;
  const p = (via === 'http' ? h.request() : h.cli('pair')).then(v => { done = true; return v; });
  await hold.entered(); await tick(); assert.equal(done, false); assert.equal(h.j.sequence, 0);
  if (via === 'cli') assert.equal(h.stdoutBytes, 0, 'no partial code output before flush');
  hold.release(); const result = await p;
  if (via === 'http') { assert.equal(result.status, 201); assert.deepEqual(await result.json(), challenge); }
  else output(result);
}));

for (const via of ['http', 'cli']) test(`C1CA-STORAGE-${via}: actual sync fault gives redacted HTTP500 or CLI4`, opts, () => consumer(async h => {
  h.ready(); h.fault(); let visible;
  if (via === 'http') visible = await error(await h.request(), 500, 'STORAGE_FAILURE');
  else { const result = await h.cli('pair'); assert.equal(result.code, 4); assert.equal(result.stdout, ''); visible = result.stderr; }
  for (const secret of [code, h.control, h.owner]) assert.equal(JSON.stringify([visible, h.logs]).includes(secret), false);
}));

test('C1CA-CLI-CONTRACT: synthetic201 bodies validate raw encoding and strict UTC, not Telegram proof', opts, async t => {
  let reply = challenge, requests = [];
  await consumer(async h => {
    for (const [i, expires_at] of [expiry, '2026-11-01T00:06:00Z', '2026-11-01T00:06:00.123456+00:00'].entries())
      await t.test(`valid-${i}`, async () => { reply = { code, expires_at }; output(await h.cli('pair'), reply); });
    const bad = [null, [], {}, { ...challenge, code: 1 }, { ...challenge, code: 'A'.repeat(32) },
      ...[null, {}, `${code}\n`, ` ${code}`].map(code => ({ code, expires_at: expiry })),
      ...[31, 33].map(n => ({ ...challenge, code: '0'.repeat(n) })),
      ...[null, 1, '2026-02-30T00:00:00Z', '2026-11-01', '2026-11-01T24:00:00Z',
        '2026-11-01T00:06:00-00:00', '2026-11-01T01:06:00+01:00', '2026-11-01T00:06:00Zjunk',
        '2026-11-01T00:06:00Z\n', '2026-13-01T00:00:00Z', '2026-11-01T00:60:00Z']
        .map(expires_at => ({ code, expires_at }))];
    for (const [i, value] of bad.entries()) await t.test(`invalid-${i}`, async () => {
      reply = value; const result = await h.cli('pair'); assert.equal(result.code, 3); assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes(code), 'malformed authority not echoed');
    });
    assert.ok(requests.length >= 3 + bad.length);
    assert.ok(requests.every(r => r.method === 'POST' && r.path === '/v1/pairing'
      && r.auth === `Bearer ${h.control}` && r.body === '{}'), 'actual control consumer on exact route/body');
  }, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
    res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
  });
});
