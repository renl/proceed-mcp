// TEST ONLY. Explicit deferred automation suite, not required first-preview CI.
// Run: node --test tests/release-ci.test.mjs tests/release-artifact.test.mjs
// Preserves accepted core and unmet collector/CLI/workflow assertions. No live authority.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseWorkflow } from './support/workflow-model.mjs';
import { packCommand } from './release-preview-ci.test.mjs';
import { releaseFacts, withReleaseFixture } from './support/release-policy-fixture.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, access, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Dynamic import preserves independent B1 calibration while the B2 source is RED.
const policy = () => import('../scripts/release-policy.mjs');
const core = () => import('../scripts/release-policy-core.mjs');
const facadeNames = ['APPROVED', 'VERSION_PATTERN', 'RELEASE_POLICY_SCHEMA_VERSION',
  'PACKED_INPUT_DIGEST_ALGORITHM', 'ReleasePolicyError', 'expectedTarballName',
  'readAcceptanceRecord', 'readConfigurationRecord', 'evaluateRelease', 'computePackedInputs'];
for (const [stage, leaves, names] of [
  ['foundation', ['schema', 'records'], facadeNames.slice(0, 8)],
  ['evaluator', ['schema', 'records', 'evaluator'], facadeNames.slice(0, 9)],
  ['digest', ['schema', 'records', 'evaluator', 'digest'], facadeNames],
]) test(`B2 facade ${stage}: introduced bindings preserve leaf identity`, async () => {
  const api = await core();
  const modules = await Promise.all(leaves.map((leaf) => import(`../scripts/release-policy-${leaf}.mjs`)));
  for (const name of names) {
    const owner = modules.find((module) => Object.hasOwn(module, name));
    assert.ok(owner, `${name} has a leaf owner`);
    assert.equal(api[name], owner[name], name);
  }
  if (stage === 'digest') assert.deepEqual(Object.keys(api).sort(), [...facadeNames].sort());
});
function verdict(api, facts, codes = []) {
  const blockers = codes.map((code) => ({ code, scope: /^(CHECK_|CONFIGURATION_|ARTIFACT_|PACKED_INPUTS_)/.test(code)
    ? 'publication' : 'validation' })).sort((a, b) => a.code.localeCompare(b.code));
  assert.deepEqual(api.evaluateRelease(facts), { phase: facts.phase,
    decision: codes.length ? 'blocked' : 'policy-pass', blockers, authorization: 'not-assessed' });
}
const set = (facts, path, value) => {
  const parts = path.split('.');
  const key = parts.pop();
  parts.reduce((object, part) => object[part], facts)[key] = value;
};
test('B2 policy: explicit phase scope, bootstrap refusal, exact fail-closed matrix', async () => {
  const api = await core();
  assert.equal(api.RELEASE_POLICY_SCHEMA_VERSION, 2);
  assert.equal(api.PACKED_INPUT_DIGEST_ALGORITHM, 'sha256-packed-inputs-v1');
  assert.deepEqual(api.APPROVED, { repository: 'renl/proceed-mcp', packageName: '@meshimize/proceed-mcp',
    registryName: 'io.github.renl/proceed-mcp', channel: 'preview', environment: 'npm-preview',
    workflow: '.github/workflows/release.yml', bootstrapVersion: '0.1.0-preview.1' });
  assert.ok(Object.isFrozen(api.APPROVED));
  assert.equal(api.VERSION_PATTERN.source, '^\\d+\\.\\d+\\.\\d+-preview\\.\\d+$');
  assert.throws(() => api.expectedTarballName(null, '0.1.0-preview.2'),
    (error) => error instanceof api.ReleasePolicyError && error.code === 'USAGE_INVALID');
  assert.equal(api.expectedTarballName('@meshimize/proceed-mcp', '0.1.0-preview.2'),
    'meshimize-proceed-mcp-0.1.0-preview.2.tgz');
  verdict(api, releaseFacts());
  const cases = [
    ['event.name', 'pull_request', 'EVENT_INVALID'], ['event.name', 'workflow_dispatch', 'EVENT_INVALID'],
    ['event.ref', 'refs/heads/main', ['REF_INVALID', 'WORKFLOW_INVALID']],
    ['package.version', 'not-a-version', ['VERSION_INVALID', 'TAG_VERSION_MISMATCH', 'ACCEPTANCE_MISMATCH', 'ARTIFACT_MALFORMED']],
    ['package.version', '0.1.0', ['VERSION_INVALID', 'TAG_VERSION_MISMATCH', 'ACCEPTANCE_MISMATCH', 'ARTIFACT_MALFORMED']],
    ['run.workflowRef', 'renl/proceed-mcp/.github/workflows/other.yml@refs/tags/v0.1.0-preview.2', 'WORKFLOW_INVALID'],
    ['run.workflowRef', 'renl/proceed-mcp/.github/workflows/release.yml@refs/heads/main', 'WORKFLOW_INVALID'],
    ['package.name', 'other', ['IDENTITY_MISMATCH', 'ACCEPTANCE_MISMATCH', 'ARTIFACT_MALFORMED']],
    ['event.repository', 'fork/proceed-mcp', ['IDENTITY_MISMATCH', 'ACCEPTANCE_MISMATCH', 'CONFIGURATION_MISMATCH']],
    ['package.registryName', 'other', ['IDENTITY_MISMATCH', 'ACCEPTANCE_MISMATCH']],
    ['tag.name', '', ['TAG_VERSION_MISMATCH', 'ACCEPTANCE_MISMATCH']],
    ['package.channel', 'latest', ['CHANNEL_INVALID', 'ACCEPTANCE_MISMATCH']], ['run.workflowRef', null, 'WORKFLOW_INVALID'],
    ['candidate.mainContains', false, 'MAIN_ANCESTRY_UNAVAILABLE'],
    ['candidate.mainContains', 'unknown', 'MAIN_ANCESTRY_UNAVAILABLE'],
    ['acceptance', { state: 'missing', record: null, ancestor: 'unknown' }, 'ACCEPTANCE_MISSING'],
    ['acceptance', { state: 'malformed', record: null, ancestor: 'unknown' }, 'ACCEPTANCE_MALFORMED'],
    ['acceptance.record.verification.status', 'failed', 'ACCEPTANCE_NOT_PASSED'],
    ['acceptance.record.verification.reference', '../escape', 'ACCEPTANCE_MALFORMED'],
    ['acceptance.record.verification.reference', 'C:/private', 'ACCEPTANCE_MALFORMED'],
    ['acceptance.record.packedInputs', null, 'ACCEPTANCE_MALFORMED'],
    ['acceptance.record.registryName', 'other', 'ACCEPTANCE_MISMATCH'],
    ['checks.validate', 'fail', 'CHECK_FAILED'], ['checks.validate', 'unknown', 'CHECK_FAILED'],
    ['configuration', { state: 'unknown', record: null }, 'CONFIGURATION_UNKNOWN'],
    ['configuration', { state: 'unconfigured', record: null }, 'CONFIGURATION_UNCONFIGURED'],
    ['configuration', { state: 'malformed', record: null }, 'CONFIGURATION_MALFORMED'],
    ['configuration.record.observedAt', '2099-01-01T00:00:00.000Z', 'CONFIGURATION_MALFORMED'],
    ['configuration.record.validationWindow.endsAt', '2026-11-04T00:00:00.000Z', 'CONFIGURATION_EXPIRED'],
    ['configuration.record.observation.rights.packageWrite', false, 'CONFIGURATION_INCOMPLETE'],
    ['configuration.record.observation.environmentProtection.preventsSelfReview', false, 'CONFIGURATION_INCOMPLETE'],
    ['configuration.record.observation.trustedPublisher.directPublish', false, 'CONFIGURATION_INCOMPLETE'],
    ['configuration.record.observation.trustedPublisher.workflow', 'other.yml', 'CONFIGURATION_MISMATCH'],
    ['environment.name', null, 'CONFIGURATION_MISMATCH'],
    ['artifact', { state: 'missing', filename: null, sha256: null, bytes: null }, 'ARTIFACT_MISSING'],
    ['artifact.state', 'malformed', 'ARTIFACT_MALFORMED'],
    ['artifact.sha256', 'd'.repeat(64), 'ARTIFACT_MISMATCH'], ['artifact.bytes', 124, 'ARTIFACT_MISMATCH'],
    ['packedInputs', { state: 'missing', algorithm: null, digest: null }, 'PACKED_INPUTS_MISSING'],
    ['packedInputs.algorithm', 'unrecognized', 'PACKED_INPUTS_MALFORMED'],
    ['packedInputs.digest', 'd'.repeat(64), 'PACKED_INPUTS_MISMATCH'],
  ];
  for (const path of ['mainProtection.requiredPullRequest', 'mainProtection.enforcedForAdmins',
    'tagProtection.active', 'environmentProtection.requiredApproval', 'environmentProtection.deploymentRefRestricted',
    'trustedPublisher.configurationPresent', 'rights.licenseConfirmed', 'rights.documentationApproved']) {
    cases.push([`configuration.record.observation.${path}`, false, 'CONFIGURATION_INCOMPLETE']);
  }
  for (const [path, value, code] of cases) {
    const facts = releaseFacts(); set(facts, path, value);
    verdict(api, facts, Array.isArray(code) ? code : [code]);
    verdict(api, releaseFacts());
  }
  for (const phase of ['preflight', 'publish']) {
    const facts = releaseFacts(); facts.phase = phase;
    // Keep every identity binding consistent so the version exclusion is decisive.
    for (const object of [facts.package, facts.acceptance.record]) object.version = '0.1.0-preview.1';
    facts.tag.name = facts.acceptance.record.tag = 'v0.1.0-preview.1';
    facts.event.ref = 'refs/tags/v0.1.0-preview.1';
    facts.run.workflowRef = `renl/proceed-mcp/.github/workflows/release.yml@${facts.event.ref}`;
    facts.artifact.filename = facts.acceptance.record.artifact.filename = 'meshimize-proceed-mcp-0.1.0-preview.1.tgz';
    verdict(api, facts, ['INITIAL_VERSION_CI_FORBIDDEN']);
  }
  const facts = releaseFacts();
  facts.configuration = { state: 'unknown', record: null };
  facts.checks.validate = 'unknown'; facts.artifact.state = 'missing'; facts.packedInputs.state = 'missing';
  facts.phase = 'preflight'; verdict(api, facts);
  facts.phase = 'publish';
  verdict(api, facts, ['CONFIGURATION_UNKNOWN', 'CHECK_FAILED', 'ARTIFACT_MISSING', 'PACKED_INPUTS_MISSING']);
  // A passed flag, an ancestor claim, and cleanup metadata alone cannot authorize.
  for (const record of [{ verification: { status: 'passed' } }, { candidateCommit: 'c'.repeat(40) }, { cleanup: 'pass' }]) {
    const alone = releaseFacts(); alone.acceptance.record = record;
    verdict(api, alone, ['ACCEPTANCE_MALFORMED']);
  }
  for (const bad of [null, {}, { ...releaseFacts(), schemaVersion: 1 }, { ...releaseFacts(), phase: 'other' }]) {
    assert.throws(() => api.evaluateRelease(bad), { code: 'FACTS_MALFORMED' });
  }
});

