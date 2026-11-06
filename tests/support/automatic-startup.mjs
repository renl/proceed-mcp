// TEST ONLY. Narrow safety-checkpoint support, not a production transport.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, stat, access } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import http from 'node:http';
import tls from 'node:tls';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const identity = 'proceed-mcp-local-v1';
export const profile = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
  ciphers: 'PSK-AES256-GCM-SHA384',
  secureOptions: constants.SSL_OP_NO_TICKET,
};

export function assertJournalOwnership(events, winnerPids) {
  assert.ok(winnerPids.length > 0, 'actual ownership winners are required');
  const opens = events.filter((event) => event.event === 'journal-open');
  for (const pid of winnerPids)
    assert.ok(
      opens.some((event) => event.pid === pid),
      'each actual ownership winner must have a journal-open witness',
    );
  assert.ok(
    opens.every((event) => winnerPids.includes(event.pid)),
    'only ownership winners may open journal',
  );
}

export async function listen(server, port = 0) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return server.address().port;
}

export async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}

export async function until(check, ms, label) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw Error(label);
}

export function absent(path) {
  return access(path).then(
    () => false,
    (error) => {
      if (error.code === 'ENOENT') return true;
      throw error;
    },
  );
}

export async function refused(port) {
  return new Promise((done, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Error('probe indeterminate'));
    }, 1000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      done(false);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error.code === 'ECONNREFUSED') done(true);
      else reject(Error('probe indeterminate'));
    });
  });
}

export async function lockAt(state) {
  const path = join(state, 'broker.lock');
  const info = await stat(path);
  assert.equal(info.mode & 0o777, 0o600, 'secret lock is owner-only');
  assert.equal(info.uid, process.geteuid(), 'secret lock belongs to effective user');
  assert.equal(info.nlink, 1);
  const bytes = await readFile(path);
  assert.ok(bytes.length <= 4096);
  const lock = JSON.parse(bytes);
  assert.deepEqual(Object.keys(lock).sort(), [
    'channel',
    'instance',
    'pid',
    'port',
    'schema_version',
    'started_at',
  ]);
  assert.equal(lock.schema_version, 2);
  assert.deepEqual(Object.keys(lock.channel).sort(), ['protocol', 'psk']);
  assert.equal(lock.channel.protocol, 'tls-psk-v1');
  assert.ok(/^[a-f0-9]{64}$/.test(lock.channel.psk), 'schema-2 key has exact encoding');
  assert.ok(/^[a-f0-9]{32}$/.test(lock.instance));
  return { ...lock, bytes, path };
}

// Independent real TLS/HTTP proof client. Never reused by production.
// Authority is assembled only after secureConnect, profile and stable-record checks.
export async function exchange(lock, token, path = '/v1/ready', body, extra = {}) {
  let calls = 0;
  const socket = tls.connect({
    ...profile,
    host: '127.0.0.1',
    port: lock.port,
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
    pskCallback: () => {
      calls++;
      return { identity, psk: Buffer.from(lock.channel.psk, 'hex') };
    },
  });
  const timer = setTimeout(() => socket.destroy(Error('bounded secure exchange')), 1000);
  // Keep errors handled through the post-handshake filesystem await as well.
  socket.on('error', () => {});
  let agent;
  try {
    await new Promise((done, reject) => {
      socket.once('secureConnect', done);
      socket.once('error', reject);
    });
    assert.equal(socket.authorized, true, 'client PSK authorization succeeds without bypass');
    assert.ok(!socket.authorizationError, 'no ignored TLS verification error');
    assert.equal(socket.getProtocol(), 'TLSv1.2');
    assert.equal(socket.getCipher().name, profile.ciphers);
    assert.equal(socket.isSessionReused(), false);
    assert.equal(calls, 1, 'fresh PSK callback on this connection');
    socket.disableRenegotiation();
    if (lock.path)
      assert.ok((await readFile(lock.path)).equals(lock.bytes), 'stable record before authority');
    const data = body === undefined ? '' : JSON.stringify(body);
    agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (_options, done) => {
      done(null, socket);
    };
    const result = await new Promise((done, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: lock.port,
          path,
          method: body === undefined ? 'GET' : 'POST',
          agent,
          headers: {
            authorization: `Bearer ${token}`,
            connection: 'close',
            ...(data
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > 16384) req.destroy(Error('bounded lifecycle response'));
            else chunks.push(chunk);
          });
          res.once('error', reject);
          res.once('end', () => {
            try {
              done({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) });
            } catch {
              reject(Error('invalid lifecycle JSON'));
            }
          });
        },
      );
      socket.once('error', reject);
      req.once('error', reject);
      req.end(data);
    });
    if (lock.path && path === '/v1/ready')
      assert.ok((await readFile(lock.path)).equals(lock.bytes), 'stable record after lifecycle');
    return result;
  } finally {
    clearTimeout(timer);
    agent?.destroy();
    socket.destroy();
  }
}

