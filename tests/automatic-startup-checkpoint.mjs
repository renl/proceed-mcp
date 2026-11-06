// TEST ONLY. Executable safety checkpoint, not full feature or live Telegram proof.
// Active delta: Automatic broker availability for normal MCP use.
// Architecture: design.md sections 1-6, especially STARTUP-BOUNDARY-001.
// Run only through the isolated Ubuntu/Node environment documented in tasks.md.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, chmod, rm, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { cert, key as certificateKey } from './fixtures/automatic-startup-certificate.mjs';
import {
  context,
  listen,
  freePort,
  until,
  absent,
  refused,
  lockAt,
  exchange,
  profile,
  identity,
  assertJournalOwnership,
} from './support/automatic-startup.mjs';

const token = 'SYNTHETIC_CHECKPOINT_NOT_A_TELEGRAM_TOKEN';
const root = process.env.PROCEED_TEST_FIXTURES;
assert.equal(
  process.platform,
  'linux',
  'BLOCKED: checkpoint requires isolated Linux, not Windows spawn',
);
assert.equal(process.versions.node, '24.22.2', 'BLOCKED: exact Node 24.22.2 runtime required');
assert.ok(
  /^ID=ubuntu$/m.test(await readFile('/etc/os-release', 'utf8')) &&
    /^VERSION_ID="24.04"$/m.test(await readFile('/etc/os-release', 'utf8')),
  'BLOCKED: Ubuntu 24.04 required',
);
assert.equal(
  root,
  '/fixtures',
  'BLOCKED: run-owned /fixtures mount required, no host-home fallback',
);
assert.equal(
  process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE,
  '1',
  'BLOCKED: operations must attest owned disposable PID namespace',
);
const c = await context(root);
const namespaceBaseline = new Set((await readdir('/proc')).filter((name) => /^\d+$/.test(name)));
c.secrets.push(token);
const results = [];
let provisioningExitCodes = [];
let current = 'setup',
  assertions = false,
  cleanup = false,
  state;
let stopped = false;
const outerTimer = setTimeout(() => {
  writeFileSync(
    '/evidence/phase.json',
    JSON.stringify({ phase: current, timeout: true, cleanup: 'UNVERIFIED' }),
  );
  writeFileSync(
    join(c.directory, 'progress.json'),
    JSON.stringify({ phase: current, assertions: false, cleanup: 'UNVERIFIED', timeout: true }),
  );
  // The enclosing owned container must still remove its namespace. No unknown PID kill.
  process.exit(1);
}, 540000);

async function check(id, work) {
  current = id;
  await c.progress(id);
  await work();
  results.push({ id, status: 'PASS' });
}

async function setupState(name) {
  const path = join(c.directory, name);
  assert.equal((await c.cli(['init'], { state: path })).code, 0, 'public init');
  assert.equal(
    (await c.cli(['owner', 'add', 'alice', '--label', 'Synthetic owner'], { state: path })).code,
    0,
  );
  const config = JSON.parse(await readFile(join(path, 'config.json')));
  config.broker.port = await freePort();
  await writeFile(join(path, 'config.json'), `${JSON.stringify(config)}\n`);
  return { path, config };
}

async function ready(path) {
  return until(
    async () => {
      try {
        const lock = await lockAt(path);
        c.secrets.push(lock.channel.psk);
        const control = (await readFile(join(path, 'credentials/control.token'), 'utf8')).trim();
        c.secrets.push(control);
        const response = await exchange(lock, control);
        if (response.status !== 200) return false;
        assert.deepEqual(Object.keys(response.body).sort(), [
          'instance',
          'lifecycle_version',
          'local_ready',
          'paired',
          'pid',
          'port',
          'schema_version',
          'service',
          'telegram',
        ]);
        assert.equal(response.body.instance, lock.instance);
        assert.equal(response.body.pid, lock.pid);
        assert.equal(response.body.port, lock.port);
        assert.equal(response.body.service, 'proceed-mcp');
        assert.equal(response.body.schema_version, 1);
        assert.equal(response.body.lifecycle_version, 1);
        assert.equal(response.body.local_ready, true);
        assert.equal(response.body.paired, false);
        assert.deepEqual(Object.keys(response.body.telegram).sort(), ['code', 'state']);
        return { lock, control };
      } catch {
        return false;
      }
    },
    150000,
    'authenticated matching readiness deadline',
  );
}

