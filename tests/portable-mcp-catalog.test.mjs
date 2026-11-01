// TEST ONLY: design 2/3 catalog boundary; no broker, tool execution or host proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { managed, bounded } from './support/managed-spike.mjs';
import { rpcPeer } from './support/spike-rpc.mjs';

async function protection(paths, env) {
  if (process.platform !== 'win32') {
    for (const path of paths) {
      const info = await stat(path);
      assert.equal(info.uid, process.getuid());
      assert.equal(info.mode & 0o077, 0, 'owner-only fixture access');
    }
    return;
  }
  const script = `$ErrorActionPreference='Stop';
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    foreach($p in ($env:CATALOG_PATHS -split [char]10)) {
      $a=Get-Acl -LiteralPath $p;
      if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 1};
      if(@($a.Access).Count -eq 0){exit 2};
      foreach($r in $a.Access){if($r.AccessControlType -ne 'Allow' -or
        $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 3}}
    }; exit 0`;
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...env, CATALOG_PATHS: paths.join('\n') }, timeout: 10000,
      maxBuffer: 65536, windowsHide: true });
  assert.ifError(child.error);
  assert.equal(child.status, 0, 'independent Windows fixture ACL inspection');
}

test('PORT-CATALOG: schema-2 owner CLI exposes exactly five standard MCP tools without broker',
  { timeout: 65000 }, async () => {
    const result = await managed(async (context) => {
      const state = join(context.directory, 'state');
      const executable = resolve('bin/proceed-mcp.js');
      const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
        .filter(key => process.env[key]).map(key => [key, process.env[key]]));
      Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
      const logs = [];
      const cli = (...args) => {
        const child = spawnSync(process.execPath, [executable, ...args, '--state-dir', state],
          { cwd: context.directory, env, timeout: 10000, maxBuffer: 65536,
            windowsHide: true, encoding: 'utf8' });
        assert.ifError(child.error);
        logs.push(`${child.stdout}${child.stderr}`);
        assert.equal(child.status, 0, `public ${args[0]} succeeds`);
      };
      cli('init');
      const configPath = join(state, 'config.json');
      assert.equal(JSON.parse(await readFile(configPath, 'utf8')).schema_version, 2);
      cli('owner', 'add', 'shared', '--label', 'Shared transport');
      const credentialDir = join(state, 'credentials');
      const files = ['control.token', 'owner.shared.token'].map(name => join(credentialDir, name));
      const secrets = await Promise.all(files.map(async file => (await readFile(file, 'utf8')).trim()));
      assert.ok(secrets.every(value => /^[a-f0-9]{64}$/.test(value)), 'fixture credential shape');
      assert.equal(new Set(secrets).size, 2, 'independent control/owner credentials');
      await protection([state, configPath, credentialDir, ...files], env);
      const child = spawn(process.execPath, [executable, 'mcp', '--owner', 'shared', '--state-dir', state],
        { cwd: context.directory, env, detached: process.platform !== 'win32', windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'] });
      const resource = { child, pid: child.pid, knownPids: [] };
      context.resources.push(resource);
      child.on('close', () => { resource.closed = true; });
      let bytes = 0;
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= 65536) logs.push(String(chunk));
      });
      const peer = rpcPeer(child);
      try {
        const init = await peer.call('initialize', { protocolVersion: '2025-11-25', capabilities: {},
          clientInfo: { name: 'generic-catalog-test', version: '0' } }, { ms: 8000 }).outcome;
        assert.equal(init.kind, 'response', 'owner CLI must reach initialize without broker');
        assert.equal(init.frame.jsonrpc, '2.0');
        assert.equal(init.frame.result?.protocolVersion, '2025-11-25');
        assert.ok(init.frame.result?.capabilities?.tools, 'tools capability advertised');
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const listing = await peer.call('tools/list', {}, { ms: 8000 }).outcome;
        assert.equal(listing.kind, 'response');
        assert.equal(listing.frame.jsonrpc, '2.0');
        const tools = listing.frame.result?.tools;
        const expected = {
          prepare_approval: [[], ['session_label']],
          request_approval: [['request_handle', 'request_capability', 'client_request_id', 'action', 'context'],
            ['request_handle', 'request_capability', 'client_request_id', 'action', 'context', 'expires_in_seconds']],
          get_approval: [['request_id', 'request_capability'], ['request_id', 'request_capability']],
          cancel_approval: [['request_id', 'request_capability'], ['request_id', 'request_capability']],
          acknowledge_approval: [['request_id', 'request_capability', 'decision_id'],
            ['request_id', 'request_capability', 'decision_id']],
        };
        assert.ok(Array.isArray(tools), 'catalog response');
        assert.deepEqual(tools.map(tool => tool.name).sort(), Object.keys(expected).sort());
        for (const { name, inputSchema: schema } of tools) {
          assert.equal(schema.type, 'object');
          assert.equal(schema.additionalProperties, false);
          assert.deepEqual([...(schema.required ?? [])].sort(), [...expected[name][0]].sort());
          assert.deepEqual(Object.keys(schema.properties).sort(), [...expected[name][1]].sort());
          for (const [field, definition] of Object.entries(schema.properties)) {
            assert.equal(definition.type, field === 'expires_in_seconds' ? 'integer' : 'string');
          }
        }
        const properties = name => tools.find(tool => tool.name === name).inputSchema.properties;
        for (const [field, minimum, maximum] of [['session_label', 1, 128], ['action', 1, 1000],
          ['context', 0, 1000]]) {
          const definition = properties(field === 'session_label' ? 'prepare_approval' : 'request_approval')[field];
          assert.equal(definition.minLength ?? 0, minimum);
          assert.equal(definition.maxLength, maximum);
        }
        const request = properties('request_approval');
        assert.equal(request.client_request_id.pattern, '^[A-Za-z0-9_-]{1,128}$');
        assert.equal(request.expires_in_seconds.minimum, 60);
        assert.equal(request.expires_in_seconds.maximum, 86400);
        assert.equal(request.expires_in_seconds.default, 3600);
        assert.ok(bytes <= 65536, 'bounded protocol output');
        assert.equal(peer.unmatched.length, 0, 'no unsolicited or non-protocol stdout');
        child.stdin.end();
        await bounded(() => new Promise(done => resource.closed ? done() : child.once('close', done)),
          5000, 'adapter must close after EOF');
        assert.equal(child.exitCode, 0, 'clean catalog adapter exit');
      } finally {
        peer.close();
        assert.ok(secrets.every(secret => !logs.some(text => text.includes(secret))),
          'no owner/control credential in CLI, MCP or diagnostics');
      }
    }, { totalMs: 55000 });
    assert.ifError(result.cleanupError);
    assert.ifError(result.assertionError);
  });
