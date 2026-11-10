// Test-only observations and memory bindings, not a second admission model.
// Contract: enforce-windows-secret-protection/design.md, OS helper contract,
// JavaScript admission policy and Production integration inventory.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { win32, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

const processCalls = [];
const storageCalls = [];
let storageBindings = {};
let childReply = () => ({ error: unavailable() });
const rawFailure = 'SYNTHETIC-PRIVATE-ERROR-CONTENT';
// Pure path semantics are synthetic too, so Windows cases run unchanged on Linux.
mock.module('node:path', {
  namedExports: {
    win32,
    posix,
    sep: '\\',
    delimiter: ';',
    ...Object.fromEntries(
      [
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
      ].map((name) => [
        name,
        (...args) => (process.platform === 'win32' ? win32 : posix)[name](...args),
      ]),
    ),
  },
});
mock.module('node:os', { namedExports: { homedir: () => 'C:\\SyntheticHome' } });
function unavailable() {
  return Object.assign(new Error(rawFailure), { code: 'ENOENT', stderr: rawFailure });
}
function execFile(file, args, options, callback) {
  processCalls.push({ file, args, options });
  const result = childReply({ file, args, options });
  queueMicrotask(() => callback(result.error ?? null, result.stdout ?? '', result.stderr ?? ''));
  return { kill() {} };
}
// Match Node execFile's documented promisified {stdout, stderr} result.
execFile[Symbol.for('nodejs.util.promisify.custom')] = (...args) =>
  new Promise((resolve, reject) => {
    execFile(...args, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }),
    );
  });
mock.module('node:child_process', {
  namedExports: {
    execFile,
    spawn(file, args, options) {
      processCalls.push({ file, args, options });
      throw unavailable();
    },
  },
});
const forbiddenStorage =
  (name) =>
  async (...args) => {
    storageCalls.push({ name, args });
    if (Object.hasOwn(storageBindings, name)) return storageBindings[name](...args);
    throw new Error('Unit attempted unbound filesystem access');
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
    ].map((name) => [name, forbiddenStorage(name)]),
  ),
});
const protection = await import('../src/state/protection.js');
const credential = await import('../src/state/credential-file.js');
const pathTrust = await import('../src/state/path-trust.js');
const ownership = await import('../src/state/ownership.js');
const store = await import('../src/state/store.js');
const config = await import('../src/config/portable-config.js');
const localCredentials = await import('../src/state/credentials.js');
const ownerCredentials = await import('../src/state/owner-credentials.js');
const operatorKey = await import('../src/harness/operator-key.js');
const files = await import('../src/state/files.js');
const { Journal } = await import('../src/journal/journal.js');
const { parseStrictJson } = await import('../src/harness/helper-protocol.js');

function platform(name, body) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: name });
  return Promise.resolve()
    .then(body)
    .finally(() => {
      Object.defineProperty(process, 'platform', descriptor);
    });
}

function syntheticLaunchEnvironment(body) {
  const original = process.env;
  process.env = {
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    TEMP: 'SYNTHETIC-NOT-NEEDED',
    TMP: 'SYNTHETIC-NOT-NEEDED',
    PATH: 'SYNTHETIC-UNTRUSTED-PATH',
    PSModulePath: 'SYNTHETIC-UNTRUSTED-MODULES',
    NODE_OPTIONS: 'SYNTHETIC-UNTRUSTED-PRELOAD',
    PROCEED_TOKEN: 'SYNTHETIC-NOT-A-CREDENTIAL',
    PROCEED_TELEGRAM_BOT_TOKEN: 'SYNTHETIC-NOT-A-CREDENTIAL',
    proceed_telegram_bot_token: 'SYNTHETIC-NOT-A-CREDENTIAL',
    HTTPS_PROXY: 'SYNTHETIC-NOT-A-CREDENTIAL',
  };
  return Promise.resolve()
    .then(body)
    .finally(() => {
      process.env = original;
    });
}

