// TEST ONLY. Synthetic records, never acceptance or observed configuration.
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
    acceptance: { state: 'present', record: {
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
