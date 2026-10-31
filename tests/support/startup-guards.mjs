// TEST ONLY. Public executable consumer; uses the existing finite harness.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { managed, bounded } from './managed-spike.mjs';

const executable = resolve('bin/proceed-mcp.js');
const preload = pathToFileURL(resolve('tests/fixtures/startup-guards-preload.mjs')).href;
export async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
export async function completed(resource) {
  await bounded(async () => {
    while (!resource.closed) await delay(10);
  }, 5000, 'public CLI must finish within five seconds');
  assert.equal(resource.child.signalCode, null, 'CLI must exit normally');
  return resource.child.exitCode;
}
export async function stopped(resource) {
  resource.child.send({ kind: 'stop' });
  assert.equal(await completed(resource), 0, 'graceful public serve exit');
}
export async function guards(work) {
  const result = await managed(async (context) => {
    const state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { TEMP: context.directory, TMP: context.directory,
      TMPDIR: context.directory });
    const cli = (...args) => {
      const child = spawnSync(process.execPath,
        [executable, ...args, '--state-dir', state],
        { env, timeout: 10000, maxBuffer: 65536, windowsHide: true });
      assert.ifError(child.error);
      assert.equal(child.status, 0, `public fixture setup CLI succeeds: ${String(child.stderr).slice(0, 1000)}`);
    };
    cli('init');
    const configPath = join(state, 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.broker.port = await freePort();
    const save = () => writeFile(configPath, `${JSON.stringify(config)}\n`);
    await save();
    const start = () => context.start([process.execPath, '--import', preload,
      executable, 'serve', '--state-dir', state]);
    await work({ state, config, save, cli, start, context });
  }, { totalMs: 30000, readyMs: 8000 });
  assert.ifError(result.cleanupError); // Report cleanup independently of behavior.
  assert.ifError(result.assertionError);
}
