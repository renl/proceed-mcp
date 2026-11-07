// TEST ONLY. Windows remains NO-LAUNCH. Linux uses the isolated maintained lifecycle.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pins, hostBudgets, launchBlockers } from './support/harness-host-plan.mjs';

if (process.argv[2] === '--qualification-preflight') {
  assert.equal(process.argv.length, 3);
  // Always NO-LAUNCH. Source presence cannot establish runtime qualification.
  console.log(
    JSON.stringify(
      {
        mode: 'QUALIFICATION-NO-LAUNCH',
        runtime: 'UNRUN',
        cleanup: 'NOT APPLICABLE - no resources started',
        blocked: [
          'Pin and review the genuine production TUI checkpoint, protected loading, adapter and package identity. Concurrent inputs are not qualified',
          'Compose synthetic broker/transport fixtures and product/adversary entries in the existing contained lifecycle after source handoff',
          'Bind actual ordinary RPC/helper targets and programmatic command dispatch to the implemented entry, without decision test APIs',
          'Compose the approved public command.transform -> registered Tool.Info.execute fixture and arm transparent shared MCP capture before invocation. Normal permission refusal is a stop, not a bypass',
          'Next actual platform/runtime execution needs coordination authorization after combined affected boundary review',
        ],
        invocationScope: 'Registered-wrapper only. No provider/model access or spend',
        excludedProof: [
          'normal assistant tool selection/sequencing',
          'snapshot filtering, tool hooks, input decoding, output normalization',
          'direct/Code Mode outer execution',
          'result insertion into an assistant conversation, real assistant identities, subsequent model behavior',
          'installed public first use, live Telegram, full feature',
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
} else if (['--linux-preflight', '--linux-run'].includes(process.argv[2])) {
  assert.equal(process.argv.length, 3);
  const { runLinuxHost } = await import('./support/harness-linux-runner.mjs');
  await runLinuxHost(process.argv[2] === '--linux-preflight');
} else {
  assert.deepEqual(
    process.argv.slice(2),
    ['--preflight'],
    'Only --preflight is implemented. No host launch.',
  );
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const checks = [];
  for (const name of ['plugin', 'client']) {
    const dependency = `@opencode/${name}`;
    let installed = null;
    try {
      installed = JSON.parse(
        await readFile(new URL(`node_modules/${dependency}/package.json`, root), 'utf8'),
      ).version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    checks.push({
      check: dependency,
      required: pins[name],
      declared: manifest.devDependencies?.[dependency] ?? null,
      installed,
      status:
        manifest.devDependencies?.[dependency] === pins[name] && installed === pins[name]
          ? 'PASS'
          : 'BLOCKED',
    });
  }
  // Public wildcard export. Do not import the barrel's optional UI peers or copy SDK
  // code into staging. This checks define only, not host loading or full types.
  try {
    const Plugin = await import('@opencode/plugin/tui/plugin');
    const marker = {};
    assert.equal(Plugin.define(marker), marker);
    checks.push({ check: 'public-plugin-define-export', status: 'PASS' });
  } catch (error) {
    checks.push({
      check: 'public-plugin-define-export',
      status: 'BLOCKED',
      error: error.code ?? error.name,
    });
  }
  console.log(
    JSON.stringify(
      {
        phase: 'prerequisites',
        mode: 'NO-LAUNCH',
        fixture: fileURLToPath(new URL('tests/fixtures/harness-platform/tui.ts', root)),
        checks,
        budgets: hostBudgets,
        launchBlockers,
        runtime: 'UNRUN',
        cleanup: 'NOT APPLICABLE - no resources started',
        remaining: [
          'Actual host loading and SDK type compatibility (not inferred from define import)',
          'Run-root staging and isolated Windows config validation',
          'Observed empty SQLiteCredentialTable and no legacy import/config/user-plugin loading',
          'Enforced/observed no external network',
          'MSYS PTY native-console compatibility',
          'Owned descendant tracking/termination and absence verification',
          'Aggregate lifecycle with persisted progress and reachable inner deadlines',
        ],
      },
      null,
      2,
    ),
  );
  // Exit 2 remains BLOCKED even with installed SDKs: a plan is not a managed live runner.
  process.exitCode = 2;
}