test('B2 core: ancestry requires validated passed matching acceptance in both phases', async () => {
  const api = await core();
  for (const phase of ['preflight', 'publish']) {
    for (const ancestor of [true, false, 'unknown']) {
      const facts = releaseFacts();
      facts.phase = phase;
      facts.acceptance.ancestor = ancestor;
      verdict(api, facts, ancestor === true ? [] : ['ACCEPTANCE_ANCESTOR_INVALID']);
      for (const [path, value, code] of [
        ['acceptance.state', 'missing', 'ACCEPTANCE_MISSING'],
        ['acceptance.state', 'malformed', 'ACCEPTANCE_MALFORMED'],
        ['acceptance.record.verifiedAt', '2099-01-01T00:00:00.000Z', 'ACCEPTANCE_MALFORMED'],
        ['acceptance.record.verification.status', 'failed', 'ACCEPTANCE_NOT_PASSED'],
        ...[undefined, null, 0, false, {}].map((value) =>
          ['acceptance.record.verification.status', value, 'ACCEPTANCE_MALFORMED']),
        ...['', 'missing'].map((value) =>
          ['acceptance.record.verification.status', value, 'ACCEPTANCE_NOT_PASSED']),
        ['acceptance.record.repository', 'other/repo', 'ACCEPTANCE_MISMATCH'],
      ]) {
        const gated = structuredClone(facts);
        set(gated, path, value);
        verdict(api, gated, [code]);
      }
      for (const status of [undefined, null, 0, false, {}, '', 'missing', 'failed']) {
        const gated = structuredClone(facts);
        if (status === undefined) delete gated.acceptance.record.verification.status;
        else gated.acceptance.record.verification.status = status;
        gated.acceptance.record.repository = 'other/repo';
        verdict(api, gated, [typeof status === 'string' ? 'ACCEPTANCE_NOT_PASSED' : 'ACCEPTANCE_MALFORMED']);
      }
      verdict(api, releaseFacts());
    }
  }
});

