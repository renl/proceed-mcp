// Test-only Node effect doubles, not a production interface or admission model.
// Contract: simplify-windows-storage-admission/design.md decisions 1-5.
// All storage, platform and child-process observations below are synthetic.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { win32, posix } from 'node:path';
import { Readable } from 'node:stream';

let memory;
let effects;
let hooks;
let serial;
const raw = 'SYNTHETIC-PRIVATE-ERROR';
const token = 'a'.repeat(64);
const channel = { protocol: 'tls-psk-v1', psk: 'b'.repeat(64) };
const pathApi = () => (process.platform === 'win32' ? win32 : posix);
const failure = (code) => Object.assign(new Error(raw), { code });
const names = [
  'join',
  'parse',
  'dirname',
  'basename',
  'isAbsolute',
  'resolve',
  'normalize',
  'relative',
  'extname',
  'format',
  'toNamespacedPath',
];
mock.module('node:path', {
  namedExports: {
    win32,
    posix,
    sep: '\\',
    delimiter: ';',
    ...Object.fromEntries(names.map((name) => [name, (...args) => pathApi()[name](...args)])),
  },
});
mock.module('node:os', { namedExports: { homedir: () => 'C:\\SyntheticHome' } });
function forbiddenProcess(...args) {
  effects.push(['process', ...args]);
  const callback = args.at(-1);
  if (typeof callback === 'function') {
    queueMicrotask(() => callback(failure('ENOENT'), '', ''));
    return { kill() {} };
  }
  throw failure('ENOENT');
}
mock.module('node:child_process', {
  namedExports: { execFile: forbiddenProcess, spawn: forbiddenProcess },
});

