import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import {
  collectProductCapture,
  productCaptureExport,
  transferProductCapture,
  productCaptureFiles,
  productRetainedPaths,
  verifyRetainedProductCapture,
  retainProgress,
  compositionSurfaces,
  productCaptureInputs,
  productCaptureLogs,
  productCaptureReadFile,
  scanFrozenComposition,
  compositionScanReason,
} from './support/harness-composition-retention.mjs';
import {
  transportFixtureAuthorities,
  freezeTransportSecrets,
} from './support/harness-transport-fixtures.mjs';
import { readFile } from 'node:fs/promises';
import {
  compositionCurrentFrame,
  compositionSourceFrame,
} from './support/harness-composition-readiness.mjs';
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
  collectionLimits,
  collectionAdmit,
  rendererWork,
  rendererBuildCapture,
  rendererDetailAdmission,
  rendererJsonBytes,
  rendererDetailFiles,
  rendererAttachFiles,
  rendererTransferDetails,
  parseRendererArchive,
  rendererCollectFiles,
  digest,
} from './support/harness-renderer-observation.mjs';

const metadataRoots = { state: '/run/proceed/state', evidence: '/run/proceed/evidence' };
const metadataIdentity = {
  dev: 9007199254740992n,
  ino: 9007199254740996n,
  mtimeNs: 1794096000000000000n,
  ctimeNs: 1794096000000000004n,
};
const requiredInventoryNames = [
  'binding.json',
  'observations.json',
  'fixture.jsonl',
  'inventory.json',
  'transcript.ansi',
  'progress.jsonl',
];

