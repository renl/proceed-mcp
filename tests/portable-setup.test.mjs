// TEST ONLY public CLI/IPC/MCP consumers. Authority: design 2–4 and Migration Plan 5.
// PORT-SETUP is enabling acceptance, NOT PORT-A/B or live Telegram/host proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { managed } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';
import { portable, authority, until, telegramFixture } from './support/portable-waiting.mjs';
import { successful } from './support/catalog-consumer.mjs';

async function protectedPaths(paths, env) {
  if (process.platform !== 'win32') {
    for (const path of paths) {
      const info = await stat(path);
      assert.equal(info.uid, process.getuid(), 'current account owns state');
      assert.equal(info.mode & 0o077, 0, 'no group/other access');
    }
    return;
  }
  // Independent read-only ACL inspection; do not import the production verifier.
  const script = `$ErrorActionPreference='Stop';
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    foreach($p in ($env:PORT_TEST_PATHS -split [char]10)) {
      $a=Get-Acl -LiteralPath $p;
      if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 1};
      if(@($a.Access).Count -eq 0){exit 2};
      foreach($r in $a.Access){
        if($r.AccessControlType -ne 'Allow' -or
          $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 3}
      }
    }; exit 0`;
  const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...env, PORT_TEST_PATHS: paths.join('\n') }, timeout: 10000,
      maxBuffer: 65536, windowsHide: true });
  assert.ifError(check.error);
  assert.equal(check.status, 0, 'actual Windows owner-only ACL, not requested POSIX mode');
}