export async function context(root) {
  const runDeadline = performance.now() + 480000;
  let closing = false;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'run-'));
  const resources = [],
    servers = [],
    secrets = [];
  const manifest = join(directory, 'owned-processes.jsonl');
  await writeFile(manifest, '', { mode: 0o600 });
  const progress = async (phase) => {
    const value = JSON.stringify({ phase, at: Date.now() });
    await writeFile(join(directory, 'progress.json'), value);
    await writeFile('/evidence/phase.json', value);
  };
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    TMP: directory,
    TEMP: directory,
    TMPDIR: directory,
  };
  const executable = resolve('bin/proceed-mcp.js');
  const preload = pathToFileURL(resolve('tests/fixtures/automatic-startup-preload.mjs'));
  preload.searchParams.set('root', directory);
  const start = (args, { state, input, moreEnv = {} } = {}) => {
    assert.ok(
      closing || performance.now() < runDeadline,
      'reserve teardown before launching another phase',
    );
    const child = spawn(
      process.execPath,
      ['--import', preload.href, executable, ...args, ...(state ? ['--state-dir', state] : [])],
      {
        env: { ...env, ...moreEnv },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const resource = { child, output: '', overflow: false, error: false, code: undefined };
    resources.push(resource);
    child.stdin.on('error', () => {}); // A rejected command may close its input early.
    child.once('error', () => {
      resource.error = true;
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        if (resource.output.length + chunk.length <= 65536) resource.output += chunk.toString();
        else resource.overflow = true;
      });
    child.once('close', (code) => {
      resource.code = code;
    });
    if (input !== undefined) child.stdin.end(input);
    return resource;
  };
  const finish = async (resource, ms = 150000) => {
    await until(
      () => resource.code !== undefined || resource.error,
      Math.min(ms, Math.max(1, (closing ? runDeadline + 60000 : runDeadline) - performance.now())),
      'CLI completion deadline',
    );
    assert.equal(resource.error, false, 'CLI starts normally');
    assert.equal(resource.overflow, false, 'CLI output bound');
    return resource;
  };
  const cli = async (args, options) => finish(start(args, { input: '', ...options }));
  const cleanOutput = () => {
    for (const resource of resources) {
      for (const secret of secrets)
        assert.ok(!resource.output.includes(secret), 'no private authority in process output');
    }
  };
  const ownServer = (server) => {
    const sockets = new Set();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('tlsClientError', () => {});
    servers.push({ server, sockets });
    return server;
  };
  return {
    directory,
    resources,
    secrets,
    manifest,
    progress,
    env,
    start,
    finish,
    cli,
    cleanOutput,
    ownServer,
    beginTeardown() {
      closing = true;
    },
    async closeServers() {
      for (const { server, sockets } of servers) {
        for (const socket of sockets) socket.destroy();
        if (server.listening) await new Promise((done) => server.close(done));
      }
    },
  };
}
