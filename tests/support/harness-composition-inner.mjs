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
} from './harness-composition-readiness.mjs';
import { assertPluginInventory } from './harness-plugin-inventory.mjs';
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
  isolatedLinuxEnvironment,
  linuxScriptArguments,
} from './harness-linux-plan.mjs';

// STATIC ONLY. Public readers and stage-specific recorder inputs are injected.
// This function is deliberately not installed in the real runtime branch.
export function compositionNavigationSelection({
  intendedSession,
  readSession,
  pickerEnter,
  openQuestion,
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
        assert.deepEqual(live.snapshot[1], intended);
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
    });
    return Object.freeze({
      initial: () => observer.initial(),
      moveDown: () => observer.moveDown(),
      moved: () => observer.moved(),
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
// observations. This does not enable the closed real navigation branch below.
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
    (process.argv.length === 3 && process.argv[2] === '--product-picker-capture'),
);
const pickerCapture = process.argv[2] === '--product-picker-capture';
let pickerEvidence, executionBinding;
let dismissalAdmitted = false;
let productExitSnapshot;
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
  overflow = false;
let transcript = Buffer.alloc(0);
let errorCode,
  renderEvidence,
  scanStatus = 'UNRUN';
let scanReason = 'UNRUN';
let productCleanup = 'UNRUN',
  hostExit = 'UNRUN';
let commandEligibility = 'UNRUN';
const keys = { ctrlG: 0, enter: 0, exit: 0 };
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
  if (pickerCapture) {
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
      if (pickerCapture)
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
      await writeFile(
        staging.config,
        JSON.stringify({ plugins: [{ package: fixture, options: staging.options }] }),
      );
      if (pickerCapture) {
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
      const controls = await transportFixtures(h);
      let requiredSecrets;
      let controlsClosed = false;
      try {
        requiredSecrets = freezeTransportSecrets(controls);
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
          JSON.stringify({ run, captureOnly: pickerCapture }),
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
        let request,
          requestWrittenAt,
          sequence = 0;
        await progress('rendered-host-and-product-registration');
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
            const frame = compositionReadinessFrame(transcript.toString(), pickerCapture);
            const frameToken = transcript.length;
            const response = readObservation('composition-selector-response.json');
            const responseReadAt = response ? Date.now() : undefined;
            const live = readObservation('composition-live.json');
            lastGuardState = {
              provenance: {
                observer: pickerCapture ? 'SOURCE_LAYOUT' : 'UNSTYLED',
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
            keys.ctrlG++;
            child.stdin.write('\x07');
          },
        });
        if (pickerCapture) {
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
          // STATIC-ONLY: no historical capture/profile or injected-IO PASS can
          // authorize real navigation. Fresh runtime/input authority and review
          // of the compositionNavigationObserver bindings are separate gates.
          assert.fail('product navigation requires separate runtime/input authority');
          await wait('rendered-product-empty-result', () =>
            compositionCurrentFrame(transcript.toString()).includes(
              'selected session has no pending question',
            ),
          );
          const wire = JSON.parse(
            '[' +
              (await readFile('/run/proceed/qualification-private/composition-wire.jsonl', 'utf8'))
                .trim()
                .split('\n')
                .join(',') +
              ']',
          );
          const admitted = wire.filter((v) => v.status === 200);
          assert.equal(wire.filter((v) => v.path === '/v1/harness/decisions').length, 0);
          assert.equal(admitted.length, 1);
          const actual = admitted[0];
          assert.equal(actual.method, 'POST');
          assert.deepEqual(actual.body, { schema_version: 1, presentation: null });
          assert.equal(actual.cipher.name, 'PSK-AES256-GCM-SHA384');
          assert.equal(actual.helpers.length, 1);
          const helper = actual.helpers[0];
          assert.equal(helper.executable, '/usr/local/bin/node');
          assert.equal(
            execFileSync(helper.executable, ['--version'], {
              env,
              timeout: 5000,
              encoding: 'utf8',
            }).trim(),
            'v24.22.2',
          );
          assert.equal(helper.argv.length, 2);
          assert.equal(helper.argv[1], join(staging.product, 'src/harness/operator-helper.js'));
          for (const fd of [helper.fd3, helper.fd4]) assert.match(fd, /^(socket|pipe):\[\d+\]$/);
          await wait('physical-helper-absence', async () => !(await exists('/proc/' + helper.pid)));
          await h.noWork();
        }
        const cleanupEnd = cleanupTiming.begin(Math.min(15000, Math.max(0, end - Date.now())));
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
        } else ownedExit();
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
        assert.ok(
          cleanupObservation.timely &&
            cleanupObservation.wrapper &&
            cleanupObservation.wrapper.RETURN !== null,
        );
        await wait('actual-host-exit', () => exited);
        if (!pickerCapture)
          await writeFile(
            join(evidence, 'composition-summary.json'),
            JSON.stringify({
              status: 'PASS',
              runtime,
              helperNode: process.version,
              response: actual.body,
              statusCode: actual.status,
              cipher: actual.cipher.name,
              privateDescriptors: 'PASS',
              helperAbsence: 'PASS',
              productCleanup: 'PASS',
              zeroWork: 'PASS',
              scope: 'One compiled-host empty pending exchange only',
            }),
          );
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
            allowExit: !pickerCapture || dismissalAdmitted,
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
          compositionReadinessFrame(transcript.toString(), pickerCapture),
        );
        // Failure captures stay private unless the SAME complete raw scan passes.
        // Close is not graceful exit. Forced exit is eligible only after actual
        // writer absence and every required input is available and bounded.
        if (child) {
          let scanStage = 'COLLECTION';
          try {
            await controls.close();
            controlsClosed = true;
            const remainingPids = (await readdir('/proc')).filter(
              (p) => /^\d+$/.test(p) && !priorPids.has(p),
            );
            const complete = closed && remainingPids.length === 0;
            if (pickerCapture) {
              assert.ok(complete && productCleanup === 'OBSERVED');
              assert.equal(keys.enter, 0);
              const observations = Buffer.from(
                JSON.stringify({
                  pickerEvidence,
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
              );
              const telegram = Buffer.from(JSON.stringify(h.fixture.calls));
              const extras = [journal, api, telegram, transcript].map((bytes) => ({ bytes }));
              const entries = await collectProductCapture(
                { state: '/run/proceed/host-state', evidence },
                extras,
                requiredSecrets,
                Math.min(end, Date.now() + 30000),
              );
              const logEntries = entries.filter((e) => /\.log(?:$|[.-])/.test(e.path));
              assert.ok(logEntries.length > 0);
              const diagnostics = Buffer.concat(logEntries.map((e) => e.bytes));
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
    { brokerObserver: true, captureOnly: pickerCapture },
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