function entry(path) {
  const value = memory.get(path);
  if (!value) throw failure('ENOENT');
  return value;
}
function info(value) {
  return {
    dev: 1,
    ino: value.id,
    nlink: value.nlink ?? 1,
    size: value.bytes.length,
    uid: value.uid ?? 99999,
    mode: value.mode ?? (value.kind === 'directory' ? 0o777 : 0o666),
    isFile: () => value.kind === 'file',
    isDirectory: () => value.kind === 'directory',
    isSymbolicLink: () => value.kind === 'link',
  };
}
function put(path, bytes = '', kind = 'file', extra = {}) {
  const value = { id: ++serial, bytes: Buffer.from(bytes), kind, originalKind: kind, ...extra };
  memory.set(path, value);
  return value;
}
async function effect(name, args, action) {
  effects.push([name, ...args]);
  await hooks.before?.(name, args);
  const result = await action();
  await hooks.after?.(name, args, result);
  return result;
}
function asBytes(value) {
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}
function decoded(bytes, options) {
  return (typeof options === 'string' ? options : options?.encoding)
    ? bytes.toString()
    : Buffer.from(bytes);
}
const fs = {
  async lstat(path) {
    return effect('lstat', [path], () => info(entry(path)));
  },
  async stat(path) {
    return effect('stat', [path], () => {
      const value = entry(path);
      // stat follows a link. It cannot stand in for lstat's non-following proof.
      return info(
        value.kind === 'link'
          ? { ...value, kind: value.originalKind, id: value.id + 10000 }
          : value,
      );
    });
  },
  async realpath(path) {
    return effect('realpath', [path], () => path);
  },
  async readdir(path) {
    return effect('readdir', [path], () => {
      assert.equal(entry(path).kind, 'directory');
      return [...memory.keys()]
        .filter((p) => pathApi().dirname(p) === path && p !== path)
        .map((p) => pathApi().basename(p));
    });
  },
  async mkdir(path, options) {
    return effect('mkdir', [path, options], () => {
      if (memory.has(path)) {
        if (options?.recursive) return;
        throw failure('EEXIST');
      }
      if (!memory.has(pathApi().dirname(path)) && !options?.recursive) throw failure('ENOENT');
      if (options?.recursive) {
        const { root, rest } = pathTrust.splitPath(path);
        let prefix = root;
        for (const part of rest.slice(0, -1)) {
          prefix = pathApi().join(prefix, part);
          if (!memory.has(prefix)) put(prefix, '', 'directory', { mode: options.mode });
          else if (entry(prefix).kind !== 'directory') throw failure('ENOTDIR');
        }
      }
      put(path, '', 'directory', {
        mode: options?.mode,
        uid: process.platform === 'win32' ? 99999 : pathTrust.effectiveUid(),
      });
    });
  },
  async readFile(path, options) {
    return effect('readFile', [path], () => decoded(entry(path).bytes, options));
  },
  async chmod(path, mode) {
    return effect('chmod', [path, mode], () => {
      assert.notEqual(process.platform, 'win32', 'Windows chmod is forbidden');
      entry(path).mode = mode;
    });
  },
  async rename(from, to) {
    return effect('rename', [from, to], () => {
      const value = entry(from);
      memory.set(to, value);
      memory.delete(from);
    });
  },
  async unlink(path) {
    return effect('unlink', [path], () => {
      entry(path);
      memory.delete(path);
    });
  },
  async rm(path, options) {
    return effect('rm', [path, options], () => {
      memory.delete(path);
      if (options?.recursive)
        for (const p of memory.keys())
          if (p.startsWith(`${path}${pathApi().sep}`)) memory.delete(p);
    });
  },
  async rmdir(path) {
    return effect('rmdir', [path], () => {
      if ([...memory.keys()].some((p) => p !== path && pathApi().dirname(p) === path))
        throw failure('ENOTEMPTY');
      memory.delete(path);
    });
  },
  async open(path, flags, mode) {
    return effect('open', [path, flags, mode], () => {
      if (flags === 'wx' && memory.has(path)) throw failure('EEXIST');
      if (!memory.has(path)) {
        if (!['wx', 'a'].includes(flags)) throw failure('ENOENT');
        if (entry(pathApi().dirname(path)).kind !== 'directory') throw failure('ENOTDIR');
        put(path, '', 'file', {
          mode,
          uid: process.platform === 'win32' ? 99999 : pathTrust.effectiveUid(),
        });
      }
      const observed = entry(path);
      // An ordinary open follows redirection too. Correctness must come from
      // non-following path observations and comparison with this opened target.
      const value =
        observed.kind === 'link'
          ? { ...observed, kind: observed.originalKind, id: observed.id + 10000 }
          : observed;
      let closed = false;
      return {
        stat: () => effect('handle.stat', [path], () => info(value)),
        chmod: (next) =>
          effect('handle.chmod', [path, next], () => {
            assert.notEqual(process.platform, 'win32', 'Windows handle chmod is forbidden');
            value.mode = next;
          }),
        readFile: (options) =>
          effect('handle.readFile', [path], () => {
            assert.equal(closed, false);
            return decoded(value.bytes, options);
          }),
        writeFile: (bytes) =>
          effect('writeFile', [path], () => {
            assert.equal(closed, false);
            value.bytes = asBytes(bytes);
          }),
        write: (bytes, offset, length) =>
          effect('write', [path], () => {
            assert.equal(closed, false);
            if (hooks.zeroWrite) return { bytesWritten: 0 };
            value.bytes = Buffer.concat([value.bytes, bytes.subarray(offset, offset + length)]);
            return { bytesWritten: length };
          }),
        truncate: (length) =>
          effect('truncate', [path, length], () => {
            value.bytes = value.bytes.subarray(0, length);
          }),
        sync: () => effect('sync', [path], () => {}),
        close: () =>
          effect('close', [path], () => {
            closed = true;
          }),
      };
    });
  },
};
mock.module('node:fs/promises', {
  namedExports: Object.fromEntries(
    [
      'chmod',
      'mkdir',
      'stat',
      'lstat',
      'open',
      'realpath',
      'readFile',
      'writeFile',
      'unlink',
      'rm',
      'rename',
      'readdir',
      'access',
      'rmdir',
      'appendFile',
      'truncate',
    ].map((name) => [
      name,
      fs[name] ??
        (() => {
          throw new Error(`Unbound unit effect: ${name}`);
        }),
    ]),
  ),
});

const protection = await import('../src/state/protection.js');
const store = await import('../src/state/store.js');
const { statePaths } = await import('../src/state/paths.js');
const credentials = await import('../src/state/credentials.js');
const ownerCredentials = await import('../src/state/owner-credentials.js');
const ownership = await import('../src/state/ownership.js');
const operator = await import('../src/harness/operator-key.js');
const files = await import('../src/state/files.js');
const pathTrust = await import('../src/state/path-trust.js');
const credential = await import('../src/state/credential-file.js');
const { Journal } = await import('../src/journal/journal.js');
const { createFileHeader, readJournal } = await import('../src/journal/framing.js');
const config = await import('../src/config/portable-config.js');
const legacyConfig = await import('../src/config/config.js');

// No listener, timer, worker or Telegram client runs. Only runtime assembly and
// the affected storage collaborators remain real.
let runtimeEvents;
let onBind;
mock.module('../src/broker/portable.js', {
  namedExports: {
    createPortableBroker: () => ({
      recover: async () => runtimeEvents.push('recover'),
      sweepExpired: async () => runtimeEvents.push('expiry'),
      close: async () => runtimeEvents.push('broker-close'),
      pairing: () => null,
    }),
  },
});
mock.module('../src/broker/portable-server.js', {
  namedExports: {
    createPortableServer: ({ credentials, secure }) => {
      assert.equal(credentials.control, token);
      assert.equal(secure.key.length, 32);
      return {
        listen: async () => {
          runtimeEvents.push('bind');
          onBind?.();
        },
        markReady: () => runtimeEvents.push('ready'),
        beginDrain: () => runtimeEvents.push('drain'),
        close: async () => runtimeEvents.push('server-close'),
      };
    },
  },
});
mock.module('../src/broker/expiry-schedule.js', {
  namedExports: {
    startExpirySchedule: () => ({
      failed: false,
      stop: async () => runtimeEvents.push('schedule-stop'),
    }),
  },
});
mock.module('../src/telegram/portable-poller.js', {
  namedExports: {
    createPortableTelegramPoller: () => ({
      start: () => runtimeEvents.push('telegram-start'),
      stop: async () => runtimeEvents.push('telegram-stop'),
    }),
  },
});
const { startPortableRuntime } = await import('../src/broker/portable-runtime.js');

