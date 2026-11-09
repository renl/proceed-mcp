// TEST ONLY. One normal product command in the actual compiled host, no model.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  symlink,
  access,
  readdir,
  rename,
  cp,
} from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  withQualificationBroker,
  confirmQualificationEnrollment,
} from './harness-qualification-setup.mjs';
import { transportFixtures, freezeTransportSecrets } from './harness-transport-fixtures.mjs';
import { assertIntegratedTransportGate } from './harness-runtime-transport.mjs';
import {
  waitCompositionPhase,
  failureSnapshot,
  settleCompositionHost,
  cleanupMilestones,
  scanFrozenComposition,
  compositionScanReason,
  persistCompositionDiagnostic,
  collectProductCapture,
  productCaptureExport,
  productCaptureInputs,
  productCaptureLogs,
  productCaptureReadFile,
  scanIntegratedPrivateCaptures,
  admitIntegratedPrivateInventory,
} from './harness-composition-retention.mjs';
import { digest, collectionAdmit, collectionLimits } from './harness-renderer-observation.mjs';
import {
  awaitCompositionKeyAdmission,
  compositionRenderEvidence,
  compositionErrorCode,
  compositionCurrentFrame,
  compositionReadinessFrame,
  compositionLastGuardSample,
  compositionActivation,
  compositionSnapshot,
  compositionCanRequestFresh,
  compositionGuardJournal,
  compositionSourceFrame,
} from './harness-composition-readiness.mjs';
import { assertPluginInventory, assertServiceInventory } from './harness-plugin-inventory.mjs';
import {
  requestResultWireAdapter,
  runCompositionRequestResult,
} from './harness-request-result.mjs';
import {
  captureProductPicker,
  productPickerObservation,
  productPickerDismissal,
  issueProductPickerExit,
  assertProductPickerDeadline,
  readProductPickerClock,
  createProductNavigationObserver,
} from './harness-navigation-observation.mjs';
import {
  stageQualification,
  integratedCompositionConfiguration,
  isolatedLinuxEnvironment,
  linuxScriptArguments,
} from './harness-linux-plan.mjs';

// Pure dispatch seam of the actual contained entry, exercised natively without
// importing the resource-owning module body or replacing the integrated driver.
export async function compositionIntegratedScenario(options) {
  assert.equal(options.wire.connection, 'composition-shared-owner');
  assert.equal(typeof options.io.send, 'function');
  return runCompositionRequestResult(options);
}

// TEST ONLY. File-observation/PTY bridge for the separate navigation-only mode.
// The wrapper owns public session reads. IO supplies current PTY bytes, not
// expected identities. One lifetime, original deadline and no recovery/rebuild.
export async function compositionPublicNavigationBridge({
  executionBinding,
  runtime,
  run,
  setup,
  readExecutionBinding,
  readObservation,
  writeObservation,
  readRaw,
  now,
  deadline,
  pause,
  moveDown,
  pickerEnter,
  openPicker,
  cancel,
  intendedSession,
  allowQuestion = false,
  openQuestion,
  moveUp,
}) {
  const fixed = structuredClone(executionBinding);
  let invalid = false,
    busy = false,
    selection,
    response,
    raw,
    sequence = 0,
    opened = false,
    confirmed = false;
  let intended = intendedSession && Object.freeze(structuredClone(intendedSession)),
    geometry,
    lastClock = -Infinity;
  const invalidate = () => {
    invalid = true;
    selection?.invalidate();
  };
  const active = () => assert.equal(invalid, false);
  const clock = () => {
    active();
    const tick = readProductPickerClock(now);
    assert.ok(tick >= lastClock);
    lastClock = tick;
    assertProductPickerDeadline(() => tick, deadline);
    active();
  };
  const lifetime = () => {
    active();
    const live = readObservation('composition-live.json');
    assert.equal(live.live, true);
    assert.equal(live.run, run);
    assert.equal(live.generation, setup);
    assert.ok(typeof setup === 'string' && setup.length > 0);
    if (geometry) assert.deepEqual(live.geometry, geometry);
    active();
    return live;
  };
  const current = () => {
    clock();
    const live = lifetime();
    assert.deepEqual(readObservation('composition-selector-response.json'), response);
    assert.deepEqual(readRaw(), raw);
    assert.deepEqual(readExecutionBinding(), fixed);
    assert.deepEqual(lifetime(), live);
    assert.deepEqual(readRaw(), raw);
    active();
    return { ...live, snapshot: structuredClone(response.snapshot) };
  };
  const refresh = async () => {
    clock();
    const live = lifetime();
    geometry ??= structuredClone(live.geometry);
    raw = Buffer.from(readRaw());
    assert.ok(raw.length > 0 && raw.length <= 1048576);
    const request = {
      kind: 'navigation-observation',
      run,
      generation: setup,
      request: ++sequence,
      id: intended?.id ?? null,
      bytes: raw.length,
      sha256: digest(raw),
    };
    const previousResponse = readObservation('composition-selector-response.json');
    writeObservation('composition-selector-request.json', request);
    // One request only. Missing response may wait inside the original deadline.
    // A mismatched response is not retried or accepted as last-good evidence.
    for (;;) {
      clock();
      lifetime();
      const next = readObservation('composition-selector-response.json');
      if (next !== null && JSON.stringify(next) !== JSON.stringify(previousResponse)) {
        for (const key of Object.keys(request)) assert.deepEqual(next[key], request[key]);
        assert.equal(next.live, true);
        assert.deepEqual(next.geometry, geometry);
        response = structuredClone(next);
        break;
      }
      await pause();
    }
    current();
    intended ??= Object.freeze(structuredClone(intendedSession ?? response.snapshot[1]));
    assert.ok(response.snapshot.some((s) => JSON.stringify(s) === JSON.stringify(intended)));
    assert.deepEqual(response.exact, structuredClone({ id: intended.id, title: intended.title }));
    clock();
  };
  const stage = async (name) => {
    try {
      active();
      assert.equal(busy, false);
      busy = true;
      await refresh();
      active();
      const result = selection[name]();
      active();
      if (name === 'identity') confirmed = true;
      return result;
    } catch {
      invalidate();
      assert.fail('navigation admission refused');
    } finally {
      busy = false;
    }
  };
  try {
    await refresh();
    selection = compositionNavigationSelection({
      intendedSession: intended,
      executionBinding: fixed,
      runtime,
      run,
      setup,
      readExecutionBinding,
      readLive: current,
      readRaw: () => {
        current();
        return Buffer.from(raw);
      },
      readSession: (id) => {
        current();
        assert.equal(id, intended.id);
        return structuredClone(response.exact);
      },
      now: () => {
        current();
        clock();
        return lastClock;
      },
      deadline,
      moveDown,
      moveUp,
      targetIndex: response.snapshot.findIndex((s) => s.id === intended.id),
      pickerEnter,
      // No second Enter capability exists in this navigation-only bridge.
      openQuestion: () => {
        assert.equal(allowQuestion, true);
        assert.equal(typeof openQuestion, 'function');
        openQuestion();
      },
    });
    active();
    return Object.freeze({
      openPicker: () => {
        try {
          active();
          assert.equal(opened, false);
          const live = lifetime();
          assert.deepEqual(live.snapshot, response.snapshot);
          assert.deepEqual(readExecutionBinding(), fixed);
          const prefix = Buffer.from(readRaw());
          assert.ok(prefix.length >= raw.length);
          assert.deepEqual(prefix.subarray(0, raw.length), raw);
          assert.deepEqual(lifetime(), live);
          assert.deepEqual(readRaw(), prefix);
          assert.equal(typeof openPicker, 'function');
          clock();
          active();
          opened = true;
          openPicker();
        } catch {
          invalidate();
          assert.fail('navigation admission refused');
        }
      },
      initial: () => stage('initial'),
      moveDown: () => stage('moveDown'),
      moved: () => stage('moved'),
      moveBack: () => stage('moveBack'),
      returned: () => stage('returned'),
      pickerEnter: () => stage('pickerEnter'),
      identity: () => stage('identity'),
      cancel: () => {
        try {
          active();
          assert.equal(confirmed, true);
          current();
          assert.equal(typeof cancel, 'function');
          clock();
          active();
          invalidate(); // Fence the only bridge before cancelling, never recover it.
          cancel();
        } catch {
          invalidate();
          assert.fail('navigation admission refused');
        }
      },
      openQuestion: () => {
        if (!allowQuestion) {
          invalidate();
          assert.fail('navigation admission refused');
        }
        return stage('openQuestion');
      },
      invalidate,
    });
  } catch {
    invalidate();
    assert.fail('navigation admission refused');
  }
}