test('measured collection uses exact independent ceilings and actual canary work', () => {
  assert.deepEqual(collectionLimits, {
    file: 16777216,
    contents: 25165824,
    surfaces: 33554432,
    work: 201326592,
    detail: 262144,
  });
  for (const limit of Object.values(collectionLimits)) {
    collectionAdmit(limit, limit);
    for (const value of [limit + 1, -1, NaN, Infinity, '1', 0.5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => collectionAdmit(value, limit));
  }
  assert.equal(rendererWork(0, 0, 4, 33554432), 201326592);
  assert.throws(() => rendererWork(0, 1, 4, 33554432));
  assert.equal(rendererWork(18977624, 15, 2, 19050075), 114155563);
  assert.throws(() => rendererWork(0, 0, 5, 33554432));
});
const collectionCanaries = ['a'.repeat(64), 'b'.repeat(64)];
function captureEntries(log = Buffer.from('ordinary\n')) {
  return [
    { path: metadataRoots.state + '/unicode-\u00e9', bytes: Buffer.from('\u00e9\ufffd\n') },
    ...requiredInventoryNames.map((name) => ({
      path: metadataRoots.evidence + '/' + name,
      bytes: Buffer.from(
        name === 'fixture.jsonl' ? 'fixture' : name === 'inventory.json' ? '{}' : '',
      ),
    })),
    { path: metadataRoots.state + '/host.log', bytes: log },
  ];
}
test('actual six surfaces preserve complete paths, UTF-8, log duplication, order and hashes', () => {
  const entries = captureEntries(),
    raw = [Buffer.from('one'), Buffer.from('two')];
  const capture = rendererBuildCapture(entries, metadataRoots, raw, collectionCanaries);
  assert.deepEqual(capture.tui, Buffer.from('onetwo'));
  assert.deepEqual(capture.diagnostics, entries.at(-1).bytes);
  for (const [surface, root] of Object.entries(metadataRoots))
    assert.deepEqual(
      capture[surface],
      Buffer.concat(
        entries
          .filter((e) => e.path.startsWith(root + '/'))
          .flatMap((e) => [Buffer.from(e.path), e.bytes]),
      ),
    );
  const scan = rendererScan(capture, collectionCanaries, true, false);
  for (const s of rendererSurfaces) assert.equal(scan.hashes[s], digest(capture[s]));
  rendererAttachFiles(scan, entries);
  assert.deepEqual(
    scan.files,
    entries.map((e) => ({ path: e.path, sha256: digest(e.bytes), bytes: e.bytes.length })),
  );
});
test('surface and work excess refuse before any concatenation including actual path/log duplication', () => {
  const bytes = Buffer.alloc(16777216 - 2048, 120),
    entries = captureEntries(bytes);
  const base = rendererBuildCapture(entries, metadataRoots, [], collectionCanaries);
  const used = Object.values(base).reduce((n, b) => n + b.length, 0);
  const raw = Buffer.alloc(collectionLimits.surfaces - used, 120);
  let calls = 0;
  const concat = (...args) => {
    calls++;
    return Buffer.concat(...args);
  };
  const exact = rendererBuildCapture(entries, metadataRoots, [raw], collectionCanaries, concat);
  assert.equal(
    Object.values(exact).reduce((n, b) => n + b.length, 0),
    collectionLimits.surfaces,
  );
  assert.equal(calls, 4);
  for (const [buffers, canaries] of [
    [[raw, Buffer.from('x')], collectionCanaries],
    [[raw], [...collectionCanaries, 'c'.repeat(64), 'd'.repeat(64)]],
  ]) {
    calls = 0;
    assert.throws(() => rendererBuildCapture(entries, metadataRoots, buffers, canaries, concat));
    assert.equal(calls, 0);
  }
});
test('full-buffer scans catch late canaries and unchanged credential regex on every surface and in paths', () => {
  for (const s of rendererSurfaces)
    for (const secret of [
      ...collectionCanaries,
      'cap_' + 'f'.repeat(64),
      'sk-' + 'Q'.repeat(20),
      'ghp_' + 'Z'.repeat(20),
      'Bearer ' + 'A'.repeat(20),
      '-----BEGIN RSA PRIVATE KEY-----',
    ]) {
      const capture = Object.fromEntries(
        rendererSurfaces.map((name) => [
          name,
          Buffer.from(name === s ? 'x'.repeat(65535) + secret : '\u00e9 ordinary'),
        ]),
      );
      assert.throws(() => rendererScan(capture, collectionCanaries, true, false), /SECRET/);
    }
  const entries = captureEntries();
  entries[0].path += collectionCanaries[1];
  assert.throws(
    () =>
      rendererScan(
        rendererBuildCapture(entries, metadataRoots, [], collectionCanaries),
        collectionCanaries,
        true,
        false,
      ),
    /SECRET/,
  );
  const splitUtf8 = Buffer.concat([
    Buffer.from([0xc3]),
    Buffer.from([0xa9]),
    Buffer.from('Bearer ' + 'A'.repeat(20)),
  ]);
  const capture = Object.fromEntries(rendererSurfaces.map((s) => [s, splitUtf8]));
  assert.throws(() => rendererScan(capture, collectionCanaries, true, false), /SECRET_PATTERN/);
});
test('exact actual scan marker and seven detail files admit together, never omit the marker', () => {
  const capture = rendererBuildCapture(captureEntries(), metadataRoots, [], collectionCanaries);
  const scan = rendererAttachFiles(
    rendererScan(capture, collectionCanaries, true, false),
    captureEntries(),
  );
  for (const text of [
    '\u00e9\ud83d\ude00',
    '\ud800\udc00\ud800\udc01',
    '\ud800',
    '\udc00',
    '\"\\\n\t\u0000',
  ])
    assert.equal(rendererJsonBytes({ text }), Buffer.byteLength(JSON.stringify({ text })));
  const marker = Buffer.byteLength(JSON.stringify(scan));
  assert.equal(rendererJsonBytes(scan), marker);
  const lengths = Object.fromEntries(
    rendererDetailFiles.map((name, i) => [name, i ? 0 : collectionLimits.detail - marker]),
  );
  assert.equal(rendererDetailAdmission(scan, lengths), collectionLimits.detail);
  lengths[rendererDetailFiles[0]]++;
  assert.throws(() => rendererDetailAdmission(scan, lengths));
  assert.throws(() =>
    rendererAttachFiles({ ...scan, files: undefined }, [
      { path: 'x'.repeat(collectionLimits.detail), bytes: Buffer.alloc(0) },
    ]),
  );
});
test('outer transfer caps each TAR before parsing, counts actual marker bytes and retains no partial result', async () => {
  const scan = rendererScan(
    Object.fromEntries(rendererSurfaces.map((s) => [s, Buffer.alloc(0)])),
    collectionCanaries,
    true,
    false,
  );
  // Whitespace is actual transfer/export content, not reserialized JSON length.
  const marker = Buffer.from(JSON.stringify(scan) + ' '.repeat(17));
  for (const excess of [0, 1]) {
    let used = 0,
      calls = 0,
      published = false;
    const action = rendererTransferDetails(async (name, cap) => {
      assert.equal(cap, collectionLimits.detail - used + 4096);
      calls++;
      const bytes =
        name === 'scan-pass.json'
          ? marker
          : Buffer.alloc(name === 'progress.jsonl' ? collectionLimits.detail - used + excess : 0);
      used += bytes.length;
      return inventoryArchive(bytes, bytes.length, name);
    }).then((details) => {
      published = true;
      return details;
    });
    if (excess) {
      await assert.rejects(action);
      assert.equal(published, false);
    } else {
      const details = await action;
      assert.equal(
        [...details.values()].reduce((n, b) => n + b.length, 0),
        collectionLimits.detail,
      );
    }
    assert.equal(calls, 8);
  }
  for (const index of [0, 124, 148, 156, 157, 345]) {
    const archive = inventoryArchive(marker, marker.length, 'scan-pass.json');
    archive[index] = 120;
    assert.throws(() => parseRendererArchive(archive, 'scan-pass.json', collectionLimits.detail));
  }
  let calls = 0;
  await assert.rejects(
    rendererTransferDetails(async (name) => {
      calls++;
      return inventoryArchive(Buffer.from('{'), 1, name);
    }),
  );
  assert.equal(calls, 1, 'no detail transfer follows refused marker');
});
test('private collection shares bounded traversal, exact identity, complete membership and closes on late changes', async () => {
  const f = metadataFixture(() => {}, true);
  f.nodes.set(metadataRoots.state + '/first', { size: 0n });
  f.nodes.set(metadataRoots.state + '/nested', { directory: true, size: 0n });
  f.nodes.set(metadataRoots.state + '/nested/child', { size: 0n });
  f.nodes.set(metadataRoots.state + '/last', { size: 0n });
  const entries = await f.collect();
  assert.deepEqual(
    entries.map((e) => e.path),
    ['first', 'nested/child', 'last']
      .map((name) => metadataRoots.state + '/' + name)
      .concat(
        [...f.nodes.keys()].filter(
          (p) => p.startsWith(metadataRoots.evidence + '/') && !f.nodes.get(p).directory,
        ),
      ),
  );
  assert.equal(
    f.reads,
    17,
    'each complete nonempty file plus one EOF probe, including empty files',
  );
  assert.ok(
    entries.every((e) => e.bytes.equals(Buffer.alloc(Number(f.nodes.get(e.path).size), 120))),
  );
  for (const kind of ['identity', 'membership', 'directory', 'late-leak']) {
    let changed = false,
      bindingOpens = 0;
    const bad = metadataFixture((op, path, nodes, pass) => {
      if (changed) return;
      if (op === 'contentread' && kind !== 'identity') {
        changed = true;
        if (kind === 'membership' || kind === 'late-leak')
          nodes.set(metadataRoots.state + '/new.log', {
            size: 64n,
            bytes: Buffer.from(collectionCanaries[0]),
          });
        else
          nodes.get(metadataRoots.evidence).metadata = { mtimeNs: metadataIdentity.mtimeNs + 1n };
      } else if (
        kind === 'identity' &&
        op === 'open' &&
        path.endsWith('binding.json') &&
        ++bindingOpens === 2
      ) {
        changed = true;
        nodes.get(path).metadata = { ino: metadataIdentity.ino + 1n };
      }
    }, true);
    await assert.rejects(bad.collect(), undefined, kind);
  }
  const io = collectionIO(1);
  await assert.rejects(
    rendererReadFile({}, 'synthetic', 'state', 0, io, ['file', 1n, 999n, 1n, 3n, 4n]),
  );
  assert.deepEqual(io.calls.allocations, []);
});
test('private collection refuses metadata, source, surface and dynamic-work excess before content allocation', async () => {
  for (const kind of ['source', 'file', 'surface', 'work', 'path', 'entries', 'required', 'logs']) {
    const f = metadataFixture(() => {}, true);
    if (kind === 'source') {
      f.nodes.set(metadataRoots.state + '/one', { size: 16777216n });
      f.nodes.set(metadataRoots.state + '/two', { size: 16777216n });
    }
    if (kind === 'file') f.nodes.set(metadataRoots.state + '/one', { size: 16777217n });
    if (kind === 'surface' || kind === 'work')
      f.nodes.set(metadataRoots.state + '/host.log', { size: 16777216n });
    if (kind === 'path') f.nodes.set(metadataRoots.state + '/' + 'x'.repeat(4096), { size: 0n });
    if (kind === 'required') f.nodes.delete(metadataRoots.evidence + '/binding.json');
    if (kind === 'logs') f.nodes.delete(metadataRoots.evidence + '/host.log');
    await assert.rejects(
      f.collect(
        kind === 'work' ? Array(8).fill('c'.repeat(64)) : collectionCanaries,
        0,
        kind === 'entries' ? { ...inventoryLimits, entries: 2n } : inventoryLimits,
      ),
    );
    assert.equal(f.reads, 0);
  }
});

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
function metadataFixture(hook = () => {}, content = false, nested = false) {
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
    const result = {
      ...metadataIdentity,
      size: node.size,
      isFile: () => !node.directory && !node.special,
      isDirectory: () => !!node.directory,
      isSymbolicLink: () => !!node.link,
      ...node.metadata,
    };
    for (const field of node.omitMetadata ?? []) delete result[field];
    return result;
  };
  const acquire = () => {
    if (!nested) assert.equal(active, 0, 'one descriptor at a time');
    active++;
    opened++;
  };
  const close = async () => {
    assert.ok(active > 0);
    active--;
    closed++;
  };
  const io = {
    allocate: Buffer.alloc,
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
        read(buffer, offset, length, position) {
          reads++;
          if (content) {
            hook('contentread', path, nodes, pass);
            const size = Number(nodes.get(path).size);
            const bytesRead = Math.min(length, Math.max(0, size - position));
            const bytes = nodes.get(path).bytes ?? Buffer.alloc(size, 120);
            bytes.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          }
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
          if (index === names.length) return null;
          const entryPath = names[index++];
          return {
            name: entryPath.slice(path.length + 1),
            isDirectory: () => !!nodes.get(entryPath).directory,
            isSymbolicLink: () => !!nodes.get(entryPath).link,
          };
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
    descriptorBalance: () => {
      assert.equal(active, 0);
      assert.equal(opened, closed);
    },
    async collect(
      canaries = ['a'.repeat(64), 'b'.repeat(64)],
      rawBytes = 0,
      limits = inventoryLimits,
    ) {
      try {
        return await rendererCollectFiles(
          {},
          metadataRoots,
          rawBytes,
          canaries,
          30000,
          io,
          limits,
          () => 0,
        );
      } finally {
        assert.equal(active, 0);
        assert.equal(opened, closed);
      }
    },
    get reads() {
      return reads;
    },
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

test('product collector reuses bounded complete traversal, refuses metadata races/oversize/deadline and closes resources', async () => {
  for (const fault of ['none', 'oversize', 'race', 'deadline']) {
    const f = metadataFixture((op, path, nodes, pass) => {
      if (fault === 'oversize') nodes.get(metadataRoots.evidence + '/host.log').size = 16777217n;
      if (fault === 'race' && op === 'contentread') nodes.get(path).metadata = { mtimeNs: 999n };
    }, true);
    // Real product captures have their own names, never the renderer fixture's
    // binding/fixture/inventory/transcript preconditions.
    for (const path of [...f.nodes.keys()])
      if (
        path.startsWith(metadataRoots.evidence + '/') &&
        !path.endsWith('/host.log') &&
        !path.endsWith('/progress.jsonl')
      )
        f.nodes.delete(path);
    f.nodes.set(metadataRoots.evidence + '/composition-observations.json', { size: 5n });
    const run = collectProductCapture(
      metadataRoots,
      [{ bytes: Buffer.from('raw') }],
      ['a'.repeat(64), 'b'.repeat(64)],
      fault === 'deadline' ? 0 : Date.now() + 5000,
      f.io,
    );
    if (fault === 'none') {
      const entries = await run;
      assert.equal(entries.length, f.nodes.size - 2);
      assert.ok(entries.some((e) => e.path.endsWith('/host.log')));
    } else await assert.rejects(run);
    f.descriptorBalance();
    if (fault === 'oversize' || fault === 'deadline') assert.equal(f.reads, 0);
  }
});

test('actual product readiness and final input routes adapt semantic labels without opening renderer schema', async () => {
  const f = metadataFixture(() => {}, true, true);
  const wire = '/run/proceed/qualification-private/composition-wire.jsonl';
  const add = (path, text) =>
    f.nodes.set(path, { bytes: Buffer.from(text), size: BigInt(Buffer.byteLength(text)) });
  add(metadataRoots.state + '/journal.log', 'complete journal');
  add(wire, '');
  add(metadataRoots.state + '/host.log', 'complete diagnostics');
  const accounting = { entries: 0, paths: 0, bytes: 0, deadline: Date.now() + 5000 };
  const diagnostics = await productCaptureLogs(metadataRoots.state, accounting, 0, f.io);
  assert.deepEqual(diagnostics, Buffer.from('complete journalcomplete diagnostics'));
  assert.equal(accounting.bytes, diagnostics.length);
  const inputs = await productCaptureInputs(metadataRoots.state, wire, f.io);
  assert.deepEqual(inputs, { journal: Buffer.from('complete journal'), api: Buffer.alloc(0) });
  f.descriptorBalance();
  add(wire, 'unexpected exchange');
  await assert.rejects(productCaptureInputs(metadataRoots.state, wire, f.io));
  f.descriptorBalance();
  for (const surface of ['diagnostics', 'journal', 'api']) {
    await assert.rejects(rendererReadFile({}, metadataRoots.state + '/host.log', surface, 0, f.io));
  }
  assert.throws(() => productCaptureReadFile({}, 'unused', 'fixture', 0, f.io));
  f.nodes.get(metadataRoots.state + '/host.log').size = 16777217n;
  await assert.rejects(
    productCaptureLogs(metadataRoots.state, { ...accounting, bytes: 0 }, 0, f.io),
  );
  f.descriptorBalance();
  await assert.rejects(
    productCaptureLogs(metadataRoots.state, { ...accounting, deadline: 0 }, 0, f.io),
  );
  const inner = await readFile(
    new URL('./support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.match(inner, /return productCaptureLogs\(root, accounting, depth\)/);
  assert.match(
    inner,
    /productCaptureInputs\(\s*h.state,\s*'\/run\/proceed\/qualification-private\/composition-wire.jsonl'/,
  );
  assert.doesNotMatch(inner, /rendererReadFile/);
});

function producedTransportAuthorities() {
  return transportFixtureAuthorities(
    {
      operator: { credential: 'hop_' + '1'.repeat(64) },
      control: 'control-' + '2'.repeat(64),
      owner: 'owner-' + '3'.repeat(64),
    },
    '4'.repeat(64),
    'hop_' + '5'.repeat(64),
  );
}

test('actual transport producer freezes every distinct authority once and rejects incomplete or malformed coverage', async () => {
  const produced = producedTransportAuthorities();
  assert.equal(produced.secrets.length, 11);
  const frozen = freezeTransportSecrets(produced);
  assert.equal(frozen.length, 5);
  assert.equal(Object.isFrozen(frozen), true);
  const late = 'late-role-' + '6'.repeat(64);
  produced.authorities.roles.late = late;
  produced.secrets.push(late, produced.authorities.base[0]);
  const final = freezeTransportSecrets(produced);
  assert.equal(final.length, 6);
  assert.ok(final.includes(late));
  assert.equal(frozen.length, 5);
  for (const secret of final) {
    assert.throws(() =>
      freezeTransportSecrets({
        ...produced,
        secrets: produced.secrets.filter((s) => s !== secret),
      }),
    );
  }
  for (const invalid of ['', ' ', ' padded ', null, undefined, 1, {}, Buffer.from('x')]) {
    assert.throws(() =>
      freezeTransportSecrets({ ...produced, secrets: [...produced.secrets, invalid] }),
    );
    const broken = producedTransportAuthorities();
    broken.authorities.roles.unenrolled = invalid;
    assert.throws(() => freezeTransportSecrets(broken));
  }
  assert.throws(() => freezeTransportSecrets({ ...produced, secrets: [...produced.secrets, ,] }));
  for (const invalid of [null, {}, 'not-an-array', []])
    assert.throws(() => freezeTransportSecrets({ ...produced, secrets: invalid }));
  assert.throws(() =>
    freezeTransportSecrets({ ...produced, secrets: [...produced.secrets, 'unexpected-authority'] }),
  );
  for (const invalid of ['', null, undefined, 1]) {
    const broken = producedTransportAuthorities();
    broken.authorities.base[0] = invalid;
    assert.throws(() => freezeTransportSecrets(broken));
  }
  const missingRole = producedTransportAuthorities();
  delete missingRole.authorities.roles.unenrolled;
  assert.throws(() => freezeTransportSecrets(missingRole));
  const aliased = producedTransportAuthorities();
  aliased.authorities.roles.unenrolled = aliased.authorities.base[0];
  assert.throws(() => freezeTransportSecrets(aliased));
  const captures = Object.fromEntries(compositionSurfaces.map((s) => [s, Buffer.from('clean')]));
  assert.equal(
    scanFrozenComposition({
      captures,
      secrets: final,
      complete: true,
      overflow: false,
      measured: true,
    }).scan.status,
    'PASS',
  );
  for (const surface of compositionSurfaces)
    for (const secret of final) {
      assert.throws(
        () =>
          scanFrozenComposition({
            captures: { ...captures, [surface]: Buffer.from('prefix' + secret + 'suffix') },
            secrets: final,
            complete: true,
            overflow: false,
            measured: true,
          }),
        (error) => compositionScanReason(error) === 'SECRET_MATCH',
      );
    }
  assert.throws(
    () =>
      scanFrozenComposition({
        captures,
        secrets: produced.secrets,
        complete: true,
        overflow: false,
      }),
    (error) => compositionScanReason(error) === 'SECRET_SET',
  );
  const inner = await readFile(
    new URL('./support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const transport = await readFile(
    new URL('./support/harness-transport-fixtures.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    inner,
    /let controlsClosed = false;\s*try \{\s*requiredSecrets = freezeTransportSecrets\(controls\)/,
  );
  assert.match(transport, /const authoritySet = transportFixtureAuthorities\(/);
  assert.match(transport, /const key = authorities.roles\[id\]/);
});

test('product exports require all six product meanings, every secret, exact frozen bytes and aggregate admission before retention', async () => {
  const secrets = freezeTransportSecrets(producedTransportAuthorities());
  const details = Object.fromEntries(productCaptureFiles.map((n) => [n, Buffer.from(n)]));
  const captures = Object.fromEntries(compositionSurfaces.map((s) => [s, Buffer.from('safe')]));
  captures.tui = details['transcript.ansi'];
  captures.diagnostics = details['plugin-diagnostics.log'];
  captures.evidence = Buffer.concat([
    details['composition-observations.json'],
    details['progress.jsonl'],
  ]);
  const frozen = productCaptureExport(captures, secrets, true, false, details);
  for (const file of productCaptureFiles) {
    assert.notEqual(frozen.details[file], details[file]);
    assert.deepEqual(frozen.details[file], details[file]);
  }
  assert.deepEqual(frozen.scan.surfaces, compositionSurfaces);
  const transferred = [];
  const transfer = async (name, cap) => {
    transferred.push(name);
    const b = name === 'scan-pass.json' ? Buffer.from(JSON.stringify(frozen.scan)) : details[name];
    const archive = inventoryArchive(b, b.length, name);
    assert.ok(archive.length <= cap);
    return archive;
  };
  assert.equal((await transferProductCapture(transfer)).size, 5);
  assert.deepEqual(transferred, ['scan-pass.json', ...productCaptureFiles]);
  // Execute the actual export -> five-transfer -> explicit retained mapping
  // helpers. Only the container and filesystem transport are synthetic here.
  const admitted = await transferProductCapture(transfer);
  const retained = new Map();
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  const routeSource = runner.slice(
    runner.indexOf('  const evidenceDestination ='),
    runner.indexOf('  const retainDiagnostic ='),
  );
  assert.ok(routeSource.length > 0 && routeSource.length < 1500);
  const context = {
    join,
    retainProgress,
    run: '',
    name: 'synthetic',
    started: Date.now(),
    Date,
    appendFile: async (path, text) =>
      retained.set(path, Buffer.concat([retained.get(path) ?? Buffer.alloc(0), Buffer.from(text)])),
    writeFile: async (path, text) => retained.set(path, Buffer.from(text)),
  };
  // Execute only the actual private destination and outer-progress closures,
  // never the runner entrypoint, preflight, container or process orchestration.
  runInNewContext(
    'let progressState;\n' +
      routeSource +
      '\nglobalThis.route = { evidenceDestination, progress };',
    context,
    { timeout: 1000 },
  );
  for (const [name, bytes] of admitted) {
    assert.equal(context.route.evidenceDestination(name), productRetainedPaths[name]);
    retained.set(context.route.evidenceDestination(name), bytes);
  }
  await context.route.progress('outer-start');
  const expected = Object.fromEntries(
    [...admitted].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }]),
  );
  const read = async (path) => retained.get(path);
  const verified = await verifyRetainedProductCapture({ read, expected });
  assert.equal(verified.size, 5);
  assert.deepEqual(verified.get('progress.jsonl'), frozen.details['progress.jsonl']);
  for (const changed of [
    { ...expected, extra: expected['progress.jsonl'] },
    { ...expected, 'transcript.ansi': { ...expected['transcript.ansi'], bytes: -1 } },
    { ...expected, 'transcript.ansi': { ...expected['transcript.ansi'], sha256: 'f'.repeat(64) } },
  ])
    await assert.rejects(verifyRetainedProductCapture({ read, expected: changed }));
  const innerHash = digest(retained.get('inner-progress.jsonl'));
  await context.route.progress('outer-teardown');
  assert.equal(digest(retained.get('inner-progress.jsonl')), innerHash);
  assert.equal((await verifyRetainedProductCapture({ read, expected })).size, 5);
  details['progress.jsonl'].fill(0);
  assert.equal(digest(frozen.details['progress.jsonl']), innerHash);
  for (const path of [
    'progress.jsonl',
    '../inner-progress.jsonl',
    '/inner-progress.jsonl',
    'C:\\inner-progress.jsonl',
    'transcript.ansi',
    'TRANSCRIPT.ANSI',
    'inner-progress.jsonl/../progress.jsonl',
  ]) {
    let reads = 0;
    await assert.rejects(
      verifyRetainedProductCapture({
        read: async () => {
          reads++;
          return Buffer.alloc(0);
        },
        expected,
        mapping: { ...productRetainedPaths, 'progress.jsonl': path },
      }),
    );
    assert.equal(reads, 0);
  }
  for (const name of ['scan-pass.json', ...productCaptureFiles]) {
    for (const change of ['length', 'hash', 'missing']) {
      await assert.rejects(
        verifyRetainedProductCapture({
          expected,
          read: async (path) => {
            const bytes = retained.get(path);
            if (path !== productRetainedPaths[name]) return bytes;
            if (change === 'missing') return undefined;
            if (change === 'length') return Buffer.concat([bytes, Buffer.from('x')]);
            const changed = Buffer.from(bytes);
            changed[0] ^= 1;
            return changed;
          },
        }),
      );
    }
  }
  const inner = await readFile(
    new URL('./support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /file === 'progress\.jsonl' \? 'inner-progress\.jsonl' : file/);
  assert.match(runner, /appendFile\(join\(run, 'progress\.jsonl'\)/);
  assert.equal(
    (
      runner.match(
        /for \(const \[file, bytes\] of details\) await writeFile\(evidenceDestination\(file\), bytes\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    inner,
    /await controls\.close\(\);[\s\S]*const complete = closed && remainingPids\.length === 0;[\s\S]*assert\.ok\(complete && productCleanup === 'OBSERVED'\);[\s\S]*const entries = await collectProductCapture\([\s\S]*const frozen = productCaptureExport\([\s\S]*Object\.entries\(frozen\.details\)/,
  );
  // Restore the synthetic input for the existing substitution controls below.
  details['progress.jsonl'] = Buffer.from('progress.jsonl');
  await assert.rejects(
    transferProductCapture(async (name, cap) =>
      name === 'transcript.ansi'
        ? inventoryArchive(Buffer.from('replaced'), 8, name)
        : transfer(name, cap),
    ),
  );
  for (const surface of compositionSurfaces) {
    for (const secret of [...secrets, 'cap_' + 'f'.repeat(64), '-----BEGIN PRIVATE KEY-----']) {
      const changed = {
        ...captures,
        [surface]: Buffer.concat([captures[surface], Buffer.from(secret)]),
      };
      assert.throws(() => productCaptureExport(changed, secrets, true, false, details));
    }
    const missing = { ...captures };
    delete missing[surface];
    assert.throws(() => productCaptureExport(missing, secrets, true, false, details));
  }
  assert.throws(() => productCaptureExport(captures, secrets, false, false, details));
  assert.throws(() => productCaptureExport(captures, secrets, true, true, details));
  assert.throws(() =>
    productCaptureExport(captures, secrets, true, false, {
      ...details,
      'transcript.ansi': Buffer.from('not scanned'),
    }),
  );
  const large = { ...details, 'transcript.ansi': Buffer.alloc(262144) };
  assert.throws(() =>
    productCaptureExport(
      { ...captures, tui: large['transcript.ansi'] },
      secrets,
      true,
      false,
      large,
    ),
  );
});

test('inventory admits exact epoch-ns and large identities without exporting internal metadata', async () => {
  const baseline = await metadataFixture().run();
  assert.equal(baseline.complete, true);
  for (const field of Object.keys(metadataIdentity)) {
    const f = metadataFixture();
    f.nodes.get(metadataRoots.evidence + '/host.log').metadata = {
      [field]: metadataIdentity[field] + 1n,
    };
    assert.deepEqual(await f.run(), baseline, field);
    assert.equal(JSON.stringify(baseline).includes(metadataIdentity[field].toString()), false);
  }
  for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
    for (const target of [metadataRoots.evidence, metadataRoots.evidence + '/host.log']) {
      const f = metadataFixture();
      f.nodes.get(target).omitMetadata = [field];
      assert.deepEqual(await f.run(), incompleteInventory(), `absent ${field}`);
    }
    for (const bad of [undefined, null, 1, '1', -1n, NaN]) {
      const f = metadataFixture();
      f.nodes.get(metadataRoots.evidence + '/host.log').metadata = { [field]: bad };
      assert.deepEqual(await f.run(), incompleteInventory(), `${field}: ${String(bad)}`);
    }
  }
});

test('inventory detects one-bit identity/timestamp changes at descriptor, path and pass comparisons', async () => {
  for (const field of Object.keys(metadataIdentity)) {
    const original = metadataIdentity[field];
    // These distinct bigint operands collapse to the same Number. A lossy
    // comparison would incorrectly admit every instability below.
    assert.equal(Number(original), Number(original + 1n));
    for (const [event, occurrence, directory] of [
      ['fstat', 1, false],
      ['lstat', 2, false],
      ['lstat', 3, false],
      ['lstat', 2, true],
      ['lstat', 3, true],
    ]) {
      let seen = 0;
      const target = directory ? metadataRoots.evidence : metadataRoots.evidence + '/host.log';
      const f = metadataFixture((op, path, nodes) => {
        if (op === event && path === target && ++seen === occurrence)
          nodes.get(path).metadata = { [field]: original + 1n };
      });
      assert.deepEqual(
        await f.run(),
        incompleteInventory(),
        `${field}: ${event} ${occurrence}, directory ${directory}`,
      );
      assert.equal(seen, occurrence);
    }
  }
});

test('inventory charges longer exact internal decimal records against the same retained budget', async () => {
  const cutoff = async (wide) => {
    const fixture = () => {
      const f = metadataFixture();
      if (wide)
        f.nodes.get(metadataRoots.evidence + '/host.log').metadata = {
          ino: 10n ** 80n,
          mtimeNs: 10n ** 80n + 1n,
        };
      return f;
    };
    let low = 1n,
      high = inventoryLimits.retained;
    while (low < high) {
      const mid = (low + high) / 2n;
      if ((await fixture().run({ ...inventoryLimits, retained: mid })).complete) high = mid;
      else low = mid + 1n;
    }
    assert.equal((await fixture().run({ ...inventoryLimits, retained: low })).complete, true);
    assert.deepEqual(
      await fixture().run({ ...inventoryLimits, retained: low - 1n }),
      incompleteInventory(),
    );
    return low;
  };
  const ordinary = await cutoff(false),
    wide = await cutoff(true);
  // Both passes charge twice each serialized record. Only these two decimal
  // fields grow. Their exact lengths must affect admission, not just equality.
  assert.equal(wide - ordinary, 4n * BigInt(81 - 16 + 81 - 19));
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
        if (fault === 'replacement') nodes.get(path).metadata = { ino: metadataIdentity.ino + 1n };
        if (fault === 'rewrite')
          nodes.get(path).metadata = { mtimeNs: metadataIdentity.mtimeNs + 1n };
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
        nodes.get(path).metadata = { ctimeNs: metadataIdentity.ctimeNs + 1n };
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

function inventoryArchive(payload, declared = payload.length, name = 'renderer-inventory.json') {
  const header = Buffer.alloc(512);
  header.write(name);
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
    inner.indexOf('    } else {\n      const collectionEnd'),
  );
  assert.match(inventoryBranch, /rendererMetadataInventory/);
  assert.doesNotMatch(inventoryBranch, /readFile|rendererScan|digest|progress\(/);
  const outerBranch = runner.slice(
    runner.indexOf('if (rendererInventory) {\n      let inventory'),
    runner.indexOf(
      '} else if (renderer) {',
      runner.indexOf('if (rendererInventory) {\n      let inventory'),
    ),
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
  assert.match(inner, /rendererCollectFiles\(\s*collection,\s*\{ state: root, evidence \}/);
  assert.match(inner, /rendererBuildCapture\(\s*entries,\s*\{ state: root, evidence \}/);
  assert.doesNotMatch(inner, /readFile\(path\)/);
  assert.ok(
    runner.indexOf('const details = await rendererTransferDetails') <
      runner.indexOf('for (const [file, bytes] of details)'),
  );
});
// Source-buffer model only. The marker remains on current A after selection moves.
const decorated = (a, b, absolute = false) =>
  begin +
  `\x1b[3;1H${a}${marker} ${absolute ? '\x1b[3;3H' : ''}${alpha}` +
  `\x1b[4;1H${b}  ${beta}` +
  end;

test('finite source layout preserves indexed identity, asymmetric inactive styles and RGB compatibility', () => {
  const indexedSelected = '\x1b[0;1;38;5;232;48;5;216m';
  const indexedCurrent = '\x1b[0;38;5;216;48;5;233m';
  const indexedOrdinary = '\x1b[0;38;5;255;48;5;233m';
  const raw = '\x1b[?1049h' + decorated(indexedSelected, indexedOrdinary);
  const observe = (s, previous) => rendererCells(s, previous, undefined, { sourceLayout: true });
  const before = observe(raw);
  const after = observe(raw + decorated(indexedCurrent, indexedSelected), before);
  assert.deepEqual(before.labels[alpha], {
    fg: 'index:232',
    bg: 'index:216',
    bold: true,
    supported: true,
  });
  assert.deepEqual(after.labels[beta], before.labels[alpha]);
  assert.equal(before.labels[beta].fg, 'index:255');
  assert.equal(after.labels[alpha].fg, 'index:216');
  assert.equal(after.labels[alpha].bold, false);
  assert.deepEqual(after.markers, before.markers);
  assert.equal(after.generation, 1);
  assert.equal(before.profileInstalled, false);
  assert.deepEqual(
    compositionSourceFrame(initialCells).styles,
    compositionCurrentFrame(initialCells, { styled: true }).styles,
  );
  const rgb = compositionSourceFrame(begin + '\x1b[1;1H\x1b[38;2;232;232;232mX' + end);
  assert.notEqual(rgb.styles[0][0].fg, before.labels[alpha].fg);
  for (const bad of [raw, raw.replace('ALPHA', 'CHANGED')])
    assert.throws(() => observe(bad, before), /STALE_UPDATE|TRANSCRIPT_REPLACED/);
  assert.throws(
    () =>
      observe(raw + '\x1b[?1049l\x1b[?1049h' + decorated(indexedCurrent, indexedSelected), before),
    /GENERATION_RESET/,
  );
  // The opt-in model does not silently teach the RGB navigation/readiness path indexed colors.
  assert.equal(compositionCurrentFrame(raw, { styled: true, sourceMarkerCells: true }), '');
});

test('source scalar support is finite and rejects clusters rather than ignoring them', () => {
  const glyphs = '\u00b7\u2026\u203a\u2299\u2503\u2579\u2580\u2584\u2588\u25cf';
  const paint = (s) => begin + '\x1b[1;1H' + s + end;
  const decoded = compositionSourceFrame(paint(glyphs + 'Z'));
  assert.equal(decoded.supported, true);
  assert.equal(decoded.text, glyphs + 'Z');
  assert.deepEqual(decoded.cursor, { row: 0, col: 11 });
  for (const bad of [
    '\u25cf\ufe0f',
    '\u203a\ufe0f',
    '\u203a\u200d\u203a',
    '\u203a\u0301',
    '\u2039',
    '\u2299\ufe0f',
    '\u2299\u200d\u2299',
    '\u2299\u0301',
    '\u2298',
    '\u229a',
    '\u2588\u200d\u2588',
    'e\u0301',
    '\u4e00',
    '\ufffd',
    '\ud800',
    '\x80',
    '\n',
  ])
    assert.equal(compositionSourceFrame(paint(bad)).reason, 'UNSUPPORTED_GLYPH');
});

test('exact fallback reset is only trailing after discard and never revives current cells', () => {
  const fallback = '\x1b]12;default\x07';
  const paint = '\x1b[?1049h' + begin + '\x1b[HX\x1b[sY\x1b[uZ' + end;
  const discard = '\x1b[?1049l';
  const prefix = paint + discard;
  const noFrame = compositionSourceFrame(prefix);
  assert.equal(noFrame.reason, 'NO_CURRENT_FRAME');
  // Non-cell presentation does not turn historical cells into a current frame.
  for (const suffix of ['', '\x1b]112\x07', '\x1b[0 q\x1b[?25h'])
    assert.deepEqual(compositionSourceFrame(prefix + fallback + suffix), {
      ...noFrame,
      byteOffset: Buffer.byteLength(prefix + fallback + suffix),
    });
  for (const before of [
    '',
    '\x1b[?1049h',
    paint,
    paint + begin,
    '\x1b[?1049h' + discard,
    prefix + '\x1b[2J',
    prefix + '\x1b[?1049h',
    '\x1b[2J\x1b[2J' + begin + '\x1b[HX' + end,
  ]) {
    const result = compositionSourceFrame(before + fallback);
    assert.equal(result.reason, 'UNSAFE_CURSOR_RESET_PHASE');
    assert.equal(result.byteOffset, Buffer.byteLength(before));
    assert.equal(result.operation, 12);
  }
  // Even with prior completed paint, this may not license a later update.
  assert.equal(
    compositionSourceFrame(prefix + fallback + begin + end).reason,
    'UNSAFE_CURSOR_RESET_PHASE',
  );
  // Save register and unknown position still belong to the discarded generation.
  assert.equal(compositionSourceFrame(prefix + fallback + '\x1b[u').reason, 'UNMATCHED_RESTORE');
  assert.equal(
    compositionSourceFrame(prefix + fallback + '\x1b[s\x1b[uX').reason,
    'UNKNOWN_PAINT_POSITION',
  );
  for (const token of [
    fallback.replace('default', 'defaulX'), // Same length is not identity.
    fallback.replace('\x07', '\x1b\\'),
    '\x1b]12;?\x07',
    '\x1b]12;DEFAULT\x07',
    '\x1b]12;default;\x07',
    '\x1b]113\x07',
  ])
    assert.equal(compositionSourceFrame(prefix + token).reason, 'UNSUPPORTED_OSC_PAYLOAD');
  for (let i = 1; i < fallback.length; i++)
    assert.equal(compositionSourceFrame(prefix + fallback.slice(0, i)).reason, 'INCOMPLETE_ESCAPE');
  // Existing distinct source forms remain supported, without being synonyms.
  const before = compositionSourceFrame(paint);
  for (const token of ['\x1b]12;#aBc012\x07', '\x1b]112\x07'])
    assert.deepEqual(compositionSourceFrame(paint + token), before);
  for (const token of ['\x1b]12;#aBc01X\x07', '\x1b]112\x1b\\'])
    assert.equal(compositionSourceFrame(paint + token).reason, 'UNSUPPORTED_OSC_PAYLOAD');
});

test('exact query payloads and explicit phase policy refuse opaque substitutions', () => {
  const paint = begin + '\x1b[1;1HX' + end;
  const queries = [
    '\x1bP+q4d73\x1b\\',
    '\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\',
    '\x1b]99;i=opentui-notifications:p=?;\x1b\\',
    '\x1b]1337;Capabilities\x1b\\',
    '\x1b]7501;?\x1b\\',
    '\x1b]10;?\x07',
    '\x1b]11;?\x07',
    '\x1b[>0q',
    '\x1b[6n',
    '\x1b[?u',
    '\x1b[c',
    '\x1b[14t',
    ...[1004, 1016, 2004, 2026, 2027, 2031].map((n) => `\x1b[?${n}$p`),
  ];
  for (const query of queries) {
    assert.equal(compositionSourceFrame(query + paint).supported, true);
    assert.equal(compositionSourceFrame(paint + query).supported, true);
    assert.equal(
      compositionSourceFrame(begin + query + '\x1b[1;1HX' + end).reason,
      'UNSAFE_QUERY_PHASE',
    );
  }
  for (const bad of [
    queries[0].replace('73', '74'),
    queries[1].replace('a=q', 'a=t'),
    queries[1].replace('AAAA', 'AAAB'),
    queries[2].replace('p=?', 'p=1'),
    queries[3].replace('Capabilities', 'CapabilitieX'),
    '\x1b]7501;X\x1b\\',
    '\x1b]66;w=2; \x1b\\',
    '\x1b]22;opaque\x1b\\',
    '\x1b]0;bad\x1b[2J\x07',
  ])
    assert.equal(compositionSourceFrame(bad + paint).supported, false);
});

test('exact finite program report preserves source cells, styles, cursor and saved register', () => {
  // Known application identifier, not an exported capture-derived string fixture.
  const report = '\x1b]7501;state=idle:app=opencode\x1b\\';
  const setup = '\x1b[?1049h\x1b[3;4H\x1b[s\x1b[38;5;216m';
  const paint = '\x1b[H\x1b[u' + begin + 'X' + end;
  const expected = compositionSourceFrame(setup + paint);
  assert.equal(expected.supported, true);
  assert.deepEqual(expected.cursor, { row: 2, col: 4 });
  assert.deepEqual(compositionSourceFrame(setup + report + paint), expected);
  // Alternate-screen active, before the first completed frame, outside paint is
  // deliberately narrower observer policy, not a source-enforced emitter order.
  for (const [prefix, suffix] of [
    ['', begin + '\x1b[HX' + end],
    ['\x1b[?1049h' + begin, '\x1b[HX' + end],
    [setup + paint, ''],
    [setup + paint + '\x1b[?1049l', ''],
  ]) {
    assert.deepEqual(compositionSourceFrame(prefix + report + suffix), {
      supported: false,
      reason: 'UNSAFE_PROGRAM_STATUS_PHASE',
      byteOffset: Buffer.byteLength(prefix),
      operation: 7501,
    });
  }
});

test('finite program report refuses other states, fields, order, bounds and encodings', () => {
  const wrap = (body, terminator = '\x1b\\') => '\x1b]7501;' + body + terminator;
  const body = 'state=idle:app=opencode';
  const setup = '\x1b[?1049h';
  const paint = begin + '\x1b[HX' + end;
  const variants = [
    ...['working', 'done', 'blocked', 'error', 'clear', 'unknown', 'IDLE', ''].map((s) =>
      wrap(`state=${s}:app=opencode`),
    ),
    wrap('state=idle'),
    wrap('app=opencode:state=idle'),
    wrap(body + ':app=opencode'),
    wrap(body.replace('opencode', 'opencodX')), // Same byte length is not identity.
    wrap(body + ':unknown=x'),
    wrap('state=idle:id=a:app=opencode'), // Source-valid but unadmitted variant.
    wrap('state=idle:app='),
    wrap('state=idle:app=' + 'a'.repeat(32)),
    wrap('state=idle:app=' + 'a'.repeat(33)),
    wrap('state=idle:app=bad/name'),
    wrap('state=idle:id=' + 'a'.repeat(129) + ':app=opencode'),
    wrap('state=idle:id=' + Array(9).fill('a').join('/') + ':app=opencode'),
    wrap('state=idle:id=a//b:app=opencode'),
    wrap(body + ':kind=permission'),
    wrap(body + ':progress=101'),
    ...['title', 'msg'].flatMap((key) =>
      [
        'YQ==',
        'YR==',
        'YQ',
        'YQ===',
        '***',
        'wIA=',
        'wqA=',
        'AA==',
        'fw==',
        'woA=',
        Buffer.alloc(key === 'title' ? 193 : 2049, 97).toString('base64'),
      ].map((value) => wrap(body + `:${key}=${value}`)),
    ),
    wrap(body + ':msg=' + 'A'.repeat(3221)),
    wrap(body, '\x07'),
    wrap(body + '\x00'),
    wrap(body + '\x7f'),
    wrap(body + '\u0080'),
    wrap(body + '\ud800'),
  ];
  for (const token of variants) {
    const result = compositionSourceFrame(setup + token + paint);
    assert.deepEqual(result, {
      supported: false,
      reason: 'UNSUPPORTED_OSC_PAYLOAD',
      byteOffset: Buffer.byteLength(setup),
      operation: 7501,
    });
  }
  const exact = wrap(body);
  for (let n = 1; n < exact.length; n++)
    assert.equal(compositionSourceFrame(setup + exact.slice(0, n)).supported, false);
  assert.equal(compositionCurrentFrame(setup + exact + paint, { styled: true }), '');
});

test('space probes invalidate paint and cursor until a clear or new generation', () => {
  for (const probe of ['\x1b]66;w=1; \x1b\\', '\x1b]66;s=2; \x1b\\']) {
    const paint = begin + '\x1b[1;1HX' + end;
    assert.equal(compositionSourceFrame(probe + paint).reason, 'UNKNOWN_PAINT_POSITION');
    assert.equal(compositionSourceFrame(probe + '\x1b[?1049h' + paint).supported, true);
    assert.equal(compositionSourceFrame(probe + '\x1b[2J' + paint).supported, true);
    assert.equal(compositionSourceFrame(probe + begin + end).reason, 'UNRESYNCHRONIZED_PAINT');
    for (const prefix of [begin, paint, '\x1b[?1049h'])
      assert.equal(compositionSourceFrame(prefix + probe + paint).reason, 'UNSAFE_PROBE_PHASE');
  }
});

test('cursor register preserves unknown coordinates and repeated saves, not a default home or stack', () => {
  const paint = (body) => begin + body + end;
  assert.equal(
    compositionSourceFrame('\x1b[s\x1b[H\x1b[u' + paint('X')).reason,
    'UNKNOWN_PAINT_POSITION',
  );
  assert.equal(compositionSourceFrame('\x1b[u' + paint('\x1b[HX')).reason, 'UNMATCHED_RESTORE');
  const decoded = compositionSourceFrame('\x1b[2;3H\x1b[s\x1b[H\x1b[u\x1b[s' + paint('X'));
  assert.equal(decoded.supported, true);
  assert.equal(decoded.text.split('\n')[1], '  X');
  assert.deepEqual(decoded.cursor, { row: 1, col: 3 });
  assert.equal(
    compositionSourceFrame('\x1b[s\x1b[?1049h\x1b[u' + paint('X')).reason,
    'UNMATCHED_RESTORE',
  );
  assert.equal(
    compositionSourceFrame('\x1b[?1049h' + paint('X') + '\x1b[?1049l').reason,
    'NO_CURRENT_FRAME',
  );
  assert.equal(compositionSourceFrame('\x1b[?1049h\x1b[?1049h').reason, 'UNSAFE_GENERATION');
});

test('finite control operands keep cursor/input metadata distinct from palette/cell paint', () => {
  const paint = begin + '\x1b[1;1HX' + end;
  for (const t of [
    '\x1b[?25h',
    '\x1b[?25l',
    '\x1b[0 q',
    '\x1b[6 q',
    '\x1b]12;#abcdef\x07',
    '\x1b]112\x07',
    '\x1b]22;default\x1b\\',
    '\x1b]22;\x1b\\',
    '\x1b]0;title\x07',
  ]) {
    const value = compositionSourceFrame(begin + t + '\x1b[1;1HX' + end);
    assert.equal(value.supported, true);
    assert.equal(value.text, 'X');
  }
  for (const t of [
    '\x1b[?2031h',
    '\x1b[?2004h',
    '\x1b[>4;1m',
    '\x1b[>4;0m',
    '\x1b[>5u',
    '\x1b[<u',
    ...[1000, 1002, 1003, 1006].flatMap((n) => [`\x1b[?${n}h`, `\x1b[?${n}l`]),
  ]) {
    assert.equal(compositionSourceFrame(t + paint).supported, true);
    assert.equal(compositionSourceFrame(begin + t + end).reason, 'UNSAFE_INPUT_PHASE');
  }
  assert.equal(compositionSourceFrame('\x1b[?2027h' + paint).supported, true);
  assert.equal(compositionSourceFrame(paint + '\x1b[?2027h').reason, 'UNSAFE_UNICODE_PHASE');
  for (const t of ['\x1b]4;0;?;255;?\x07', '\x1b]4;216;?\x07'])
    assert.equal(compositionSourceFrame(paint + t).supported, true);
  for (const t of [
    '\x1b]4;256;?\x07',
    '\x1b]4;1;rgb:ff/ff/ff\x07',
    '\x1b]11;#000000\x07',
    '\x1b[?9999h',
    '\x1b[7 q',
    '\x1b[38;5;256m',
    '\x1b[38;5m',
    '\x1b[3m',
    '\x1b[38;2;1;2m',
    '\x1b[0;;1m',
    '\x1b[>6u',
    '\x1b[?2027l',
    '\x1b[0;1H',
    '\x1b[41;1H',
    '\x1b[1;121H',
  ])
    assert.equal(compositionSourceFrame(t + paint).supported, false);
});

test('source frames require completed balanced updates and reject all truncated query frames', () => {
  for (const [raw, reason] of [
    [end, 'UNMATCHED_UPDATE'],
    [begin + begin, 'NESTED_UPDATE'],
    [begin + '\x1b[HX', 'INCOMPLETE_UPDATE'],
    [begin + '\x1b[HX' + end + begin, 'INCOMPLETE_UPDATE'],
    ['\x1b[HX', 'UNSYNCHRONIZED_PAINT'],
  ])
    assert.equal(compositionSourceFrame(raw).reason, reason);
  const query = '\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\';
  for (let n = 1; n < query.length; n++)
    assert.equal(compositionSourceFrame(query.slice(0, n)).supported, false);
  assert.equal(compositionSourceFrame(begin + '\x1b[1;120HXY' + end).reason, 'GEOMETRY');
});

test('closed source refusal preserves byte offsets without returning opaque payload or raw exception', () => {
  const prefix = begin + '\x1b[1;1H\u25cf' + end;
  const payload = '\x1b]7501;private-not-a-query\x1b\\';
  const refusal = compositionSourceFrame(prefix + payload);
  assert.deepEqual(refusal, {
    supported: false,
    reason: 'UNSUPPORTED_OSC_PAYLOAD',
    byteOffset: Buffer.byteLength(prefix),
    operation: 7501,
  });
  assert.doesNotMatch(JSON.stringify(refusal), /private|\u25cf/);
  assert.equal(compositionSourceFrame(null).reason, 'CAPTURE_LIMIT');
  assert.equal(compositionSourceFrame(' '.repeat(1048577)).reason, 'CAPTURE_LIMIT');
});

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
  rendererSize(total, 25165824, true);
  assert.deepEqual(total, { stage: 'TOTAL_SIZE', reason: 'NONE' });
  assert.throws(() => rendererSize(total, 25165825, true));
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
  for (const size of [12319424, 12319425]) {
    const io = collectionIO(size),
      state = {};
    const action = rendererReadFile(state, 'synthetic', 'evidence', retained.length, io);
    if (size === 12319424) assert.equal((await action).length, size);
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
  for (const used of [-1, NaN, Number.MAX_SAFE_INTEGER + 1, 25165825]) {
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
