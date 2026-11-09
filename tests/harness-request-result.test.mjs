// TEST ONLY. Native current-cell/refusal controls. No process, IO or runtime mode.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeCurrentQuestion,
  currentQuestionAdapter,
  requestResultWireAdapter,
  runCompositionRequestResult,
} from './support/harness-request-result.mjs';
import {
  invokeRegisteredProceed,
  compositionHostAction,
  captureProducerLifetime,
  wrapperCommand,
} from './support/harness-wrapper-invocation.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createProductNavigationObserver } from './support/harness-navigation-observation.mjs';
import { compositionSourceFrame } from './support/harness-composition-readiness.mjs';
import { integratedCompositionConfiguration } from './support/harness-linux-plan.mjs';
import { assertProductCaptureOutcome } from './support/harness-linux-runner.mjs';
import { identityLines } from '../src/harness/session-identity.js';
import {
  scanFrozenComposition,
  compositionScanReason,
  scanIntegratedPrivateCaptures,
  admitIntegratedPrivateInventory,
  safeCompositionDiagnostic,
} from './support/harness-composition-retention.mjs';
import {
  privateCaptureWriter,
  assertPrivateCaptureReceipt,
} from './support/harness-transparent-capture.mjs';
import {
  transportFixtureAuthorities,
  freezeTransportSecrets,
} from './support/harness-transport-fixtures.mjs';

const secretLedger = transportFixtureAuthorities(
  {
    operator: { credential: 'synthetic-operator' },
    control: 'synthetic-control',
    owner: 'synthetic-owner',
    setupSecrets: ['synthetic-setup'],
  },
  'synthetic-psk',
  'synthetic-unenrolled',
);
const receipt = (bytes) => {
  const writer = privateCaptureWriter();
  writer.written(bytes);
  return writer.seal();
};
const privateInput = (input) => ({
  ...input,
  secretLedger,
  receipts: {
    mcp: receipt(input.mcp),
    callbacks: receipt(input.callbacks),
  },
});

const presentation = {
  request_id: `req_${'a'.repeat(32)}`,
  presentation_id: `hpr_${'b'.repeat(32)}`,
  session_id: 'exact-session',
  session_label: 'Equal qualification label',
  action: 'Qualification action',
  context: 'Distinct synthetic request 12345678-1234-1234-1234-123456789abc',
  expires_at: '2030-01-01T00:00:00.000Z',
};
const binding = {
  run: 'memory-run',
  setup: 'memory-generation',
  geometry: { width: 120, height: 40, resizeSequence: 0 },
  inputs: 'memory-only-not-admitted-runtime',
};
const live = {
  live: true,
  run: binding.run,
  generation: binding.setup,
  geometry: binding.geometry,
};
const paint = (lines) =>
  Buffer.from(
    '\x1b[?2026h\x1b[2J' + lines.map((s, n) => `\x1b[${n + 1};1H${s}`).join('') + '\x1b[?2026l',
  );
const questionLines = (p) => [
  'Proceed approval request',
  '',
  ...[
    ['Request ID', p.request_id],
    ['Session label', p.session_label],
    ['Action', p.action],
    ['Context', p.context],
    ['Expires', p.expires_at],
  ].flatMap(([label, value]) => [label + ':', ...value.split('\n').flatMap(identityLines)]),
  '',
  'Choose Reject, Respond or Approve.',
  'Dismissing this dialog sends no decision.',
  'Reject',
  'Respond',
  'Approve',
];
const lines = questionLines(presentation);

test('actual registered wrapper cancels settled work and refuses uncooperative work before any complete seal', async () => {
  const source = await readFile(
    new URL('./fixtures/harness-wrapper/server.mjs', import.meta.url),
    'utf8',
  );
  for (const cooperative of [true, false]) {
    let command,
      release,
      entered,
      aborted = false,
      writes = 0,
      seals = 0;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const fixture = runInNewContext(
      source.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', ''),
      {
        Plugin: { define: (v) => v },
        Buffer,
        AbortController,
        captureProducerLifetime: () => captureProducerLifetime(Date.now() + 100),
        privateCaptureWriter,
        invokeRegisteredProceed,
        wrapperCommand,
        open: async () => ({
          writeFile: async () => {
            writes++;
          },
          close: async () => {},
        }),
        writeFile: async () => {
          seals++;
        },
      },
    );
    const cleanup = await fixture.setup({
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
      tool: {
        list: async () =>
          ['prepare_approval', 'request_approval'].map((name) => ({
            name,
            options: { namespace: 'proceed' },
            execute: async (_, { signal }) =>
              new Promise((resolve, reject) => {
                release = resolve;
                signal.addEventListener(
                  'abort',
                  () => {
                    aborted = true;
                    if (cooperative) reject(Error('cancelled'));
                  },
                  { once: true },
                );
                entered();
              }),
          })),
      },
    });
    const pending = command.execute({ sessionID: 'memory-session', prompt: { text: '' } });
    const outcome = pending.catch(() => {});
    await started;
    const began = Date.now();
    if (cooperative) await cleanup();
    else await assert.rejects(cleanup(), { code: 'PRODUCER_UNSETTLED' });
    assert.ok(Date.now() - began < 500, 'original budget, not an unbounded drain');
    assert.equal(aborted, true);
    assert.equal(seals, cooperative ? 1 : 0);
    const before = writes;
    release({ output: { request_id: 'late' } });
    await outcome;
    assert.equal(writes, before, 'late executor cannot resume capture or request another tool');
    assert.equal(seals, cooperative ? 1 : 0);
  }
  const writer = privateCaptureWriter();
  writer.seal();
  assert.throws(() => writer.written(Buffer.from('late')));
  assert.throws(() => writer.seal());
});

test('actual registered wrapper refuses an unsettled private write without closing or sealing over it', async () => {
  const source = await readFile(
    new URL('./fixtures/harness-wrapper/server.mjs', import.meta.url),
    'utf8',
  );
  let command,
    release,
    entered,
    calls = 0,
    closes = 0,
    seals = 0;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const fixture = runInNewContext(
    source.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', ''),
    {
      Plugin: { define: (v) => v },
      Buffer,
      AbortController,
      captureProducerLifetime: () => captureProducerLifetime(Date.now() + 100),
      privateCaptureWriter,
      invokeRegisteredProceed,
      wrapperCommand,
      open: async () => ({
        writeFile: async () => {
          entered();
          await new Promise((resolve) => {
            release = resolve;
          });
        },
        close: async () => {
          closes++;
        },
      }),
      writeFile: async () => {
        seals++;
      },
    },
  );
  const cleanup = await fixture.setup({
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
    tool: {
      list: async () =>
        ['prepare_approval', 'request_approval'].map((name) => ({
          name,
          options: { namespace: 'proceed' },
          execute: async () => {
            calls++;
          },
        })),
    },
  });
  const pending = command.execute({ sessionID: 'memory', prompt: { text: '' } }).catch(() => {});
  await started;
  await assert.rejects(cleanup(), { code: 'PRODUCER_UNSETTLED' });
  assert.equal(closes, 0);
  assert.equal(seals, 0);
  release();
  await pending;
  assert.equal(calls, 0, 'late private-write completion cannot resume a tool call');
  assert.equal(seals, 0);
});

