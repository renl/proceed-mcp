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
import { transportFixtures } from './harness-transport-fixtures.mjs';
import {
  waitCompositionPhase,
  failureSnapshot,
  settleCompositionHost,
  scanFrozenComposition,
  persistCompositionDiagnostic,
} from './harness-composition-retention.mjs';
import {
  awaitCompositionKeyAdmission,
  compositionRenderEvidence,
  compositionErrorCode,
  compositionCurrentFrame,
  compositionActivation,
  compositionSnapshot,
  compositionCanRequestFresh,
  compositionGuardJournal,
} from './harness-composition-readiness.mjs';
import { assertPluginInventory } from './harness-plugin-inventory.mjs';
import {
  stageQualification,
  isolatedLinuxEnvironment,
  linuxScriptArguments,
} from './harness-linux-plan.mjs';

const evidence = '/run/proceed/evidence';
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
let productCleanup = 'UNRUN',
  hostExit = 'UNRUN';
let commandEligibility = 'UNRUN';
const keys = { ctrlG: 0, enter: 0, exit: 0 };
let readinessFrame = '';
let readinessObservation;
const guardJournal = compositionGuardJournal();
const recordGuard = (stage, snapshot) => guardJournal.record(stage, snapshot);
let lastGuardState, readGuardFiles, readinessEnd;
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
async function wait(label, predicate, budget = 15000) {
  await progress(label);
  const deadline = Math.min(end, Date.now() + budget);
  await waitCompositionPhase({
    predicate,
    deadline,
    now: Date.now,
    pause: () => delay(20),
    overflow: () => overflow,
  });
}
const plain = (b) =>
  b
    .toString()
    .replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
async function logs(root) {
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
      await symlink(staging.product, join(fixture, 'node_modules/@meshimize/proceed-mcp'));
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
      const controls = await transportFixtures(h);
      const requiredSecrets = Object.freeze(controls.secrets.slice());
      let controlsClosed = false;
      try {
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
        await writeFile(join(evidence, 'composition-binding.json'), JSON.stringify({ run }));
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
          for (const [pattern, reply] of [
            [/\x1b\[6n/g, '\x1b[1;1R'],
            [/\x1b\[\?u/g, '\x1b[?0u'],
            [/\x1b\[c/g, '\x1b[?1;2c'],
            [/\x1b\[>c/g, '\x1b[>0;0;0c'],
            [/\x1b\]10;\?(?:\x07|\x1b\\)/g, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
            [/\x1b\]11;\?(?:\x07|\x1b\\)/g, '\x1b]11;rgb:0000/0000/0000\x1b\\'],
          ])
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
        readGuardFiles = () => ({
          // Cleanup entry does not repeat the asynchronous loader read. Do not
          // present its earlier activation snapshot as current activation.
          activation: null,
          response: readObservation('composition-selector-response.json'),
          responseReadAt: Date.now(),
          live: readObservation('composition-live.json'),
        });
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
            const frame = compositionCurrentFrame(transcript.toString());
            const frameToken = transcript.length;
            const response = readObservation('composition-selector-response.json');
            const responseReadAt = response ? Date.now() : undefined;
            const live = readObservation('composition-live.json');
            lastGuardState = {
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
        await wait(
          'rendered-product-session-picker',
          () =>
            compositionCurrentFrame(transcript.toString()).includes('Select the Proceed session') &&
            compositionCurrentFrame(transcript.toString()).includes('Composition empty exchange') &&
            compositionCurrentFrame(transcript.toString()).includes(runtime.session),
        );
        keys.enter++;
        child.stdin.write('\r');
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
        keys.exit++;
        child.stdin.write('\x03');
        await wait('exact-product-PluginCleanup', () =>
          exists(join(evidence, 'composition-cleanup.json')),
        );
        assert.deepEqual(
          JSON.parse(await readFile(join(evidence, 'composition-cleanup.json'), 'utf8')),
          { productCleanup: 'PASS' },
        );
        await wait('actual-host-exit', () => exited);
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
        // Freeze failure-time operands before Ctrl+C, cleanup files or phase changes.
        failureAt = failureSnapshot({
          error,
          phase,
          keys,
          state: {
            ...lastGuardState,
            ...readGuardFiles?.(),
            frame: compositionCurrentFrame(transcript.toString()),
            frameToken: transcript.length,
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
          keys,
          lifecycle,
          commandEligibility,
          hostExit,
          productCleanup,
          rawScan: scanStatus,
          elapsed: Date.now() - started,
        });
        throw error;
      } finally {
        // Driver cleanup entry, not a claim that product Cleanup has run.
        recordGuard(
          'CleanupENTRY',
          compositionSnapshot({
            ...lastGuardState,
            ...readGuardFiles?.(),
            frame: compositionCurrentFrame(transcript.toString()),
            frameToken: transcript.length,
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
            requestExit: () => {
              keys.exit++;
              child.stdin.write('\x03');
            },
            terminate: (signal) => {
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
        renderEvidence = compositionRenderEvidence(compositionCurrentFrame(transcript.toString()));
        // Failure captures stay private unless the SAME complete raw scan passes.
        // Close is not graceful exit. Forced exit is eligible only after actual
        // writer absence and every required input is available and bounded.
        if (child) {
          try {
            await controls.close();
            controlsClosed = true;
            const remainingPids = (await readdir('/proc')).filter(
              (p) => /^\d+$/.test(p) && !priorPids.has(p),
            );
            const complete = closed && remainingPids.length === 0;
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
            assert.ok(captures.diagnostics.length > 0);
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
            const frozen = scanFrozenComposition({
              captures,
              secrets: requiredSecrets,
              complete,
              overflow,
            });
            await writeFile(join(evidence, 'composition-observations.json'), observations);
            await writeFile(join(evidence, 'transcript.ansi'), frozen.captures.tui);
            await writeFile(join(evidence, 'plugin-diagnostics.log'), pluginBytes);
            await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(frozen.scan));
            scanStatus = 'PASS';
          } catch {
            scanStatus = 'REFUSED';
          }
        }
        if (child) for (const s of [child.stdin, child.stdout, child.stderr]) s.destroy();
        if (!controlsClosed) await controls.close();
        if (scanStatus !== 'PASS')
          throw Object.assign(Error('scan refused'), { code: 'CAPTURE_SCAN_REFUSED' });
      }
    },
    { brokerObserver: true },
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
  lifecycle,
  renderedEvidenceSeen: renderEvidence,
  currentScreen: 'UNPROVEN',
  commandEligibility,
  keys,
  hostLoadingInventory: 'UNRUN_WITHOUT_SCANNED_OBSERVATIONS',
  productCleanup,
  hostExit,
  rawScan: scanStatus,
  elapsed: Date.now() - started,
});
process.exitCode = failure ? 1 : 0;
