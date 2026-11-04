# B2 core checkpoint

Parent: [Packet B](04b-preview-ci.md). Authority: [design section 8](../design.md#8-package-and-release-architecture), [npm delta](../specs/npm-distribution/spec.md#requirement-validated-version-tag-publication), [preview proposal](../proposal.md#one-time-first-npm-publication-bootstrap). This is enabling work for the minimal publishable preview, not publication readiness.

## Goal, baseline and ownership

Can supplied facts reject a subsequent preview with missing or inconsistent acceptance, configuration or artifact bindings without claiming actual authorization? Exact core assertions prove only that question. Native GitHub approval, npm OIDC and public delivery remain separate required external proof, not offline calibration outcomes.

- Existing path `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain. One change/branch/PR to `main`, no partial promotion.
- Current-unit baseline `397f1c725d85c160ab8ee4d453b73d915213a59b`. Prior B2 baseline `846047340f2f5b26b89525b4a2d09c3d8b764316`, original target base `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. B1 source `fdd7b755` is present. Core source is absent, not a ready downstream dependency.
- Serial owned Git window. Preserve all owner/unknown material and the original verified B1 tarball/manifest unchanged. No source, workflow, package, README, design, proposal, operations or real evidence-record edits in preparation.
- Closed seams are pinned in the implementation owner's `.scratch/preview-prep/private-ci-binding.md` sections 2-10 and 15. This live brief and runnable tests carry the bound core subset. No new fact or authorization mechanism is selected.

## Three sequential internal cuts

| Cut | Exact implementation source boundary | Prerequisite and verification |
|---|---|---|
| Core | ONLY `scripts/release-policy-core.mjs`, ceiling 260 gross | Present preparation plus combined review, then implement and independently verify core tests before collector consumption |
| Collector/CLI/artifact | ONLY `scripts/release-policy.mjs`, provisional ceiling 180 gross | Pin accepted core commit on this branch before setup. Import/re-export its identical bindings, add `collectReleaseFacts` and guarded CLI. Bind real temporary-git, tarball/manifest, phase and error cases before implementation |
| Workflow | ONLY `.github/workflows/release.yml` and selected `.github/workflows/ci.yml` formatting arguments, provisional combined ceiling 70 gross | Pin verified collector and runner commits, then structural tests plus later separately authorized actual GitHub execution |

Core owns exactly `APPROVED`, `VERSION_PATTERN`, `RELEASE_POLICY_SCHEMA_VERSION`, `PACKED_INPUT_DIGEST_ALGORITHM`, `ReleasePolicyError`, `expectedTarballName`, `computePackedInputs`, `readAcceptanceRecord`, `readConfigurationRecord`, `evaluateRelease`, with report section2 signatures unchanged. Only digest and the two readers perform read-only filesystem IO. No writes, child process, environment/clock read, network or top-level execution. `evaluateRelease` is pure. One import direction, entrypoint -> core, no cycle. Entrypoint re-exports the same bindings, including error-class identity, rather than redeclaring them.

The first cut enables no CLI, workflow or publishing consumer. Production never imports test helpers. Real acceptance/configuration records remain separately owner-authored from actual observations and charged when authored, never synthetic passed files. All future units retain 600 ceilings including their tests/docs/evidence. Their provisional source ceilings do not authorize omitted validations or unreadable compression. Whole-PR review remains separate.

## Runnable mapping and mandatory remaining obligations

One shared suite remains `tests/release-ci.test.mjs`, with synthetic data in `tests/support/release-policy-fixture.mjs`. Core cases import core directly. CLI keeps the entrypoint import. Existing workflow cases remain mandatory expected RED until their cut, never skipped to create an aggregate pass.

- `B2 policy` and `B2 core`: exact phase-scoped, sorted/deduplicated blockers, first-version refusal, schema/identity/time/rights/protection tiers, ancestor false/unknown only after valid passed matching acceptance, future acceptance malformed, old unchanged acceptance valid. Each mutation has unchanged-valid positive controls. Main membership never implies acceptance ancestry. Missing/incorrect fact types throw rather than inventing blockers.
- `B2 digest`: independent UTF-8 byte-order oracle, every installed file and five mandatory inputs, each optional `.npmignore`, `.gitignore`, `npm-shrinkwrap.json` added/changed/removed, non-input exclusions, unreadable input and junction rejection. These use only newly owned local fixture bytes, not retained artifacts.
- `B2 readers`: absent/bad JSON/valid records and non-readable record paths. Reader output omits collector-only `acceptance.ancestor`. The fixture supplies `ancestor: true` independently for pure policy tests.
- Next cut MUST add actual temporary-repository true/false/missing-main ancestry, status-only injection argv/error/skip cases, required collector phase/directories, preflight no-read assertions, actual tarball rehash/length, manifest schema2 contradictions/extra entries/mixed-candidate rejection, identical re-export bindings, guarded imports and CLI0/1/2. Pure supplied facts do not prove git or filesystem provenance.
- Test-owned `tests/release-pack.mjs` schema2 emission belongs to that collector/artifact cut after core availability and owner binding. It computes after installed assertions and before retention. Existing schema1 B1 bytes and manifest remain untouched. Schema2 helper controls already exist and stay mandatory. Later preview versions need their own authorized test/runner/version and acceptance binding, not the synthetic preview.2 value.
- Workflow cut updates the shared `commands` format list to include both source files. Do not change current B1 CI or its command calibration in this core cut. Workflow structure still cannot prove native protection, rights or actual npm authorization. Unknown/unconfigured operations block, authorization always remains `not-assessed`.

## Budget, review and run sequence

Before writing, allocation against current-unit base `397f1c7`: tests/helpers 180 + docs/evidence 80 + core source 260 + reserve 80 = 600 gross. Charge all additions plus deletions, including import rewrites and shared-suite corrections. This is a current incremental checkpoint, not a claim that the complete inherited core surface fits 600. Historical B2 preparation 451 gross/7 paths and earlier policy 549/workflow 222 forecasts remain visible in Packet B. The latter forecasts are superseded, not deleted or relabeled. Reconcile actual implementation size before dispatch, and stop for a safe further checkpoint if necessary. No cap waiver or whole-PR approval follows.

Windows PowerShell, project-local Node24.22.2 at `../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`. Native pure/static checks are representative and need no server or managed environment. No install/build/pack/network/auth run is needed here.

1. Syntax the changed test and fixture, scoped `git diff --check`, existing Prettier policy on owned paths (20s). Tests/OpenSpec are excluded, so claim policy execution only, not format coverage.
2. `node --test --test-reporter=tap --test-name-pattern=calibration tests/release-ci.test.mjs` (10s), then core selection `--test-name-pattern='B2 (policy|core|digest|readers)'` (20s), then full `tests/release-ci.test.mjs tests/release-artifact.test.mjs` (20s). Preserve missing-source/workflow RED. After source implementation, core selection must pass before the collector cut. Full suite remains RED while mandatory later cuts are absent.
3. Check relative live document targets. Record assertion counts/exits and cleanup separately in ignored `.scratch/preview-prep/b2-core/`. Preserve prior failed evidence. No retained-artifact rehash or unrelated application rerun.

Boundary Verification: design section8's normative acceptance/trust contract and supplied private report bindings require one combined boundary/test-only/decomposition review through coordination. Trigger checklist1YES (core records/digest feed collector),2YES (retained accepted bytes must stay unchanged),3NO,4YES (verification-to-publication chain),5YES (setup/proof split). No actual wire changes in core. Future GitHub/npm real-boundary proof remains mandatory, currently unexecuted. Configured rights and native OIDC are BLOCKED/not assessed, never mocked proof. Prepared tests are not implementation-ready until combined review passes.

Lifecycle next action: combined review, then separately authorized core implementation and independent verification. Worktree retained, cleanup removal not due. Only test-created fixture roots may be removed with finally/absence assertions. No unknown cleanup, credential/state access or actual CI/publication/live/stable claim.

## Preparation evidence - 2026-11-05

- Baseline/branch/index/ownership confirmed once at `397f1c7`, no concurrent Git writer. Existing 17 owner/unknown entries preserved. This commit changes tests and is not docs-only finalization. No source implementation or real records authored.
- Windows Node 24.22.2 syntax 2 PASS, scoped whitespace PASS and existing formatter policy PASS. Tests/OpenSpec are excluded, not formatter-proved. Readability reviewed. Local document targets 207 PASS, not anchors or remote URLs.
- Final calibration exit 0, 4/4 PASS. Core selection exit 1, 0 PASS/5 expected RED, each `ERR_MODULE_NOT_FOUND` for core. Full focused suite exit 1, 6 PASS/7 expected RED: five missing core, one missing entrypoint, one missing release workflow. Zero skipped/cancelled/todo. All post-import core/collector/CLI and real-workflow assertions remain UNREACHED, not passed. Earlier runs remain truthful retained evidence.
- Evidence `.scratch/preview-prep/b2-core/{final-calibration,final-core-red,final-full-red}.tap`, matching stderr, `final-exits.json`, `links.txt`. No install/build/pack/application/network/auth operation or actual CI execution. Unchanged B1 evidence remains bounded to its recorded revision/hash/assertion scope, with no new artifact claim.
- Cleanup separately: retention controls PASS and assert owned fixture absence in finally. Core digest/reader fixture setup is UNREACHED due to missing source, so no new roots/resources start there. No service starts. Evidence and original artifacts are retained, no unknown cleanup, worktree removal not due.
- Recommendation: ready for ONE combined review, not source implementation-ready or publication-ready. Required future collector/workflow tests are neither waived nor passed. Rights, native OIDC, actual CI and public delivery remain blocked/unverified. Whole-PR review is still open.
- Actual current-unit preparation 215 gross/5 paths against `397f1c7`: tests/helpers 148, docs/evidence 67, source 0. Adding reserved source 260 and reserve 80 gives 555 forecast, not demonstrated source fit. Historical 451 plus current 215 is 666 sequential gross across B2 preparation checkpoints, including all shared test churn. It is not a single-core fit claim or cap waiver. Previous policy 549/workflow 222 forecasts are superseded. B1 total 499 and shared 132 remain charged once as previously recorded.