test('actual composition polling and cleanup own cancellation and refuse late API callbacks without sealing', async () => {
  const source = await readFile(
    new URL('./fixtures/harness-composition/tui.ts', import.meta.url),
    'utf8',
  );
  for (const cooperative of [true, false]) {
    const files = new Map();
    const root = '/run/proceed/qualification-private/';
    let tick,
      release,
      entered,
      aborted = false,
      clock = 0;
    const started = new Promise((r) => {
      entered = r;
    });
    const put = (path, bytes) => files.set(path, String(bytes));
    const fixture = runInNewContext(
      source.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', ''),
      {
        Plugin: { define: (v) => v },
        product: { id: 'memory', setup: async () => async () => {} },
        Buffer,
        AbortController,
        AbortSignal,
        performance,
        process: { versions: { node: 'memory', bun: 'memory' } },
        Date: { now: () => clock },
        randomUUID: () => 'memory-generation',
        captureProducerLifetime: () => captureProducerLifetime(Date.now() + 100),
        compositionHostAction,
        privateCaptureWriter,
        collectionAdmit: () => {},
        collectionLimits: { file: 16 * 1048576 },
        createCompositionSessionReader: () => () => {},
        observeCompositionSelectors: () => ({}),
        readFileSync: (path) => {
          if (path.endsWith('composition-binding.json'))
            return JSON.stringify({ run: 'memory-run', integratedScenario: true });
          if (!files.has(path)) throw Error('missing');
          return files.get(path);
        },
        writeFileSync: put,
        writeFile: async (...args) => put(...args),
        appendFileSync: (path, bytes) => put(path, (files.get(path) ?? '') + bytes),
        setInterval: (f) => {
          tick = f;
          return 1;
        },
        clearInterval: () => {},
      },
    );
    const cleanup = await fixture.setup({
      renderer: { on() {}, off() {}, width: 120, height: 40 },
      app: { version: '2.2.5' },
      data: { session: { list: () => [], sync: async () => {}, get: () => ({ id: 'session' }) } },
      client: {
        session: {
          create: async () => ({ id: 'session' }),
          command: async (_, { signal }) =>
            new Promise((resolve, reject) => {
              release = resolve;
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  if (cooperative) reject(Error('cancelled'));
                },
                { once: true },
              );
              entered();
            }),
        },
      },
    });
    put(
      root + 'composition-action-1.json',
      JSON.stringify({
        kind: 'invoke',
        run: 'memory-run',
        generation: 'memory-generation',
        request: 1,
        sessionID: 'session',
      }),
    );
    tick();
    await started;
    clock = 150000;
    tick();
    assert.equal(aborted, true, 'polling deadline aborts outstanding action controllers');
    if (cooperative) await cleanup();
    else await assert.rejects(cleanup(), { code: 'PRODUCER_UNSETTLED' });
    assert.equal(aborted, true);
    assert.equal(files.has(root + 'composition-api-seal.json'), cooperative);
    const before = JSON.stringify([...files]);
    release({ data: 'late' });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(JSON.stringify([...files]), before, 'no resumed callback or post-seal write');
  }
});

test('actual private inventory retains first fixed receipt/action/inventory refusal without trusting errors', () => {
  const empty = Buffer.alloc(0);
  const base = () => ({
    captures: new Map([
      ['mcp.jsonl', empty],
      ['wrapper.jsonl', empty],
      ['composition-public-api.jsonl', empty],
      ['composition-action-1.json', Buffer.from('{}')],
      ['composition-action-result-1.json', Buffer.from('{}')],
    ]),
    seals: {
      mcp: receipt(empty),
      callbacks: receipt(empty),
      api: { api: receipt(empty), actionSequence: 1, serviceInventoryWritten: false },
    },
  });
  for (const [change, expected] of [
    [(v) => v.captures.delete('mcp.jsonl'), 'SEAL_RECEIPT'],
    [
      (v) => {
        v.seals.callbacks.bytes++;
      },
      'SEAL_RECEIPT',
    ],
    [(v) => v.captures.delete('composition-action-1.json'), 'PROCESSED_ACTION'],
    [(v) => v.captures.delete('composition-action-result-1.json'), 'PROCESSED_ACTION'],
    [
      (v) => {
        v.seals.api.serviceInventoryWritten = true;
      },
      'FILE_INVENTORY',
    ],
  ]) {
    const input = base();
    change(input);
    let stage;
    assert.throws(() =>
      admitIntegratedPrivateInventory(input.captures, input.seals, (next) => {
        stage = next;
      }),
    );
    assert.equal(stage, expected);
    assert.equal(compositionScanReason(Error('raw operand'), stage), expected);
  }
  const valid = base();
  assert.ok(admitIntegratedPrivateInventory(valid.captures, valid.seals));
  for (const stage of [
    'PRODUCER_CLOSE',
    'LISTENER_CLOSE',
    'HOST_STREAMS',
    'PROCESS_ABSENCE',
    'PRIVATE_FILE',
    'SEAL_RECEIPT',
    'PROCESSED_ACTION',
    'CORRELATION',
    'SECRET_CLASSIFICATION',
    'FILE_INVENTORY',
    'FILE_BOUNDS',
    'ACCOUNTING',
    'SCAN',
    'EXPORT',
  ]) {
    const error = Object.assign(Error('credential must not escape'), { code: 'ENOENT' });
    const reason = compositionScanReason(error, stage);
    assert.equal(reason, stage);
    assert.equal(
      safeCompositionDiagnostic({ rawScan: 'REFUSED', scanReason: reason }).scanReason,
      stage,
    );
  }
  assert.equal(
    safeCompositionDiagnostic({ rawScan: 'REFUSED', scanReason: 'private operand' }).scanReason,
    'UNKNOWN',
  );
  let invoked = false;
  const unsafe = Object.defineProperty({}, 'scanReason', {
    get() {
      invoked = true;
      throw Error('secret');
    },
  });
  assert.equal(safeCompositionDiagnostic(unsafe).scanReason, 'UNRUN');
  assert.equal(invoked, false);
});