test('B2 core: record shape, timestamps, identity and independent groups fail closed', async () => {
  const api = await core();
  const cases = [];
  for (const path of ['schemaVersion', 'package', 'version', 'tag', 'channel', 'repository',
    'registryName', 'candidateCommit', 'verifiedAt', 'artifact', 'packedInputs', 'verification']) {
    cases.push([`acceptance.record.${path}`, undefined, 'ACCEPTANCE_MALFORMED']);
  }
  for (const path of ['schemaVersion', 'state', 'observedAt', 'scope', 'reference', 'repository',
    'environment', 'workflow', 'observation', 'validationWindow']) {
    cases.push([`configuration.record.${path}`, undefined, 'CONFIGURATION_MALFORMED']);
  }
  for (const prefix of ['acceptance.record.verification', 'configuration.record']) {
    for (const reference of ['', '/absolute', '../escape', 'a/../b', 'C:/private', 'a\\b']) {
      cases.push([`${prefix}.reference`, reference, prefix.startsWith('acceptance')
        ? 'ACCEPTANCE_MALFORMED' : 'CONFIGURATION_MALFORMED']);
    }
  }
  for (const [path, value] of [
    ['schemaVersion', 2], ['candidateCommit', 'bad'], ['artifact.sha256', 'bad'],
    ['artifact.bytes', -1], ['packedInputs.algorithm', 'other'], ['packedInputs.digest', 'bad'],
    ['packedInputs.toolchain.node', ''], ['packedInputs.toolchain.npm', ''],
    ['verification.scope', ''], ['verifiedAt', 'not-a-date'], ['verifiedAt', '2099-01-01T00:00:00.000Z'],
  ]) cases.push([`acceptance.record.${path}`, value, 'ACCEPTANCE_MALFORMED']);
  for (const [path, value] of [
    ['schemaVersion', 2], ['scope', ''], ['observedAt', 'not-a-date'],
    ['validationWindow.endsAt', 'not-a-date'], ['observation.rights.packageWrite', 'true'],
    ['observation.mainProtection.requiredApprovals', 1.5],
  ]) cases.push([`configuration.record.${path}`, value, 'CONFIGURATION_MALFORMED']);
  cases.push(['configuration.record.observation.mainProtection.requiredApprovals', 0, 'CONFIGURATION_INCOMPLETE']);
  for (const field of ['package', 'version', 'tag', 'channel', 'repository', 'registryName']) {
    const value = field === 'version' ? '0.1.0-preview.3' : 'other';
    cases.push([`acceptance.record.${field}`, value, 'ACCEPTANCE_MISMATCH']);
  }
  for (const path of ['repository', 'environment', 'workflow', 'observation.trustedPublisher.repository',
    'observation.trustedPublisher.environment', 'observation.trustedPublisher.workflow']) {
    cases.push([`configuration.record.${path}`, 'other', 'CONFIGURATION_MISMATCH']);
  }
  cases.push(['packedInputs.digest', 'bad', 'PACKED_INPUTS_MALFORMED']);
  cases.push(['artifact.filename', 'wrong.tgz', 'ARTIFACT_MALFORMED']);
  cases.push(['acceptance.record.artifact.filename', null, 'ACCEPTANCE_MALFORMED']);
  cases.push(['acceptance.record.artifact.filename', 'wrong.tgz', 'ARTIFACT_MISMATCH']);
  for (const [path, value, code] of cases) {
    const facts = releaseFacts();
    set(facts, path, value);
    verdict(api, facts, [code]);
    verdict(api, releaseFacts());
  }
  const facts = releaseFacts();
  // Candidate filename validity is independent of approved package identity.
  facts.package.name = 'other';
  facts.artifact.filename = 'other-0.1.0-preview.2.tgz';
  verdict(api, facts, ['IDENTITY_MISMATCH', 'ACCEPTANCE_MISMATCH', 'ARTIFACT_MISMATCH']);
  facts.acceptance.record.artifact.filename = facts.artifact.filename;
  verdict(api, facts, ['IDENTITY_MISMATCH', 'ACCEPTANCE_MISMATCH']);
  verdict(api, releaseFacts());
  facts.package.name = releaseFacts().package.name;
  facts.artifact.filename = facts.acceptance.record.artifact.filename = releaseFacts().artifact.filename;
  facts.acceptance.record.verifiedAt = '2000-01-01T00:00:00.000Z';
  facts.configuration.record.observedAt = facts.evaluatedAt;
  facts.configuration.record.validationWindow.endsAt = facts.evaluatedAt;
  verdict(api, facts); // Old byte-identical acceptance and inclusive window boundary are valid.
  facts.acceptance.record = {};
  facts.checks.validate = 'fail';
  facts.artifact.sha256 = 'd'.repeat(64);
  facts.packedInputs.digest = 'd'.repeat(64);
  verdict(api, facts, ['ACCEPTANCE_MALFORMED', 'CHECK_FAILED']);
  for (const path of ['acceptance.ancestor', 'event', 'run', 'package', 'tag', 'candidate',
    'acceptance', 'configuration', 'checks', 'artifact', 'packedInputs', 'environment', 'evaluatedAt']) {
    const malformed = releaseFacts();
    const parts = path.split('.');
    const key = parts.pop();
    delete parts.reduce((object, part) => object[part], malformed)[key];
    assert.throws(() => api.evaluateRelease(malformed), { code: 'FACTS_MALFORMED' }, path);
  }
  for (const ancestor of [null, 0, 'true']) {
    const malformed = releaseFacts();
    malformed.acceptance.ancestor = ancestor;
    assert.throws(() => api.evaluateRelease(malformed), { code: 'FACTS_MALFORMED' });
  }
});

