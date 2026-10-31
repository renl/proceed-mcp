// TEST ONLY: 03A.1b-i public setup checkpoint; design 2, not broker/runtime acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { managed } from './support/managed-spike.mjs';

async function protect(paths, env) {
  if (process.platform !== 'win32') {
    for (const path of paths) {
      const info = await stat(path);
      assert.equal(info.uid, process.getuid());
      assert.equal(info.mode & 0o077, 0, 'owner-only access');
    }
    return;
  }
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
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...env, PORT_TEST_PATHS: paths.join('\n') }, timeout: 10000,
      maxBuffer: 65536, windowsHide: true });
  assert.ifError(child.error);
  assert.equal(child.status, 0, 'independent actual Windows ACL inspection');
}

async function setup(work) {
  const result = await managed(async (context) => {
    const state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
    const invoke = (...args) => {
      const child = spawnSync(process.execPath, [resolve('bin/proceed-mcp.js'), ...args,
        '--state-dir', state], { cwd: context.directory, env, timeout: 10000,
          maxBuffer: 65536, windowsHide: true, encoding: 'utf8' });
      assert.ifError(child.error);
      assert.equal(child.signal, null, 'finite public command');
      return { code: child.status, output: `${child.stdout}${child.stderr}` };
    };
    assert.equal(invoke('init').code, 0);
    const configFile = join(state, 'config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    assert.equal(config.schema_version, 2, 'portable CLI consumer switched');
    await work({ state, configFile, config, invoke, env });
  }, { totalMs: 85000 });
  assert.ifError(result.cleanupError);
  assert.ifError(result.assertionError);
}

test('PORT-CLI-I: schema-2 init, bound owner files, protection and immutable failures',
  { timeout: 95000 }, () => setup(async ({ state, configFile, config, invoke, env }) => {
    assert.deepEqual(config, { schema_version: 2,
      telegram: { token_env: 'PROCEED_TELEGRAM_BOT_TOKEN' }, broker: { port: 43189 }, owners: [] });
    const credentials = join(state, 'credentials');
    const controlFile = join(credentials, 'control.token');
    const control = await readFile(controlFile);
    assert.ok(/^[0-9a-f]{64}$/.test(control.toString().trim()), 'control credential shape');
    const before = await readFile(configFile);
    assert.equal(invoke('init').code, 2);
    assert.ok(before.equals(await readFile(configFile)) && control.equals(await readFile(controlFile)));
    const outputs = [];
    for (const id of ['first', 'second']) {
      const added = invoke('owner', 'add', id, '--label', 'Shared display label');
      assert.equal(added.code, 0);
      outputs.push(added.output);
    }
    // Selected additive naming seam, not a new public filename requirement.
    const firstFile = join(credentials, 'owner.first.token');
    const secondFile = join(credentials, 'owner.second.token');
    const first = await readFile(firstFile), second = await readFile(secondFile);
    const tokens = [control, first, second].map(bytes => bytes.toString().trim());
    assert.ok(tokens.every(token => /^[0-9a-f]{64}$/.test(token)), 'all tokens well formed');
    assert.equal(new Set(tokens).size, 3, 'control and owner authority are independent');
    const owned = await readFile(configFile);
    assert.deepEqual(JSON.parse(owned).owners, ['first', 'second'].map(owner_id =>
      ({ owner_id, label: 'Shared display label' })));
    for (const args of [['first', '--label', 'Replacement'], ['../escape', '--label', 'Bad'],
      ['UPPER', '--label', 'Bad'], ['third', '--label', '']]) {
      const refused = invoke('owner', 'add', ...args);
      assert.equal(refused.code, 2, 'invalid or duplicate owner refused');
      outputs.push(refused.output);
      assert.ok(owned.equals(await readFile(configFile)), 'refusal preserves config bytes');
      assert.ok(first.equals(await readFile(firstFile)) && second.equals(await readFile(secondFile)),
        'refusal preserves both owner files');
    }
    assert.deepEqual((await readdir(credentials)).sort(),
      ['control.token', 'owner.first.token', 'owner.second.token']);
    assert.ok(!tokens.some(token => [...outputs, owned.toString()].some(text => text.includes(token))),
      'credentials never disclosed');
    await protect([state, credentials, configFile, join(state, 'journal.log'), controlFile,
      firstFile, secondFile], env);
  }));

test('PORT-CLI-I: live ownership record blocks owner add without modifying stopped-state inputs',
  { timeout: 95000 }, () => setup(async ({ state, configFile, invoke }) => {
    // Known live PID only. This fixture does not claim a broker was started or a lock acquired.
    const lock = join(state, 'broker.lock');
    const lockBytes = Buffer.from(JSON.stringify({ pid: process.pid }));
    await writeFile(lock, lockBytes);
    const configBytes = await readFile(configFile);
    const journal = await readFile(join(state, 'journal.log'));
    const names = await readdir(join(state, 'credentials'));
    assert.equal(invoke('owner', 'add', 'blocked', '--label', 'Blocked').code, 3);
    assert.ok(lockBytes.equals(await readFile(lock)), 'ownership record unchanged');
    assert.ok(configBytes.equals(await readFile(configFile)), 'config unchanged');
    assert.ok(journal.equals(await readFile(join(state, 'journal.log'))), 'journal unchanged');
    assert.deepEqual(await readdir(join(state, 'credentials')), names, 'no credential created');
  }));
