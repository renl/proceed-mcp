// Core facade for the release policy: the one import surface the collector, CLI
// and tests share. Every name below is re-exported unchanged from a leaf, never
// redeclared, because a second ReleasePolicyError class would split the CLI exit
// mapping by whichever module threw. Leaf helpers stay off this surface.
//
// This is the foundation checkpoint: it holds the identity constants, the error
// class, the tarball-name function and the two record readers. The evaluator and
// digest checkpoints add their own leaves and extend this list. The facade has no
// top-level execution, no filesystem, process or network access of its own and
// enables no CLI, workflow or publishing consumer.
export {
  APPROVED,
  VERSION_PATTERN,
  RELEASE_POLICY_SCHEMA_VERSION,
  PACKED_INPUT_DIGEST_ALGORITHM,
  ReleasePolicyError,
  expectedTarballName,
} from './release-policy-schema.mjs';
export { readAcceptanceRecord, readConfigurationRecord } from './release-policy-records.mjs';