test('WIN-NODE-LAUNCH: unavailable trusted runtime has stable secret-free refusal', async () => {
  await platform('win32', () =>
    syntheticLaunchEnvironment(async () => {
      processCalls.length = 0;
      storageCalls.length = 0;
      await assert.rejects(protection.verifyOwnerOnly(['C:\\synthetic\\state']), (error) => {
        assert.equal(error.code, 'PROTECTION_UNAVAILABLE');
        assert.equal(error.exitCode, 4);
        assert.ok(
          !error.message.includes(rawFailure),
          'raw child content never enters public error',
        );
        return true;
      });
      assert.equal(storageCalls.length, 0, 'no Node pathname storage fallback');
      assert.equal(
        processCalls.length,
        1,
        'unavailable runtime is not retried through alternatives',
      );
      const call = processCalls[0];
      const expected = win32.join(
        process.env.SystemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      assert.equal(
        call.file.toLowerCase(),
        expected.toLowerCase(),
        'absolute trusted inbox runtime',
      );
      for (const flag of ['-NoLogo', '-NoProfile', '-NonInteractive']) {
        assert.ok(call.args.includes(flag), `required fixed launch flag ${flag}`);
      }
      assert.ok(!call.args.some((arg) => /executionpolicy|bypass/i.test(arg)), 'no policy bypass');
      assert.notEqual(call.options.shell, true, 'no shell routing');
    }),
  );
});

test('WIN-NODE-ENV: child receives only explicit trusted environment', async () => {
  await platform('win32', () =>
    syntheticLaunchEnvironment(async () => {
      processCalls.length = 0;
      await assert.rejects(protection.verifyOwnerOnly(['C:\\synthetic\\state']));
      assert.equal(processCalls.length, 1);
      const child = processCalls[0].options.env;
      assert.ok(child && child !== process.env, 'explicit environment object');
      const permitted = new Set(['SYSTEMROOT', 'WINDIR', 'PROCEED_ACL_TARGETS']);
      assert.deepEqual(
        Object.keys(child).filter((name) => !permitted.has(name.toUpperCase())),
        [],
        'no PATH, module, preload, proxy, temporary-directory or credential environment',
      );
      assert.ok(Object.keys(child).some((name) => name.toUpperCase() === 'SYSTEMROOT'));
    }),
  );
});

test('WIN-NODE-SYNTAX: unsupported Windows paths refused before storage/private access', async () => {
  await platform('win32', async () => {
    for (const path of [
      'C:relative',
      '\\\\server\\share\\token',
      '\\\\?\\C:\\safe\\token',
      'C:\\safe\\..\\token',
      'C:\\safe\\.\\token',
      'C:\\safe\\token.',
      'C:\\safe\\token ',
      'C:\\safe\\NUL',
      'C:\\safe\\token:stream',
      'C:\\safe\\token\0',
      'C:\\safe\\token\n',
    ]) {
      assert.throws(() => credential.validateCredentialFileOption(path), {
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
      });
    }
  });
});

test('WIN-NODE-COMPAT: Windows default credential key/location and token grammar retained', async () => {
  await platform('win32', async () => {
    const stateDir = 'C:\\Synthetic\\State';
    const expected = createHash('sha256').update('c:/synthetic/state').digest('hex');
    assert.equal(credential.stateKey(stateDir), expected);
    // Mocked pure path semantics, no host home lookup.
    assert.equal(
      credential.defaultCredentialFile({ stateDir, home: 'C:\\SyntheticHome' }),
      win32.join('C:\\SyntheticHome', '.proceed-mcp-credentials', expected, 'telegram.token'),
    );
    for (const ending of ['', '\n', '\r\n']) {
      assert.equal(credential.parseTokenInput(Buffer.from(`SYNTHETIC${ending}`)), 'SYNTHETIC');
    }
    assert.equal(credential.parseTokenInput(Buffer.from('A'.repeat(4096))).length, 4096);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from('A'.repeat(4097)),
      Buffer.from('A B'),
      Buffer.from('A\nB'),
      Buffer.from([0xef, 0xbb, 0xbf, 65]),
      Buffer.from([0, 65]),
    ]) {
      assert.throws(() => credential.parseTokenInput(bytes), { code: 'INVALID_ARGUMENT' });
    }
  });
});

test('WIN-NODE-INPUT: synthetic memory stdin is bounded and never uses process/storage', async () => {
  const beforeProcesses = processCalls.length;
  const beforeStorage = storageCalls.length;
  assert.equal(
    await credential.readTokenFromStdin(Readable.from([Buffer.from('SYNTHETIC\r\n')])),
    'SYNTHETIC',
  );
  await assert.rejects(credential.readTokenFromStdin({ isTTY: true }), {
    code: 'INVALID_ARGUMENT',
  });
  await assert.rejects(credential.readTokenFromStdin(Readable.from([Buffer.alloc(4099, 65)])), {
    code: 'INVALID_ARGUMENT',
  });
  assert.equal(processCalls.length, beforeProcesses);
  assert.equal(storageCalls.length, beforeStorage);
});

