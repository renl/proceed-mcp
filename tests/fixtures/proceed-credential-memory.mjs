// TEST ONLY. Memory observations, not a protection model or production interface.
// All filesystem and child-process operations are replaced before product imports.
import assert from 'node:assert/strict';
import { mock, after } from 'node:test';
import { posix, win32 } from 'node:path';
import { Readable } from 'node:stream';

export const SECRET = 'SYNTHETIC_PRIVATE_TELEGRAM_VALUE';
export const ENV_NAME = 'PROCEED_TELEGRAM_BOT_TOKEN';
export async function memory(platform = 'linux') {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const environment = process.env;
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  process.env = {
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    // Preserve only Node's test-runner control marker, never ambient credentials.
    ...(environment.NODE_TEST_CONTEXT === undefined
      ? {}
      : { NODE_TEST_CONTEXT: environment.NODE_TEST_CONTEXT }),
  };
  after(() => {
    Object.defineProperty(process, 'platform', descriptor);
    process.env = environment;
  });
  const path = platform === 'win32' ? win32 : posix;
  const root = platform === 'win32' ? 'C:\\' : '/';
  const home = path.join(root, 'SyntheticHome');
  const stateDir = path.join(root, 'SyntheticState');
  const parent = path.join(home, 'PrivateCredentials');
  const file = path.join(parent, 'telegram.token');
  const packageRoot = path.join(root, 'SyntheticPackage');
  let s;
  const absent = () => Object.assign(new Error('absent memory entry'), { code: 'ENOENT' });
  const collision = () => Object.assign(new Error('memory collision'), { code: 'EEXIST' });
  let nextIdentity = 100;
  function info(kind, overrides = {}) {
    return {
      dev: 1,
      ino: nextIdentity++,
      nlink: 1,
      size: 0,
      uid: typeof process.geteuid === 'function' ? process.geteuid() : null,
      mode: kind === 'file' ? 0o600 : 0o700,
      isFile: () => kind === 'file',
      isDirectory: () => kind === 'directory',
      isSymbolicLink: () => false,
      ...overrides,
    };
  }
  function add(name, kind = 'directory', overrides = {}) {
    const entry = { info: info(kind, overrides), bytes: Buffer.alloc(0) };
    s.entries.set(name, entry);
    return entry;
  }
  function reset(settings = {}) {
    s = { entries: new Map(), events: [], queries: [], ...settings };
    for (const name of [root, home, stateDir, parent, packageRoot]) add(name);
    // These opaque artifacts must remain byte-identical across setup/refusal.
    for (const name of ['pairing.json', 'owner.key', 'journal', 'broker.lock']) {
      const entry = add(path.join(stateDir, name), 'file');
      entry.bytes = Buffer.from(`retained-${name}`);
    }
    return s;
  }
  reset();
  const get = (name) => {
    const entry = s.entries.get(name);
    if (!entry) throw absent();
    return entry;
  };
  async function lstat(name) {
    s.events.push(['inspect', name]);
    const entry = get(name);
    const observed = { ...entry.info, size: entry.bytes.length };
    return s.inspect ? s.inspect(name, observed) : observed;
  }
  const fs = {
    lstat,
    stat: lstat,
    async realpath(name) {
      return name;
    },
    async mkdir(name) {
      s.events.push(['mkdir', name]);
      if (s.entries.has(name)) throw collision();
      get(path.dirname(name));
      add(name);
    },
    async readdir() {
      return [];
    },
    async chmod(name) {
      s.events.push(['chmod', name]);
    },
    async unlink(name) {
      s.events.push(['unlink', name]);
      s.entries.delete(name);
    },
    async open(name, flags) {
      s.events.push(['open', name, flags]);
      if (flags === 'wx') {
        if (s.race) {
          add(name, 'file').bytes = Buffer.from('racing-existing');
          throw collision();
        }
        if (s.entries.has(name)) throw collision();
        add(name, 'file');
      }
      const entry = get(name);
      return {
        async stat() {
          return s.openedInfo
            ? s.openedInfo(entry.info)
            : { ...entry.info, size: entry.bytes.length };
        },
        async chmod() {
          s.events.push(['handle-chmod', name]);
        },
        async writeFile(bytes) {
          s.events.push(['write', name]);
          if (s.writeFailure) {
            entry.info.ino++;
            throw new Error(SECRET);
          }
          entry.bytes = Buffer.from(bytes);
        },
        async sync() {
          s.events.push(['sync', name]);
          s.afterSync?.(entry);
        },
        async close() {
          s.events.push(['close', name]);
        },
        async readFile() {
          s.events.push(['read', name]);
          s.afterRead?.(entry);
          return Buffer.from(entry.bytes);
        },
        async read(buffer, offset = 0, length = buffer.length, position = 0) {
          s.events.push(['read', name, length]);
          const bytesRead = entry.bytes.copy(buffer, offset, position, position + length);
          s.afterRead?.(entry);
          return { bytesRead, buffer };
        },
      };
    },
  };
  for (const name of [
    'readFile',
    'writeFile',
    'rm',
    'rename',
    'appendFile',
    'truncate',
    'rmdir',
    'access',
  ])
    fs[name] = async () => {
      throw new Error(`unbound memory filesystem operation: ${name}`);
    };
  mock.module('node:fs/promises', { namedExports: fs });
  mock.module('node:path', { namedExports: { ...path, posix, win32 } });
  mock.module('node:os', { namedExports: { homedir: () => home } });
  const url = await import('node:url');
  const sourceRoot = new URL('../../', import.meta.url).href;
  mock.module('node:url', {
    namedExports: {
      ...url,
      fileURLToPath(value) {
        const relative = new URL(value).href.slice(sourceRoot.length);
        return path.join(packageRoot, ...relative.split('/'));
      },
    },
  });
  const account = 'S-1-5-21-100-200-300-1001';
  function report(target) {
    const entry = s.entries.get(target);
    if (!entry) return { path: target, status: 'absent', volume: null, object: null };
    return {
      path: target,
      status: 'present',
      volume: { root, drive_type: 'fixed', filesystem: 'NTFS', persistent_acls: true },
      object: {
        kind: entry.info.isFile() ? 'file' : 'directory',
        attributes: entry.info.isSymbolicLink() ? 0x400 : 0,
        owner_sid: account,
        control: 0x8004,
        dacl: 'present',
        aces: [{ type: 'allow', sid: account, mask: 0x001f01ff, flags: 3 }],
      },
    };
  }
  function execFile(executable, args, options, callback) {
    s.queries.push({ executable, args, options });
    const targets = options.env.PROCEED_ACL_TARGETS?.split('\n');
    let error = s.queryUnavailable ? new Error(SECRET) : null;
    let stdout = '';
    if (targets) {
      const entries = targets.map((target) => {
        s.events.push(['admit', target]);
        const entry = report(target);
        return s.metadata ? s.metadata(entry) : entry;
      });
      stdout = JSON.stringify({
        version: 1,
        account_sid: account,
        trusted_installer_sid: null,
        entries,
      });
    } else if (!executable.endsWith('icacls.exe')) error = new Error('unbound child operation');
    queueMicrotask(() => callback(error, stdout, ''));
    return { kill() {} };
  }
  execFile[Symbol.for('nodejs.util.promisify.custom')] = (...args) =>
    new Promise((resolve, reject) =>
      execFile(...args, (error, stdout, stderr) =>
        error ? reject(error) : resolve({ stdout, stderr }),
      ),
    );
  mock.module('node:child_process', {
    namedExports: {
      execFile,
      spawn() {
        throw new Error('unit forbids process spawn');
      },
    },
  });
  const store = await import('../../src/state/store.js');
  mock.module('../../src/state/store.js', {
    namedExports: {
      ...store,
      async loadPortableConfiguration() {
        s.events.push(['configuration']);
        if (s.noState) {
          const { blockedPrerequisite } = await import('../../src/errors.js');
          throw blockedPrerequisite('initialize state', 'STATE_NOT_INITIALIZED');
        }
        return { broker: { port: 12345 }, owners: [{ owner_id: 'unit_owner' }] };
      },
    },
  });
  mock.module('../../src/broker/portable-runtime.js', {
    namedExports: {
      startPortableRuntime() {
        throw new Error('unit forbids broker runtime');
      },
    },
  });
  function terminal(chunks = [SECRET, '\r'], settings = {}) {
    let delivered = false;
    const stream = new Readable({
      read() {
        s.events.push(['input']);
        if (delivered) return;
        delivered = true;
        queueMicrotask(() => {
          if (settings.onRead) return settings.onRead(stream);
          for (const chunk of chunks) stream.push(chunk === null ? null : Buffer.from(chunk));
        });
      },
    });
    stream.isTTY = settings.isTTY ?? true;
    stream.isRaw = settings.isRaw ?? false;
    stream.setRawMode = (value) => {
      s.events.push(['raw', value]);
      if (settings.rawUnavailable) throw new Error(SECRET);
      stream.isRaw = value;
      return stream;
    };
    return stream;
  }
  function snapshot() {
    return [...s.entries]
      .filter(([name]) => name.startsWith(`${stateDir}${path.sep}`))
      .map(([name, entry]) => [name, entry.bytes.toString('hex'), entry.info.ino]);
  }
  async function invoke({ stream = terminal(), args = [], stdinMode = false, env = {} } = {}) {
    let stdout = '',
      stderr = '';
    const before = snapshot();
    const listeners = stream.eventNames().map((name) => [name, stream.listenerCount(name)]);
    const originalRaw = stream.isRaw;
    const { run } = await import('../../src/cli/main.js');
    const code = await run(
      [
        'telegram',
        'provision',
        ...(stdinMode ? ['--token-stdin'] : []),
        '--state-dir',
        stateDir,
        '--telegram-token-file',
        s.destination ?? file,
        ...args,
      ],
      {
        stdin: stream,
        stdout: {
          write(value) {
            stdout += value;
          },
        },
        stderr: {
          isTTY: true,
          write(value) {
            stderr += value;
          },
        },
        env,
      },
    );
    assert.deepEqual(snapshot(), before, 'pairing, keys, journal and ownership remain unchanged');
    assert.ok(!`${stdout}${stderr}`.includes(SECRET), 'no token or raw exception disclosure');
    return { code, stdout, stderr, stream, originalRaw, listeners };
  }
  return {
    platform,
    path,
    root,
    home,
    stateDir,
    parent,
    file,
    packageRoot,
    reset,
    add,
    terminal,
    invoke,
    snapshot,
    get current() {
      return s;
    },
  };
}
