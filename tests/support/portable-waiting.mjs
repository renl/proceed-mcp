// TEST ONLY: real CLI/broker/MCP; controlled Telegram transport is NOT live proof.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { managed, bounded } from './managed-spike.mjs';
import { freePort, stopped } from './startup-guards.mjs';
import { rpcPeer } from './spike-rpc.mjs';

export async function until(check, label, signal) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
      signal?.throwIfAborted();
      const value = await check();
      if (value) return value;
      await delay(20, undefined, { signal });
  }
  throw Error(label);
}

export async function telegramFixture() {
  const calls = [], updates = [], messages = [];
  let updateId = 1, messageId = 100;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const method = req.url.slice(1);
      calls.push({ method, body });
      let result = true;
      if (method === 'getMe') result = { id: 99, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' };
      else if (method === 'getUpdates') {
        await delay(30);
        result = updates.filter((update) => update.update_id >= (body.offset ?? 0));
      } else if (method === 'sendMessage') {
        result = { ...body, message_id: messageId++, chat: { id: 7, type: 'private' } };
        messages.push(result);
      } else if (!['answerCallbackQuery', 'editMessageText', 'editMessageReplyMarkup'].includes(method)) {
        throw Error('unsupported fixture method');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    } catch { res.writeHead(400); res.end('{"ok":false}'); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = `http://127.0.0.1:${server.address().port}`;
  const enqueue = (value) => updates.push({ update_id: updateId++, ...value });
  const text = (value, reply) => enqueue({ message: { message_id: messageId++,
    from: { id: 7 }, chat: { id: 7, type: 'private' }, text: value,
    ...(reply ? { reply_to_message: { message_id: reply.message_id } } : {}) } });
  return { calls, messages, address, text,
    choose(message, prefix) {
      const button = message.reply_markup.inline_keyboard.flat().find((b) => b.callback_data.startsWith(`${prefix}:`));
      assert.ok(Boolean(button), 'actual Telegram presentation contains choice');
      enqueue({ callback_query: { id: `callback_${updateId}`, from: { id: 7 },
        message, data: button.callback_data } });
    },
    async close() {
      server.closeAllConnections();
      await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
      // Prove namespace listener release, not merely a close request.
      const probe = createServer();
      await new Promise((done, reject) => {
        probe.once('error', reject); probe.listen(Number(new URL(address).port), '127.0.0.1', done);
      });
      await new Promise((done) => probe.close(done));
    } };
}

export function success(outcome) {
  assert.equal(outcome.kind, 'response', 'bounded original RPC response required');
  const result = outcome.frame.result;
  assert.ok(result?.isError === false && !outcome.frame.error, 'tool must succeed, not protocol/tool error');
  const value = result.structuredContent;
  assert.ok(value?.schema_version === 1, 'versioned structured result');
  let matches = false;
  try { matches = result.content.some((block) => block.type === 'text'
    && isDeepStrictEqual(JSON.parse(block.text), value)); } catch { /* redacted */ }
  assert.ok(matches, 'matching text/structured result');
  return value;
}

export async function portable(work) {
  const fixture = await telegramFixture();
  const peers = [], connections = [], secrets = [], logs = [];
  let result;
  try {
    result = await managed(async (context) => {
      const state = join(context.directory, 'state');
      const executable = resolve('bin/proceed-mcp.js');
      const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
        .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
      const cli = async (...args) => {
        // Async commands while broker is alive: never block the fixture event loop.
        const child = spawn(process.execPath, [executable, ...args, '--state-dir', state],
          { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        const resource = { child, pid: child.pid, knownPids: [] };
        context.resources.push(resource);
        child.on('close', () => { resource.closed = true; });
        const chunks = [];
        let bytes = 0;
        for (const stream of [child.stdout, child.stderr]) stream.on('data', (b) => {
          bytes += b.length;
          if (bytes <= 65536) chunks.push(b);
        });
        const code = await bounded(() => new Promise((done, reject) => {
          child.once('error', reject); child.once('close', done);
        }), 8000, 'finite public CLI completion');
        const output = Buffer.concat(chunks).toString();
        logs.push(output);
        assert.ok(bytes <= 65536, 'bounded CLI output');
        assert.equal(code, 0, `public CLI ${args[0]} must succeed`);
        return output;
      };
      // Finite setup uses OS protection as implemented, never a permission bypass.
      const init = spawnSync(process.execPath, [executable, 'init', '--state-dir', state],
        { env, timeout: 10000, maxBuffer: 65536, windowsHide: true });
      assert.ifError(init.error);
      assert.equal(init.status, 0, 'public init succeeds');
      const configPath = join(state, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      assert.equal(config.schema_version, 2, 'portable schema 2 required; legacy origin/API setup is obsolete');
      config.broker.port = await freePort();
      await writeFile(configPath, `${JSON.stringify(config)}\n`);
      await cli('owner', 'add', 'shared', '--label', 'Shared transport');
      await cli('owner', 'add', 'foreign', '--label', 'Other transport');
      const preload = pathToFileURL(resolve('tests/fixtures/portable-telegram-preload.mjs'));
      preload.searchParams.set('fixture', fixture.address);
      const start = (...args) => context.start([process.execPath, '--import', preload.href,
        executable, ...args, '--state-dir', state]);
      let broker = await start('serve');
      broker.child.stderr.on('data', (b) => logs.push(String(b)));
      broker.child.stdout.on('data', (b) => logs.push(String(b)));
      const control = (await readFile(join(state, 'credentials/control.token'), 'utf8')).trim();
      const status = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${config.broker.port}/v1/status`,
            { headers: { authorization: `Bearer ${control}` }, signal: AbortSignal.timeout(500) });
          return response.ok;
        } catch { return false; }
      };
      await until(status, 'authenticated broker readiness', context.signal);
      const pairing = await cli('pair');
      const code = /Pairing code: (\S+)/.exec(pairing)?.[1];
      assert.ok(Boolean(code), 'operator CLI returns pairing challenge');
      fixture.text(`/pair ${code}`);
      await until(() => fixture.messages.some((m) => !m.reply_markup), 'pairing confirmation', context.signal);
      const connect = async (owner) => {
        const resource = await start('mcp', '--owner', owner);
        resource.child.stderr.on('data', (b) => logs.push(String(b)));
        const peer = rpcPeer(resource.child);
        peers.push(peer);
        connections.push({ peer, resource });
        await peer.handshake();
        return { peer, resource, call: (name, args, id) => {
          const entry = peer.call('tools/call', { name, arguments: args }, { id, ms: 12000 });
          entry.outcome = entry.outcome.then((outcome) => {
            if (name !== 'prepare_approval') assert.ok(secrets.every((key) =>
              !JSON.stringify(outcome).includes(key)), 'only preparation result may disclose request key');
            return outcome;
          });
          return entry;
        } };
      };
      const shared = await connect('shared');
      const restart = async () => {
        for (const { peer, resource } of connections) {
          peer.close(); resource.child.stdin.end();
          await until(() => resource.closed, 'adapter EOF shutdown', context.signal);
        }
        await stopped(broker); // Graceful own-state release; no stale-lock deletion.
        broker = await start('serve');
        for (const stream of [broker.child.stdout, broker.child.stderr]) stream.on('data', (b) => logs.push(String(b)));
        await until(status, 'restarted authenticated broker readiness', context.signal);
        return connect('shared');
      };
      const prepare = async (connection = shared) => {
        const value = success(await connection.call('prepare_approval', { session_label: 'same label' }).outcome);
        assert.ok(/^cap_[a-f0-9]{64}$/.test(value.request_capability), '256-bit request authority');
        secrets.push(value.request_capability);
        assert.ok(/^hdl_[a-f0-9]{32}$/.test(value.request_handle) && /^req_[a-f0-9]{32}$/.test(value.request_id), 'independent reserved identities');
        return value;
      };
      const scan = async () => {
        const visible = JSON.stringify([fixture.calls, logs, peers.map((peer) => peer.unmatched)]);
        const journal = await readFile(join(state, 'journal.log'));
        assert.ok(secrets.every((key) => !visible.includes(key) && !journal.includes(Buffer.from(key))),
          'no plaintext request authority in Telegram/logs/unmatched notifications/journal');
      };
      try { await work({ fixture, shared, connect, prepare, state, broker, start, scan, restart,
        signal: context.signal, cli }); }
      finally { for (const peer of peers) peer.close(); await scan(); }
    }, { totalMs: 55000, readyMs: 8000 });
  } finally { await fixture.close(); }
  assert.ifError(result.cleanupError); // Separate resource failure from behavioral RED.
  assert.ifError(result.assertionError);
  return result;
}

export const authority = (prepared) => ({ request_id: prepared.request_id,
  request_capability: prepared.request_capability });
export const question = (prepared) => ({ request_handle: prepared.request_handle,
  request_capability: prepared.request_capability, client_request_id: 'same_id',
  action: 'Controlled offline action', context: '', expires_in_seconds: 60 });
export const ask = (connection, prepared, id) => connection.call('request_approval', question(prepared), id);
export const get = async (connection, prepared) => success(await connection.call('get_approval', authority(prepared)).outcome);
