// TEST ONLY: real CLI/broker/MCP; controlled Telegram transport is NOT live proof.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, appendFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { managed, bounded } from './managed-spike.mjs';
import { freePort, stopped } from './startup-guards.mjs';
import { rpcPeer } from './spike-rpc.mjs';
import { catalogPeer, initializeResult, allTools } from './catalog-consumer.mjs';
import { lockAt, exchange } from './automatic-startup.mjs';

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
  const calls = [],
    updates = [],
    messages = [],
    batches = [],
    forced = [];
  let observe = async () => {};
  const polls = new Set();
  let updateId = 1,
    messageId = 100;
  let fixtureClosed = false;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const method = req.url.slice(1);
      calls.push({ method, body });
      if (await observe(calls.at(-1), res)) return;
      let result = true;
      if (method === 'getMe')
        result = { id: 99, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' };
      else if (method === 'getUpdates') {
        if (!forced.length && !updates.some((update) => update.update_id >= (body.offset ?? 0))) {
          await new Promise((done) => {
            const wake = () => {
              polls.delete(wake);
              res.off('close', wake);
              done();
            };
            polls.add(wake);
            res.once('close', wake);
          });
        }
        result =
          forced.shift() ?? updates.filter((update) => update.update_id >= (body.offset ?? 0));
        batches.push({ offset: body.offset, updates: result });
      } else if (method === 'sendMessage') {
        result = {
          ...body,
          message_id: messageId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 7, type: 'private' },
        };
        messages.push(result);
      } else if (['editMessageText', 'editMessageReplyMarkup'].includes(method)) {
        result = {
          message_id: body.message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 7, type: 'private' },
        };
      } else if (method !== 'answerCallbackQuery') {
        throw Error('unsupported fixture method');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    } catch {
      res.writeHead(400);
      res.end('{"ok":false}');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = `http://127.0.0.1:${server.address().port}`;
  const enqueue = (value) => {
    const id = updateId++;
    updates.push({ update_id: id, ...value });
    for (const wake of [...polls]) wake();
    return id;
  };
  const text = (value, reply) =>
    enqueue({
      message: {
        message_id: messageId++,
        date: Math.floor(Date.now() / 1000),
        from: { id: 7, is_bot: false },
        chat: { id: 7, type: 'private' },
        text: value,
        ...(reply ? { reply_to_message: { message_id: reply.message_id } } : {}),
      },
    });
  return {
    calls,
    messages,
    address,
    text,
    enqueue,
    batches,
    // Deliberate remote replay despite offset, proving the real consumer rather
    // than having fixture filtering silently remove the stale input under test.
    redeliver(batch) {
      forced.push(batch);
      for (const wake of [...polls]) wake();
    },
    observe(value) {
      observe = value;
    },
    choose(message, prefix) {
      const button = message.reply_markup.inline_keyboard
        .flat()
        .find((b) => b.callback_data.startsWith(`${prefix}:`));
      assert.ok(Boolean(button), 'actual Telegram presentation contains choice');
      enqueue({
        callback_query: {
          id: `callback_${updateId}`,
          from: { id: 7, is_bot: false },
          message,
          data: button.callback_data,
        },
      });
    },
    async close() {
      if (fixtureClosed) return;
      for (const wake of [...polls]) wake();
      server.closeAllConnections();
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      // Prove namespace listener release, not merely a close request.
      const probe = createServer();
      await new Promise((done, reject) => {
        probe.once('error', reject);
        probe.listen(Number(new URL(address).port), '127.0.0.1', done);
      });
      fixtureClosed = true;
      await new Promise((done) => probe.close(done));
    },
  };
}

export function success(outcome) {
  assert.equal(outcome.kind, 'response', 'bounded original RPC response required');
  const result = outcome.frame.result;
  assert.ok(
    result?.isError === false && !outcome.frame.error,
    'tool must succeed, not protocol/tool error',
  );
  const value = result.structuredContent;
  assert.ok(value?.schema_version === 1, 'versioned structured result');
  let matches = false;
  try {
    matches = result.content.some(
      (block) => block.type === 'text' && isDeepStrictEqual(JSON.parse(block.text), value),
    );
  } catch {
    /* redacted */
  }
  assert.ok(matches, 'matching text/structured result');
  return value;
}

