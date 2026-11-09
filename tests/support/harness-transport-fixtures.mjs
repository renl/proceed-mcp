// TEST ONLY. Controlled real loopback listeners, not an alternative product client.
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, symlink, link, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { profile, identity, listen, lockAt } from './automatic-startup.mjs';

export function scanRequiredCaptures(captures, secrets, required) {
  assert.ok(required.length > 0);
  for (const surface of required) {
    assert.ok(Buffer.isBuffer(captures[surface]), `missing raw capture: ${surface}`);
    for (const secret of secrets)
      assert.equal(
        captures[surface].includes(Buffer.from(secret)),
        false,
        `authority leaked to ${surface}`,
      );
  }
  return { status: 'PASS', surfaces: required };
}

const transportRoles = Object.freeze([
  'enrolled',
  'unenrolled',
  'owner',
  'control',
  'foreign',
  'plaintext',
  'wrong-psk',
]);

// Pure producer shared by real fixture setup and memory-only integration controls.
export function transportFixtureAuthorities(h, channel, unenrolled) {
  const base = [h.operator.credential, channel, h.control, h.owner];
  const roles = Object.fromEntries(
    transportRoles.map((id) => [
      id,
      id === 'owner'
        ? h.owner
        : id === 'control'
          ? h.control
          : id === 'unenrolled'
            ? unenrolled
            : h.operator.credential,
    ]),
  );
  const generated = { wrongPsk: 'a'.repeat(64), changedPsk: 'f'.repeat(64) };
  const setup = h.setupSecrets;
  assert.ok(Array.isArray(setup) && setup.length > 0, 'complete setup secret ledger required');
  return {
    authorities: { base, roles, generated, setup },
    secrets: [...base, ...Object.values(roles), ...Object.values(generated), ...setup],
  };
}

// The only normalization boundary. Validate the complete producer ledger before
// deduplication, then require exact coverage of every base and generated role.
export function freezeTransportSecrets({
  authorities: { base, roles, generated, setup },
  secrets,
}) {
  const valid = (s) => typeof s === 'string' && s.length > 0 && s.trim() === s;
  assert.ok(Array.isArray(base) && base.length === 4 && Array.from(base).every(valid));
  assert.equal(new Set(base).size, 4);
  assert.ok(roles && typeof roles === 'object' && !Array.isArray(roles));
  assert.ok(transportRoles.every((id) => Object.hasOwn(roles, id)));
  const roleValues = Object.values(roles);
  assert.ok(roleValues.every(valid));
  assert.deepEqual(generated, { wrongPsk: 'a'.repeat(64), changedPsk: 'f'.repeat(64) });
  assert.ok(Array.isArray(setup) && setup.length > 0 && setup.every(valid));
  assert.equal(base.includes(roles.unenrolled), false);
  assert.ok(Array.isArray(secrets) && Array.from(secrets).every(valid));
  const expected = new Set([...base, ...roleValues, ...Object.values(generated), ...setup]);
  const unique = [...new Set(secrets)];
  assert.deepEqual(new Set(unique), expected);
  return Object.freeze(unique);
}