async function closed(path, port) {
  await until(
    async () => (await absent(join(path, 'broker.lock'))) && (await refused(port)),
    30000,
    'graceful stop completion, not just 202',
  );
}

async function scan(path, forbidden) {
  for (const name of await readdir(path, { withFileTypes: true })) {
    const file = join(path, name.name);
    if (name.isDirectory()) await scan(file, forbidden);
    else if (name.isFile() && name.name !== 'broker.lock' && !file.includes('/credentials/')) {
      const text = await readFile(file, 'utf8');
      for (const secret of forbidden)
        assert.ok(
          !text.includes(secret),
          'no private authority in config/journal/history/evidence',
        );
    }
  }
}

// Test-only peer for real client capture/relay attacks. It is not an app server
// substitute: app authorization and drain are checked separately against the CLI.
function lifecyclePeer(lock, control, received, afterReady) {
  const parser = http.createServer((req, res) => {
    received.push({
      path: req.url,
      authenticated: req.headers.authorization === `Bearer ${control}`,
    });
    req.resume();
    res.setHeader('connection', 'close');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/ready') {
      const body = {
        schema_version: 1,
        service: 'proceed-mcp',
        lifecycle_version: 1,
        instance: lock.instance,
        pid: lock.pid,
        port: lock.port,
        local_ready: true,
        paired: false,
        telegram: { state: 'disabled', code: 'TOKEN_MISSING' },
      };
      Promise.resolve(afterReady?.())
        .then(() => res.end(JSON.stringify(body)))
        .catch(() => res.destroy());
    } else {
      res.writeHead(503);
      res.end(
        '{"schema_version":1,"error":{"code":"BROKER_NOT_READY","message":"synthetic refusal","retryable":true}}',
      );
    }
  });
  const server = c.ownServer(
    tls.createServer(
      {
        ...profile,
        requestCert: false,
        handshakeTimeout: 1000,
        pskCallback: (_socket, selected) =>
          selected === identity ? Buffer.from(lock.channel.psk, 'hex') : null,
      },
      (socket) => {
        socket.disableRenegotiation();
        parser.emit('connection', socket);
      },
    ),
  );
  return server;
}

