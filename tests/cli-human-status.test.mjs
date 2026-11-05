// TEST ONLY: active design sections 2, 3 A1b diagnostics, 7 human-status cut.
// Production cases seed only pairing. CLI-H-CONSUMER cases substitute status replies;
// they prove CLI consumption only, never a Telegram or delivery transition.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { createPortableServer } from '../src/broker/portable-server.js';
import { initializeState, addOwner } from '../src/state/store.js';
import { statePaths } from '../src/state/paths.js';
import { managed, alive } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';

const executable = resolve('bin/proceed-mcp.js');
const options = { timeout: 20000 };
async function fixture(work, consumerRows) {
  const result = await managed(async ctx => {
    const paths = statePaths(join(ctx.directory, 'state'));
    await initializeState(paths);
    await addOwner(paths, { ownerId: 'portable', label: 'Operator display' });
    const config = JSON.parse(await readFile(paths.configFile, 'utf8'));
    const port = await freePort(); config.broker.port = port;
    await writeFile(paths.configFile, JSON.stringify(config));
    const owner = (await readFile(paths.ownerCredentialFile('portable'), 'utf8')).trim();
    const control = (await readFile(paths.controlCredentialFile, 'utf8')).trim();
    const secrets = [owner, control], clients = new Set();
    const seed = await Journal.open(paths.journalFile);
    try {
      const at = '2026-01-01T00:00:00.000Z', hash = 'a'.repeat(64);
      await seed.append([{ op: 'pairing.challenge', hash, created_at: at, expires_at: '2026-01-01T00:05:00.000Z' }]);
      await seed.append([{ op: 'pairing.challenge.consume', hash, consumed_at: at },
        { op: 'pairing.set', pairing: { user_id: '71', chat_id: '81', paired_at: at } }]);
    } finally { await seed.close(); }
    const j = await Journal.open(paths.journalFile);
    let now = Date.parse('2026-11-01T12:00:00.000Z'), failClock = false, broker, server;
    const privateOutput = text => {
      assert.ok(secrets.every(s => !text.includes(s)), 'no credential or capability in output');
      assert.doesNotMatch(text, /capability_hash|pairing_snapshot|registration_secret|user_id|chat_id/);
    };
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TEMP: ctx.directory, TMP: ctx.directory, TMPDIR: ctx.directory });
    const cli = (...args) => new Promise((done, reject) => {
      // status has no descendants; execFile bounds output/time and reaps on close.
      const child = execFile(process.execPath, [executable, 'status', '--state-dir', paths.stateDir, ...args],
        { cwd: ctx.directory, env, timeout: 5000, maxBuffer: 65536, windowsHide: true }, (error, stdout, stderr) => {
          clients.delete(child);
          try {
            assert.equal(child.signalCode, null, 'CLI must complete without timeout/kill');
            assert.ok(!alive(child.pid), 'CLI process reaped');
            privateOutput(stdout + stderr);
            done({ code: error ? error.code : 0, stdout, stderr });
          } catch (e) { reject(e); }
        });
      clients.add(child);
    });
    const http = async (method, path, body, token = owner, headers = {}) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
      return { status: r.status, body: await r.json() };
    };
    const create = async (label, action) => {
      const prepared = await http('POST', '/v1/handles', { session_label: label });
      assert.equal(prepared.status, 201); const p = prepared.body; secrets.push(p.request_capability);
      const r = await http('POST', '/v1/requests', { request_handle: p.request_handle,
        client_request_id: action.replaceAll(' ', '_'), action, context: '', expires_in_seconds: 60 }, owner,
        { 'X-Proceed-Request-Capability': p.request_capability });
      assert.equal(r.status, 201); return r.body;
    };
    try {
      if (consumerRows) {
        // Explicit synthetic loopback fixture, authenticated like the control consumer.
        const listener = createHttpServer((req, res) => {
          const allowed = req.method === 'GET' && req.url === '/v1/status' && req.headers.authorization === `Bearer ${control}`;
          res.writeHead(allowed ? 200 : 401, { 'content-type': 'application/json' });
          res.end(JSON.stringify(allowed ? { broker: { pid: 123, port }, requests: consumerRows } : { error: 'unauthorized' }));
        });
        server = { close: () => new Promise((done, reject) => listener.close(e => e ? reject(e) : done())) };
        await new Promise((done, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', done); });
        await work({ cli, privateOutput });
        return;
      }
      broker = createPortableBroker({ journal: j, owners: config.owners, port,
        clock: () => { if (failClock) throw new Error('private clock failure'); return now; } });
      await broker.recover();
      server = createPortableServer({ broker, port, credentials: { control, owners: new Map([['portable', owner]]) } });
      await server.listen(); server.markReady();
      await work({ cli, create, status: () => http('GET', '/v1/status', undefined, control),
        due: () => { now += 60000; }, fault: () => { failClock = true; }, privateOutput });
    } finally {
      assert.equal(clients.size, 0, 'all finite CLI children settled');
      try { await server?.close(); } finally { try { await broker?.close(); } finally { await j.close(); } }
      const probe = createServer();
      await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
    }
  }, { totalMs: 15000 });
  assert.ifError(result.cleanupError); // Separate cleanup gate, even on expected RED.
  assert.ifError(result.assertionError);
}

