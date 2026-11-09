// TEST ONLY. Maintained fixture sources and retention branch, memory IO only.
// No host, process, listener, private historical capture or synthetic seal.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { posix } from 'node:path';
import * as R from './support/harness-composition-retention.mjs';
import * as C from './support/harness-transparent-capture.mjs';
import * as W from './support/harness-wrapper-invocation.mjs';
import {
  transportFixtureAuthorities,
  freezeTransportSecrets,
} from './support/harness-transport-fixtures.mjs';
import {
  collectionAdmit,
  collectionLimits,
  digest,
} from './support/harness-renderer-observation.mjs';
import * as readiness from './support/harness-composition-readiness.mjs';

const root = '/run/proceed/qualification-private/';
const evidence = '/run/proceed/evidence';
const source = async (name) => readFile(new URL(name, import.meta.url), 'utf8');
const strip = (text) =>
  text.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', '');
const flush = () => new Promise(setImmediate);

function memoryFiles() {
  const files = new Map(),
    events = [];
  const put = (path, value, options = {}) => {
    if (options.flag === 'wx' && files.has(path)) throw Error('exclusive file exists');
    files.set(path, Buffer.from(value));
    events.push(['write', path]);
  };
  const get = (path) => {
    if (!files.has(path)) throw Object.assign(Error('unavailable'), { code: 'ENOENT' });
    return Buffer.from(files.get(path));
  };
  const names = (path) =>
    [
      ...new Set(
        [...files.keys()]
          .filter((p) => p.startsWith(path + '/'))
          .map((p) => p.slice(path.length + 1).split('/')[0]),
      ),
    ].sort();
  const stat = (path) => {
    const file = files.has(path);
    if (!file && !names(path).length) get(path);
    return {
      dev: 1n,
      ino: BigInt([...files.keys()].indexOf(path) + 2),
      size: BigInt(file ? get(path).length : 0),
      mtimeNs: 1n,
      ctimeNs: 1n,
      isFile: () => file,
      isDirectory: () => !file,
      isSymbolicLink: () => false,
    };
  };
  const io = {
    flags: { O_RDONLY: 0, O_NOFOLLOW: 1, O_NONBLOCK: 2 },
    allocate: Buffer.alloc,
    lstat: async (path) => stat(path),
    opendir: async (path) => {
      const entries = names(path);
      return {
        read: async () => (entries.length ? { name: entries.shift() } : null),
        close: async () => {},
      };
    },
    open: async (path) => ({
      stat: async () => stat(path),
      close: async () => {},
      read: async (b, offset, length, position) => ({
        bytesRead: get(path).copy(b, offset, position, position + length),
      }),
    }),
  };
  return { files, events, put, get, io, names };
}