test('WIN-NODE-CONFIG: unavailable native protection prevents configuration byte read', async () => {
  await platform('win32', () =>
    syntheticLaunchEnvironment(async () => {
      let reads = 0;
      storageBindings = {
        readFile: () => {
          reads++;
          return JSON.stringify(config.createEmptyConfig());
        },
      };
      try {
        let failure;
        try {
          await store.loadPortableConfiguration({
            stateDir: 'C:\\SyntheticState',
            configFile: 'C:\\SyntheticState\\config.json',
          });
        } catch (error) {
          failure = error;
        }
        assert.equal(reads, 0, 'configuration may not select authority before native admission');
        assert.equal(failure?.code, 'PROTECTION_UNAVAILABLE');
        assert.equal(failure?.exitCode, 4);
      } finally {
        storageBindings = {};
      }
    }),
  );
});

test('WIN-NODE-OWNERSHIP: unavailable protection preserves existing lock without reading PSK', async () => {
  await platform('win32', () =>
    syntheticLaunchEnvironment(async () => {
      const path = 'C:\\SyntheticState\\broker.lock';
      const record = Buffer.from(
        JSON.stringify({
          schema_version: 2,
          instance: 'a'.repeat(32),
          pid: 1234,
          port: 43189,
          started_at: '2026-11-10T00:00:00.000Z',
          channel: { protocol: 'tls-psk-v1', psk: 'b'.repeat(64) },
        }),
      );
      let reads = 0;
      let deletes = 0;
      const info = (file) => ({
        dev: 1,
        ino: file === path ? 2 : 1,
        size: file === path ? record.length : 0,
        nlink: 1,
        mode: file === path ? 0o600 : 0o700,
        isSymbolicLink: () => false,
        isFile: () => file === path,
        isDirectory: () => file !== path,
      });
      storageBindings = {
        lstat: (file) => info(file),
        open: (file) => ({
          stat: async () => info(file),
          readFile: async () => {
            reads++;
            return record;
          },
          close: async () => {},
        }),
        readFile: () => {
          reads++;
          return record;
        },
        unlink: () => {
          deletes++;
        },
        rm: () => {
          deletes++;
        },
      };
      try {
        let failure;
        try {
          await ownership.readSecureOwnership(path);
        } catch (error) {
          failure = error;
        }
        assert.equal(reads, 0, 'unverified lock never discloses persisted channel key');
        assert.equal(deletes, 0, 'existing ownership is never removed for admission');
        assert.equal(
          failure?.code,
          'BROKER_INSTANCE_CONFLICT',
          'protection refusal keeps secure conflict mapping',
        );
        assert.ok(!failure.message.includes(record.toString()), 'secret-free public error');
      } finally {
        storageBindings = {};
      }
    }),
  );
});

test('WIN-NODE-COMPAT: POSIX ancestor decisions unchanged without host filesystem', async () => {
  await platform('linux', () => {
    assert.equal(pathTrust.ancestorProtects({ mode: 0o755, uid: 0 }), true);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o777, uid: 0 }), false);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o1777, uid: 0 }), true);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o1777, uid: 999999 }), false);
  });
});

