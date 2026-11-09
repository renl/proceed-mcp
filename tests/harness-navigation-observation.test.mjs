// TEST ONLY. Scripted frames prove observer refusal, not actual host rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { identityPreview } from '../src/harness/session-identity.js';
import {
  assertIdentityMessage,
  highlightedOrdinal,
  assertCurrentIdentityFrame,
  confirmRenderedNavigation,
  productPickerObservation,
  productPickerInterval,
  captureProductPicker,
  productPickerDismissal,
  issueProductPickerExit,
  assertProductPickerDeadline,
  readProductPickerClock,
  createProductNavigationObserver,
} from './support/harness-navigation-observation.mjs';
import {
  compositionCurrentFrame,
  compositionSourceFrame,
  createCompositionSessionReader,
  observeCompositionSelectors,
} from './support/harness-composition-readiness.mjs';

// Synthetic RGB operands, NOT evidence of the pinned host's actual theme.
const profile = {
  renderer: 'normal',
  selected: { fg: '10,20,30', bg: '40,50,60', bold: true },
  normal: { fg: '70,80,90', bg: '1,2,3', bold: false },
};
const sgr = (s) =>
  `\x1b[0;38;2;${s.fg.replaceAll(',', ';')};48;2;${s.bg.replaceAll(',', ';')}${s.bold ? ';1' : ''}m`;
const ansiPicker = (selected = 2) =>
  '\x1b[?2026h\x1b[2J\x1b[H' +
  'Select the Proceed session\r\n' +
  [1, 2]
    .map(
      (n) =>
        sgr(profile[n === selected ? 'selected' : 'normal']) + `    Session ${n} equal preview`,
    )
    .join('\r\n') +
  '\x1b[0m\x1b[?2026l';
const styledPicker = (n = 2) => compositionCurrentFrame(ansiPicker(n), { styled: true });

const session = {
  ordinal: 'Session 2',
  title: 'EqualLongTitle'.repeat(5),
  id: 'ses_' + 'a'.repeat(60),
};
const wrap = (s) => s.match(/.{1,40}/g).join('\n');
const message = (s = session) =>
  [
    s.ordinal,
    'Navigation only - no decision',
    'Title:',
    wrap(s.title),
    '',
    'Exact session ID:',
    wrap(s.id),
  ].join('\n');
const geometry = { width: 100, height: 50, resizeSequence: 0 };
const frame = (s = session) =>
  ['Open Proceed question?', message(s), '', 'Open question   Cancel'].join('\n');
const picker = styledPicker().text;

// Indexed operands from the admitted fixture, not a product theme/profile.
const fixtureStyles = {
  selected: { fg: 'index:232', bg: 'index:216', bold: true },
  inactive: {
    current: { fg: 'index:216', bg: 'index:233', bold: false },
    ordinary: { fg: 'index:255', bg: 'index:233', bold: false },
  },
};
const indexSgr = (s) => `\x1b[0;38;5;${s.fg.slice(6)};48;5;${s.bg.slice(6)}${s.bold ? ';1' : ''}m`;
function fixtureCase({
  selected = 0,
  current = 0,
  labels = ['Session 1', 'Session 2'],
  styles = fixtureStyles,
} = {}) {
  const raw =
    '\x1b[?1049h\x1b[?2026h\x1b[HSelect the Proceed session' +
    labels
      .map(
        (label, n) =>
          `\x1b[${n + 3};3H` +
          (n === current ? '\u25cf ' : '  ') +
          indexSgr(
            n === selected
              ? styles.selected
              : styles.inactive[n === current ? 'current' : 'ordinary'],
          ) +
          label,
      )
      .join('') +
    '\x1b[?2026l';
  return boundFixture(raw, labels, styles);
}
function boundFixture(raw, labels, styles = fixtureStyles) {
  const binding = {
    host: 'synthetic-host-not-qualified',
    theme: 'synthetic-indexed-not-qualified',
    geometry: { rows: 40, columns: 120 },
    generation: 1,
    transcriptHash: createHash('sha256').update(raw).digest('hex'),
    bytes: Buffer.byteLength(raw),
    frames: 1,
  };
  return {
    raw,
    labels,
    binding,
    profile: {
      renderer: 'normal',
      scope: 'fixture-only',
      ...structuredClone(styles),
      binding: structuredClone(binding),
    },
  };
}
const fixtureSelection = (c) =>
  highlightedOrdinal(c.raw, c.profile, {
    offlineFixture: { labels: c.labels, binding: c.binding },
  });

const productBinding = {
  scope: 'product-capture',
  run: 'synthetic-run',
  setup: 'synthetic-setup',
  executable: 'synthetic-binary-hash',
  config: 'synthetic-config-hash',
  geometry: { width: 120, height: 40, resizeSequence: 0 },
  designMode: null,
  resolvedTheme: null,
  effectiveColorDepth: null,
};
const productSnapshot = [1, 2].map((n) => ({
  id: `synthetic-id-${n}`,
  ordinal: `Session ${n}`,
  title: 'duplicate preview',
}));
const productUpdate = (selected, reset = false) =>
  '\x1b[?2026h' +
  (reset ? '\x1b[2J' : '') +
  '\x1b[HSelect the Proceed session' +
  [1, 2]
    .map(
      (n) =>
        `\x1b[${n + 2};3H` +
        indexSgr(n === selected ? fixtureStyles.selected : fixtureStyles.inactive.ordinary) +
        `Session ${n} - duplicate preview`,
    )
    .join('') +
  '\x1b[?2026l';
const productRaw = () => Buffer.from('\x1b[?1049h' + productUpdate(1));
function productPair() {
  const raw = productRaw();
  const initial = productPickerObservation(raw, productBinding, productSnapshot);
  const moved = productPickerObservation(
    Buffer.concat([raw, Buffer.from(productUpdate(2))]),
    productBinding,
    productSnapshot,
    initial,
  );
  return { initial, moved };
}

// Fresh synthetic admission per case. These hashes bind memory operands only.
// They never install a live profile or relabel the historical 76490a71 capture.
function navigationCase({
  selected = fixtureStyles.selected,
  inactive = fixtureStyles.inactive.ordinary,
  factory = createProductNavigationObserver,
} = {}) {
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const binding = {
    ...structuredClone(productBinding),
    executable: hash('synthetic executable'),
    configBytes: '{}',
    config: hash('{}'),
    package: hash('synthetic package'),
    wrapper: hash('synthetic wrapper'),
    source: '9bbb8ce18c80f099e0e448775f59d965ead40a21',
    rendererSource: '738067f47e940dcec3f5aab74868908574335c6c',
    sourceBinding: 'PINNED_IMAGE_PROVENANCE_NOT_RUNTIME_ACCESSOR',
    runtime: { version: '2.2.5', bun: '1.4.4', node: '24.22.2' },
    environment: { TERM: 'explicit-synthetic' },
    terminalResponsePolicy: [{ query: 'synthetic', flags: 'g', reply: 'fixed' }],
  };
  binding.inputs = [
    'package.json',
    'src/harness/tui-entry.js',
    'bin/proceed-mcp.js',
    'tests/fixtures/harness-composition/tui.ts',
  ].map((path) => ({
    path,
    sha256:
      path === 'package.json'
        ? binding.package
        : path.endsWith('tui.ts')
          ? binding.wrapper
          : hash(path),
  }));
  binding.payload = binding.inputs.map((s) => s.path);
  const color = (v, foreground) =>
    v === null
      ? foreground
        ? '39'
        : '49'
      : v.startsWith('index:')
        ? `${foreground ? '38' : '48'};5;${v.slice(6)}`
        : `${foreground ? '38' : '48'};2;${v.replaceAll(',', ';')}`;
  const style = (s) => `\x1b[0;${color(s.fg, true)};${color(s.bg, false)}${s.bold ? ';1' : ''}m`;
  const paint = (n) =>
    '\x1b[?2026h\x1b[HSelect the Proceed session' +
    [1, 2]
      .map(
        (r) =>
          `\x1b[${r + 2};3H` +
          style(r === n ? selected : inactive) +
          `Session ${r} - duplicate preview`,
      )
      .join('') +
    '\x1b[?2026l';
  const state = {
    raw: Buffer.from('\x1b[?1049h' + paint(1)),
    binding,
    snapshot: structuredClone(productSnapshot),
    live: {
      live: true,
      run: binding.run,
      generation: binding.setup,
      geometry: structuredClone(binding.geometry),
      snapshot: structuredClone(productSnapshot),
    },
  };
  let tick = 1;
  const writes = [];
  let observer;
  const io = {
    binding,
    snapshot: productSnapshot,
    sample: () => state,
    now: () => tick,
    deadline: 10,
    moveDown: () => {
      writes.push('Down');
    },
    enter: () => writes.push('Enter'),
  };
  return {
    state,
    writes,
    io,
    paint,
    setTick: (v) => {
      tick = v;
    },
    create: () => (observer = factory(io)),
    ready: () => {
      observer ??= factory(io);
      observer.initial();
      observer.moveDown();
      state.raw = Buffer.concat([state.raw, Buffer.from(paint(2))]);
      observer.moved();
      return observer;
    },
    identity: () => {
      state.raw = Buffer.concat([
        state.raw,
        Buffer.from(
          '\x1b[?2026h' +
            [1, 2, 3, 4, 5].map((r) => `\x1b[${r};1H` + ' '.repeat(120)).join('') +
            frame({ ...productSnapshot[1] })
              .split('\n')
              .map((line, n) => `\x1b[${n + 1};1H${line}`)
              .join('') +
            '\x1b[?2026l',
        ),
      ]);
      assertCurrentIdentityFrame(
        compositionSourceFrame(state.raw.toString()).text,
        productSnapshot[1],
        binding.geometry,
      );
    },
  };
}