async function unit(body, platform = 'win32') {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const uidDescriptor = Object.getOwnPropertyDescriptor(process, 'geteuid');
  const environment = process.env;
  process.env = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' };
  Object.defineProperty(process, 'geteuid', { configurable: true, value: () => 1000 });
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  memory = new Map();
  effects = [];
  hooks = {};
  serial = 0;
  const root = platform === 'win32' ? 'C:\\' : '/';
  put(root, '', 'directory', { mode: 0o755, uid: 0 });
  const base = platform === 'win32' ? 'C:\\Synthetic' : '/synthetic';
  put(base, '', 'directory', { mode: 0o700, uid: pathTrust.effectiveUid() });
  const paths = statePaths(pathApi().join(base, 'state'));
  try {
    await body(paths, base);
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
    if (uidDescriptor) Object.defineProperty(process, 'geteuid', uidDescriptor);
    else delete process.geteuid;
    process.env = environment;
  }
}
function existing(paths) {
  put(paths.stateDir, '', 'directory');
  put(paths.credentialsDir, '', 'directory');
  put(paths.configFile, config.serializeConfig(config.createEmptyConfig()));
  put(paths.controlCredentialFile, `${token}\n`);
  put(paths.journalFile, createFileHeader());
}
function noWindowsPolicy() {
  assert.equal(
    effects.filter(([name]) => ['process', 'chmod', 'handle.chmod'].includes(name)).length,
    0,
    'no custom query, child process or permission repair',
  );
}
function secretFree(error) {
  assert.ok(!error.message.includes(raw));
  assert.ok(!error.message.includes(token));
  assert.ok(!/icacls|NTFS|owner-only protection.*verified/i.test(error.message));
  return true;
}
const mutations = [{ type: 'pairing_set', chat_id: '123', user_id: '456' }];
const committedAt = '2026-11-15T00:00:00.000Z';

test('WIN-ORDINARY: init then owner creation and unchanged state reuse need no protection query', async () => {
  await unit(async (paths) => {
    const initialized = await store.initializeState(paths);
    assert.equal(initialized.stateDir, paths.stateDir);
    assert.deepEqual(initialized.config.owners, []);
    const added = await store.addOwner(paths, { ownerId: 'test', label: 'Test' });
    assert.equal(added.owner.owner_id, 'test');
    assert.ok(
      !JSON.stringify(added).includes(
        await credentials.readLocalCredential(added.ownerCredentialFile),
      ),
    );
    const snapshot = new Map([...memory].map(([p, value]) => [p, Buffer.from(value.bytes)]));
    const loaded = await store.loadPortableConfiguration(paths);
    assert.equal(loaded.owners[0].owner_id, 'test');
    assert.equal(
      (await ownerCredentials.readOwnerCredential(added.ownerCredentialFile, 'test')).length,
      64,
    );
    for (const [p, bytes] of snapshot) assert.deepEqual(entry(p).bytes, bytes);
    await assert.rejects(store.initializeState(paths), { code: 'STATE_ALREADY_INITIALIZED' });
    await assert.rejects(store.addOwner(paths, { ownerId: 'test', label: 'Again' }), {
      code: 'INVALID_ARGUMENT',
    });
    noWindowsPolicy();
  });
});

test('WIN-ORDINARY: supplied foreign mode/owner and unavailable query do not gate shared callers', async () => {
  await unit(async (paths) => {
    existing(paths);
    await protection.verifyOwnerOnly([paths.stateDir, paths.configFile]);
    assert.equal((await store.loadPortableConfiguration(paths)).schema_version, 2);
    assert.equal(await credentials.readLocalCredential(paths.controlCredentialFile), token);
    await ownerCredentials.writeOwnerCredential(paths.ownerCredentialFile('test'));
    await files.writeFileAtomically(
      paths.configFile,
      config.serializeConfig(config.createEmptyConfig()),
    );
    noWindowsPolicy();
  });
});

