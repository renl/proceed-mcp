// TEST ONLY. One normal product command in the actual compiled host, no model.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, symlink, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  withQualificationBroker,
  confirmQualificationEnrollment,
} from './harness-qualification-setup.mjs';
import { transportFixtures, scanRequiredCaptures } from './harness-transport-fixtures.mjs';
import {
  awaitCompositionRender,
  compositionRenderEvidence,
  compositionErrorCode,
  compositionCurrentFrame,
  compositionActivation,
  compositionAdmission,
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
await mkdir(evidence, { recursive: true });
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
  while (Date.now() < deadline) {
    assert.equal(overflow, false, 'capture ceiling');
    if (await predicate()) return;
    await delay(20);
  }
  throw Error('bounded phase failed');
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
        child = spawn('/usr/bin/script', linuxScriptArguments('/run/proceed/host-state/pty.raw'), {
          env,
          cwd: '/run/proceed/host-state/work',
          stdio: ['pipe', 'pipe', 'pipe'],
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
        const readinessEnd = Math.min(end, Date.now() + 60000);
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
          sequence = 0;
        await progress('rendered-host-and-product-registration');
        await awaitCompositionRender({
          observe: async () => {
            const activation = compositionActivation(
              (await logs('/run/proceed/host-state')).toString(),
              origin,
            );
            if (activation && !binding.hostRun) binding.hostRun = activation.run;
            const frame = compositionCurrentFrame(transcript.toString());
            const frameToken = transcript.length;
            const response = readObservation('composition-selector-response.json');
            const live = readObservation('composition-live.json');
            const admitted = compositionAdmission({
              binding,
              activation,
              frame,
              frameToken,
              request,
              response,
              live,
              exited,
              now: Date.now(),
              deadline: readinessEnd,
            });
            if (admitted) readinessObservation = { binding, activation, request, response, live };
            else if (
              activation &&
              compositionRenderEvidence(frame).hostFrameSeen &&
              (!request ||
                request.frameToken !== frameToken ||
                response?.request === request.request)
            ) {
              request = { ...binding, request: ++sequence, frame, frameToken };
              writeFileSync(
                join(evidence, 'composition-selector-request.json'),
                JSON.stringify(request),
              );
            }
            return {
              exited,
              overflow,
              admitted,
              commandEligible: response?.commandEligible === true,
              rendered: compositionRenderEvidence(frame),
            };
          },
          pause: () => delay(20),
          now: Date.now,
          deadline: readinessEnd,
          record: (observed) => {
            renderEvidence = observed;
          },
        });
        // Re-observe invalidation after the async exchange. No await between the
        // final current-frame/live-generation check and this one normal key.
        const activation = compositionActivation(
          (await logs('/run/proceed/host-state')).toString(),
          origin,
        );
        readinessFrame = compositionCurrentFrame(transcript.toString());
        assert.equal(
          compositionAdmission({
            binding,
            activation,
            frame: readinessFrame,
            frameToken: transcript.length,
            request,
            response: readObservation('composition-selector-response.json'),
            live: readObservation('composition-live.json'),
            exited,
            now: Date.now(),
            deadline: readinessEnd,
          }),
          true,
        );
        commandEligibility = 'FRESH_SAME_GENERATION';
        keys.ctrlG++;
        child.stdin.write('\x07');
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
        const captures = {
          tui: Buffer.concat([transcript, await readFile('/run/proceed/host-state/pty.raw')]),
          telegram: Buffer.from(JSON.stringify(h.fixture.calls)),
          journal: await readFile(join(h.state, 'journal.log')),
          diagnostics: await logs('/run/proceed/host-state'),
          evidence: Buffer.concat(
            await Promise.all((await readdir(evidence)).map((f) => readFile(join(evidence, f)))),
          ),
          api: Buffer.from(JSON.stringify(wire)),
        };
        assert.ok(captures.diagnostics.length > 0);
        const scan = scanRequiredCaptures(captures, controls.secrets, Object.keys(captures));
        await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(scan));
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
            scan,
            scope: 'One compiled-host empty pending exchange only',
          }),
        );
      } catch (error) {
        errorCode = compositionErrorCode(error);
        throw error;
      } finally {
        // One exit key only, never a dialog answer or repeated open-command key.
        // A kill below is not evidence of the returned product Cleanup.
        if (child && !closed) {
          if (!exited) {
            keys.exit++;
            child.stdin.write('\x03');
          }
          const cleanupEnd = Math.min(end, Date.now() + 15000);
          while (!closed && Date.now() < cleanupEnd) await delay(20);
        }
        hostExit = exited ? 'PASS' : 'UNRUN';
        productCleanup = (await exists(join(evidence, 'composition-cleanup.json')))
          ? 'OBSERVED'
          : 'UNRUN';
        renderEvidence = compositionRenderEvidence(compositionCurrentFrame(transcript.toString()));
        // Failure captures stay private unless the SAME complete raw scan passes.
        // Require host exit so exported bytes cannot race later terminal writes.
        if (closed && !overflow) {
          try {
            const diagnosticBytes = await logs('/run/proceed/host-state');
            const wirePath = '/run/proceed/qualification-private/composition-wire.jsonl';
            const captures = {
              tui: Buffer.concat([transcript, await readFile('/run/proceed/host-state/pty.raw')]),
              telegram: Buffer.from(JSON.stringify(h.fixture.calls)),
              journal: await readFile(join(h.state, 'journal.log')),
              diagnostics: diagnosticBytes,
              evidence: Buffer.concat(
                await Promise.all(
                  (await readdir(evidence))
                    .filter((f) => f !== 'scan-pass.json')
                    .map((f) => readFile(join(evidence, f))),
                ),
              ),
              // An absent observer file before the first response means zero
              // observed responses, not a successful exchange or helper absence.
              api: (await exists(wirePath)) ? await readFile(wirePath) : Buffer.alloc(0),
            };
            assert.ok(captures.diagnostics.length > 0);
            const scan = scanRequiredCaptures(captures, controls.secrets, Object.keys(captures));
            await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(scan));
            scanStatus = 'PASS';
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
            await writeFile(
              join(evidence, 'composition-observations.json'),
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
              }),
            );
            await writeFile(join(evidence, 'transcript.ansi'), transcript);
            await writeFile(
              join(evidence, 'plugin-diagnostics.log'),
              lines.slice(0, 4096).join('\n'),
            );
          } catch {
            scanStatus = 'REFUSED';
          }
        }
        if (child && !exited) {
          child.stdin.end();
          child.kill('SIGTERM');
        }
        if (child) for (const s of [child.stdin, child.stdout, child.stderr]) s.destroy();
        await controls.close();
      }
    },
    { brokerObserver: true },
  );
} catch (error) {
  errorCode ??= compositionErrorCode(error);
  failure = 'COMPOSITION_CONTROL_FAILURE';
}
// Only fixed phase and classification may leave without a full raw scan marker.
await writeFile(
  join(evidence, 'composition-diagnostic.json'),
  JSON.stringify({
    status: failure ? 'FAIL' : 'PASS',
    failure,
    phase,
    errorCode,
    renderedEvidenceSeen: renderEvidence,
    currentScreen: 'UNPROVEN',
    commandEligibility,
    keys,
    hostLoadingInventory: 'UNRUN_WITHOUT_SCANNED_OBSERVATIONS',
    productCleanup,
    hostExit,
    rawScan: scanStatus,
    elapsed: Date.now() - started,
  }),
);
process.exitCode = failure ? 1 : 0;
