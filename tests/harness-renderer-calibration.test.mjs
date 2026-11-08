import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compositionCurrentFrame } from './support/harness-composition-readiness.mjs';
import {
  rendererScan,
  rendererSurfaces,
  assertRendererExport,
  emittedLabels,
  rendererPayload,
  safeRendererDiagnostic,
  rendererStep,
  rendererCheckpoint,
  rendererCursor,
  rendererCaptureCheck,
  assertRendererCursor,
  assertRendererStyles,
  rendererStyleFacts,
  rendererSize,
  rendererReadFile,
  rendererDiagnostics,
  rendererCells,
  rendererDiagnosticSequence,
  rendererDiagnosticAnalysis,
  rendererMetadataInventory,
  inventoryLimits,
  incompleteInventory,
  safeRendererInventory,
  encodeRendererInventory,
  parseRendererInventory,
  parseInventoryArchive,
  inventoryAdmit,
} from './support/harness-renderer-observation.mjs';

const metadataRoots = { state: '/run/proceed/state', evidence: '/run/proceed/evidence' };
const requiredInventoryNames = [
  'binding.json',
  'observations.json',
  'fixture.jsonl',
  'inventory.json',
  'transcript.ansi',
  'progress.jsonl',
];

test('shared admission invariant tests every approved bigint ceiling exactly and above without conversion', () => {
  for (const ceiling of [
    16384n,
    32768n,
    16382n,
    64n,
    4096n,
    4194304n,
    8388608n,
    9007199254740991n,
  ]) {
    assert.doesNotThrow(() => inventoryAdmit(ceiling, ceiling));
    assert.throws(() => inventoryAdmit(ceiling + 1n, ceiling));
    assert.throws(() => inventoryAdmit(-1n, ceiling));
    assert.throws(() => inventoryAdmit(Number(ceiling), ceiling));
  }
  assert.equal(inventoryLimits.entries, 16384n);
  assert.equal(inventoryLimits.visits, 32768n);
  assert.equal(inventoryLimits.files, 16382n);
  assert.equal(inventoryLimits.depth, 64n);
  assert.equal(inventoryLimits.path, 4096n);
  assert.equal(inventoryLimits.paths, 4194304n);
  assert.equal(inventoryLimits.retained, 8388608n);
  assert.equal(inventoryLimits.milliseconds, 30000);
  assert.equal(inventoryLimits.output, 8192);
});
function metadataFixture(hook = () => {}) {
  const nodes = new Map(
    Object.values(metadataRoots).map((p) => [p, { directory: true, size: 0n }]),
  );
  for (const [i, name] of [...requiredInventoryNames, 'host.log'].entries())
    nodes.set(metadataRoots.evidence + '/' + name, { size: BigInt(i + 1) });
  let active = 0,
    opened = 0,
    closed = 0,
    pass = 0,
    reads = 0;
  const snapshot = (path) => {
    const node = nodes.get(path);
    if (!node) throw new Error('synthetic missing');
    return {
      dev: 1n,
      ino: 2n,
      mtimeNs: 3n,
      ctimeNs: 4n,
      size: node.size,
      isFile: () => !node.directory && !node.special,
      isDirectory: () => !!node.directory,
      isSymbolicLink: () => !!node.link,
      ...node.metadata,
    };
  };
  const acquire = () => {
    assert.equal(active++, 0, 'one descriptor at a time');
    opened++;
  };
  const close = async () => {
    assert.equal(active--, 1);
    closed++;
  };
  const io = {
    flags: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
    async lstat(path, options) {
      assert.deepEqual(options, { bigint: true });
      if (path === metadataRoots.state) pass++;
      hook('lstat', path, nodes, pass);
      return snapshot(path);
    },
    async open(path, flags) {
      assert.equal(flags, 133120);
      hook('open', path, nodes, pass);
      acquire();
      return {
        async stat(options) {
          assert.deepEqual(options, { bigint: true });
          hook('fstat', path, nodes, pass);
          return snapshot(path);
        },
        read() {
          reads++;
          throw new Error('CONTENT_READ_FORBIDDEN');
        },
        close,
      };
    },
    async opendir(path, options) {
      assert.equal(options.bufferSize, 1);
      hook('opendir', path, nodes, pass);
      acquire();
      const names = [...nodes.keys()].filter(
        (p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'),
      );
      let index = 0;
      return {
        async read() {
          hook('dirread', path, nodes, pass);
          return index < names.length ? { name: names[index++].slice(path.length + 1) } : null;
        },
        close,
      };
    },
    readFile() {
      reads++;
      throw new Error('CONTENT_READ_FORBIDDEN');
    },
  };
  return {
    nodes,
    io,
    async run(limits = inventoryLimits, clock = () => 0, endpoint = 30000) {
      const result = await rendererMetadataInventory(metadataRoots, endpoint, io, limits, clock);
      assert.equal(active, 0);
      assert.equal(opened, closed);
      assert.equal(reads, 0);
      return result;
    },
  };
}

test('metadata inventory has two complete stable passes, no content reads and faithful duplicate projections', async () => {
  let statePasses = 0;
  const f = metadataFixture((op, path) => {
    if (op === 'opendir' && path === metadataRoots.state) statePasses++;
  });
  const result = await f.run();
  assert.equal(result.complete, true);
  assert.equal(statePasses, 2);
  assert.deepEqual(result.roots.state, { entries: 1, files: 0, bytes: 0, maxSize: 0 });
  assert.deepEqual(result.roots.evidence, { entries: 8, files: 7, bytes: 28, maxSize: 7 });
  assert.deepEqual(result.requiredLogs, { count: 1, bytes: 7 });
  const paths = [...f.nodes.keys()],
    files = paths.filter((p) => !f.nodes.get(p).directory);
  assert.equal(
    result.totalPathBytes,
    paths.reduce((n, p) => n + Buffer.byteLength(p), 0),
  );
  assert.equal(result.projections.tui, 5);
  assert.equal(result.projections.fixture, 3);
  assert.equal(result.projections.inventory, 4);
  assert.equal(result.projections.diagnostics, 7);
  assert.equal(result.projections.state, 0);
  assert.equal(
    result.projections.evidence,
    28 + files.reduce((n, p) => n + Buffer.byteLength(p), 0),
  );
  const scan = {
    status: 'PASS',
    scope: 'renderer-only',
    surfaces: rendererSurfaces,
    hashes: Object.fromEntries(rendererSurfaces.map((s) => [s, '0'.repeat(64)])),
    absentByDesign: ['broker', 'journal', 'telegram', 'approval-api'],
    productSixSurfaceGate: 'NOT_APPLICABLE_NOT_PASSED',
    files: files.map((path) => ({
      path,
      sha256: '0'.repeat(64),
      bytes: Number(f.nodes.get(path).size),
    })),
  };
  assert.equal(result.projections.detailedExport, 21 + 7 + Buffer.byteLength(JSON.stringify(scan)));
  assert.equal(JSON.stringify(result).includes('/run/'), false);
  assert.equal(JSON.stringify(result).includes('PASS'), false);
});

test('inventory entry/visit/file/depth ceilings admit exact values and refuse above', async () => {
  for (const [key, exact] of [
    ['entries', 9n],
    ['visits', 18n],
    ['files', 7n],
    ['depth', 1n],
  ]) {
    assert.equal(
      (await metadataFixture().run({ ...inventoryLimits, [key]: exact })).complete,
      true,
      key,
    );
    if (exact > 1n)
      assert.deepEqual(
        await metadataFixture().run({ ...inventoryLimits, [key]: exact - 1n }),
        incompleteInventory(),
        key,
      );
  }
  for (const depth of [64, 65]) {
    const f = metadataFixture();
    let path = metadataRoots.state;
    for (let n = 0; n < depth; n++) {
      path += '/d';
      f.nodes.set(path, { directory: true, size: 0n });
    }
    assert.equal((await f.run()).complete, depth === 64);
  }
  for (const bytes of [4096, 4097]) {
    const f = metadataFixture();
    const path = metadataRoots.state + '/' + 'x'.repeat(bytes - metadataRoots.state.length - 1);
    f.nodes.set(path, { size: 0n });
    assert.equal((await f.run()).complete, bytes === 4096);
  }
});

test('inventory explicit path and serialized-bookkeeping budgets have deterministic exact cutoffs', async () => {
  for (const key of ['paths', 'retained']) {
    let low = 1n,
      high = inventoryLimits[key];
    while (low < high) {
      const mid = (low + high) / 2n;
      if ((await metadataFixture().run({ ...inventoryLimits, [key]: mid })).complete) high = mid;
      else low = mid + 1n;
    }
    assert.ok(low > 100n);
    assert.equal((await metadataFixture().run({ ...inventoryLimits, [key]: low })).complete, true);
    assert.deepEqual(
      await metadataFixture().run({ ...inventoryLimits, [key]: low - 1n }),
      incompleteInventory(),
    );
  }
});

test('metadata rejects missing evidence/logs, unsafe bigint metadata and all observed instability', async () => {
  for (const fault of [
    'missing',
    'logs',
    'link',
    'special',
    'negative',
    'unsafe',
    'number',
    'unavailable',
    'growth',
    'replacement',
    'rewrite',
    'membership',
    'directory',
    'unreadable',
    'traversal',
  ]) {
    let changed = false,
      passes = 0;
    const target = metadataRoots.evidence + '/host.log';
    const f = metadataFixture((op, path, nodes) => {
      if (op === 'opendir' && path === metadataRoots.state) passes++;
      if (op === 'fstat' && path === target && !changed) {
        changed = true;
        if (fault === 'growth') nodes.get(path).size++;
        if (fault === 'replacement') nodes.get(path).metadata = { ino: 9n };
        if (fault === 'rewrite') nodes.get(path).metadata = { mtimeNs: 9n };
      }
      if (
        passes === 2 &&
        op === 'opendir' &&
        path === metadataRoots.evidence &&
        fault === 'membership'
      )
        nodes.set(metadataRoots.evidence + '/new', { size: 0n });
      if (
        passes === 2 &&
        op === 'lstat' &&
        path === metadataRoots.evidence &&
        fault === 'directory'
      )
        nodes.get(path).metadata = { ctimeNs: 9n };
      if (op === 'open' && fault === 'unreadable') throw new Error('private');
      if (op === 'dirread' && fault === 'traversal') throw new Error('private');
    });
    if (fault === 'missing') f.nodes.delete(metadataRoots.evidence + '/observations.json');
    if (fault === 'logs') f.nodes.delete(target);
    if (fault === 'link') f.nodes.get(target).link = true;
    if (fault === 'special') f.nodes.get(target).special = true;
    if (fault === 'negative') f.nodes.get(target).size = -1n;
    if (fault === 'unsafe') f.nodes.get(target).size = 9007199254740992n;
    if (fault === 'number') f.nodes.get(target).size = 1;
    if (fault === 'unavailable') f.nodes.get(target).metadata = { mtimeNs: undefined };
    assert.deepEqual(await f.run(), incompleteInventory(), fault);
  }
  const f = metadataFixture();
  for (const name of requiredInventoryNames)
    f.nodes.get(metadataRoots.evidence + '/' + name).size = 2000000000000000n;
  assert.deepEqual(await f.run(), incompleteInventory(), 'aggregate bigint overflow');
});

test('inventory shared deadline and output budget refuse without extension and close open resources', async () => {
  for (const expiredAt of [1, 4, 10, 30, 70, 150]) {
    let calls = 0;
    const f = metadataFixture();
    assert.deepEqual(
      await f.run(inventoryLimits, () => (++calls < expiredAt ? 0 : 30000)),
      incompleteInventory(),
    );
  }
  assert.deepEqual(await metadataFixture().run(inventoryLimits, () => 1, 1), incompleteInventory());
  const result = await metadataFixture().run();
  const exact = Buffer.byteLength(JSON.stringify(result));
  assert.equal((await metadataFixture().run({ ...inventoryLimits, output: exact })).complete, true);
  assert.deepEqual(
    await metadataFixture().run({ ...inventoryLimits, output: exact - 1 }),
    incompleteInventory(),
  );
});

test('inventory closed schema rejects accessors, hooks, unknown fields and unsafe output values', async () => {
  const good = await metadataFixture().run();
  assert.deepEqual(parseRendererInventory(Buffer.from(encodeRendererInventory(good))), good);
  for (const mutate of [
    (v) => {
      v.path = 'private';
    },
    (v) => {
      v.toJSON = () => {
        throw new Error('must not run');
      };
    },
    (v) => {
      v.projections.state = 9007199254740992;
    },
    (v) => {
      v.projections.state = -1;
    },
    (v) => {
      v.projections.state = NaN;
    },
    (v) => {
      v.projections.state = 1.5;
    },
    (v) => {
      Object.defineProperty(v, 'complete', {
        get() {
          assert.fail('accessor');
        },
      });
    },
    (v) => {
      Object.defineProperty(v.roots.state, 'bytes', {
        enumerable: true,
        get() {
          assert.fail('accessor');
        },
      });
    },
    (v) => {
      v[Symbol('private')] = 1;
    },
    (v) => {
      v.projections = v;
    },
  ]) {
    const bad = structuredClone(good);
    mutate(bad);
    assert.throws(() => safeRendererInventory(bad));
    assert.equal(encodeRendererInventory(bad), JSON.stringify(incompleteInventory()));
  }
  for (const bytes of [
    Buffer.alloc(8193),
    Buffer.from('{'),
    Buffer.from('{"complete":false,"reason":"private"}'),
  ])
    assert.deepEqual(parseRendererInventory(bytes), incompleteInventory());
  assert.deepEqual(parseRendererInventory(Buffer.from(JSON.stringify(good).padEnd(8192))), good);
});

function inventoryArchive(payload, declared = payload.length) {
  const header = Buffer.alloc(512);
  header.write('renderer-inventory.json');
  header.write(declared.toString(8).padStart(11, '0') + '\0', 124);
  header[156] = 48;
  header.fill(32, 148, 156);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([
    header,
    payload,
    Buffer.alloc(Math.ceil(payload.length / 512) * 512 - payload.length + 1024),
  ]);
}
test('outer bounded TAR envelope refuses oversize, extra members, bad headers and invalid results before retention', async () => {
  const good = await metadataFixture().run();
  const payload = Buffer.from(JSON.stringify(good).padEnd(8192));
  assert.deepEqual(parseInventoryArchive(inventoryArchive(payload)), good);
  for (const archive of [
    inventoryArchive(Buffer.alloc(8193)),
    inventoryArchive(payload, 8193),
    Buffer.concat([inventoryArchive(payload), Buffer.from('private')]),
    inventoryArchive(Buffer.from('{')),
    Buffer.alloc(12289),
  ])
    assert.deepEqual(parseInventoryArchive(archive), incompleteInventory());
  for (const index of [0, 124, 148, 156, 157, 345]) {
    const archive = inventoryArchive(payload);
    archive[index] = 120;
    assert.deepEqual(parseInventoryArchive(archive), incompleteInventory());
  }
});

test('inventory runtime branch has no scan/detail/profile fallback and skips database content inspection', async () => {
  const inner = await readFile(
    new URL('./support/harness-renderer-inner.mjs', import.meta.url),
    'utf8',
  );
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  assert.match(inner, /inventoryMode\s*\?\s*\[\]\s*:/);
  const inventoryBranch = inner.slice(
    inner.indexOf('if (inventoryMode) {\n      // No progress'),
    inner.indexOf('const statePaths ='),
  );
  assert.match(inventoryBranch, /rendererMetadataInventory/);
  assert.doesNotMatch(inventoryBranch, /readFile|rendererScan|digest|progress\(/);
  const outerBranch = runner.slice(
    runner.indexOf('if (rendererInventory) {\n      let inventory'),
    runner.indexOf('} else if (renderer) {\n      await command'),
  );
  assert.match(outerBranch, /parseInventoryArchive/);
  assert.doesNotMatch(
    outerBranch,
    /scan-pass|diagnostics\.log|renderer-diagnostic|transcript\.ansi/,
  );
  assert.match(runner, /privacy: 'UNPROVEN'/);
});
const alpha = '1 SYNTHETIC ALPHA',
  beta = '2 SYNTHETIC BETA';
const begin = '\x1b[?2026h',
  end = '\x1b[?2026l';
// SYNTHETIC operands, not an actual-host theme or emitted-color profile.
const selected = '\x1b[0;1;38;2;10;10;10;48;2;250;178;131m';
const current = '\x1b[0;38;2;250;178;131m';
const ordinary = '\x1b[0;38;2;238;238;238m';
const paint = (row, style, label) => `\x1b[${row};3H${style}${label}`;
const initialCells = begin + paint(3, selected, alpha) + paint(4, ordinary, beta) + end;
const movedCells = begin + paint(3, current, alpha) + paint(4, selected, beta) + end;
const marker = '\u25cf';

test('capture-first sequence retains callbacks despite unsupported pre/post movement rendering', async () => {
  for (const [first, second, values, analysis] of [
    ['\u754c', initialCells + movedCells, ['alpha', 'beta'], 'UNPROVEN'],
    [initialCells, '\x1b[31munsupported', ['alpha', 'beta'], 'UNPROVEN'],
    ['\u754c', '\u25cf\ufe0f', ['beta', 'alpha'], 'FAIL'],
    [initialCells, initialCells + movedCells, ['private', undefined], 'FAIL'],
  ]) {
    const keys = [],
      records = [],
      budgets = [],
      result = {};
    let observed = 0;
    await rendererDiagnosticSequence(
      {
        key(name) {
          keys.push(name);
          if (name === 'ctrlG') records.push({ phase: 'opening' });
          if (name === 'observe') records.push({ phase: 'cursor', value: values[observed++] });
          if (name === 'escape') records.push({ phase: 'dismissed' });
        },
        async wait(predicate, budget) {
          budgets.push(budget);
          assert.ok(await predicate());
        },
        async events() {
          return records;
        },
        mark() {},
        async progress() {},
        raw: () => (observed === 1 ? first : second),
      },
      result,
    );
    assert.deepEqual(keys, ['ctrlG', 'observe', 'arrowDown', 'observe', 'escape']);
    assert.ok(budgets.every((b, i) => b <= 15000 && (!i || b <= budgets[i - 1])));
    assert.equal(result.ALPHA.present, true);
    assert.equal(result.BETA.present, true);
    assert.equal(rendererDiagnosticAnalysis(result, false), 'UNPROVEN');
    assert.equal(rendererDiagnosticAnalysis(result, true), analysis);
    assert.ok(!JSON.stringify([result.ALPHA, result.BETA]).includes('private'));
  }
});

test('diagnostic missing response, deadline, stream overflow or key write failure stops without retry', async () => {
  for (const fault of ['first', 'second', 'deadline', 'overflow', 'write']) {
    const keys = [],
      records = [],
      result = {},
      operation = {};
    let observed = 0;
    await assert.rejects(
      rendererDiagnosticSequence(
        {
          key(name) {
            keys.push(name);
            if (fault === 'write' && name === 'observe') throw new Error('synthetic');
            if (name === 'ctrlG') records.push({ phase: 'opening' });
            if (name === 'observe') {
              observed++;
              if (!(fault === 'first' || (fault === 'second' && observed === 2)))
                records.push({ phase: 'cursor', value: 'alpha' });
            }
          },
          async wait(predicate) {
            if (fault === 'overflow') rendererCaptureCheck(operation, true, false);
            if (fault === 'deadline' || !(await predicate())) {
              operation.reason = 'DEADLINE';
              throw new Error('synthetic');
            }
          },
          events: async () => records,
          mark: (stage, reason) => rendererCheckpoint(operation, stage, reason),
          async progress() {},
          raw: () => '\u754c',
        },
        result,
      ),
    );
    assert.equal(keys.filter((k) => k === 'ctrlG').length, 1);
    assert.ok(keys.filter((k) => k === 'arrowDown').length <= 1);
    assert.ok(keys.filter((k) => k === 'observe').length <= 2);
    assert.equal(rendererDiagnosticAnalysis(result, false), 'UNPROVEN');
    if (fault === 'second') {
      assert.equal(operation.stage, 'MOVED_CURSOR_WAIT');
      assert.equal(result.ALPHA.value, 'ALPHA');
      assert.equal(result.BETA, undefined);
    }
  }
});

test('diagnostic successful synthetic style analysis still cannot qualify a profile', () => {
  assert.equal(
    rendererDiagnosticAnalysis(
      {
        initialRaw: initialCells,
        movedRaw: initialCells + movedCells,
        ALPHA: { present: true, value: 'ALPHA' },
        BETA: { present: true, value: 'BETA' },
      },
      true,
    ),
    'UNPROVEN',
  );
});

test('diagnostic decoder refusals stay unproven while supported style contradictions fail', () => {
  const sample = {
    initialRaw: initialCells,
    movedRaw: initialCells + movedCells,
    ALPHA: { present: true, value: 'ALPHA' },
    BETA: { present: true, value: 'BETA' },
  };
  for (const patch of [
    { initialRaw: '\u754c' },
    { movedRaw: initialCells + begin },
    { movedRaw: initialCells },
    { movedRaw: initialCells + begin + paint(4, selected, beta) },
    { movedRaw: initialCells + begin + '\x1b[999m' + end },
  ])
    assert.equal(rendererDiagnosticAnalysis({ ...sample, ...patch }, true), 'UNPROVEN');
  for (const moved of [
    begin + paint(3, selected, alpha) + paint(4, ordinary, beta) + end,
    movedCells.replace('0;1;', '0;'),
    movedCells.replace('10;10;10', '10;10;11'),
  ]) {
    const result = { ...sample, movedRaw: initialCells + moved };
    assert.equal(rendererDiagnosticAnalysis(result, true), 'FAIL');
    assert.equal(rendererDiagnosticAnalysis(result, false), 'UNPROVEN');
  }
  // Unexpected I/O/programming failures must reach the caller, not become UNPROVEN.
  const failure = new Error('synthetic IO');
  assert.throws(
    () =>
      rendererDiagnosticAnalysis(
        {
          ...sample,
          get initialRaw() {
            throw failure;
          },
        },
        true,
      ),
    (error) => error === failure,
  );
});

test('diagnostic capture admission is separate from analysis and refuses incomplete controls', () => {
  const value = {
    status: 'PASS',
    failure: 'NONE',
    phase: 'dismissed',
    scanReason: 'NONE',
    bytes: 10,
    frames: 0,
    counts: { ctrlG: 1, arrowDown: 1, observe: 2, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: 'UNKNOWN' },
    cleanup: true,
    hostExit: true,
    diagnostic: {
      capture: 'DIAGNOSTIC_CAPTURE_PASS',
      analysis: 'FAIL',
      profile: 'UNPROVEN',
      ALPHA: { present: true, value: 'BETA' },
      BETA: { present: true, value: 'OTHER' },
    },
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  for (const patch of [
    { hostExit: false },
    { cleanup: false },
    { scanReason: 'SCAN_REFUSED' },
    { counts: { ...value.counts, observe: 1 } },
    { diagnostic: { ...value.diagnostic, profile: 'PASS' } },
    { diagnostic: { ...value.diagnostic, analysis: 'PASS' } },
    { diagnostic: { ...value.diagnostic, BETA: { present: false, value: 'NONE' } } },
    { diagnostic: { ...value.diagnostic, ALPHA: { present: true, value: 'private' } } },
  ])
    assert.throws(() => safeRendererDiagnostic({ ...value, ...patch }));
});

test('maintained diagnostic wiring keeps qualification, scan/export and lifecycle boundaries', async () => {
  const inner = await readFile(
    new URL('./support/harness-renderer-inner.mjs', import.meta.url),
    'utf8',
  );
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const entry = await readFile(new URL('./run-harness-host.mjs', import.meta.url), 'utf8');
  assert.match(entry, /--renderer-diagnostic-preflight/);
  assert.match(entry, /--renderer-diagnostic-run/);
  assert.match(runner, /preflight && rendererDiagnostic[\s\S]*command\(\['--version'\]\)/);
  assert.match(runner, /rendererDiagnostic \? \['--diagnostic-capture'\] : \[\]/);
  assert.ok(
    inner.indexOf('rendererDiagnosticAnalysis(diagnosticSamples, true)') >
      inner.indexOf("'EXPORT_SCAN'"),
  );
  assert.match(
    inner,
    /if \(diagnosticMode\) \{[\s\S]*rendererDiagnosticSequence\([\s\S]*\} else \{[\s\S]*assertRendererStyles\(before, after, operation\)/,
  );
  assert.match(inner, /if \(!diagnosticMode\)/);
  assert.match(inner, /hostExit = exited && closed && !!hostPid/);
  assert.match(inner, /productProfile: null/);
  assert.ok(inner.indexOf("'SCAN', overflow") < inner.indexOf("'EXPORT_DIAGNOSTICS'"));
  assert.match(inner, /\['state', statePaths\],[\s\S]*\['evidence', evidencePaths\]/);
  assert.match(inner, /rendererReadFile\(collection, path, surface, collectedBytes\)/);
  assert.ok(inner.indexOf('rendererReadFile(collection, path') < inner.indexOf('entries.push'));
  assert.match(inner, /collectedBytes \+= bytes.length/);
  assert.doesNotMatch(inner, /readFile\(path\)/);
  for (const root of ['root', 'evidence'])
    assert.ok(inner.includes(`.filter((e) => e.path.startsWith(${root} + '/'))`));
  assert.equal(
    (inner.match(/flatMap\(\(e\) => \[Buffer.from\(e.path\), e.bytes\]\)/g) ?? []).length,
    2,
  );
  assert.ok(
    runner.indexOf(
      'assertRendererExport(',
      runner.indexOf('if (renderer) {', runner.indexOf("await progress('evidence'")),
    ) < runner.indexOf("'binding.json'"),
  );
});
// Source-buffer model only. The marker remains on current A after selection moves.
const decorated = (a, b, absolute = false) =>
  begin +
  `\x1b[3;1H${a}${marker} ${absolute ? '\x1b[3;3H' : ''}${alpha}` +
  `\x1b[4;1H${b}  ${beta}` +
  end;

test('bare current marker has a separate source-cell region, never selection authority', () => {
  for (const absolute of [false, true]) {
    const raw = decorated(selected, ordinary, absolute);
    const before = rendererCells(raw);
    const after = rendererCells(raw + decorated(current, selected, absolute), before);
    assertRendererStyles(before.labels, after.labels, {});
    assertRendererCursor({}, rendererCursor({ value: 'beta' }), 'BETA', true);
    assert.deepEqual(before.markers, { [alpha]: { row: 2, col: 0 } });
    assert.deepEqual(after.markers, before.markers);
    assert.equal(before.cellModel, 'OPENTUI_0_8_0_BARE_25CF_SOURCE_LAYOUT_NOT_TERMINAL_WIDTH');
    assert.equal(after.profileInstalled, false);
    assert.deepEqual(after.positions, { [alpha]: { row: 2, col: 2 }, [beta]: { row: 3, col: 2 } });
    // The marker stays on A, so it cannot satisfy B's style or cursor evidence.
    assert.throws(() => assertRendererStyles(before.labels, before.labels, {}));
    assert.throws(() => assertRendererCursor({}, rendererCursor({ value: 'alpha' }), 'BETA', true));
  }
});

test('decorated title cells survive fragmented style/cursor repaint, not mixed profiles', () => {
  const raw = decorated(selected, ordinary);
  const before = rendererCells(raw);
  const repaint =
    begin +
    '\x1b[2 q' +
    [...alpha].map((ch, i) => `\x1b[3;${i + 3}H${current}${ch}`).join('') +
    [...beta].map((ch, i) => `\x1b[4;${i + 3}H${selected}${ch}`).join('') +
    end;
  assertRendererStyles(before.labels, rendererCells(raw + repaint, before).labels, {});
  assert.throws(() => rendererCells(raw + begin + '\x1b[3;3H' + current + '1' + end, before));
  // Marker styling is not title styling. Only the ASCII span supplies attributes.
  const splitRun = raw.replace(`${selected}${marker} `, `${current}${marker} ${selected}`);
  assert.deepEqual(rendererCells(splitRun).labels, before.labels);
  assert.equal(compositionCurrentFrame(raw, { styled: true }), '', 'no composition opt-in');
});

test('marker variants, unknown width, unsupported controls and forged associations refuse', () => {
  const raw = decorated(selected, ordinary);
  for (const invalid of [
    raw.replace(marker, marker + '\ufe0f'),
    raw.replace(marker, marker + '\ufe0e'),
    raw.replace(marker, marker + '\u200d'),
    raw.replace(marker, '\u25cb'),
    raw.replace(marker, '\u754c'),
    raw.replace(alpha, alpha + '\u0301'),
    raw.replace(alpha, '\u754c' + alpha),
    raw.replace(marker, '\x1b]66;w=1;' + marker + '\x1b\\'),
    raw.replace(marker, marker + '\x1b[2C'),
    raw.replace(marker, marker + marker),
    raw.replace('  ' + beta, marker + ' ' + beta),
    raw.replace(alpha, alpha + ' ' + marker),
    raw.replace(alpha, 'prefix ' + alpha),
    raw.replace(alpha, alpha + alpha),
    raw.replace('\x1b[4;1H', '\x1b[5;1H'),
    raw.replace('  ' + beta, '   ' + beta),
    raw + begin + '\x1b[1;1H' + marker + end,
    raw + begin + '\x1b[3;120H' + marker + ' ' + end,
  ])
    assert.throws(() => rendererCells(invalid));
  const before = rendererCells(raw);
  assert.throws(
    () => rendererCells(raw + begin + '\x1b[3;1H  ' + end + movedCells, before),
    'missing marker after repaint',
  );
});

test('unknown earlier decoration cannot be ignored or revive historic labels after reset', () => {
  const raw = decorated(selected, ordinary);
  const earlier = begin + '\x1b[1;1H\u754c' + end;
  // Conservative refusal, even with a later CUP/reset. No guessed width recovery.
  for (const reset of ['', '\x1b[2J', '\x1b[3J', '\x1b[?1049h'])
    assert.throws(() => rendererCells(earlier + reset + raw));
  for (const reset of ['\x1b[2J', '\x1b[3J', '\x1b[?1049h']) {
    assert.throws(() => rendererCells(raw + reset));
    assert.throws(() => rendererCells(raw + reset + begin + '\x1b[1;1Hnew' + end));
    assert.deepEqual(rendererCells(raw + reset + raw).positions, rendererCells(raw).positions);
    assert.throws(() => rendererCells(raw + reset + raw, rendererCells(raw)));
  }
});

test('finite fixture keeps current ALPHA, observes live selection through Ctrl+Y and sends physical Down', async () => {
  const fixture = await readFile(
    new URL('./fixtures/harness-renderer/tui.ts', import.meta.url),
    'utf8',
  );
  const inner = await readFile(
    new URL('./support/harness-renderer-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.match(fixture, /current: 'alpha'/);
  assert.match(
    fixture,
    /bind: 'ctrl\+y',[\s\S]*onTrigger: \(value\) => record\(\{ phase: 'cursor', value \}\)/,
  );
  assert.ok(inner.includes("key('arrowDown', '\\x1b[B')"));
  assert.ok(rendererPayload.includes('tests/support/harness-composition-readiness.mjs'));
  const projector = await readFile(
    new URL('./support/harness-composition-readiness.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(projector, /^import /m, 'staged projector has no unstaged dependencies');
});

test('completed current cells bind unique finite rows, positions, transcript and independent roles', () => {
  const before = rendererCells(initialCells);
  const after = rendererCells(initialCells + movedCells, before);
  assertRendererCursor({}, rendererCursor({ value: 'alpha' }), 'ALPHA');
  assertRendererCursor({}, rendererCursor({ value: 'beta' }), 'BETA', true);
  assertRendererStyles(before.labels, after.labels, {});
  assert.notEqual(before.labels[beta].fg, after.labels[alpha].fg);
  assert.deepEqual(after.positions, { [alpha]: { row: 2, col: 2 }, [beta]: { row: 3, col: 2 } });
  assert.equal(after.frames, 2);
  assert.equal(after.byteEnd, Buffer.byteLength(initialCells + movedCells));
  assert.equal(after.profileInstalled, false);
});

test('fragmented cursor/SGR repaint and split labels need no fresh whole literal emission', () => {
  const before = rendererCells(initialCells);
  const fragments =
    begin +
    [...alpha].map((ch, i) => paint(3, current, ch).replace('[3;3H', `[3;${i + 3}H`)).join('') +
    [...beta].map((ch, i) => paint(4, selected, ch).replace('[4;3H', `[4;${i + 3}H`)).join('') +
    end;
  assert.equal(fragments.includes('SYNTHETIC'), false);
  const after = rendererCells(initialCells + fragments, before);
  assertRendererStyles(before.labels, after.labels, {});
  const split = initialCells.replace('SYNTHETIC', 'SYN\x1b[1mTHETIC');
  assert.deepEqual(rendererCells(split).labels, before.labels);
  // An incomplete transport fragment is refused until the same bytes complete.
  for (const cut of [begin.length + 2, initialCells.length - 1])
    assert.throws(() => rendererCells(initialCells.slice(0, cut)));
});

test('stale emissions, missing/duplicate/misplaced rows and unsupported updates fail closed', () => {
  const before = rendererCells(initialCells);
  const invalid = [
    initialCells, // No completed update after the pinned sample.
    initialCells + begin + selected + end, // SGR does not restyle existing cells.
    initialCells + begin + paint(8, selected, alpha) + end,
    initialCells + begin + '\x1b[3;1H\x1b[2K' + paint(8, selected, alpha) + end,
    initialCells + begin + '\x1b[4;1H\x1b[2K' + end,
    initialCells + begin + '\x1b[3;3H\x1b[31m1' + end,
    initialCells + begin + '\x1b[3;3H\u25031' + end,
    initialCells + begin + '\x1b[3;3H\x1b[2C' + end,
    initialCells + begin + paint(3, current, alpha) + end.slice(0, -1),
    initialCells + begin + '\x1b[41;1H' + end,
    initialCells + begin + '\x1b[3;120HXX' + end,
    initialCells + '\x1b[?1049h' + movedCells,
    initialCells + '\x1b[2J' + movedCells,
    initialCells + begin + begin + end + end,
    initialCells.replace('238;238;238', '237;238;238') + movedCells,
  ];
  for (const raw of invalid)
    assert.throws(() => {
      const after = rendererCells(raw, before);
      assertRendererStyles(before.labels, after.labels, {});
    });
  for (const raw of [
    begin + paint(3, selected, alpha) + end,
    begin + paint(3, selected, alpha + alpha) + paint(4, ordinary, beta) + end,
    begin + paint(3, selected, 'prefix ' + alpha) + paint(4, ordinary, beta) + end,
    begin + paint(3, selected, alpha) + paint(5, ordinary, beta) + end,
    begin +
      paint(3, selected, alpha.slice(0, 1)) +
      current +
      alpha.slice(1) +
      paint(4, ordinary, beta) +
      end,
    'x'.repeat(1048577),
  ])
    assert.throws(() => rendererCells(raw));
  assert.throws(() => rendererCells(initialCells + movedCells, before, { rows: 41, columns: 120 }));
  assert.throws(() =>
    rendererCells(initialCells + movedCells, { ...before, geometry: { rows: 41, columns: 120 } }),
  );
});
test('synthetic renderer emission preserves RGB/default/bold and never installs a profile', () => {
  const result = emittedLabels(
    '\x1b[0m\x1b[38;2;238;238;238m2 SYNTHETIC BETA\x1b[1;48;2;250;178;131;38;2;10;10;10m1 SYNTHETIC ALPHA\x1b[?2026l',
  );
  assert.equal(result.frames, 1);
  assert.deepEqual(result.labels['1 SYNTHETIC ALPHA'].bg, [250, 178, 131]);
  assert.equal(result.labels['1 SYNTHETIC ALPHA'].bold, true);
  assert.equal(result.labels['2 SYNTHETIC BETA'].bg, 'default');
  assert.equal(result.profileInstalled, false);
  assert.equal(
    emittedLabels('\x1b[31m1 SYNTHETIC ALPHA').labels['1 SYNTHETIC ALPHA'].supported,
    false,
  );
});
test('collection size, missing logs and stream overflow retain distinct closed facts', () => {
  const total = {};
  rendererSize(total, 16777216, true);
  assert.deepEqual(total, { stage: 'TOTAL_SIZE', reason: 'NONE' });
  assert.throws(() => rendererSize(total, 16777217, true));
  assert.deepEqual(total, { stage: 'TOTAL_SIZE', reason: 'OVERFLOW' });
  const state = {};
  assert.throws(() => rendererDiagnostics(state, []));
  assert.deepEqual(state, { stage: 'NO_DIAGNOSTICS', reason: 'INCOMPLETE' });
  rendererCheckpoint(state, 'MOVED_WAIT', 'DEADLINE');
  assert.throws(() => rendererCaptureCheck(state, true, false));
  assert.deepEqual(state, { stage: 'MOVED_WAIT', reason: 'CAPTURE' });
  assert.throws(() => rendererCaptureCheck(state, false, true));
  assert.deepEqual(state, { stage: 'MOVED_WAIT', reason: 'IO' });
});
test('per-file exact bound accepts, first overflow retains only explicit root and exact bytes', () => {
  for (const surface of ['state', 'evidence']) {
    const state = {};
    for (const bytes of [0, 4194304, 12846400, 16777216]) {
      rendererSize(state, bytes, false, surface);
      assert.deepEqual(state, { stage: 'PER_FILE_SIZE', reason: 'NONE' });
    }
    assert.throws(() => rendererSize(state, 16777217, false, surface));
    assert.deepEqual(state, {
      stage: 'PER_FILE_SIZE',
      reason: 'OVERFLOW',
      overflow: { surface, bytes: 16777217 },
    });
    assert.throws(() =>
      rendererSize(state, 18000000, false, surface === 'state' ? 'evidence' : 'state'),
    );
    assert.deepEqual(state.overflow, { surface, bytes: 16777217 });
  }
  for (const [bytes, surface, total = false] of [
    [4194305, undefined],
    [4194305, '/private/state'],
    [4194305, 'diagnostics'],
    [undefined, 'state'],
    [-1, 'state'],
    [NaN, 'state'],
    [Infinity, 'state'],
    [Number.MAX_SAFE_INTEGER + 1, 'state'],
    [4194305.5, 'evidence'],
    ['4194305', 'state'],
    [4194305, 'state', 'false'],
  ]) {
    const state = {};
    assert.throws(() => rendererSize(state, bytes, total, surface));
    assert.equal(Object.hasOwn(state, 'overflow'), false);
  }
});
// Deterministic I/O fault injection. No host, resource, filesystem fixture or service.
function collectionIO(size, fault) {
  const calls = { allocations: [], reads: [], opens: 0, closes: 0 };
  const stat = () => ({
    size: typeof size === 'number' && Number.isSafeInteger(size) ? BigInt(size) : size,
    dev: 1n,
    ino: 2n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => fault !== 'directory',
    isSymbolicLink: () => fault === 'symlink',
  });
  let stats = 0,
    paths = 0;
  return {
    calls,
    async lstat() {
      paths++;
      const value = stat();
      if (paths > 1 && fault === 'path-replacement') value.ino++;
      if (paths > 1 && fault === 'late-symlink') value.isSymbolicLink = () => true;
      return value;
    },
    allocate(bytes) {
      calls.allocations.push(bytes);
      return Buffer.alloc(bytes);
    },
    async open(_path, flags) {
      calls.opens++;
      assert.equal(typeof flags, 'number');
      if (fault === 'open') throw new Error('synthetic');
      return {
        async stat() {
          stats++;
          const value = stat();
          if (fault === 'open-replacement') value.ino++;
          if (stats > 1 && fault === 'growth-stat') value.size++;
          if (stats > 1 && fault === 'rewrite') value.mtimeNs++;
          return value;
        },
        async read(buffer, offset, length, position) {
          calls.reads.push({ length, position });
          assert.ok(length <= 65536 && offset + length <= buffer.length);
          if (fault === 'read') throw new Error('synthetic');
          if (fault === 'incomplete') return { bytesRead: 0 };
          if (fault === 'invalid-read') return { bytesRead: length + 1 };
          const bytesRead =
            position === size
              ? fault === 'growth-read'
                ? 1
                : 0
              : Math.min(length, fault === 'partial' ? 3 : length);
          buffer.fill(120, offset, offset + bytesRead);
          return { bytesRead };
        },
        async close() {
          calls.closes++;
        },
      };
    },
  };
}
test('bounded collection admits exact/zero files and cumulative remainder before allocation', async () => {
  for (const size of [0, 17, 16777216]) {
    const io = collectionIO(size);
    const bytes = await rendererReadFile({}, 'synthetic', 'state', 0, io);
    assert.equal(bytes.length, size);
    assert.deepEqual(io.calls.allocations, [size]);
    assert.equal(io.calls.closes, 1);
    assert.ok(io.calls.reads.every((r) => r.position <= size));
  }
  const first = collectionIO(12846400);
  const retained = await rendererReadFile({}, 'synthetic', 'state', 0, first);
  assert.equal(retained.length, 12846400);
  for (const size of [3930816, 3930817]) {
    const io = collectionIO(size),
      state = {};
    const action = rendererReadFile(state, 'synthetic', 'evidence', retained.length, io);
    if (size === 3930816) assert.equal((await action).length, size);
    else {
      await assert.rejects(action);
      assert.deepEqual(state, { stage: 'TOTAL_SIZE', reason: 'OVERFLOW' });
      assert.deepEqual(io.calls, { allocations: [], reads: [], opens: 0, closes: 0 });
    }
  }
  const partial = collectionIO(17, 'partial');
  assert.equal((await rendererReadFile({}, 'synthetic', 'state', 0, partial)).length, 17);
});
test('bounded collection refuses unsafe metadata, symlinks and overflow before open/allocation', async () => {
  for (const size of [
    -1,
    NaN,
    Infinity,
    1.5,
    undefined,
    '12',
    Number.MAX_SAFE_INTEGER + 1,
    9007199254740992n,
    16777217,
  ]) {
    const io = collectionIO(size),
      state = {};
    await assert.rejects(rendererReadFile(state, 'synthetic', 'state', 0, io));
    assert.deepEqual(io.calls, { allocations: [], reads: [], opens: 0, closes: 0 });
    if (size === 16777217)
      assert.deepEqual(state, {
        stage: 'PER_FILE_SIZE',
        reason: 'OVERFLOW',
        overflow: { surface: 'state', bytes: 16777217 },
      });
    else assert.equal(Object.hasOwn(state, 'overflow'), false);
  }
  for (const fault of ['symlink', 'directory']) {
    const io = collectionIO(10, fault),
      state = {};
    await assert.rejects(rendererReadFile(state, 'synthetic', 'state', 0, io));
    assert.equal(state.stage, fault === 'symlink' ? 'SYMLINK' : 'READ_FILE');
    assert.equal(state.reason, 'INCOMPLETE');
    assert.deepEqual(io.calls.allocations, []);
    assert.equal(io.calls.opens, 0);
  }
  for (const used of [-1, NaN, Number.MAX_SAFE_INTEGER + 1, 16777217]) {
    const io = collectionIO(1);
    await assert.rejects(rendererReadFile({}, 'synthetic', 'state', used, io));
    assert.equal(io.calls.opens, 0);
    assert.deepEqual(io.calls.allocations, []);
  }
});
test('bounded collection fails closed on growth, replacement, rewrite and incomplete reads, closing handles', async () => {
  for (const fault of [
    'open',
    'open-replacement',
    'growth-stat',
    'growth-read',
    'rewrite',
    'path-replacement',
    'late-symlink',
    'incomplete',
    'invalid-read',
    'read',
  ]) {
    const io = collectionIO(17, fault),
      state = {};
    await assert.rejects(rendererReadFile(state, 'synthetic', 'evidence', 0, io));
    assert.equal(io.calls.closes, fault === 'open' ? 0 : 1);
    assert.equal(state.reason, ['open', 'read'].includes(fault) ? 'IO' : 'INCOMPLETE');
    if (fault === 'open-replacement') assert.deepEqual(io.calls.allocations, []);
  }
});
test('bounded native regular-file read returns the entire admitted source', async () => {
  const path = new URL('./support/harness-renderer-observation.mjs', import.meta.url);
  const state = {};
  assert.deepEqual(await rendererReadFile(state, path, 'evidence', 0), await readFile(path));
  assert.equal(state.reason, 'NONE');
});
test('native injected read/write/parse/scan/export failures retain stage without inspecting exceptions', async () => {
  const secret = 'cap_' + 'a'.repeat(64);
  const unsafe = Object.defineProperty({}, 'message', {
    get() {
      assert.fail('must not read');
    },
  });
  for (const [stage, reason, action] of [
    [
      'READ_FILE',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    [
      'WRITE_TRANSCRIPT',
      'IO',
      () => {
        throw new Error(secret);
      },
    ],
    [
      'WRITE_OBSERVATIONS',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    ['PARSE_EVENTS', 'PARSE', () => JSON.parse('invalid')],
    ['SCAN', 'REFUSED', () => rendererScan({}, ['a'.repeat(40), 'b'.repeat(40)], false, false)],
    [
      'EXPORT_DIAGNOSTICS',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    [
      'EXPORT_SCAN',
      'IO',
      () => {
        throw unsafe;
      },
    ],
    ['HOST_EXIT', 'INCOMPLETE', () => assert.equal(false, true)],
    ['SYMLINK', 'INCOMPLETE', () => assert.equal(true, false)],
  ]) {
    const state = {};
    await assert.rejects(rendererStep(state, stage, reason, action));
    assert.deepEqual(state, { stage, reason });
    assert.ok(!JSON.stringify(state).includes(secret));
  }
});
test('missing/wrong cursor and missing/unsupported/style assertions cannot mask one another', () => {
  const state = {};
  for (const event of [undefined, { value: 'alpha' }, { value: 'secret' }]) {
    const cursor = rendererCursor(event);
    assert.throws(() => assertRendererCursor(state, cursor, 'BETA', true));
    assert.deepEqual(state, { stage: 'MOVED_CURSOR_VALUE', reason: 'ASSERT' });
    assert.ok(!JSON.stringify(cursor).includes('secret'));
  }
  const label = '1 SYNTHETIC ALPHA',
    other = '2 SYNTHETIC BETA';
  const active = { supported: true, fg: 'dark', bg: 'orange', bold: true };
  const normal = { supported: true, fg: 'light', bg: 'default', bold: false };
  const before = { [label]: active, [other]: normal };
  const after = { [label]: normal, [other]: active };
  assertRendererStyles(before, after, state);
  for (const [changed, expected] of [
    [{ [label]: normal }, 'LABEL_SET'],
    [{ ...after, [label]: { ...normal, supported: false } }, 'STYLE_SUPPORTED'],
    [before, 'STYLE_BACKGROUND'],
    [{ ...after, [label]: { ...normal, bold: true } }, 'STYLE_BOLD'],
    [{ ...after, [other]: { ...active, fg: 'other' } }, 'STYLE_SWAP'],
  ]) {
    assert.throws(
      () => assertRendererStyles(before, changed, state),
      (error) => error.code === 'ERR_ASSERTION',
    );
    assert.deepEqual(state, { stage: expected, reason: 'ASSERT' });
  }
});
test('extended diagnostic schema rejects unsafe values, accessors, exception objects and unknown keys', () => {
  const value = {
    status: 'FAIL',
    failure: 'CONTROL_OR_IO',
    phase: 'moved',
    scanReason: 'COLLECTION_OR_INCOMPLETE',
    bytes: 0,
    frames: 0,
    counts: { ctrlG: 1, arrowDown: 1, observe: 2, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: 'UNKNOWN' },
    cleanup: true,
    hostExit: true,
    operation: { stage: 'LABEL_SET', reason: 'ASSERT' },
    collection: { stage: 'PER_FILE_SIZE', reason: 'OVERFLOW' },
    cursor: { present: false, value: 'NONE' },
    styles: rendererStyleFacts(),
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  // Historical closed records without operands remain valid. New operands are
  // optional for compatibility, never reconstructed from names or exceptions.
  const withOverflow = (overflow, collection = {}, patch = {}) => ({
    ...value,
    scanReason: 'OVERFLOW',
    ...patch,
    collection: { ...value.collection, overflow, ...collection },
  });
  for (const surface of ['state', 'evidence']) {
    for (const bytes of [4194305, Number.MAX_SAFE_INTEGER]) {
      const record = withOverflow({ surface, bytes });
      assert.deepEqual(safeRendererDiagnostic(record), record);
      assert.deepEqual(JSON.parse(JSON.stringify(record)).collection.overflow, { surface, bytes });
    }
  }
  let operandAccessed = false;
  const operandAccessor = Object.defineProperty({ bytes: 4194305 }, 'surface', {
    enumerable: true,
    get() {
      operandAccessed = true;
      return 'state';
    },
  });
  for (const overflow of [
    operandAccessor,
    new Error('private'),
    null,
    {},
    { surface: '/private/state', bytes: 4194305 },
    { surface: 'diagnostics', bytes: 4194305 },
    { surface: 'state', bytes: 4194305, path: '/private' },
    { surface: 'evidence', bytes: 4194305, content: 'private' },
    ...[
      undefined,
      -1,
      4194304,
      4194305.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      '4194305',
    ].map((bytes) => ({ surface: 'state', bytes })),
  ])
    assert.throws(() => safeRendererDiagnostic(withOverflow(overflow)));
  assert.equal(operandAccessed, false);
  for (const collection of [{ stage: 'TOTAL_SIZE' }, { stage: 'READ_FILE' }, { reason: 'NONE' }])
    assert.throws(() =>
      safeRendererDiagnostic(withOverflow({ surface: 'state', bytes: 4194305 }, collection)),
    );
  for (const patch of [{ status: 'PASS' }, { scanReason: 'NONE' }])
    assert.throws(() =>
      safeRendererDiagnostic(withOverflow({ surface: 'state', bytes: 4194305 }, {}, patch)),
    );
  let accessed = false;
  const accessor = Object.defineProperty({ ...value }, 'phase', {
    enumerable: true,
    get() {
      accessed = true;
      return 'moved';
    },
  });
  for (const unsafe of [
    accessor,
    { ...value, operation: new Error('private') },
    { ...value, cursor: { present: true, value: 'private' } },
    { ...value, collection: { stage: 'READ_FILE', reason: 'private' } },
    { ...value, path: '/private' },
    { ...value, frames: Infinity },
    { ...value, styles: { ...value.styles, OTHER: {} } },
  ])
    assert.throws(() => safeRendererDiagnostic(unsafe));
  assert.equal(accessed, false);
  for (const extra of [
    Object.defineProperty({ ...value }, 'toJSON', { value: () => 'private' }),
    Object.assign({ ...value }, { [Symbol('private')]: 'private' }),
    { ...value, operation: { stage: 'LABEL_SET', reason: 'ASSERT', error: 'private' } },
  ])
    assert.throws(() => safeRendererDiagnostic(extra));
  const cyclic = { ...value };
  cyclic.cursor = cyclic;
  assert.throws(() => safeRendererDiagnostic(cyclic));
  const accessorEvent = Object.defineProperty({}, 'value', {
    get() {
      assert.fail('must not execute');
    },
  });
  assert.deepEqual(rendererCursor(accessorEvent), { present: true, value: 'NONE' });
});
test('lexical repaint counters do not infer a missing literal label or current cell style', () => {
  const diff = emittedLabels('\x1b[1m\x1b[?2026l');
  assert.equal(diff.sgrTokens, 1);
  assert.equal(diff.frames, 1);
  assert.deepEqual(diff.literalEmissions, { ALPHA: 0, BETA: 0 });
  assert.deepEqual(diff.labels, {});
  assert.deepEqual(emittedLabels('1 SYNTHETIC ALPHA1 SYNTHETIC ALPHA').literalEmissions, {
    ALPHA: 2,
    BETA: 0,
  });
});
test('ungated renderer diagnostics allow only fixed reasons, counts and normalized identity', () => {
  const value = {
    status: 'FAIL',
    failure: 'PHASE_DEADLINE',
    phase: 'initial',
    scanReason: 'SCAN_REFUSED',
    frames: 2,
    bytes: 300,
    counts: { ctrlG: 1, arrowDown: 0, observe: 0, escape: 1, enter: 0 },
    runtime: { host: '2.2.5', bun: '1.4.4' },
    cleanup: true,
    hostExit: true,
  };
  assert.deepEqual(safeRendererDiagnostic(value), value);
  for (const extra of [
    { ...value, error: 'private' },
    { ...value, phase: 'raw frame' },
    { ...value, runtime: { host: '2.2.5', bun: 'secret' } },
    { ...value, counts: { ...value.counts, session: 'secret' } },
  ])
    assert.throws(() => safeRendererDiagnostic(extra));
});
test('renderer full-scope privacy controls refuse each missing or leaking surface', () => {
  const canaries = ['a'.repeat(40), 'b'.repeat(40)];
  const clean = () =>
    Object.fromEntries(rendererSurfaces.map((s) => [s, Buffer.from('synthetic')]));
  assertRendererExport(rendererScan(clean(), canaries, true, false));
  for (const surface of rendererSurfaces) {
    const missing = clean();
    delete missing[surface];
    assert.throws(() => rendererScan(missing, canaries, true, false));
    for (const secret of [
      ...canaries,
      'cap_' + 'a'.repeat(64),
      'sk-' + 'x'.repeat(32),
      'ghp_' + 'x'.repeat(32),
      'Bearer ' + 'x'.repeat(32),
      '-----BEGIN SYNTHETIC PRIVATE KEY-----',
    ]) {
      const leak = clean();
      leak[surface] = Buffer.from(secret);
      assert.throws(() => rendererScan(leak, canaries, true, false));
    }
  }
  assert.throws(() => rendererScan(clean(), canaries, false, false));
  assert.throws(() => rendererScan(clean(), canaries, true, true));
  assert.throws(() => assertRendererExport({ status: 'PASS', scope: 'product' }));
  assert.ok(rendererPayload.every((p) => p.startsWith('tests/')));
  assert.ok(!rendererPayload.some((p) => p.startsWith('src/')));
});
test('complete scans detect path and late content secrets beyond the former file limit before export', () => {
  const canaries = ['a'.repeat(40), 'b'.repeat(40)];
  for (const surface of rendererSurfaces) {
    for (const secret of [...canaries, 'cap_' + 'c'.repeat(64), 'Bearer ' + 'x'.repeat(32)]) {
      for (const position of ['path', 'late-content']) {
        const captures = Object.fromEntries(
          rendererSurfaces.map((s) => [s, Buffer.from('synthetic')]),
        );
        captures[surface] = Buffer.concat([
          Buffer.from(position === 'path' ? `/synthetic/${secret}/file` : '/synthetic/file'),
          Buffer.alloc(4194305, 120),
          Buffer.from(position === 'late-content' ? secret : 'clean'),
        ]);
        let detailedExport = false;
        assert.throws(() => {
          assertRendererExport(rendererScan(captures, canaries, true, false));
          detailedExport = true;
        });
        assert.equal(detailedExport, false);
      }
    }
  }
});