test('WIN-ORDINARY: missing parent directories are supported without permission preparation', async () => {
  await unit(async (_paths, base) => {
    const paths = statePaths(pathApi().join(base, 'missing', 'nested', 'state'));
    await store.initializeState(paths);
    assert.equal((await store.loadPortableConfiguration(paths)).schema_version, 2);
    assert.equal(entry(pathApi().dirname(paths.stateDir)).kind, 'directory');
    noWindowsPolicy();
  });
});

test('WIN-LEGACY: origin setup and subsequent local-credential/config reads use ordinary storage', async () => {
  await unit(async (paths) => {
    existing(paths);
    entry(paths.configFile).bytes = Buffer.from(
      legacyConfig.serializeConfig(legacyConfig.createEmptyConfig()),
    );
    const result = await store.addOrigin(paths, {
      originId: 'test',
      url: 'http://127.0.0.1:4096',
      passwordEnv: 'SYNTHETIC_PASSWORD',
    });
    assert.equal(result.origin.origin_id, 'test');
    assert.equal((await credentials.readLocalCredential(result.originCredentialFile)).length, 64);
    assert.equal((await store.loadConfiguration(paths)).origins[0].origin_id, 'test');
    noWindowsPolicy();
  });
});

test('WIN-OWNER: any existing ownership record blocks owner mutation without reading it', async () => {
  await unit(async (paths) => {
    existing(paths);
    put(paths.brokerLockFile, raw);
    await assert.rejects(store.addOwner(paths, { ownerId: 'test', label: 'Test' }), {
      code: 'BROKER_STATE_PRESENT',
    });
    assert.equal(memory.has(paths.ownerCredentialFile('test')), false);
    assert.equal(
      effects.some(
        ([name, p]) =>
          p === paths.brokerLockFile && ['readFile', 'handle.readFile', 'unlink'].includes(name),
      ),
      false,
    );
    noWindowsPolicy();
  });
});

test('WIN-RUNTIME: shared initial/final admission and recovery ordering are not init-only', async (t) => {
  for (const fault of ['none', 'initial-kind', 'final-kind'])
    await t.test(fault, () =>
      unit(async (paths) => {
        existing(paths);
        runtimeEvents = [];
        onBind = () => {
          if (fault === 'final-kind') entry(paths.stateDir).kind = 'link';
        };
        if (fault === 'initial-kind') entry(paths.stateDir).kind = 'link';
        try {
          const attempt = startPortableRuntime({
            paths,
            config: { broker: { port: 43189 }, owners: [] },
            secure: true,
            telegram: { getUpdates: async () => [] },
          });
          if (fault === 'none') {
            const runtime = await attempt;
            try {
              assert.ok(runtimeEvents.indexOf('recover') < runtimeEvents.indexOf('expiry'));
              assert.ok(runtimeEvents.indexOf('expiry') < runtimeEvents.indexOf('bind'));
              assert.ok(runtimeEvents.indexOf('bind') < runtimeEvents.indexOf('ready'));
              assert.ok(runtimeEvents.indexOf('ready') < runtimeEvents.indexOf('telegram-start'));
            } finally {
              await runtime.stop();
            }
            assert.ok(
              runtimeEvents.indexOf('broker-close') < runtimeEvents.indexOf('server-close'),
            );
          } else {
            await assert.rejects(attempt, secretFree);
            assert.equal(runtimeEvents.includes('ready'), false);
            assert.equal(runtimeEvents.includes('telegram-start'), false);
            if (fault === 'initial-kind') assert.equal(memory.has(paths.brokerLockFile), false);
            else assert.ok(runtimeEvents.includes('server-close'));
          }
          noWindowsPolicy();
        } finally {
          onBind = null;
        }
      }),
    );
});

test('WIN-OWNERSHIP: acquire, secure read and exact-instance release without protection admission', async () => {
  await unit(async (paths) => {
    existing(paths);
    const lock = await ownership.acquireStateOwnership({
      lockFile: paths.brokerLockFile,
      port: 43189,
      channel,
    });
    assert.ok(effects.some(([name, p]) => name === 'sync' && p === paths.brokerLockFile));
    entry(paths.brokerLockFile).mode = 0o666;
    const record = await ownership.readSecureOwnership(paths.brokerLockFile);
    assert.equal(record.instance, lock.instance);
    assert.equal(record.channel.psk, channel.psk);
    await assert.rejects(
      ownership.acquireStateOwnership({ lockFile: paths.brokerLockFile, port: 43189, channel }),
      { code: 'STATE_NOT_OWNED' },
    );
    assert.equal(await lock.release(), true);
    assert.equal(memory.has(paths.brokerLockFile), false);
    noWindowsPolicy();
  });
});