test('outer maintained post-export verdict requires the exact mode-specific Enter ledger', () => {
  for (const [mode, count] of [
    ['composition', 14],
    ['product-picker-capture', 0],
    ['product-navigation', 1],
  ]) {
    const diagnostic = {
      status: 'PASS',
      keys: { ctrlG: mode === 'composition' ? 5 : 1, enter: count, exit: 1 },
    };
    assertProductCaptureOutcome(mode, '0\n', diagnostic);
    for (const enter of new Set([count - 1, count + 1, 0, 1, 14].filter((n) => n !== count)))
      assert.throws(() =>
        assertProductCaptureOutcome(mode, '0', {
          ...diagnostic,
          keys: { ...diagnostic.keys, enter },
        }),
      );
    assert.throws(() => assertProductCaptureOutcome(mode, '1', diagnostic));
    assert.throws(() => assertProductCaptureOutcome(mode, '0', { ...diagnostic, status: 'FAIL' }));
  }
  assert.throws(() =>
    assertProductCaptureOutcome('platform', '0', { status: 'PASS', keys: { enter: 14 } }),
  );
});

test('actual outer PRODUCT branch admits all transfers before export and mode verdict', async () => {
  const source = await readFile(
    new URL('support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('} else if (productMode) {') + '} else if (productMode) {'.length;
  const end = source.indexOf('} else if (composition) {', start);
  assert.ok(start > 30 && end > start);
  for (const [mode, enter, status, exit, refused] of [
    ['composition', 14, 'PASS', '0', false],
    ['composition', 13, 'PASS', '0', false],
    ['composition', 15, 'PASS', '0', false],
    ['product-picker-capture', 0, 'PASS', '0', false],
    ['product-picker-capture', 14, 'PASS', '0', false],
    ['product-navigation', 1, 'PASS', '0', false],
    ['product-navigation', 14, 'PASS', '0', false],
    ['composition', 14, 'FAIL', '0', false],
    ['composition', 14, 'PASS', '1', false],
    ['composition', 14, 'PASS', '0', true],
  ]) {
    const calls = [];
    const branch = runInNewContext(
      '(async () => {' + source.slice(start, end) + '})',
      {
        mode,
        waited: { stdout: exit },
        productDetailsAttempted: false,
        retainDiagnostic: async () => ({ status, keys: { enter } }),
        transferProductCapture: async () => {
          calls.push('five-transfer-admission');
          if (refused) throw Error('refused synthetic admission');
          return new Map([['synthetic-scan-pass', Buffer.from('synthetic')]]);
        },
        evidenceDestination: (file) => file,
        writeFile: async () => calls.push('export'),
        assertProductCaptureOutcome: (...args) => {
          calls.push('verdict');
          return assertProductCaptureOutcome(...args);
        },
      },
      { timeout: 100 },
    );
    const passes =
      status === 'PASS' &&
      exit === '0' &&
      !refused &&
      enter === { composition: 14, 'product-picker-capture': 0, 'product-navigation': 1 }[mode];
    if (passes) await branch();
    else await assert.rejects(branch());
    assert.deepEqual(
      calls,
      refused ? ['five-transfer-admission'] : ['five-transfer-admission', 'export', 'verdict'],
    );
  }
});

test('labelled current question reconstructs UUID continuation exactly and refuses ambiguous or clipped blocks', () => {
  assert.equal(presentation.context.length, 63);
  const context = lines.indexOf('Context:') + 1;
  const variants = [
    lines.filter((_, i) => i !== context + 1),
    lines.map((s, i) => (i === context ? s.slice(0, -1) : s)),
    lines.map((s, i) =>
      i === context ? lines[context + 1] : i === context + 1 ? lines[context] : s,
    ),
    lines.map((s, i) => (i === context + 1 ? 'X' + s.slice(1) : s)),
    [...lines.slice(0, context), 'Context:', ...lines.slice(context)],
    [...lines, ...lines],
    lines.map((s, i) => (i === context ? presentation.context : i === context + 1 ? '' : s)),
  ];
  for (const values of variants)
    assert.throws(() =>
      observeCurrentQuestion({ raw: paint(values), live, binding, presentation }),
    );
  const padded = lines.map((s) => '    ' + s + '  ');
  observeCurrentQuestion({ raw: paint(padded), live, binding, presentation });
});

test('integrated config connects the sole transparent owner entry and registered server wrapper without a permission override', () => {
  const staging = {
    options: {
      state_dir: '/run/proceed/managed-fixtures/memory',
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: '/run/proceed/qualification-private/memory.token',
    },
    wrapper: '/run/proceed/plugins/wrapper',
    adversary: '/run/proceed/plugins/adversary',
    transport: '/run/proceed/plugins/transport',
  };
  const config = integratedCompositionConfiguration(
    staging,
    '/run/proceed/plugins/product',
    staging.options.state_dir,
  );
  assert.equal(config.cli.plugins[0].options, staging.options);
  assert.ok(config.service.plugins.some((p) => p.package === staging.wrapper));
  assert.deepEqual(Object.keys(config.service.mcp.servers), ['proceed']);
  assert.deepEqual(config.service.mcp.servers.proceed.command, [
    '/usr/local/bin/node',
    '/payload/tests/fixtures/harness-composition/mcp.mjs',
    staging.options.state_dir,
  ]);
  assert.equal(
    config.service.mcp.servers.proceed.environment.PROCEED_TEST_ISOLATED_PID_NAMESPACE,
    '1',
  );
  assert.equal('permissions' in config.service, false);
  assert.equal('agents' in config.service, false);
});

test('integrated ordinary RPC capture failure cannot masquerade as an authorized negative result', async () => {
  const context = {
    client: {
      plugin: {
        list: async () => ({
          data: [{ id: 'proceed.harness', source: { type: 'local' }, features: { tui: true } }],
        }),
      },
      rpc: {
        call: async () => {
          throw Error('ordinary host refusal');
        },
      },
    },
    data: { location: { default: () => ({ directory: 'memory' }) } },
  };
  await assert.rejects(
    compositionHostAction(
      context,
      { kind: 'public-rpc', sessionID: presentation.session_id, presentation },
      new AbortController().signal,
      async (event) => {
        if (event.operation === 'rpc.call') throw Error('memory writer unavailable');
      },
    ),
    /private API capture failed/,
  );
});

test('current question requires every immutable field and all current controls, not old transcript text', () => {
  const raw = paint(lines);
  const seen = observeCurrentQuestion({ raw, live, binding, presentation });
  assert.equal(seen.bytes, raw.length);
  for (let i = 1; i < lines.length; i++) {
    const missing = paint(lines.filter((_, n) => n !== i));
    assert.throws(() => observeCurrentQuestion({ raw: missing, live, binding, presentation }));
  }
  const dismissed = Buffer.concat([raw, paint(['Ask anything'])]);
  assert.throws(() =>
    observeCurrentQuestion({ raw: dismissed, live, binding, presentation, previous: seen }),
  );
  for (const altered of [
    { ...live, live: false },
    { ...live, generation: 'replacement' },
    { ...live, geometry: { ...live.geometry, resizeSequence: 1 } },
  ])
    assert.throws(() => observeCurrentQuestion({ raw, live: altered, binding, presentation }));
});

test('question input rechecks current IO and permanently refuses after loss or final deadline', () => {
  for (const failure of ['dismissed', 'fixed', 'replacement', 'deadline', 'in-reader']) {
    let raw = paint(lines),
      state = structuredClone(live),
      fixed = structuredClone(binding),
      tick = 1;
    let adapter,
      invalidateInReader = false,
      writes = 0;
    adapter = currentQuestionAdapter({
      binding,
      deadline: 10,
      now: () => tick,
      readRaw: () => raw,
      readLive: () => {
        if (invalidateInReader) adapter.invalidate();
        return state;
      },
      readBinding: () => fixed,
    });
    adapter.check(presentation);
    if (failure === 'dismissed') raw = Buffer.concat([raw, paint(['Ask anything'])]);
    if (failure === 'fixed') fixed.inputs = 'changed';
    if (failure === 'replacement') state.generation = 'changed';
    if (failure === 'deadline') tick = 10;
    if (failure === 'in-reader') invalidateInReader = true;
    assert.throws(() => adapter.input(presentation, () => writes++, '\r'));
    raw = paint(lines);
    state = structuredClone(live);
    fixed = structuredClone(binding);
    tick = 1;
    invalidateInReader = false;
    assert.throws(() => adapter.input(presentation, () => writes++, '\r'));
    assert.equal(writes, 0);
  }
});

test('explicit wire adapter requires independently read presentation and preserves exact public route', async () => {
  const calls = [];
  const status = {
    schema_version: 1,
    request_id: presentation.request_id,
    decision_id: null,
    resolution: 'pending',
    response_text: null,
  };
  const h = {
    shared: null,
    operator: { credential: 'synthetic-memory-only' },
    async http(path, key, request) {
      calls.push({ path, key, request });
      return {
        status: 200,
        json: async () =>
          path === '/v1/harness/pending'
            ? { schema_version: 1, presentation: structuredClone(presentation) }
            : status,
      };
    },
  };
  assert.throws(() => requestResultWireAdapter(h, { scenario: null, wait() {} }));
  assert.equal(calls.length, 0);
  const adapter = requestResultWireAdapter(h, {
    scenario: 'request-to-originating-result',
    wait: async (_, predicate) => assert.equal(await predicate(), true),
    now: () => 1,
  });
  const p = await adapter.waitPending('exact-session');
  assert.deepEqual(await adapter.observe(p), { presentation, status });
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/v1/harness/pending', '/v1/harness/presentations/' + presentation.presentation_id],
  );
  assert.deepEqual(calls[1].request.body, {
    harness_id: 'qualification',
    owner_id: 'shared',
    session_id: 'exact-session',
    request_id: presentation.request_id,
  });
  await assert.rejects(adapter.observe({ ...p, session_id: 'foreign-session' }));
  assert.equal(calls.length, 2, 'forged expected presentation cannot initiate a public read');
});

test('integrated raw callback privacy: raw preparation capture must never enter a public scan surface', async () => {
  // tasks.md registered-wrapper contract: raw callback/MCP captures may contain
  // synthetic request capabilities and MUST stay private. W5 also requires full
  // raw capture scanning BEFORE redaction. No broker, adapter or file is opened.
  const records = [];
  const capability = `cap_${'d'.repeat(64)}`;
  const prepared = {
    request_id: presentation.request_id,
    request_handle: `hdl_${'e'.repeat(32)}`,
    request_capability: capability,
  };
  const context = {
    session: {
      get: async () => ({ id: presentation.session_id, agent: 'actual-listed-memory-agent' }),
    },
    agent: { get: async () => ({ data: { id: 'actual-listed-memory-agent' } }) },
    tool: {
      list: async () =>
        ['prepare_approval', 'request_approval'].map((name) => ({
          name,
          options: { namespace: 'proceed' },
          execute: async (input) => {
            if (name === 'request_approval') assert.equal(input.request_capability, capability);
            return {
              output:
                name === 'prepare_approval'
                  ? prepared
                  : { request_id: presentation.request_id, resolution: 'rejected' },
            };
          },
        })),
    },
  };
  await invokeRegisteredProceed(
    context,
    { sessionID: presentation.session_id, prompt: { text: '' } },
    new AbortController().signal,
    async (record) => records.push(record),
  );
  const rawCallback = Buffer.from(records.map((r) => JSON.stringify(r) + '\n').join(''));
  assert.ok(
    rawCallback.includes(Buffer.from(capability)),
    'the real wrapper must retain the unmodified private prepare output',
  );
  const captures = Object.fromEntries(
    ['tui', 'telegram', 'journal', 'diagnostics', 'evidence'].map((name) => [
      name,
      Buffer.from(`complete synthetic ${name}`),
    ]),
  );
  captures.api = rawCallback;
  assert.throws(
    () =>
      scanFrozenComposition({
        captures,
        secrets: ['synthetic-operator', 'synthetic-owner', 'synthetic-control', 'synthetic-psk'],
        complete: true,
        overflow: false,
        measured: true,
      }),
    (error) => {
      assert.equal(compositionScanReason(error, 'SCAN'), 'SECRET_MATCH');
      return true;
    },
  );
});

test('integrated private capture scans decoded original fields before summary and refuses leaked or misplaced authority', async () => {
  const events = [],
    records = [];
  const emit = (direction, message) =>
    events.push({
      connection: 'composition-shared-owner',
      sequence: events.length,
      direction,
      base64: Buffer.from(JSON.stringify(message) + '\n').toString('base64'),
    });
  let ordinal = 0;
  let failWait = false;
  let failPrepare = false;
  const context = {
    session: { get: async ({ sessionID }) => ({ id: sessionID, agent: 'memory-host-agent' }) },
    agent: { get: async () => ({ data: { id: 'memory-host-agent' } }) },
    tool: {
      list: async () =>
        ['prepare_approval', 'request_approval'].map((name) => ({
          name,
          options: { namespace: 'proceed' },
          execute: async (input, invocation) => {
            if (name === 'prepare_approval') ordinal++;
            const n = String(ordinal);
            const prepared = {
              request_id: `req_${n.repeat(32)}`,
              request_handle: `hdl_${n.repeat(32)}`,
              request_capability: `cap_${n.repeat(64)}`,
            };
            const id = 'wire-' + events.length;
            emit('host-to-adapter', {
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name,
                arguments: input,
                _meta: { 'ai.opencode/sessionID': invocation.sessionID },
              },
            });
            const output =
              name === 'prepare_approval'
                ? prepared
                : { request_id: prepared.request_id, resolution: 'rejected' };
            if (name === 'prepare_approval' && failPrepare) {
              emit('adapter-to-host', {
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: 'synthetic preparation failure' },
              });
              throw Error('synthetic preparation failure');
            }
            if (name === 'request_approval' && failWait)
              throw Error('synthetic invocation failure');
            emit('adapter-to-host', {
              jsonrpc: '2.0',
              id,
              result: {
                structuredContent: output,
                content: [{ type: 'text', text: JSON.stringify(output) }],
              },
            });
            return { output };
          },
        })),
    },
  };
  const encode = (v) => Buffer.from(v.map((e) => JSON.stringify(e) + '\n').join(''));
  const secrets = freezeTransportSecrets(secretLedger);
  const snapshot = () => privateInput({ mcp: encode(events), callbacks: encode(records) });
  assert.equal(scanIntegratedPrivateCaptures(snapshot(), secrets).status, 'PASS');
  assert.throws(() =>
    scanIntegratedPrivateCaptures({ ...snapshot(), scenarioSuccess: true }, secrets),
  );
  for (const sessionID of ['memory-first', 'memory-second', 'memory-first']) {
    await invokeRegisteredProceed(
      context,
      { sessionID, prompt: { text: '' } },
      new AbortController().signal,
      async (record) => records.push(record),
    );
    assert.equal(scanIntegratedPrivateCaptures(snapshot(), secrets).status, 'PASS');
  }
  const input = privateInput({
    mcp: encode(events),
    callbacks: encode(records),
    other: [Buffer.from('{}')],
    scenarioSuccess: true,
  });
  assert.equal(scanIntegratedPrivateCaptures(input, secrets).status, 'PASS');
  // Exercise the maintained consumer with real framed/receipted inputs. Base64
  // and JSON escapes must not hide authority in names, even at allowed values.
  const unknownCap = `cap_${'0123456789abcdef'.repeat(4)}`;
  assert.ok(secrets.every((secret) => !unknownCap.includes(secret)));
  const knownCap = `cap_${'1'.repeat(64)}`;
  const escapeKey = (key) =>
    [...key].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  for (const [label, key, nested, escaped, expected] of [
    ['unknown capability', unknownCap, false, false, /capability outside/],
    ['escaped capability', unknownCap, false, true, /capability outside/],
    ['listed secret', secrets[0], false, true, /private authority leak/],
    ['nested capability', unknownCap, true, true, /capability outside/],
    ['known capability illegal name', knownCap, false, true, /capability outside/],
  ]) {
    const property = escaped ? escapeKey(key) : key;
    const json = `{\"${property}\":\"harmless\"}`;
    const extra = nested ? `{\"ordinary\":[${json}]}` : json;
    for (const surface of ['mcp', 'callbacks', 'other']) {
      let candidate;
      if (surface === 'mcp') {
        const changed = structuredClone(events);
        // The preparation result already has a legal capability value. Name
        // inspection must never inherit that value's field-placement exception.
        const event = changed.find((e) => e.direction === 'adapter-to-host');
        const message = Buffer.from(event.base64, 'base64').toString().trim();
        event.base64 = Buffer.from(message.slice(0, -1) + ',"extra":' + extra + '}\n').toString(
          'base64',
        );
        candidate = privateInput({ ...input, mcp: encode(changed) });
      } else if (surface === 'callbacks') {
        candidate = privateInput({
          ...input,
          callbacks: Buffer.concat([input.callbacks, Buffer.from(extra + '\n')]),
        });
      } else candidate = { ...input, other: [Buffer.from(extra)] };
      let refusalStage;
      assert.throws(
        () =>
          scanIntegratedPrivateCaptures(
            {
              ...candidate,
              stage: (next) => {
                refusalStage = next;
              },
            },
            secrets,
          ),
        expected,
        `${surface}: ${label}`,
      );
      assert.equal(refusalStage, 'SECRET_CLASSIFICATION');
    }
  }
  for (const key of ['ordinary', 'cap_hint', `cap_${'A'.repeat(64)}`, 'request_capability']) {
    const ordinary = { [key]: 'harmless', nested: [{ ordinary: 'safe' }] };
    const changed = structuredClone(events);
    const body = JSON.parse(Buffer.from(changed[0].base64, 'base64').toString());
    body.params.extra = ordinary;
    changed[0].base64 = Buffer.from(JSON.stringify(body) + '\n').toString('base64');
    assert.equal(
      scanIntegratedPrivateCaptures(
        privateInput({
          ...input,
          mcp: encode(changed),
          callbacks: Buffer.concat([input.callbacks, Buffer.from(JSON.stringify(ordinary) + '\n')]),
          other: [Buffer.from(JSON.stringify(ordinary))],
        }),
        secrets,
      ).status,
      'PASS',
    );
  }
  for (const bad of [
    { ...input, receipts: undefined },
    { ...input, mcp: Buffer.alloc(0) },
    { ...input, receipts: { ...input.receipts, mcp: { ...input.receipts.mcp, complete: false } } },
    { ...input, secretLedger: { ...secretLedger, secrets: secretLedger.secrets.slice(1) } },
  ]) {
    let stage;
    assert.throws(() =>
      scanIntegratedPrivateCaptures(
        {
          ...bad,
          stage: (next) => {
            stage = next;
          },
        },
        secrets,
      ),
    );
    assert.equal(
      stage,
      bad.secretLedger !== input.secretLedger ? 'SECRET_CLASSIFICATION' : 'SEAL_RECEIPT',
    );
  }
  assert.throws(() => scanIntegratedPrivateCaptures(input, secrets.slice(1)));
  const wrongSession = structuredClone(records);
  wrongSession.find((r) => r.phase === 'prepare-returned').sessionID = 'unrelated';
  let firstStage;
  assert.throws(() =>
    scanIntegratedPrivateCaptures(
      {
        ...privateInput({ ...input, callbacks: encode(wrongSession) }),
        stage: (next) => {
          firstStage = next;
        },
      },
      secrets,
    ),
  );
  assert.equal(firstStage, 'CORRELATION');
  for (const value of [
    `hop_${'e'.repeat(64)}`,
    `cap_${'f'.repeat(64)}`,
    { operator_credential: 'unclassified' },
  ])
    assert.throws(() =>
      scanIntegratedPrivateCaptures(
        { ...input, other: [Buffer.from(JSON.stringify(value))] },
        secrets,
      ),
    );
  assert.throws(
    () =>
      scanIntegratedPrivateCaptures(
        { ...input, other: [Buffer.from(`cap_${'1'.repeat(64)}`)] },
        secrets,
      ),
    /capability outside/,
  );
  assert.throws(
    () =>
      scanIntegratedPrivateCaptures(
        privateInput({
          ...input,
          callbacks: Buffer.concat([
            input.callbacks,
            Buffer.from(JSON.stringify({ phase: 'extra', value: 'synthetic-operator' }) + '\n'),
          ]),
        }),
        secrets,
      ),
    /raw private authority leak/,
  );
  const mutated = structuredClone(events);
  const body = JSON.parse(Buffer.from(mutated[0].base64, 'base64').toString());
  body.params.extra = 'synthetic-operator';
  mutated[0].base64 = Buffer.from(JSON.stringify(body) + '\n').toString('base64');
  assert.throws(
    () => scanIntegratedPrivateCaptures(privateInput({ ...input, mcp: encode(mutated) }), secrets),
    /raw private authority leak/,
  );
  events.length = 0;
  records.length = 0;
  ordinal = 0;
  failWait = true;
  await assert.rejects(
    invokeRegisteredProceed(
      context,
      { sessionID: 'memory-partial', prompt: { text: '' } },
      new AbortController().signal,
      async (record) => records.push(record),
    ),
  );
  assert.equal(scanIntegratedPrivateCaptures(snapshot(), secrets).status, 'PASS');
  assert.throws(() =>
    scanIntegratedPrivateCaptures({ ...snapshot(), scenarioSuccess: true }, secrets),
  );
  const incomplete = structuredClone(events);
  incomplete.at(-1).base64 = Buffer.from('{').toString('base64');
  assert.throws(() =>
    scanIntegratedPrivateCaptures(
      privateInput({ ...snapshot(), mcp: encode(incomplete) }),
      secrets,
    ),
  );
  events.length = 0;
  records.length = 0;
  failWait = false;
  failPrepare = true;
  await assert.rejects(
    invokeRegisteredProceed(
      context,
      { sessionID: 'memory-failed-prepare', prompt: { text: '' } },
      new AbortController().signal,
      async (record) => records.push(record),
    ),
  );
  assert.equal(scanIntegratedPrivateCaptures(snapshot(), secrets).status, 'PASS');
});

