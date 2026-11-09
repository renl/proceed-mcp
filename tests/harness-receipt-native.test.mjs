// TEST ONLY. Finite Windows/native filesystem controls, not Linux/host proof.
// Actual MCP fixture body, controlled in-memory child, real owned disk IO only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import * as capture from './support/harness-transparent-capture.mjs';
import * as R from './support/harness-composition-retention.mjs';
import { collectionLimits, rendererReadRefusal } from './support/harness-renderer-observation.mjs';

const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url));
const privateRoot = '/run/proceed/qualification-private/';
const bodySource = await fs.readFile(
  new URL('./fixtures/harness-composition/mcp.mjs', import.meta.url),
  'utf8',
);
const body = bodySource.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '');
const io = { lstat: fs.lstat, open: fs.open, allocate: Buffer.alloc, flags: constants };
const control = (name, fn) =>
  test(name, { timeout: 10000 }, async (t) => {
    await fs.mkdir(scratch, { recursive: true });
    const owned = await fs.mkdtemp(join(scratch, 'receipt-native-control-'));
    try {
      await fn(owned, t);
    } finally {
      await fs.rm(owned, { recursive: true });
      await assert.rejects(fs.lstat(owned), { code: 'ENOENT' });
    }
  });

async function produce(owned, populated) {
  const root = join(owned, 'qualification-private');
  await Promise.all(
    ['qualification-private', 'state', 'evidence'].map((dir) => fs.mkdir(join(owned, dir))),
  );
  const map = (path) => {
    assert.ok(path.startsWith(privateRoot));
    const name = path.slice(privateRoot.length);
    assert.match(name, /^mcp[\w.-]*$/);
    return join(root, name);
  };
  const events = [];
  const hostInput = new PassThrough(),
    hostOutput = new PassThrough();
  hostOutput.resume();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => assert.fail('normal control must not kill adapter'),
  });
  child.stdin.resume();
  const processAdapter = Object.assign(new EventEmitter(), {
    platform: 'linux',
    version: 'v24.22.2',
    env: { PROCEED_TEST_ISOLATED_PID_NAMESPACE: '1' },
    argv: ['node', 'fixture', '/run/proceed/managed-fixtures/native-control'],
    stdin: hostInput,
    stdout: hostOutput,
    exit: (code) => {
      assert.equal(code, 0);
      events.push('exit');
    },
  });
  let armed;
  const attached = new Promise((resolve) => {
    armed = resolve;
  });
  const timers = new Set();
  const promise = runInNewContext(`(async () => { ${body} })()`, {
    assert,
    Buffer,
    AbortController,
    process: processAdapter,
    ...capture,
    spawn: () => child,
    open: async (path, ...args) => {
      const handle = await fs.open(map(path), ...args);
      // Real descriptor methods and metadata, with an observation-only close tap.
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        events.push('capture-close');
      };
      return handle;
    },
    writeFile: async (path, bytes, options) => {
      await fs.writeFile(map(path), bytes, options);
      events.push(path.endsWith('.pending') ? 'pending-written' : 'armed');
      if (path.endsWith('mcp-armed.json')) armed();
    },
    rm: async (path, options) => {
      await fs.rm(map(path), options);
      events.push('armed-removed');
    },
    rename: async (from, to) => {
      assert.equal(events.includes('capture-close'), true);
      await assert.rejects(fs.lstat(map(to)), { code: 'ENOENT' });
      await assert.rejects(fs.lstat(map(privateRoot + 'mcp-armed.json')), { code: 'ENOENT' });
      await fs.rename(map(from), map(to));
      events.push('published');
    },
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, Math.min(ms, 3000));
      timers.add(timer);
      return timer;
    },
    clearTimeout,
  });
  // No polling, listener, process or product. Completion is driven by streams.
  try {
    await Promise.race([
      attached,
      promise.then(() => assert.fail('producer ended before attachment')),
    ]);
    if (populated) {
      const delivered = once(child.stdin, 'data');
      hostInput.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
      await delivered;
      const forwarded = once(hostOutput, 'data');
      child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      await forwarded;
    }
    hostInput.end();
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 0, null);
    await promise;
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const stream of [hostInput, hostOutput, child.stdin, child.stdout, child.stderr])
      stream.destroy();
    processAdapter.removeAllListeners();
    child.removeAllListeners();
  }
  assert.deepEqual(events.slice(-5), [
    'capture-close',
    'armed-removed',
    'pending-written',
    'published',
    'exit',
  ]);
  return { root, events };
}