test('WIN-KEY: create-only operator key and subsequent load retain fingerprint and no secret result', async () => {
  await unit(async (paths, base) => {
    existing(paths);
    const file = pathApi().join(base, 'operator', 'operator.key');
    const created = await operator.createOperatorKeyFile({ file, stateDir: paths.stateDir });
    assert.deepEqual(Object.keys(created).sort(), ['file', 'keyId']);
    entry(file).mode = 0o666;
    entry(pathApi().dirname(file)).mode = 0o777;
    const loaded = await operator.loadOperatorKeyFile({ file, stateDir: paths.stateDir });
    assert.equal(loaded.keyId, created.keyId);
    assert.equal(operator.operatorKeyId(loaded.credential), created.keyId);
    assert.equal(entry(file).bytes.toString(), `${loaded.credential}\n`);
    const before = Buffer.from(entry(file).bytes);
    await assert.rejects(operator.createOperatorKeyFile({ file, stateDir: paths.stateDir }));
    assert.deepEqual(entry(file).bytes, before);
    noWindowsPolicy();
  });
});

test('WIN-JOURNAL: header creation, append, incomplete-tail recovery and format upgrade preserve history', async () => {
  await unit(async (paths) => {
    existing(paths);
    entry(paths.journalFile).bytes = Buffer.alloc(0);
    let journal = await Journal.open(paths.journalFile);
    try {
      assert.equal((await journal.append(mutations, { committedAt })).sequence, 1);
    } finally {
      await journal.close();
    }
    const committed = Buffer.from(entry(paths.journalFile).bytes);
    entry(paths.journalFile).bytes = Buffer.concat([committed, Buffer.from([0, 0])]);
    journal = await Journal.open(paths.journalFile);
    try {
      assert.equal(journal.sequence, 1);
      assert.deepEqual(entry(paths.journalFile).bytes, committed);
      assert.equal(await journal.ensureHarnessFormat(), true);
      assert.equal(await journal.ensureHarnessFormat(), false);
      const replay = readJournal(entry(paths.journalFile).bytes);
      assert.deepEqual(replay.transactions[0].mutations, mutations);
      assert.equal(replay.transactions[0].committed_at, committedAt);
      assert.equal(replay.transactions[0].sequence, 1);
      assert.equal((await journal.append(mutations, { committedAt })).sequence, 2);
    } finally {
      await journal.close();
    }
    noWindowsPolicy();
  });
});

test('WIN-IO: access denial is not absence and diagnostics are secret-free', async (t) => {
  for (const operation of [
    (p) => store.loadPortableConfiguration(p),
    (p) => credentials.readLocalCredential(p.controlCredentialFile),
    (p) => Journal.open(p.journalFile),
    (p) => ownerCredentials.writeOwnerCredential(p.ownerCredentialFile('test')),
  ])
    await t.test(operation.toString(), () =>
      unit(async (paths) => {
        existing(paths);
        hooks.before = (name) => {
          if (['lstat', 'stat', 'readFile', 'open'].includes(name)) throw failure('EACCES');
        };
        await assert.rejects(operation(paths), secretFree);
        assert.equal(
          effects.some(([name]) => ['write', 'writeFile', 'rename', 'unlink', 'rm'].includes(name)),
          false,
        );
      }),
    );
});

test('WIN-INTEGRITY: reads reject wrong kind, redirected ancestry and handle/path replacement', async (t) => {
  for (const reader of ['config', 'credential', 'record', 'operator']) {
    for (const fault of ['directory', 'link', 'ancestor', 'opened', 'after-read']) {
      await t.test(`${reader}/${fault}`, () =>
        unit(async (paths, base) => {
          existing(paths);
          const file =
            reader === 'config'
              ? paths.configFile
              : reader === 'credential'
                ? paths.controlCredentialFile
                : reader === 'record'
                  ? paths.brokerLockFile
                  : pathApi().join(base, 'operator.key');
          const bytes =
            reader === 'operator'
              ? `hop_${token}\n`
              : reader === 'record'
                ? JSON.stringify({
                    schema_version: 2,
                    instance: 'a'.repeat(32),
                    pid: 1234,
                    port: 43189,
                    started_at: committedAt,
                    channel,
                  })
                : entry(file).bytes;
          put(file, bytes);
          if (fault === 'directory' || fault === 'link') entry(file).kind = fault;
          if (fault === 'ancestor')
            entry(reader === 'operator' ? base : paths.stateDir).kind = 'link';
          hooks.after = (name, args, result) => {
            if (args[0] !== file) return;
            if (fault === 'opened' && name === 'handle.stat') result.ino += 10000;
            if (fault === 'after-read' && ['readFile', 'handle.readFile'].includes(name))
              put(file, bytes);
          };
          const read =
            reader === 'config'
              ? () => store.loadPortableConfiguration(paths)
              : reader === 'credential'
                ? () => credentials.readLocalCredential(file)
                : reader === 'record'
                  ? () => ownership.readSecureOwnership(file)
                  : () => operator.loadOperatorKeyFile({ file, stateDir: paths.stateDir });
          await assert.rejects(read(), secretFree);
          if (['directory', 'link', 'ancestor', 'opened'].includes(fault))
            assert.equal(
              effects.some(
                ([name, p]) => p === file && ['readFile', 'handle.readFile'].includes(name),
              ),
              false,
              'refuse before private bytes',
            );
        }),
      );
    }
  }
});

