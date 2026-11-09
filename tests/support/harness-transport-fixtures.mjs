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

export async function transportFixtures(h) {
  const root = '/run/proceed/qualification-private';
  const servers = [],
    sockets = new Set(),
    timers = new Set(),
    negative = {},
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
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const own = (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  };
  async function record(id, port, psk = secret) {
    const dir = join(root, id);
    await mkdir(dir, { mode: 0o700 });
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
  async function listener(id, mode, psk = secret) {
    let server;
    hits[id] = 0;
    if (['plaintext', 'handshake-stall'].includes(mode)) {
      negative[id] = [];
      server = net.createServer((socket) => {
        own(socket);
        socket.on('data', (bytes) => negative[id].push(Buffer.from(bytes)));
        if (mode === 'plaintext') socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
      });
    } else {
      const handler = http.createServer((req, res) => {
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
            assert.equal(offered, identity, 'exact public PSK selector');
            return Buffer.from(psk, 'hex');
          },
        },
        (socket) => {
          own(socket);
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
    servers.push(server);
    return listen(server);
  }
  const paths = {};
  const trap = net.createServer((socket) => {
    hits.trap++;
    own(socket);
    socket.destroy();
  });
  hits.trap = 0;
  servers.push(trap);
  const trapPort = await listen(trap);
  const controls = [];
  const roleCases = [];
  try {
    const plaintext = await listener('plaintext', 'plaintext');
    const wrong = await listener('wrong-psk', 'wrong-psk', authorities.generated.wrongPsk);
    // Observe encrypted input before the wrong-PSK endpoint consumes it.
    const wrongRelay = net.createServer((down) => {
      own(down);
      negative['wrong-psk'] ??= [];
      down.on('data', (b) => negative['wrong-psk'].push(Buffer.from(b)));
      const up = net.connect({ host: '127.0.0.1', port: wrong });
      own(up);
      down.pipe(up).pipe(down);
      up.on('close', () => down.destroy());
      down.on('close', () => up.destroy());
    });
    servers.push(wrongRelay);
    const wrongPort = await listen(wrongRelay);
    for (const id of Object.keys(authorities.roles)) {
      const port = id === 'plaintext' ? plaintext : id === 'wrong-psk' ? wrongPort : lock.port;
      const lockFile = await record(`role-${id}`, port);
      const keyFile = join(root, `role-${id}`, 'key');
      const key = authorities.roles[id];
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
          own(down);
          down.pause();
          later(() => {
            if (down.destroyed) return;
            const up = net.connect({ host: '127.0.0.1', port: backend });
            own(up);
            down.pipe(up).pipe(down);
            down.resume();
          }, 650);
        });
        servers.push(relay);
        port = await listen(relay);
      }
      paths[id] = await record(id, port);
      controls.push({ id, port, lock_file: paths[id], error, status });
    }
    // Transparent encrypted relay is safe: only the authenticated broker sees HTTP.
    const relay = net.createServer((down) => {
      own(down);
      const up = net.connect({ host: '127.0.0.1', port: lock.port });
      own(up);
      negative.relay ??= [];
      down.on('data', (b) => negative.relay.push(Buffer.from(b)));
      down.pipe(up).pipe(down);
    });
    servers.push(relay);
    const relayPort = await listen(relay);
    controls.push({
      id: 'relay',
      port: relayPort,
      lock_file: await record('relay', relayPort),
      status: 200,
    });
    const duringBackend = await listener('record-during', 'record-during');
    let duringFile;
    const during = net.createServer((down) => {
      own(down);
      down.pause();
      // Mutation occurs after the client's initial protected read/TCP connect,
      // before TLS establishes and before the client's pre-HTTP stable reread.
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
          const up = net.connect({ host: '127.0.0.1', port: duringBackend });
          own(up);
          down.pipe(up).pipe(down);
          down.resume();
        })
        .catch(() => down.destroy());
    });
    servers.push(during);
    const duringPort = await listen(during);
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
      await writeFile(file, content, { mode });
      rejected.push(file);
    }
    const soft = join(root, 'symlink');
    await symlink(h.operator.file, soft);
    rejected.push(soft);
    const hard = join(root, 'hardlink');
    const hardSource = join(root, 'hardlink-source');
    await writeFile(hardSource, `${h.operator.credential}\n`, { mode: 0o600 });
    await link(hardSource, hard);
    rejected.push(hard);
    const unsafeDir = join(root, 'unsafe-directory');
    await mkdir(unsafeDir, { mode: 0o777 });
    // umask may narrow mkdir. Set the intentionally invalid test permission.
    const { chmod } = await import('node:fs/promises');
    await chmod(unsafeDir, 0o777);
    const unsafeKey = join(unsafeDir, 'key');
    await writeFile(unsafeKey, `${h.operator.credential}\n`, { mode: 0o600 });
    rejected.push(
      unsafeKey,
      join(h.state, 'config.json'),
      '/run/proceed/staged/product/package.json',
    );
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
      async close() {
        for (const t of timers) clearTimeout(t);
        for (const s of sockets) s.destroy();
        await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
        assert.equal(sockets.size, 0);
      },
    };
  } catch (error) {
    for (const t of timers) clearTimeout(t);
    for (const s of sockets) s.destroy();
    await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
    throw error;
  }
}