async function producers(mode, target = 'MCP') {
  const m = memoryFiles();
  const fixture = async (name, deps) =>
    runInNewContext(strip(await source(name)), {
      Buffer,
      AbortController,
      AbortSignal,
      performance,
      ...deps,
    });
  const shortLifetime = () => W.captureProducerLifetime(Date.now() + 250);
  let command, tick, late, pending, releaseWrite;
  const hostInput = new PassThrough(),
    hostOutput = new PassThrough();
  hostOutput.resume();
  const child = new EventEmitter();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      child.emit('close', 0);
    },
  });
  child.stdin.resume();
  const fakeProcess = Object.assign(new EventEmitter(), {
    platform: 'linux',
    version: 'v24.22.2',
    env: { PROCEED_TEST_ISOLATED_PID_NAMESPACE: '1' },
    argv: ['node', 'fixture', '/run/proceed/managed-fixtures/memory'],
    stdin: hostInput,
    stdout: hostOutput,
    exit: () => {},
  });
  const open = async (path) => {
    m.put(path, '', { flag: 'wx' });
    let closed = false;
    return {
      writeFile: async (bytes) => {
        assert.equal(closed, false);
        if (
          mode === 'unsettled-write' &&
          path === root + (target === 'MCP' ? 'mcp.jsonl' : 'wrapper.jsonl')
        )
          await new Promise((resolve) => {
            releaseWrite = resolve;
          });
        m.put(path, Buffer.concat([m.get(path), Buffer.from(bytes)]));
      },
      close: async () => {
        closed = true;
        m.events.push(['close', path]);
      },
    };
  };
  let mcp;
  if (!(mode === 'unreached' && target === 'MCP')) {
    let rejectExit;
    const exited = new Promise((_, reject) => {
      rejectExit = reject;
    });
    fakeProcess.exit = (code) => {
      if (code)
        rejectExit(
          Object.assign(Error('controlled producer exit'), { code: 'PRODUCER_UNSETTLED' }),
        );
    };
    const body = runInNewContext(
      `(async () => { ${strip(await source('./fixtures/harness-composition/mcp.mjs'))} })()`,
      {
        assert,
        Buffer,
        AbortController,
        process: fakeProcess,
        spawn: () => child,
        open,
        writeFile: async (...args) => m.put(...args),
        rm: async (path) => m.files.delete(path),
        setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 250)),
        clearTimeout,
        ...C,
        captureProducerLifetime: shortLifetime,
      },
    );
    mcp = Promise.race([body, exited]);
    mcp.catch(() => {});
    await flush();
  }
  let id = 0;
  const prepared = {
    request_id: 'req_' + '1'.repeat(32),
    request_handle: 'hdl_' + '2'.repeat(32),
    request_capability: 'cap_' + '3'.repeat(64),
  };
  const tool = (name) => ({
    name,
    options: { namespace: 'proceed' },
    execute: async (input, { signal, sessionID }) => {
      const call = ++id;
      const wireInput =
        mode === 'unknown-capability' && name === 'request_approval'
          ? { ...input, request_capability: 'cap_' + '4'.repeat(64) }
          : input;
      hostInput.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: call,
          method: 'tools/call',
          params: { name, arguments: wireInput, _meta: { 'ai.opencode/sessionID': sessionID } },
        }) + '\n',
      );
      await flush();
      if (name === 'request_approval' && ['partial', 'late', 'unsettled'].includes(mode)) {
        await new Promise((resolve, reject) => {
          late = resolve;
          signal.addEventListener(
            'abort',
            () => {
              if (mode !== 'unsettled') reject(Error('controlled abort'));
            },
            { once: true },
          );
        });
        signal.throwIfAborted();
      }
      const output =
        name === 'prepare_approval'
          ? prepared
          : { request_id: prepared.request_id, state: 'rejected' };
      const wireOutput =
        mode === 'decoded-key' ? { ...output, 'operator-secret': 'value' } : output;
      let wire = JSON.stringify({
        jsonrpc: '2.0',
        id: call,
        result: {
          structuredContent: wireOutput,
          content: [{ type: 'text', text: JSON.stringify(wireOutput) }],
        },
      });
      if (mode === 'decoded-key')
        wire = wire.replaceAll('operator-secret', '\\u006fperator-secret');
      child.stdout.write(wire + '\n');
      await flush();
      return { output };
    },
  });
  let wrapperCleanup;
  if (!(mode === 'unreached' && target === 'WRAPPER')) {
    const wrapper = await fixture('./fixtures/harness-wrapper/server.mjs', {
      Plugin: { define: (v) => v },
      ...W,
      ...C,
      captureProducerLifetime: shortLifetime,
      open,
      writeFile: async (...args) => m.put(...args),
      invokeRegisteredProceed: (context, invocation, signal, record) =>
        W.invokeRegisteredProceed(context, invocation, signal, (event) =>
          record(mode === 'callback-phase' ? { ...event, phase: 'foreign-phase' } : event),
        ),
    });
    wrapperCleanup = await wrapper.setup({
      app: { version: '2.2.5' },
      command: {
        transform: async (edit) => {
          edit({
            add: (v) => {
              command = v;
            },
          });
          return { dispose: async () => {} };
        },
      },
      session: { get: async ({ sessionID }) => ({ id: sessionID, agent: 'selected' }) },
      agent: { get: async () => ({ data: { id: 'selected' } }) },
      tool: { list: async () => ['prepare_approval', 'request_approval'].map(tool) },
    });
  }
  let tuiCleanup;
  m.put(
    evidence + '/composition-binding.json',
    JSON.stringify({ run: 'memory-run', integratedScenario: true }),
  );
  if (!(mode === 'unreached' && target === 'PUBLIC_API')) {
    const tui = await fixture('./fixtures/harness-composition/tui.ts', {
      Plugin: { define: (v) => v },
      product: { id: 'memory', setup: async () => async () => {} },
      process: { versions: {} },
      ...W,
      ...C,
      captureProducerLifetime: shortLifetime,
      randomUUID: () => 'memory-generation',
      collectionAdmit,
      collectionLimits,
      createCompositionSessionReader: () => () => {},
      observeCompositionSelectors: () => ({}),
      readFileSync: (path) => m.get(path).toString(),
      writeFileSync: m.put,
      writeFile: async (...args) => m.put(...args),
      appendFileSync: (path, value) =>
        m.put(path, Buffer.concat([m.get(path), Buffer.from(value)])),
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval: () => {},
    });
    tuiCleanup = await tui.setup({
      renderer: { on() {}, off() {} },
      app: { version: '2.2.5' },
      data: { session: { list: () => [], sync: async () => {}, get: () => ({ id: 'session' }) } },
      client: {
        session: {
          create: async () => ({ id: 'session' }),
          command: async () => {
            pending =
              mode === 'api-unsettled'
                ? new Promise((resolve) => {
                    late = resolve;
                  })
                : command.execute({ sessionID: 'session', prompt: { text: '' } });
            await pending;
            return { data: 'done' };
          },
        },
      },
    });
  }
  if (mode === 'unsettled-write' && target === 'MCP') {
    hostInput.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    for (let n = 0; n < 20 && !releaseWrite; n++) await flush();
    assert.ok(releaseWrite);
  } else if (mode === 'setup-only') {
    // Real transparent capture of setup protocol traffic, with no prepare/wait
    // invocation or callback. Empty and setup-only are distinct producer states.
    hostInput.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await flush();
  } else if (
    [
      'partial',
      'normal',
      'late',
      'unsettled',
      'unsettled-write',
      'callback-phase',
      'api-unsettled',
      'decoded-key',
      'unknown-capability',
    ].includes(mode)
  ) {
    m.put(
      root + 'composition-action-1.json',
      JSON.stringify({
        run: 'memory-run',
        generation: 'memory-generation',
        request: 1,
        kind: 'invoke',
        sessionID: 'session',
      }),
    );
    tick();
    for (
      let n = 0;
      n < 20 &&
      (['normal', 'callback-phase', 'decoded-key', 'unknown-capability'].includes(mode)
        ? !pending
        : mode === 'unsettled-write'
          ? !releaseWrite
          : !late);
      n++
    )
      await flush();
    assert.ok(pending, 'actual public command reached registered wrapper');
    if (['normal', 'callback-phase', 'decoded-key', 'unknown-capability'].includes(mode)) {
      await pending;
      await flush();
    }
  }
  return {
    ...m,
    async close() {
      const results = await Promise.allSettled([wrapperCleanup?.(), tuiCleanup?.()]);
      hostInput.end();
      child.stdout.end();
      child.stderr.end();
      await flush();
      child.emit('close', 0);
      let mcpFailure;
      try {
        await mcp;
      } catch (error) {
        mcpFailure = error;
      }
      const refusal = results.find((r) => r.status === 'rejected');
      if (late) {
        const before = JSON.stringify([...m.files]);
        late();
        await pending.catch(() => {});
        await flush();
        assert.equal(
          JSON.stringify([...m.files]),
          before,
          'late callback cannot write after seal/fence',
        );
      }
      if (releaseWrite) {
        releaseWrite();
        await pending?.catch(() => {});
        await flush();
      }
      if (refusal) throw refusal.reason;
      if (mcpFailure) throw mcpFailure;
    },
  };
}

