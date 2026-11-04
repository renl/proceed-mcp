// TEST ONLY. Synthetic records, never acceptance or observed configuration.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
export function releaseFacts() {
  const version = '0.1.0-preview.2';
  const artifact = { filename: `meshimize-proceed-mcp-${version}.tgz`, sha256: 'a'.repeat(64), bytes: 123 };
  const packedInputs = { algorithm: 'sha256-packed-inputs-v1', digest: 'b'.repeat(64) };
  return {
    schemaVersion: 2, phase: 'publish', evaluatedAt: '2026-11-05T12:00:00.000Z',
    event: { name: 'push', ref: `refs/tags/v${version}`, repository: 'renl/proceed-mcp', commit: 'c'.repeat(40) },
    run: { id: '123', attempt: '1', workflowRef: `renl/proceed-mcp/.github/workflows/release.yml@refs/tags/v${version}` },
    package: { name: '@meshimize/proceed-mcp', version, registryName: 'io.github.renl/proceed-mcp', channel: 'preview' },
    tag: { name: `v${version}` }, candidate: { mainContains: true },
    acceptance: { state: 'present', ancestor: true, record: {
      schemaVersion: 1, package: '@meshimize/proceed-mcp', version, tag: `v${version}`, channel: 'preview',
      repository: 'renl/proceed-mcp', registryName: 'io.github.renl/proceed-mcp', candidateCommit: 'c'.repeat(40),
      verifiedAt: '2026-11-05T11:00:00.000Z', artifact,
      packedInputs: { ...packedInputs, toolchain: { node: '24.22.2', npm: '11.20.0' } },
      verification: { status: 'passed', scope: 'SYNTHETIC OFFLINE CONTROL ONLY', reference: 'tests/release-ci.test.mjs' },
    } },
    configuration: { state: 'verified', record: {
      schemaVersion: 1, state: 'verified', observedAt: '2026-11-05T11:00:00.000Z',
      scope: 'SYNTHETIC OFFLINE CONTROL ONLY', reference: 'tests/release-ci.test.mjs',
      repository: 'renl/proceed-mcp', environment: 'npm-preview', workflow: '.github/workflows/release.yml',
      observation: {
        mainProtection: { requiredPullRequest: true, requiredApprovals: 1, enforcedForAdmins: true },
        tagProtection: { active: true },
        environmentProtection: { requiredApproval: true, preventsSelfReview: true, deploymentRefRestricted: true },
        trustedPublisher: { configurationPresent: true, repository: 'renl/proceed-mcp',
          workflow: '.github/workflows/release.yml', environment: 'npm-preview', directPublish: true },
        rights: { packageWrite: true, licenseConfirmed: true, documentationApproved: true },
      }, validationWindow: { endsAt: null },
    } },
    checks: { validate: 'pass' }, artifact: { state: 'present', ...artifact },
    packedInputs: { state: 'present', ...packedInputs }, environment: { name: 'npm-preview' },
  };
}

// One bounded owner for disposable collector files and local Git. No npm or network.
export async function withReleaseFixture(body) {
  const parent = resolve('.scratch/preview-prep');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'collector-'));
  const deadline = performance.now() + 15000;
  const progress = async (phase) => writeFile(`${root}-progress.json`, JSON.stringify({ phase }));
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const facts = releaseFacts();
  facts.acceptance.record.verifiedAt = facts.configuration.record.observedAt = '2000-01-01T00:00:00.000Z';
  const artifactDir = join(root, 'artifact');
  const installDir = join(root, 'installed');
  const acceptancePath = join(root, 'release/evidence', `${facts.package.version}.json`);
  const saveAcceptance = () => writeFile(acceptancePath, JSON.stringify(facts.acceptance.record));
  const git = (...args) => {
    const remaining = Math.floor(deadline - performance.now() - 1000);
    assert.ok(remaining > 0, 'fixture deadline reserves cleanup');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { HOME: root, USERPROFILE: root, TEMP: root, TMP: root, TMPDIR: root,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'no-global-config'),
      GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
    const child = spawnSync('git', ['-C', root, ...args], {
      cwd: root, env, encoding: 'utf8', timeout: Math.min(2000, remaining), maxBuffer: 65536, windowsHide: true,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, `local fixture git ${args[0]}`);
    return child.stdout.trim();
  };
  try {
    await progress('setup');
    for (const path of ['scripts', 'release/evidence', 'artifact', 'installed']) {
      await mkdir(join(root, path), { recursive: true });
    }
    const packageJson = { name: facts.package.name, version: facts.package.version, mcpName: facts.package.registryName };
    await writeFile(join(root, 'package.json'), JSON.stringify(packageJson));
    for (const path of ['LICENSE', 'README.md', 'package-lock.json', 'scripts/build.mjs']) {
      await writeFile(join(root, path), `fixture:${path}`);
    }
    const installed = 'synthetic installed file, not package proof';
    await writeFile(join(installDir, 'entry.js'), installed);
    const files = [{ path: 'entry.js', sha256: hash(installed), bytes: Buffer.byteLength(installed) }];
    const inputs = [];
    for (const path of ['LICENSE', 'README.md', 'package-lock.json', 'package.json', 'scripts/build.mjs']) {
      inputs.push({ path, sha256: hash(await readFile(join(root, path))) });
    }
    facts.packedInputs.digest = hash(JSON.stringify({ schema: 'proceed-mcp/packed-inputs/1', files, inputs }));
    facts.acceptance.record.packedInputs.digest = facts.packedInputs.digest;
    const bytes = Buffer.from('dummy archive bytes, never installed or published');
    Object.assign(facts.artifact, { sha256: hash(bytes), bytes: bytes.length });
    Object.assign(facts.acceptance.record.artifact, { sha256: hash(bytes), bytes: bytes.length });
    await writeFile(join(artifactDir, facts.artifact.filename), bytes);
    await saveAcceptance();
    await writeFile(join(root, 'release/configuration.json'), JSON.stringify(facts.configuration.record));
    const env = { GITHUB_EVENT_NAME: facts.event.name, GITHUB_REF: facts.event.ref,
      GITHUB_REPOSITORY: facts.event.repository, GITHUB_SHA: facts.event.commit,
      GITHUB_RUN_ID: facts.run.id, GITHUB_RUN_ATTEMPT: facts.run.attempt,
      GITHUB_WORKFLOW_REF: facts.run.workflowRef, VALIDATE_RESULT: 'success', RELEASE_ENVIRONMENT: 'npm-preview' };
    const options = { phase: 'publish', root, env, artifactDir: 'artifact', installDir: 'installed', git: () => ({ status: 0 }) };
    await progress('assertions');
    await body({ root, artifactDir, installDir, facts, options, git, saveAcceptance, acceptancePath });
    assert.ok(performance.now() < deadline - 500, 'assertions fit aggregate deadline');
  } finally {
    await progress('cleanup');
    await rm(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
    await assert.rejects(access(root), { code: 'ENOENT' });
    await progress('cleanup-pass');
  }
}