// Shared by the real fixture and native event controls. No listener is opened here.
export function transportFixtureOwner({
  deadline,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  assert.ok(Number.isFinite(deadline));
  const sockets = new Map(),
    servers = new Map(),
    tasks = new Set(),
    timers = new Set();
  let fenced = false,
    result,
    firstFailure,
    lifetime;
  const fail = (code) => (firstFailure ??= Object.assign(Error(code), { code }));
  const destroy = (socket, entry) => {
    if (entry.destroyed || entry.closed) return;
    entry.destroyed = true;
    if (socket.destroyed === true) return;
    try {
      socket.destroy();
    } catch {
      fail('FIXTURE_SOCKET_CLOSE');
    }
  };
  const owner = {
    get active() {
      return !fenced && now() < deadline;
    },
    own(socket) {
      if (!sockets.has(socket)) {
        const entry = { closed: socket.closed === true, destroyed: false };
        entry.done = entry.closed
          ? Promise.resolve()
          : new Promise((resolve) => {
              socket.once('close', () => {
                entry.closed = true;
                resolve();
              });
            });
        socket.on('error', () => {});
        sockets.set(socket, entry);
      }
      if (!owner.active) {
        destroy(socket, sockets.get(socket));
        return false;
      }
      return true;
    },
    server(server) {
      assert.ok(owner.active, 'fixture activity fenced');
      if (!servers.has(server)) {
        const entry = { listening: server.listening === true, closed: false };
        server.on('listening', () => {
          entry.listening = true;
        });
        server.on('close', () => {
          entry.closed = true;
        });
        servers.set(server, entry);
      }
      return server;
    },
    listen(server) {
      owner.server(server);
      const starting = owner.task(() => listen(server));
      servers.get(server).starting = starting;
      return starting;
    },
    task(work) {
      if (!owner.active) return Promise.resolve();
      const task = Promise.resolve().then(() => (owner.active ? work() : undefined));
      tasks.add(task);
      task.then(
        () => tasks.delete(task),
        () => {
          tasks.delete(task);
          fail('FIXTURE_TASK_CLOSE');
        },
      );
      return task;
    },
    later(fn, ms) {
      if (!owner.active) return;
      const timer = schedule(() => {
        timers.delete(timer);
        if (owner.active) owner.task(fn).catch(() => {});
      }, ms);
      timers.add(timer);
    },
    close() {
      if (result) return result;
      fenced = true;
      cancel(lifetime);
      for (const timer of timers) cancel(timer);
      timers.clear();
      // Assign the shared promise before invoking user/event IO (including sync callbacks).
      let resolveResult, rejectResult;
      result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      result.catch(() => {});
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cancel(expiry);
        if (error) rejectResult(error);
        else resolveResult();
      };
      const expiry = schedule(
        () => finish(firstFailure ?? fail('FIXTURE_CLOSE_DEADLINE')),
        Math.max(0, deadline - now()),
      );
      const callbacks = [...servers].map(async ([server, entry]) => {
        if (entry.starting) await entry.starting.catch(() => {});
        return new Promise((done) => {
          try {
            server.close((error) => {
              // Node reports ERR_SERVER_NOT_RUNNING for a never-started or already
              // closed server. Only source-observed lifecycle permits that case.
              if (
                error &&
                !(error.code === 'ERR_SERVER_NOT_RUNNING' && (!entry.listening || entry.closed))
              )
                fail('FIXTURE_LISTENER_CLOSE');
              done();
            });
          } catch {
            fail('FIXTURE_LISTENER_CLOSE');
            done();
          }
        });
      });
      for (const [socket, entry] of sockets) destroy(socket, entry);
      (async () => {
        await Promise.all(callbacks);
        // Tasks accepted before the fence can finish after a listener callback.
        // Socket identities include both accepted TCP and secure TLS wrappers.
        while (tasks.size) await Promise.allSettled([...tasks]);
        await Promise.all([...sockets.values()].map((entry) => entry.done));
        if (now() >= deadline) fail('FIXTURE_CLOSE_DEADLINE');
        finish(firstFailure);
      })().catch(() => finish(firstFailure ?? fail('FIXTURE_TASK_CLOSE')));
      return result;
    },
  };
  lifetime = schedule(
    () => {
      owner.close().catch(() => {});
    },
    Math.max(0, deadline - now()),
  );
  return owner;
}