const ledger = () =>
  transportFixtureAuthorities(
    {
      operator: { credential: 'operator-secret' },
      control: 'control-secret',
      owner: 'owner-secret',
      setupSecrets: ['setup-secret'],
    },
    'channel-secret',
    'unenrolled-secret',
  );

// Execute the exact maintained product collection branch, not a reimplemented
// exporter or separately mocked ready seal. Every seal comes from fixture cleanup.
async function collect(m, mutate = () => {}) {
  const text = await source('./support/harness-composition-inner.mjs');
  const readyStart = text.indexOf('        const admitReady = async');
  const readyEnd = text.indexOf('        if (navigationOnly) {', readyStart);
  const catchStart = text.indexOf(
    '      } catch (error) {\n        errorCode = compositionErrorCode(error);',
    readyEnd,
  );
  const end = text.indexOf('\n      }\n    },', catchStart);
  assert.ok(readyStart > 0 && readyEnd > readyStart && catchStart > readyEnd && end > catchStart);
  let clock = Date.now(),
    cleaning = false;
  const controls = ledger(),
    requiredSecrets = freezeTransportSecrets(controls);
  m.put('/run/proceed/state/journal.log', '');
  m.put(root + 'composition-wire.jsonl', '');
  m.put('/run/proceed/host-state/pty.raw', 'controlled frame');
  m.put('/run/proceed/host-state/host.log', 'component=plugin role=cli controlled\n');
  m.put(evidence + '/progress.jsonl', '{"phase":"failure"}\n');
  const env = {
    assert,
    Buffer,
    Date: { now: () => clock },
    JSON,
    Math,
    join: posix.join,
    Map: class extends Map {
      get(name) {
        if (name === m.readFault) throw Error('controlled private read');
        return super.get(name);
      }
    },
    child: {
      stdin: {
        write() {
          assert.fail('no key permitted');
        },
        destroy() {},
      },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    },
    process: {
      kill() {
        assert.fail('controlled graceful cleanup needs no signal');
      },
    },
    integratedScenario: true,
    productMode: true,
    scenarioSucceeded: false,
    controls: { ...controls, close: async () => {} },
    controlsClosed: false,
    requiredSecrets,
    h: {
      state: '/run/proceed/state',
      fixture: { calls: [] },
      finalizeCapture: async () => {
        m.events.push(['finalize', 'broker-and-telegram']);
        mutate(m, env);
      },
      closedBrokerOutput: () => Buffer.alloc(0),
    },
    readdir: async (path) => (path === '/proc' ? [] : m.names(path.replace(/\/$/, ''))),
    priorPids: new Set(),
    closed: false,
    exited: false,
    stdoutEnded: false,
    stderrEnded: false,
    overflow: false,
    evidence,
    run: 'memory-run',
    binding: { generation: 'memory-generation' },
    transcript: Buffer.from('\x1b[2J\x1b[H\u{1f600}'),
    pickerEvidence: null,
    integratedResult: null,
    cleanupObservation: null,
    executionBinding: null,
    keys: { ctrlG: 0, enter: 0, exit: 0 },
    lifecycle: { exitObserved: true, closeObserved: true },
    productCleanup: 'OBSERVED',
    hostExit: 'PASS',
    end: Date.now() + 10000,
    scanStatus: 'UNRUN',
    scanReason: 'UNRUN',
    sealRefusal: null,
    writeFile: async (...args) => m.put(...args),
    ...R,
    ...readiness,
    digest,
    phase: 'rendered-host-and-product-registration',
    origin: '',
    readinessEnd: clock + 1,
    started: clock,
    request: undefined,
    requestWrittenAt: undefined,
    sequence: 0,
    lastGuardState: null,
    lastLoopGuard: null,
    failureAt: null,
    errorCode: 'UNRUN',
    commandEligibility: 'UNRUN',
    dismissalAdmitted: false,
    cleanupTiming: R.cleanupMilestones(() => clock),
    logs: async () => Buffer.alloc(0),
    readObservation: () => null,
    exists: async (path) => m.files.has(path),
    readCleanupObservation: (name) =>
      m.files.has(evidence + '/' + name) ? JSON.parse(m.get(evidence + '/' + name)) : null,
    diagnosticIO: {
      write: async (bytes) => m.put(evidence + '/closed-diagnostic.json', bytes),
      commit: async () => {},
    },
    recordGuard: (stage, value) => {
      if (stage === 'loopadmit') env.lastLoopGuard = value;
      if (stage === 'CleanupENTRY') cleaning = true;
    },
    delay: async () => {
      clock += 20;
      if (cleaning && !env.closed) {
        try {
          await m.close();
        } catch (error) {
          env.fixtureFailure = error;
        }
        env.child.stdout.end();
        env.child.stderr.end();
        await flush();
        env.stdoutEnded = env.child.stdout.readableEnded;
        env.stderrEnded = env.child.stderr.readableEnded;
        env.exited = true;
        env.closed = true;
      }
    },
    collectionAdmit,
    collectionLimits,
    productCaptureReadFile: (state, path, surface, used) =>
      R.productCaptureReadFile(state, path, surface, used, m.io),
    productCaptureInputs: (state, path, _io, allow) =>
      R.productCaptureInputs(state, path, m.io, allow),
    collectProductCapture: (roots, extras, secrets, end, _io, stage) =>
      R.collectProductCapture(roots, extras, secrets, end, m.io, stage),
  };
  env.child.stdout.resume();
  env.child.stderr.resume();
  env.collectionError = null;
  const branch = text
    .slice(catchStart, end)
    .replace("scanStatus = 'REFUSED';", "collectionError = error; scanStatus = 'REFUSED';");
  try {
    await runInNewContext(
      `(async () => { ${text.slice(readyStart, readyEnd)} try { await admitReady(() => assert.fail('no UI command admitted')); ${branch} } })()`,
      env,
    );
    assert.fail('scenario failure must propagate independently of privacy');
  } catch (error) {
    env.propagatedCode = error.code;
  }
  return env;
}