function ok(r) { assert.equal(r.code, 0); assert.equal(r.stderr, ''); return r.stdout; }
function human(text, r) {
  assert.ok(text.includes(r.request_id), 'full request ID');
  assert.match(text, /owner(?:_id)?\s*[=:]\s*portable/i);
  assert.ok(text.includes(r.session_label), 'prepared display label');
  assert.match(text, /(?:session_label|session label|caller[^\n]*context)[^\n]*display[ -]only|display[ -]only[^\n]*(?:session|context)/i);
  assert.match(text, /not (?:a )?verified (?:session )?identity/i);
  assert.doesNotMatch(text, /\borigin(?:_id)?\s*[=:]|\bsession(?:_id)?\s*[=:]|undefined/);
  for (const [field, value] of [['resolution', r.resolution], ['telegram', r.telegram_state], ['delivery', r.delivery_state]])
    assert.match(text, new RegExp(`${field}(?:_state)?\\s*[=:]\\s*${value}`, 'i'));
  assert.ok(text.includes(r.action)); assert.ok(text.includes(r.expires_at));
  assert.match(text, /next(?:[ _-]action)?\s*:/i);
  assert.doesNotMatch(text, /(?:Events?\s*[=:]\s*(?:verified|enabled)|approval granted|human received|delivered successfully)/i);
}

test('CLI-H-EMPTY: exact empty JSON/human output and missing filter exit2 remain stable', options, () => fixture(async h => {
  assert.deepEqual(JSON.parse(ok(await h.cli('--json'))), { schema_version: 1, requests: [] });
  assert.match(ok(await h.cli()), /^Broker \d+ on port \d+\nNo requests\.\n$/);
  for (const args of [[], ['--json']]) {
    const r = await h.cli('--request', 'unknown', ...args);
    assert.equal(r.code, 2); assert.equal(r.stdout, ''); assert.equal(r.stderr, 'proceed-mcp: no request unknown in this broker\n');
  }
}));

test('CLI-H-JSON: actual multiple public creations, exact unfiltered/filtered JSON, no broker/private additions', options, () => fixture(async h => {
  const a = await h.create('First display 😀', 'First question'), b = await h.create('Second display', 'Second question');
  const all = await h.status(); assert.equal(all.status, 200);
  assert.deepEqual(JSON.parse(ok(await h.cli('--json'))), { schema_version: 1, requests: [a, b] });
  assert.deepEqual(all.body.requests, [a, b]);
  assert.deepEqual(JSON.parse(ok(await h.cli('--request', b.request_id, '--json'))), { schema_version: 1, requests: [b] });
}));

test('CLI-H-PENDING: unfiltered/multiple and filtered human portable identity; no receipt claim, actionable next step', options, () => fixture(async h => {
  const a = await h.create('First display 😀', 'First question'), b = await h.create('Second display', 'Second question');
  const all = ok(await h.cli()), filtered = ok(await h.cli('--request', b.request_id));
  // Independent assertions ensure both public invocations execute before formatter RED.
  assert.ok(all.includes(a.request_id) && all.includes(b.request_id)); assert.ok(!filtered.includes(a.request_id));
  for (const [text, r] of [[all, a], [all, b], [filtered, b]]) {
    human(text, r);
    assert.match(text, /not (?:yet )?(?:sent|delivered)|unsent|presentation[^\n]*unavailable|no decision|review[^\n]*state/i);
    assert.match(text, /next(?:[ _-]action)?\s*:[^\n]*(?:review|check|wait|pending|presentation|Telegram)/i);
    assert.doesNotMatch(text, /delivery_error=undefined|delivery_error=null/);
  }
}));

