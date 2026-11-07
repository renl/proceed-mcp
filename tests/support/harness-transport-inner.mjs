// TEST ONLY. W1/W2 setup composed with ONE actual embedded-runtime W3 execution.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, symlink, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { networkInterfaces } from 'node:os';
import {
  withQualificationBroker,
  confirmQualificationEnrollment,
} from './harness-qualification-setup.mjs';
import { transportFixtures, scanRequiredCaptures } from './harness-transport-fixtures.mjs';
import { diagnosticExport } from './harness-runtime-transport.mjs';
import {
  stageQualification,
  isolatedLinuxEnvironment,
  linuxScriptArguments,
} from './harness-linux-plan.mjs';

const evidence = '/run/proceed/evidence';
const firstOnly = process.argv[2] === '--first-exchange-only';
const end = Date.now() + 210000;
await mkdir(evidence, { recursive: true });
const progress = (phase) =>
  appendFile(join(evidence, 'progress.jsonl'), `${JSON.stringify({ phase })}\n`);
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const wait = async (label, check, ms = 15000) => {
  await progress(label);
  const deadline = Math.min(end, Date.now() + ms);
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw Error(`Deadline: ${label}`);
};
async function rawLogs(root) {
  const chunks = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = join(root, e.name);
    if (e.isDirectory()) chunks.push(await rawLogs(path));
    else if (/\.log(?:[.-].*)?$/.test(e.name)) chunks.push(await readFile(path));
  }
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length < 4194304, 'complete diagnostic capture bound');
  return bytes;
}
let failure, controls;
try {
  await wait('await-inspected-policy', () => exists('/run/proceed-authorized'));
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
  for (const name of ['bin', 'src', 'tests']) await symlink(`/payload/${name}`, join(work, name));
  process.chdir(work);
  process.env.PROCEED_TEST_FIXTURES = '/run/proceed/managed-fixtures';
  process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE = '1';
  await withQualificationBroker(async (h) => {
    await progress('fixture-only-enrollment-not-human-proof');
    await confirmQualificationEnrollment(h, h.operator, h.proposal, {
      local: h.operator.keyId,
      broker: h.proposal.key_id,
    });
    const env = isolatedLinuxEnvironment('/run/proceed/host-state');
    for (const value of new Set(Object.values(env).filter((v) => v.startsWith('/run/'))))
      await mkdir(value, { recursive: true });
    await mkdir(join('/run/proceed/host-state', 'work'));
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
    // W3 only: do not activate product dialogs, adversary or shared MCP/W4.
    // The production key loader and operator client execute inside this real TUI.
    await writeFile(
      staging.config,
      JSON.stringify({
        plugins: [
          {
            package: staging.transport,
            options: {
              cases_file: '/run/proceed/qualification-private/cases.json',
              evidence_directory: evidence,
              first_exchange_only: firstOnly,
            },
          },
        ],
      }),
    );
    const fixture = await transportFixtures(h);
    let child,
      exited = false,
      transcript = Buffer.alloc(0),
      overflow = false;
    try {
      await writeFile(
        '/run/proceed/qualification-private/cases.json',
        JSON.stringify(fixture.plan),
        { mode: 0o600 },
      );
      await progress('actual-opencode-transport-start');
      child = spawn('/usr/bin/script', linuxScriptArguments('/run/proceed/host-state/pty.raw'), {
        cwd: '/run/proceed/host-state/work',
        env: {
          ...env,
          HTTP_PROXY: fixture.proxy,
          HTTPS_PROXY: fixture.proxy,
          ALL_PROXY: fixture.proxy,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.on('exit', () => {
        exited = true;
      });
      child.on('error', () => {
        overflow = true;
      });
      child.stdin.on('error', () => {});
      let pending = '';
      const capture = (bytes) => {
        if (transcript.length + bytes.length > 1048576) {
          overflow = true;
          return;
        }
        transcript = Buffer.concat([transcript, bytes]);
      };
      child.stdout.on('data', (bytes) => {
        capture(bytes);
        const input = pending + bytes.toString('utf8');
        let consumed = 0;
        for (const [pattern, response] of [
          [/\x1b\[6n/g, '\x1b[1;1R'],
          [/\x1b\[\?u/g, '\x1b[?0u'],
          [/\x1b\[c/g, '\x1b[?1;2c'],
          [/\x1b\[>c/g, '\x1b[>0;0;0c'],
          [/\x1b\]10;\?(?:\x07|\x1b\\)/g, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
          [/\x1b\]11;\?(?:\x07|\x1b\\)/g, '\x1b]11;rgb:0000/0000/0000\x1b\\'],
        ])
          for (const match of input.matchAll(pattern)) {
            if (!exited) child.stdin.write(response);
            consumed = Math.max(consumed, match.index + match[0].length);
          }
        const tail = input.slice(consumed);
        const last = tail.lastIndexOf('\x1b');
        pending = last >= 0 && tail.length - last < 32 ? tail.slice(last) : '';
      });
      child.stderr.on('data', capture);
      await wait(
        'embedded-transport-outcomes',
        async () => {
          assert.equal(overflow, false, 'complete bounded PTY capture');
          assert.equal(exited, false, 'actual TUI exited before transport outcomes');
          return exists(join(evidence, 'runtime-transport.json'));
        },
        60000,
      );
      const runtime = JSON.parse(await readFile(join(evidence, 'runtime-transport.json'), 'utf8'));
      // Strict allowlist plus actual run-secret exclusion before a separate export.
      // Full raw evidence remains private and still requires scan-pass.json.
      const diagnostic = diagnosticExport(runtime.diagnostic, fixture.secrets);
      await writeFile(join(evidence, 'diagnostic-export.json'), diagnostic, { mode: 0o600 });
      assert.notEqual(runtime.status, 'FAIL', 'W3 embedded control failed - see safe diagnostic');
      assert.equal(runtime.observations.length, firstOnly ? 1 : 18);
      if (firstOnly) {
        await h.noWork();
        await progress('graceful-transport-fixture-cleanup');
        child.stdin.write('\x03');
        await wait('observed-fixture-Cleanup', () =>
          exists(join(evidence, 'transport-cleanup.json')),
        );
        assert.deepEqual(
          JSON.parse(await readFile(join(evidence, 'transport-cleanup.json'), 'utf8')),
          { aborted: true, timerCleared: true },
        );
        await wait('actual-tui-exit', () => exited);
        controls = { diagnostic, scope: 'first enrolled exchange only - later W3 controls UNRUN' };
        return;
      }
      const wire = await fixture.assertObserved();
      await h.noWork();
      await progress('graceful-transport-fixture-cleanup');
      child.stdin.write('\x03');
      await wait('observed-fixture-Cleanup', () =>
        exists(join(evidence, 'transport-cleanup.json')),
      );
      const cleanup = JSON.parse(await readFile(join(evidence, 'transport-cleanup.json'), 'utf8'));
      assert.deepEqual(cleanup, { aborted: true, timerCleared: true });
      await wait('actual-tui-exit', () => exited);
      const captures = {
        tui: Buffer.concat([transcript, await readFile('/run/proceed/host-state/pty.raw')]),
        telegram: Buffer.from(JSON.stringify(h.fixture.calls)),
        journal: await readFile(join(h.state, 'journal.log')),
        diagnostics: await rawLogs('/run/proceed/host-state'),
        evidence: Buffer.concat(
          await Promise.all((await readdir(evidence)).map((f) => readFile(join(evidence, f)))),
        ),
      };
      assert.ok(captures.diagnostics.length > 0, 'runtime diagnostics capture required');
      const scan = scanRequiredCaptures(captures, fixture.secrets, [
        'tui',
        'telegram',
        'journal',
        'diagnostics',
        'evidence',
      ]);
      // Export only after FULL raw scan. No redaction can turn a failure into PASS.
      controls = {
        runtime,
        wire,
        scan,
        fixtureCleanup: cleanup,
        productPluginCleanup: 'UNRUN - W4/W5',
        runtimeInventory: 'UNRUN - W4',
        mcpCapture: 'UNRUN - no MCP adapter started in W3',
        scope:
          'Linux embedded product-loader/operator-client capability, synthetic enrollment only',
      };
      await writeFile(join(evidence, 'transport-summary.json'), JSON.stringify(controls));
      await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(scan));
    } finally {
      // Complete bounded failed PTY bytes stay container-owned until destruction.
      // No export path for this file exists, including on diagnostic-only success.
      try {
        await writeFile(
          '/run/proceed/qualification-private/transport-pty-capture.raw',
          transcript,
          { mode: 0o600 },
        );
      } finally {
        if (child && !exited) {
          child.stdin.end();
          child.kill('SIGTERM');
        }
        if (child) for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
        await fixture.close();
      }
    }
  });
} catch (error) {
  // Fixed diagnostic prefix only. Raw assertions and fixture state never export.
  failure = 'W3_CONTROL_FAILURE';
}
await writeFile(
  join(evidence, 'result.json'),
  JSON.stringify({
    status: failure ? 'FAIL' : 'PASS',
    failure,
    controls: failure ? undefined : controls,
    cleanup: 'outer exact namespace destruction required',
  }),
);
process.exitCode = failure ? 1 : 0;