function archive(name, bytes) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257);
  const sum = header.reduce((n, b) => n + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
    Buffer.alloc(1024),
  ]);
}

test('maintained readiness failure -> actual zero/partial producer cleanup -> all PRODUCT surfaces -> marker -> five transfers', async () => {
  for (const mode of ['zero', 'setup-only', 'partial', 'normal', 'late']) {
    const m = await producers(mode);
    const result = await collect(m);
    assert.equal(
      result.scanStatus,
      'PASS',
      `${mode}: ${result.scanReason}: ${result.collectionError?.stack}`,
    );
    assert.equal(result.scenarioSucceeded, false, 'privacy PASS is not scenario PASS');
    assert.equal(result.propagatedCode, 'READINESS_DEADLINE');
    assert.equal(result.failureAt.guard.decoder.supported, false);
    const transfers = [];
    const admitted = await R.transferProductCapture(async (name) => {
      transfers.push(name);
      return archive(name, m.get(evidence + '/' + name));
    });
    assert.equal(admitted.size, 5);
    assert.deepEqual(transfers, ['scan-pass.json', ...R.productCaptureFiles]);
    const scan = JSON.parse(admitted.get('scan-pass.json'));
    assert.deepEqual(scan.surfaces, [
      'tui',
      'telegram',
      'journal',
      'diagnostics',
      'evidence',
      'api',
    ]);
    assert.ok(
      m.events.findIndex(([_, p]) => p.endsWith('scan-pass.json')) >
        m.events.findIndex(([_, p]) => p.endsWith('mcp-seal.json')),
    );
    for (const name of transfers)
      assert.ok(!/mcp|wrapper|public-api/.test(name), 'no raw private export');
  }
});