test('CLI-H-EXPIRED: real due status expiry, non-approval/new request guidance; JSON retains terminal representation', options, () => fixture(async h => {
  const a = await h.create('Expiry display', 'Expiry question'); h.due();
  const observed = await h.status(); assert.equal(observed.status, 200);
  const r = observed.body.requests[0]; assert.equal(r.resolution, 'expired'); assert.equal(r.delivery_state, 'unavailable');
  assert.deepEqual(JSON.parse(ok(await h.cli('--json'))), { schema_version: 1, requests: [r] });
  const text = ok(await h.cli('--request', a.request_id)); human(text, r);
  assert.match(text, /not (?:an? )?approv(?:al|ed)|non-approval/i);
  assert.match(text, /next(?:[ _-]action)?\s*:[^\n]*new (?:approval )?request/i);
  assert.match(text, /(?:if|still)[^\n]*approval|approval[^\n]*(?:needed|required)/i);
  assert.doesNotMatch(text, /(?:delivered|confirmed|acknowledged)\s*[=:]\s*(?:true|yes)/i);
}));

test('CLI-H-STORAGE: actual status expiry fault is exit4, empty stdout, fixed redacted error before filtering', options, () => fixture(async h => {
  await h.create('Fault display', 'Fault question'); h.due(); h.fault();
  for (const args of [[], ['--json'], ['--request', 'unknown']]) {
    const r = await h.cli(...args);
    assert.equal(r.code, 4); assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'proceed-mcp: the broker could not complete the request (STORAGE_FAILURE)\n');
    assert.doesNotMatch(r.stderr, /private clock failure|Fault question|Fault display/);
  }
}));

for (const telegram of ['pending', 'sent', 'failed']) {
  test(`CLI-H-CONSUMER-${telegram}: HUMAN-STATUS-001 pending resolution does not invent presentation state (fixture only)`, options, () => {
    const r = { schema_version: 1, request_handle: 'fixture_handle', request_id: 'fixture_request',
      client_request_id: 'fixture_key', owner_id: 'portable', session_label: 'Consumer display', action: 'Consumer question', context: '',
      created_at: '2026-11-01T12:00:00.000Z', expires_at: '2026-11-01T12:01:00.000Z', resolution: 'pending',
      resolved_at: null, response_text: null, decision_id: null, telegram_state: telegram, delivery_state: 'not_applicable',
      delivery_error: telegram === 'failed' ? { code: 'BROKER_UNAVAILABLE', message: 'Delivery unavailable', retryable: true } : null,
      event_capability: { status: 'unverified', revision: null, reason: 'No verified Events contract or host support' } };
    return fixture(async h => {
      assert.deepEqual(JSON.parse(ok(await h.cli('--json'))), { schema_version: 1, requests: [r] });
      const text = ok(await h.cli('--request', r.request_id)); human(text, r);
      const next = text.split('\n').find(line => /next(?:[ _-]action)?\s*:/i.test(line));
      const notes = {
        pending: 'Presentation is still pending: not yet sent, and no decision was recorded.',
        sent: 'Telegram accepted a question message. Human receipt is not confirmed, and no decision was recorded.',
        failed: 'A Telegram presentation attempt failed. No successful message mapping is recorded, and no decision was recorded.',
      };
      assert.ok(text.includes(notes[telegram]));
      if (telegram === 'sent') assert.ok(next.includes('wait for the paired human to select Approve, Reject or Respond'));
      assert.match(next, /review|check|wait|pending|presentation|Telegram/i);
      if (r.delivery_error) assert.ok(text.includes('delivery_error=BROKER_UNAVAILABLE: Delivery unavailable'), 'existing redacted error is displayed');
      else assert.doesNotMatch(text, /delivery_error=/);
      // Neutral review guidance is valid; no automatic retry/new delivery policy required.
      if (telegram !== 'pending') {
        assert.doesNotMatch(text, /not (?:yet )?(?:sent|delivered)|unsent|presentation is still pending|wait for the pending Telegram presentation/i,
          'resolution alone must not assert unsent/pending presentation in note or next action');
      }
    }, [r]);
  });
}
