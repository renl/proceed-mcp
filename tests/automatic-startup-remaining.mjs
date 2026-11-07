// TEST ONLY. Remaining independent cases in the existing checkpoint lifecycle.
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  chown,
  rm,
  stat,
  link,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { Readable } from 'node:stream';
import { run } from '../src/cli/main.js';
import { setTimeout as delay } from 'node:timers/promises';
import { awaitSecureAvailability } from '../src/broker/availability.js';
import { rpcPeer } from './support/spike-rpc.mjs';
import { success, authority, question, telegramFixture } from './support/portable-waiting.mjs';
import { absent, until, listen, lockAt, exchange } from './support/automatic-startup.mjs';

export async function remainingCases(h) {
  const {
    c,
    check,
    setupState,
    ready,
    closed,
    syntheticLock,
    removeSynthetic,
    lifecyclePeer,
    token,
  } = h;
  const events = async () =>
    (await readFile(c.manifest, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const independent = { independent: true };
  const provision = async (state, name) => {
    const credential = join(c.directory, name, 'telegram.token');
    assert.equal(
      (
        await c.cli(
          ['telegram', 'provision', '--token-stdin', '--telegram-token-file', credential],
          { state, input: `${token}\n` },
        )
      ).code,
      0,
    );
    return credential;
  };
  const stop = async (setup) => {
    assert.equal((await c.cli(['stop'], { state: setup.path })).code, 0);
    await closed(setup.path, setup.config.broker.port);
  };
  const connect = async (setup, credential, owner = 'alice', moreEnv = {}) => {
    const resource = c.start(['mcp', '--owner', owner, '--telegram-token-file', credential], {
      state: setup.path,
      moreEnv,
    });
    const peer = rpcPeer(resource.child);
    await peer.handshake();
    return {
      resource,
      peer,
      call: (name, args) =>
        peer.call('tools/call', { name, arguments: args }, { ms: 15000 }).outcome,
    };
  };
  const eof = async (adapter) => {
    adapter.resource.child.stdin.end();
    assert.equal((await c.finish(adapter.resource, 10000)).code, 0);
    adapter.peer.close();
  };

  await check(
    'AUTO-CREDENTIAL-TTY-AND-INPUT-ERROR',
    async () => {
      const setup = await setupState('stdin-refusals');
      for (const tty of [true, false]) {
        const destination = join(c.directory, `stdin-${tty}/telegram.token`);
        const stdin = tty
          ? {
              isTTY: true,
              [Symbol.asyncIterator]() {
                throw Error('must not read terminal');
              },
            }
          : Readable.from(
              (async function* () {
                throw Object.assign(Error('synthetic input failure'), { code: 'EIO' });
              })(),
            );
        let output = '';
        const writer = {
          write(value) {
            output += value;
          },
        };
        assert.equal(
          await run(
            [
              'telegram',
              'provision',
              '--token-stdin',
              '--telegram-token-file',
              destination,
              '--state-dir',
              setup.path,
            ],
            { stdin, env: c.env, stdout: writer, stderr: writer },
          ),
          2,
        );
        assert.equal(await absent(destination), true);
        assert.ok(!output.includes('synthetic input failure'), 'no raw input exception');
      }
    },
    independent,
  );

  await check(
    'AUTO-CREDENTIAL-INCOMPLETE-STDIN',
    async () => {
      const setup = await setupState('incomplete-input');
      const destination = join(c.directory, 'incomplete-credential/telegram.token');
      const start = performance.now();
      const resource = c.start(
        ['telegram', 'provision', '--token-stdin', '--telegram-token-file', destination],
        { state: setup.path },
      );
      resource.child.stdin.write('SYNTHETIC_INCOMPLETE');
      await c.finish(resource, 62000);
      assert.equal(resource.code, 2);
      assert.ok(performance.now() - start >= 59000 && performance.now() - start <= 61500);
      assert.equal(await absent(destination), true, 'no write without bounded EOF');
    },
    independent,
  );

  await check(
    'AUTO-CREDENTIAL-FOREIGN-OWNERSHIP',
    async () => {
      const setup = await setupState('foreign-file');
      const credential = await provision(setup.path, 'foreign-credential');
      const before = await readFile(credential);
      try {
        await chown(credential, 65534, 65534);
        assert.equal((await stat(credential)).uid, 65534, 'real foreign UID, not a metadata mock');
        const refused = await c.cli(['serve', '--telegram-token-file', credential], {
          state: setup.path,
        });
        assert.equal(refused.code, 4);
        assert.equal(await absent(join(setup.path, 'broker.lock')), true);
      } finally {
        await chown(credential, process.geteuid(), process.getegid());
      }
      assert.ok((await readFile(credential)).equals(before));
    },
    independent,
  );

  for (const fault of ['lock-write-failure', 'lock-write-replacement', 'lock-unsafe-handle']) {
    await check(
      `AUTO-${fault.toUpperCase()}`,
      async () => {
        const setup = await setupState(fault);
        const file = join(setup.path, 'broker.lock');
        const journal = await readFile(join(setup.path, 'journal.log'));
        const before = (await events()).length;
        const result = await c.cli(['serve', '--secure-local'], {
          state: setup.path,
          moreEnv: {
            PROCEED_TEST_CREDENTIAL_FAULT: fault,
            PROCEED_TEST_CREDENTIAL_FAULT_FILE: file,
          },
        });
        const observed = (await events()).slice(before);
        assert.ok(
          observed.some((e) => e.event === 'credential-fault' && e.fault === fault),
          'fault actually reached',
        );
        assert.equal(result.code, 4);
        assert.ok((await readFile(join(setup.path, 'journal.log'))).equals(journal));
        assert.ok(
          !observed.some((e) => e.event === 'journal-open'),
          'no journal before safe publication',
        );
        if (fault.endsWith('replacement')) {
          assert.equal(
            await readFile(file, 'utf8'),
            'SYNTHETIC_REPLACEMENT\n',
            'preserve replacement on rollback',
          );
          assert.equal((await readFile(`${file}.original`)).length, 0, 'original stays key-free');
        } else assert.equal(await absent(file), true);
      },
      independent,
    );
  }

  for (const kind of ['symlink-state', 'replaceable-ancestor']) {
    await check(
      `AUTO-LOCK-PUBLICATION-${kind.toUpperCase()}`,
      async () => {
        const setup = await setupState(`publication-${kind}`);
        const journal = await readFile(join(setup.path, 'journal.log'));
        const offset = (await events()).length;
        let selected = setup.path;
        let ancestor;
        const beforeMode = (await stat(c.directory)).mode & 0o7777;
        try {
          if (kind === 'symlink-state') {
            selected = join(c.directory, 'symlink-state-alias');
            await symlink(setup.path, selected);
          } else {
            ancestor = c.directory;
            // Make this real ancestor reachable and replaceable from another UID.
            // /fixtures is the dedicated synthetic root. Restore both modes below.
            await chmod('/fixtures', 0o711);
            await chmod(ancestor, 0o777);
          }
          const resource = c.start(['serve', '--secure-local'], { state: selected, input: '' });
          await until(
            async () =>
              resource.code !== undefined ||
              (await events()).slice(offset).some((e) => e.event === 'ready-publication'),
            5000,
            'secure start settles',
          );
          const refusedBeforeStop = resource.code === 4;
          if (resource.code === undefined) {
            assert.equal((await c.cli(['stop'], { state: selected })).code, 0);
            await c.finish(resource, 30000);
            await closed(setup.path, setup.config.broker.port);
          }
          assert.equal(
            refusedBeforeStop,
            true,
            'trust publication refuses unsafe state ancestry before key/journal',
          );
          assert.ok(!(await events()).slice(offset).some((e) => e.event === 'journal-open'));
          assert.ok((await readFile(join(setup.path, 'journal.log'))).equals(journal));
        } finally {
          if (ancestor) {
            await chmod(ancestor, beforeMode);
            await chmod('/fixtures', 0o700);
          }
        }
      },
      independent,
    );
  }

  // Real protected-record reads and TCP occupancy. Short budgets here prove
  // refusal/preservation, not the separately known-RED 150000 ms child deadline.
  for (const fault of ['load-substitute', 'load-unsafe-handle', 'load-read-failure']) {
    await check(
      `AUTO-LOCK-READER-${fault.toUpperCase()}`,
      async () => {
        const setup = await setupState(`reader-${fault}`);
        const lock = await syntheticLock(setup);
        const before = (await events()).length;
        const result = await c.cli(['stop'], {
          state: setup.path,
          moreEnv: {
            PROCEED_TEST_CREDENTIAL_FAULT: fault,
            PROCEED_TEST_CREDENTIAL_FAULT_FILE: lock.path,
          },
        });
        const observed = (await events()).slice(before);
        assert.ok(observed.some((e) => e.event === 'credential-fault' && e.fault === fault));
        assert.notEqual(result.code, 0);
        if (fault !== 'load-read-failure')
          assert.ok(
            !observed.some((e) => e.event === 'credential-content-read'),
            'unsafe/substituted trust handle refused before key content',
          );
        if (fault === 'load-substitute') {
          assert.equal(await readFile(lock.path, 'utf8'), 'SYNTHETIC_REPLACEMENT\n');
          assert.ok((await readFile(`${lock.path}.original`)).equals(lock.bytes));
        } else assert.ok((await readFile(lock.path)).equals(lock.bytes));
      },
      independent,
    );
  }
  await check(
    'AUTO-EXPIRED-BUDGET-NO-LAUNCH',
    async () => {
      const setup = await setupState('expired-admission');
      let launches = 0;
      await assert.rejects(
        awaitSecureAvailability({
          lockFile: join(setup.path, 'broker.lock'),
          port: setup.config.broker.port,
          token: 'SYNTHETIC_AUTHORITY',
          budgetMs: 0,
          launch() {
            launches++;
          },
        }),
      );
      assert.equal(launches, 0, 'expired attempt cannot admit occupancy/launch work');
    },
    independent,
  );
  for (const kind of [
    'occupied-no-lock',
    'malformed',
    'oversize',
    'unsafe-mode',
    'hard-link',
    'symlink',
    'foreign-owner',
    'stale',
  ]) {
    await check(
      `AUTO-LOCK-${kind.toUpperCase()}`,
      async () => {
        const setup = await setupState(`lock-${kind}`);
        const lock = kind === 'occupied-no-lock' ? null : await syntheticLock(setup);
        let server;
        let captured = 0,
          launches = 0;
        const received = [];
        const journal = await readFile(join(setup.path, 'journal.log'));
        try {
          if (kind === 'occupied-no-lock') {
            server = c.ownServer(
              net.createServer((socket) =>
                socket.on('data', (b) => {
                  captured += b.length;
                }),
              ),
            );
            await listen(server, setup.config.broker.port);
          } else if (kind === 'malformed') await writeFile(lock.path, '{');
          else if (kind === 'oversize') await writeFile(lock.path, ' '.repeat(4097));
          else if (kind === 'unsafe-mode') await chmod(lock.path, 0o644);
          else if (kind === 'hard-link') await link(lock.path, `${lock.path}.other`);
          else if (kind === 'symlink') {
            await rm(lock.path);
            await writeFile(`${lock.path}.target`, lock.bytes, { mode: 0o600 });
            await symlink(`${lock.path}.target`, lock.path);
          } else if (kind === 'foreign-owner') await chown(lock.path, 65534, 65534);
          if (lock && kind !== 'stale') {
            server = lifecyclePeer(lock, 'SYNTHETIC_AUTHORITY', received);
            await listen(server, lock.port);
          }
          const bytes =
            kind === 'foreign-owner' ? lock.bytes : lock ? await readFile(lock.path) : null;
          const start = performance.now();
          await assert.rejects(
            awaitSecureAvailability({
              lockFile: join(setup.path, 'broker.lock'),
              port: setup.config.broker.port,
              token: 'SYNTHETIC_AUTHORITY',
              budgetMs: 350,
              launch() {
                launches++;
              },
            }),
          );
          assert.ok(performance.now() - start < 1500);
          assert.equal(launches, 0, 'uncertain ownership cannot launch');
          assert.equal(captured, 0, 'TCP occupancy sends no application bytes');
          assert.equal(
            received.length,
            0,
            'unsafe records never authorize HTTP, even to matching-key peer',
          );
          if (kind === 'foreign-owner')
            await chown(lock.path, process.geteuid(), process.getegid());
          if (lock) assert.ok((await readFile(lock.path)).equals(bytes));
          assert.ok((await readFile(join(setup.path, 'journal.log'))).equals(journal));
        } finally {
          await c.closeServers();
          if (kind === 'foreign-owner')
            await chown(lock.path, process.geteuid(), process.getegid());
        }
      },
      independent,
    );
  }

  for (const code of ['BROKER_NOT_READY', 'STORAGE_FAILURE']) {
    await check(
      code === 'BROKER_NOT_READY'
        ? 'AUTO-NOT-READY-SETTLED-PROBE-SPACING'
        : 'AUTO-READINESS-STORAGE-CLASSIFICATION',
      async () => {
        const setup = await setupState(`readiness-${code}`);
        const lock = await syntheticLock(setup);
        const settled = [],
          began = [];
        const server = lifecyclePeer(lock, 'SYNTHETIC_AUTHORITY', [], undefined, {}, (req, res) => {
          began.push(performance.now());
          res.writeHead(503);
          res.end(
            JSON.stringify({
              schema_version: 1,
              error: { code, message: 'synthetic', retryable: code === 'BROKER_NOT_READY' },
            }),
          );
          res.once('finish', () => settled.push(performance.now()));
        });
        try {
          await listen(server, lock.port);
          await assert.rejects(
            awaitSecureAvailability({
              lockFile: lock.path,
              port: lock.port,
              token: 'SYNTHETIC_AUTHORITY',
              budgetMs: 450,
            }),
            (e) =>
              e.code ===
              (code === 'STORAGE_FAILURE' ? 'STORAGE_FAILURE' : 'BROKER_STARTUP_TIMEOUT'),
          );
          if (code === 'BROKER_NOT_READY') {
            assert.ok(began.length >= 2, 'actual repeated probes');
            assert.ok(
              began.slice(1).every((at, i) => at - settled[i] >= 100),
              '100 ms after settlement',
            );
          }
          assert.ok((await readFile(lock.path)).equals(lock.bytes));
        } finally {
          await c.closeServers();
          await removeSynthetic(lock);
        }
      },
      independent,
    );
  }

  await check(
    'AUTO-READINESS-SHARED-TLS-HTTP-DEADLINE',
    async () => {
      const setup = await setupState('shared-probe-deadline');
      const lock = await syntheticLock(setup);
      const received = [];
      const endpoint = lifecyclePeer(lock, 'SYNTHETIC_AUTHORITY', received, () => delay(650));
      const upstreams = new Set();
      const pending = new Set();
      try {
        await listen(endpoint, 0);
        const relay = c.ownServer(
          net.createServer((socket) => {
            // Delay actual TLS establishment, then independently delay the HTTP
            // response. Neither phase alone exceeds the one probe budget.
            socket.pause();
            const timer = setTimeout(() => {
              pending.delete(timer);
              if (socket.destroyed) return;
              const upstream = net.connect({ host: '127.0.0.1', port: endpoint.address().port });
              upstreams.add(upstream);
              upstream.on('error', () => socket.destroy());
              socket.on('error', () => upstream.destroy());
              socket.once('close', () => upstream.destroy());
              upstream.once('close', () => upstreams.delete(upstream));
              socket.pipe(upstream).pipe(socket);
              socket.resume();
            }, 650);
            pending.add(timer);
          }),
        );
        await listen(relay, lock.port);
        const start = performance.now();
        let adopted = false;
        try {
          await awaitSecureAvailability({
            lockFile: lock.path,
            port: lock.port,
            token: 'SYNTHETIC_AUTHORITY',
            budgetMs: 1000,
          });
          adopted = true;
        } catch (error) {
          assert.equal(error.code, 'BROKER_STARTUP_TIMEOUT');
        }
        assert.equal(adopted, false, 'expired TLS plus HTTP attempt must not adopt readiness');
        assert.ok(performance.now() - start <= 1100, 'one absolute budget includes TLS and HTTP');
      } finally {
        for (const timer of pending) clearTimeout(timer);
        for (const socket of upstreams) socket.destroy();
        await c.closeServers();
        await removeSynthetic(lock);
      }
    },
    independent,
  );

  const telegram = await telegramFixture();
  c.telegram = telegram;
  await writeFile(join(c.directory, 'telegram-port'), new URL(telegram.address).port);

  await check(
    'AUTO-EOF-BEFORE-READY-INVALID-BEFORE-MUTATION',
    async () => {
      const setup = await setupState('early-eof');
      h.selectState(setup.path);
      const credential = await provision(setup.path, 'early-credential');
      const adapter = await connect(setup, credential, 'alice', {
        PROCEED_TEST_CREDENTIAL_FAULT: 'load-slow',
        PROCEED_TEST_CREDENTIAL_FAULT_FILE: credential,
      });
      const catalog = await adapter.peer.call('tools/list', {}).outcome;
      assert.equal(catalog.kind, 'response');
      assert.equal(catalog.frame.result.tools.length, 5);
      const invalid = await adapter.call('request_approval', { action: 123 });
      assert.equal(invalid.kind, 'response');
      assert.equal(invalid.frame.result.isError, true);
      const start = performance.now();
      await eof(adapter);
      assert.ok(performance.now() - start < 1500, 'EOF does not wait for discovery deadline');
      await ready(setup.path);
      const status = await c.cli(['status', '--json'], { state: setup.path });
      assert.equal(status.code, 0);
      assert.deepEqual(JSON.parse(status.output).requests, []);
      await stop(setup);
    },
    independent,
  );

  await check(
    'AUTO-DISTINCT-OWNER-NONLAST-CLOSE-NO-RESTART',
    async () => {
      const setup = await setupState('sharing');
      h.selectState(setup.path);
      assert.equal(
        (await c.cli(['owner', 'add', 'bob', '--label', 'Other owner'], { state: setup.path }))
          .code,
        0,
      );
      const credential = await provision(setup.path, 'sharing-credential');
      const a = await connect(setup, credential);
      const b = await connect(setup, credential, 'bob');
      success(await a.call('prepare_approval', {}));
      const first = await lockAt(setup.path);
      await eof(a);
      success(await b.call('prepare_approval', {}));
      assert.ok((await lockAt(setup.path)).bytes.equals(first.bytes));
      await stop(setup);
      const before = (await events()).filter((e) => e.event === 'launch').length;
      const result = await b.call('prepare_approval', {});
      assert.equal(result.kind, 'response');
      assert.equal(result.frame.result.isError, true);
      await delay(300);
      assert.equal(
        (await events()).filter((e) => e.event === 'launch').length,
        before,
        'same adapter never respawns explicitly stopped broker',
      );
      assert.equal(await absent(join(setup.path, 'broker.lock')), true);
      await eof(b);
    },
    independent,
  );

  await check(
    'AUTO-DRAIN-HELD-STOP-TIMEOUT',
    async () => {
      const setup = await setupState('drain-held');
      h.selectState(setup.path);
      const credential = await provision(setup.path, 'drain-credential');
      const a = await connect(setup, credential);
      success(await a.call('prepare_approval', {}));
      await eof(a);
      const { lock, control } = await ready(setup.path);
      const gate = join(c.directory, 'hold-journal-close');
      await writeFile(gate, 'hold');
      try {
        const start = performance.now();
        const command = c.start(['stop'], { state: setup.path, input: '' });
        await until(
          async () =>
            (await events()).some((e) => e.event === 'journal-close-held' && e.pid === lock.pid),
          5000,
          'actual journal close held',
        );
        assert.ok(
          (await readFile(lock.path)).equals(lock.bytes),
          'lock held while journal unresolved',
        );
        await check(
          'AUTO-LIFECYCLE-AVAILABLE-DURING-DRAIN',
          async () => {
            const response = await exchange(lock, control);
            assert.equal(response.status, 503, 'readiness withdrawn during drain');
            assert.equal(response.body.error.code, 'BROKER_NOT_READY');
          },
          independent,
        );
        await c.finish(command, 32000);
        assert.equal(command.code, 3);
        assert.match(command.output, /BROKER_STOP_TIMEOUT/);
        assert.ok(performance.now() - start <= 31500);
        assert.ok(
          (await readFile(lock.path)).equals(lock.bytes),
          'timeout does not release live drain or force kill',
        );
      } finally {
        await rm(gate, { force: true });
        await closed(setup.path, setup.config.broker.port);
      }
    },
    independent,
  );

  await check(
    'AUTO-EXPIRY-DELIVERY-OWNER-CAPABILITY-RESTART',
    async () => {
      const setup = await setupState('expiry-ledger');
      h.selectState(setup.path);
      assert.equal(
        (await c.cli(['owner', 'add', 'bob', '--label', 'Other owner'], { state: setup.path }))
          .code,
        0,
      );
      const credential = await provision(setup.path, 'expiry-credential');
      const clock = join(c.directory, 'clock.json');
      const now = Date.now();
      await writeFile(clock, JSON.stringify(now));
      const a = await connect(setup, credential, 'alice', { PROCEED_TEST_CLOCK: clock });
      await ready(setup.path);
      const paired = await c.cli(['pair', '--telegram-token-file', credential], {
        state: setup.path,
      });
      assert.equal(paired.code, 0);
      telegram.text(`/pair ${/Pairing code: (\S+)/.exec(paired.output)[1]}`);
      const p = success(await a.call('prepare_approval', {}));
      const wait = a.call('request_approval', question(p));
      await until(
        () =>
          telegram.messages.find(
            (m) => m.text.includes(p.request_id) && m.reply_markup?.inline_keyboard,
          ),
        8000,
        'actual pending presentation',
      );
      const b = await connect(setup, credential, 'bob');
      for (const args of [
        authority(p),
        { ...authority(p), request_capability: `cap_${'0'.repeat(64)}` },
      ]) {
        const denied = await b.call('get_approval', args);
        assert.equal(
          denied.frame.result.isError,
          true,
          'foreign owner cannot use leaked capability',
        );
      }
      const denied = await a.call('get_approval', {
        ...authority(p),
        request_capability: `cap_${'0'.repeat(64)}`,
      });
      assert.equal(denied.frame.result.isError, true);
      await eof(a);
      assert.equal((await wait).kind, 'transport-closed');
      await eof(b);
      await stop(setup);
      await writeFile(clock, JSON.stringify(now + 61000));
      const second = await connect(setup, credential, 'alice', { PROCEED_TEST_CLOCK: clock });
      const expired = success(await second.call('get_approval', authority(p)));
      assert.equal(expired.request_id, p.request_id);
      assert.equal(expired.resolution, 'expired', 'startup sweeps overdue pending request');
      assert.equal(expired.delivery_state, 'unavailable', 'lost call is not returned delivery');
      assert.match(expired.decision_id, /^dec_[a-f0-9]{32}$/);
      const ack = success(
        await second.call('acknowledge_approval', {
          ...authority(p),
          decision_id: expired.decision_id,
        }),
      );
      assert.equal(ack.delivery_state, 'confirmed');
      await eof(second);
      await stop(setup);
      const third = await connect(setup, credential, 'alice', { PROCEED_TEST_CLOCK: clock });
      const restored = success(await third.call('get_approval', authority(p)));
      assert.equal(restored.decision_id, expired.decision_id);
      assert.equal(restored.delivery_state, 'confirmed');
      await eof(third);
      await stop(setup);
      assert.ok(!JSON.stringify(telegram.calls).includes(p.request_capability));
      await h.scan(setup.path, [...c.secrets, p.request_capability]);
    },
    independent,
  );
  c.cleanOutput();
}
