// TEST ONLY: public empty-state process runner, controlled HTTPS is not live proof.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, appendFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { managed, bounded } from './managed-spike.mjs';
import { freePort, completed } from './startup-guards.mjs';
import { readJournal } from '../../src/journal/framing.js';
export const rows = bytes => readJournal(Buffer.from(bytes, 'base64')).transactions.map(t => t.mutations);
export const update = (id, code) => ({ update_id: id, message: { from: { id: 71, is_bot: false }, chat: { id: 81, type: 'private' }, text: `/pair ${code}` } });
export const paired = 'Paired. Approval questions can be sent to this chat. Approve, Reject and Respond are not recorded in this setup stage yet.';
export async function publicPoller(work, mode = '') {
  const root = resolve('.scratch/c1-poller-public'); await mkdir(root, { recursive: true });
  let phase;
  const result = await bounded(() => managed(async ctx => {
    phase = value => appendFile(join(root, 'progress.log'), `${ctx.directory.split(/[\\/]/).at(-1)} ${value}\n`);
    await phase('setup');
    const state = join(ctx.directory, 'state'), executable = resolve('bin/proceed-mcp.js');
    const preload = pathToFileURL(resolve('tests/fixtures/poller-public-preload.mjs'));
    const resources = []; let port;
    const start = async (args, selectedMode = '') => {
      preload.searchParams.set('mode', selectedMode);
      const r = await ctx.start([process.execPath, '--import', preload.href, executable, ...args, '--state-dir', state]);
      r.output = ''; resources.push(r);
      for (const stream of [r.child.stdout, r.child.stderr]) stream.on('data', b => { r.output += b; });
      r.child.send({ kind: 'go' }); return r;
    };
    const cli = async (...args) => { const r = await start(args); const code = await completed(r); return { code, output: r.output, events: r.events }; };
    const wait = async (r, predicate, label) => bounded(async () => {
      for (;;) {
        ctx.signal.throwIfAborted(); const event = r.events.find(predicate); if (event) return event;
        assert.ok(!r.closed && !r.failed, `process ended awaiting ${label}: ${r.output}`);
        await delay(10, undefined, { signal: ctx.signal });
      }
    }, 3000, label);
    const request = (r, method, index = 0) => wait(r, e => e.kind === 'request' && e.url.endsWith(`/${method}`)
      && r.events.filter(x => x.kind === 'request' && x.url.endsWith(`/${method}`)).indexOf(e) === index, `${method} ${index}`);
    const response = (r, req, result, extra = {}) => r.child.send({ kind: 'response', id: req.id, result, ...extra });
    const stop = async r => {
      if (!r.closed) { r.child.send({ kind: 'stop' }); assert.equal(await completed(r), 0, r.output); }
      await assert.rejects(access(join(state, 'broker.lock')), { code: 'ENOENT' });
    };
    try {
      assert.equal((await cli('init')).code, 0);
      const path = join(state, 'config.json'), config = JSON.parse(await readFile(path, 'utf8'));
      port = await freePort(); config.broker.port = port; await writeFile(path, JSON.stringify(config));
      const r = await start(['serve'], mode); const initial = await request(r, 'getUpdates');
      assert.deepEqual(rows(initial.bytes), [], 'protected initial state has no seeded history');
      const challenge = await cli('pair'); assert.equal(challenge.code, 0, challenge.output);
      assert.ok(challenge.events.some(e => e.kind === 'local-response' && e.path === '/v1/pairing' && e.status === 201));
      const code = /Pairing code: ([a-f0-9]{32})/.exec(challenge.output)?.[1]; assert.ok(code, 'real public challenge');
      await phase('assertions');
      await work({ r, initial, code, state, cli, wait, request, response, stop,
        start: () => start(['serve']), bytes: () => readFile(join(state, 'journal.log')).then(b => b.toString('base64')) });
      assert.ok(!r.output.includes(code) && !r.output.includes('offline-synthetic-token'), 'serve diagnostics disclose no challenge/token');
      assert.ok(!(await readFile(join(state, 'journal.log'))).includes(Buffer.from(code)), 'no plaintext public challenge persisted');
    } finally {
      await phase('teardown');
      for (const r of resources.filter(x => !x.closed)) r.child.send({ kind: 'release' });
      for (const r of resources.filter(x => !x.closed)) await stop(r);
      if (port) {
        const probe = createServer(); await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
        await new Promise(done => probe.close(done));
      }
    }
  }, { totalMs: 16000, readyMs: 3000 }), 24000, 'aggregate setup/assertions/teardown deadline');
  await phase(result.cleanupError ? 'cleanup-fail' : 'cleanup-pass: process tree and run directory absent');
  assert.ifError(result.cleanupError); assert.ifError(result.assertionError);
}
