// TEST ONLY. Installed public CLI, no real Telegram or live first-use proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, sep, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { managed } from './support/managed-spike.mjs';
import { completed, stopped } from './support/startup-guards.mjs';
import { catalogPeer, initializeResult, allTools, workflowInstructions } from './support/catalog-consumer.mjs';

test('PREVIEW-INSTALLED: fresh protected owner setup and installed stdio catalog', { timeout: 45000 }, async () => {
  const executable = process.env.PROCEED_TEST_INSTALLED_BIN;
  assert.ok(executable && isAbsolute(executable), 'explicit isolated installed bin required');
  assert.ok(resolve(executable).startsWith(resolve('.scratch') + sep),
    'installed artifact must remain inside worktree scratch');
  const manifest = JSON.parse(await readFile(join(dirname(dirname(executable)), 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'proceed-mcp');
  assert.equal(manifest.version, '0.1.0-preview.1');
  const preload = pathToFileURL(resolve('tests/fixtures/release-observer.mjs')).href;
  const result = await managed(async (context) => {
    const state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
    env.PATH = dirname(process.execPath) + delimiter + (env.PATH ?? '');
    const command = join(dirname(dirname(dirname(executable))), '.bin',
      process.platform === 'win32' ? 'proceed-mcp.cmd' : 'proceed-mcp');
    const help = process.platform === 'win32'
      ? spawnSync(env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" --help"`],
        { cwd: context.directory, env, timeout: 5000, maxBuffer: 65536, windowsHide: true })
      : spawnSync(command, ['--help'],
        { cwd: context.directory, env, timeout: 5000, maxBuffer: 65536 });
    assert.ifError(help.error);
    assert.equal(help.status, 0, 'installed named command help succeeds');
    const cli = (...args) => {
      const child = spawnSync(process.execPath, ['--import', preload, executable, ...args, '--state-dir', state], {
        cwd: context.directory, env, timeout: 5000, maxBuffer: 65536, windowsHide: true,
      });
      assert.ifError(child.error);
      return child;
    };
    assert.equal(cli('not-a-command').status, 2);
    assert.equal(cli('init').status, 0, 'protection failure is not a passing setup');
    assert.notEqual(cli('init').status, 0, 'existing state cannot be overwritten');
    assert.equal(cli('owner', 'add', 'preview_owner', '--label', 'Preview test').status, 0);
    const broker = await context.start([process.execPath, '--import', preload, executable, 'serve', '--state-dir', state]);
    await broker.wait('broker-ready');
    const status = cli('status', '--json');
    assert.equal(status.status, 0);
    const value = JSON.parse(status.stdout);
    assert.equal(value.schema_version, 1);
    assert.deepEqual(value.requests, []);
    const adapter = await context.start([process.execPath, '--import', preload, executable,
      'mcp', '--owner', 'preview_owner', '--state-dir', state]);
    const peer = catalogPeer(adapter.child);
      const init = initializeResult(await peer.call('initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' },
      }).outcome);
      assert.equal(init.serverInfo.name, 'proceed-mcp');
      assert.equal(init.serverInfo.version, manifest.version);
      adapter.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const tools = await allTools(peer);
      assert.ok(tools.some((tool) => tool.name === 'prepare_approval'));
      assert.ok(tools.some((tool) => tool.name === 'request_approval'));
      workflowInstructions(init, tools);
      adapter.child.stdin.end();
      assert.equal(await completed(adapter), 0, 'public EOF completes adapter');
      peer.assertComplete();
    await stopped(broker);
  }, { totalMs: 30000, readyMs: 5000 });
  assert.ifError(result.cleanupError);
  assert.ifError(result.assertionError);
});