for (const populated of [false, true])
  control(
    `actual MCP body publishes ${populated ? 'populated' : 'zero-activity'} receipt and real bounded collector admits`,
    async (owned) => {
      const { root } = await produce(owned, populated);
      const captures = new Map();
      let used = 0;
      for (const name of ['mcp-seal.json', 'mcp.jsonl']) {
        const path = join(root, name);
        const state = {};
        const stat = await fs.lstat(path, { bigint: true });
        assert.equal(stat.isFile(), true);
        assert.equal(stat.isSymbolicLink(), false);
        assert.equal(typeof stat.mtimeNs, 'bigint');
        const expected = [
          'file',
          ...['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => stat[key]),
        ];
        // Exercise the actual api->state surface adapter, native defaults and the
        // exact bounded reader options including current inventory identity.
        const bytes = await R.productCaptureReadFile(state, path, 'api', used, undefined, expected);
        assert.deepEqual(bytes, await fs.readFile(path));
        assert.equal(state.readRefusal, undefined);
        assert.equal(rendererReadRefusal(state), undefined);
        const actual = await R.readPrivateReceiptFile(
          path,
          R.privateReceiptProducer(name),
          used,
          () => assert.fail('no refusal'),
        );
        assert.deepEqual(actual, bytes);
        captures.set(name, bytes);
        used += bytes.length;
      }
      capture.assertPrivateCaptureReceipt(
        captures.get('mcp.jsonl'),
        JSON.parse(captures.get('mcp-seal.json')),
      );
      assert.equal(captures.get('mcp.jsonl').length > 0, populated);
      // Remaining receipts are fresh real writer observations, not replacements for
      // missing MCP evidence. The existing whole-chain suite owns full six surfaces.
      for (const [name, seal] of [
        ['wrapper.jsonl', 'wrapper-seal.json'],
        ['composition-public-api.jsonl', 'composition-api-seal.json'],
      ]) {
        const writer = capture.privateCaptureWriter();
        await fs.writeFile(join(root, name), '', { flag: 'wx' });
        const receipt = writer.seal();
        await fs.writeFile(
          join(root, seal),
          JSON.stringify(
            seal.startsWith('composition')
              ? {
                  api: receipt,
                  run: 'native-run',
                  generation: 'native-generation',
                  actionSequence: 0,
                  serviceInventoryWritten: false,
                }
              : receipt,
          ),
          { flag: 'wx' },
        );
        for (const file of [name, seal]) {
          const bytes = await R.readPrivateReceiptFile(
            join(root, file),
            R.privateReceiptProducer(file),
            used,
            () => assert.fail('no refusal'),
          );
          used += bytes.length;
          captures.set(file, bytes);
        }
      }
      const admitted = R.readIntegratedPrivateInventory(
        captures,
        () => {},
        () => {},
        { run: 'native-run', generation: 'native-generation' },
      );
      assert.equal(admitted.mcp.complete, true);
      assert.equal(admitted.callbacks.complete, true);
      captures.delete('mcp-seal.json');
      assert.throws(() => R.readIntegratedPrivateInventory(captures));
    },
  );

control(
  'real native metadata and absent receipt produce exact closed refusal without admission',
  async (owned) => {
    const path = join(owned, 'receipt.json');
    await fs.writeFile(path, '{}', { flag: 'wx' });
    for (const [target, used, operation, errno] of [
      [join(owned, 'absent.json'), 0, 'LSTAT', 'ENOENT'],
      [owned, 0, 'FILE_TYPE', 'UNCLASSIFIED'],
      [path, collectionLimits.contents, 'BUDGET', 'UNCLASSIFIED'],
    ]) {
      let detail;
      await assert.rejects(
        R.readPrivateReceiptFile(target, 'MCP', used, (step) => {
          detail = step;
        }),
      );
      const safe = R.safeCompositionDiagnostic({
        rawScan: 'REFUSED',
        scanReason: 'SEAL_RECEIPT',
        sealRefusal: detail,
      });
      assert.deepEqual(safe.sealRefusal, {
        producer: 'MCP',
        check: 'READ',
        read: { operation, errno },
      });
      assert.equal(JSON.stringify(safe).includes(owned), false);
    }
  },
);

test('actual receipt caller rejects controlled metadata/errors with closed first-operation enums only', async () => {
  const secret = 'never-export-private-operand';
  const metadata = () => ({
    size: 2n,
    dev: 1n,
    ino: 2n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  for (const fault of [
    'SYMLINK',
    'FILE_TYPE',
    'SIZE',
    'IDENTITY',
    'OPEN',
    'FSTAT',
    'READ_PROGRESS',
    'EOF',
    'CLOSE',
    'READ_AND_CLOSE',
    'ACCESSOR',
    'ERROR_ACCESSOR',
    'LSTAT',
    'SIZE_NUMBER',
    'SIZE_NEGATIVE',
    'SIZE_UNSAFE',
    'IDENTITY_RACE',
    'ALLOCATION',
    'READ_ZERO',
    'READ_NEGATIVE',
    'READ_UNSAFE',
    'READ_OVERSHOOT',
    'READ_ACCESSOR',
    'EOF_ERROR',
    'OPEN_EACCES',
  ]) {
    let calls = 0,
      accessed = false,
      closed = false;
    const stat = metadata();
    if (fault === 'SYMLINK') stat.isSymbolicLink = () => true;
    if (fault === 'FILE_TYPE') stat.isFile = () => false;
    if (fault === 'SIZE') stat.size = 16777217n;
    if (fault === 'SIZE_NUMBER') stat.size = 2;
    if (fault === 'SIZE_NEGATIVE') stat.size = -1n;
    if (fault === 'SIZE_UNSAFE') stat.size = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    if (fault === 'IDENTITY') stat.ino = secret;
    if (fault === 'ACCESSOR')
      Object.defineProperty(stat, 'size', {
        get() {
          throw Error(secret);
        },
      });
    const error = () => {
      const e = Error(secret);
      if (fault === 'ERROR_ACCESSOR')
        Object.defineProperty(e, 'code', {
          get() {
            accessed = true;
            throw Error(secret);
          },
        });
      else e.code = fault === 'OPEN_EACCES' ? 'EACCES' : secret;
      return e;
    };
    const controlled = {
      ...io,
      allocate: (size) => {
        if (fault === 'ALLOCATION') throw error();
        return Buffer.alloc(size);
      },
      lstat: async () => {
        if (fault === 'LSTAT') throw error();
        return stat;
      },
      open: async () => {
        if (['OPEN', 'ERROR_ACCESSOR', 'OPEN_EACCES'].includes(fault)) throw error();
        return {
          stat: async () => {
            if (fault === 'FSTAT') throw error();
            if (fault === 'IDENTITY_RACE') return { ...stat, ino: stat.ino + 1n };
            return stat;
          },
          read: async (buffer, offset, length) => {
            if (['READ_PROGRESS', 'READ_AND_CLOSE'].includes(fault)) throw error();
            if (fault === 'READ_ZERO') return { bytesRead: 0 };
            if (fault === 'READ_NEGATIVE') return { bytesRead: -1 };
            if (fault === 'READ_UNSAFE') return { bytesRead: Number.MAX_SAFE_INTEGER + 1 };
            if (fault === 'READ_OVERSHOOT') return { bytesRead: length + 1 };
            if (fault === 'READ_ACCESSOR')
              return {
                get bytesRead() {
                  throw error();
                },
              };
            if (calls++ === 0) {
              buffer.fill(32);
              return { bytesRead: length };
            }
            if (fault === 'EOF_ERROR') throw error();
            return { bytesRead: fault === 'EOF' ? 1 : 0 };
          },
          close: async () => {
            closed = true;
            if (['CLOSE', 'READ_AND_CLOSE'].includes(fault)) throw error();
          },
        };
      },
    };
    let detail;
    await assert.rejects(
      R.readPrivateReceiptFile(
        secret,
        'MCP',
        0,
        (step) => {
          detail = step;
        },
        controlled,
      ),
    );
    const operation =
      {
        READ_AND_CLOSE: 'READ_PROGRESS',
        ACCESSOR: 'SIZE',
        ERROR_ACCESSOR: 'OPEN',
        SIZE_NUMBER: 'SIZE',
        SIZE_NEGATIVE: 'SIZE',
        SIZE_UNSAFE: 'SIZE',
        IDENTITY_RACE: 'IDENTITY',
        READ_ZERO: 'READ_PROGRESS',
        READ_NEGATIVE: 'READ_PROGRESS',
        READ_UNSAFE: 'READ_PROGRESS',
        READ_OVERSHOOT: 'READ_PROGRESS',
        READ_ACCESSOR: 'READ_PROGRESS',
        EOF_ERROR: 'EOF',
        OPEN_EACCES: 'OPEN',
      }[fault] ?? fault;
    const safe = R.safeCompositionDiagnostic({
      rawScan: 'REFUSED',
      scanReason: 'SEAL_RECEIPT',
      sealRefusal: detail,
    });
    assert.deepEqual(safe.sealRefusal, {
      producer: 'MCP',
      check: 'READ',
      read: { operation, errno: fault === 'OPEN_EACCES' ? 'EACCES' : 'UNCLASSIFIED' },
    });
    assert.equal(JSON.stringify(safe).includes(secret), false);
    assert.equal(accessed, false);
    if (['FSTAT', 'READ_PROGRESS', 'EOF', 'CLOSE', 'READ_AND_CLOSE'].includes(fault))
      assert.equal(closed, true);
  }
});

test('closed reader export refuses arbitrary shapes, symbols, accessors, proxies and numeric content', () => {
  const unknown = { operation: 'UNCLASSIFIED', errno: 'UNCLASSIFIED' };
  let accessed = false;
  for (const read of [
    null,
    42,
    { operation: 'OPEN', errno: 7 },
    { operation: '/private', errno: 'ENOENT' },
    { operation: 'OPEN', errno: 'ENOENT', raw: 'private' },
    { operation: 'OPEN', errno: 'ENOENT', [Symbol('private')]: 'private' },
    {
      get operation() {
        accessed = true;
        return 'OPEN';
      },
      errno: 'ENOENT',
    },
    new Proxy(
      {},
      {
        ownKeys() {
          throw Error('private');
        },
      },
    ),
  ]) {
    const safe = R.safeCompositionDiagnostic({
      rawScan: 'REFUSED',
      scanReason: 'SEAL_RECEIPT',
      sealRefusal: { producer: 'MCP', check: 'READ', read },
    });
    assert.deepEqual(safe.sealRefusal.read, unknown);
  }
  assert.equal(accessed, false);
});
