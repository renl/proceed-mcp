// TEST ONLY public CLI/IPC/MCP consumers. Authority: design 2–4 and Migration Plan 5.
// PORT-SETUP is enabling acceptance, NOT PORT-A/B or live Telegram/host proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { managed } from './support/managed-spike.mjs';
import { freePort } from './support/startup-guards.mjs';
import { portable, authority, until, telegramFixture } from './support/portable-waiting.mjs';

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
      assert.match(diagnostic, /unsupported|schema|version/i, 'actionable unsupported-schema diagnostic');
      assert.ok(old.equals(await readFile(journalPath)) && configBytes.equals(await readFile(configPath)),
        'no migration, truncation or reset');
    } finally { await fixture.close(); }
  }));

test('PORT-SETUP-IPC: owner CLI handshake/catalog and control/browser separation',
  { timeout: 65000 }, () => portable(async (h) => {
    // connect() asserts the MCP handshake and all five catalog entries before this body.
    const names = await readdir(join(h.state, 'credentials'));
    const ownerFiles = names.filter((name) => name !== 'control.token');
    assert.ok(ownerFiles.length >= 2, 'owner credentials exist');
    for (const name of ownerFiles) {
      const owner = (await readFile(join(h.state, 'credentials', name), 'utf8')).trim();
      for (const [path, options] of [['/v1/status', {}], ['/v1/pairing', { method: 'POST', body: {} }]]) {
        assert.equal((await h.http(path, owner, options)).status, 403, 'owner cannot use control routes');
      }
    }
    assert.equal((await h.http('/v1/handles', h.control, { method: 'POST', body: {} })).status,
      403, 'control cannot substitute for owner authority');
    const browser = await h.http('/v1/status', h.control, { headers: { Origin: 'https://example.invalid' } });
    assert.equal(browser.status, 403, 'even authenticated browser Origin forbidden');
    assert.equal(browser.headers.has('access-control-allow-origin'), false);
    assert.equal((await h.http('/v1/status', 'invalid')).status, 401);
    assert.equal(h.fixture.messages.length, 0, 'setup/catalog produce no Telegram question');
  }, { pair: false }));

test('PORT-RESERVE: prepare then reserved read/cancel/ack NOT_FOUND, no Telegram',
  { timeout: 65000 }, () => portable(async (h) => {
    const a = await h.prepare(), b = await h.prepare();
    assert.ok(a.request_id !== b.request_id && a.request_handle !== b.request_handle
      && a.request_capability !== b.request_capability, 'equal labels reserve independent authority');
    for (const name of ['get_approval', 'cancel_approval', 'acknowledge_approval']) {
      const response = await h.shared.call(name, { ...authority(a),
        ...(name === 'acknowledge_approval' ? { decision_id: `dec_${'0'.repeat(32)}` } : {}) }).outcome;
      assert.equal(response.kind, 'response');
      assert.ok(response.frame.result?.isError === true
        && response.frame.result.structuredContent?.error?.code === 'NOT_FOUND',
        'reservation alone is not actionable; read/cancel/ack have no request effect');
    }
    assert.equal(h.fixture.messages.length, 0, 'preparation never sends a Telegram question');
    await h.scan();
  }, { pair: false }));