test('WIN-PRESERVE: ownership release never deletes a same-byte replacement or uncertain entry', async (t) => {
  for (const fault of ['replacement', 'unavailable'])
    await t.test(fault, () =>
      unit(async (paths) => {
        existing(paths);
        const lock = await ownership.acquireStateOwnership({
          lockFile: paths.brokerLockFile,
          port: 43189,
          channel,
        });
        if (fault === 'replacement') put(paths.brokerLockFile, lock.contents);
        else
          hooks.before = (name, [p]) => {
            if (p === paths.brokerLockFile && ['lstat', 'stat', 'open'].includes(name))
              throw failure('EACCES');
          };
        assert.equal(await lock.release(), false);
        assert.equal(memory.has(paths.brokerLockFile), true);
        noWindowsPolicy();
      }),
    );
});

test('WIN-PRESERVE: create collisions do not read, overwrite or remove existing owner/lock/upgrade', async (t) => {
  for (const kind of ['owner', 'lock', 'upgrade'])
    await t.test(kind, () =>
      unit(async (paths) => {
        existing(paths);
        const file =
          kind === 'owner'
            ? paths.ownerCredentialFile('test')
            : kind === 'lock'
              ? paths.brokerLockFile
              : `${paths.journalFile}.upgrade`;
        put(file, raw);
        let journal;
        if (kind === 'upgrade') journal = await Journal.open(paths.journalFile);
        effects.length = 0;
        try {
          await assert.rejects(
            kind === 'owner'
              ? ownerCredentials.writeOwnerCredential(file)
              : kind === 'lock'
                ? ownership.acquireStateOwnership({ lockFile: file, port: 43189, channel })
                : journal.ensureHarnessFormat(),
          );
          assert.equal(entry(file).bytes.toString(), raw);
          assert.equal(
            effects.some(
              ([name, p]) =>
                p === file &&
                ['readFile', 'handle.readFile', 'write', 'writeFile', 'unlink', 'rm'].includes(
                  name,
                ),
            ),
            false,
          );
          noWindowsPolicy();
        } finally {
          await journal?.close();
        }
      }),
    );
});

test('WIN-ATOMIC: write and flush precede rename and success observes published identity', async (t) => {
  for (const fault of ['none', 'flush', 'replaced-sibling', 'replaced-destination'])
    await t.test(fault, () =>
      unit(async (paths) => {
        existing(paths);
        const before = Buffer.from(entry(paths.configFile).bytes);
        hooks.before = (name) => {
          if (fault === 'flush' && name === 'sync') throw failure('EIO');
        };
        hooks.after = (name, [from, to]) => {
          if (fault === 'replaced-sibling' && name === 'sync') put(from, raw);
          if (fault === 'replaced-destination' && name === 'rename') put(to, raw);
        };
        const attempt = files.writeFileAtomically(paths.configFile, 'SYNTHETIC-NEW');
        if (fault === 'none') {
          await attempt;
          assert.equal(entry(paths.configFile).bytes.toString(), 'SYNTHETIC-NEW');
          const order = effects.map(([name]) => name);
          assert.ok(order.indexOf('writeFile') < order.indexOf('sync'));
          assert.ok(order.indexOf('sync') < order.indexOf('rename'));
        } else {
          await assert.rejects(attempt, secretFree);
          if (fault === 'flush' || fault === 'replaced-sibling')
            assert.deepEqual(entry(paths.configFile).bytes, before);
          if (fault === 'replaced-destination')
            assert.equal(entry(paths.configFile).bytes.toString(), raw);
        }
        noWindowsPolicy();
      }),
    );
});

test('WIN-ROLLBACK: init failure preserves preexisting/replaced objects and uncertain subtree', async () => {
  await unit(async (paths) => {
    let replacement;
    hooks.before = (name, [from]) => {
      if (name === 'rename' && from.startsWith(paths.journalFile)) {
        replacement = put(paths.controlCredentialFile, raw);
        put(pathApi().join(paths.stateDir, 'unknown'), raw);
        throw failure('EIO');
      }
    };
    await assert.rejects(store.initializeState(paths));
    assert.equal(memory.get(paths.controlCredentialFile), replacement);
    assert.equal(entry(pathApi().join(paths.stateDir, 'unknown')).bytes.toString(), raw);
    assert.equal(
      effects.some(([name, , options]) => name === 'rm' && options?.recursive),
      false,
    );
    noWindowsPolicy();
  });
});