// One closed key alphabet and one bridge. No question/pending/second-Enter API.
export async function compositionNavigationDispatch({
  bridgeIO,
  ready,
  awaitUpdate,
  awaitDismissal,
  exitSnapshot,
  send,
  now,
  deadline,
  progress,
}) {
  const keys = { ctrlG: 0, down: 0, enter: 0, escape: 0, exit: 0 };
  const order = ['ctrlG', 'down', 'enter', 'escape', 'exit'];
  const bytes = { ctrlG: '\x07', down: '\x1b[B', enter: '\r', escape: '\x1b', exit: '\x03' };
  let position = 0,
    last = -Infinity,
    bridge;
  const clock = () => {
    const tick = readProductPickerClock(now);
    assert.ok(tick >= last);
    last = tick;
    assertProductPickerDeadline(() => tick, deadline);
    return tick;
  };
  const key = (name) => {
    assert.equal(name, order[position]);
    assert.equal(keys[name], 0);
    position++;
    keys[name]++;
    send(bytes[name], name);
  };
  try {
    bridge = await compositionPublicNavigationBridge({
      ...bridgeIO,
      now: clock,
      deadline,
      openPicker: () => key('ctrlG'),
      moveDown: () => key('down'),
      pickerEnter: () => key('enter'),
      cancel: () => key('escape'),
    });
    await progress('navigation-readiness');
    await ready(() => bridge.openPicker());
    assert.equal(keys.ctrlG, 1);
    await progress('navigation-initial');
    await awaitUpdate(0);
    const initial = await bridge.initial();
    await bridge.moveDown();
    await progress('navigation-moved');
    await awaitUpdate(initial.frames);
    const moved = await bridge.moved();
    await bridge.pickerEnter();
    await progress('navigation-identity');
    await awaitUpdate(moved.frames);
    const identity = await bridge.identity();
    bridge.cancel();
    const dismissalBaseline = { supported: true, binding: initial.binding, ...identity };
    await progress('navigation-dismissal');
    await awaitDismissal(dismissalBaseline);
    await progress('navigation-exit');
    const dismissal = issueProductPickerExit({
      snapshot: () => ({ ...exitSnapshot(dismissalBaseline), now: clock, deadline }),
      exit: () => key('exit'),
      exitCount: () => keys.exit,
    });
    return {
      mode: 'PRODUCT_NAVIGATION_ONLY',
      qualification: 'UNQUALIFIED',
      selectionProfile: null,
      initial,
      moved,
      identity,
      dismissalBaseline,
      dismissal,
      keys,
    };
  } catch {
    bridge?.invalidate();
    assert.fail('navigation admission refused');
  }
}

// TEST ONLY. Public readers and stage-specific bounded inputs are injected.
// The navigation-only dispatcher supplies no question-opening input.
export function compositionNavigationSelection({
  intendedSession,
  readSession,
  pickerEnter,
  openQuestion,
  targetIndex = 1,
  ...io
}) {
  let observer;
  try {
    const intended = Object.freeze(structuredClone(intendedSession));
    let inputs = 0;
    observer = compositionNavigationObserver({
      ...io,
      readLive: () => {
        const live = io.readLive();
        assert.deepEqual(live.snapshot[targetIndex], intended);
        // Independent public data.session.get(id) projection. Never a preview
        // lookup or a session inferred from the rendered picker cells.
        const current = readSession(intended.id);
        assert.equal(current.id, intended.id);
        assert.equal(current.title, intended.title);
        return live;
      },
      enter: () => {
        // Stage-specific callbacks cannot supply identity or admission. No
        // reader or renewed deadline sits after the observer's final fence.
        const input = inputs++ === 0 ? pickerEnter : openQuestion;
        assert.equal(typeof input, 'function');
        input();
      },
      targetIndex,
    });
    return Object.freeze({
      initial: () => observer.initial(),
      moveDown: () => observer.moveDown(),
      moved: () => observer.moved(),
      moveBack: () => observer.moveBack(),
      returned: () => observer.returned(),
      pickerEnter: () => observer.pickerEnter(intended),
      identity: () => observer.identity(),
      openQuestion: () => observer.openQuestion(),
      invalidate: () => observer.invalidate(),
    });
  } catch {
    observer?.invalidate();
    assert.fail('navigation admission refused');
  }
}

// Pure private wiring seam. No file, process or input is acquired here. The
// runtime caller must supply freshly admitted fixed inputs and independent live
// observations. This does not enable the closed legacy pending branch below.
export function compositionNavigationObserver({
  executionBinding,
  runtime,
  run,
  setup,
  readExecutionBinding,
  readLive,
  readRaw,
  now,
  deadline,
  moveDown,
  moveUp,
  targetIndex = 1,
  enter,
}) {
  const live = readLive();
  const binding = {
    ...executionBinding,
    runtime: {
      version: runtime.version,
      bun: runtime.bun,
      node: runtime.node,
    },
    run,
    setup,
    geometry: structuredClone(live.geometry),
  };
  return createProductNavigationObserver({
    binding,
    snapshot: structuredClone(live.snapshot),
    now,
    deadline,
    moveDown,
    moveUp,
    targetIndex,
    enter,
    sample: () => {
      const current = readLive();
      return {
        raw: readRaw(),
        binding: {
          ...readExecutionBinding(),
          runtime: {
            version: runtime.version,
            bun: runtime.bun,
            node: runtime.node,
          },
          run,
          setup,
          geometry: structuredClone(current.geometry),
        },
        snapshot: structuredClone(current.snapshot),
        live: current,
      };
    },
  });
}