test('actual registered wrapper seals zero and failed partial callback captures only after owned writes and invocations drain', async () => {
  const source = await readFile(
    new URL('./fixtures/harness-wrapper/server.mjs', import.meta.url),
    'utf8',
  );
  for (const partial of [false, true]) {
    let raw = Buffer.alloc(0),
      command,
      closed = false,
      disposed = false;
    const seals = new Map();
    const fixture = runInNewContext(
      source.replace(/^import[\s\S]*?from '[^']+';\s*/gm, '').replace('export default ', ''),
      {
        Plugin: { define: (v) => v },
        Buffer,
        AbortController,
        setTimeout,
        clearTimeout,
        privateCaptureWriter,
        invokeRegisteredProceed,
        captureProducerLifetime,
        wrapperCommand: 'proceed-qualification-request',
        open: async () => ({
          writeFile: async (bytes) => {
            assert.equal(closed, false);
            raw = Buffer.concat([raw, bytes]);
          },
          close: async () => {
            closed = true;
          },
        }),
        writeFile: async (path, bytes) => {
          assert.ok(closed && disposed);
          seals.set(path, JSON.parse(bytes));
        },
      },
    );
    const prepared = {
      request_id: 'req_' + '1'.repeat(32),
      request_handle: 'hdl_' + '1'.repeat(32),
      request_capability: 'cap_' + '1'.repeat(64),
    };
    const cleanup = await fixture.setup({
      app: { version: '2.2.5' },
      command: {
        transform: async (edit) => {
          edit({
            add: (v) => {
              command = v;
            },
          });
          return {
            dispose: async () => {
              disposed = true;
            },
          };
        },
      },
      session: { get: async ({ sessionID }) => ({ id: sessionID, agent: 'selected' }) },
      agent: { get: async () => ({ data: { id: 'selected' } }) },
      tool: {
        list: async () =>
          ['prepare_approval', 'request_approval'].map((name) => ({
            name,
            options: { namespace: 'proceed' },
            execute: async () => {
              if (name === 'request_approval') throw Error('native partial failure');
              return { output: prepared };
            },
          })),
      },
    });
    if (partial)
      await assert.rejects(command.execute({ sessionID: 'native-session', prompt: { text: '' } }));
    await cleanup();
    assertPrivateCaptureReceipt(
      raw,
      seals.get('/run/proceed/qualification-private/wrapper-seal.json'),
    );
    assert.equal(raw.length > 0, partial);
    if (partial)
      assert.deepEqual(
        raw
          .toString()
          .trim()
          .split('\n')
          .map((s) => JSON.parse(s).phase),
        ['prepare-started', 'prepare-returned', 'wait-started'],
      );
  }
});