export async function transportFixtures(h, { deadline }) {
  const root = '/run/proceed/qualification-private';
  const owner = transportFixtureOwner({ deadline });
  try {
    assert.ok(owner.active, 'fixture activity fenced');
    return await owner.task(async () => {
      const negative = {},
        profiles = [],
        hits = {};
      const lock = await lockAt(h.state);
      const secret = lock.channel.psk;
      const credentials = await Promise.all(
        (await readdir(join(h.state, 'credentials'))).map(async (name) =>
          (await readFile(join(h.state, 'credentials', name), 'utf8')).trim(),
        ),
      );
      assert.ok(Array.isArray(h.setupSecrets) && h.setupSecrets.length > 0);
      const authoritySet = transportFixtureAuthorities(
        { ...h, setupSecrets: [...h.setupSecrets, ...credentials] },
        secret,
        `hop_${randomBytes(32).toString('hex')}`,
      );
      const { secrets, authorities } = authoritySet;
      const later = owner.later;
      const own = owner.own;
      async function record(id, port, psk = secret) {
        assert.ok(owner.active, 'fixture activity fenced');
        const dir = join(root, id);
        await mkdir(dir, { mode: 0o700 });
        assert.ok(owner.active, 'fixture activity fenced');
        const file = join(dir, 'broker.lock');
        await writeFile(
          file,
          JSON.stringify({
            schema_version: 2,
            pid: process.pid,
            port,
            instance: randomBytes(16).toString('hex'),
            started_at: new Date().toISOString(),
            channel: { protocol: 'tls-psk-v1', psk },
          }),
          { mode: 0o600 },
        );
        return file;
      }
      let trapPort;
      async function listener(id, mode, psk = secret) {
        let server;
        hits[id] = 0;
        if (['plaintext', 'handshake-stall'].includes(mode)) {
          negative[id] = [];
          server = net.createServer((socket) => {
            if (!own(socket)) return;
            socket.on('data', (bytes) => negative[id].push(Buffer.from(bytes)));
            if (mode === 'plaintext') socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
          });
        } else {
          const handler = http.createServer((req, res) => {
            if (!owner.active) {
              req.socket.destroy();
              return;
            }
            hits[id]++;
            req.resume();
            if (mode === 'reconnect' && hits[id] === 1) {
              req.socket.destroy();
              return;
            }
            if (mode === 'abort') return;
            if (mode === 'redirect') {
              res.writeHead(302, { location: `http://127.0.0.1:${trapPort}/steal` });
              res.end('{}');
              return;
            }
            const send = () => {
              const size = mode === 'limit-exact' ? 65536 : mode === 'limit-over' ? 65537 : 2;
              const body = size === 2 ? '{}' : JSON.stringify({ padding: 'x'.repeat(size - 14) });
              assert.equal(Buffer.byteLength(body), size);
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(body);
            };
            if (mode === 'original-budget') later(send, 9600);
            else send();
          });
          server = tls.createServer(
            {
              ...profile,
              pskCallback: (_socket, offered) => {
                if (!owner.active) return null;
                assert.equal(offered, identity, 'exact public PSK selector');
                return Buffer.from(psk, 'hex');
              },
            },
            (socket) => {
              if (!own(socket)) return;
              profiles.push({
                id,
                protocol: socket.getProtocol(),
                cipher: socket.getCipher().name,
                reused: socket.isSessionReused(),
              });
              handler.emit('connection', socket);
            },
          );
          server.on('connection', own);
          server.on('tlsClientError', () => {});
        }
        return owner.listen(server);
      }
      const paths = {};
      const trap = net.createServer((socket) => {
        if (!own(socket)) return;
        hits.trap++;
        socket.destroy();
      });
      hits.trap = 0;
      trapPort = await owner.listen(trap);
      const controls = [];
      const roleCases = [];
      const plaintext = await listener('plaintext', 'plaintext');
      const wrong = await listener('wrong-psk', 'wrong-psk', authorities.generated.wrongPsk);
      // Observe encrypted input before the wrong-PSK endpoint consumes it.
      const wrongRelay = net.createServer((down) => {
        if (!own(down)) return;
        negative['wrong-psk'] ??= [];
        down.on('data', (b) => negative['wrong-psk'].push(Buffer.from(b)));
        const up = net.connect({ host: '127.0.0.1', port: wrong });
        if (!own(up)) return;
        down.pipe(up).pipe(down);
        up.on('close', () => down.destroy());
        down.on('close', () => up.destroy());
      });
      const wrongPort = await owner.listen(wrongRelay);
      for (const id of Object.keys(authorities.roles)) {
        const port = id === 'plaintext' ? plaintext : id === 'wrong-psk' ? wrongPort : lock.port;
        const lockFile = await record(`role-${id}`, port);
        const keyFile = join(root, `role-${id}`, 'key');
        const key = authorities.roles[id];
        assert.ok(owner.active, 'fixture activity fenced');
        await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
        roleCases.push({
          id,
          port,
          lock_file: lockFile,
          key_file: keyFile,
          body: {
            harness_id: 'qualification',
            owner_id: id === 'foreign' ? 'foreign' : 'shared',
            session_id: 'transport-session',
          },
        });
      }
      for (const [id, error, status] of [
        ['limit-exact', null, 200],
        ['limit-over', 'BROKER_UNAVAILABLE'],
        ['redirect', null, 302],
        ['handshake-stall', 'BROKER_INSTANCE_CONFLICT'],
        ['original-budget', 'BROKER_UNAVAILABLE'],
        ['abort', 'BROKER_UNAVAILABLE'],
        ['reconnect', 'BROKER_UNAVAILABLE'],
        ['record-next', null, 200],
      ]) {
        const backend = await listener(id, id);
        let port = backend;
        if (id === 'original-budget') {
          const relay = net.createServer((down) => {
            if (!own(down)) return;
            down.pause();
            later(() => {
              if (down.destroyed) return;
              const up = net.connect({ host: '127.0.0.1', port: backend });
              if (!own(up)) return;
              down.pipe(up).pipe(down);
              down.resume();
            }, 650);
          });
          port = await owner.listen(relay);
        }
        paths[id] = await record(id, port);
        controls.push({ id, port, lock_file: paths[id], error, status });
      }
      // Transparent encrypted relay is safe: only the authenticated broker sees HTTP.
      const relay = net.createServer((down) => {
        if (!own(down)) return;
        const up = net.connect({ host: '127.0.0.1', port: lock.port });
        if (!own(up)) return;
        negative.relay ??= [];
        down.on('data', (b) => negative.relay.push(Buffer.from(b)));
        down.pipe(up).pipe(down);
      });
      const relayPort = await owner.listen(relay);
      controls.push({
        id: 'relay',
        port: relayPort,
        lock_file: await record('relay', relayPort),
        status: 200,
      });
      const duringBackend = await listener('record-during', 'record-during');
      let duringFile;
      const during = net.createServer((down) => {
        if (!own(down)) return;
        down.pause();
        // Mutation occurs after the client's initial protected read/TCP connect,
        // before TLS establishes and before the client's pre-HTTP stable reread.
        owner
          .task(() =>
            writeFile(
              duringFile,
              JSON.stringify({
                ...lock,
                bytes: undefined,
                path: undefined,
                instance: 'e'.repeat(32),
                port: during.address().port,
              }),
            )
              .then(() => {
                if (!owner.active) return;
                const up = net.connect({ host: '127.0.0.1', port: duringBackend });
                if (!own(up)) return;
                down.pipe(up).pipe(down);
                down.resume();
              })
              .catch(() => down.destroy()),
          )
          .catch(() => {});
      });
      const duringPort = await owner.listen(during);
      duringFile = await record('record-during', duringPort);
      controls.push({
        id: 'record-during',
        port: duringPort,
        lock_file: duringFile,
        error: 'BROKER_INSTANCE_CONFLICT',
      });
      const rejected = [];
      for (const [name, mode, content] of [
        ['wide', 0o644, `${h.operator.credential}\n`],
        ['malformed', 0o600, 'not-an-operator-key\n'],
        ['oversized', 0o600, 'x'.repeat(4097)],
      ]) {
        const file = join(root, name);
        assert.ok(owner.active, 'fixture activity fenced');
        await writeFile(file, content, { mode });
        rejected.push(file);
      }
      const soft = join(root, 'symlink');
      assert.ok(owner.active, 'fixture activity fenced');
      await symlink(h.operator.file, soft);
      rejected.push(soft);
      const hard = join(root, 'hardlink');
      const hardSource = join(root, 'hardlink-source');
      assert.ok(owner.active, 'fixture activity fenced');
      await writeFile(hardSource, `${h.operator.credential}\n`, { mode: 0o600 });
      assert.ok(owner.active, 'fixture activity fenced');
      await link(hardSource, hard);
      rejected.push(hard);
      const unsafeDir = join(root, 'unsafe-directory');
      assert.ok(owner.active, 'fixture activity fenced');
      await mkdir(unsafeDir, { mode: 0o777 });
      // umask may narrow mkdir. Set the intentionally invalid test permission.
      const { chmod } = await import('node:fs/promises');
      assert.ok(owner.active, 'fixture activity fenced');
      await chmod(unsafeDir, 0o777);
      const unsafeKey = join(unsafeDir, 'key');
      assert.ok(owner.active, 'fixture activity fenced');
      await writeFile(unsafeKey, `${h.operator.credential}\n`, { mode: 0o600 });
      rejected.push(
        unsafeKey,
        join(h.state, 'config.json'),
        '/run/proceed/staged/product/package.json',
      );
      assert.ok(owner.active, 'fixture activity fenced');
      return {
        plan: {
          roles: { schema_version: 1, cases: roleCases },
          product: {
            key_file: h.operator.file,
            state_dir: h.state,
            controls,
            rejected_keys: rejected,
          },
        },
        proxy: `http://127.0.0.1:${trapPort}`,
        secrets,
        authorities,
        async assertObserved() {
          assert.equal(hits.trap, 0, 'redirect/proxy trap must receive no connection');
          for (const id of ['plaintext', 'wrong-psk', 'handshake-stall', 'relay']) {
            const bytes = Buffer.concat(negative[id] ?? []);
            assert.ok(bytes.length > 0, `${id} must observe real attempted bytes`);
            assert.equal(bytes[0], 0x16, 'TLS ClientHello, not plaintext HTTP');
            scanRequiredCaptures(
              { [id]: bytes },
              [h.operator.credential, secret, 'Authorization:', 'Bearer '],
              [id],
            );
          }
          assert.equal(hits['record-next'], 1, 'changed record PSK cannot inherit prior admission');
          assert.equal(
            hits['record-during'],
            0,
            'record replacement during TLS cannot emit HTTP authority',
          );
          assert.equal(hits['wrong-psk'], 0, 'wrong-PSK endpoint receives no HTTP authority');
          assert.equal(hits.reconnect, 2, 'explicit reconnect opens a fresh exchange');
          for (const id of ['limit-exact', 'limit-over', 'redirect', 'original-budget', 'abort'])
            assert.equal(hits[id], 1, `${id} must not automatically retry`);
          assert.ok(profiles.length >= 8);
          for (const p of profiles) {
            assert.equal(p.protocol, 'TLSv1.2');
            assert.equal(p.cipher, profile.ciphers);
            assert.equal(p.reused, false);
          }
          return { profiles, hits, failedListenerCapture: 'PASS', relayCapture: 'PASS' };
        },
        close: owner.close,
      };
    });
  } catch (error) {
    await owner.close().catch(() => {});
    throw error;
  }
}
