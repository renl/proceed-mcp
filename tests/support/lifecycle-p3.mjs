// TEST ONLY: actual runtime/core/Journal and public HTTP producers, no seeded history.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import https from 'node:https';
import http, { Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Journal } from '../../src/journal/journal.js';
import { readJournal } from '../../src/journal/framing.js';
import { startPortableRuntime } from '../../src/broker/portable-runtime.js';
import { createTelegramClient } from '../../src/telegram/client.js';
import { statePaths } from '../../src/state/paths.js';
import { managed, bounded } from './managed-spike.mjs';
import { freePort } from './startup-guards.mjs';
import { telegramFixture, until } from './portable-waiting.mjs';

export const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
export async function lifecycle(work) {
  await fs.mkdir(resolve('.scratch/c3-lifecycle'), { recursive: true });
  const fixture = await telegramFixture(), releases = [], runtimes = [];
  const originals = { request: https.request, open: fs.open, append: Journal.prototype.append,
    close: Journal.prototype.close, server: Server.prototype.close };
  const events = [], calls = [], logs = [], transports = [];
  let paths, selected, active, prototype, coreClose;
  const result = await managed(async ctx => {
    const phase = name => fs.appendFile(resolve('.scratch/c3-lifecycle/progress.log'), `${ctx.directory.split(/[\\/]/).at(-1)} ${name}\n`);
    await phase('setup');
    paths = statePaths(join(ctx.directory, 'state'));
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { TEMP: ctx.directory, TMP: ctx.directory, TMPDIR: ctx.directory });
    for (const args of [['init'], ['owner', 'add', 'a', '--label', 'A']]) {
      const r = spawnSync(process.execPath, [resolve('bin/proceed-mcp.js'), ...args, '--state-dir', paths.stateDir],
        { env, timeout: 8000, maxBuffer: 65536, windowsHide: true });
      assert.ifError(r.error); assert.equal(r.status, 0, 'public protected setup');
    }
    const config = JSON.parse(await fs.readFile(paths.configFile)); config.broker.port = await freePort();
    await fs.writeFile(paths.configFile, JSON.stringify(config) + '\n');
    const control = (await fs.readFile(paths.controlCredentialFile, 'utf8')).trim();
    const owner = (await fs.readFile(paths.ownerCredentialFile('a'), 'utf8')).trim();
    https.request = (url, options, callback) => {
      assert.match(String(url), /^https:\/\/api\.telegram\.org\/botoffline-lifecycle\/[A-Za-z]+$/);
      const request = http.request(`${fixture.address}/${new URL(url).pathname.split('/').at(-1)}`, options, callback);
      const transport = { request, closed: false }; transports.push(transport);
      request.once('close', () => { transport.closed = true; }); return request;
    };
    Journal.prototype.append = async function (rows, ...args) {
      // Only the run-owned runtime opens a Journal while these serial observers are installed.
      if (selected && rows.some(m => m.op === selected.op)) { active = selected; selected = null; }
      try { const value = await originals.append.call(this, rows, ...args); events.push(...rows.map(m => `commit:${m.op}`)); return value; }
      finally { active = null; }
    };
    fs.open = async (...args) => {
      const fh = await originals.open(...args);
      if (String(args[0]) === paths.journalFile) {
        const sync = fh.sync.bind(fh);
        fh.sync = async () => {
          if (active) { active.entered.release(); await active.release.promise; }
          return sync();
        };
      }
      return fh;
    };
    Journal.prototype.close = async function (...args) {
      events.push('journal-close'); await fs.access(paths.brokerLockFile);
      return originals.close.apply(this, args);
    };
    Server.prototype.close = function (...args) {
      if (this.address()?.port === config.broker.port) events.push('listener-close');
      return originals.server.apply(this, args);
    };
    syncBuiltinESMExports();
    const client = createTelegramClient({ token: 'offline-lifecycle' });
    const wrap = (overrides = {}) => Object.fromEntries(Object.entries(client).map(([name, fn]) => [name, (...args) => {
      calls.push({ name, args });
      return overrides[name] ? overrides[name](fn.bind(client), ...args) : fn.apply(client, args);
    }]));
    const request = async (path, { method = 'GET', body, capability, token = owner } = {}) => {
      const response = await fetch(`http://127.0.0.1:${config.broker.port}${path}`, { method,
        headers: { authorization: `Bearer ${token}`, ...(capability ? { 'X-Proceed-Request-Capability': capability } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(2500) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const rows = async () => readJournal(await fs.readFile(paths.journalFile)).transactions.flatMap(t => t.mutations);
    const start = async (telegram = wrap(), options = {}) => {
      const runtime = await startPortableRuntime({ paths, config, telegram, logger: line => { logs.push(line); options.log?.(line); } });
      runtimes.push(runtime);
      if (!prototype) {
        prototype = Object.getPrototypeOf(runtime.broker); coreClose = prototype.close;
        prototype.close = async function (...args) { events.push('core-close'); return coreClose.apply(this, args); };
      }
      return runtime;
    };
    const hold = op => {
      const release = gate(), entered = gate(); releases.push(release);
      selected = { op, release, entered }; return { release: release.release, entered: entered.promise };
    };
    const pair = async () => {
      const r = await request('/v1/pairing', { token: control, method: 'POST', body: {} }); assert.equal(r.status, 201);
      fixture.text(`/pair ${r.body.code}`);
      await until(async () => (await rows()).some(m => m.op === 'pairing.set'), 'real pairing commit', ctx.signal);
    };
    const create = async key => {
      const p = await request('/v1/handles', { method: 'POST', body: {} }); assert.equal(p.status, 201);
      const r = await request('/v1/requests', { method: 'POST', capability: p.body.request_capability,
        body: { request_handle: p.body.request_handle, client_request_id: key.replaceAll(' ', '_'), action: key, context: '', expires_in_seconds: 60 } });
      assert.equal(r.status, 201); return { ...p.body, request: r.body };
    };
    const records = async (op, p) => (await rows()).filter(m => m.op === op && (!p || m.request_id === p.request_id));
    const mapped = p => until(() => fixture.messages.find(m => m.text.includes(p.request_id) && m.reply_markup?.inline_keyboard), 'question', ctx.signal);
    const opened = async p => {
      const message = await mapped(p);
      await until(async () => (await records('telegram.presentation.sent', p)).length, 'question receipt', ctx.signal);
      fixture.choose(message, 't');
      await until(async () => (await records('telegram.response.open', p)).length, 'real response opening', ctx.signal);
    };
    try {
      await phase('assertions');
      await bounded(() => work({ start, wrap, request, rows, records, pair, create, mapped, opened, hold,
        calls, logs, events, transports, paths, fixture, signal: ctx.signal, releaseOnCleanup: g => releases.push(g) }), 30000, 'lifecycle assertions deadline');
    } finally {
      await phase('teardown');
      for (const g of releases) g.release();
      for (const runtime of runtimes.reverse()) await bounded(() => runtime.stop(), 5000, 'runtime cleanup deadline');
      await assert.rejects(fs.access(paths.brokerLockFile), { code: 'ENOENT' });
      const probe = http.createServer();
      await new Promise((done, reject) => { probe.once('error', reject); probe.listen(config.broker.port, '127.0.0.1', done); });
      await new Promise(done => probe.close(done));
      await phase('resources-released');
    }
  }, { totalMs: 55000 });
  https.request = originals.request; fs.open = originals.open;
  Journal.prototype.append = originals.append; Journal.prototype.close = originals.close; Server.prototype.close = originals.server;
  if (prototype) prototype.close = coreClose;
  syncBuiltinESMExports();
  await fixture.close();
  await fs.appendFile(resolve('.scratch/c3-lifecycle/progress.log'), `${result.directory.split(/[\\/]/).at(-1)} ${result.cleanupError ? 'cleanup-fail' : 'cleanup-pass'}\n`);
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}