test('WIN-ROLLBACK: owner config failure preserves replaced credential', async () => {
  await unit(async (paths) => {
    existing(paths);
    const file = paths.ownerCredentialFile('test');
    let replacement;
    hooks.before = (name, [from]) => {
      if (name === 'rename' && from.startsWith(paths.configFile)) {
        replacement = put(file, raw);
        throw failure('EIO');
      }
    };
    await assert.rejects(store.addOwner(paths, { ownerId: 'test', label: 'Test' }));
    assert.equal(memory.get(file), replacement);
    assert.deepEqual((await store.loadPortableConfiguration(paths)).owners, []);
    noWindowsPolicy();
  });
});

test('WIN-JOURNAL: flush failure never acknowledges a sequence and corrupt history is not rewritten', async (t) => {
  for (const fault of ['flush', 'corrupt', 'replaced'])
    await t.test(fault, () =>
      unit(async (paths) => {
        existing(paths);
        if (fault === 'corrupt') {
          const bytes = Buffer.from('not a journal');
          entry(paths.journalFile).bytes = bytes;
          await assert.rejects(Journal.open(paths.journalFile), secretFree);
          assert.deepEqual(entry(paths.journalFile).bytes, bytes);
        } else {
          const journal = await Journal.open(paths.journalFile);
          try {
            if (fault === 'flush')
              hooks.before = (name) => {
                if (name === 'sync') throw failure('EIO');
              };
            else put(paths.journalFile, createFileHeader());
            await assert.rejects(journal.append(mutations, { committedAt }), secretFree);
            assert.equal(journal.sequence, 0);
          } finally {
            await journal.close();
          }
        }
        noWindowsPolicy();
      }),
    );
});

test('WIN-KEY: single-link, bounded malformed key/record, separation and conservative cleanup retained', async (t) => {
  for (const kind of ['links', 'oversized', 'malformed', 'separation', 'cleanup'])
    await t.test(kind, () =>
      unit(async (paths, base) => {
        existing(paths);
        const file =
          kind === 'separation'
            ? pathApi().join(paths.stateDir, 'operator.key')
            : pathApi().join(base, 'operator.key');
        const value = put(
          file,
          kind === 'oversized' ? 'x'.repeat(4097) : kind === 'malformed' ? raw : `hop_${token}\n`,
        );
        if (kind === 'links') value.nlink = 2;
        if (kind === 'cleanup') {
          assert.equal(await pathTrust.removeExactCreated(file, info(value)), false);
          assert.equal(memory.get(file), value);
        } else
          await assert.rejects(
            operator.loadOperatorKeyFile({ file, stateDir: paths.stateDir }),
            secretFree,
          );
        put(paths.brokerLockFile, raw);
        await assert.rejects(ownership.readSecureOwnership(paths.brokerLockFile), {
          code: 'BROKER_INSTANCE_CONFLICT',
        });
        noWindowsPolicy();
      }),
    );
});

test('WIN-PUBLICATION: create-only key/record and journal append discard replacement observed after flush', async (t) => {
  for (const kind of ['owner', 'operator', 'lock', 'journal'])
    await t.test(kind, () =>
      unit(async (paths, base) => {
        existing(paths);
        const file =
          kind === 'owner'
            ? paths.ownerCredentialFile('test')
            : kind === 'operator'
              ? pathApi().join(base, 'operator.key')
              : kind === 'lock'
                ? paths.brokerLockFile
                : paths.journalFile;
        const journal = kind === 'journal' ? await Journal.open(file) : null;
        let replacement;
        hooks.after = (name, [p]) => {
          if (name === 'sync' && p === file) replacement = put(file, raw);
        };
        try {
          const attempt =
            kind === 'owner'
              ? ownerCredentials.writeOwnerCredential(file)
              : kind === 'operator'
                ? operator.createOperatorKeyFile({ file, stateDir: paths.stateDir })
                : kind === 'lock'
                  ? ownership.acquireStateOwnership({ lockFile: file, port: 43189, channel })
                  : journal.append(mutations, { committedAt });
          await assert.rejects(attempt, secretFree);
          assert.ok(replacement, 'the effect reached the changed publication boundary');
          assert.equal(memory.get(file), replacement, 'a replacement is preserved');
          if (journal) assert.equal(journal.sequence, 0);
          noWindowsPolicy();
        } finally {
          await journal?.close();
        }
      }),
    );
});

test('WIN-JOURNAL: a write without progress never acknowledges a transaction', async () => {
  await unit(async (paths) => {
    existing(paths);
    const journal = await Journal.open(paths.journalFile);
    hooks.zeroWrite = true;
    try {
      await assert.rejects(journal.append(mutations, { committedAt }), { code: 'STORAGE_FAILURE' });
      assert.equal(journal.sequence, 0);
      noWindowsPolicy();
    } finally {
      await journal.close();
    }
  });
});

