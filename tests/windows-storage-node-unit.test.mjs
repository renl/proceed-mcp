// Test-only memory bindings. Never launch the production worker or touch state.
// Contract: enforce-windows-secret-protection/design.md sections 5-7 and Unit seam.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

const processCalls = [];
const storageCalls = [];
let storageBindings = {};
const rawFailure = 'SYNTHETIC-PRIVATE-ERROR-CONTENT';
// Module mocks replace both old and replacement launch paths. No actual process
// binding is reachable. Failure injection proves launcher/mapping decisions, not
// a working native worker or successful pipe exchange.
function unavailable() {
  return Object.assign(new Error(rawFailure), { code: 'ENOENT', stderr: rawFailure });
}
mock.module('node:child_process', {
  namedExports: {
    execFile(file, args, options, callback) {
      processCalls.push({ file, args, options });
      queueMicrotask(() => callback(unavailable()));
      return { kill() {} };
    },
    spawn(file, args, options) {
      processCalls.push({ file, args, options });
      throw unavailable();
    },
  },
});
const forbiddenStorage = (name) => async (...args) => {
  storageCalls.push({ name, args });
  if (Object.hasOwn(storageBindings, name)) return storageBindings[name](...args);
  throw new Error('Unit attempted unbound filesystem access');
};
mock.module('node:fs/promises', {
  namedExports: Object.fromEntries(
    [
      'chmod', 'mkdir', 'stat', 'lstat', 'open', 'realpath', 'readFile', 'writeFile',
      'unlink', 'rm', 'rename', 'readdir', 'access', 'rmdir', 'appendFile', 'truncate',
    ].map((name) => [name, forbiddenStorage(name)]),
  ),
});
const protection = await import('../src/state/protection.js');
const credential = await import('../src/state/credential-file.js');
const pathTrust = await import('../src/state/path-trust.js');
const ownership = await import('../src/state/ownership.js');
const store = await import('../src/state/store.js');
const config = await import('../src/config/portable-config.js');
const { parseStrictJson } = await import('../src/harness/helper-protocol.js');

function platform(name, body) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: name });
  return Promise.resolve().then(body).finally(() => {
    Object.defineProperty(process, 'platform', descriptor);
  });
}

function syntheticLaunchEnvironment(body) {
  const original = process.env;
  process.env = {
    SystemRoot: original.SystemRoot,
    WINDIR: original.WINDIR ?? original.SystemRoot,
    TEMP: 'C:\\SyntheticCompiler',
    TMP: 'C:\\SyntheticCompiler',
    PATH: 'SYNTHETIC-UNTRUSTED-PATH',
    PSModulePath: 'SYNTHETIC-UNTRUSTED-MODULES',
    NODE_OPTIONS: 'SYNTHETIC-UNTRUSTED-PRELOAD',
    PROCEED_TOKEN: 'SYNTHETIC-NOT-A-CREDENTIAL',
  };
  return Promise.resolve().then(body).finally(() => { process.env = original; });
}

test('WIN-NODE-LAUNCH: unavailable trusted runtime has stable secret-free refusal', async () => {
  await platform('win32', () => syntheticLaunchEnvironment(async () => {
    processCalls.length = 0;
    storageCalls.length = 0;
    await assert.rejects(protection.verifyOwnerOnly(['C:\\synthetic\\state']), (error) => {
      assert.equal(error.code, 'PROTECTION_UNAVAILABLE');
      assert.equal(error.exitCode, 4);
      assert.ok(!error.message.includes(rawFailure), 'raw child content never enters public error');
      return true;
    });
    assert.equal(storageCalls.length, 0, 'no Node pathname storage fallback');
    assert.equal(processCalls.length, 1, 'unavailable runtime is not retried through alternatives');
    const call = processCalls[0];
    const expected = win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    assert.equal(call.file.toLowerCase(), expected.toLowerCase(), 'absolute trusted inbox runtime');
    for (const flag of ['-NoLogo', '-NoProfile', '-NonInteractive']) {
      assert.ok(call.args.includes(flag), `required fixed launch flag ${flag}`);
    }
    assert.ok(!call.args.some((arg) => /executionpolicy|bypass/i.test(arg)), 'no policy bypass');
    assert.notEqual(call.options.shell, true, 'no shell routing');
  }));
});

