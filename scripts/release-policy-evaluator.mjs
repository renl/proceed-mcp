// Release-policy evaluator leaf: the pure semantic gate over supplied facts. It never
// runs git, reads a file, spawns a process, reads the clock or environment, writes, or
// contacts the network. An empty blocker list is a consistency result, never authorization.
import {
  APPROVED,
  PACKED_INPUT_DIGEST_ALGORITHM,
  RELEASE_POLICY_SCHEMA_VERSION,
  ReleasePolicyError,
  VERSION_PATTERN,
  expectedTarballName,
  isObject,
  isRepoRelative,
  isText,
} from './release-policy-schema.mjs';

// Section 5 scope: the code prefix names the group, so the table cannot drift.
const PUBLICATION_PREFIX = /^(CHECK_|CONFIGURATION_|ARTIFACT_|PACKED_INPUTS_)/;
const scopeOf = (code) => (PUBLICATION_PREFIX.test(code) ? 'publication' : 'validation');
const blocker = (code) => ({ code, scope: scopeOf(code) });

// Section 7 observation flags, grouped as the record states them. Every one must
// hold exactly true for configuration to pass.
const REQUIRED_FLAGS = Object.entries({
  mainProtection: ['requiredPullRequest', 'enforcedForAdmins'],
  tagProtection: ['active'],
  environmentProtection: ['requiredApproval', 'preventsSelfReview', 'deploymentRefRestricted'],
  trustedPublisher: ['configurationPresent', 'directPublish'],
  rights: ['packageWrite', 'licenseConfirmed', 'documentationApproved'],
}).flatMap(([group, keys]) => keys.map((key) => `${group}.${key}`));

// Section 7: the record state domain is closed. Text shape alone would accept any
// string, so an unlisted state has to fail the record shape tier.
const CONFIGURATION_STATES = new Set(['verified', 'unconfigured', 'unknown']);

const malformed = (detail) => {
  throw new ReleasePolicyError('FACTS_MALFORMED', detail);
};
const isHex = (value, size) =>
  typeof value === 'string' && value.length === size && /^[0-9a-f]+$/.test(value);
const isSha256 = (value) => isHex(value, 64);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isTri = (value) => value === true || value === false || value === 'unknown';
const textKeys = (object, keys) =>
  isObject(object) && keys.every((key) => typeof object[key] === 'string');
const filledKeys = (object, keys) => isObject(object) && keys.every((key) => isText(object[key]));
const nullableText = (object, keys) =>
  isObject(object) && keys.every((key) => typeof object[key] === 'string' || object[key] === null);
const at = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const notAfter = (time, limit) => Date.parse(time) <= Date.parse(limit);

// Structural facts validation only. Record content is judged semantically by the
// group tiers below, so a poor record becomes a blocker rather than a throw.
function assertFacts(facts) {
  if (!isObject(facts) || facts.schemaVersion !== RELEASE_POLICY_SCHEMA_VERSION) malformed('facts');
  if (facts.phase !== 'preflight' && facts.phase !== 'publish') malformed('phase');
  if (!isTime(facts.evaluatedAt)) malformed('evaluatedAt');
  const { event, run, package: pkg, tag, candidate, acceptance, configuration } = facts;
  const { checks, artifact, packedInputs, environment } = facts;
  const entry = (value) => isObject(value) && (value.record === null || isObject(value.record));
  if (!textKeys(event, ['name', 'ref', 'repository', 'commit'])) malformed('event');
  if (!nullableText(run, ['id', 'attempt', 'workflowRef'])) malformed('run');
  if (!textKeys(pkg, ['name', 'version', 'registryName', 'channel'])) malformed('package');
  if (!textKeys(tag, ['name'])) malformed('tag');
  if (!isObject(candidate) || !isTri(candidate.mainContains)) malformed('candidate');
  if (!entry(acceptance) || typeof acceptance.state !== 'string') malformed('acceptance');
  if (!isTri(acceptance.ancestor)) malformed('acceptance.ancestor');
  if (!entry(configuration) || typeof configuration.state !== 'string') malformed('configuration');
  if (!isObject(checks) || typeof checks.validate !== 'string') malformed('checks');
  if (!isObject(artifact) || typeof artifact.state !== 'string') malformed('artifact');
  if (!nullableText(artifact, ['filename', 'sha256'])) malformed('artifact');
  if (artifact.bytes !== null && !isCount(artifact.bytes)) malformed('artifact');
  if (!isObject(packedInputs) || typeof packedInputs.state !== 'string') malformed('packedInputs');
  if (!nullableText(packedInputs, ['algorithm', 'digest'])) malformed('packedInputs');
  const { name } = isObject(environment) ? environment : {};
  if (name !== null && typeof name !== 'string') malformed('environment');
}