export async function portable(
  work,
  {
    pair = true,
    strictProtocol = false,
    controlledClock = false,
    journalFaults = false,
    connectAdapter = true,
    brokerObserver = false,
  } = {},
) {
  await mkdir(resolve('.scratch/c3-activation'), { recursive: true });
  const fixture = await telegramFixture();
  const peers = [],
    connections = [],
    secrets = [],
    logs = [];
  let result;
  try {
    result = await bounded(
      () =>
        managed(
          async (context) => {
            const phase = (value) =>
              appendFile(
                resolve('.scratch/c3-activation/progress.log'),
                `${context.directory.split(/[\\/]/).at(-1)} ${value}\n`,
              );
            await phase('setup');
            const state = join(context.directory, 'state');
            const clockPath = join(context.directory, 'clock.json');
            const setTime = async (value) => {
              assert.ok(Number.isSafeInteger(value), 'test clock is an exact millisecond instant');
              await writeFile(clockPath, JSON.stringify(value));
            };
            if (controlledClock) await setTime(Date.now());
            const executable = resolve('bin/proceed-mcp.js');
            const env = Object.fromEntries(
              ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
                .filter((key) => process.env[key])
                .map((key) => [key, process.env[key]]),
            );
            Object.assign(env, {
              TEMP: context.directory,
              TMP: context.directory,
              TMPDIR: context.directory,
            });
            const cli = async (...args) => {
              // Async commands while broker is alive: never block the fixture event loop.
              const child = spawn(process.execPath, [executable, ...args, '--state-dir', state], {
                env,
                windowsHide: true,
                detached: process.platform !== 'win32',
                stdio: ['pipe', 'pipe', 'pipe'],
              });
              const resource = { child, pid: child.pid, knownPids: [] };
              context.resources.push(resource);
              child.on('close', () => {
                resource.closed = true;
              });
              const chunks = [];
              let bytes = 0;
              for (const stream of [child.stdout, child.stderr])
                stream.on('data', (b) => {
                  bytes += b.length;
                  if (bytes <= 65536) chunks.push(b);
                });
              const code = await bounded(
                () =>
                  new Promise((done, reject) => {
                    child.once('error', reject);
                    child.once('close', done);
                  }),
                8000,
                'finite public CLI completion',
              );
              const output = Buffer.concat(chunks).toString();
              logs.push(output);
              assert.ok(bytes <= 65536, 'bounded CLI output');
              assert.equal(code, 0, `public CLI ${args[0]} must succeed`);
              return output;
            };
            // Finite setup uses OS protection as implemented, never a permission bypass.
            const init = spawnSync(process.execPath, [executable, 'init', '--state-dir', state], {
              env,
              timeout: 10000,
              maxBuffer: 65536,
              windowsHide: true,
            });
            assert.ifError(init.error);
            assert.equal(init.status, 0, 'public init succeeds');
            const configPath = join(state, 'config.json');
            const config = JSON.parse(await readFile(configPath, 'utf8'));
            assert.equal(
              config.schema_version,
              2,
              'portable schema 2 required; legacy origin/API setup is obsolete',
            );
            config.broker.port = await freePort();
            await writeFile(configPath, `${JSON.stringify(config)}\n`);
            await cli('owner', 'add', 'shared', '--label', 'Shared transport');
            await cli('owner', 'add', 'foreign', '--label', 'Other transport');
            const preload = pathToFileURL(resolve('tests/fixtures/portable-telegram-preload.mjs'));
            preload.searchParams.set('fixture', fixture.address);
            const clockPreload = pathToFileURL(
              resolve('tests/fixtures/portable-clock-preload.mjs'),
            );
            clockPreload.searchParams.set('clock', clockPath);
            const faultPreload = pathToFileURL(
              resolve('tests/fixtures/portable-faults-preload.mjs'),
            );
            const start = (...args) =>
              context.start([
                process.execPath,
                '--import',
                preload.href,
                ...(brokerObserver && args[0] === 'serve'
                  ? [
                      '--import',
                      pathToFileURL(
                        resolve('tests/fixtures/harness-composition/broker-observer.mjs'),
                      ).href,
                    ]
                  : []),
                ...(controlledClock && args[0] === 'serve' ? ['--import', clockPreload.href] : []),
                ...(journalFaults && args[0] === 'serve' ? ['--import', faultPreload.href] : []),
                executable,
                ...args,
                '--state-dir',
                state,
              ]);
            let broker = await start('serve', '--secure-local');
            const brokerOutput = [];
            let brokerOutputBytes = 0,
              brokerOutputOverflow = false;
            for (const stream of [broker.child.stderr, broker.child.stdout])
              stream.on('data', (b) => {
                logs.push(String(b));
                if (brokerObserver) {
                  brokerOutputBytes += b.length;
                  if (brokerOutputBytes <= 1048576) brokerOutput.push(Buffer.from(b));
                  else brokerOutputOverflow = true;
                }
              });
            const control = (
              await readFile(join(state, 'credentials/control.token'), 'utf8')
            ).trim();
            const credentials = strictProtocol
              ? await Promise.all(
                  (await readdir(join(state, 'credentials'))).map(async (name) =>
                    (await readFile(join(state, 'credentials', name), 'utf8')).trim(),
                  ),
                )
              : [];
            secrets.push(...credentials);
            const status = async () => {
              try {
                const response = await exchange(await lockAt(state), control, '/v1/status');
                return response.status === 200;
              } catch {
                return false;
              }
            };
            await until(status, 'authenticated broker readiness', context.signal);
            if (pair) {
              const pairing = await cli('pair');
              const code = /Pairing code: (\S+)/.exec(pairing)?.[1];
              assert.ok(Boolean(code), 'operator CLI returns pairing challenge');
              secrets.push(code);
              fixture.text(`/pair ${code}`);
              await until(
                () => fixture.messages.some((m) => !m.reply_markup),
                'pairing confirmation',
                context.signal,
              );
            }
            const connect = async (owner) => {
              const resource = await start('mcp', '--owner', owner);
              resource.child.stderr.on('data', (b) => logs.push(String(b)));
              const peer = strictProtocol
                ? catalogPeer(resource.child, { secrets: credentials })
                : rpcPeer(resource.child);
              peers.push(peer);
              connections.push({ peer, resource });
              let catalog, initialization;
              if (strictProtocol) {
                initializeResult(
                  await peer.call('initialize', {
                    protocolVersion: '2025-11-25',
                    capabilities: {},
                    clientInfo: { name: 'generic-reservation-test', version: '0' },
                  }).outcome,
                );
                resource.child.stdin.write(
                  `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
                );
                catalog = { kind: 'response', frame: { result: { tools: await allTools(peer) } } };
              } else {
                initialization = await peer.handshake();
                catalog = await peer.call('tools/list', {}, { ms: 8000 }).outcome;
              }
              assert.equal(catalog.kind, 'response');
              for (const name of [
                'prepare_approval',
                'request_approval',
                'get_approval',
                'cancel_approval',
                'acknowledge_approval',
              ]) {
                assert.ok(
                  catalog.frame.result?.tools?.some((tool) => tool.name === name),
                  `portable MCP catalog exposes ${name}`,
                );
              }
              return {
                peer,
                resource,
                initialization,
                call: (name, args, id) => {
                  const entry = peer.call(
                    'tools/call',
                    { name, arguments: args },
                    { id, ms: 12000 },
                  );
                  entry.outcome = entry.outcome.then((outcome) => {
                    if (name !== 'prepare_approval')
                      assert.ok(
                        secrets.every((key) => !JSON.stringify(outcome).includes(key)),
                        'only preparation result may disclose request key',
                      );
                    return outcome;
                  });
                  return entry;
                },
              };
            };
            // Qualification owns its sole adapter through the actual host. Setup
            // must not silently start an unrelated MCP connection.
            const shared = connectAdapter ? await connect('shared') : null;
            const restart = async ({ whileStopped, beforeReadiness } = {}) => {
              for (const { peer, resource } of connections) {
                peer.close?.();
                resource.child.stdin.end();
                await until(() => resource.closed, 'adapter EOF shutdown', context.signal);
                if (strictProtocol) peer.assertComplete();
              }
              await stopped(broker); // Graceful own-state release; no stale-lock deletion.
              await whileStopped?.();
              broker = await start('serve', '--secure-local');
              for (const stream of [broker.child.stdout, broker.child.stderr])
                stream.on('data', (b) => logs.push(String(b)));
              await beforeReadiness?.();
              await until(status, 'restarted authenticated broker readiness', context.signal);
              return connect('shared');
            };
            const prepare = async (connection = shared) => {
              const value = success(
                await connection.call('prepare_approval', { session_label: 'same label' }).outcome,
              );
              assert.ok(
                /^cap_[a-f0-9]{64}$/.test(value.request_capability),
                '256-bit request authority',
              );
              secrets.push(value.request_capability);
              assert.ok(
                /^hdl_[a-f0-9]{32}$/.test(value.request_handle) &&
                  /^req_[a-f0-9]{32}$/.test(value.request_id),
                'independent reserved identities',
              );
              return value;
            };
            const scan = async () => {
              const visible = JSON.stringify([
                fixture.calls,
                logs,
                peers.map((peer) => peer.unmatched),
              ]);
              const journal = await readFile(join(state, 'journal.log'));
              assert.ok(
                secrets.every(
                  (key) => !visible.includes(key) && !journal.includes(Buffer.from(key)),
                ),
                'no plaintext request authority in Telegram/logs/unmatched notifications/journal',
              );
            };
            const http = async (path, credential, { method = 'GET', body, headers = {} } = {}) => {
              const response = await exchange(
                await lockAt(state),
                credential,
                path,
                body,
                headers,
                { method },
              );
              return new Response(JSON.stringify(response.body), { status: response.status });
            };
            await phase('assertions');
            try {
              await work({
                fixture,
                shared,
                connect,
                prepare,
                state,
                broker,
                start,
                scan,
                restart,
                signal: context.signal,
                cli,
                http,
                control,
                setupSecrets: Object.freeze(secrets.slice()),
                closedBrokerOutput() {
                  assert.ok(
                    broker.closed &&
                      broker.child.stdout.readableEnded &&
                      broker.child.stderr.readableEnded,
                  );
                  assert.equal(brokerOutputOverflow, false);
                  return Buffer.concat(brokerOutput);
                },
                async stopCaptureWriters() {
                  assert.equal(connectAdapter, false, 'host must own the sole adapter');
                  if (!broker.closed) await stopped(broker);
                  assert.ok(
                    broker.closed &&
                      broker.child.stdout.readableEnded &&
                      broker.child.stderr.readableEnded,
                  );
                  await fixture.close();
                  return { broker: 'CLOSED', telegram: 'CLOSED' };
                },
                ...(controlledClock ? { setTime } : {}),
              });
            } finally {
              await phase('teardown');
              for (const { peer, resource } of connections) {
                peer.close?.();
                if (strictProtocol && !resource.closed) {
                  resource.child.stdin.end();
                  await until(() => resource.closed, 'strict adapter EOF shutdown', context.signal);
                }
                if (strictProtocol) peer.assertComplete();
              }
              await scan();
            }
          },
          { totalMs: brokerObserver ? 180000 : 55000, readyMs: 8000 },
        ),
      brokerObserver ? 188000 : 63000,
      'aggregate public setup/assertions/cleanup deadline',
    );
  } finally {
    await fixture.close();
  }
  assert.ifError(result.cleanupError); // Separate resource failure from behavioral RED.
  await appendFile(
    resolve('.scratch/c3-activation/progress.log'),
    `${result.directory.split(/[\\/]/).at(-1)} cleanup-pass: owned process tree and run directory absent, fixture listener released\n`,
  );
  assert.ifError(result.assertionError);
  return result;
}

export const authority = (prepared) => ({
  request_id: prepared.request_id,
  request_capability: prepared.request_capability,
});
export const question = (prepared) => ({
  request_handle: prepared.request_handle,
  request_capability: prepared.request_capability,
  client_request_id: 'same_id',
  action: 'Controlled offline action',
  context: '',
  expires_in_seconds: 60,
});
export const ask = (connection, prepared, id) =>
  connection.call('request_approval', question(prepared), id);
export const get = async (connection, prepared) =>
  success(await connection.call('get_approval', authority(prepared)).outcome);
