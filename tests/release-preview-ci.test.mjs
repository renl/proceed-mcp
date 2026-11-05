// TEST ONLY. Required non-publishing preview policy, not actual GitHub execution.
// Contract: npm-distribution PR validation and design section 8.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseWorkflow, WorkflowModelError } from './support/workflow-model.mjs';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as prettier from 'prettier';

function unprivileged(text) {
  // Conservative even in comments. A false positive requires review.
  assert.doesNotMatch(text, /pull_request_target|workflow_run|workflow_call/);
  assert.doesNotMatch(text, /secrets\s*[.\[]|secrets\s*:|inherit\b/i);
  assert.doesNotMatch(text, /id-token\s*:|write-all|:\s*write\b/i);
  assert.doesNotMatch(text, /npm\s+(?:publish|dist-tag)|NPM_TOKEN|NODE_AUTH_TOKEN/i);
  assert.doesNotMatch(text, /release\.yml|environment\s*:|self-hosted/i);
}

test('PR text guard calibration accepts unprivileged excerpt and rejects hazards', () => {
  const safe = 'on: [pull_request]\npermissions:\n  contents: read\njobs: {}\n';
  assert.doesNotThrow(() => unprivileged(safe));
  for (const hazard of [
    'on: pull_request_target', 'on: workflow_run', 'on: workflow_call',
    '${{ secrets.NPM_TOKEN }}', "${{ secrets['TOKEN'] }}", 'secrets: inherit',
    'id-token: write', 'permissions: write-all', 'packages: write',
    'run: npm publish checked.tgz', 'run: npm dist-tag add x latest',
    'NODE_AUTH_TOKEN: value', 'uses: ./.github/workflows/release.yml',
    'environment: npm-preview', 'runs-on: self-hosted',
  ]) assert.throws(() => unprivileged(`${safe}${hazard}\n`), undefined, hazard);
});

// Also consumed by the preserved follow-up workflow specimen. No production import.
export const packCommand = [
  "$npmCli = Join-Path (Split-Path (Get-Command node).Source) 'node_modules/npm/bin/npm-cli.js'",
  "if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm-cli.js not found' }",
  '$env:PROCEED_TEST_NPM_CLI = $npmCli',
  'node tests/release-pack.mjs',
].join('\n');
const commands = [
  'node --version', 'npm ci --ignore-scripts',
  'node --test tests/release-metadata.test.mjs tests/release-preview-ci.test.mjs tests/release-artifact.test.mjs',
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
  // The existing release-mode projection exposes shell/deadline without helper changes.
  const [detailed] = parseWorkflow(text, { release: true }).jobs;
  assert.equal(detailed.steps.at(-1).shell, 'pwsh');
  assert.equal(detailed.steps.at(-1).timeout, '5');
}
const specimen = `on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  validate:\n    runs-on: windows-2025\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@${'b'.repeat(40)}\n        with:\n          node-version: 24.22.2\n${commands.map((run, index) => `      - ${index === commands.length - 1 ? 'shell: pwsh\n        timeout-minutes: 5\n        ' : ''}run: |\n${run.split('\n').map((line) => `          ${line}`).join('\n')}\n`).join('')}`;

test('parsed PR policy calibration rejects alternate execution and privileges', () => {
  assert.doesNotThrow(() => validate(specimen));
  for (const [before, after] of [
    ['contents: read', 'contents: read\n  packages: read'],
    ['pull_request:', 'push:'], ['windows-2025', 'ubuntu-latest'],
    [`checkout@${'a'.repeat(40)}`, 'checkout@v4'],
    ['persist-credentials: false', 'persist-credentials: true'],
    ['npm ci --ignore-scripts', 'npm ci'],
    ['tests/release-preview-ci.test.mjs', 'tests/release-ci.test.mjs'],
    ['node scripts/build.mjs', 'node scripts/build.mjs\n          node arbitrary.mjs'],
    ['steps:', 'if: false\n    steps:'], ['timeout-minutes: 15', 'timeout-minutes: 90'],
    ['steps:', 'defaults:\n      run:\n        shell: bash\n    steps:'],
    ['node --version', 'node --version\n        env:\n          AUTH: value'],
    ['      - shell: pwsh\n        timeout-minutes: 5\n        run:', '      - timeout-minutes: 5\n        run:'],
    ['        timeout-minutes: 5\n', ''],
  ]) {
    const changed = specimen.replace(before, after);
    assert.notEqual(changed, specimen, before);
    assert.throws(() => validate(changed), undefined, before);
  }
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
test('preview command selection calibration reaches actual-file policy after exact replacement', async () => {
  const actual = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const corrected = actual.replace('tests/release-ci.test.mjs', 'tests/release-preview-ci.test.mjs');
  // Works both before and after correction, never substitutes for the real-file test.
  assert.ok(actual.includes('tests/release-ci.test.mjs') || actual.includes('tests/release-preview-ci.test.mjs'));
  validate(corrected);
});

// PREVIEW-CI-EOL-001: real Git checkout, not a textual rule-presence proxy.
// Git semantics: https://git-scm.com/docs/gitattributes (text and eol).
async function checkoutWorkflow(attributes) {
  const root = resolve('.');
  const parent = resolve('.scratch/preview-ci-eol');
  await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(join(parent, 'checkout-'));
  try {
    await mkdir(join(fixture, '.github/workflows'), { recursive: true });
    await mkdir(join(fixture, 'empty-template'));
    await writeFile(join(fixture, 'empty-config'), '');
    const git = (...args) => {
      const result = spawnSync('git', ['-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false',
        '-c', `core.attributesFile=${join(fixture, 'empty-config')}`, ...args], {
        cwd: fixture, encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: join(fixture, 'empty-config') },
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    };
    git('init', '--quiet', '--template=empty-template');
    // Model the LF blob, regardless of the caller's current checkout convention.
    const source = (await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')).replace(/\r\n/g, '\n');
    const workflow = join(fixture, '.github/workflows/ci.yml');
    await writeFile(workflow, source);
    if (attributes) await writeFile(join(fixture, '.gitattributes'), attributes);
    git('add', '--', '.github/workflows/ci.yml', ...(attributes ? ['.gitattributes'] : []));
    await rm(workflow);
    git('checkout-index', '--', '.github/workflows/ci.yml');
    const checkedOut = await readFile(workflow, 'utf8');
    const options = JSON.parse(await readFile(join(root, '.prettierrc.json'), 'utf8'));
    return { crlf: checkedOut.includes('\r\n'),
      formatted: await prettier.check(checkedOut, { ...options, filepath: workflow }) };
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await assert.rejects(access(fixture), { code: 'ENOENT' });
  }
}

test('workflow checkout calibration distinguishes absent, wrong and LF attributes', { timeout: 60_000 }, async () => {
  for (const attributes of ['', '.github/workflows/*.yml text eol=crlf\n',
    '.github/workflows/*.yaml text eol=lf\n']) {
    assert.deepEqual(await checkoutWorkflow(attributes), { crlf: true, formatted: false });
  }
  assert.deepEqual(await checkoutWorkflow('.github/workflows/*.yml text eol=lf\n'),
    { crlf: false, formatted: true });
});

test('repository attributes keep CI checkout LF and formatted with autocrlf=true', { timeout: 30_000 }, async () => {
  const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8')
    .catch((error) => { if (error.code === 'ENOENT') return ''; throw error; });
  assert.deepEqual(await checkoutWorkflow(attributes), { crlf: false, formatted: true });
});