test('POSIX: shared admission still rejects foreign mode and directory creation requires chmod', async () => {
  await unit(async (paths) => {
    existing(paths);
    await assert.rejects(protection.verifyOwnerOnly([paths.configFile]), {
      code: 'PROTECTION_UNVERIFIED',
    });
    await protection.createProtectedDirectory(pathApi().join(paths.stateDir, 'new'));
    assert.ok(effects.some(([name, , mode]) => name === 'chmod' && mode === 0o700));
    assert.equal(pathTrust.ancestorProtects({ mode: 0o777, uid: 99999 }), false);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o1777, uid: 0 }), true);
  }, 'linux');
});

test('POSIX: operator and ownership exact modes/UID remain enforced before private reads', async (t) => {
  for (const reader of ['operator', 'record'])
    for (const fault of ['mode', 'uid']) {
      await t.test(`${reader}/${fault}`, () =>
        unit(async (paths, base) => {
          existing(paths);
          for (const [p, value] of memory) {
            value.mode = value.kind === 'directory' ? 0o700 : 0o600;
            value.uid = pathTrust.effectiveUid();
            if (p === '/') value.mode = 0o755;
          }
          const file =
            reader === 'operator' ? pathApi().join(base, 'operator.key') : paths.brokerLockFile;
          put(file, reader === 'operator' ? `hop_${token}\n` : raw, 'file', {
            mode: fault === 'mode' ? 0o640 : 0o600,
            uid: fault === 'uid' ? 99999 : pathTrust.effectiveUid(),
          });
          await assert.rejects(
            reader === 'operator'
              ? operator.loadOperatorKeyFile({ file, stateDir: paths.stateDir })
              : ownership.readSecureOwnership(file),
          );
          assert.equal(
            effects.some(
              ([name, p]) => p === file && ['readFile', 'handle.readFile'].includes(name),
            ),
            false,
          );
        }, 'linux'),
      );
    }
});

test('POSIX: operator and secure ownership creation still chmod their actual handles', async (t) => {
  for (const kind of ['operator', 'record'])
    await t.test(kind, () =>
      unit(async (paths, base) => {
        existing(paths);
        for (const value of memory.values()) {
          value.mode = value.kind === 'directory' ? 0o700 : 0o600;
          value.uid = pathTrust.effectiveUid();
        }
        const file =
          kind === 'operator' ? pathApi().join(base, 'operator.key') : paths.brokerLockFile;
        if (kind === 'operator') {
          const created = await operator.createOperatorKeyFile({ file, stateDir: paths.stateDir });
          assert.equal(
            (await operator.loadOperatorKeyFile({ file, stateDir: paths.stateDir })).keyId,
            created.keyId,
          );
        } else {
          const lock = await ownership.acquireStateOwnership({
            lockFile: file,
            port: 43189,
            channel,
          });
          assert.equal((await ownership.readSecureOwnership(file)).instance, lock.instance);
          assert.equal(await lock.release(), true);
        }
        assert.ok(
          effects.some(
            ([name, p, mode]) => name === 'handle.chmod' && p === file && mode === 0o600,
          ),
        );
        assert.equal(
          effects.some(([name]) => name === 'process'),
          false,
        );
      }, 'linux'),
    );
});

test('POSIX: removed Windows-only read snapshots do not add new POSIX permission gates', async () => {
  await unit(async (paths) => {
    existing(paths);
    assert.equal(await credentials.readLocalCredential(paths.controlCredentialFile), token);
    assert.equal((await store.loadPortableConfiguration(paths)).schema_version, 2);
    const journal = await Journal.open(paths.journalFile);
    try {
      assert.equal((await journal.append(mutations, { committedAt })).sequence, 1);
    } finally {
      await journal.close();
    }
    assert.equal(
      effects.some(([name]) => name === 'chmod' || name === 'handle.chmod'),
      false,
    );
  }, 'linux');
});

test('TOKEN: syntax, ordinary parsing and private memory input retain independent policy', async () => {
  await unit(async () => {
    for (const file of [
      'C:relative',
      '\\\\server\\share\\key',
      '\\\\?\\C:\\key',
      'C:\\safe\\NUL',
      'C:\\safe\\key:stream',
      'C:\\safe\\..\\key',
    ]) {
      assert.throws(() => credential.validateCredentialFileOption(file), {
        code: 'INVALID_ARGUMENT',
      });
      assert.throws(() => operator.validateOperatorKeyFileOption(file), {
        code: 'INVALID_ARGUMENT',
      });
    }
    assert.equal(credential.parseTokenInput(Buffer.from('SYNTHETIC\n')), 'SYNTHETIC');
    assert.equal(
      await credential.readTokenFromStdin(Readable.from([Buffer.from('SYNTHETIC\n')])),
      'SYNTHETIC',
    );
    assert.deepEqual(effects, []);
  });
});