test('B2 core: configuration record state domain and shape-tier precedence', async (t) => {
  const api = await core();
  // Binding sections 5 and 7. Outer state selects tier 1, record state has a closed schema domain.
  for (const state of ['verified', 'unconfigured', 'unknown']) {
    await t.test(`documented state ${state}`, () => {
      const facts = releaseFacts();
      facts.configuration.state = facts.configuration.record.state = state;
      verdict(api, facts, state === 'verified' ? [] : [`CONFIGURATION_${state.toUpperCase()}`]);
      verdict(api, releaseFacts());
    });
  }
  for (const state of ['invalid', '', null, undefined, 0]) {
    await t.test(`invalid record state ${String(state)}`, () => {
      const facts = releaseFacts();
      facts.configuration.record.state = state;
      facts.phase = 'preflight'; verdict(api, facts);
      facts.phase = 'publish'; verdict(api, facts, ['CONFIGURATION_MALFORMED']);
      verdict(api, releaseFacts());
    });
  }
  await t.test('shape suppresses later configuration tiers but not independent groups', () => {
    const facts = releaseFacts();
    facts.configuration.record.state = 'invalid';
    facts.configuration.record.observation.rights.packageWrite = false;
    facts.configuration.record.repository = 'other/repo';
    facts.configuration.record.validationWindow.endsAt = '2026-11-04T00:00:00.000Z';
    facts.checks.validate = 'fail';
    verdict(api, facts, ['CONFIGURATION_MALFORMED', 'CHECK_FAILED']);
    verdict(api, releaseFacts());
  });
});

test('B2 digest: independently encoded per-file bytes, path set and declared inputs', async () => {
  const api = await core();
  const parent = resolve('.scratch/preview-prep');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'b2-digest-'));
  const installDir = join(root, 'installed');
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const inputPaths = ['LICENSE', 'README.md', 'package-lock.json', 'package.json', 'scripts/build.mjs'];
  try {
    await mkdir(installDir); await mkdir(join(root, 'scripts'));
    for (const path of inputPaths) await writeFile(join(root, path), `input:${path}`);
    // Creation order differs from byte-order sorting. Non-ASCII names expose locale sorting.
    for (const path of ['z.js', 'a.js', '\u00e9.js']) await writeFile(join(installDir, path), `file:${path}`);
    const files = ['a.js', 'z.js', '\u00e9.js'].map((path) => ({ path, sha256: hash(`file:${path}`), bytes: Buffer.byteLength(`file:${path}`) }));
    const inputs = inputPaths.map((path) => ({ path, sha256: hash(`input:${path}`) }));
    const expected = { algorithm: 'sha256-packed-inputs-v1',
      digest: hash(JSON.stringify({ schema: 'proceed-mcp/packed-inputs/1', files, inputs })), files, inputs };
    assert.deepEqual(await api.computePackedInputs({ installDir, root }), expected);
    assert.deepEqual(await api.computePackedInputs({ installDir, root }), expected);
    for (const [path, replacement] of [['a.js', 'changed'], ['added.js', 'new']]) {
      await writeFile(join(installDir, path), replacement);
      assert.notEqual((await api.computePackedInputs({ installDir, root })).digest, expected.digest);
      if (path === 'a.js') await writeFile(join(installDir, path), 'file:a.js');
      else await rm(join(installDir, path));
    }
    await rm(join(installDir, 'z.js'));
    assert.notEqual((await api.computePackedInputs({ installDir, root })).digest, expected.digest);
    await writeFile(join(installDir, 'z.js'), 'file:z.js');
    for (const path of inputPaths) {
      await writeFile(join(root, path), 'changed');
      assert.notEqual((await api.computePackedInputs({ installDir, root })).digest, expected.digest, path);
      await writeFile(join(root, path), `input:${path}`);
    }
    const linked = join(installDir, 'linked');
    await symlink(join(root, 'scripts'), linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(api.computePackedInputs({ installDir, root }), { code: 'DIGEST_UNREADABLE' });
    await rm(linked);
    for (const path of ['.npmignore', '.gitignore', 'npm-shrinkwrap.json']) {
      await writeFile(join(root, path), 'selection');
      const selection = await api.computePackedInputs({ installDir, root });
      assert.notEqual(selection.digest, expected.digest, path);
      assert.deepEqual(selection.inputs, [...inputs, { path, sha256: hash('selection') }]
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))));
      await writeFile(join(root, path), 'changed-selection');
      assert.notEqual((await api.computePackedInputs({ installDir, root })).digest, selection.digest);
      await rm(join(root, path));
      assert.deepEqual(await api.computePackedInputs({ installDir, root }), expected);
    }
    for (const path of ['docs', 'release']) await mkdir(join(root, path));
    for (const path of ['.prettierrc.json', '.prettierignore', 'docs/note.md', 'release/note.json']) {
      await writeFile(join(root, path), 'not a declared input');
    }
    assert.deepEqual(await api.computePackedInputs({ installDir, root }), expected);
    await rm(join(root, 'LICENSE'));
    await assert.rejects(api.computePackedInputs({ installDir, root }), { code: 'DIGEST_UNREADABLE' });
    await mkdir(join(root, 'LICENSE'));
    await assert.rejects(api.computePackedInputs({ installDir, root }), { code: 'DIGEST_UNREADABLE' });
  } finally {
    await rm(root, { recursive: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  }
});