test('actual unreached and unsettled producers never become fictional complete captures', async () => {
  for (const target of ['MCP', 'WRAPPER', 'PUBLIC_API']) {
    const result = await collect(await producers('unreached', target));
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, 'SEAL_RECEIPT');
    assert.equal(result.sealRefusal.producer, target);
    assert.equal(result.sealRefusal.check, 'UNAVAILABLE');
  }
  const m = await producers('unsettled');
  const result = await collect(m);
  assert.equal(result.scanStatus, 'REFUSED');
  assert.equal(result.scanReason, 'SEAL_RECEIPT');
  assert.equal(result.fixtureFailure.code, 'PRODUCER_UNSETTLED');
  assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
});

test('actual producer receipts drive first fixed consumer substep failures, never five-transfer admission', async () => {
  for (const [check, change] of [
    ['UNAVAILABLE', (m, p) => m.files.delete(p)],
    ['JSON', (m, p) => m.put(p, '{')],
    ['SCHEMA', (m, p) => m.put(p, '{}')],
    [
      'COMPLETE',
      (m, p) => {
        const r = JSON.parse(m.get(p));
        r.complete = false;
        m.put(p, JSON.stringify(r));
      },
    ],
    [
      'LENGTH',
      (m, p) => {
        const r = JSON.parse(m.get(p));
        r.bytes++;
        m.put(p, JSON.stringify(r));
      },
    ],
    [
      'HASH',
      (m, p) => {
        const r = JSON.parse(m.get(p));
        r.sha256 = '0'.repeat(64);
        m.put(p, JSON.stringify(r));
      },
    ],
  ])
    for (const [producer, name] of [
      ['MCP', 'mcp-seal.json'],
      ['WRAPPER', 'wrapper-seal.json'],
      ['PUBLIC_API', 'composition-api-seal.json'],
    ]) {
      const m = await producers('zero');
      const result = await collect(m, () => {
        const path = root + name;
        if (producer === 'PUBLIC_API' && !['JSON', 'UNAVAILABLE'].includes(check)) {
          const envelope = JSON.parse(m.get(path));
          const proxy = {
            files: m.files,
            get: () => Buffer.from(JSON.stringify(envelope.api)),
            put: (_p, bytes) => {
              envelope.api = JSON.parse(bytes);
              m.put(path, JSON.stringify(envelope));
            },
          };
          change(proxy, path);
        } else change(m, path);
      });
      assert.equal(result.scanStatus, 'REFUSED');
      assert.equal(result.scanReason, 'SEAL_RECEIPT');
      assert.deepEqual(R.safeSealRefusal(result.sealRefusal), { producer, check });
      assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
    }
});