function validationCodes(facts) {
  const { event, run, package: pkg, tag, candidate } = facts;
  const codes = [];
  if (event.name !== 'push') codes.push('EVENT_INVALID');
  if (!event.ref.startsWith('refs/tags/')) codes.push('REF_INVALID');
  if (!VERSION_PATTERN.test(pkg.version)) codes.push('VERSION_INVALID');
  if (tag.name !== `v${pkg.version}`) codes.push('TAG_VERSION_MISMATCH');
  if (pkg.channel !== APPROVED.channel) codes.push('CHANNEL_INVALID');
  const identical =
    event.repository === APPROVED.repository &&
    pkg.name === APPROVED.packageName &&
    pkg.registryName === APPROVED.registryName;
  if (!identical) codes.push('IDENTITY_MISMATCH');
  if (run.workflowRef === null || !run.workflowRef.endsWith(`${APPROVED.workflow}@${event.ref}`)) {
    codes.push('WORKFLOW_INVALID');
  }
  if (pkg.version === APPROVED.bootstrapVersion) codes.push('INITIAL_VERSION_CI_FORBIDDEN');
  if (candidate.mainContains !== true) codes.push('MAIN_ANCESTRY_UNAVAILABLE');
  codes.push(...acceptanceCodes(facts));
  return codes;
}

// Acceptance tiers: state, shape, status, agreement with the facts, then ancestry.
// The first failing stage is the only code reported, so an unvalidated record
// contributes no comparison and no ancestry claim.
function acceptanceCodes(facts) {
  const { acceptance: entry } = facts;
  if (entry.state === 'missing') return ['ACCEPTANCE_MISSING'];
  if (entry.state !== 'present' || !isAcceptanceRecord(entry.record, facts.evaluatedAt)) {
    return ['ACCEPTANCE_MALFORMED'];
  }
  const { record } = entry;
  if (record.verification.status !== 'passed') return ['ACCEPTANCE_NOT_PASSED'];
  const agrees =
    record.package === facts.package.name &&
    record.version === facts.package.version &&
    record.tag === facts.tag.name &&
    record.channel === facts.package.channel &&
    record.repository === facts.event.repository &&
    record.registryName === facts.package.registryName;
  if (!agrees) return ['ACCEPTANCE_MISMATCH'];
  if (entry.ancestor !== true) return ['ACCEPTANCE_ANCESTOR_INVALID'];
  return [];
}

// Section 6 shape. An inconsistent record stays well-formed and reports a mismatch later
// instead of being rejected here. `verification.status` needs string shape only, so a
// present string other than `passed`, including the empty string, is a status verdict.
function isAcceptanceRecord(record, evaluatedAt) {
  if (!isObject(record)) return false;
  const { artifact, packedInputs, verification } = record;
  return (
    record.schemaVersion === 1 &&
    textKeys(record, ['package', 'tag', 'channel', 'repository', 'registryName']) &&
    typeof record.version === 'string' &&
    VERSION_PATTERN.test(record.version) &&
    isHex(record.candidateCommit, 40) &&
    isTime(record.verifiedAt) &&
    notAfter(record.verifiedAt, evaluatedAt) &&
    isObject(artifact) &&
    typeof artifact.filename === 'string' &&
    isSha256(artifact.sha256) &&
    isCount(artifact.bytes) &&
    isObject(packedInputs) &&
    packedInputs.algorithm === PACKED_INPUT_DIGEST_ALGORITHM &&
    isSha256(packedInputs.digest) &&
    filledKeys(packedInputs.toolchain, ['node', 'npm']) &&
    isObject(verification) &&
    typeof verification.status === 'string' &&
    isText(verification.scope) &&
    isRepoRelative(verification.reference)
  );
}