async function setup(work) {
  const result = await managed(async (context) => {
    const state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
    const invoke = (...args) => {
      const child = spawnSync(process.execPath, [resolve('bin/proceed-mcp.js'), ...args,
        '--state-dir', state], { cwd: context.directory, env, timeout: 10000,
        maxBuffer: 65536, windowsHide: true, encoding: 'utf8' });
      assert.ifError(child.error);
      assert.equal(child.signal, null, 'finite public CLI completes');
      return { code: child.status, output: `${child.stdout}${child.stderr}` };
    };
    assert.equal(invoke('init').code, 0);
    const configPath = join(state, 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(config.schema_version, 2, 'portable configuration schema');
    await work({ state, config, configPath, invoke, env, context });
  }, { totalMs: 55000 });
  assert.ifError(result.cleanupError);
  assert.ifError(result.assertionError);
}

test('PORT-SETUP-CLI: protected schema 2 init and immutable stopped-broker owner',
  { timeout: 65000 }, () => setup(async ({ state, config, configPath, invoke, env }) => {
    assert.deepEqual(config.owners, []);
    assert.equal(config.telegram.token_env, 'PROCEED_TELEGRAM_BOT_TOKEN');
    assert.equal(config.broker.port, 43189);
    assert.equal('origins' in config, false, 'no legacy host API prerequisites');
    const controlPath = join(state, 'credentials/control.token');
    const control = await readFile(controlPath);
    assert.ok(/^[a-f0-9]{64}$/.test(control.toString().trim()), '256-bit control credential');
    await protectedPaths([state, configPath, controlPath], env);
    const before = await readFile(configPath);
    assert.equal(invoke('init').code, 2, 'refuse overwrite');
    assert.ok(before.equals(await readFile(configPath)) && control.equals(await readFile(controlPath)));
    const credentials = join(state, 'credentials');
    const names = await readdir(credentials);
    const added = invoke('owner', 'add', 'shared', '--label', 'Shared transport');
    assert.equal(added.code, 0, 'owner setup while no broker exists');
    const newNames = (await readdir(credentials)).filter((name) => !names.includes(name));
    assert.equal(newNames.length, 1, 'separate protected owner credential, private filename not prescribed');
    const ownerPath = join(credentials, newNames[0]);
    const owner = await readFile(ownerPath), ownerText = owner.toString().trim();
    assert.ok(/^[a-f0-9]{64}$/.test(ownerText) && ownerText !== control.toString().trim(),
      'independent 256-bit owner credential');
    const owned = await readFile(configPath);
    assert.deepEqual(JSON.parse(owned).owners, [{ owner_id: 'shared', label: 'Shared transport' }]);
    const duplicate = invoke('owner', 'add', 'shared', '--label', 'Replacement');
    assert.equal(duplicate.code, 2, 'duplicate immutable ID refused');
    assert.ok(owned.equals(await readFile(configPath)) && owner.equals(await readFile(ownerPath)));
    assert.ok(![added.output, duplicate.output, owned.toString()].some((text) =>
      text.includes(ownerText) || text.includes(control.toString().trim())), 'no credential disclosure');
    await protectedPaths([state, credentials, controlPath, ownerPath], env);
  }));

test('PORT-SETUP-SCHEMA: journal format 2; version 1 refusal preserves bytes',
  { timeout: 65000 }, () => setup(async ({ state, config, configPath, context }) => {
    const journalPath = join(state, 'journal.log');
    const fresh = await readFile(journalPath);
    assert.equal(fresh.subarray(0, 8).toString(), 'PROCEEDJ');
    assert.equal(fresh.readUInt32BE(8), 2, 'distinct portable journal format');
    // Known historical header only, NOT the pinned public host schema or a journal decoder.
    const old = Buffer.alloc(12); old.write('PROCEEDJ'); old.writeUInt32BE(1, 8);
    await writeFile(journalPath, old);
    config.broker.port = await freePort();
    await writeFile(configPath, JSON.stringify(config));
    const configBytes = await readFile(configPath);
    const fixture = await telegramFixture();
    try {
      const preload = pathToFileURL(resolve('tests/fixtures/portable-telegram-preload.mjs'));
      preload.searchParams.set('fixture', fixture.address);
      const child = await context.start([process.execPath, '--import', preload.href,
        resolve('bin/proceed-mcp.js'), 'serve', '--state-dir', state]);
      let diagnostic = '';
      child.child.stderr.on('data', (bytes) => { if (diagnostic.length < 65536) diagnostic += bytes; });
      await until(() => child.closed, 'unsupported journal refusal', context.signal);
      assert.equal(child.child.exitCode, 4, 'unsupported old journal must fail integrity gate');
      assert.match(diagnostic, /journal[^\r\n]*(?:version|unsupported)|JOURNAL_VERSION_UNSUPPORTED/i,
        'journal-specific refusal, never a configuration-schema false positive');
      assert.ok(old.equals(await readFile(journalPath)) && configBytes.equals(await readFile(configPath)),
        'no migration, truncation or reset');
      // Existing ownership must refuse BEFORE unsupported-journal recovery.
      assert.equal((await readdir(state)).includes('broker.lock'), false, 'failed startup releases own lock');
      const lockPath = join(state, 'broker.lock'), lock = Buffer.from('uncertain owner\n');
      await writeFile(lockPath, lock);
      const refused = await context.start([process.execPath, '--import', preload.href,
        resolve('bin/proceed-mcp.js'), 'serve', '--state-dir', state]);
      await until(() => refused.closed, 'ownership refusal before recovery', context.signal);
      assert.equal(refused.child.exitCode, 3);
      assert.ok(lock.equals(await readFile(lockPath)) && old.equals(await readFile(journalPath))
        && configBytes.equals(await readFile(configPath)), 'foreign ownership/state preserved');
    } finally { await fixture.close(); }
  }));

test('PORT-SETUP-IPC: owner CLI handshake/catalog and control/browser separation',
  { timeout: 65000 }, () => portable(async (h) => {
    // connect() asserts the MCP handshake and all five catalog entries before this body.
    const status = await (await h.http('/v1/status', h.control)).json();
    assert.equal(status.schema_version, 1);
    assert.equal(status.broker.pid, h.broker.pid, 'status describes actual managed broker');
    const config = JSON.parse(await readFile(join(h.state, 'config.json'), 'utf8'));
    assert.equal(status.broker.port, config.broker.port, 'no automatic port selection');
    assert.match(status.broker.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/);
    assert.ok(Number.isFinite(Date.parse(status.broker.started_at))
      && Date.parse(status.broker.started_at) <= Date.now(), 'actual UTC startup timestamp');
    assert.deepEqual(status, { schema_version: 1, broker: { pid: h.broker.pid,
      port: config.broker.port, started_at: status.broker.started_at }, requests: [] });
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const secrets = [h.control, 'offline-synthetic-token'];
    const error = async (response, expected, code) => {
      assert.equal(response.status, expected);
      assert.equal(response.headers.has('access-control-allow-origin'), false);
      const body = await response.json();
      assert.ok(body.schema_version === 1 && body.error?.code === code
        && typeof body.error.message === 'string' && typeof body.error.retryable === 'boolean',
      'versioned redacted error envelope');
      assert.ok(secrets.every((secret) => !JSON.stringify(body).includes(secret)), 'no secret in error');
    };
    const names = await readdir(join(h.state, 'credentials'));
    const ownerFiles = names.filter((name) => name !== 'control.token');
    assert.ok(ownerFiles.length >= 2, 'owner credentials exist');
    for (const name of ownerFiles) {
      const owner = (await readFile(join(h.state, 'credentials', name), 'utf8')).trim();
      secrets.push(owner);
      await protectedPaths([join(h.state, 'credentials', name)], env);
      for (const [path, options] of [['/v1/status', {}],
        ['/v1/pairing', { method: 'POST', body: {} }],
        [`/v1/requests/req_${'0'.repeat(32)}/retry`, { method: 'POST', body: {} }]]) {
        await error(await h.http(path, owner, options), 403, 'FORBIDDEN');
      }
    }
    await error(await h.http('/v1/handles', h.control, { method: 'POST', body: {} }), 403, 'FORBIDDEN');
    const browser = await h.http('/v1/status', h.control, { headers: { Origin: 'https://example.invalid' } });
    assert.equal(browser.status, 403, 'even authenticated browser Origin forbidden');
    assert.equal(browser.headers.has('access-control-allow-origin'), false);
    assert.equal((await h.http('/v1/status', 'invalid')).status, 401);
    await error(await h.http('/v1/status', 'invalid'), 401, 'AUTH_REQUIRED');
    await error(await h.http('/v1/status', '', { headers: { authorization: '' } }), 401, 'AUTH_REQUIRED');
    await error(await h.http('/v1/status', h.control,
      { headers: { Origin: 'https://example.invalid' } }), 403, 'FORBIDDEN');
    const owner = secrets[2];
    for (const body of [{ session_label: '' }, { owner_id: 'foreign' }]) {
      await error(await h.http('/v1/handles', owner, { method: 'POST', body }), 400, 'INVALID_ARGUMENT');
    }
    const output = [];
    for (const stream of [h.broker.child.stdout, h.broker.child.stderr]) {
      stream.on('data', (bytes) => output.push(String(bytes)));
    }
    const journalPath = join(h.state, 'journal.log');
    const unchanged = await readFile(journalPath);
    const configBytes = await readFile(join(h.state, 'config.json'));
    const callsBefore = h.fixture.calls.length;
    for (const [path, message] of [
      ['/v1/pairing', 'pairing is not implemented in this setup checkpoint'],
      [`/v1/requests/req_${'0'.repeat(32)}/retry`, 'request retry is not implemented in this setup checkpoint'],
    ]) {
      const response = await h.http(path, h.control, { method: 'POST', body: {} });
      assert.equal(response.status, 503, 'unavailable before unknown-request lookup');
      assert.equal(response.headers.has('access-control-allow-origin'), false);
      assert.deepEqual(await response.json(), { schema_version: 1, error: {
        code: 'ENHANCEMENT_UNAVAILABLE', message, retryable: false } });
    }
    assert.ok(unchanged.equals(await readFile(journalPath))
      && configBytes.equals(await readFile(join(h.state, 'config.json'))), 'no unavailable-operation mutation');
    assert.equal(h.fixture.calls.length, callsBefore, 'no challenge or delivery transport effect');
    // Raw owned IPC requests, not an application test API or reusable HTTP consumer.
    const padded = `${' '.repeat(65536)}{}`;
    assert.deepEqual(JSON.parse(padded), {}, 'otherwise valid reservation input');
    assert.ok(Buffer.byteLength(padded, 'utf8') > 65536, 'exceeds body byte limit, not label validation');
    for (const [label, raw] of [['oversized valid JSON', padded], ['malformed JSON', '{']]) {
      await error(await fetch(`http://127.0.0.1:${config.broker.port}/v1/handles`, {
        method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
        body: raw, redirect: 'error', signal: AbortSignal.timeout(1000),
      }), 400, 'INVALID_ARGUMENT');
      assert.ok(unchanged.equals(await readFile(journalPath)), `${label} cannot reserve authority`);
    }
    const reserved = await h.http('/v1/handles', owner, { method: 'POST', body: {} });
    assert.equal(reserved.status, 201, 'real durable owner route, not role-only stub');
    const handle = await reserved.json();
    assert.ok(handle.schema_version === 1 && /^hdl_[a-f0-9]{32}$/.test(handle.request_handle)
      && /^req_[a-f0-9]{32}$/.test(handle.request_id) && /^cap_[a-f0-9]{64}$/.test(handle.request_capability),
    'contract reservation response');
    const journal = await readFile(join(h.state, 'journal.log'));
    const hash = createHash('sha256').update(handle.request_capability).digest('hex');
    assert.ok(journal.includes(Buffer.from(hash)) && journal.includes(Buffer.from(handle.request_handle))
      && !journal.includes(Buffer.from(handle.request_capability)), 'persist verifier before HTTP success');
    const sameInstance = await (await h.http('/v1/status', h.control)).json();
    assert.deepEqual(sameInstance, status, 'started_at fixed across queries and reservation');
    const restartAt = Date.now();
    await h.restart(); // Graceful own-lock release and actual journal replay; no stale recovery.
    assert.ok((await readFile(join(h.state, 'journal.log'))).equals(journal), 'replay preserves reservation');
    assert.ok(!output.join('').includes(handle.request_capability), 'HTTP reservation key absent from logs');
    const cliStatus = await h.cli('status', '--json');
    assert.ok(cliStatus.endsWith('\n'), 'JSON output terminates with newline');
    assert.deepEqual(JSON.parse(cliStatus), { schema_version: 1, requests: [] }, 'exact CLI status contract');
    const finalStatus = await (await h.http('/v1/status', h.control)).json();
    assert.match(finalStatus.broker.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/);
    // RFC 3339 permits whole-second precision; do not require millisecond formatting.
    assert.ok(Date.parse(finalStatus.broker.started_at) >= Math.floor(restartAt / 1000) * 1000
      && Date.parse(finalStatus.broker.started_at) <= Date.now(), 'restart timestamp belongs to new instance');
    assert.deepEqual(finalStatus, { schema_version: 1, broker: { pid: finalStatus.broker.pid,
      port: config.broker.port, started_at: finalStatus.broker.started_at }, requests: [] });
    assert.ok(Number.isInteger(finalStatus.broker.pid) && finalStatus.broker.pid !== status.broker.pid,
      'restarted broker has a new actual process');
    assert.deepEqual(finalStatus.requests, [], 'reservation is not an actionable request');
    assert.ok([...secrets, handle.request_capability].every((secret) =>
      !JSON.stringify(finalStatus).includes(secret)), 'status never discloses credentials/capability');
    assert.equal(h.fixture.messages.length, 0, 'setup/catalog produce no Telegram question');
  }, { pair: false }));

test('PORT-RESERVE: prepare then reserved read/cancel/ack NOT_FOUND, no Telegram',
  { timeout: 65000 }, () => portable(async (h) => {
    const a = await h.prepare(), b = await h.prepare();
    assert.ok(a.request_id !== b.request_id && a.request_handle !== b.request_handle
      && a.request_capability !== b.request_capability, 'equal labels reserve independent authority');
    for (const value of [a, b]) assert.deepEqual(Object.keys(value).sort(),
      ['schema_version', 'request_handle', 'request_id', 'request_capability'].sort(), 'exact private preparation result');
    const journalPath = join(h.state, 'journal.log');
    const journal = await readFile(journalPath);
    for (const value of [a, b]) {
      const hash = createHash('sha256').update(value.request_capability).digest('hex');
      assert.ok(journal.includes(Buffer.from(hash)) && journal.includes(Buffer.from(value.request_handle))
        && journal.includes(Buffer.from(value.request_id)), 'MCP response follows real durable HTTP reservation');
      assert.ok(!journal.includes(Buffer.from(value.request_capability)), 'only verifier persists');
    }
    const failure = async (connection, name, args, code) => {
      const result = successful(await connection.call(name, args).outcome);
      assert.equal(result.isError, true, 'no fake success or human outcome');
      const value = result.structuredContent;
      assert.ok(value?.schema_version === 1 && value.error?.code === code
        && typeof value.error.message === 'string' && typeof value.error.retryable === 'boolean',
      `versioned ${code} tool error`);
      assert.ok(result.content?.some(block => {
        if (block.type !== 'text') return false;
        try { return isDeepStrictEqual(JSON.parse(block.text), value); } catch { return false; }
      }), 'matching structured/text error');
      assert.ok(!JSON.stringify(result).includes(a.request_capability)
        && !JSON.stringify(result).includes(b.request_capability), 'redacted error');
    };
    for (const args of [{ session_label: '' }, { owner_id: 'foreign' }]) {
      await failure(h.shared, 'prepare_approval', args, 'INVALID_ARGUMENT');
    }
    const foreign = await h.connect('foreign');
    const reservedErrors = async (connection) => {
      for (const name of ['get_approval', 'cancel_approval', 'acknowledge_approval']) {
        for (const args of [authority(a), { ...authority(a), request_capability: b.request_capability },
          { ...authority(a), request_capability: `cap_${'0'.repeat(64)}` }]) {
          await failure(connection, name, { ...args,
            ...(name === 'acknowledge_approval' ? { decision_id: `dec_${'0'.repeat(32)}` } : {}) }, 'NOT_FOUND');
        }
      }
    };
    await reservedErrors(h.shared);
    await reservedErrors(foreign); // Reserved-only negatives cannot alone prove authorization enforcement.
    assert.deepEqual((await (await h.http('/v1/status', h.control)).json()).requests, [],
      'preparation/errors create no business request');
    assert.ok(journal.equals(await readFile(journalPath)), 'reserved reads/cancel/ack and invalid prepare have no durable effects');
    const retained = await h.restart(); // EOF is reachability loss, never business cancellation.
    await reservedErrors(retained);
    assert.ok(journal.equals(await readFile(journalPath)), 'retained key survives graceful replay; no cancellation or acknowledgement writes');
    assert.equal(h.fixture.messages.length, 0, 'preparation never sends a Telegram question');
    assert.ok(h.fixture.calls.every(call => ['getMe', 'getUpdates'].includes(call.method)),
      'no pairing challenge, message, callback or presentation side effect');
    await h.scan();
  }, { pair: false, strictProtocol: true }));