// Closed command lists mirror the selected binding, not a second policy implementation.
const preflight = 'node scripts/release-policy.mjs --phase preflight';
const publication = 'node scripts/release-policy.mjs --phase publish --artifact-dir .release-artifact --install-dir (Join-Path $prefix \'node_modules/@meshimize/proceed-mcp\')';
const releasePack = packCommand.replace('node tests/release-pack.mjs',
  "$env:PROCEED_TEST_ARTIFACT_DIR = Join-Path $env:GITHUB_WORKSPACE '.release-artifact'\nnode tests/release-pack.mjs");
const fetchMain = 'git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main';
const npmVersion = `node -e "const{execFileSync}=require('node:child_process');const v=execFileSync(process.platform==='win32'?'npm.cmd':'npm',['--version'],{encoding:'utf8'}).trim();const[a,b,c]=v.split('.').map(Number);if(a<11||(a===11&&(b<5||(b===5&&c<1))))process.exit(1)"`;
const digestInstall = [
  "$prefix = Join-Path $env:RUNNER_TEMP 'digest-install'",
  'New-Item -ItemType Directory -Path $prefix | Out-Null',
  'Set-Content -LiteralPath (Join-Path $prefix \'package.json\') -Value \'{"private":true}\'',
  "$tgz = Get-ChildItem -LiteralPath '.release-artifact' -Filter '*.tgz'",
  "if ($tgz.Count -ne 1) { throw 'expected exactly one tarball' }",
  'npm install $tgz.FullName --prefix $prefix --omit=dev --ignore-scripts --package-lock=false --offline --no-audit --no-fund',
  publication,
].join('\n');
const publishTarball = "$tgz = Get-ChildItem -LiteralPath '.release-artifact' -Filter '*.tgz'\nnpm publish $tgz.FullName --access public --tag preview";
function releaseGuard(text) {
  assert.doesNotMatch(text, /secrets\b|NODE_AUTH_TOKEN|NPM_TOKEN|\.npmrc|registry-url|npm config|dist-tag|latest|--provenance|continue-on-error|self-hosted/i);
  const model = parseWorkflow(text, { release: true });
  assert.deepEqual(JSON.parse(JSON.stringify(model.events)), { push: { tags: ['v*'] } });
  assert.deepEqual({ ...model.topPermissions }, { contents: 'read' });
  assert.deepEqual({ ...model.concurrency }, { group: 'release-${{ github.ref }}', 'cancel-in-progress': 'false' });
  assert.deepEqual(model.jobs.map((job) => job.id), ['validate', 'publish']);
  const [validation, publishing] = model.jobs;
  assert.equal(validation.timeout, '20'); assert.equal(publishing.timeout, '15');
  assert.equal(validation.environment, null); assert.equal(validation.needs, null); assert.equal(validation.if, null);
  assert.deepEqual({ ...validation.permissions }, {}); assert.deepEqual({ ...validation.env }, {});
  assert.equal(publishing.environment, 'npm-preview'); assert.equal(publishing.needs, 'validate');
  assert.equal(publishing.if, "needs.validate.result == 'success'");
  assert.deepEqual({ ...publishing.permissions }, { contents: 'read', 'id-token': 'write' });
  assert.deepEqual({ ...publishing.env }, { RELEASE_ENVIRONMENT: 'npm-preview', VALIDATE_RESULT: '${{ needs.validate.result }}' });
  const pins = [];
  for (const job of model.jobs) {
    assert.deepEqual(job.runsOn, ['windows-2025']);
    for (const step of job.steps.filter((item) => item.run)) assert.deepEqual({ ...step.with }, {});
    for (const step of job.steps.filter((item) => item.uses)) {
      assert.match(step.uses, /^actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@[a-f0-9]{40}$/);
      pins.push(step.uses);
    }
    assert.match(job.steps[0].uses, /^actions\/checkout@/);
    assert.deepEqual({ ...job.steps[0].with }, { 'fetch-depth': '0', 'persist-credentials': 'false' });
    assert.match(job.steps[1].uses, /^actions\/setup-node@/);
    assert.deepEqual({ ...job.steps[1].with }, { 'node-version': '24.22.2' });
  }
  assert.equal(new Set(pins.map((pin) => pin.split('@')[0])).size, 4);
  const revisions = new Map();
  for (const pin of pins) {
    const [name, revision] = pin.split('@');
    assert.ok(!revisions.has(revision) || revisions.get(revision) === name, 'different actions need distinct revisions');
    revisions.set(revision, name);
  }
  assert.deepEqual(validation.steps.map((step) => step.run?.trimEnd() ?? step.uses.split('@')[0]),
    ['actions/checkout', 'actions/setup-node', fetchMain, preflight,
      'node --test tests/release-metadata.test.mjs', 'node scripts/build.mjs', releasePack, 'actions/upload-artifact']);
  assert.deepEqual(publishing.steps.map((step) => step.run?.trimEnd() ?? step.uses.split('@')[0]),
    ['actions/checkout', 'actions/setup-node', fetchMain, 'actions/download-artifact', npmVersion, digestInstall, publishTarball]);
  assert.deepEqual({ ...validation.steps.at(-1).with }, { name: 'release-artifact', path: '.release-artifact/', 'if-no-files-found': 'error', 'retention-days': '1' });
  assert.deepEqual({ ...publishing.steps[3].with }, { name: 'release-artifact', path: '.release-artifact' });
  assert.equal(validation.steps[6].shell, 'pwsh'); assert.equal(validation.steps[6].timeout, '5');
}
const action = (name, pin, values) => `      - uses: actions/${name}@${pin.repeat(40)}\n        with:\n${Object.entries(values).map(([key, value]) => `          ${key}: ${value}\n`).join('')}`;
const runStep = (run, pack = false) => `      - shell: pwsh\n${pack ? '        timeout-minutes: 5\n' : ''}        run: |\n${run.split('\n').map((line) => `          ${line}\n`).join('')}`;
const checkout = action('checkout', 'a', { 'fetch-depth': 0, 'persist-credentials': false });
const setupNode = action('setup-node', 'b', { 'node-version': '24.22.2' });
const releaseSpecimen = `on:
  push:
    tags:
      - v*
permissions:
  contents: read
concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  validate:
    runs-on: windows-2025
    timeout-minutes: 20
    steps:
${checkout}${setupNode}${[fetchMain, preflight, 'node --test tests/release-metadata.test.mjs', 'node scripts/build.mjs'].map((run) => runStep(run)).join('')}${runStep(releasePack, true)}${action('upload-artifact', 'c', { name: 'release-artifact', path: '.release-artifact/', 'if-no-files-found': 'error', 'retention-days': 1 })}  publish:
    needs: validate
    if: needs.validate.result == 'success'
    runs-on: windows-2025
    timeout-minutes: 15
    environment: npm-preview
    permissions:
      contents: read
      id-token: write
    env:
      RELEASE_ENVIRONMENT: npm-preview
      VALIDATE_RESULT: \${{ needs.validate.result }}
    steps:
${checkout}${setupNode}${runStep(fetchMain)}${action('download-artifact', 'd', { name: 'release-artifact', path: '.release-artifact' })}${[npmVersion, digestInstall, publishTarball].map((run) => runStep(run)).join('')}`;
test('B2 workflow calibration rejects privilege, ordering, artifact and trigger hazards', () => {
  releaseGuard(releaseSpecimen);
  for (const [before, after] of [
    ['push:', 'pull_request:'], ['- v*', '- main'], ['environment: npm-preview', 'environment: other'],
    ['    steps:', '    environment: npm-preview\n    steps:'],
    ['    steps:', '    permissions:\n      id-token: write\n    steps:'],
    [`checkout@${'a'.repeat(40)}`, 'checkout@v4'], ['contents: read', 'contents: write'],
    [`setup-node@${'b'.repeat(40)}`, `setup-node@${'a'.repeat(40)}`],
    [preflight, 'npm publish . --tag preview'], [publication, 'echo policy-not-run'],
    ['npm publish $tgz.FullName', 'npm publish .'], ['--tag preview', '--tag latest'],
    ['--tag preview', '--tag preview\n          echo ${{ secrets.NPM_TOKEN }}'],
    ['--tag preview', '--tag preview\n        continue-on-error: true'],
    ['persist-credentials: false', 'persist-credentials: true'],
    ['name: release-artifact', 'name: unrelated'], ['if-no-files-found: error', 'if-no-files-found: warn'],
  ]) {
    const mutated = releaseSpecimen.replace(before, after);
    assert.notEqual(mutated, releaseSpecimen, 'calibration must actually change the specimen');
    assert.throws(() => releaseGuard(mutated), undefined, before);
  }
});
test('B2 checked-in release workflow satisfies the selected offline structure', async () => {
  releaseGuard(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
});

test('B2 readers: absent and invalid JSON never become verified records', async () => {
  const api = await core();
  const parent = resolve('.scratch/preview-prep');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'b2-records-'));
  const version = '0.1.0-preview.2';
  const acceptance = join(root, 'release/evidence', `${version}.json`);
  const configuration = join(root, 'release/configuration.json');
  try {
    assert.deepEqual(await api.readAcceptanceRecord({ root, version }), { state: 'missing', record: null });
    assert.deepEqual(await api.readConfigurationRecord({ root }), { state: 'unknown', record: null });
    await mkdir(join(root, 'release/evidence'), { recursive: true });
    await writeFile(acceptance, '{'); await writeFile(configuration, '{');
    assert.deepEqual(await api.readAcceptanceRecord({ root, version }), { state: 'malformed', record: null });
    assert.deepEqual(await api.readConfigurationRecord({ root }), { state: 'malformed', record: null });
    for (const value of [null, [], 42, 'not a record']) {
      await writeFile(acceptance, JSON.stringify(value));
      await writeFile(configuration, JSON.stringify(value));
      assert.deepEqual(await api.readAcceptanceRecord({ root, version }), { state: 'malformed', record: null });
      assert.deepEqual(await api.readConfigurationRecord({ root }), { state: 'malformed', record: null });
    }
    const facts = releaseFacts();
    await writeFile(acceptance, JSON.stringify(facts.acceptance.record));
    await writeFile(configuration, JSON.stringify(facts.configuration.record));
    assert.deepEqual(await api.readAcceptanceRecord({ root, version }), {
      state: 'present', record: facts.acceptance.record,
    });
    assert.deepEqual(await api.readConfigurationRecord({ root }), facts.configuration);
    await rm(acceptance); await mkdir(acceptance);
    await assert.rejects(api.readAcceptanceRecord({ root, version }), { code: 'RECORD_UNREADABLE' });
    await rm(configuration); await mkdir(configuration);
    await assert.rejects(api.readConfigurationRecord({ root }), { code: 'RECORD_UNREADABLE' });
  } finally {
    await rm(root, { recursive: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  }
});

test('B2 CLI: usage is redacted and current bootstrap version cannot reach CI validation', async () => {
  await policy();
  const script = fileURLToPath(new URL('../scripts/release-policy.mjs', import.meta.url));
  const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const run = (args) => spawnSync(process.execPath, [script, ...args], {
    cwd: resolve('.'), env, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, windowsHide: true,
  });
  for (const args of [[], ['--phase', 'other'], ['--unknown'], ['--phase', 'publish']]) {
    const child = run(args); assert.ifError(child.error);
    assert.equal(child.status, 2); assert.equal(child.stdout, '');
    assert.match(child.stderr, /^release-policy: USAGE_INVALID: [^\r\n]+\r?\n$/);
    assert.doesNotMatch(child.stderr, /[A-Z]:[\\/]|\bat \w+.*:\d+/);
  }
  const child = run(['--phase', 'preflight']); assert.ifError(child.error);
  assert.equal(child.status, 1); assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const result = JSON.parse(child.stdout);
  assert.equal(result.decision, 'blocked'); assert.equal(result.authorization, 'not-assessed');
  assert.ok(result.blockers.some(({ code }) => code === 'INITIAL_VERSION_CI_FORBIDDEN'));
});

test('B2 collector: phase requirements, complete facts and preflight isolation', async () => {
  const api = await policy();
  const accepted = await core();
  for (const name of facadeNames) assert.equal(api[name], accepted[name], name);
  assert.deepEqual(Object.keys(api).sort(), [...facadeNames, 'collectReleaseFacts'].sort());
  await withReleaseFixture(async ({ root, facts, options, artifactDir, installDir }) => {
    const errorIs = (code) => (error) => error instanceof accepted.ReleasePolicyError && error.code === code;
    for (const change of [{ phase: undefined }, { phase: 'other' }, { artifactDir: undefined }, { installDir: undefined }]) {
      await assert.rejects(api.collectReleaseFacts({ ...options, ...change }), errorIs('USAGE_INVALID'));
    }
    const inherited = Object.assign(Object.create({ phase: 'preflight' }), options);
    delete inherited.phase;
    await assert.rejects(api.collectReleaseFacts(inherited), errorIs('USAGE_INVALID'));
    const before = Date.now();
    const collected = await api.collectReleaseFacts(options);
    assert.ok(Date.parse(collected.evaluatedAt) >= before && Date.parse(collected.evaluatedAt) <= Date.now());
    assert.deepEqual(collected, { ...facts, evaluatedAt: collected.evaluatedAt });
    verdict(api, collected);
    const absolute = await api.collectReleaseFacts({ ...options, artifactDir, installDir });
    assert.deepEqual(absolute.artifact, facts.artifact); assert.deepEqual(absolute.packedInputs, facts.packedInputs);
    for (const [value, expected] of [['success', 'pass'], ['failure', 'fail'], ['cancelled', 'fail'],
      ['skipped', 'fail'], [undefined, 'unknown'], ['other', 'unknown']]) {
      const env = { ...options.env, VALIDATE_RESULT: value };
      if (value === undefined) delete env.VALIDATE_RESULT;
      const result = await api.collectReleaseFacts({ ...options, phase: 'preflight', env });
      assert.equal(result.checks.validate, expected);
    }
    const unknown = await api.collectReleaseFacts({ ...options, phase: 'preflight', env: {} });
    assert.deepEqual(unknown.event, { name: '', ref: '', repository: '', commit: '' });
    assert.deepEqual(unknown.run, { id: null, attempt: null, workflowRef: null });
    assert.deepEqual(unknown.environment, { name: null });
    const packagePath = join(root, 'package.json');
    const originalPackage = await readFile(packagePath);
    for (const content of [null, '{']) {
      if (content === null) await rm(packagePath); else await writeFile(packagePath, content);
      const result = await api.collectReleaseFacts({ ...options, phase: 'preflight' });
      assert.deepEqual(result.package, { name: '', version: '', registryName: '', channel: 'invalid' });
    }
    await writeFile(packagePath, originalPackage);
    // Poison paths would fail digest collection and artifact shape if publish read them.
    await rm(artifactDir, { recursive: true }); await writeFile(artifactDir, 'not a directory');
    await rm(installDir, { recursive: true }); await mkdir(installDir);
    await symlink(join(root, 'scripts'), join(installDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const dirs of [{}, { artifactDir, installDir }]) {
      const pre = { ...options, phase: 'preflight', ...dirs };
      if (!Object.keys(dirs).length) { delete pre.artifactDir; delete pre.installDir; }
      const result = await api.collectReleaseFacts(pre);
      assert.deepEqual(result.artifact, { state: 'missing', filename: null, sha256: null, bytes: null });
      assert.deepEqual(result.packedInputs, { state: 'missing', algorithm: null, digest: null });
      verdict(api, result);
    }
  });
});

test('B2 collector: status-only git argv, normalised errors and skip rules', async () => {
  const api = await policy();
  await withReleaseFixture(async ({ facts, options, saveAcceptance, acceptancePath }) => {
    facts.acceptance.record.candidateCommit = 'd'.repeat(40); await saveAcceptance();
    for (const phase of ['preflight', 'publish']) {
      for (const [status, expected] of [[0, true], [1, false], [128, 'unknown']]) {
        const calls = [];
        const git = (...args) => {
          calls.push(args);
          return { status, get stdout() { throw Error('BOM/CRLF/localised stdout must not be read'); },
            get stderr() { throw Error('stderr must not be read'); } };
        };
        const result = await api.collectReleaseFacts({ ...options, phase, git });
        assert.deepEqual(calls, [[['merge-base', '--is-ancestor', facts.event.commit, 'origin/main']],
          [['merge-base', '--is-ancestor', facts.acceptance.record.candidateCommit, facts.event.commit]]]);
        assert.equal(result.candidate.mainContains, expected); assert.equal(result.acceptance.ancestor, expected);
      }
      for (const git of [() => ({}), () => ({ status: '0' }), () => ({ status: null }),
        () => ({ status: 0, error: Error('private detail') }), () => { throw Error('private detail'); }]) {
        await assert.rejects(api.collectReleaseFacts({ ...options, phase, git }),
          (error) => error instanceof api.ReleasePolicyError && error.code === 'GIT_UNAVAILABLE');
      }
      let calls = 0;
      const count = () => { calls++; return { status: 0 }; };
      const invalid = await api.collectReleaseFacts({ ...options, phase, env: { ...options.env, GITHUB_SHA: 'bad' }, git: count });
      assert.equal(calls, 0); assert.equal(invalid.candidate.mainContains, 'unknown');
      assert.equal(invalid.acceptance.ancestor, 'unknown');
      for (const content of [null, '{', '{}', JSON.stringify({ ...facts.acceptance.record, candidateCommit: 'bad' }),
        JSON.stringify({ ...facts.acceptance.record, verification: null })]) {
        if (content === null) await rm(acceptancePath);
        else await writeFile(acceptancePath, content);
        calls = 0;
        const result = await api.collectReleaseFacts({ ...options, phase, git: count });
        assert.equal(calls, 1); assert.equal(result.acceptance.ancestor, 'unknown');
        await saveAcceptance();
      }
    }
  });
});

test('B2 collector: real isolated git proves independent ancestry and missing main', async () => {
  const api = await policy();
  await withReleaseFixture(async ({ facts, options, git, saveAcceptance }) => {
    git('init', '--quiet');
    git('-c', 'core.hooksPath=disabled-hooks', 'commit', '--allow-empty', '-m', 'accepted');
    const first = git('rev-parse', 'HEAD');
    git('-c', 'core.hooksPath=disabled-hooks', 'commit', '--allow-empty', '-m', 'tag candidate');
    const second = git('rev-parse', 'HEAD');
    git('checkout', '--orphan', 'unrelated', '--quiet');
    git('-c', 'core.hooksPath=disabled-hooks', 'commit', '--allow-empty', '-m', 'unrelated');
    const unrelated = git('rev-parse', 'HEAD');
    const real = { ...options, env: { ...options.env, GITHUB_SHA: second } };
    delete real.git;
    for (const phase of ['preflight', 'publish']) {
      for (const [main, accepted, mainContains, ancestor] of [
        [second, first, true, true], [first, second, false, true],
        [second, unrelated, true, false], [null, first, 'unknown', true],
      ]) {
        if (main) git('update-ref', 'refs/remotes/origin/main', main);
        else git('update-ref', '-d', 'refs/remotes/origin/main');
        facts.acceptance.record.candidateCommit = accepted; await saveAcceptance();
        const result = await api.collectReleaseFacts({ ...real, phase });
        assert.equal(result.candidate.mainContains, mainContains);
        assert.equal(result.acceptance.ancestor, ancestor);
        verdict(api, result, [...(mainContains === true ? [] : ['MAIN_ANCESTRY_UNAVAILABLE']),
          ...(ancestor === true ? [] : ['ACCEPTANCE_ANCESTOR_INVALID'])]);
      }
    }
  });
});

test('B2 collector: actual bytes, manifest correspondence and mixed candidates', async () => {
  const api = await policy();
  await withReleaseFixture(async ({ root, facts, options, artifactDir, installDir }) => {
    const archive = join(artifactDir, facts.artifact.filename);
    const manifestPath = join(artifactDir, 'artifact.json');
    const manifest = { schemaVersion: 2, package: facts.package.name, version: facts.package.version,
      filename: facts.artifact.filename, sha256: facts.artifact.sha256, bytes: facts.artifact.bytes,
      files: [{ path: 'entry.js', size: 1 }], node: process.versions.node, platform: process.platform,
      packedInputs: { algorithm: facts.packedInputs.algorithm, digest: facts.packedInputs.digest }, cleanup: 'pass' };
    const collect = () => api.collectReleaseFacts(options);
    const valid = async () => { const result = await collect(); assert.deepEqual(result.artifact, facts.artifact);
      assert.deepEqual(result.packedInputs, facts.packedInputs); verdict(api, result); };
    await valid(); // Optional manifest is never the source of the recomputed facts.
    for (const [path, value] of [['schemaVersion', 1], ['package', 'other'], ['version', '0.1.0-preview.3'],
      ['filename', 'other.tgz'], ['sha256', 'f'.repeat(64)], ['bytes', 0], ['packedInputs.digest', 'f'.repeat(64)]]) {
      const changed = structuredClone(manifest); set(changed, path, value);
      await writeFile(manifestPath, JSON.stringify(changed));
      assert.equal((await collect()).artifact.state, 'malformed', path);
      await writeFile(manifestPath, JSON.stringify(manifest)); await valid();
    }
    await writeFile(manifestPath, '{'); assert.equal((await collect()).artifact.state, 'malformed');
    await rm(manifestPath);
    for (const name of ['second.tgz', 'unexpected.txt', 'unexpected-directory']) {
      const path = join(artifactDir, name);
      if (name.endsWith('directory')) await mkdir(path); else await writeFile(path, 'extra');
      assert.equal((await collect()).artifact.state, 'malformed', name);
      await rm(path, { recursive: true }); await valid();
    }
    await rm(archive); assert.equal((await collect()).artifact.state, 'missing');
    await writeFile(archive, 'changed tarball'); await writeFile(join(installDir, 'entry.js'), 'changed installed bytes');
    const mixed = await collect();
    assert.equal(mixed.artifact.sha256, createHash('sha256').update('changed tarball').digest('hex'));
    assert.equal(mixed.artifact.bytes, Buffer.byteLength('changed tarball'));
    verdict(api, mixed, ['ARTIFACT_MISMATCH', 'PACKED_INPUTS_MISMATCH']);
    await rm(join(root, 'LICENSE'));
    await assert.rejects(collect(), (error) => error instanceof api.ReleasePolicyError && error.code === 'DIGEST_UNREADABLE');
  });
});

test('B2 collector fixture calibration: real local git and independent digest setup clean up', async () => {
  const api = await core();
  await withReleaseFixture(async ({ facts, options, root, installDir, git }) => {
    const computed = await api.computePackedInputs({ root, installDir });
    assert.equal(computed.digest, facts.packedInputs.digest);
    git('init', '--quiet');
    git('-c', 'core.hooksPath=disabled-hooks', 'commit', '--allow-empty', '-m', 'calibration');
    assert.match(git('rev-parse', 'HEAD'), /^[a-f0-9]{40}$/);
    git('merge-base', '--is-ancestor', 'HEAD', 'HEAD');
    assert.equal(options.git().status, 0);
  });
});
