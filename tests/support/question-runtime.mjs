// TEST ONLY: actual runtime composition, disposable protected local state. No live Telegram.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { startPortableRuntime } from '../../src/broker/portable-runtime.js';
import { statePaths } from '../../src/state/paths.js';
import { managed, bounded } from './managed-spike.mjs';
import { freePort } from './startup-guards.mjs';
export async function questionRuntime(work) {
  const result = await managed(async ctx => {
    const paths = statePaths(join(ctx.directory, 'state')), releases = [], logs = [];
    const progress = phase => fs.writeFile(join(ctx.directory, 'question-progress.json'), JSON.stringify({ phase }));
    await progress('setup');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TMP: ctx.directory, TEMP: ctx.directory, TMPDIR: ctx.directory });
    for (const args of [['init'], ['owner', 'add', 'a', '--label', 'A']]) {
      const r = spawnSync(process.execPath, [resolve('bin/proceed-mcp.js'), ...args, '--state-dir', paths.stateDir],
        { cwd: ctx.directory, env, timeout: 5000, encoding: 'utf8', maxBuffer: 65536, windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0, 'disposable protected setup');
    }
    const config = JSON.parse(await fs.readFile(paths.configFile)); config.broker.port = await freePort();
    await fs.writeFile(paths.configFile, JSON.stringify(config));
    const credential = (await fs.readFile(paths.controlCredentialFile, 'utf8')).trim();
    let runtime, syncHook = async () => {};
    const originalOpen = fs.open;
    fs.open = async function (path, ...args) {
      const file = await originalOpen.call(this, path, ...args);
      if (String(path) === paths.journalFile) { const sync = file.sync.bind(file); file.sync = async () => { await syncHook(); return sync(); }; }
      return file;
    }; syncBuiltinESMExports();
    const h = { logs, get runtime() { return runtime; },
      defer() { let release; const promise = new Promise(r => { release = r; }); releases.push(release); return { promise, release }; },
      sync(fn) { syncHook = fn; },
      async start(telegram, logger = () => {}) {
        runtime = await startPortableRuntime({ paths, config, telegram, logger: line => { logs.push(line); logger(line); } });
        const b = runtime.broker, c = await b.pairingChallenge();
        await b.completePairing({ code: c.code, userId: '71', chatId: '81', updateId: 1 });
        await h.create(); return runtime;
      },
      async create() {
        const b = runtime.broker;
        const key = await b.reserveHandle({ ownerId: 'a' });
        h.key = { ownerId: 'a', requestId: key.request_id, capability: key.request_capability };
        await b.createRequest({ ownerId: 'a', capability: key.request_capability, requestHandle: key.request_handle,
          clientRequestId: 'runtime', action: 'Question?', context: '', expiresInSeconds: 60 });
        return h.key;
      },
      async status() { const r = await fetch(`http://127.0.0.1:${config.broker.port}/v1/status`, {
        headers: { authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(1000) }); return r.status; }
    };
    try { await progress('assertions'); await work(h); }
    finally {
      await progress('teardown'); for (const release of releases) release(); syncHook = async () => {};
      try { await bounded(() => runtime?.stop(), 3000, 'question runtime drain'); }
      finally { fs.open = originalOpen; syncBuiltinESMExports(); }
      await assert.rejects(fs.access(paths.brokerLockFile), { code: 'ENOENT' });
      const probe = createServer(); await new Promise((done, reject) => { probe.once('error', reject); probe.listen(config.broker.port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
    }
  }, { totalMs: 18000 });
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}