test('WIN-NODE-ENV: child receives only explicit trusted environment', async () => {
  await platform('win32', () => syntheticLaunchEnvironment(async () => {
    processCalls.length = 0;
    await assert.rejects(protection.verifyOwnerOnly(['C:\\synthetic\\state']));
    assert.equal(processCalls.length, 1);
    const child = processCalls[0].options.env;
    assert.ok(child && child !== process.env, 'explicit environment object');
    const permitted = new Set(['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);
    assert.deepEqual(Object.keys(child).filter((name) => !permitted.has(name.toUpperCase())), [],
      'no PATH, module, preload, proxy, target or credential environment');
    assert.ok(Object.keys(child).some((name) => name.toUpperCase() === 'SYSTEMROOT'));
  }));
});

test('WIN-NODE-SYNTAX: unsupported Windows paths refused before storage/private access', async () => {
  await platform('win32', async () => {
    for (const path of [
      'C:relative', '\\\\server\\share\\token', '\\\\?\\C:\\safe\\token',
      'C:\\safe\\..\\token', 'C:\\safe\\.\\token', 'C:\\safe\\token.',
      'C:\\safe\\token ', 'C:\\safe\\NUL', 'C:\\safe\\token:stream',
      'C:\\safe\\token\0', 'C:\\safe\\token\n',
    ]) {
      assert.throws(() => credential.validateCredentialFileOption(path),
        { code: 'INVALID_ARGUMENT', exitCode: 2 });
    }
  });
});

test('WIN-NODE-COMPAT: Windows default credential key/location and token grammar retained', async () => {
  await platform('win32', async () => {
    const stateDir = 'C:\\Synthetic\\State';
    const expected = createHash('sha256').update('c:/synthetic/state').digest('hex');
    assert.equal(credential.stateKey(stateDir), expected);
    // On this Windows runner, path module uses Windows semantics. No home lookup.
    assert.equal(credential.defaultCredentialFile({ stateDir, home: 'C:\\SyntheticHome' }),
      win32.join('C:\\SyntheticHome', '.proceed-mcp-credentials', expected, 'telegram.token'));
    for (const ending of ['', '\n', '\r\n']) {
      assert.equal(credential.parseTokenInput(Buffer.from(`SYNTHETIC${ending}`)), 'SYNTHETIC');
    }
    assert.equal(credential.parseTokenInput(Buffer.from('A'.repeat(4096))).length, 4096);
    for (const bytes of [Buffer.alloc(0), Buffer.from('A'.repeat(4097)), Buffer.from('A B'),
      Buffer.from('A\nB'), Buffer.from([0xef, 0xbb, 0xbf, 65]), Buffer.from([0, 65])]) {
      assert.throws(() => credential.parseTokenInput(bytes), { code: 'INVALID_ARGUMENT' });
    }
  });
});

test('WIN-NODE-INPUT: synthetic memory stdin is bounded and never uses process/storage', async () => {
  const beforeProcesses = processCalls.length;
  const beforeStorage = storageCalls.length;
  assert.equal(await credential.readTokenFromStdin(Readable.from([Buffer.from('SYNTHETIC\r\n')])), 'SYNTHETIC');
  await assert.rejects(credential.readTokenFromStdin({ isTTY: true }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(credential.readTokenFromStdin(Readable.from([Buffer.alloc(4099, 65)])),
    { code: 'INVALID_ARGUMENT' });
  assert.equal(processCalls.length, beforeProcesses);
  assert.equal(storageCalls.length, beforeStorage);
});

test('WIN-NODE-CONFIG: unavailable native protection prevents configuration byte read', async () => {
  await platform('win32', () => syntheticLaunchEnvironment(async () => {
    let reads = 0;
    storageBindings = {
      readFile: () => { reads++; return JSON.stringify(config.createEmptyConfig()); },
    };
    try {
      let failure;
      try {
        await store.loadPortableConfiguration({
          stateDir: 'C:\\SyntheticState',
          configFile: 'C:\\SyntheticState\\config.json',
        });
      } catch (error) { failure = error; }
      assert.equal(reads, 0, 'configuration may not select authority before native admission');
      assert.equal(failure?.code, 'PROTECTION_UNAVAILABLE');
      assert.equal(failure?.exitCode, 4);
    } finally { storageBindings = {}; }
  }));
});

test('WIN-NODE-OWNERSHIP: unavailable protection preserves existing lock without reading PSK', async () => {
  await platform('win32', () => syntheticLaunchEnvironment(async () => {
    const path = 'C:\\SyntheticState\\broker.lock';
    const record = Buffer.from(JSON.stringify({
      schema_version: 2, instance: 'a'.repeat(32), pid: 1234, port: 43189,
      started_at: '2026-11-10T00:00:00.000Z',
      channel: { protocol: 'tls-psk-v1', psk: 'b'.repeat(64) },
    }));
    let reads = 0;
    let deletes = 0;
    const info = (file) => ({
      dev: 1, ino: file === path ? 2 : 1, size: file === path ? record.length : 0,
      nlink: 1, mode: file === path ? 0o600 : 0o700,
      isSymbolicLink: () => false, isFile: () => file === path,
      isDirectory: () => file !== path,
    });
    storageBindings = {
      lstat: (file) => info(file),
      open: (file) => ({
        stat: async () => info(file),
        readFile: async () => { reads++; return record; },
        close: async () => {},
      }),
      readFile: () => { reads++; return record; },
      unlink: () => { deletes++; },
      rm: () => { deletes++; },
    };
    try {
      let failure;
      try { await ownership.readSecureOwnership(path); } catch (error) { failure = error; }
      assert.equal(reads, 0, 'unverified lock never discloses persisted channel key');
      assert.equal(deletes, 0, 'existing ownership is never removed for admission');
      assert.equal(failure?.code, 'BROKER_INSTANCE_CONFLICT', 'protection refusal keeps secure conflict mapping');
      assert.ok(!failure.message.includes(record.toString()), 'secret-free public error');
    } finally { storageBindings = {}; }
  }));
});

test('WIN-NODE-COMPAT: POSIX ancestor decisions unchanged without host filesystem', async () => {
  await platform('linux', () => {
    assert.equal(pathTrust.ancestorProtects({ mode: 0o755, uid: 0 }), true);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o777, uid: 0 }), false);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o1777, uid: 0 }), true);
    assert.equal(pathTrust.ancestorProtects({ mode: 0o1777, uid: 999999 }), false);
  });
});

// Supporting coverage for an existing reusable pure primitive only. This is not
// proof that the new storage transport actually invokes it. That wiring and the
// worker-loss/caller-order assertions must be completed against the selected
// production bindings before independent candidate review.
test('WIN-NODE-JSON: actual shared strict JSON refuses malformed/duplicate/BOM bytes', () => {
  for (const bytes of [Buffer.from('{"v":1,"v":2}'), Buffer.from('{"v":1,"\\u0076":2}'),
    Buffer.from([0xc3, 0x28]), Buffer.from([0xef, 0xbb, 0xbf, 123, 125]),
    Buffer.from('{}{}')]) {
    assert.throws(() => parseStrictJson(bytes));
  }
  assert.deepEqual(parseStrictJson(Buffer.from('{"v":1}')), { v: 1 });
});