test('fresh interval permits only expected ordinal then separate full identity, via injected recorder', () => {
  for (const styles of [
    undefined,
    { selected: profile.selected, inactive: profile.normal },
    {
      selected: { fg: null, bg: 'index:216', bold: true },
      inactive: { fg: '0,0,0', bg: null, bold: false },
    },
    {
      selected: { fg: 'index:0', bg: '0,0,0', bold: true },
      inactive: { fg: null, bg: 'index:0', bold: false },
    },
  ]) {
    const c = navigationCase(styles);
    const observer = c.ready();
    observer.pickerEnter(productSnapshot[1]);
    c.identity();
    observer.identity();
    observer.openQuestion();
    assert.deepEqual(c.writes, ['Down', 'Enter', 'Enter']);
    assert.throws(() => observer.openQuestion(), /navigation admission refused/);
    assert.equal(c.writes.length, 3);
  }
});

test('all fixed-input/live/snapshot invalidations before picker admission write zero Enters', () => {
  const changes = [
    ...[
      'executable',
      'package',
      'config',
      'wrapper',
      'source',
      'rendererSource',
      'sourceBinding',
      'configBytes',
      'run',
      'setup',
      'resolvedTheme',
      'designMode',
      'effectiveColorDepth',
    ].map((k) => (s) => {
      s.binding[k] = 'substituted';
    }),
    (s) => {
      s.binding.environment.TERM = 'changed';
    },
    (s) => {
      s.binding.runtime.node = 'foreign';
    },
    (s) => {
      s.binding.inputs[0].sha256 = 'a'.repeat(64);
    },
    (s) => {
      s.binding.payload.reverse();
    },
    (s) => {
      s.binding.terminalResponsePolicy[0].reply = 'changed';
    },
    ...['run', 'generation'].map((k) => (s) => {
      s.live[k] = 'foreign';
    }),
    (s) => {
      s.live.live = false;
    },
    (s) => {
      s.live.geometry.resizeSequence++;
    },
    (s) => {
      s.live.geometry.width--;
    },
    (s) => {
      s.live.geometry.height--;
    },
    (s) => {
      s.snapshot.reverse();
    },
    (s) => {
      s.snapshot[0].id = 'foreign';
    },
    (s) => {
      s.snapshot[0].title = 'changed';
    },
    (s) => {
      s.live.snapshot[1].ordinal = 'Session 1';
    },
    (s) => {
      s.raw = s.raw.subarray(1);
    },
    (s) => {
      s.raw = Buffer.from(s.raw.toString().replace('Session 2', 'Session 3'));
    },
    ...[
      '\x1b[?2026h',
      '\x1b[3m',
      '\x1b[2J',
      '\x1b[?1049l',
      '\x1b[?2026h\x1b[1;1Hother\x1b[?2026l',
    ].map((v) => (s) => {
      s.raw = Buffer.concat([s.raw, Buffer.from(v)]);
    }),
  ];
  for (const change of changes) {
    const c = navigationCase(),
      observer = c.ready();
    change(c.state);
    assert.throws(() => observer.pickerEnter(productSnapshot[1]), /navigation admission refused/);
    assert.deepEqual(c.writes, ['Down']);
  }
  for (const gap of [
    'observation gap',
    'theme changed without repaint',
    'capability changed',
    'replacement',
  ]) {
    const c = navigationCase(),
      observer = c.ready();
    observer.invalidate(gap);
    assert.throws(() => observer.pickerEnter(productSnapshot[1]));
    assert.deepEqual(c.writes, ['Down']);
  }
});

test('causal transfer, homogeneous complete labels and unique style roles are mandatory', () => {
  for (const alter of [
    (c) => c.paint(1), // no physical effect
    (c) => c.paint(2).replace('Session 2 -', 'Session 1 -'),
    (c) => c.paint(2).replace('Session 2 -', 'Session 3 -'),
    (c) => c.paint(2).replace('duplicate preview', 'incomplete'),
    (c) => c.paint(2).replace('Session 2', 'Ses\x1b[0msion 2'),
    (c) => c.paint(2).replace(';1m', 'm'),
    (c) => c.paint(2).replace('Session 1 -', '\u25cf Session 1 -'),
    (c) => c.paint(2) + c.paint(1) + c.paint(2),
    (c) => c.paint(2).replace('\x1b[H', '\x1b[2J\x1b[H'),
  ]) {
    const c = navigationCase(),
      observer = c.create();
    observer.initial();
    observer.moveDown();
    c.state.raw = Buffer.concat([c.state.raw, Buffer.from(alter(c))]);
    assert.throws(() => observer.moved());
    assert.throws(() => observer.pickerEnter(productSnapshot[1]));
    assert.deepEqual(c.writes, ['Down']);
  }
  const c = navigationCase({ selected: { ...fixtureStyles.selected, bg: 'index:233' } });
  assert.throws(() => c.ready());
  assert.equal(c.writes.includes('Enter'), false);
  const noMove = navigationCase(),
    observer = noMove.create();
  observer.initial();
  noMove.state.raw = Buffer.concat([noMove.state.raw, Buffer.from(noMove.paint(2))]);
  assert.throws(() => observer.moved()); // raw role exchange alone is not causality.
  assert.equal(noMove.writes.length, 0);
});

test('fresh identity admission refuses stale, foreign, resized, incomplete or replaced confirmation', () => {
  for (const mutate of [
    (c) => {
      c.state.raw = c.state.raw.subarray(0, -8);
    },
    (c) => {
      c.state.raw = Buffer.from(c.state.raw.toString().replace('Exact session ID:', 'ID omitted:'));
    },
    (c) => {
      c.state.raw = Buffer.from(c.state.raw.toString().replace(productSnapshot[1].id, 'foreign'));
    },
    (c) => {
      c.state.live.live = false;
    },
    (c) => {
      c.state.live.generation = 'replacement';
    },
    (c) => {
      c.state.live.geometry.resizeSequence++;
    },
    (c) => {
      c.state.binding.environment.TERM = 'changed';
    },
    (c) => {
      c.state.snapshot[1].title = 'changed';
    },
    (c) => {
      c.state.raw = Buffer.concat([c.state.raw, Buffer.from(c.paint(1))]);
    },
  ]) {
    const c = navigationCase(),
      observer = c.ready();
    observer.pickerEnter(productSnapshot[1]);
    c.identity();
    observer.identity();
    mutate(c);
    assert.throws(() => observer.openQuestion());
    assert.deepEqual(c.writes, ['Down', 'Enter']);
  }
  const c = navigationCase(),
    observer = c.ready();
  assert.throws(() => observer.openQuestion());
  assert.deepEqual(c.writes, ['Down']);
});

test('unsafe clocks and elapsed synchronous final validation fence each input, no renewed budget', () => {
  for (const second of [false, true])
    for (const bad of [10, 11, Infinity, -Infinity, NaN, '2', null, undefined, {}, 0]) {
      const c = navigationCase(),
        observer = c.ready();
      if (second) {
        observer.pickerEnter(productSnapshot[1]);
        c.identity();
        observer.identity();
      }
      // The observer captured this function, whose result getter advances time
      // during the actual final sample, not before the entry clock.
      const saved = c.state.raw;
      Object.defineProperty(c.state, 'raw', {
        get() {
          c.setTick(bad);
          return saved;
        },
      });
      assert.throws(() =>
        second ? observer.openQuestion() : observer.pickerEnter(productSnapshot[1]),
      );
      assert.equal(c.writes.filter((k) => k === 'Enter').length, second ? 1 : 0);
    }
  for (const key of ['now', 'deadline'])
    for (const value of [Infinity, -Infinity, NaN, '4', {}, null, undefined]) {
      const c = navigationCase();
      c.io[key] = key === 'now' ? () => value : value;
      const observer = c.create();
      assert.throws(() => observer.initial(), /navigation admission refused/);
      assert.deepEqual(c.writes, []);
    }
});

test('missing/throwing clocks refuse without detail, finite fractional clocks preserve the original budget', () => {
  for (const now of [
    undefined,
    null,
    1,
    () => {
      throw Error('synthetic-private-detail');
    },
  ]) {
    const c = navigationCase();
    c.io.now = now;
    assert.throws(
      () => c.create().initial(),
      (error) => error.message === 'navigation admission refused',
    );
    assert.deepEqual(c.writes, []);
  }
  const fractional = navigationCase();
  fractional.io.now = () => 1.25;
  fractional.io.deadline = 1.5;
  fractional.ready().pickerEnter(productSnapshot[1]);
  assert.deepEqual(fractional.writes, ['Down', 'Enter']);
});