test('integrated maintained entry executes registered calls, both navigation fences, current choice cells and reverse original results', async () => {
  // Fully memory-only compound route control. Actual driver, wrapper, cell
  // decoder, role/identity fences and original-result comparators run unchanged.
  // These synthetic PTY/API/broker operands are NOT actual-host or human proof.
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const sessions = [1, 2].map((n) => ({
    id: `memory-session-${n}`,
    title: 'Equal host title',
    ordinal: `Session ${n}`,
  }));
  const fixed = {
    scope: 'product-capture',
    executable: hash('memory'),
    package: hash('package'),
    wrapper: hash('wrapper'),
    config: hash('{}'),
    configBytes: '{}',
    source: '9bbb8ce18c80f099e0e448775f59d965ead40a21',
    rendererSource: '738067f47e940dcec3f5aab74868908574335c6c',
    sourceBinding: 'PINNED_IMAGE_PROVENANCE_NOT_RUNTIME_ACCESSOR',
    environment: { TERM: 'memory' },
    terminalResponsePolicy: [{ query: 'memory', flags: 'g', reply: 'memory' }],
  };
  fixed.payload = [
    'package.json',
    'src/harness/tui-entry.js',
    'bin/proceed-mcp.js',
    'tests/fixtures/harness-composition/tui.ts',
  ];
  fixed.inputs = fixed.payload.map((path) => ({
    path,
    sha256:
      path === 'package.json'
        ? fixed.package
        : path.endsWith('tui.ts')
          ? fixed.wrapper
          : hash(path),
  }));
  const runtime = { version: '2.2.5', bun: '1.4.4', node: '24.22.2', sessions };
  const bound = {
    ...fixed,
    runtime: { version: runtime.version, bun: runtime.bun, node: runtime.node },
    run: 'memory-run',
    setup: 'memory-setup',
    geometry: { width: 120, height: 40, resizeSequence: 0 },
  };
  const live = {
    live: true,
    run: bound.run,
    generation: bound.setup,
    geometry: bound.geometry,
    snapshot: sessions,
  };
  let raw = Buffer.from('\x1b[?1049h'),
    screen = 'host',
    selected = 0,
    chosenSession,
    activePresentation,
    next = 0;
  const writes = [],
    events = [],
    callbacks = [],
    actions = new Map(),
    requests = new Map(),
    reserved = new Map(),
    completion = [];
  const paint = (values, role = -1) => {
    raw = Buffer.concat([
      raw,
      Buffer.from(
        '\x1b[?2026h' +
          Array.from({ length: 40 }, (_, i) => `\x1b[${i + 1};1H\x1b[0m${' '.repeat(120)}`).join(
            '',
          ) +
          values
            .map(
              (text, i) =>
                `\x1b[${i + 1};1H` +
                (i === role
                  ? '\x1b[1;38;2;255;255;255;48;2;10;20;30m'
                  : '\x1b[0;38;2;0;0;0;48;2;200;200;200m') +
                text,
            )
            .join('') +
          '\x1b[0m\x1b[?2026l',
      ),
    ]);
  };
  paint(['2.2.5', 'Ask anything']);
  const hostFrame = compositionSourceFrame(raw.toString()).text;
  const picker = () => {
    screen = 'picker';
    selected = 0;
    paint(['Select the Proceed session', ...sessions.map((s) => s.ordinal + ' - ' + s.title)], 1);
  };
  const question = () => {
    screen = 'question';
    selected = 0;
    activePresentation = requests.get(chosenSession).presentation;
    const body = questionLines(activePresentation);
    paint(body, body.indexOf('Reject'));
  };
  const emit = (direction, message) =>
    events.push({
      connection: 'composition-shared-owner',
      sequence: events.length,
      direction,
      base64: Buffer.from(JSON.stringify(message) + '\n').toString('base64'),
    });
  const settle = (choice, text = null) => {
    const r = requests.get(chosenSession);
    assert.equal(r.status.resolution, 'pending');
    r.effects++;
    r.status = {
      schema_version: 1,
      request_id: r.presentation.request_id,
      decision_id: `dec_${String(r.number).repeat(32)}`,
      resolution: { approve: 'approved', reject: 'rejected', respond: 'responded' }[choice],
      response_text: text,
    };
    r.finish(r.status);
    completion.push(chosenSession);
    screen = 'host';
    paint(['2.2.5', 'Ask anything']);
  };
  const send = (bytes) => {
    writes.push(bytes);
    if (bytes === '\x07') return picker();
    if (bytes === '\x1b') {
      screen = 'host';
      paint(['2.2.5', 'Ask anything']);
      return;
    }
    if (bytes === '\x1b[B' || bytes === '\x1b[A') {
      selected += bytes === '\x1b[B' ? 1 : -1;
      if (screen === 'picker')
        paint(
          ['Select the Proceed session', ...sessions.map((s) => s.ordinal + ' - ' + s.title)],
          selected + 1,
        );
      else {
        assert.equal(screen, 'question');
        const body = questionLines(activePresentation);
        paint(body, selected + body.indexOf('Reject'));
      }
      return;
    }
    if (screen === 'picker' && bytes === '\r') {
      chosenSession = sessions[selected].id;
      screen = 'identity';
      const s = sessions[selected];
      paint([
        'Open Proceed question?',
        s.ordinal,
        'Navigation only - no decision',
        'Title:',
        s.title,
        'Exact session ID:',
        s.id,
        '',
        'Open question   Cancel',
      ]);
      return;
    }
    if (screen === 'identity' && bytes === '\r') return question();
    if (screen === 'question' && bytes === '\r') {
      if (selected === 1) {
        screen = 'response';
        paint([
          'Proceed response for ' + activePresentation.request_id,
          'Text is recorded as instructions for this request and is never an approval.',
        ]);
        return;
      }
      return settle(selected === 0 ? 'reject' : 'approve');
    }
    assert.equal(screen, 'response');
    assert.equal(bytes, 'approved\r');
    settle('respond', 'approved');
  };
  const server = {
    session: { get: async ({ sessionID }) => ({ id: sessionID, agent: 'listed-memory-agent' }) },
    agent: { get: async () => ({ data: { id: 'listed-memory-agent' } }) },
    tool: {
      list: async () =>
        ['prepare_approval', 'request_approval'].map((name) => ({
          name,
          options: { namespace: 'proceed' },
          execute: async (input, invocation) => {
            const id = 'original-wire-' + events.length;
            emit('host-to-adapter', {
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name,
                arguments: input,
                _meta: { 'ai.opencode/sessionID': invocation.sessionID },
              },
            });
            let output;
            if (name === 'prepare_approval') {
              const n = ++next;
              output = {
                request_id: `req_${String(n).repeat(32)}`,
                request_handle: `hdl_${String(n).repeat(32)}`,
                request_capability: `cap_${String(n).repeat(64)}`,
              };
              reserved.set(invocation.sessionID, { output, n });
            } else {
              const { output: p, n } = reserved.get(invocation.sessionID);
              assert.equal(input.request_capability, p.request_capability);
              const presentation = {
                ...p,
                request_handle: undefined,
                request_capability: undefined,
                presentation_id: `hpr_${String(n).repeat(32)}`,
                session_id: invocation.sessionID,
                session_label: 'Equal qualification label',
                action: input.action,
                context: input.context,
                expires_at: '2030-01-01T00:00:00.000Z',
              };
              delete presentation.request_handle;
              delete presentation.request_capability;
              output = await new Promise((finish) =>
                requests.set(invocation.sessionID, {
                  presentation,
                  number: n,
                  finish,
                  effects: 0,
                  status: {
                    schema_version: 1,
                    request_id: p.request_id,
                    decision_id: null,
                    resolution: 'pending',
                    response_text: null,
                  },
                }),
              );
            }
            emit('adapter-to-host', {
              jsonrpc: '2.0',
              id,
              result: {
                structuredContent: output,
                content: [{ type: 'text', text: JSON.stringify(output) }],
              },
            });
            return { output };
          },
        })),
    },
  };
  let foreground = { type: 'home' };
  const publicContext = {
    client: {
      session: {
        command: ({ sessionID }) =>
          invokeRegisteredProceed(
            server,
            { sessionID, prompt: { text: '' } },
            new AbortController().signal,
            async (e) => callbacks.push(e),
          ),
        form: { create: async () => ({ id: 'real-memory-form' }), reply: async () => {} },
        synthetic: async (input) => {
          assert.equal(input.resume, false);
          return { id: 'memory-record' };
        },
      },
      plugin: {
        list: async () => ({
          data: [
            {
              id: 'proceed.harness',
              source: { type: 'local', path: 'memory' },
              features: { tui: true },
            },
          ],
        }),
      },
      rpc: {
        call: async () => {
          throw Error('unregistered');
        },
      },
    },
    keymap: { dispatch: () => picker() },
    data: {
      location: { default: () => ({ directory: 'memory' }) },
      session: { get: (id) => sessions.find((s) => s.id === id) },
    },
    ui: {
      router: {
        navigate: (route) => {
          foreground = route;
        },
        current: () => foreground,
      },
    },
  };
  const wait = async (label, predicate) => {
    for (let i = 0; i < 500; i++) {
      if (await predicate()) return;
      await Promise.resolve();
    }
    assert.fail('native compound wait ' + label);
  };
  const wire = {
    connection: 'composition-shared-owner',
    captureArmed: async () => true,
    waitPending: async (id) => {
      await wait('pending', () => requests.get(id)?.status.resolution === 'pending');
      return requests.get(id).presentation;
    },
    observe: async (p) => ({ presentation: p, status: requests.get(p.session_id).status }),
    waitRetainedOutcome: async (p) => requests.get(p.session_id).status,
    readPrivateCapture: async () => events,
    readPrivateCallbacks: async () => callbacks,
    readInteractionExchanges: async () => events.length,
    directAttack: async () => {},
    assertSingleDurableEffect: async (p) => assert.equal(requests.get(p.session_id).effects, 1),
    assertStaleAndLosingNonEffect: async () => {},
    assertOldCannotResolveNew: async (old, p) => assert.notEqual(old.request_id, p.request_id),
  };
  const io = {
    readBinding: () => bound,
    readLive: () => live,
    readRaw: () => raw,
    readExecutionBinding: () => fixed,
    send,
    readObservation: () => live,
    writeObservation() {},
    pause: async () => {},
    hostFrame: () => hostFrame,
    writeAction(request) {
      actions.set(request.request, { ...request, state: 'STARTED' });
      compositionHostAction(publicContext, request, new AbortController().signal).then(
        (value) =>
          actions.set(request.request, {
            ...request,
            state: 'COMPLETE',
            ...(request.kind === 'switch-foreground' ? value : {}),
          }),
        (error) =>
          actions.set(request.request, { ...request, state: 'FAILED', error: error.message }),
      );
    },
    readAction: (n) => actions.get(n) ?? null,
  };
  const bridge = async (o) => {
    const index = sessions.findIndex((s) => s.id === o.intendedSession.id);
    let enters = 0;
    const observer = createProductNavigationObserver({
      binding: bound,
      snapshot: sessions,
      sample: () => ({ binding: bound, raw, snapshot: sessions, live }),
      now: () => 1,
      deadline: 100,
      targetIndex: index,
      moveDown: o.moveDown,
      moveUp: o.moveUp,
      enter: () => (enters++ === 0 ? o.pickerEnter() : o.openQuestion()),
    });
    return {
      ...observer,
      openPicker: o.openPicker,
      pickerEnter: () => observer.pickerEnter(sessions[index]),
    };
  };
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export async function compositionIntegratedScenario(');
  const finish = source.indexOf('// TEST ONLY. File-observation/PTY', start);
  assert.ok(start >= 0 && finish > start);
  assert.match(source, /integratedResult\s*=\s*await compositionIntegratedScenario\(/);
  const actualEntry = runInNewContext(
    '(' + source.slice(start + 'export '.length, finish).trim() + ')',
    { assert, runCompositionRequestResult },
    { timeout: 100 },
  );
  const result = await actualEntry({
    wire,
    io,
    bridge,
    binding: bound,
    executionBinding: fixed,
    runtime,
    wait,
    now: () => 1,
    deadline: 100,
    ready: async (open) => open(),
  });
  assert.equal(result.assertion, 'AUTOMATED_COMPOSITION_PROXY');
  assert.equal(result.human, 'UNRUN');
  assert.equal(result.request_ids.length, 3);
  assert.deepEqual(completion, [sessions[1].id, sessions[0].id, sessions[0].id]);
  assert.ok(writes.includes('approved\r'));
  const enters = writes.filter((s) => s === '\r' || s === 'approved\r').length;
  assert.equal(enters, 14, 'actual maintained scenario ledger');
  assert.deepEqual(
    Object.fromEntries(
      [
        ['ctrlG', '\x07'],
        ['down', '\x1b[B'],
        ['up', '\x1b[A'],
        ['escape', '\x1b'],
      ].map(([name, bytes]) => [name, writes.filter((s) => s === bytes).length]),
    ),
    { ctrlG: 5, down: 9, up: 3, escape: 2 },
    'scenario keys exclude outer enrollment Escape/Ctrl+E and owned exit',
  );
  assertProductCaptureOutcome('composition', '0', { status: 'PASS', keys: { enter: enters } });
  assert.equal([...actions.values()].filter((a) => a.kind === 'invoke').length, 3);
  assert.equal([...actions.values()].filter((a) => a.kind === 'switch-foreground').length, 3);
  assert.equal([...actions.values()].filter((a) => a.kind === 'programmatic-command').length, 1);
  for (const kind of ['native-form-reply', 'synthetic-record', 'public-rpc'])
    assert.equal([...actions.values()].filter((a) => a.kind === kind).length, 5);
});