const evidence = '/run/proceed/evidence';
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 &&
      ['--product-picker-capture', '--product-navigation'].includes(process.argv[2])),
);
const pickerCapture = process.argv[2] === '--product-picker-capture';
const navigationOnly = process.argv[2] === '--product-navigation';
const integratedScenario = !pickerCapture && !navigationOnly;
const productMode = true;
let integratedResult, integratedWire;
let pickerEvidence, executionBinding;
let dismissalAdmitted = false;
let productExitSnapshot;
let navigationCleanupEnd;
const cleanupTiming = cleanupMilestones(() => performance.now());
let cleanupObservation;
const terminalResponses = [
  [/\x1b\[6n/g, '\x1b[1;1R'],
  [/\x1b\[\?u/g, '\x1b[?0u'],
  [/\x1b\[c/g, '\x1b[?1;2c'],
  [/\x1b\[>c/g, '\x1b[>0;0;0c'],
  [/\x1b\]10;\?(?:\x07|\x1b\\)/g, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
  [/\x1b\]11;\?(?:\x07|\x1b\\)/g, '\x1b]11;rgb:0000/0000/0000\x1b\\'],
];
const started = Date.now(),
  end = started + 210000;
let phase = 'policy',
  failure,
  child,
  exited = false,
  closed = false,
  stdoutEnded = false,
  stderrEnded = false,
  overflow = false;
let transcript = Buffer.alloc(0);
let errorCode,
  renderEvidence,
  scanStatus = 'UNRUN';
let scanReason = 'UNRUN';
let productCleanup = 'UNRUN',
  hostExit = 'UNRUN';
let commandEligibility = 'UNRUN';
let scenarioSucceeded = false;
const keys = { ctrlG: 0, ctrlE: 0, enter: 0, exit: 0, down: 0, up: 0, escape: 0 };
let readinessFrame = '';
let readinessObservation;
const guardJournal = compositionGuardJournal();
let lastLoopGuard;
const recordGuard = (stage, snapshot) => {
  guardJournal.record(stage, snapshot);
  if (stage === 'loopadmit') lastLoopGuard = structuredClone(snapshot);
};
let lastGuardState, readinessEnd;
let failureAt;
let priorPids = new Set();
let lifecycle = { exitObserved: false, closeObserved: false, termination: 'NOT_REQUESTED' };
await mkdir(evidence, { recursive: true });
const diagnosticIO = {
  write: (bytes) => writeFile(join(evidence, 'composition-diagnostic.next'), bytes),
  commit: () =>
    rename(
      join(evidence, 'composition-diagnostic.next'),
      join(evidence, 'composition-diagnostic.json'),
    ),
};
const progress = async (next) => {
  phase = next;
  await appendFile(
    join(evidence, 'progress.jsonl'),
    JSON.stringify({ phase, elapsed: Date.now() - started }) + '\n',
  );
};
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const readCleanupObservation = (name) => {
  try {
    return JSON.parse(readFileSync(join(evidence, name), 'utf8'));
  } catch {
    return null;
  }
};
async function wait(label, predicate, budget = 15000, monotonicDeadline) {
  await progress(label);
  const deadline = monotonicDeadline ?? Math.min(end, Date.now() + budget);
  await waitCompositionPhase({
    predicate,
    deadline,
    now: monotonicDeadline === undefined ? Date.now : () => performance.now(),
    pause: () => delay(20),
    overflow: () => overflow,
  });
}
const plain = (b) =>
  b
    .toString()
    .replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
async function logs(
  root,
  accounting = { entries: 0, paths: 0, bytes: 0, deadline: Math.min(end, Date.now() + 5000) },
  depth = 0,
) {
  if (productMode) {
    return productCaptureLogs(root, accounting, depth);
  }
  const chunks = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = join(root, e.name);
    if (e.isDirectory()) chunks.push(await logs(path));
    else if (/\.log(?:[.-].*)?$/.test(e.name)) chunks.push(await readFile(path));
  }
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length < 4194304);
  return bytes;
}
try {
  await wait('inspected-policy', () => exists('/run/proceed-authorized'));
  assert.equal(process.version, 'v24.22.2');
  assert.ok(
    Object.values(networkInterfaces())
      .flat()
      .every((i) => i.internal),
  );
  assert.equal((await readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
  assert.equal(await exists('/etc/opencode'), false);
  for (const base of ['/', '/run', '/run/proceed'])
    for (const name of ['.opencode', 'opencode.json', 'opencode.jsonc'])
      assert.equal(await exists(join(base, name)), false);
  const work = '/run/proceed/work';
  await mkdir(work);
  for (const name of ['bin', 'src', 'tests']) await symlink('/payload/' + name, join(work, name));
  process.chdir(work);
  process.env.PROCEED_TEST_FIXTURES = '/run/proceed/managed-fixtures';
  process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE = '1';
  await withQualificationBroker(
    async (h) => {
      await progress('synthetic-enrollment');
      await confirmQualificationEnrollment(h, h.operator, h.proposal, {
        local: h.operator.keyId,
        broker: h.proposal.key_id,
      });
      const env = isolatedLinuxEnvironment('/run/proceed/host-state');
      for (const value of new Set(Object.values(env).filter((v) => v.startsWith('/run/'))))
        await mkdir(value, { recursive: true });
      await mkdir('/run/proceed/host-state/work');
      const staging = await stageQualification(
        env,
        evidence,
        '/payload',
        '/run/proceed/staged',
        {
          state_dir: h.state,
          harness_id: 'qualification',
          owner_id: 'shared',
          operator_key_file: h.operator.file,
        },
        JSON.parse(await readFile('/payload/input-paths.json', 'utf8')),
      );
      // A public lifecycle wrapper imports the exact package ./tui export. It
      // forwards the real Context and only the four production options unchanged.
      const fixture = join(env.OPENCODE_CONFIG_DIR, 'plugins/proceed-composition');
      await mkdir(join(fixture, 'node_modules/@meshimize'), { recursive: true });
      if (productMode)
        await cp(staging.product, join(fixture, 'node_modules/@meshimize/proceed-mcp'), {
          recursive: true,
        });
      else await symlink(staging.product, join(fixture, 'node_modules/@meshimize/proceed-mcp'));
      await writeFile(
        join(fixture, 'package.json'),
        JSON.stringify({
          name: 'proceed-composition',
          type: 'module',
          exports: { './tui': './tui.ts' },
        }),
      );
      await writeFile(
        join(fixture, 'tui.ts'),
        await readFile('/payload/tests/fixtures/harness-composition/tui.ts'),
      );
      const configuration = integratedScenario
        ? integratedCompositionConfiguration(staging, fixture, h.state)
        : { cli: { plugins: [{ package: fixture, options: staging.options }] } };
      await writeFile(staging.config, JSON.stringify(configuration.cli));
      const serviceConfig = join(env.OPENCODE_CONFIG_DIR, 'opencode.json');
      if (integratedScenario) await writeFile(serviceConfig, JSON.stringify(configuration.service));
      if (productMode) {
        executionBinding = {
          scope: 'product-capture',
          executable: execFileSync('/usr/bin/sha256sum', ['/usr/local/bin/opencode'], {
            env,
            timeout: 5000,
            encoding: 'utf8',
          }).split(' ')[0],
          package: digest(await readFile(join(staging.product, 'package.json'))),
          source: '9bbb8ce18c80f099e0e448775f59d965ead40a21',
          rendererSource: '738067f47e940dcec3f5aab74868908574335c6c',
          sourceBinding: 'PINNED_IMAGE_PROVENANCE_NOT_RUNTIME_ACCESSOR',
          config: digest(await readFile(staging.config)),
          configBytes: (await readFile(staging.config)).toString('utf8'),
          ...(integratedScenario ? { serviceConfig: digest(await readFile(serviceConfig)) } : {}),
          environment: env,
          terminalResponsePolicy: terminalResponses.map(([query, reply]) => ({
            query: query.source,
            flags: query.flags,
            reply,
          })),
          wrapper: digest(await readFile(join(fixture, 'tui.ts'))),
          resolvedTheme: null,
          designMode: null,
          effectiveColorDepth: null,
          payload: JSON.parse(await readFile('/payload/input-paths.json', 'utf8')),
          inputs: JSON.parse(await readFile('/payload/input-integrity.json', 'utf8')),
        };
      }
      // Navigation has no transport negative listeners, generated role secrets,
      // pending setup probe or pending capability. Only the owned broker exists.
      const controls = navigationOnly
        ? {
            secrets: Object.freeze([
              h.operator.credential,
              ...(await Promise.all(
                (await readdir(join(h.state, 'credentials'))).map(async (name) =>
                  (await readFile(join(h.state, 'credentials', name), 'utf8')).trim(),
                ),
              )),
              JSON.parse(await readFile(join(h.state, 'broker.lock'), 'utf8')).channel.psk,
            ]),
            close: async () => {},
          }
        : await transportFixtures(h);
      let requiredSecrets;
      let controlsClosed = false;
      try {
        requiredSecrets = navigationOnly ? controls.secrets : freezeTransportSecrets(controls);
        assert.equal(new Set(requiredSecrets).size, requiredSecrets.length);
        if (integratedScenario) {
          await writeFile(
            '/run/proceed/qualification-private/cases.json',
            JSON.stringify(controls.plan),
            { mode: 0o600 },
          );
          Object.assign(env, {
            HTTP_PROXY: controls.proxy,
            HTTPS_PROXY: controls.proxy,
            ALL_PROXY: controls.proxy,
          });
        }
        if (navigationOnly) assert.equal(h.pending, undefined);
        assert.match(
          execFileSync('/usr/local/bin/opencode', ['--version'], {
            env,
            cwd: '/run/proceed/host-state/work',
            timeout: 5000,
            encoding: 'utf8',
          }).trim(),
          /(?:opencode v)?2\.2\.5$/,
        );
        await progress('compiled-product-start');
        const run = randomUUID();
        await writeFile(
          join(evidence, 'composition-binding.json'),
          JSON.stringify({ run, captureOnly: pickerCapture, navigationOnly, integratedScenario }),
        );
        // Establish the empty observer stream before any exchange. Missing later
        // is a capture failure, never an invented zero-response scan input.
        await writeFile('/run/proceed/qualification-private/composition-wire.jsonl', '');
        priorPids = new Set((await readdir('/proc')).filter((p) => /^\d+$/.test(p)));
        child = spawn('/usr/bin/script', linuxScriptArguments('/run/proceed/host-state/pty.raw'), {
          env,
          cwd: '/run/proceed/host-state/work',
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        });
        child.on('exit', () => {
          exited = true;
        });
        child.on('close', () => {
          closed = true;
        });
        child.on('error', () => {
          overflow = true;
        });
        child.stdin.on('error', () => {});
        let pending = '';
        const capture = (bytes) => {
          if (transcript.length + bytes.length > 1048576) overflow = true;
          else transcript = Buffer.concat([transcript, bytes]);
        };
        child.stdout.on('data', (bytes) => {
          capture(bytes);
          const input = pending + bytes.toString();
          let consumed = 0;
          for (const [pattern, reply] of terminalResponses)
            for (const match of input.matchAll(pattern)) {
              if (!exited) child.stdin.write(reply);
              consumed = Math.max(consumed, match.index + match[0].length);
            }
          const tail = input.slice(consumed),
            last = tail.lastIndexOf('\x1b');
          pending = last >= 0 && tail.length - last < 32 ? tail.slice(last) : '';
        });
        child.stderr.on('data', capture);
        child.stdout.on('end', () => {
          stdoutEnded = true;
        });
        child.stderr.on('end', () => {
          stderrEnded = true;
        });
        readinessEnd = Math.min(end, Date.now() + 60000);
        await wait(
          'public-session-and-product-ready',
          async () => {
            if (await exists(join(evidence, 'composition-fixture-failure.json'))) {
              const fixed = JSON.parse(
                await readFile(join(evidence, 'composition-fixture-failure.json'), 'utf8'),
              );
              assert.ok(
                [
                  'product-setup',
                  'public-session-create',
                  'host-session-sync',
                  'public-command-eligibility',
                ].includes(fixed.phase),
              );
              phase = fixed.phase;
              throw Error('fixture setup failed');
            }
            return !exited && (await exists(join(evidence, 'composition-ready.json')));
          },
          readinessEnd - Date.now(),
        );
        const runtime = JSON.parse(
          await readFile(join(evidence, 'composition-ready.json'), 'utf8'),
        );
        assert.equal(runtime.version, '2.2.5');
        assert.equal(runtime.bun, '1.4.4');
        assert.equal(runtime.run, run);
        assert.equal(typeof runtime.generation, 'string');
        const binding = { run, generation: runtime.generation, session: runtime.session };
        const origin = { target: fixture, entry: join(fixture, 'tui.ts') };
        const readObservation = (name) => {
          try {
            return JSON.parse(readFileSync(join(evidence, name), 'utf8'));
          } catch {
            return null;
          }
        };
        // These exact private IO closures bind the separate navigation mode
        // the bridge to the maintained current stream and public wrapper files.
        // No historical capture, profile, expected identity or input is accepted.
        const navigationBridgeIO = {
          readObservation,
          writeObservation: (name, request) => {
            assert.equal(name, 'composition-selector-request.json');
            writeFileSync(join(evidence, name), JSON.stringify(request));
          },
          readRaw: () => {
            assert.ok(!exited && !closed && !overflow);
            return Buffer.from(transcript);
          },
        };
        let request,
          requestWrittenAt,
          sequence = 0;
        await progress('rendered-host-and-product-registration');
        const admitReady = async (onAdmit) =>
          await awaitCompositionKeyAdmission({
            observe: async () => {
              const activation = compositionActivation(
                (await logs('/run/proceed/host-state')).toString(),
                origin,
              );
              if (activation && !binding.hostRun) {
                binding.hostRun = activation.run;
                binding.hostSetup = activation.setup;
              }
              const frame = compositionReadinessFrame(transcript.toString(), productMode);
              const frameToken = transcript.length;
              const response = readObservation('composition-selector-response.json');
              const responseReadAt = response ? Date.now() : undefined;
              const live = readObservation('composition-live.json');
              lastGuardState = {
                provenance: {
                  observer: productMode ? 'SOURCE_LAYOUT' : 'UNSTYLED',
                  operands: 'LOOP_SAMPLE',
                  activation: activation ? 'OBSERVED' : 'NOT_OBSERVED',
                  prefixSha256: digest(transcript),
                },
                binding,
                activation,
                frame,
                frameToken,
                request,
                response,
                live,
                exited,
                overflow,
                requestWrittenAt,
                responseReadAt,
              };
              renderEvidence = compositionRenderEvidence(frame);
              return lastGuardState;
            },
            requestFresh: (state, snapshot) => {
              // Never reuse historical eligibility. Re-observe only under the
              // existing current-frame rule and pinned activation/generation.
              if (compositionCanRequestFresh(state, snapshot)) {
                request = {
                  ...binding,
                  request: ++sequence,
                  frame: state.frame,
                  frameToken: state.frameToken,
                };
                writeFileSync(
                  join(evidence, 'composition-selector-request.json'),
                  JSON.stringify(request),
                );
                requestWrittenAt = Date.now();
              }
            },
            pause: () => delay(20),
            now: Date.now,
            deadline: readinessEnd,
            record: recordGuard,
            onAdmit: (state) => {
              readinessFrame = state.frame;
              readinessObservation = {
                binding,
                activation: state.activation,
                request: state.request,
                response: state.response,
                live: state.live,
              };
              commandEligibility = 'FRESH_SAME_GENERATION';
              onAdmit();
            },
          });
        if (navigationOnly) {
          const navigationEnd =
            readProductPickerClock(() => performance.now()) +
            Math.min(5000, Math.max(0, end - Date.now()));
          const fixed = structuredClone(executionBinding);
          const initialLive = readObservation('composition-live.json');
          const snapshot = structuredClone(initialLive.snapshot);
          assert.equal(snapshot.length, 2);
          assert.equal(snapshot[0].title, snapshot[1].title);
          const captureBinding = {
            ...fixed,
            runtime: { version: runtime.version, bun: runtime.bun, node: runtime.node },
            run,
            setup: binding.generation,
            geometry: structuredClone(initialLive.geometry),
          };
          const readFixed = () => ({
            ...fixed,
            executable: execFileSync('/usr/bin/sha256sum', ['/usr/local/bin/opencode'], {
              env,
              timeout: 5000,
              encoding: 'utf8',
            }).split(' ')[0],
            config: digest(readFileSync(staging.config)),
            configBytes: readFileSync(staging.config).toString('utf8'),
            package: digest(readFileSync(join(staging.product, 'package.json'))),
            wrapper: digest(readFileSync(join(fixture, 'tui.ts'))),
            environment: env,
            payload: JSON.parse(readFileSync('/payload/input-paths.json', 'utf8')),
            inputs: JSON.parse(readFileSync('/payload/input-integrity.json', 'utf8')),
          });
          const boundSnapshot = (previous) => {
            assertProductPickerDeadline(() => performance.now(), navigationEnd);
            assert.deepEqual(readFixed(), fixed);
            const raw = navigationBridgeIO.readRaw();
            const live = readObservation('composition-live.json');
            assert.ok(live?.live && live.run === run && live.generation === binding.generation);
            assert.deepEqual(live.geometry, captureBinding.geometry);
            assert.deepEqual(live.snapshot, snapshot);
            return {
              raw,
              binding: captureBinding,
              previous,
              hostFrame: readinessFrame,
              now: () => performance.now(),
              deadline: navigationEnd,
            };
          };
          let prePickerFrames;
          pickerEvidence = await compositionNavigationDispatch({
            bridgeIO: {
              ...navigationBridgeIO,
              executionBinding: fixed,
              runtime,
              run,
              setup: binding.generation,
              readExecutionBinding: readFixed,
              pause: () => delay(20),
            },
            ready: (onAdmit) =>
              admitReady(() => {
                prePickerFrames = compositionSourceFrame(transcript.toString()).frames;
                assert.ok(Number.isSafeInteger(prePickerFrames) && prePickerFrames > 0);
                onAdmit();
              }),
            now: () => performance.now(),
            deadline: navigationEnd,
            progress: (stage) =>
              progress(
                {
                  'navigation-readiness': 'rendered-host-and-product-registration',
                  'navigation-initial': 'rendered-product-session-picker',
                  'navigation-moved': 'rendered-product-session-picker',
                  'navigation-identity': 'rendered-product-session-picker',
                  'navigation-dismissal': 'rendered-product-picker-dismissal',
                  'navigation-exit': 'exact-product-PluginCleanup',
                }[stage],
              ),
            awaitUpdate: async (previousFrames) =>
              wait(
                'rendered-product-session-picker',
                () => {
                  const { raw } = boundSnapshot(null);
                  const current = compositionSourceFrame(
                    new TextDecoder('utf-8', { fatal: true }).decode(raw),
                  );
                  assert.equal(current.supported, true);
                  // Identity need not be a picker, but the maintained decoder must
                  // have completed a fresh update before the bridge admits its cells.
                  return current.frames > (previousFrames || prePickerFrames);
                },
                0,
                navigationEnd,
              ),
            awaitDismissal: async (previous) =>
              wait(
                'rendered-product-picker-dismissal',
                () => {
                  const state = boundSnapshot(previous);
                  return productPickerDismissal(state.raw, state.binding, previous, state.hostFrame)
                    .supported;
                },
                0,
                navigationEnd,
              ),
            exitSnapshot: (previous) => {
              const state = boundSnapshot(previous);
              navigationCleanupEnd = cleanupTiming.begin(
                Math.min(15000, Math.max(0, end - Date.now())),
              );
              return state;
            },
            send: (bytes, name) => {
              if (name === 'ctrlG') keys.ctrlG++;
              if (name === 'enter') keys.enter++;
              if (name === 'down') keys.down++;
              if (name === 'escape') keys.escape++;
              if (name === 'exit') {
                cleanupTiming.record('EXIT_KEY');
                keys.exit++;
              }
              child.stdin.write(bytes);
            },
          });
          dismissalAdmitted = true;
          assert.equal(keys.enter, 1);
          assert.equal(
            await readFile('/run/proceed/qualification-private/composition-wire.jsonl', 'utf8'),
            '',
          );
          await h.noWork();
        } else if (pickerCapture) {
          await admitReady(() => {
            keys.ctrlG++;
            child.stdin.write('\x07');
          });
          const pickerEnd =
            readProductPickerClock(() => performance.now()) +
            Math.min(5000, Math.max(0, end - Date.now()));
          const initialLive = readObservation('composition-live.json');
          const snapshot = structuredClone(initialLive.snapshot);
          const captureBinding = {
            ...executionBinding,
            runtime: { version: runtime.version, bun: runtime.bun, node: runtime.node },
            run,
            setup: binding.generation,
            geometry: structuredClone(initialLive.geometry),
          };
          productExitSnapshot = () => {
            assertProductPickerDeadline(() => performance.now(), pickerEnd);
            assert.ok(!exited && !overflow);
            const live = readObservation('composition-live.json');
            assert.ok(live?.live && live.run === run && live.generation === binding.generation);
            assert.deepEqual(live.geometry, captureBinding.geometry);
            assert.deepEqual(live.snapshot, snapshot);
            return {
              raw: Buffer.from(transcript),
              binding: captureBinding,
              previous: pickerEvidence.dismissalBaseline,
              hostFrame: readinessFrame,
              now: () => performance.now(),
              deadline: pickerEnd,
            };
          };
          pickerEvidence = await captureProductPicker({
            selectionProfile: null,
            observe: async (previous) => {
              let observation;
              await wait(
                'rendered-product-session-picker',
                () => {
                  const live = readObservation('composition-live.json');
                  assert.ok(!exited && !overflow && live?.live);
                  assert.equal(live.generation, binding.generation);
                  assert.deepEqual(live.geometry, captureBinding.geometry);
                  assert.deepEqual(live.snapshot, snapshot);
                  observation = productPickerObservation(
                    Buffer.from(transcript),
                    captureBinding,
                    snapshot,
                    previous,
                  );
                  // Unsupported controls stop interpretation, not safe raw capture.
                  if (observation.reason === 'UNSUPPORTED_DECODER') return true;
                  return (
                    observation.supported && (!previous || observation.frames > previous.frames)
                  );
                },
                0,
                pickerEnd,
              );
              return observation;
            },
            moveDown: async () => child.stdin.write('\x1b[B'),
            dismiss: async (previous) => {
              assert.ok(performance.now() < pickerEnd);
              const baseline = productPickerObservation(
                Buffer.from(transcript),
                captureBinding,
                snapshot,
              );
              assert.ok(baseline.supported && baseline.frames >= previous.frames);
              assert.deepEqual(baseline.binding, previous.binding);
              child.stdin.write('\x1b');
              return baseline;
            },
            observeDismissal: async (previous) => {
              let observation;
              await wait(
                'rendered-product-picker-dismissal',
                () => {
                  const live = readObservation('composition-live.json');
                  assert.ok(!exited && !overflow && live?.live);
                  assert.equal(live.run, run);
                  assert.equal(live.generation, binding.generation);
                  assert.deepEqual(live.geometry, captureBinding.geometry);
                  assert.deepEqual(live.snapshot, snapshot);
                  observation = productPickerDismissal(
                    Buffer.from(transcript),
                    captureBinding,
                    previous,
                    readinessFrame,
                  );
                  return observation.supported;
                },
                0,
                pickerEnd,
              );
              return observation;
            },
          });
          assert.equal(keys.enter, 0);
          assert.equal(
            await readFile('/run/proceed/qualification-private/composition-wire.jsonl', 'utf8'),
            '',
          );
          await h.noWork();
        } else {
          assert.equal(integratedScenario, true);
          await wait(
            'integrated-transport-outcomes',
            () => exists(join(evidence, 'runtime-transport.json')),
            Math.max(0, readinessEnd - Date.now()),
          );
          const transport = readObservation('runtime-transport.json');
          await assertIntegratedTransportGate(
            transport,
            [
              ...controls.plan.roles.cases.map((c) => c.id),
              ...controls.plan.product.controls.map((c) => c.id),
              'product-loader-unsafe-files',
            ],
            () => controls.assertObserved(),
          );
          const fixed = structuredClone(executionBinding);
          const live = readObservation('composition-live.json');
          const integratedBinding = {
            ...fixed,
            runtime: { version: runtime.version, bun: runtime.bun, node: runtime.node },
            run,
            setup: runtime.generation,
            geometry: structuredClone(live.geometry),
          };
          const readFixed = () => ({
            ...fixed,
            config: digest(readFileSync(staging.config)),
            configBytes: readFileSync(staging.config).toString('utf8'),
            serviceConfig: digest(readFileSync(serviceConfig)),
            wrapper: digest(readFileSync(join(fixture, 'tui.ts'))),
            package: digest(readFileSync(join(staging.product, 'package.json'))),
            environment: env,
          });
          // Reserve the existing teardown/scan budget inside the original bound.
          const scenarioDeadline = performance.now() + Math.max(0, end - Date.now() - 45000);
          const integratedWait = (label, predicate) => wait(label, predicate, 0, scenarioDeadline);
          let enrollmentFrame;
          await admitReady(() => {
            keys.ctrlE++;
            child.stdin.write('\x05');
          });
          await integratedWait('integrated-enrollment-display', () => {
            const cells = compositionSourceFrame(transcript.toString());
            if (!cells.supported) return false;
            const lines = cells.text.split('\n').map((s) => s.trim());
            if (
              !lines.includes('Operator key fingerprint (this TUI): ' + h.operator.keyId) ||
              !lines.includes('Broker fingerprint: ' + h.proposal.key_id) ||
              !lines.includes('State: enrolled')
            )
              return false;
            assert.deepEqual(readFixed(), fixed);
            assert.deepEqual(
              readObservation('composition-live.json').geometry,
              integratedBinding.geometry,
            );
            enrollmentFrame = {
              raw: Buffer.from(transcript),
              frames: cells.frames,
              screen: cells.generation,
            };
            return true;
          });
          assert.deepEqual(transcript, enrollmentFrame.raw);
          assert.deepEqual(readFixed(), fixed);
          assertProductPickerDeadline(() => performance.now(), scenarioDeadline);
          assert.deepEqual(transcript, enrollmentFrame.raw);
          keys.escape++;
          child.stdin.write('\x1b');
          await integratedWait(
            'integrated-enrollment-display',
            () =>
              productPickerDismissal(
                Buffer.from(transcript),
                integratedBinding,
                {
                  supported: true,
                  binding: integratedBinding,
                  bytes: enrollmentFrame.raw.length,
                  sha256: digest(enrollmentFrame.raw),
                  frames: enrollmentFrame.frames,
                  screen: enrollmentFrame.screen,
                },
                readinessFrame,
              ).supported,
          );
          await h.noWork();
          integratedWire = requestResultWireAdapter(h, {
            scenario: 'request-to-originating-result',
            wait: integratedWait,
          });
          await integratedWire.beginScenario();
          await wait(
            'integrated-capture-armed',
            () => exists('/run/proceed/qualification-private/mcp-armed.json'),
            0,
            scenarioDeadline,
          );
          let first = true;
          const io = {
            ...navigationBridgeIO,
            readLive: () => readObservation('composition-live.json'),
            readExecutionBinding: readFixed,
            readBinding: () => ({
              ...readFixed(),
              runtime: integratedBinding.runtime,
              run,
              setup: runtime.generation,
              geometry: readObservation('composition-live.json').geometry,
            }),
            send: (bytes) => {
              assert.ok(!exited && !closed && !overflow);
              if (bytes === '\x07') keys.ctrlG++;
              if (bytes === '\r' || bytes === 'approved\r') keys.enter++;
              if (bytes === '\x1b[B') keys.down++;
              if (bytes === '\x1b[A') keys.up++;
              if (bytes === '\x1b') keys.escape++;
              child.stdin.write(bytes);
            },
            writeAction: (request) =>
              writeFileSync(
                '/run/proceed/qualification-private/composition-action-' +
                  request.request +
                  '.json',
                JSON.stringify(request),
                { mode: 0o600, flag: 'wx' },
              ),
            readAction: (id) => {
              try {
                return JSON.parse(
                  readFileSync(
                    '/run/proceed/qualification-private/composition-action-result-' + id + '.json',
                    'utf8',
                  ),
                );
              } catch {
                return null;
              }
            },
            pause: () => delay(20),
            hostFrame: () => readinessFrame,
          };
          integratedResult = await compositionIntegratedScenario({
            wire: integratedWire,
            io,
            bridge: compositionPublicNavigationBridge,
            binding: integratedBinding,
            executionBinding: fixed,
            runtime,
            wait: integratedWait,
            now: () => performance.now(),
            deadline: scenarioDeadline,
            ready: async (open) => {
              if (first) {
                first = false;
                await admitReady(open);
              } else open();
            },
          });
          dismissalAdmitted = true;
        }
        const cleanupEnd = navigationOnly
          ? navigationCleanupEnd
          : cleanupTiming.begin(Math.min(15000, Math.max(0, end - Date.now())));
        const ownedExit = () => {
          cleanupTiming.record('EXIT_KEY');
          keys.exit++;
          child.stdin.write('\x03');
        };
        if (pickerCapture) {
          pickerEvidence.dismissal = issueProductPickerExit({
            snapshot: productExitSnapshot,
            exit: ownedExit,
            exitCount: () => keys.exit,
          });
          dismissalAdmitted = true;
        } else if (!navigationOnly) ownedExit();
        await wait(
          'exact-product-PluginCleanup',
          async () => {
            if (!(await exists(join(evidence, 'composition-cleanup.json')))) return false;
            cleanupTiming.record('MARKER_OBSERVED');
            return true;
          },
          0,
          cleanupEnd,
        );
        const cleanupMarker = JSON.parse(
          await readFile(join(evidence, 'composition-cleanup.json'), 'utf8'),
        );
        cleanupObservation = cleanupTiming.value(cleanupMarker);
        assert.equal(cleanupMarker.productCleanup, 'PASS');
        if (integratedScenario)
          assert.deepEqual(readObservation('transport-cleanup.json'), {
            aborted: true,
            timerCleared: true,
          });
        assert.ok(
          cleanupObservation.timely &&
            cleanupObservation.wrapper &&
            cleanupObservation.wrapper.RETURN !== null,
        );
        await wait('actual-host-exit', () => exited);
        if (integratedScenario) await h.verifyCaptureScenario(integratedResult);
        scenarioSucceeded = true;
        return integratedResult;
      } catch (error) {
        errorCode = compositionErrorCode(error);
        // Preserve the last complete loop sample, not reconstructed failure-time
        // operands. No new file reads or substitute decoder may alter its binding.
        failureAt = failureSnapshot({
          lastLoopGuard,
          error,
          phase,
          keys,
          state: {
            ...compositionLastGuardSample(lastGuardState),
            exited,
            overflow,
          },
          now: Date.now(),
          deadline: readinessEnd,
        });
        // Persist the safe failure BEFORE cleanup can stall or be terminated.
        // The final record may add lifecycle observations but cannot replace
        // this frozen failure-time phase, guard or key counts.
        await persistCompositionDiagnostic(diagnosticIO, {
          status: 'FAIL',
          failure: 'COMPOSITION_CONTROL_FAILURE',
          phase,
          errorCode,
          failureAt,
          cleanupObservation: cleanupTiming.value(null),
          keys,
          lifecycle,
          commandEligibility,
          hostExit,
          productCleanup,
          rawScan: scanStatus,
          scanReason,
          elapsed: Date.now() - started,
        });
        throw error;
      } finally {
        // Driver cleanup entry, not a claim that product Cleanup has run.
        recordGuard(
          'CleanupENTRY',
          compositionSnapshot({
            ...compositionLastGuardSample(lastGuardState),
            exited,
            overflow,
            now: Date.now(),
            deadline: readinessEnd,
          }),
        );
        // One exit key only, never a dialog answer or repeated open-command key.
        // A kill below is not evidence of the returned product Cleanup.
        if (child)
          lifecycle = await settleCompositionHost({
            observe: () => ({ exited, closed }),
            exitSent: keys.exit > 0,
            allowExit: !productMode || dismissalAdmitted,
            requestExit: () => {
              cleanupTiming.record('EXIT_KEY');
              keys.exit++;
              child.stdin.write('\x03');
            },
            terminate: (signal) => {
              cleanupTiming.record(signal);
              try {
                process.kill(-child.pid, signal);
              } catch {
                /* absence is checked separately */
              }
            },
            now: Date.now,
            deadline: Math.min(end, Date.now() + 15000),
            pause: () => delay(20),
          });
        hostExit = exited ? 'PASS' : 'UNRUN';
        productCleanup = (await exists(join(evidence, 'composition-cleanup.json')))
          ? 'OBSERVED'
          : 'UNRUN';
        if (productCleanup === 'OBSERVED') cleanupTiming.record('MARKER_OBSERVED');
        const cleanupWrapper =
          readCleanupObservation('composition-cleanup-return.json') ??
          readCleanupObservation('composition-cleanup-entry.json');
        cleanupObservation = cleanupTiming.value(cleanupWrapper);
        renderEvidence = compositionRenderEvidence(
          compositionReadinessFrame(transcript.toString(), productMode),
        );
        // Failure captures stay private unless the SAME complete raw scan passes.
        // Close is not graceful exit. Forced exit is eligible only after actual
        // writer absence and every required input is available and bounded.
        if (child) {
          let scanStage = 'COLLECTION';
          try {
            await controls.close();
            controlsClosed = true;
            if (integratedScenario) await h.finalizeCapture();
            const remainingPids = (await readdir('/proc')).filter(
              (p) => /^\d+$/.test(p) && !priorPids.has(p),
            );
            const complete = closed && stdoutEnded && stderrEnded && remainingPids.length === 0;
            if (productMode) {
              assert.ok(complete);
              if (!integratedScenario)
                assert.ok(navigationOnly ? keys.enter <= 1 : keys.enter === 0);
              let privateCaptureScan;
              const privateInputs = [];
              if (integratedScenario) {
                const root = '/run/proceed/qualification-private/';
                let total = 0;
                const captures = new Map();
                const names = (await readdir(root))
                  .filter((n) =>
                    /^(?:mcp\.jsonl|wrapper\.jsonl|(?:mcp|wrapper)-seal\.json|composition-api-seal\.json|composition-action(?:-result)?-\d+\.json|composition-service-inventory\.json|composition-public-api\.jsonl)$/.test(
                      n,
                    ),
                  )
                  .sort();
                for (const name of names) {
                  const bytes = await productCaptureReadFile({}, root + name, 'api', total);
                  total += bytes.length;
                  captures.set(name, bytes);
                  privateInputs.push({ bytes });
                }
                privateCaptureScan = scanIntegratedPrivateCaptures(
                  {
                    mcp: captures.get('mcp.jsonl'),
                    callbacks: captures.get('wrapper.jsonl'),
                    other: [...captures]
                      .filter(([name]) => !['mcp.jsonl', 'wrapper.jsonl'].includes(name))
                      .map(([, bytes]) => bytes),
                    receipts: admitIntegratedPrivateInventory(captures, {
                      mcp: JSON.parse(captures.get('mcp-seal.json').toString()),
                      callbacks: JSON.parse(captures.get('wrapper-seal.json').toString()),
                      api: JSON.parse(captures.get('composition-api-seal.json').toString()),
                    }),
                    secretLedger: controls,
                    scenarioSuccess: scenarioSucceeded,
                  },
                  requiredSecrets,
                );
              }
              const observations = Buffer.from(
                JSON.stringify({
                  pickerEvidence,
                  integratedResult,
                  privateCaptureScan,
                  cleanupObservation,
                  executionBinding,
                  keys,
                  lifecycle,
                  productCleanup,
                  hostExit,
                }),
              );
              await writeFile(join(evidence, 'composition-observations.json'), observations);
              const { journal, api } = await productCaptureInputs(
                h.state,
                '/run/proceed/qualification-private/composition-wire.jsonl',
                undefined,
                integratedScenario,
              );
              const telegram = Buffer.from(JSON.stringify(h.fixture.calls));
              const brokerDiagnostics = integratedScenario
                ? h.closedBrokerOutput()
                : Buffer.alloc(0);
              const extras = [
                ...[journal, api, telegram, transcript].map((bytes) => ({ bytes })),
                ...(integratedScenario ? [{ bytes: brokerDiagnostics }] : []),
                ...privateInputs,
              ];
              const entries = await collectProductCapture(
                { state: '/run/proceed/host-state', evidence },
                extras,
                requiredSecrets,
                Math.min(end, Date.now() + 30000),
              );
              const logEntries = entries.filter((e) => /\.log(?:$|[.-])/.test(e.path));
              assert.ok(logEntries.length > 0);
              const diagnostics = Buffer.concat([
                ...logEntries.map((e) => e.bytes),
                ...(integratedScenario ? [brokerDiagnostics] : []),
              ]);
              const pluginLines = diagnostics
                .toString('utf8')
                .split('\n')
                .filter(
                  (line) => /component=plugin(?: |$)/.test(line) && /role=cli(?: |$)/.test(line),
                );
              assert.ok(pluginLines.length <= 4096);
              collectionAdmit(
                pluginLines.reduce((n, line) => n + Buffer.byteLength(line) + 1, 0),
                collectionLimits.detail,
              );
              const pluginBytes = Buffer.from(pluginLines.join('\n'));
              if (integratedScenario && scenarioSucceeded) {
                assertPluginInventory(pluginLines, {
                  entries: [
                    { plugin: fixture, entry: join(fixture, 'tui.ts') },
                    { plugin: staging.adversary, entry: join(staging.adversary, 'tui.ts') },
                    { plugin: staging.transport, entry: join(staging.transport, 'tui.ts') },
                  ],
                  complete: true,
                });
                const inventory = JSON.parse(
                  readFileSync(
                    '/run/proceed/qualification-private/composition-service-inventory.json',
                    'utf8',
                  ),
                );
                assertServiceInventory(inventory, {
                  entries: [
                    { plugin: fixture, features: { tui: true, server: false, rpc: false } },
                    ...staging.serviceEntries,
                  ],
                });
              }
              const pty = entries.find((e) => e.path === '/run/proceed/host-state/pty.raw');
              assert.ok(pty);
              const S =
                transcript.length +
                pty.bytes.length +
                telegram.length +
                journal.length +
                diagnostics.length +
                pluginBytes.length +
                api.length +
                entries.reduce((n, e) => n + Buffer.byteLength(e.path) + e.bytes.length, 0);
              collectionAdmit(S, collectionLimits.surfaces);
              const captures = {
                tui: Buffer.concat([transcript, pty.bytes]),
                telegram,
                journal,
                diagnostics,
                evidence: Buffer.concat([
                  ...entries.flatMap((e) => [Buffer.from(e.path), e.bytes]),
                  pluginBytes,
                ]),
                api,
              };
              const details = {
                'composition-observations.json': observations,
                'transcript.ansi': Buffer.from(transcript),
                'plugin-diagnostics.log': pluginBytes,
                'progress.jsonl': entries.find((e) => e.path === join(evidence, 'progress.jsonl'))
                  .bytes,
              };
              scanStage = 'SCAN';
              const frozen = productCaptureExport(
                captures,
                requiredSecrets,
                complete,
                overflow,
                details,
                integratedScenario
                  ? {
                      tui: ['script.stdout:end', 'script.stderr:end', 'host-state/pty.raw'],
                      telegram: ['closed-fixture.calls'],
                      journal: ['closed-broker/journal.log'],
                      diagnostics: [
                        ...logEntries.map((e) => e.path),
                        'closed-broker.stdout:end',
                        'closed-broker.stderr:end',
                      ],
                      evidence: entries.map((e) => e.path),
                      api: [
                        'closed-broker/composition-wire.jsonl',
                        'sealed-mcp',
                        'sealed-wrapper',
                        'sealed-public-api',
                      ],
                    }
                  : undefined,
              );
              scanStage = 'WRITE';
              for (const [file, bytes] of Object.entries(frozen.details))
                await writeFile(join(evidence, file), bytes);
              await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(frozen.scan));
              scanStatus = 'PASS';
              scanReason = 'NONE';
            } else {
              const diagnosticBytes = await logs('/run/proceed/host-state');
              const wirePath = '/run/proceed/qualification-private/composition-wire.jsonl';
              const captures = {
                tui: Buffer.concat([transcript, await readFile('/run/proceed/host-state/pty.raw')]),
                telegram: Buffer.from(JSON.stringify(h.fixture.calls)),
                journal: await readFile(join(h.state, 'journal.log')),
                diagnostics: diagnosticBytes,
                evidence: Buffer.concat([
                  Buffer.from(JSON.stringify(guardJournal.value())),
                  ...(await Promise.all(
                    (await readdir(evidence))
                      .filter((f) => f !== 'scan-pass.json')
                      .map((f) => readFile(join(evidence, f))),
                  )),
                ]),
                // Explicitly created before launch. Absence refuses the full scan.
                api: await readFile(wirePath),
              };
              if (!captures.diagnostics.length) {
                scanStage = 'MISSING';
                throw Error('missing diagnostics');
              }
              const lines = diagnosticBytes
                .toString()
                .split('\n')
                .filter(
                  (line) => /component=plugin(?: |$)/.test(line) && /role=cli(?: |$)/.test(line),
                );
              let inventory;
              try {
                inventory = assertPluginInventory(lines, {
                  plugin: fixture,
                  entry: join(fixture, 'tui.ts'),
                  complete: lines.length <= 4096,
                });
              } catch {
                inventory = { status: 'UNPROVEN' };
              }
              const observations = Buffer.from(
                JSON.stringify({
                  renderedEvidenceSeen: renderEvidence,
                  currentScreen: 'UNPROVEN',
                  commandEligibility,
                  keys,
                  readinessFrame,
                  readinessObservation,
                  productCleanup,
                  hostExit,
                  inventory,
                  guardJournal: guardJournal.value(),
                  failureAt,
                  lifecycle,
                }),
              );
              const pluginBytes = Buffer.from(lines.slice(0, 4096).join('\n'));
              // Freeze the exact detailed exports, complete capture set and secret
              // set before scanning. Never scan an earlier version then export new bytes.
              captures.evidence = Buffer.concat([captures.evidence, observations, pluginBytes]);
              scanStage = 'SCAN';
              const frozen = scanFrozenComposition({
                captures,
                secrets: requiredSecrets,
                complete,
                overflow,
              });
              scanStage = 'WRITE';
              await writeFile(join(evidence, 'composition-observations.json'), observations);
              await writeFile(join(evidence, 'transcript.ansi'), frozen.captures.tui);
              await writeFile(join(evidence, 'plugin-diagnostics.log'), pluginBytes);
              await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(frozen.scan));
              scanStatus = 'PASS';
              scanReason = 'NONE';
            }
          } catch (error) {
            scanStatus = 'REFUSED';
            scanReason = compositionScanReason(error, scanStage);
          }
        }
        if (child) for (const s of [child.stdin, child.stdout, child.stderr]) s.destroy();
        if (!controlsClosed) await controls.close();
        if (scanStatus !== 'PASS')
          throw Object.assign(Error('scan refused'), { code: 'CAPTURE_SCAN_REFUSED' });
      }
    },
    {
      brokerObserver: true,
      captureOnly: !integratedScenario,
      ...(integratedScenario
        ? {
            scenario: 'request-to-originating-result',
            verifyCompletion: (result, status) => integratedWire.verifyCompletion(result, status),
          }
        : {}),
    },
  );
} catch (error) {
  errorCode ??= compositionErrorCode(error);
  failureAt ??= failureSnapshot({
    error,
    phase,
    keys,
    state: { exited, overflow },
    now: Date.now(),
    deadline: readinessEnd,
  });
  failure = 'COMPOSITION_CONTROL_FAILURE';
}
// Only fixed phase and classification may leave without a full raw scan marker.
await persistCompositionDiagnostic(diagnosticIO, {
  status: failure ? 'FAIL' : 'PASS',
  failure,
  phase,
  errorCode,
  failureAt,
  cleanupObservation,
  lifecycle,
  renderedEvidenceSeen: renderEvidence,
  currentScreen: 'UNPROVEN',
  commandEligibility,
  keys,
  hostLoadingInventory: 'UNRUN_WITHOUT_SCANNED_OBSERVATIONS',
  productCleanup,
  hostExit,
  rawScan: scanStatus,
  scanReason,
  elapsed: Date.now() - started,
});
process.exitCode = failure ? 1 : 0;