test('forged/historical/fixture observations cannot grant authority or cross an interaction', () => {
  for (const key of [
    'executable',
    'package',
    'wrapper',
    'config',
    'configBytes',
    'source',
    'rendererSource',
    'sourceBinding',
    'runtime',
    'environment',
    'terminalResponsePolicy',
    'payload',
    'inputs',
    'run',
    'setup',
    'geometry',
  ]) {
    const missing = navigationCase();
    delete missing.state.binding[key];
    assert.throws(() => missing.ready());
    assert.deepEqual(missing.writes, []);
  }
  const c = navigationCase(),
    observer = c.create();
  const historical = productPair();
  assert.throws(() => observer.pickerEnter(historical.moved));
  assert.deepEqual(c.writes, []);
  for (const scope of ['fixture-only', 'historical', undefined]) {
    const fresh = navigationCase();
    fresh.state.binding.scope = scope;
    assert.throws(() => fresh.ready());
    assert.equal(fresh.writes.includes('Enter'), false);
  }
  const a = navigationCase();
  a.ready();
  const b = navigationCase();
  const second = b.create();
  assert.throws(() => second.pickerEnter(productSnapshot[1]));
  assert.deepEqual(b.writes, []);
  const wrong = navigationCase();
  assert.throws(() => wrong.ready().pickerEnter(productSnapshot[0]));
  assert.deepEqual(wrong.writes, ['Down']);
});