test('closed receipt diagnostics reject unknown fields, accessors, unsafe values and hostile reflection', () => {
  let accessed = false;
  for (const value of [
    null,
    { producer: 'MCP', check: 'HASH', raw: 'private' },
    { producer: 'private', check: 'HASH' },
    { producer: 'MCP', check: 'private' },
    Object.defineProperty({ check: 'HASH' }, 'producer', {
      enumerable: true,
      get() {
        accessed = true;
        throw Error('private');
      },
    }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw Error('private');
        },
      },
    ),
  ])
    assert.equal(R.safeSealRefusal(value), null);
  assert.equal(accessed, false);
  const safe = R.safeCompositionDiagnostic({
    rawScan: 'REFUSED',
    scanReason: 'SEAL_RECEIPT',
    sealRefusal: { producer: 'MCP', check: 'HASH' },
  });
  assert.deepEqual(safe.sealRefusal, { producer: 'MCP', check: 'HASH' });
  assert.equal(
    R.safeCompositionDiagnostic({ rawScan: 'PASS', sealRefusal: safe.sealRefusal }).sealRefusal,
    null,
  );
});

test('actual receipt reads retain READ on controlled IO failure for every producer without exposing operands', async () => {
  for (const [producer, name] of [
    ['MCP', 'mcp-seal.json'],
    ['WRAPPER', 'wrapper-seal.json'],
    ['PUBLIC_API', 'composition-api-seal.json'],
  ]) {
    const m = await producers('zero');
    const open = m.io.open;
    m.io.open = async (path, flags) => {
      if (path === root + name) throw Error('controlled private read');
      return open(path, flags);
    };
    const result = await collect(m);
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, 'SEAL_RECEIPT');
    const safe = R.safeCompositionDiagnostic({
      rawScan: result.scanStatus,
      scanReason: result.scanReason,
      sealRefusal: result.sealRefusal,
    });
    assert.deepEqual(safe.sealRefusal, { producer, check: 'READ' });
    assert.equal(JSON.stringify(safe).includes('controlled private read'), false);
  }
});

test('actual public API uncooperative promise and sealed unknown callback phase remain REFUSED', async () => {
  for (const [mode, reason] of [
    ['api-unsettled', 'SEAL_RECEIPT'],
    ['callback-phase', 'CORRELATION'],
  ]) {
    const m = await producers(mode);
    const result = await collect(m);
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, reason);
    assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
  }
});

test('composed classification refuses every generated authority on every PRODUCT surface and never writes a marker', async () => {
  const secrets = freezeTransportSecrets(ledger());
  for (const surface of ['tui', 'telegram', 'journal', 'diagnostics', 'evidence', 'api'])
    for (const secret of secrets) {
      // Isolate every generated authority on every surface. No first match can
      // conceal a missing later member of the complete producer secret ledger.
      const m = await producers('zero');
      const result = await collect(m, (_m, env) => {
        const bytes = Buffer.from(secret);
        if (surface === 'tui') env.transcript = bytes;
        if (surface === 'telegram') env.h.fixture.calls.push({ text: bytes.toString() });
        if (surface === 'journal') m.put('/run/proceed/state/journal.log', bytes);
        if (surface === 'diagnostics') m.put('/run/proceed/host-state/host.log', bytes);
        if (surface === 'evidence') m.put(evidence + '/extra.json', bytes);
        if (surface === 'api') m.put(root + 'composition-wire.jsonl', bytes);
      });
      assert.equal(result.scanStatus, 'REFUSED', surface);
      assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
    }
});