// Configuration tiers: state, shape, observation flags, tuple consistency, window.
function configurationCodes(facts) {
  const { configuration: entry } = facts;
  if (entry.state === 'unknown') return ['CONFIGURATION_UNKNOWN'];
  if (entry.state === 'unconfigured') return ['CONFIGURATION_UNCONFIGURED'];
  if (entry.state !== 'verified' || !isConfigurationRecord(entry.record, facts.evaluatedAt)) {
    return ['CONFIGURATION_MALFORMED'];
  }
  const { record } = entry;
  const { observation } = record;
  const complete =
    observation.mainProtection.requiredApprovals >= 1 &&
    REQUIRED_FLAGS.every((path) => at(observation, path) === true);
  if (!complete) return ['CONFIGURATION_INCOMPLETE'];
  const publisher = observation.trustedPublisher;
  const consistent =
    record.repository === APPROVED.repository &&
    record.repository === facts.event.repository &&
    record.environment === APPROVED.environment &&
    record.environment === facts.environment.name &&
    record.workflow === APPROVED.workflow &&
    publisher.repository === APPROVED.repository &&
    publisher.environment === APPROVED.environment &&
    publisher.workflow === APPROVED.workflow;
  if (!consistent) return ['CONFIGURATION_MISMATCH'];
  const window = record.validationWindow.endsAt;
  if (window !== null && !notAfter(facts.evaluatedAt, window)) return ['CONFIGURATION_EXPIRED'];
  return [];
}

function isConfigurationRecord(record, evaluatedAt) {
  if (!isObject(record)) return false;
  const { observation, validationWindow } = record;
  if (!isObject(observation) || !isObject(validationWindow)) return false;
  return (
    record.schemaVersion === 1 &&
    CONFIGURATION_STATES.has(record.state) &&
    isTime(record.observedAt) &&
    notAfter(record.observedAt, evaluatedAt) &&
    filledKeys(record, ['scope']) &&
    isRepoRelative(record.reference) &&
    textKeys(record, ['repository', 'environment', 'workflow']) &&
    REQUIRED_FLAGS.every((path) => typeof at(observation, path) === 'boolean') &&
    Number.isInteger(observation.mainProtection.requiredApprovals) &&
    textKeys(observation.trustedPublisher, ['repository', 'workflow', 'environment']) &&
    (validationWindow.endsAt === null || isTime(validationWindow.endsAt))
  );
}

// Artifact tiers: state, then shape and the facts-derived tarball name, then retained
// bytes against a validated acceptance record. The expected name comes from candidate
// facts, so identity approval stays `IDENTITY_MISMATCH` and never changes the shape tier.
function artifactCodes(facts) {
  const { artifact, package: pkg } = facts;
  if (artifact.state === 'missing') return ['ARTIFACT_MISSING'];
  const expected =
    isText(pkg.name) && isText(pkg.version) ? expectedTarballName(pkg.name, pkg.version) : null;
  const shaped =
    artifact.state === 'present' &&
    expected !== null &&
    artifact.filename === expected &&
    isSha256(artifact.sha256) &&
    isCount(artifact.bytes);
  if (!shaped) return ['ARTIFACT_MALFORMED'];
  const { record } = facts.acceptance;
  if (!isAcceptanceRecord(record, facts.evaluatedAt)) return [];
  const retained = record.artifact;
  const equal =
    artifact.filename === retained.filename &&
    artifact.sha256 === retained.sha256 &&
    artifact.bytes === retained.bytes;
  return equal ? [] : ['ARTIFACT_MISMATCH'];
}

// Packed-input tiers: state, then algorithm and digest shape, then digest equality.
function packedInputsCodes(facts) {
  const { packedInputs } = facts;
  if (packedInputs.state === 'missing') return ['PACKED_INPUTS_MISSING'];
  const shaped =
    packedInputs.algorithm === PACKED_INPUT_DIGEST_ALGORITHM && isSha256(packedInputs.digest);
  if (packedInputs.state !== 'present' || !shaped) return ['PACKED_INPUTS_MALFORMED'];
  const { record } = facts.acceptance;
  if (!isAcceptanceRecord(record, facts.evaluatedAt)) return [];
  return packedInputs.digest === record.packedInputs.digest ? [] : ['PACKED_INPUTS_MISMATCH'];
}

// Pure evaluation. Preflight covers validation scope; publish adds publication scope.
// Sorting and de-duplication are the only ordering the blocker array guarantees, and
// independent groups report together. A preflight pass never means authorization.
export function evaluateRelease(facts) {
  assertFacts(facts);
  const codes = validationCodes(facts);
  if (facts.phase === 'publish') {
    if (facts.checks.validate !== 'pass') codes.push('CHECK_FAILED');
    codes.push(...configurationCodes(facts), ...artifactCodes(facts), ...packedInputsCodes(facts));
  }
  const blockers = [...new Set(codes)].sort().map(blocker);
  return {
    phase: facts.phase,
    decision: blockers.length > 0 ? 'blocked' : 'policy-pass',
    blockers,
    authorization: 'not-assessed',
  };
}