// Supporting primitive coverage only. Query decoder wiring is tested below
// through verifyOwnerOnly, not inferred from this primitive's existence.
test('WIN-NODE-JSON: actual shared strict JSON refuses malformed/duplicate/BOM bytes', () => {
  for (const bytes of [
    Buffer.from('{"v":1,"v":2}'),
    Buffer.from('{"v":1,"\\u0076":2}'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from([0xef, 0xbb, 0xbf, 123, 125]),
    Buffer.from('{}{}'),
  ]) {
    assert.throws(() => parseStrictJson(bytes));
  }
  assert.deepEqual(parseStrictJson(Buffer.from('{"v":1}')), { v: 1 });
});

// Synthetic observations use the exact normalized boundary, not vendor display
// strings or helper-approved booleans. Only production evaluates their safety.
const account = 'S-1-5-21-100-200-300-1001';
const foreign = 'S-1-5-21-100-200-300-1002';
const target = 'C:\\SyntheticState';
const full = 0x001f01ff;
function ace(mask = full, flags = 0, sid = account) {
  return { type: 'allow', sid, mask, flags };
}
function observation(path) {
  return {
    path,
    status: 'present',
    volume: { root: 'C:\\', drive_type: 'fixed', filesystem: 'NTFS', persistent_acls: true },
    object: {
      kind: /\.(json|token|key|lock|journal)$/.test(path) ? 'file' : 'directory',
      attributes: 0,
      owner_sid: account,
      control: 0x8004,
      dacl: 'present',
      aces: [ace()],
    },
  };
}
function metadata(paths) {
  return {
    version: 1,
    account_sid: account,
    trusted_installer_sid: null,
    entries: paths.map(observation),
  };
}
function memoryInfo(path) {
  const file = /\.(json|token|key|lock|journal)$/.test(path);
  return {
    dev: 1,
    ino: 2,
    nlink: 1,
    size: 65,
    mode: file ? 0o600 : 0o700,
    uid: typeof process.geteuid === 'function' ? process.geteuid() : 0,
    isSymbolicLink: () => false,
    isFile: () => file,
    isDirectory: () => !file,
  };
}
async function windowsUnit(body, transform = (value) => value) {
  return platform('win32', () =>
    syntheticLaunchEnvironment(async () => {
      processCalls.length = 0;
      storageCalls.length = 0;
      storageBindings = {
        stat: memoryInfo,
        realpath: (path) => path,
        lstat: (path) => {
          if (
            path.endsWith('\\.git') ||
            path.includes('\\.config') ||
            path.includes('\\.opencode')
          ) {
            throw Object.assign(new Error('absent marker'), { code: 'ENOENT' });
          }
          return memoryInfo(path);
        },
      };
      childReply = ({ options }) => {
        const paths = options.env.PROCEED_ACL_TARGETS?.split('\n') ?? [];
        const value = transform(metadata(paths), paths);
        return { stdout: typeof value === 'string' ? value : JSON.stringify(value) };
      };
      try {
        return await body();
      } finally {
        storageBindings = {};
        childReply = () => ({ error: unavailable() });
      }
    }),
  );
}
function unverified(error) {
  assert.equal(error.code, 'PROTECTION_UNVERIFIED');
  assert.equal(error.exitCode, 4);
  assert.ok(!error.message.includes(rawFailure));
  assert.ok(!error.message.includes(account));
  return true;
}

test('WIN-METADATA: complete safe observations admit, root first and child only after parent', async () => {
  await windowsUnit(async () => {
    await protection.verifyOwnerOnly([target]);
    const queries = processCalls.map(({ options }) => options.env.PROCEED_ACL_TARGETS.split('\n'));
    assert.equal(queries[0][0].toLowerCase(), 'c:\\');
    assert.ok(
      queries.findIndex((paths) => paths.includes(target)) > 0,
      'do not query a descendant before its parent has been admitted',
    );
    assert.ok(processCalls.every(({ options }) => options.timeout > 0 && options.timeout <= 19000));
    assert.ok(processCalls.every(({ options }) => options.maxBuffer === 256 * 1024));
  });
});

const unsafeObjects = [
  [
    'missing DACL',
    (o) => {
      delete o.dacl;
    },
  ],
  [
    'absent DACL',
    (o) => {
      o.dacl = 'absent';
      o.aces = [];
      o.control = 0x8000;
    },
  ],
  [
    'null DACL',
    (o) => {
      o.dacl = 'null';
      o.aces = [];
    },
  ],
  [
    'empty DACL',
    (o) => {
      o.aces = [];
    },
  ],
  [
    'unresolved owner',
    (o) => {
      o.owner_sid = null;
    },
  ],
  [
    'foreign owner',
    (o) => {
      o.owner_sid = foreign;
    },
  ],
  [
    'insufficient access',
    (o) => {
      o.aces = [ace(0x120089)];
    },
  ],
  [
    'inherit-only access',
    (o) => {
      o.aces = [ace(full, 8)];
    },
  ],
  [
    'foreign allow',
    (o) => {
      o.aces.push(ace(1, 0, foreign));
    },
  ],
  [
    'deny',
    (o) => {
      o.aces.push({ ...ace(), type: 'deny' });
    },
  ],
  ...['object', 'conditional', 'unknown'].map((type) => [
    type,
    (o) => {
      o.aces.push({ type, sid: null, mask: null, flags: 0 });
    },
  ]),
  [
    'unresolved ACE',
    (o) => {
      o.aces[0].sid = null;
    },
  ],
  [
    'unknown flags',
    (o) => {
      o.aces[0].flags = 32;
    },
  ],
  [
    'negative mask',
    (o) => {
      o.aces[0].mask = -1;
    },
  ],
  [
    'contradictory DACL control',
    (o) => {
      o.control = 0x8000;
    },
  ],
  [
    'reparse attribute',
    (o) => {
      o.attributes = 0x400;
    },
  ],
  [
    'unsupported type',
    (o) => {
      o.kind = 'unsupported';
    },
  ],
];
test('WIN-POLICY: unsafe dedicated descriptors refuse without mutation', async (t) => {
  for (const [name, mutate] of unsafeObjects)
    await t.test(name, async () => {
      await windowsUnit(
        async () => {
          await assert.rejects(protection.verifyOwnerOnly([target]), unverified);
          assert.ok(
            !storageCalls.some(({ name }) =>
              ['chmod', 'mkdir', 'unlink', 'rm', 'writeFile'].includes(name),
            ),
          );
        },
        (value) => {
          for (const entry of value.entries)
            if (entry.path.toLowerCase() === target.toLowerCase()) mutate(entry.object);
          return value;
        },
      );
    });
});

test('WIN-POLICY: inherited self full access and generic-all remain admissible', async (t) => {
  for (const [name, grant] of [
    ['inherited', ace(full, 16)],
    ['generic-all', ace(0x10000000)],
  ]) {
    await t.test(name, () =>
      windowsUnit(
        () => protection.verifyOwnerOnly([target]),
        (value) => {
          for (const entry of value.entries) entry.object.aces = [grant];
          return value;
        },
      ),
    );
  }
});

test('WIN-DECODER: malformed, partial and uncorrelated observations refuse', async (t) => {
  const cases = [
    ['empty output', () => ''],
    ['malformed output', () => '{'],
    ['trailing output', (v) => `${JSON.stringify(v)}{}`],
    [
      'duplicate member',
      (v) => JSON.stringify(v).replace('"version":1', '"version":1,"version":1'),
    ],
    ['legacy approval report', (v) => v.entries.map(({ path }) => ({ path, ok: true }))],
    ['unknown version', (v) => ({ ...v, version: 2 })],
    ['missing entries', (v) => ({ ...v, entries: [] })],
    ['extra entries', (v) => ({ ...v, entries: [...v.entries, v.entries[0]] })],
    [
      'wrong target',
      (v) => {
        v.entries[0].path = 'C:\\Unrelated';
        return v;
      },
    ],
    [
      'partial target',
      (v) => {
        v.entries[0].path += '\\extra';
        return v;
      },
    ],
    [
      'unavailable',
      (v) => {
        v.entries[0] = {
          path: v.entries[0].path,
          status: 'unavailable',
          volume: null,
          object: null,
        };
        return v;
      },
    ],
    [
      'unproved absence',
      (v) => {
        v.entries[0] = { path: v.entries[0].path, status: 'absent', volume: null, object: null };
        return v;
      },
    ],
    ['unknown field', (v) => ({ ...v, approved: true })],
    [
      'nonarray ACEs',
      (v) => {
        v.entries[0].object.aces = {};
        return v;
      },
    ],
    ['unresolved process identity', (v) => ({ ...v, account_sid: 'operator' })],
    ...['drive_type', 'filesystem', 'persistent_acls'].map((field) => [
      field,
      (v) => {
        v.entries[0].volume[field] = {
          drive_type: 'unsupported',
          filesystem: 'FAT32',
          persistent_acls: false,
        }[field];
        return v;
      },
    ]),
  ];
  for (const [name, transform] of cases)
    await t.test(name, () =>
      windowsUnit(
        () => assert.rejects(protection.verifyOwnerOnly([target]), unverified),
        transform,
      ),
    );
});

test('WIN-ANCESTRY: ordinary creation-only rights differ from replacement/mutation', async (t) => {
  for (const [name, mask, allowed] of [
    ['read and traverse', 0x1200a9, true],
    ['add children only', 6, true],
    ['delete child', 0x40, false],
    ['write DACL', 0x40000, false],
    ['write owner', 0x80000, false],
    ['delete selected component', 0x10000, false],
    ['write EA', 0x10, false],
    ['write attributes', 0x100, false],
    ['generic write', 0x40000000, false],
    ['generic all', 0x10000000, false],
  ])
    await t.test(name, () =>
      windowsUnit(
        async () => {
          const operation = protection.verifyOwnerOnly([target]);
          if (allowed) await operation;
          else await assert.rejects(operation, unverified);
        },
        (value) => {
          for (const entry of value.entries)
            if (entry.path.toLowerCase() === 'c:\\') {
              entry.object.owner_sid = 'S-1-5-18';
              entry.object.aces.push(ace(mask, 0, foreign));
            }
          return value;
        },
      ),
    );
});

test('WIN-ROOT: rejected root prevents descendant query or content access', async () => {
  await windowsUnit(
    async () => {
      await assert.rejects(protection.verifyOwnerOnly([target]), unverified);
      assert.equal(processCalls.length, 1);
      assert.equal(processCalls[0].options.env.PROCEED_ACL_TARGETS, 'C:\\');
      assert.equal(
        storageCalls.filter(({ name }) => ['open', 'readFile', 'writeFile'].includes(name)).length,
        0,
      );
    },
    (value) => {
      value.entries[0].object.attributes = 0x400;
      return value;
    },
  );
});

test('WIN-HELPER: restrictive process policy preserved and launch output redacted', async (t) => {
  await t.test('process restriction', () =>
    windowsUnit(async () => {
      process.env.PSExecutionPolicyPreference = 'AllSigned';
      await protection.verifyOwnerOnly([target]);
      assert.ok(
        processCalls.every(
          ({ options }) => options.env.PSExecutionPolicyPreference === 'AllSigned',
        ),
      );
    }),
  );
  for (const [name, result] of [
    ['stderr on success', { stdout: '[]', stderr: rawFailure }],
    ['nonzero', { error: Object.assign(new Error(rawFailure), { code: 1, stderr: rawFailure }) }],
    ['timeout', { error: Object.assign(new Error(rawFailure), { killed: true }) }],
    [
      'overflow',
      {
        error: Object.assign(new Error(rawFailure), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
      },
    ],
  ])
    await t.test(name, () =>
      windowsUnit(async () => {
        childReply = () => result;
        await assert.rejects(protection.verifyOwnerOnly([target]), (error) => {
          assert.equal(error.exitCode, 4);
          assert.equal(error.code, 'PROTECTION_UNAVAILABLE');
          assert.ok(!error.message.includes(rawFailure));
          assert.equal(error.cause, undefined, 'raw child exception is not published');
          return true;
        });
        assert.equal(processCalls.length, 1, 'no weaker retry');
      }),
    );
});

test('WIN-HELPER: ambiguous OS environment refuses before launch', async (t) => {
  for (const override of [
    { SystemRoot: '' },
    { SystemRoot: 'relative' },
    { WINDIR: 'C:\\OtherWindows' },
    { SYSTEMROOT: 'C:\\OtherWindows' },
    { PSExecutionPolicyPreference: 'unknown' },
  ])
    await t.test(JSON.stringify(override), () =>
      windowsUnit(async () => {
        Object.assign(process.env, override);
        await assert.rejects(protection.verifyOwnerOnly([target]), {
          code: 'PROTECTION_UNAVAILABLE',
        });
        assert.equal(processCalls.length, 0);
      }),
    );
});

test('WIN-CALLERS: shared local and owner credential readers guard before bytes', async (t) => {
  for (const [name, read] of [
    ['control', () => localCredentials.readLocalCredential(`${target}\\control.token`)],
    ['owner', () => ownerCredentials.readOwnerCredential(`${target}\\owner.test.token`, 'test')],
    [
      'operator',
      () =>
        operatorKey.loadOperatorKeyFile({ file: 'C:\\Operator\\operator.key', stateDir: target }),
    ],
  ])
    await t.test(name, () =>
      windowsUnit(async () => {
        childReply = () => ({ error: unavailable() });
        let reads = 0;
        storageBindings.readFile = () => {
          reads++;
          return `${'a'.repeat(64)}\n`;
        };
        storageBindings.open = (path) => ({
          stat: async () => memoryInfo(path),
          close: async () => {},
          readFile: async () => {
            reads++;
            return Buffer.from(`hop_${'a'.repeat(64)}\n`);
          },
        });
        storageBindings.realpath = (path) => path;
        const normalInfo = storageBindings.lstat;
        storageBindings.lstat = (path) => {
          if (
            path.endsWith('\\.git') ||
            path.includes('\\.config') ||
            path.includes('\\.opencode')
          ) {
            throw Object.assign(new Error('absent marker'), { code: 'ENOENT' });
          }
          return normalInfo(path);
        };
        let error;
        try {
          await read();
        } catch (caught) {
          error = caught;
        }
        assert.equal(reads, 0, 'no secret read before Windows admission');
        assert.equal(error?.code, 'PROTECTION_UNAVAILABLE');
      }),
    );
});

test('WIN-CREATE: new owner credential and atomic sibling verify inheritance before secret writes', async (t) => {
  for (const [name, write] of [
    ['owner', () => ownerCredentials.writeOwnerCredential(`${target}\\owner.test.token`)],
    ['atomic sibling', () => files.writeFileAtomically(`${target}\\config.json`, rawFailure)],
  ])
    await t.test(name, () =>
      windowsUnit(
        async () => {
          let writes = 0;
          storageBindings.open = (path) => ({
            stat: async () => memoryInfo(path),
            close: async () => {},
            writeFile: async () => {
              writes++;
            },
            sync: async () => {},
          });
          storageBindings.rename = () => {};
          storageBindings.unlink = () => {};
          await assert.rejects(write());
          assert.equal(writes, 0, 'unverified inherited empty file receives no secret bytes');
        },
        (value) => {
          for (const entry of value.entries) if (entry.path !== 'C:\\') entry.object.aces = [];
          return value;
        },
      ),
    );
});

test('WIN-PRESERVE: directory collision never repairs an existing object', async () => {
  await windowsUnit(async () => {
    storageBindings.mkdir = () => {
      throw Object.assign(new Error('collision'), { code: 'EEXIST' });
    };
    await protection.createProtectedDirectory(target);
    assert.equal(processCalls.filter(({ file }) => /icacls/i.test(file)).length, 0);
    assert.ok(!processCalls.some(({ options }) => options.env.PROCEED_ACL_MODE === 'protect'));
    assert.ok(!storageCalls.some(({ name }) => ['chmod', 'rm', 'unlink'].includes(name)));
  });
});

test('WIN-PRESERVE: inode equality alone never authorizes uncertain Windows cleanup', async () => {
  await windowsUnit(async () => {
    storageBindings.unlink = () => {};
    const removed = await pathTrust.removeExactCreated(`${target}\\owner.test.token`, {
      dev: 1,
      ino: 2,
    });
    assert.equal(removed, false);
    assert.ok(!storageCalls.some(({ name }) => name === 'unlink'));
  });
});

test('WIN-PRESERVE: init with unknown entries refuses without config read or rollback', async () => {
  await windowsUnit(async () => {
    let reads = 0;
    storageBindings.readdir = () => ['unknown-entry'];
    storageBindings.readFile = () => {
      reads++;
      throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    };
    await assert.rejects(
      store.initializeState({ stateDir: target, configFile: `${target}\\config.json` }),
      { code: 'STATE_ALREADY_INITIALIZED' },
    );
    assert.equal(reads, 0, 'inspect protected emptiness before parsing configuration');
    assert.ok(!storageCalls.some(({ name }) => ['open', 'rm', 'unlink', 'mkdir'].includes(name)));
  });
});

test('WIN-TOKEN: unsupported selected file refuses before opening contents', async () => {
  await windowsUnit(async () => {
    let reads = 0;
    storageBindings.open = () => {
      reads++;
      throw unavailable();
    };
    await assert.rejects(
      credential.loadCredentialFile({ file: 'C:\\Tokens\\telegram.token', stateDir: target }),
    );
    assert.equal(reads, 0);
  });
});

test('WIN-JOURNAL: admission failure precedes replay, truncation or append open', async () => {
  await windowsUnit(async () => {
    childReply = () => ({ error: unavailable() });
    let reads = 0;
    let opens = 0;
    storageBindings.readFile = () => {
      reads++;
      return Buffer.alloc(0);
    };
    storageBindings.open = () => {
      opens++;
      throw new Error('unadmitted journal open');
    };
    let failure;
    try {
      await Journal.open(`${target}\\events.journal`);
    } catch (error) {
      failure = error;
    }
    assert.equal(opens, 0, 'no mutable open before protection');
    assert.equal(reads, 0);
    assert.equal(failure?.code, 'PROTECTION_UNAVAILABLE');
  });
});

test('WIN-PRESERVE: create-only owner and secure lock collisions never read or overwrite', async (t) => {
  for (const [name, create] of [
    ['owner', () => ownerCredentials.writeOwnerCredential(`${target}\\owner.test.token`)],
    [
      'lock',
      () =>
        ownership.acquireStateOwnership({
          lockFile: `${target}\\broker.lock`,
          port: 43189,
          channel: { protocol: 'tls-psk-v1', psk: 'b'.repeat(64) },
        }),
    ],
  ])
    await t.test(name, () =>
      windowsUnit(async () => {
        storageBindings.open = () => {
          throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        };
        await assert.rejects(create(), {
          code: name === 'owner' ? 'OWNER_ALREADY_CONFIGURED' : 'STATE_NOT_OWNED',
        });
        assert.ok(
          !storageCalls.some(({ name }) =>
            ['readFile', 'unlink', 'rm', 'writeFile', 'rename'].includes(name),
          ),
        );
      }),
    );
});

test('WIN-INHERITANCE: prospective foreign child mutation refuses before mkdir', async () => {
  await windowsUnit(
    async () => {
      let creates = 0;
      storageBindings.mkdir = () => {
        creates++;
      };
      await assert.rejects(protection.createProtectedDirectory(`${target}\\new`), unverified);
      assert.equal(creates, 0);
    },
    (value) => {
      for (const entry of value.entries) entry.object.aces.push(ace(0x40000, 3, foreign));
      return value;
    },
  );
});

test('WIN-INHERITANCE: new dedicated directory must provide effective full child inheritance', async (t) => {
  for (const [name, flags] of [
    ['no inheritance', 0],
    ['inherit-only gap', 11],
    ['no-propagate gap', 7],
  ]) {
    await t.test(name, () =>
      windowsUnit(
        async () => {
          storageBindings.mkdir = () => {};
          await assert.rejects(
            protection.createProtectedDirectory(target, { inheritsProtection: true }),
            unverified,
          );
        },
        (value) => {
          for (const entry of value.entries)
            if (entry.path.toLowerCase() === target.toLowerCase()) {
              entry.object.aces = [ace(full, flags)];
            }
          return value;
        },
      ),
    );
  }
});

test('WIN-RECHECK: changed protection after read discards local credential result', async () => {
  let read = false;
  await windowsUnit(
    async () => {
      const bytes = `${'a'.repeat(64)}\n`;
      storageBindings.readFile = () => {
        read = true;
        return bytes;
      };
      storageBindings.open = (path) => ({
        stat: async () => memoryInfo(path),
        close: async () => {},
        readFile: async () => {
          read = true;
          return Buffer.from(bytes);
        },
      });
      await assert.rejects(
        localCredentials.readLocalCredential(`${target}\\control.token`),
        unverified,
      );
      assert.equal(read, true, 'this case reaches the read before failed re-observation');
    },
    (value) => {
      if (read) for (const entry of value.entries) entry.object.aces = [];
      return value;
    },
  );
});

test('WIN-QUERY: empty request is local no-op and target order/case is exact', async (t) => {
  await t.test('empty', () =>
    windowsUnit(async () => {
      await protection.verifyOwnerOnly([]);
      assert.equal(processCalls.length, 0);
    }),
  );
  await t.test('case-insensitive echo', () =>
    windowsUnit(
      () => protection.verifyOwnerOnly([target]),
      (value) => {
        for (const entry of value.entries) entry.path = entry.path.toLowerCase();
        return value;
      },
    ),
  );
  await t.test('reversed entries', () =>
    windowsUnit(
      async () => {
        await assert.rejects(
          protection.verifyOwnerOnly([`${target}\\control.token`, `${target}\\owner.test.token`]),
          unverified,
        );
      },
      (value) => {
        value.entries.reverse();
        return value;
      },
    ),
  );
});