async function syntheticLock(setup) {
  const lock = {
    schema_version: 2,
    pid: process.pid,
    port: setup.config.broker.port,
    started_at: new Date().toISOString(),
    instance: randomBytes(16).toString('hex'),
    channel: { protocol: 'tls-psk-v1', psk: randomBytes(32).toString('hex') },
  };
  const path = join(setup.path, 'broker.lock');
  const bytes = Buffer.from(`${JSON.stringify(lock)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  c.secrets.push(lock.channel.psk);
  return { ...lock, path, bytes };
}

async function removeSynthetic(lock) {
  assert.ok((await readFile(lock.path)).equals(lock.bytes), 'remove only exact synthetic record');
  await rm(lock.path);
}

try {
  await check('AUTO-TLS-PLATFORM', async () => {
    // Library qualification only. This does not exercise or pass application admission.
    const psk = randomBytes(32);
    let serverCalls = 0,
      admissions = 0;
    const server = c.ownServer(
      tls.createServer(
        {
          ...profile,
          handshakeTimeout: 1000,
          requestCert: false,
          pskCallback: (_socket, selected) => {
            serverCalls++;
            return selected === identity ? psk : null;
          },
        },
        (socket) => {
          assert.equal(socket.getProtocol(), 'TLSv1.2');
          assert.equal(socket.getCipher().name, profile.ciphers);
          assert.equal(socket.isSessionReused(), false);
          socket.disableRenegotiation();
          admissions++;
          socket.on('data', () =>
            socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'),
          );
          socket.on('error', () => {});
        },
      ),
    );
    const port = await listen(server);
    const lock = { port, channel: { psk: psk.toString('hex') } };
    for (let i = 0; i < 2; i++)
      assert.equal((await exchange(lock, 'synthetic-platform-authority')).status, 200);
    assert.equal(serverCalls, 2, 'each connection uses PSK callback, no resumed admission');
    assert.equal(admissions, 2);
    await assert.rejects(
      exchange(
        { port, channel: { psk: randomBytes(32).toString('hex') } },
        'synthetic-platform-authority',
      ),
    );
    assert.equal(admissions, 2, 'wrong key never enters application handler');
    await c.closeServers();
  });
  await check('AUTO-JOURNAL-OBSERVER-CONTROL', async () => {
    // Observer qualification only, using the existing legacy foreground runtime.
    // This is not automatic-startup or production contention proof.
    const setup = await setupState('journal-observer-control');
    const observationStart = (await readFile(c.manifest, 'utf8')).length;
    const foreground = c.start(['serve'], { state: setup.path, input: '' });
    const events = await until(
      async () => {
        const observed = (await readFile(c.manifest, 'utf8'))
          .slice(observationStart)
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse);
        if (!observed.some((event) => event.event === 'journal-open')) return false;
        if (await refused(setup.config.broker.port)) return false;
        return observed;
      },
      10000,
      'existing runtime journal opening must be witnessed by the actual preload',
    );
    const owned = await readFile(join(setup.path, 'broker.lock'));
    assert.equal(JSON.parse(owned).pid, foreground.child.pid, 'control owns actual runtime lock');
    assertJournalOwnership(events, [foreground.child.pid]);
    const witnessFailure = /each actual ownership winner must have a journal-open witness/;
    assert.throws(() => assertJournalOwnership([], [foreground.child.pid]), witnessFailure);
    assert.throws(
      () => assertJournalOwnership(events, [foreground.child.pid, -1]),
      witnessFailure,
      'one observed winner cannot mask another missing winner',
    );
    assert.throws(
      () => assertJournalOwnership(events, [-1]),
      witnessFailure,
      'a different process cannot supply the required witness',
    );
    assert.throws(
      () =>
        assertJournalOwnership(
          [...events, { event: 'journal-open', pid: -1 }],
          [foreground.child.pid],
        ),
      /only ownership winners may open journal/,
    );
    // Signal only this directly spawned foreground control, never a recorded PID.
    foreground.child.kill('SIGTERM');
    assert.equal((await c.finish(foreground, 30000)).code, 0);
    await closed(setup.path, setup.config.broker.port);
  });
  if (process.argv.includes('--tls-platform-only')) {
    assertions = true;
  } else {
    const setup = await setupState('state');
    state = setup.path;
    const credential = join(c.directory, 'dedicated-credentials/telegram.token');
    await check('AUTO-CREDENTIAL-CREATE-LOAD', async () => {
      const options = { state, input: `${token}\n` };
      const args = ['telegram', 'provision', '--token-stdin', '--telegram-token-file', credential];
      const pair = await Promise.all([c.cli(args, options), c.cli(args, options)]);
      provisioningExitCodes = pair.map((result) => result.code);
      assert.deepEqual(pair.map((r) => r.code).sort(), [0, 2], 'one exclusive provisioning winner');
      assert.ok(
        pair.some((r) => r.output.includes('TELEGRAM_CREDENTIAL_EXISTS')),
        'loser has no-clobber diagnostic',
      );
      assert.equal(await readFile(credential, 'utf8'), `${token}\n`);
      for (const [path, mode] of [
        [credential, 0o600],
        [join(c.directory, 'dedicated-credentials'), 0o700],
      ]) {
        const info = await stat(path);
        assert.equal(info.mode & 0o777, mode);
        assert.equal(info.uid, process.geteuid());
      }
      assert.equal((await c.cli(args, { state, input: 'replacement\n' })).code, 2);
      assert.equal(await readFile(credential, 'utf8'), `${token}\n`, 'existing bytes preserved');
      await chmod(credential, 0o644);
      const unsafe = await c.cli(['serve', '--telegram-token-file', credential], { state });
      assert.equal(unsafe.code, 4, 'unsafe file refuses before use');
      assert.ok(unsafe.output.includes('PROTECTION_UNVERIFIED'));
      assert.equal(await absent(join(state, 'broker.lock')), true);
      await chmod(credential, 0o600);
    });

    // Existing synthetic Telegram protocol fixture is reused unchanged. Only
    // process inheritance/token handling needed a different preload.
    const { telegramFixture } = await import('./support/portable-waiting.mjs');
    const telegram = await telegramFixture();
    await writeFile(join(c.directory, 'telegram-port'), new URL(telegram.address).port);
    // Register meaningful fixture teardown before any product process is launched.
    c.telegram = telegram;
    await check('AUTO-DETACHED-CONTENTION-LIFETIME', async () => {
      const observationStart = (await readFile(c.manifest, 'utf8')).length;
      const mcp = c.start(['mcp', '--owner', 'alice', '--telegram-token-file', credential], {
        state,
      });
      mcp.child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'checkpoint', version: '1' } } })}\n`,
      );
      await until(
        () => mcp.output.includes('"id":1'),
        10000,
        'public MCP initialization remains responsive',
      );
      const manual = c.start(['serve', '--telegram-token-file', credential], { state, input: '' });
      const adopted = await ready(state);
      const first = adopted.lock;
      mcp.child.stdin.end();
      assert.equal(
        (await c.finish(mcp, 10000)).code,
        0,
        'adapter EOF closes without stopping shared broker',
      );
      // If manual won, stop it, then prove an actual automatic detached cold start.
      if (first.pid === manual.child.pid) {
        assert.equal((await c.cli(['stop'], { state })).code, 0);
        await closed(state, first.port);
        assert.equal((await c.finish(manual, 30000)).code, 0);
      } else {
        assert.equal(
          (await c.finish(manual, 30000)).code,
          3,
          'manual contention loser exits without takeover',
        );
        assert.ok((await lockAt(state)).bytes.equals(first.bytes));
        assert.equal((await c.cli(['stop'], { state })).code, 0);
        await closed(state, first.port);
      }
      const detached = c.start(['mcp', '--owner', 'alice', '--telegram-token-file', credential], {
        state,
        moreEnv: { PROCEED_TELEGRAM_BOT_TOKEN: 'SYNTHETIC_INHERITED_MUST_NOT_REACH_BROKER' },
      });
      c.secrets.push('SYNTHETIC_INHERITED_MUST_NOT_REACH_BROKER');
      const running = await ready(state);
      detached.child.stdin.end();
      await c.finish(detached, 10000);
      assert.notEqual(running.lock.pid, detached.child.pid, 'broker is a separate actual process');
      assert.equal(
        (await exchange(running.lock, running.control)).status,
        200,
        'broker survives last adapter EOF',
      );
      assert.ok(
        telegram.calls.some((call) => call.method === 'getUpdates'),
        'loaded synthetic token starts real poller path',
      );
      const observed = (await readFile(c.manifest, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(
        observed
          .filter((e) => e.event === 'launch')
          .every((e) => !e.privateEnvironment && !e.privateArguments && !e.shell),
        'no inherited token or shell in automatic launches',
      );
      const pollers = new Set(
        observed
          .filter((e) => e.event === 'telegram' && e.method === 'getUpdates')
          .map((e) => e.pid),
      );
      assert.ok(pollers.has(running.lock.pid), 'owning detached broker performs polling');
      // Per-instance exclusivity, not a total across the deliberate restart.
      for (const pid of pollers)
        assert.ok(pid === first.pid || pid === running.lock.pid, 'contender never starts a poller');
      assert.ok(
        observed.filter((e) => e.event === 'credential-access').every((e) => !e.adapter),
        'adapter never opens token file',
      );
      assert.ok(
        observed.some((e) => e.event === 'credential-access' && e.pid === running.lock.pid),
        'detached broker actually loads file',
      );
      const contention = (await readFile(c.manifest, 'utf8'))
        .slice(observationStart)
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
      // Positive witnesses are mandatory before accepting any loser isolation.
      // A missing/inactive preload cannot pass by vacuous negative assertions.
      assertJournalOwnership(contention, [first.pid, running.lock.pid]);
      if (first.pid !== manual.child.pid)
        assert.ok(
          !contention.some((e) => e.event === 'journal-open' && e.pid === manual.child.pid),
          'ownership loser never opens journal',
        );
    });

    await check('AUTO-TLS-HTTP-AUTHORIZATION-STOP', async () => {
      const { lock, control } = await ready(state);
      const owner = (await readFile(join(state, 'credentials/owner.alice.token'), 'utf8')).trim();
      c.secrets.push(owner);
      assert.equal((await exchange(lock, owner)).status, 200);
      const wrong = await exchange(lock, 'wrong-synthetic-bearer');
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error.code, 'AUTH_REQUIRED');
      assert.equal(
        (await exchange(lock, owner, '/v1/shutdown', { instance: lock.instance })).status,
        403,
      );
      assert.equal(
        (
          await exchange(lock, control, '/v1/ready', undefined, {
            origin: 'https://example.invalid',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await exchange(lock, control, '/v1/shutdown', {
            instance: randomBytes(16).toString('hex'),
          })
        ).status,
        409,
      );
      const accepted = await exchange(lock, control, '/v1/shutdown', { instance: lock.instance });
      assert.equal(accepted.status, 202);
      assert.deepEqual(accepted.body, {
        schema_version: 1,
        instance: lock.instance,
        stopping: true,
      });
      await closed(state, lock.port);
      assert.equal(
        (await c.cli(['stop'], { state })).code,
        0,
        'already stopped is idempotent only with absence/refusal',
      );
      stopped = true;
    });

    await check('AUTO-IMPOSTOR-CAPTURE-RECONNECT-REPLACEMENT', async () => {
      const synthetic = await setupState('impostor-state');
      const path = join(synthetic.path, 'broker.lock');
      const control = (
        await readFile(join(synthetic.path, 'credentials/control.token'), 'utf8')
      ).trim();
      c.secrets.push(control);
      const stateBefore = new Map();
      for (const name of await readdir(synthetic.path)) {
        if ((await stat(join(synthetic.path, name))).isFile())
          stateBefore.set(name, await readFile(join(synthetic.path, name)));
      }
      for (const kind of [
        'plaintext',
        'wrong-key',
        'certificate-only',
        'unsupported-profile',
        'legacy-schema-1',
      ]) {
        const key = randomBytes(32),
          otherKey = randomBytes(32);
        c.secrets.push(key.toString('hex'), otherKey.toString('hex'));
        const chunks = [],
          plaintext = [];
        let admitted = 0;
        const handler = (socket) => {
          socket.on('data', (chunk) => plaintext.push(chunk));
        };
        const options =
          kind === 'certificate-only'
            ? {
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.2',
                ciphers: 'ECDHE-RSA-AES256-GCM-SHA384',
                cert,
                key: certificateKey,
              }
            : kind === 'unsupported-profile'
              ? { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', cert, key: certificateKey }
              : {
                  ...profile,
                  pskCallback: (_socket, selected) => (selected === identity ? otherKey : null),
                };
        const server = c.ownServer(
          ['plaintext', 'legacy-schema-1'].includes(kind)
            ? net.createServer(handler)
            : tls.createServer(
                {
                  ...options,
                  handshakeTimeout: 1000,
                  requestCert: false,
                },
                (socket) => {
                  admitted++;
                  handler(socket);
                },
              ),
        );
        server.on('connection', (socket) => socket.on('data', (chunk) => chunks.push(chunk)));
        await listen(server, synthetic.config.broker.port);
        const record = {
          schema_version: 2,
          pid: process.pid,
          port: synthetic.config.broker.port,
          started_at: new Date().toISOString(),
          instance: randomBytes(16).toString('hex'),
          channel: { protocol: 'tls-psk-v1', psk: key.toString('hex') },
        };
        if (kind === 'legacy-schema-1') {
          record.schema_version = 1;
          delete record.channel;
        }
        const bytes = `${JSON.stringify(record)}\n`;
        await writeFile(path, bytes, { mode: 0o600 });
        const result = await c.cli(['status', '--json'], { state: synthetic.path });
        assert.equal(result.code, 3, 'secure client refuses impersonation');
        assert.ok(
          result.output.includes('BROKER_INSTANCE_CONFLICT'),
          'redacted conflict classification',
        );
        assert.equal(admitted, 0, 'wrong-key endpoint cannot enter HTTP');
        if (kind === 'legacy-schema-1') {
          assert.equal(
            Buffer.concat(chunks).length,
            0,
            'schema 1 receives no application or TLS authority',
          );
          assert.ok(
            result.output.includes('--secure-local'),
            'upgrade offers operator stop/restart guidance',
          );
        }
        for (const capture of [Buffer.concat(chunks), Buffer.concat(plaintext)]) {
          for (const secret of [
            control,
            key.toString('hex'),
            'Authorization: Bearer',
            'authorization: Bearer',
          ]) {
            assert.ok(!capture.includes(secret), 'no private authority in unauthenticated capture');
          }
        }
        assert.equal(await readFile(path, 'utf8'), bytes, 'refusal preserves ownership');
        for (const [name, before] of stateBefore)
          assert.ok(
            (await readFile(join(synthetic.path, name))).equals(before),
            'refusal preserves existing state/journal',
          );
        await c.closeServers();
        assert.equal(await readFile(path, 'utf8'), bytes);
        await rm(path); // Exact synthetic record owned solely by this stopped fixture.
      }
    });
    await check('AUTO-RELAY-REPLACEMENT-RECONNECT', async () => {
      const setup = await setupState('relay-state');
      const control = (
        await readFile(join(setup.path, 'credentials/control.token'), 'utf8')
      ).trim();
      c.secrets.push(control);
      for (const kind of [
        'transparent-relay',
        'terminating-relay',
        'record-replacement',
        'reconnect-substitution',
        'old-key-replay',
      ]) {
        const lock = await syntheticLock(setup);
        const received = [],
          captures = [];
        let replacement;
        let peer;
        const swap = async () => {
          if (kind === 'record-replacement' || kind === 'old-key-replay') {
            const changed = JSON.parse(lock.bytes);
            changed.instance = randomBytes(16).toString('hex');
            changed.channel.psk = randomBytes(32).toString('hex');
            c.secrets.push(changed.channel.psk);
            await writeFile(lock.path, `${JSON.stringify(changed)}\n`);
          }
          if (kind === 'reconnect-substitution') {
            peer.close(); // Stop accepting, keeping the authenticated ready socket alive.
            replacement = c.ownServer(
              tls.createServer(
                { ...profile, handshakeTimeout: 1000, pskCallback: () => randomBytes(32) },
                (socket) => socket.on('data', (chunk) => captures.push(chunk)),
              ),
            );
            replacement.on('connection', (socket) =>
              socket.on('data', (chunk) => captures.push(chunk)),
            );
            await listen(replacement, lock.port);
          }
        };
        peer = lifecyclePeer(lock, control, received, swap);
        if (kind === 'transparent-relay' || kind === 'terminating-relay') {
          const backendPort = await listen(peer);
          const forward = (socket) => {
            const upstream = net.connect({ host: '127.0.0.1', port: backendPort });
            socket.on('data', (chunk) => captures.push(chunk));
            socket.pipe(upstream).pipe(socket);
            socket.once('close', () => upstream.destroy());
            upstream.on('error', () => socket.destroy());
          };
          const relay = c.ownServer(
            kind === 'transparent-relay'
              ? net.createServer(forward)
              : tls.createServer(
                  {
                    ...profile,
                    handshakeTimeout: 1000,
                    pskCallback: () => randomBytes(32),
                  },
                  forward,
                ),
          );
          relay.on('connection', (socket) => socket.on('data', (chunk) => captures.push(chunk)));
          await listen(relay, lock.port);
        } else await listen(peer, lock.port);
        // stop must perform real ready admission then use a newly authenticated
        // connection. Fixture shutdown refuses, so no success/drain is claimed.
        const result = await c.cli(['stop'], { state: setup.path });
        assert.notEqual(result.code, 0, 'fixture refusal/substitution is never confirmed stop');
        if (kind === 'transparent-relay') {
          assert.ok(
            received.some((item) => item.path === '/v1/ready' && item.authenticated),
            'genuine endpoint receives authority through encrypted relay',
          );
          assert.ok(
            received.some((item) => item.path === '/v1/shutdown' && item.authenticated),
            'new socket also authenticates through transparent relay',
          );
        } else if (kind === 'terminating-relay') {
          assert.equal(
            received.length,
            0,
            'terminating relay never delivers an authorized HTTP request',
          );
        } else {
          assert.ok(
            received.some((item) => item.path === '/v1/ready' && item.authenticated),
            'substitution occurs after real authenticated readiness',
          );
          assert.ok(
            !received.some((item) => item.path === '/v1/shutdown'),
            'old readiness does not authorize substituted connection/record',
          );
        }
        if (kind === 'old-key-replay') {
          const before = received.length;
          const replay = await c.cli(['stop'], { state: setup.path });
          assert.equal(replay.code, 3, 'new attempt rejects old acquired endpoint key');
          assert.equal(
            received.length,
            before,
            'replayed old-key listener receives no new HTTP authority',
          );
        }
        for (const value of [control, 'Bearer ', lock.channel.psk])
          assert.ok(
            !Buffer.concat(captures).includes(value),
            'relay/substitute capture contains no plaintext authority',
          );
        await c.closeServers();
        if (kind === 'record-replacement' || kind === 'old-key-replay') {
          // Replacement is fixture-owned. Preserve until the assertion above,
          // then remove by exact bytes rather than a stale prior lock identity.
          const changedBytes = await readFile(lock.path);
          assert.ok(!changedBytes.equals(lock.bytes), 'replacement was actually published');
          assert.ok((await readFile(lock.path)).equals(changedBytes));
          await rm(lock.path);
        } else await removeSynthetic(lock);
      }
    });
    await scan(state, c.secrets);
    c.cleanOutput();
    assertions = true;
  }
} catch {
  // Never publish assertion actual/expected values, TLS errors, output or keys.
  results.push({ id: current, status: 'FAIL' });
} finally {
  current = 'teardown';
  c.beginTeardown();
  await c.progress(current);
  let clean = true;
  try {
    if (state && !stopped && !(await absent(join(state, 'broker.lock')))) {
      const stop = await c.cli(['stop'], { state });
      assert.equal(
        stop.code,
        0,
        'cleanup uses authenticated public stop, never recorded PID signals',
      );
      const config = JSON.parse(await readFile(join(state, 'config.json')));
      await closed(state, config.broker.port);
    }
  } catch {
    clean = false;
  }
  for (const resource of c.resources) {
    try {
      if (resource.code === undefined) {
        resource.child.stdin.end();
        // Directly owned foreground handles only. Detached brokers use stop above.
        resource.child.kill('SIGTERM');
        await c.finish(resource, 30000);
      }
    } catch {
      clean = false;
    }
  }
  try {
    await c.closeServers();
    await c.telegram?.close();
    const events = (await readFile(c.manifest, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    await until(
      () =>
        events
          .filter((e) => e.event === 'start')
          .every((e) => {
            try {
              process.kill(e.pid, 0);
              return false;
            } catch (error) {
              if (error.code === 'ESRCH') return true;
              throw error;
            }
          }),
      30000,
      'all observed owned processes absent',
    );
    assert.ok(
      (await readdir('/proc'))
        .filter((name) => /^\d+$/.test(name))
        .every((name) => namespaceBaseline.has(name)),
      'no unreported helper or detached descendant remains in owned PID namespace',
    );
    c.cleanOutput();
  } catch {
    clean = false;
  }
  cleanup = clean;
  clearTimeout(outerTimer);
  const summary = {
    provisioningExitCodes,
    assertions: assertions ? 'PASS' : 'FAIL',
    cleanup: cleanup ? 'PASS' : 'UNVERIFIED',
    results,
  };
  await writeFile(join(c.directory, 'result.json'), JSON.stringify(summary));
  console.log(JSON.stringify(summary));
  if (cleanup && assertions) await rm(c.directory, { recursive: true });
  process.exitCode = assertions && cleanup ? 0 : 1;
}