async function compositionObserverAdapter() {
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export function compositionNavigationObserver(');
  const finish = source.indexOf('\nconst evidence =', start);
  return runInNewContext(
    '(' + source.slice(start + 'export '.length, finish).trim() + ')',
    { createProductNavigationObserver, structuredClone },
    { timeout: 100 },
  );
}

async function compositionSelectionAdapter() {
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export function compositionNavigationSelection(');
  const finish = source.indexOf('// Pure private wiring seam.', start);
  return runInNewContext(
    '(' + source.slice(start + 'export '.length, finish).trim() + ')',
    {
      assert,
      structuredClone,
      compositionNavigationObserver: await compositionObserverAdapter(),
    },
    { timeout: 100 },
  );
}

async function publicBridgeCase() {
  const c = navigationCase();
  const files = new Map();
  const records = [{ id: 'synthetic-id-1', title: 'Composition empty exchange' }];
  const hooks = {};
  let tick,
    reads = 0,
    requests = 0;
  const file = (path) => path.split('/').at(-1);
  const save = (path, value) => files.set(file(path), JSON.parse(value));
  files.set('composition-binding.json', { run: c.io.binding.run, captureOnly: false });
  const context = {
    renderer: { ...c.io.binding.geometry, on() {}, off() {} },
    app: { version: 'static-wrapper-control' },
    data: {
      session: {
        list: () => {
          reads++;
          hooks.list?.();
          return records;
        },
        get: (id) => {
          reads++;
          hooks.get?.();
          return records.find((r) => r.id === id);
        },
        sync: async () => {},
      },
    },
    client: {
      session: {
        create: async ({ title }) => {
          const record = { id: 'synthetic-id-2', title };
          records.push(record);
          return record;
        },
      },
    },
  };
  context.renderer.width = c.io.binding.geometry.width;
  context.renderer.height = c.io.binding.geometry.height;
  const wrapperSource = await readFile(
    new URL('fixtures/harness-composition/tui.ts', import.meta.url),
    'utf8',
  );
  const wrapper = runInNewContext(
    wrapperSource.slice(wrapperSource.indexOf('export default')).replace('export default', ''),
    {
      Plugin: { define: (p) => p },
      product: { id: 'static-product', setup: async () => async () => {} },
      performance,
      process: { versions: { bun: 'static', node: 'static' } },
      randomUUID: () => c.io.binding.setup,
      structuredClone,
      readFileSync: (path) => JSON.stringify(files.get(file(path))),
      writeFileSync: save,
      writeFile: async (path, value) => save(path, value),
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval() {},
      createCompositionSessionReader,
      observeCompositionSelectors,
    },
    { timeout: 100 },
  );
  const dispose = await wrapper.setup(context);
  // Paint operands are synthetic, not a selected-state setter or live proof.
  const paint = (n) =>
    c.paint(n).replaceAll('duplicate preview', identityPreview(records[0].title));
  c.state.raw = Buffer.from('\x1b[?1049h' + paint(1));
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export async function compositionPublicNavigationBridge(');
  const finish = source.indexOf('// STATIC ONLY. Public readers', start);
  const create = runInNewContext(
    '(' + source.slice(start + 7, finish).trim() + ')',
    {
      assert,
      Buffer,
      structuredClone,
      digest: (raw) => createHash('sha256').update(raw).digest('hex'),
      readProductPickerClock,
      assertProductPickerDeadline,
      compositionNavigationSelection: await compositionSelectionAdapter(),
    },
    { timeout: 100 },
  );
  const ioStart = source.indexOf('const navigationBridgeIO = {');
  const ioFinish = source.indexOf('\n        let request,', ioStart);
  const host = { exited: false, closed: false, overflow: false };
  const actualIO = runInNewContext(
    source.slice(ioStart, ioFinish) + '\nnavigationBridgeIO;',
    {
      assert,
      Buffer,
      evidence: '/memory',
      join: (...parts) => parts.join('/'),
      readObservation: (name) => {
        hooks.read?.(name);
        return structuredClone(files.get(name) ?? null);
      },
      writeFileSync: (path, value) => {
        requests++;
        save(path, value);
        hooks.request?.(JSON.parse(value));
      },
      get transcript() {
        hooks.raw?.();
        return c.state.raw;
      },
      get exited() {
        return host.exited;
      },
      get closed() {
        return host.closed;
      },
      get overflow() {
        return host.overflow;
      },
    },
    { timeout: 100 },
  );
  const io = {
    ...actualIO,
    executionBinding: c.io.binding,
    runtime: c.io.binding.runtime,
    run: c.io.binding.run,
    setup: c.io.binding.setup,
    readExecutionBinding: () => {
      hooks.fixed?.();
      return structuredClone(c.state.binding);
    },
    now: c.io.now,
    deadline: c.io.deadline,
    pause: async () => {
      c.setTick(c.io.now() + 0.1);
      tick(); // Execute the actual wrapper's public request/response route.
      hooks.response?.(files.get('composition-selector-response.json'));
    },
    moveDown: () => {
      c.writes.push('Down');
      c.state.raw = Buffer.concat([c.state.raw, Buffer.from(paint(2))]);
    },
    pickerEnter: () => {
      c.writes.push('first Enter');
      const identity = frame({ ordinal: 'Session 2', ...records[1] });
      c.state.raw = Buffer.concat([
        c.state.raw,
        Buffer.from(
          '\x1b[?2026h' +
            [1, 2, 3, 4, 5].map((r) => `\x1b[${r};1H` + ' '.repeat(120)).join('') +
            identity
              .split('\n')
              .map((line, n) => `\x1b[${n + 1};1H${line}`)
              .join('') +
            '\x1b[?2026l',
        ),
      ]);
    },
  };
  return {
    c,
    io,
    hooks,
    files,
    records,
    context,
    host,
    dispose,
    counts: () => ({ reads, requests }),
    create: () => create(io),
    ready: async () => {
      const bridge = await create(io);
      await bridge.initial();
      await bridge.moveDown();
      await bridge.moved();
      return bridge;
    },
  };
}

test('prepared bridge executes actual wrapper ordered and exact public reads, first Enter only, then closes second Enter', async () => {
  const c = await publicBridgeCase();
  c.hooks.request = () => {
    const request = c.files.get('composition-selector-request.json');
    request.snapshot = [{ id: 'driver-fed answer', title: 'not public data' }];
    request.exact = { id: 'driver-fed answer', title: 'not public data' };
  };
  const bridge = await c.ready();
  const before = c.counts();
  await bridge.pickerEnter();
  assert.ok(c.counts().reads >= before.reads + 2);
  assert.equal(c.counts().requests, before.requests + 1);
  const identity = await bridge.identity();
  assert.equal(c.files.get('composition-selector-response.json').exact.id, c.records[1].id);
  assert.ok(identity.text.includes(c.records[1].id));
  assert.ok(identity.text.includes(c.records[1].title));
  assert.deepEqual(c.c.writes, ['Down', 'first Enter']);
  assert.throws(() => bridge.openQuestion(), /navigation admission refused/);
  const closed = c.counts();
  await assert.rejects(bridge.pickerEnter(), /navigation admission refused/);
  assert.deepEqual(c.counts(), closed);
  assert.deepEqual(c.c.writes, ['Down', 'first Enter']);
  await c.dispose();
});

test('public bridge refuses divergent, stale, forged and invalidated observations irreversibly without Enter', async () => {
  for (const failure of [
    'list-order',
    'get-id',
    'get-title',
    'get-missing',
    'get-error',
    'list-error',
    'stale',
    'stale-previous',
    'out-of-order',
    'forged-run',
    'forged-setup',
    'forged-prefix',
    'forged-id',
    'forged-bytes',
    'forged-live',
    'forged-geometry',
    'missing-generation',
    'dispose',
    'replace',
    'resize',
    'gap',
    'cancel',
    'reader-invalidation',
    'in-reader-dispose',
    'prefix',
    'deadline',
    'fixed',
    'read-error',
    'raw-error',
    'host-exit',
    'stream-close',
    'overflow',
    'final-fence-invalidation',
    'final-fence-prefix-change',
  ]) {
    const c = await publicBridgeCase();
    const bridge = await c.ready();
    const previous = structuredClone(c.files.get('composition-selector-response.json'));
    if (failure === 'list-order') c.records.reverse();
    if (failure === 'get-id')
      c.hooks.get = () => {
        c.records[1].id = 'foreign-id';
      };
    if (failure === 'get-title')
      c.hooks.get = () => {
        c.records[1].title = 'changed';
      };
    if (failure === 'get-missing')
      c.hooks.get = () => {
        c.records.splice(1);
      };
    if (failure === 'get-error')
      c.hooks.get = () => {
        throw Error('private');
      };
    if (failure === 'list-error')
      c.hooks.list = () => {
        throw Error('private');
      };
    if (failure === 'stale')
      c.hooks.response = () => {
        c.files.set('composition-selector-response.json', null);
      };
    if (failure === 'stale-previous')
      c.hooks.response = () => {
        c.files.set('composition-selector-response.json', previous);
      };
    const forgery = {
      'out-of-order': ['request', 999],
      'forged-run': ['run', 'other'],
      'forged-setup': ['generation', 'other'],
      'forged-prefix': ['sha256', 'f'.repeat(64)],
      'forged-id': ['id', 'foreign-id'],
      'forged-bytes': ['bytes', 1],
      'forged-live': ['live', false],
      'forged-geometry': ['geometry', { width: 120, height: 40, resizeSequence: 1 }],
    }[failure];
    if (forgery)
      c.hooks.response = (response) => {
        response[forgery[0]] = forgery[1];
      };
    if (failure === 'missing-generation') delete c.files.get('composition-live.json').generation;
    if (failure === 'dispose') await c.dispose();
    if (failure === 'replace') c.files.get('composition-live.json').generation = 'replacement';
    if (failure === 'resize') c.files.get('composition-live.json').geometry.resizeSequence++;
    if (['gap', 'cancel'].includes(failure)) bridge.invalidate();
    if (failure === 'reader-invalidation') c.hooks.get = () => bridge.invalidate();
    if (failure === 'in-reader-dispose')
      c.hooks.get = () => {
        void c.dispose();
      };
    if (failure === 'prefix')
      c.hooks.response = () => {
        c.c.state.raw = c.c.state.raw.subarray(1);
      };
    if (failure === 'deadline') c.hooks.response = () => c.c.setTick(10);
    if (failure === 'fixed')
      c.hooks.response = () => {
        c.c.state.binding.config = 'changed';
      };
    if (failure === 'read-error')
      c.hooks.read = () => {
        throw Error('private');
      };
    if (failure === 'raw-error')
      c.hooks.raw = () => {
        throw Error('private');
      };
    if (failure === 'host-exit') c.host.exited = true;
    if (failure === 'stream-close') c.host.closed = true;
    if (failure === 'overflow') c.host.overflow = true;
    if (['final-fence-invalidation', 'final-fence-prefix-change'].includes(failure)) {
      // current() rereads fixed inputs in the final observer clock before input.
      // Trigger only once refresh has completed and the actual seam is sampling.
      let reads = 0;
      c.hooks.fixed = () => {
        if (++reads === 7) {
          if (failure === 'final-fence-invalidation') bridge.invalidate();
          else c.c.state.raw = c.c.state.raw.subarray(1);
        }
      };
    }
    await assert.rejects(bridge.pickerEnter(), /navigation admission refused/, failure);
    const counts = c.counts();
    for (const key of Object.keys(c.hooks)) delete c.hooks[key];
    c.c.setTick(1);
    await assert.rejects(bridge.pickerEnter(), /navigation admission refused/, failure);
    assert.deepEqual(c.counts(), counts, failure);
    assert.deepEqual(c.c.writes, ['Down'], failure);
    await c.dispose();
  }
});

test('bridge identity reads remain fresh after first Enter, and runtime has no bridge dispatch or second-input authority', async () => {
  for (const failure of ['title', 'id', 'resize', 'gap', 'dispose']) {
    const c = await publicBridgeCase();
    const bridge = await c.ready();
    await bridge.pickerEnter();
    if (failure === 'title') c.records[1].title = 'changed after selection';
    if (failure === 'id') c.records[1].id = 'replaced after selection';
    if (failure === 'resize') c.files.get('composition-live.json').geometry.resizeSequence++;
    if (failure === 'gap') bridge.invalidate();
    if (failure === 'dispose') await c.dispose();
    await assert.rejects(bridge.identity(), /navigation admission refused/, failure);
    assert.throws(() => bridge.openQuestion(), /navigation admission refused/);
    const closed = c.counts();
    await assert.rejects(bridge.identity(), /navigation admission refused/);
    assert.deepEqual(c.counts(), closed);
    assert.deepEqual(c.c.writes, ['Down', 'first Enter']);
    await c.dispose();
  }
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(source.match(/compositionPublicNavigationBridge\(/g).length, 1);
  assert.ok(
    source.includes("assert.fail('product navigation requires separate runtime/input authority')"),
  );
  const c = await publicBridgeCase();
  let second = 0;
  c.io.openQuestion = () => second++;
  const bridge = await c.ready();
  await bridge.pickerEnter();
  await bridge.identity();
  assert.throws(() => bridge.openQuestion(), /navigation admission refused/);
  assert.equal(second, 0);
  await c.dispose();
});

test('actual selection wiring separates provisional picker and exact identity inputs with fresh public reads', async () => {
  const select = await compositionSelectionAdapter();
  let reads = 0;
  const intended = structuredClone(productSnapshot[1]);
  const c = navigationCase({
    factory: (io) =>
      select({
        ...io,
        intendedSession: intended,
        executionBinding: io.binding,
        runtime: io.binding.runtime,
        run: io.binding.run,
        setup: io.binding.setup,
        readExecutionBinding: () => io.sample().binding,
        readLive: () => io.sample().live,
        readRaw: () => io.sample().raw,
        readSession: (id) => {
          reads++;
          assert.equal(id, productSnapshot[1].id);
          return structuredClone(productSnapshot[1]);
        },
        pickerEnter: () => c.writes.push('pickerEnter'),
        openQuestion: () => c.writes.push('openQuestion'),
      }),
  });
  const observer = c.ready();
  intended.id = 'caller mutation cannot retarget';
  let before = reads;
  observer.pickerEnter();
  assert.equal(reads, before + 1);
  assert.deepEqual(c.writes, ['Down', 'pickerEnter']);
  assert.throws(() => observer.openQuestion(), /navigation admission refused/);
  assert.deepEqual(c.writes, ['Down', 'pickerEnter']);

  // A new independent interaction is required after any out-of-order refusal.
  const d = navigationCase({
    factory: (io) =>
      select({
        ...io,
        intendedSession: productSnapshot[1],
        executionBinding: io.binding,
        runtime: io.binding.runtime,
        run: io.binding.run,
        setup: io.binding.setup,
        readExecutionBinding: () => io.sample().binding,
        readLive: () => io.sample().live,
        readRaw: () => io.sample().raw,
        readSession: () => {
          reads++;
          return structuredClone(productSnapshot[1]);
        },
        pickerEnter: () => d.writes.push('pickerEnter'),
        openQuestion: () => d.writes.push('openQuestion'),
      }),
  });
  const complete = d.ready();
  complete.pickerEnter();
  d.identity();
  complete.identity();
  before = reads;
  complete.openQuestion();
  assert.equal(reads, before + 1);
  assert.deepEqual(d.writes, ['Down', 'pickerEnter', 'openQuestion']);
  assert.throws(() => complete.openQuestion());
  assert.equal(d.writes.length, 3);
});

test('actual selection public-reader and lifetime failures permanently refuse at both inputs', async () => {
  const select = await compositionSelectionAdapter();
  for (const second of [false, true]) {
    for (const failure of [
      'missing',
      'id',
      'title',
      'throws',
      'cancel',
      'dispose',
      'replacement',
      'gap',
      'capability',
      'snapshot',
      'resize',
      'generation',
      'style',
      'prefix',
      'deadline',
      'unsafe-clock',
      'final-clock-invalidation',
      'unavailable-input',
      'fixed',
      'live-throws',
      'raw-throws',
    ]) {
      let armed = false,
        observer,
        reads = 0,
        clocks = 0;
      const c = navigationCase({
        factory: (io) =>
          select({
            ...io,
            intendedSession: productSnapshot[1],
            executionBinding: io.binding,
            runtime: io.binding.runtime,
            run: io.binding.run,
            setup: io.binding.setup,
            now: () => {
              if (armed && ++clocks === 2 && failure === 'final-clock-invalidation')
                observer.invalidate();
              return io.now();
            },
            readExecutionBinding: () => {
              if (armed && failure === 'fixed') throw Error('private');
              return io.sample().binding;
            },
            readLive: () => {
              if (armed && failure === 'live-throws') throw Error('private');
              return io.sample().live;
            },
            readRaw: () => {
              if (armed && failure === 'raw-throws') throw Error('private');
              return io.sample().raw;
            },
            readSession: () => {
              reads++;
              if (armed) {
                if (failure === 'missing') return undefined;
                if (failure === 'throws') throw Error('private');
                if (failure === 'id') return productSnapshot[0]; // equal title, different exact ID
                if (failure === 'title') return { ...productSnapshot[1], title: 'changed' };
                if (['cancel', 'dispose', 'replacement', 'gap', 'capability'].includes(failure))
                  observer.invalidate();
              }
              return structuredClone(productSnapshot[1]);
            },
            pickerEnter:
              failure === 'unavailable-input' && !second
                ? undefined
                : () => c.writes.push('pickerEnter'),
            openQuestion:
              failure === 'unavailable-input' && second
                ? undefined
                : () => c.writes.push('openQuestion'),
          }),
      });
      observer = c.ready();
      if (second) {
        observer.pickerEnter();
        c.identity();
        observer.identity();
      }
      armed = true;
      if (failure === 'snapshot') c.state.live.snapshot.reverse();
      if (failure === 'resize') c.state.live.geometry.resizeSequence++;
      if (failure === 'generation') c.state.live.generation = 'replacement';
      if (failure === 'style') c.state.raw = Buffer.concat([c.state.raw, Buffer.from(c.paint(1))]);
      if (failure === 'prefix') c.state.raw = c.state.raw.subarray(1);
      if (failure === 'deadline') c.setTick(10);
      if (failure === 'unsafe-clock') c.setTick(NaN);
      const input = () => (second ? observer.openQuestion() : observer.pickerEnter());
      assert.throws(input, /navigation admission refused/, `${second}/${failure}`);
      const sampled = reads;
      armed = false;
      c.setTick(1);
      assert.throws(input, /navigation admission refused/);
      assert.equal(reads, sampled);
      assert.deepEqual(c.writes, second ? ['Down', 'pickerEnter'] : ['Down']);
    }
  }
});

test('actual composition adapter drives current-cell observer with fresh independent bindings and snapshot', async () => {
  const adapter = await compositionObserverAdapter();
  const factory = (io) =>
    adapter({
      ...io,
      executionBinding: io.binding,
      runtime: io.binding.runtime,
      run: io.binding.run,
      setup: io.binding.setup,
      readExecutionBinding: () => io.sample().binding,
      readLive: () => io.sample().live,
      readRaw: () => io.sample().raw,
    });
  for (const bad of [false, true]) {
    const c = navigationCase({ factory });
    const observer = c.ready();
    if (bad) c.state.live.snapshot[1].title = 'independent snapshot changed';
    if (bad) {
      assert.throws(() => observer.pickerEnter(productSnapshot[1]));
      assert.deepEqual(c.writes, ['Down']);
    } else {
      observer.pickerEnter(productSnapshot[1]);
      c.identity();
      observer.identity();
      observer.openQuestion();
      assert.deepEqual(c.writes, ['Down', 'Enter', 'Enter']);
    }
  }
});

test('actual composition readers cannot revive invalidation during either final admission', async () => {
  const adapter = await compositionObserverAdapter();
  for (const second of [false, true]) {
    for (const boundary of ['live', 'raw', 'fixed', 'validation', 'final-clock']) {
      for (const reason of ['observed gap', 'setup replacement', 'observed capability change']) {
        let observer,
          armed = false,
          clocks = 0,
          samples = 0,
          hits = 0;
        const invalidate = () => {
          hits++;
          observer.invalidate(reason);
        };
        const c = navigationCase({
          factory: (io) =>
            adapter({
              ...io,
              executionBinding: io.binding,
              runtime: io.binding.runtime,
              run: io.binding.run,
              setup: io.binding.setup,
              readLive: () => {
                samples++;
                if (armed && boundary === 'live') invalidate();
                return io.sample().live;
              },
              readRaw: () => {
                if (armed && boundary === 'raw') invalidate();
                return io.sample().raw;
              },
              readExecutionBinding: () => {
                if (armed && boundary === 'fixed') invalidate();
                return io.sample().binding;
              },
              now: () => {
                if (armed && ++clocks === 2 && boundary === 'final-clock') invalidate();
                return io.now();
              },
            }),
        });
        observer = c.ready();
        if (second) {
          observer.pickerEnter(productSnapshot[1]);
          c.identity();
          observer.identity();
        }
        // This accessor runs in read() validation after all three composition
        // readers returned. Its value stays valid, so only invalidation fences it.
        Object.defineProperty(c.state.live, 'live', {
          configurable: true,
          get() {
            if (armed && boundary === 'validation') invalidate();
            return true;
          },
        });
        samples = 0;
        armed = true;
        const admit = () =>
          second ? observer.openQuestion() : observer.pickerEnter(productSnapshot[1]);
        assert.throws(admit, (error) => error.message === 'navigation admission refused');
        assert.ok(hits > 0, boundary);
        assert.equal(samples, 1, 'no resampling or observer rebuild during admission');
        assert.deepEqual(c.writes, second ? ['Down', 'Enter'] : ['Down']);
        armed = false;
        // Restoring every reader to valid values cannot recover this lifetime.
        assert.throws(admit, /navigation admission refused/);
        assert.throws(() => observer.initial(), /navigation admission refused/);
        assert.deepEqual(c.writes, second ? ['Down', 'Enter'] : ['Down']);
        assert.equal(samples, 1);
      }
    }
  }
});

test('actual composition observation-stage invalidation is irreversible before any later admission', async () => {
  const adapter = await compositionObserverAdapter();
  for (const stage of ['initial', 'moveDown', 'moved', 'identity']) {
    let observer,
      armed = false;
    const c = navigationCase({
      factory: (io) =>
        adapter({
          ...io,
          executionBinding: io.binding,
          runtime: io.binding.runtime,
          run: io.binding.run,
          setup: io.binding.setup,
          readExecutionBinding: () => io.sample().binding,
          readLive: () => io.sample().live,
          readRaw: () => {
            if (armed) observer.invalidate('observation gap during stage');
            return io.sample().raw;
          },
        }),
    });
    observer = c.create();
    if (stage !== 'initial') observer.initial();
    if (['moved', 'identity'].includes(stage)) {
      observer.moveDown();
      c.state.raw = Buffer.concat([c.state.raw, Buffer.from(c.paint(2))]);
    }
    if (stage === 'identity') {
      observer.moved();
      observer.pickerEnter(productSnapshot[1]);
      c.identity();
    }
    const before = [...c.writes];
    armed = true;
    assert.throws(() => observer[stage](), /navigation admission refused/);
    armed = false;
    assert.throws(() => observer[stage](), /navigation admission refused/);
    assert.throws(() => observer.pickerEnter(productSnapshot[1]), /navigation admission refused/);
    assert.throws(() => observer.openQuestion(), /navigation admission refused/);
    assert.deepEqual(c.writes, before);
  }
});

test('actual composition final readers fail closed on state changes, deadline, exceptions and unavailable input', async () => {
  const adapter = await compositionObserverAdapter();
  for (const second of [false, true]) {
    for (const boundary of [
      'dispose',
      'setup',
      'snapshot',
      'resize',
      'deadline',
      'late',
      'throw-live',
      'throw-raw',
      'throw-fixed',
      'throw-enter',
      ...(!second ? ['missing-enter'] : []),
    ]) {
      let armed = false,
        samples = 0;
      const c = navigationCase({
        factory: (io) =>
          adapter({
            ...io,
            enter:
              boundary === 'missing-enter'
                ? undefined
                : () => {
                    if (armed && boundary === 'throw-enter') throw Error('private-input-detail');
                    io.enter();
                  },
            executionBinding: io.binding,
            runtime: io.binding.runtime,
            run: io.binding.run,
            setup: io.binding.setup,
            readLive: () => {
              samples++;
              if (armed) {
                if (boundary === 'throw-live') throw Error('private-reader-detail');
                if (boundary === 'dispose') c.state.live.live = false;
                if (boundary === 'setup') c.state.live.generation = 'replacement';
                if (boundary === 'snapshot') c.state.live.snapshot[1].title = 'changed';
                if (boundary === 'resize') c.state.live.geometry.resizeSequence++;
              }
              return io.sample().live;
            },
            readRaw: () => {
              if (armed && boundary === 'throw-raw') throw Error('private-reader-detail');
              if (armed && ['deadline', 'late'].includes(boundary))
                c.setTick(boundary === 'deadline' ? 10 : 11);
              return io.sample().raw;
            },
            readExecutionBinding: () => {
              if (armed && boundary === 'throw-fixed') throw Error('private-reader-detail');
              return io.sample().binding;
            },
          }),
      });
      const observer = c.ready();
      if (second) {
        observer.pickerEnter(productSnapshot[1]);
        c.identity();
        observer.identity();
      }
      samples = 0;
      armed = true;
      const admit = () =>
        second ? observer.openQuestion() : observer.pickerEnter(productSnapshot[1]);
      assert.throws(admit, (error) => error.message === 'navigation admission refused');
      assert.equal(samples, 1);
      assert.deepEqual(c.writes, second ? ['Down', 'Enter'] : ['Down']);
      armed = false;
      c.setTick(1);
      assert.throws(admit, /navigation admission refused/);
      assert.deepEqual(c.writes, second ? ['Down', 'Enter'] : ['Down']);
      assert.equal(samples, 1, 'retry does not acquire another sample');
    }
  }
});

test('actual product capture adapter maps zero-marker duplicate previews by immutable ordinal, never qualifies unknown semantics', () => {
  const { initial, moved } = productPair();
  assert.equal(initial.supported, true);
  assert.equal(moved.supported, true);
  assert.deepEqual(
    initial.rows.map((r) => r.id),
    productSnapshot.map((s) => s.id),
  );
  assert.equal(initial.rows[0].style.bold, true); // Source initial index zero.
  assert.deepEqual(productPickerInterval(initial, moved), {
    qualification: 'UNQUALIFIED',
    reason: 'MISSING_SEMANTIC_BINDING',
    emittedTransfer: true,
    selectionProfile: null,
  });
  for (const mutate of [
    (s) => (s.binding.executable = 'wrong-host'),
    (s) => (s.binding.config = 'changed-config'),
    (s) => (s.binding.setup = 'replaced-setup'),
    (s) => s.binding.geometry.resizeSequence++,
    (s) => (s.binding.designMode = 'changed'),
    (s) => (s.binding.resolvedTheme = 'changed'),
    (s) => (s.binding.effectiveColorDepth = 24),
    (s) => s.snapshot.reverse(),
    (s) => (s.rows[1].id = 'changed-identity'),
    (s) => (s.rows[1].style = s.rows[0].style),
    (s) => s.screen++,
    (s) => (s.frames = initial.frames),
    (s) => (s.previousSha256 = 'historical'),
  ]) {
    const candidate = structuredClone(moved);
    mutate(candidate);
    assert.equal(productPickerInterval(initial, candidate).emittedTransfer, false);
    assert.equal(productPickerInterval(initial, candidate).qualification, 'UNQUALIFIED');
  }
});

test('product adapter refuses fixture/historical binding, replaced prefix, incomplete cells and unsupported controls without fallback', () => {
  const raw = productRaw(),
    { initial } = productPair();
  for (const altered of [
    Buffer.from(raw.toString().replace('Session 2 -', 'Session 1 -')),
    Buffer.from(raw.toString().replace('duplicate preview', 'changed preview')),
    Buffer.from(raw.toString().replace('Session 1', '\u25cf Session 1')),
    Buffer.concat([raw, Buffer.from('\x1b[?2026h')]),
    Buffer.concat([raw, Buffer.from('\x1b[3m')]),
    Buffer.from(raw.toString().replace('Select the Proceed session', 'Open Proceed question?')),
  ])
    assert.equal(
      productPickerObservation(altered, productBinding, productSnapshot).supported,
      false,
    );
  for (const binding of [
    { ...productBinding, scope: 'fixture-only' },
    { ...productBinding, geometry: { width: 80, height: 24, resizeSequence: 1 } },
  ])
    assert.equal(productPickerObservation(raw, binding, productSnapshot).supported, false);
  assert.equal(
    productPickerObservation(
      Buffer.concat([Buffer.from('replaced'), raw]),
      productBinding,
      productSnapshot,
      initial,
    ).supported,
    false,
  );
});

const dismissedRaw = () =>
  Buffer.concat([
    productRaw(),
    Buffer.from(productUpdate(2)),
    Buffer.from(
      '\x1b[?2026h' +
        [1, 2, 3, 4, 5].map((r) => `\x1b[${r};1H` + ' '.repeat(120)).join('') +
        '\x1b[H2.2.5 Ask anything\x1b[?2026l',
    ),
  ]);

test('fresh completed dismissal admits exactly one owned exit, all stale or ambiguous controls refuse', () => {
  const { moved } = productPair();
  const raw = dismissedRaw();
  let exits = 0;
  const route = (candidate = raw, binding = productBinding) =>
    issueProductPickerExit({
      snapshot: () => ({
        raw: candidate,
        binding,
        previous: moved,
        hostFrame: '2.2.5 Ask anything',
        now: () => 4,
        deadline: 5,
      }),
      exitCount: () => exits,
      exit: () => exits++,
    });
  assert.equal(route().supported, true);
  assert.equal(exits, 1);
  assert.throws(() => route());
  assert.equal(exits, 1);
  for (const candidate of [
    productRaw(),
    Buffer.concat([productRaw(), Buffer.from(productUpdate(2))]),
    Buffer.concat([raw, Buffer.from('\x1b[?2026h')]),
    Buffer.concat([raw, Buffer.from('\x1b[')]),
    Buffer.concat([raw, Buffer.from('\x1b[?1049l')]),
    Buffer.concat([raw, Buffer.from('\x1b[2J')]),
    Buffer.concat([raw, Buffer.from('\x1b[3m')]),
    Buffer.from(raw.toString().replace('2.2.5 Ask anything', 'unknown host frame')),
    Buffer.from(raw.toString().replace('2.2.5 Ask anything', '2.2.5 Ask anything UNKNOWN DIALOG')),
    Buffer.from(raw.toString().replace('duplicate preview', 'replaced preview')),
    Buffer.concat([raw, Buffer.from(productUpdate(1))]),
  ]) {
    exits = 0;
    assert.equal(
      productPickerDismissal(candidate, productBinding, moved, '2.2.5 Ask anything').supported,
      false,
    );
    assert.throws(() => route(candidate));
    assert.equal(exits, 0);
  }
  for (const change of [
    { setup: 'replacement' },
    { run: 'replacement' },
    { geometry: { width: 120, height: 40, resizeSequence: 1 } },
    { geometry: { width: 80, height: 24, resizeSequence: 0 } },
  ]) {
    exits = 0;
    assert.throws(() => route(raw, { ...productBinding, ...change }));
    assert.equal(exits, 0);
  }
});

test('actual composition final-exit closure refuses live replacement, deadline and geometry drift', async () => {
  const source = await readFile(
    new URL('support/harness-composition-inner.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('productExitSnapshot = () => {');
  const finish = source.indexOf('\n          };', start);
  assert.ok(start > 0 && finish > start);
  const closure = source.slice(start + 'productExitSnapshot = '.length, finish) + '\n}';
  const exitStart = source.indexOf('const ownedExit = () => {');
  const exitFinish = source.indexOf('\n        };', exitStart);
  assert.ok(exitStart > finish && exitFinish > exitStart);
  const exitClosure = source.slice(exitStart + 'const ownedExit = '.length, exitFinish) + '\n}';
  const { moved } = productPair();
  const unsafe = [
    ['infinity', Infinity],
    ['negative-infinity', -Infinity],
    ['nan', NaN],
    ['string', '4'],
    [
      'object',
      {
        valueOf() {
          throw Error('coercion must not run');
        },
      },
    ],
    ['null', null],
    ['undefined', undefined],
  ];
  const cases = [
    ...[
      'none',
      'deadline',
      'validation-before',
      'validation-exact',
      'validation-late',
      'exit',
      'overflow',
      'run',
      'setup',
      'resize',
      'snapshot',
      'partial',
    ].map((mutation) => ({ mutation })),
    { mutation: 'fractional', deadline: 5.125, initial: 4.25, final: 5.124 },
    ...['initial', 'final', 'deadline'].flatMap((stage) =>
      unsafe.map(([name, value]) => ({
        mutation: `${stage}-${name}`,
        stage,
        value: stage === 'deadline' && name === 'string' ? '50' : value,
      })),
    ),
    ...['initial', 'final'].flatMap((stage) =>
      ['throwing', 'accessor', 'missing', 'noncallable'].map((kind) => ({
        mutation: `${stage}-${kind}`,
        stage,
        kind,
      })),
    ),
  ];
  for (const scenario of cases) {
    const { mutation, stage, value, kind } = scenario;
    const live = {
      live: true,
      run: productBinding.run,
      generation: productBinding.setup,
      geometry: structuredClone(productBinding.geometry),
      snapshot: structuredClone(productSnapshot),
    };
    const keys = { exit: 0 };
    const writes = [];
    const events = [];
    let tick = mutation === 'deadline' ? 5 : (scenario.initial ?? 4);
    let clockStage = 'initial';
    let validationReads = 0;
    const previous = { ...moved };
    // This operand is read by the actual dismissal validator after snapshot
    // acquisition and hash/decode. Move the injected clock DURING validation.
    Object.defineProperty(previous, 'screen', {
      get() {
        validationReads++;
        clockStage = 'final';
        if (mutation === 'fractional') tick = scenario.final;
        if (mutation.startsWith('validation-')) {
          tick = { 'validation-before': 4.999, 'validation-exact': 5, 'validation-late': 6 }[
            mutation
          ];
        }
        return moved.screen;
      },
    });
    const context = {
      assert,
      Buffer,
      assertProductPickerDeadline,
      performance: {
        get now() {
          if (stage === clockStage) {
            if (kind === 'accessor') throw Error('private-clock-detail');
            if (kind === 'throwing')
              return () => {
                throw Error('private-clock-detail');
              };
            if (kind === 'missing') return undefined;
            if (kind === 'noncallable') return 4;
            return () => value;
          }
          return () => tick;
        },
      },
      pickerEnd: stage === 'deadline' ? value : (scenario.deadline ?? 5),
      exited: mutation === 'exit',
      overflow: mutation === 'overflow',
      readObservation: () => live,
      run: productBinding.run,
      binding: { generation: productBinding.setup },
      captureBinding: productBinding,
      snapshot: productSnapshot,
      transcript:
        mutation === 'partial'
          ? Buffer.concat([dismissedRaw(), Buffer.from('\x1b[?2026h')])
          : dismissedRaw(),
      pickerEvidence: { dismissalBaseline: previous },
      readinessFrame: '2.2.5 Ask anything',
      keys,
      cleanupTiming: { record: (event) => events.push(event) },
      child: { stdin: { write: (key) => writes.push(key) } },
    };
    if (mutation === 'run') live.run = 'replacement';
    if (mutation === 'setup') live.generation = 'replacement';
    if (mutation === 'resize') live.geometry.resizeSequence++;
    if (mutation === 'snapshot') live.snapshot.reverse();
    const snapshot = runInNewContext('(' + closure + ')', context, { timeout: 100 });
    const exit = runInNewContext('(' + exitClosure + ')', context, { timeout: 100 });
    const execute = () => issueProductPickerExit({ snapshot, exitCount: () => keys.exit, exit });
    const admitted = ['none', 'validation-before', 'fractional'].includes(mutation);
    if (admitted) {
      execute();
      assert.throws(execute); // No second key or retry, even before cutoff.
    } else if (stage)
      assert.throws(execute, (error) => {
        assert.match(error.message, /picker (deadline|clock)/);
        assert.equal(error.message.includes('private-clock-detail'), false);
        return true;
      });
    else if (mutation.startsWith('validation-')) assert.throws(execute, /deadline elapsed/);
    else assert.throws(execute);
    assert.equal(keys.exit, admitted ? 1 : 0);
    assert.deepEqual(writes, admitted ? ['\x03'] : []);
    assert.deepEqual(events, admitted ? ['EXIT_KEY'] : []);
    if (mutation.startsWith('validation-')) assert.equal(validationReads, 1);
    if (stage === 'final') assert.equal(validationReads, 1);
    if (stage === 'initial' || stage === 'deadline') assert.equal(validationReads, 0);
  }
  assert.match(source, /allowExit: !pickerCapture \|\| dismissalAdmitted/);
  assert.match(source, /pickerEvidence.dismissal = issueProductPickerExit\(/);
  const deadlineStart = source.indexOf('const pickerEnd =');
  const deadlineEnd = source.indexOf(';', deadlineStart);
  const deadlineExpression = source.slice(deadlineStart + 'const pickerEnd ='.length, deadlineEnd);
  assert.match(deadlineExpression, /readProductPickerClock\(\(\) => performance.now\(\)\)/);
  assert.match(deadlineExpression, /Math.min\(5000,/);
  for (const [name, tick] of [...unsafe, ['fractional', 4.25]]) {
    const evaluate = () =>
      runInNewContext(
        deadlineExpression,
        {
          readProductPickerClock,
          performance: { now: () => tick },
          end: 10000,
          Date: { now: () => 6000 },
        },
        { timeout: 100 },
      );
    if (name === 'fractional') assert.equal(evaluate(), 4004.25);
    else assert.throws(evaluate, /picker clock invalid/);
  }
});

test('capture-only actual dispatch has no Enter, identity or decision capability and requires dismissal before returning', async () => {
  for (const fail of ['none', 'observe', 'move', 'moved', 'unsupported', 'dismissal']) {
    const events = [],
      pair = productPair();
    let observations = 0;
    const run = captureProductPicker({
      selectionProfile: null,
      observe: async () => {
        events.push('observe');
        if (fail === 'observe' || (fail === 'moved' && observations))
          throw Error('synthetic failure');
        return fail === 'unsupported'
          ? { supported: false, qualification: 'UNQUALIFIED' }
          : observations++
            ? pair.moved
            : pair.initial;
      },
      moveDown: async () => {
        events.push('down');
        if (fail === 'move') throw Error('synthetic failure');
      },
      dismiss: async () => {
        events.push('escape');
        return pair.moved;
      },
      observeDismissal: async (previous) => {
        events.push('dismissal');
        if (fail === 'dismissal') return { supported: false };
        return productPickerDismissal(
          dismissedRaw(),
          productBinding,
          previous,
          '2.2.5 Ask anything',
        );
      },
      // Poison unused operations: the route must never call any of these.
      stdin: { write: () => assert.fail('generic key forbidden') },
      acceptIdentity: () => assert.fail('identity forbidden'),
      exchange: () => assert.fail('pending/decision forbidden'),
      qualify: () => assert.fail('automatic qualification forbidden'),
    });
    if (['observe', 'move', 'moved', 'unsupported', 'dismissal'].includes(fail))
      await assert.rejects(run);
    else {
      const result = await run;
      assert.equal(result.enter, 0);
      assert.equal(result.selectionProfile, null);
      assert.equal(result.qualification, 'UNQUALIFIED');
    }
    if (fail === 'none') assert.equal(events.at(-1), 'dismissal');
    else if (fail === 'dismissal') assert.equal(events.filter((s) => s === 'escape').length, 1);
    else assert.ok(!events.includes('escape'));
    assert.ok(events.filter((s) => s === 'down').length <= 1);
    if (fail === 'unsupported') assert.deepEqual(events, ['observe']);
  }
});

test('indexed fixture selection follows style, not marker or label, with asymmetric inactive roles', () => {
  for (const labels of [
    ['Session 1', 'Session 2'],
    ['OTHER', 'UNRELATED'],
  ])
    for (const selected of [0, 1])
      for (const current of [0, 1])
        assert.equal(
          fixtureSelection(fixtureCase({ selected, current, labels })),
          labels[selected],
        );
  // The observer compares supplied finite identities, not pinned palette operands.
  const styles = structuredClone(fixtureStyles);
  styles.selected = { fg: 'index:0', bg: 'index:7', bold: false };
  assert.equal(fixtureSelection(fixtureCase({ selected: 1, styles })), 'Session 2');
});

test('indexed fixture profiles refuse role/style ambiguity, missing/duplicate labels and mixed/default/RGB identities', () => {
  for (const mutate of [
    (c) => {
      c.labels.push(c.labels[0]);
    },
    (c) => {
      c.labels[1] = 'absent';
    },
    (c) => {
      c.profile.inactive.current = c.profile.inactive.ordinary;
    },
    (c) => {
      c.profile.inactive.ordinary = c.profile.selected;
    },
    (c) => {
      delete c.profile.inactive.current;
    },
    (c) => {
      c.profile.selected.bg = c.profile.inactive.current.bg;
    },
    (c) => {
      c.profile.selected.fg = 'index:256';
    },
    (c) => {
      c.profile.selected.fg = 'index:0232';
    },
    (c) => {
      c.profile.selected.fg = '232,232,232';
    },
    (c) => {
      c.profile.selected.fg = null;
    },
    (c) => {
      c.profile.selected.bg = null;
    },
    (c) => {
      c.profile.selected.italic = true;
    },
    (c) => {
      c.profile.inactive.unknown = c.profile.inactive.current;
    },
  ]) {
    const c = fixtureCase({ selected: 1 });
    mutate(c);
    assert.throws(() => fixtureSelection(c));
  }
  const c = fixtureCase();
  for (const raw of [
    c.raw.replace('\u25cf ', '  '),
    c.raw.replace('Session 2', 'Session 1'),
    c.raw.replace('Session 1', 'Session 1\u25cf'),
    c.raw.replace('Session 2', '\u25cf Session 2'),
    c.raw.replace('Session 1', 'Sess\x1b[0mion 1'),
    c.raw.replace(indexSgr(fixtureStyles.inactive.ordinary), indexSgr(fixtureStyles.selected)),
    c.raw.replace(indexSgr(fixtureStyles.selected), indexSgr(fixtureStyles.inactive.current)),
    c.raw.replace('Session 1', '\x1b[3mSession 1'),
    c.raw.replace('Session 1', '\x1b[38;2;232;232;232mSession 1'),
    c.raw.replace('Select the Proceed session', 'Open Proceed question?'),
  ])
    assert.throws(() => fixtureSelection(boundFixture(raw, c.labels)));
});

test('fixture prefix/host/theme/geometry/generation bindings and incomplete/reset updates refuse', () => {
  for (const key of [
    'host',
    'theme',
    'geometry',
    'generation',
    'transcriptHash',
    'bytes',
    'frames',
  ]) {
    const c = fixtureCase();
    c.binding[key] = key === 'geometry' ? { rows: 41, columns: 120 } : 'changed';
    assert.throws(() => fixtureSelection(c));
  }
  for (const mutate of [
    (c) => {
      c.raw += '\x1b[?2026h';
    },
    (c) => {
      c.raw += '\x1b[';
    },
    (c) => {
      c.raw += '\x1b[?1049h';
    },
    (c) => {
      c.raw += '\x1b[2J';
    },
    (c) => {
      c.binding.generation = c.profile.binding.generation = 2;
    },
    (c) => {
      c.binding.frames = c.profile.binding.frames = 2;
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 41, columns: 120 };
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 24, columns: 80 };
      c.raw = c.raw.replace('[3;3H', '[30;3H');
    },
  ]) {
    const c = fixtureCase();
    mutate(c);
    // Rebinding bytes cannot make an incomplete/reset/stale generation valid.
    c.binding.bytes = c.profile.binding.bytes = Buffer.byteLength(c.raw);
    c.binding.transcriptHash = c.profile.binding.transcriptHash = createHash('sha256')
      .update(c.raw)
      .digest('hex');
    assert.throws(() => fixtureSelection(c));
  }
});

test('historical/forged indexed fixture profiles cannot authorize a live navigation Enter', async () => {
  const c = fixtureCase();
  const styledFrame = compositionSourceFrame(c.raw);
  const picked = { frame: styledFrame.text, styledFrame, token: 10, geometry };
  for (const selectionProfile of [
    c.profile,
    { ...c.profile, scope: 'live' },
    { renderer: 'normal', selected: c.profile.selected, normal: c.profile.inactive.ordinary },
    { ...profile, binding: c.binding },
    null,
  ]) {
    const writes = [];
    await assert.rejects(
      confirmRenderedNavigation(
        {
          selectionProfile,
          offlineFixture: { labels: c.labels, binding: c.binding },
          stdin: { write: (s) => writes.push(s) },
          waitHighlightedSession: async () => picked,
          currentNavigationFrame: async () => structuredClone(picked),
          waitIdentityConfirmation: async () => {
            throw Error('must not enter');
          },
        },
        session,
      ),
    );
    assert.deepEqual(writes, []);
  }
});

test('lossless labelled blocks reconstruct full title and exact ID, not prefix/includes', () => {
  assert.ok(assertIdentityMessage(message(), session) > 0);
  assert.doesNotThrow(() => assertCurrentIdentityFrame(frame(), session, geometry));
  for (const altered of [
    message().replace('Title:', 'Preview:'),
    message().replace('Exact session ID:', 'Hidden value:'),
    message().replace('ses_', 'ses_x'),
    message().replace('EqualLong', 'EqualShort'),
    message() + 'x',
    message().replace('Navigation only - no decision', 'Approve'),
    message().replace('Title:', '\x1b[31mTitle:'),
  ])
    assert.throws(() => assertIdentityMessage(altered, session));
  for (const altered of [
    frame().replace('Cancel', ''),
    frame({ ...session, id: session.id + 'x' }),
    picker + '\n' + frame(),
    'Old confirmation\n' + message(),
  ])
    assert.throws(() => assertCurrentIdentityFrame(altered, session, geometry));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 79, height: 50 }));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 80, height: 24 }));
});

test('identical plain frames retain different normal selection styles', () => {
  assert.equal(styledPicker(1).text, styledPicker(2).text);
  assert.equal(highlightedOrdinal(styledPicker(1), profile), 'Session 1');
  assert.equal(highlightedOrdinal(styledPicker(2), profile), 'Session 2');
  assert.throws(() => highlightedOrdinal(styledPicker(), null));
  assert.throws(() => highlightedOrdinal(picker, profile));
});

test('focus, bold alone, ambiguous/unknown styles and incomplete mutations refuse', () => {
  for (const edit of [
    (s) => {
      s.styles[1] = s.styles[2];
    },
    (s) => {
      s.styles[2] = s.styles[1];
    },
    (s) => {
      s.styles[2][5] = { ...profile.selected, bg: '9,9,9' };
    },
    (s) => {
      s.styles[2] = s.styles[2].map(() => ({ ...profile.normal, bold: true }));
    },
    (s) => {
      s.text += '\nOpen Proceed question?';
    },
  ]) {
    const s = structuredClone(styledPicker());
    edit(s);
    assert.throws(() => highlightedOrdinal(s, profile));
  }
  for (const suffix of [
    '\x1b[?2026h',
    '\x1b[',
    '\x1b[?2026h\x1b[2J\x1b[?2026l',
    '\x1b[?2026h\x1b[2;5H\x1b[0mSession 1\x1b[?2026l',
    '\x1b[?2026h\x1b[3m\x1b[?2026l',
    '\x1b[?2026h\x1b[1A\x1b[?2026l',
    '\x1b[?2026h\x1b[?3h\x1b[?2026l',
    '\x1b[?2026h\x1b[38;5;1m\x1b[?2026l',
    '\x1b]4;1;rgb:ff/00/00\x07',
    '\x1b[?2026h\x1b[38;2;;1;2m\x1b[?2026l',
    '\x1b[?2026h\x1b[1;301HX\x1b[?2026l',
    '\x1b[?2026h\x1b[1;1H\u0301\x1b[?2026l',
  ])
    assert.throws(() =>
      highlightedOrdinal(compositionCurrentFrame(ansiPicker() + suffix, { styled: true }), profile),
    );
  const focus = compositionCurrentFrame(
    ansiPicker() +
      '\x1b[?2026h\x1b[1;1H' +
      sgr(profile.selected) +
      'Select the Proceed session\x1b[?2026l',
    { styled: true },
  );
  assert.equal(highlightedOrdinal(focus, profile), 'Session 2');
  const repainted = compositionCurrentFrame(
    ansiPicker() + '\x1b[?2026h\x1b[3;1H\x1b[0m\x1b[2K' + '    Session 2 equal preview\x1b[?2026l',
    { styled: true },
  );
  assert.throws(() => highlightedOrdinal(repainted, profile));
});

async function control(mutate = () => {}) {
  const writes = [];
  const selected = { frame: picker, styledFrame: styledPicker(), token: 10, geometry };
  const confirmed = { frame: frame(), token: 20, geometry };
  let stage = 'picker';
  const driver = {
    selectionProfile: profile,
    stdin: { write: (key) => writes.push(key) },
    waitHighlightedSession: async () => selected,
    waitIdentityConfirmation: async () => {
      stage = 'confirmation';
      return confirmed;
    },
    currentNavigationFrame: async () => {
      const observation = structuredClone(stage === 'picker' ? selected : confirmed);
      mutate(observation, stage);
      return observation;
    },
  };
  let error;
  try {
    await confirmRenderedNavigation(driver, session);
  } catch (caught) {
    error = caught;
  }
  return { writes, error };
}

test('screen reset invalidates completed picker until a supported fresh frame, with zero Enter', async () => {
  for (const reset of ['\x1b[?1049h', '\x1b[2J', '\x1b[3J']) {
    for (const styled of [false, true])
      assert.equal(compositionCurrentFrame(ansiPicker() + reset, { styled }), '');
    const result = await control((s, stage) => {
      if (stage !== 'picker') return;
      const ansi = ansiPicker() + reset;
      s.frame = compositionCurrentFrame(ansi);
      s.styledFrame = compositionCurrentFrame(ansi, { styled: true });
    });
    assert.ok(result.error, 'reset must refuse stale picker');
    assert.deepEqual(result.writes, []);
    const fresh = compositionCurrentFrame(ansiPicker() + reset + ansiPicker(1), {
      styled: true,
    });
    assert.equal(highlightedOrdinal(fresh, profile), 'Session 1');
  }
});

test('current interaction positive requires two separate navigation Enters', async () => {
  const result = await control();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, ['\r', '\r']);
});

test('stale, ambiguous or replaced picker refuses first Enter, stale/resize/foreign confirmation refuses second', async () => {
  for (const stage of ['picker', 'confirmation'])
    for (const mutate of [
      (s) => {
        s.token++;
      },
      (s) => {
        s.frame = '';
      },
      (s) => {
        s.frame += '\n\u2503    Session 1';
      },
      (s) => {
        s.geometry.resizeSequence++;
      },
      ...(stage === 'picker'
        ? [
            (s) => {
              s.styledFrame = styledPicker(1);
            },
          ]
        : []),
      ...(stage === 'confirmation'
        ? [
            (s) => {
              s.geometry.resizeSequence++;
            },
            (s) => {
              s.frame = frame({ ...session, id: 'foreign' });
            },
          ]
        : []),
    ]) {
      const result = await control((s, current) => {
        if (current === stage) mutate(s);
      });
      assert.ok(result.error, 'invalid current observation accepted');
      assert.deepEqual(result.writes, stage === 'picker' ? [] : ['\r']);
    }
});