test('five-transfer admission rejects a changed marker or any changed exported file from the composed result', async () => {
  const m = await producers('zero');
  assert.equal((await collect(m)).scanStatus, 'PASS');
  for (const damaged of ['scan-pass.json', ...R.productCaptureFiles]) {
    let calls = 0;
    await assert.rejects(
      R.transferProductCapture(async (name) => {
        calls++;
        const bytes = m.get(evidence + '/' + name);
        return archive(name, name === damaged ? Buffer.from('changed') : bytes);
      }),
    );
    assert.ok(calls >= 1 && calls <= 5);
  }
});

test('actual protocol producers cannot hide authority in decoded names or use an uncorrelated capability', async () => {
  for (const [mode, reason] of [
    ['decoded-key', 'SECRET_CLASSIFICATION'],
    ['unknown-capability', 'CORRELATION'],
  ]) {
    const m = await producers(mode);
    const result = await collect(m);
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, reason);
    assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
  }
});

test('composed collection retains host/process, immutable inventory, file budget and overflow prerequisites', async () => {
  for (const fault of [
    'streams',
    'process',
    'inventory',
    'file-budget',
    'overflow',
    'secret-ledger',
  ]) {
    const m = await producers('zero');
    const result = await collect(m, (_m, env) => {
      if (fault === 'streams') env.stdoutEnded = false;
      if (fault === 'process')
        env.readdir = async (path) =>
          path === '/proc' ? ['42'] : m.names(path.replace(/\/$/, ''));
      if (fault === 'overflow') env.overflow = true;
      if (fault === 'secret-ledger') env.controls.secrets = ['incomplete'];
      if (['inventory', 'file-budget'].includes(fault)) {
        const original = m.io.lstat;
        m.io.lstat = async (path) => {
          const value = await original(path);
          if (path.endsWith('/pty.raw')) {
            if (fault === 'file-budget') value.size = BigInt(collectionLimits.file) + 1n;
            else value.ino++;
          }
          return value;
        };
      }
    });
    assert.equal(result.scanStatus, 'REFUSED', fault);
    assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
  }
});

test('actual MCP and registered-wrapper unsettled writes refuse closure and cannot seal after late IO', async () => {
  for (const producer of ['MCP', 'WRAPPER']) {
    const m = await producers('unsettled-write', producer);
    const result = await collect(m);
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, 'SEAL_RECEIPT');
    assert.equal(result.fixtureFailure.code, 'PRODUCER_UNSETTLED');
    assert.equal(
      m.files.has(root + (producer === 'MCP' ? 'mcp-seal.json' : 'wrapper-seal.json')),
      false,
    );
    assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
  }
});

test('actual composed run/generation/phase and unprocessed action inputs cannot gain retention authority', async () => {
  for (const fault of ['run', 'generation', 'phase', 'unprocessed']) {
    const m = await producers('normal');
    const result = await collect(m, () => {
      const name =
        root +
        (fault === 'unprocessed'
          ? 'composition-action-2.json'
          : 'composition-action-result-1.json');
      const value =
        fault === 'unprocessed'
          ? { request: 2, run: 'memory-run', generation: 'memory-generation' }
          : JSON.parse(m.get(name));
      if (fault === 'phase') value.state = 'STARTED';
      if (fault === 'run' || fault === 'generation') value[fault] = 'foreign';
      m.put(name, JSON.stringify(value));
    });
    assert.equal(result.scanStatus, 'REFUSED');
    assert.equal(result.scanReason, 'SEAL_RECEIPT');
    assert.deepEqual(R.safeSealRefusal(result.sealRefusal), {
      producer: 'PUBLIC_API',
      check: 'CORRELATION',
    });
    assert.equal(m.files.has(evidence + '/scan-pass.json'), false);
  }
});
