// TEST ONLY. Static policy plus offline controls, not GitHub execution proof.
// Contract: npm-distribution non-publishing PR validation, design section 8.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseWorkflow, WorkflowModelError } from './support/workflow-model.mjs';

function unprivileged(text) {
  // Reject even comments mentioning these constructs. False positives require review,
  // not weakening this guard to claim a complete workflow security analysis.
  assert.doesNotMatch(text, /pull_request_target|workflow_run|workflow_call/);
  assert.doesNotMatch(text, /secrets\s*[.\[]|secrets\s*:|inherit\b/i);
  assert.doesNotMatch(text, /id-token\s*:|write-all|:\s*write\b/i);
  assert.doesNotMatch(text, /npm\s+(?:publish|dist-tag)|NPM_TOKEN|NODE_AUTH_TOKEN/i);
  assert.doesNotMatch(text, /release\.yml|environment\s*:|self-hosted/i);
}

test('PR text guard calibration accepts unprivileged excerpt and rejects hazards', () => {
  const safe = 'on: [pull_request]\npermissions:\n  contents: read\njobs: {}\n';
  assert.doesNotThrow(() => unprivileged(safe));
  const hazards = [
    'on: pull_request_target', 'on: workflow_run', 'on: workflow_call',
    '${{ secrets.NPM_TOKEN }}', "${{ secrets['TOKEN'] }}", 'secrets: inherit',
    'id-token: write', 'permissions: write-all', 'packages: write',
    'run: npm publish checked.tgz', 'run: npm dist-tag add x latest',
    'NODE_AUTH_TOKEN: value', 'uses: ./.github/workflows/release.yml',
    'environment: npm-preview', 'runs-on: self-hosted',
  ];
  for (const hazard of hazards) {
    assert.throws(() => unprivileged(`${safe}${hazard}\n`), undefined, hazard);
  }
});

const packCommand = [
  "$npmCli = Join-Path (Split-Path (Get-Command node).Source) 'node_modules/npm/bin/npm-cli.js'",
  "if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm-cli.js not found' }",
  '$env:PROCEED_TEST_NPM_CLI = $npmCli',
  'node tests/release-pack.mjs',
].join('\n');
const commands = [
  'node --version', 'npm ci --ignore-scripts',
  'node --test tests/release-metadata.test.mjs tests/release-ci.test.mjs tests/release-artifact.test.mjs',
  'node node_modules/prettier/bin/prettier.cjs --check .github/workflows/ci.yml',
  'node scripts/build.mjs', packCommand,
];
function validate(text) {
  unprivileged(text);
  const model = parseWorkflow(text);
  assert.deepEqual(model.triggers, ['pull_request']);
  assert.deepEqual({ ...model.topPermissions }, { contents: 'read' });
  assert.equal(model.jobs.length, 1);
  const [job] = model.jobs;
  assert.deepEqual(job.runsOn, ['windows-2025']);
  assert.equal(job.environment, null);
  assert.equal(job.if, null);
  assert.deepEqual({ ...job.permissions }, {});
  const actions = job.steps.filter((step) => step.uses);
  assert.equal(actions.length, 2);
  assert.match(actions[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual({ ...actions[0].with }, { 'persist-credentials': 'false' });
  assert.match(actions[1].uses, /^actions\/setup-node@[a-f0-9]{40}$/);
  assert.deepEqual({ ...actions[1].with }, { 'node-version': '24.22.2' });
  assert.deepEqual(job.steps.slice(0, 2), actions, 'checkout and runtime precede commands');
  assert.deepEqual(job.steps.filter((step) => step.run).map((step) => step.run.trimEnd()), commands);
  assert.ok(job.steps.every((step) => !Object.keys(step.env).length));
}
// A policy-positive specimen, never a checked-in workflow or CI execution.
const specimen = `on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  validate:\n    runs-on: windows-2025\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@${'b'.repeat(40)}\n        with:\n          node-version: 24.22.2\n${commands.map((run) => `      - run: |\n${run.split('\n').map((line) => `          ${line}`).join('\n')}\n`).join('')}`;

test('parsed PR policy calibration rejects alternate execution and privileges', () => {
  assert.doesNotThrow(() => validate(specimen));
  for (const text of [
    specimen.replace('contents: read', 'contents: read\n  packages: read'),
    specimen.replace('pull_request:', 'push:'),
    specimen.replace('windows-2025', 'ubuntu-latest'),
    specimen.replace(`checkout@${'a'.repeat(40)}`, 'checkout@v4'),
    specimen.replace('persist-credentials: false', 'persist-credentials: true'),
    specimen.replace('npm ci --ignore-scripts', 'npm ci'),
    specimen.replace('node scripts/build.mjs', 'node scripts/build.mjs\n          node arbitrary.mjs'),
    specimen.replace('steps:', 'if: false\n    steps:'),
    specimen.replace('timeout-minutes: 15', 'timeout-minutes: 90'),
    specimen.replace('steps:', 'defaults:\n      run:\n        shell: bash\n    steps:'),
    specimen.replace('node --version', 'node --version\n        env:\n          AUTH: value'),
  ]) assert.throws(() => validate(text));
});
test('parser calibration fails closed on unsupported YAML and structure', () => {
  for (const text of [
    'on: [', `${specimen}\n---\na: b`, specimen.replace('contents: read', 'contents: &x read'),
    specimen.replace('contents: read', 'contents: *x'),
    specimen.replace('contents: read', 'contents: !!str read'),
    specimen.replace('contents: read', '<<: x'),
    specimen.replace('pull_request:', 'pull_request: [opened]'),
    specimen.replace('contents: read', 'contents: read\n  contents: read'),
    specimen.replace('contents: read', 'contents: "read"'),
    specimen.replace('pull_request:', 'pull_request: {}'),
  ]) assert.throws(() => parseWorkflow(text));
  assert.throws(() => parseWorkflow('on:\n  pull_request:\n'), WorkflowModelError);
});
test('PR workflow exists and passes parsed and lexical policy', async () => {
  validate(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
});
