# Tasks

Parent: [proposal](proposal.md). Contract: [design](design.md) and both change-local capability deltas.

## Delivery and lifecycle

Mergeable outcome: one independent Windows setup-and-subsequent-storage change with ordinary OS access, existing data preserved and POSIX protection unchanged. Nearest landing blocker: portable regression specification and combined architecture review before implementation, followed by independent candidate review and candidate-specific landing acceptance for unrun native proof.

One change, one worktree, one PR into `main`. No parent dependency. Baseline: `main` at `cff114570f250595f73774edd403996a6dbae5f7`. Internal checkpoints are not separate PRs.

| Field            | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Path             | `.worktree/simplify-windows-storage-admission`                                          |
| Branch / change  | `simplify-windows-storage-admission`                                                    |
| Owner            | Test engineering                                                                        |
| Status           | active, expected RED regressions authored, combined review pending                      |
| Next action      | Coordination routes one combined architecture review, then implementation               |
| Cleanup evidence | Not eligible. Retain until proven landing or explicit abandonment with recoverable work |

Founder-visible success: Windows operators can initialize and continue normal approval use without custom file-permission preparation or loss of existing authority/data. Direct proof is an installed normal first approval and subsequent reuse. Controlled memory unit assertions are supporting proof of specified caller behavior, not native Windows, installed first-use or Telegram proof.

## 1. Portable specification and shared storage outcome

- [x] 1.1 Author memory-only JavaScript unit regressions in `tests/windows-storage-node-unit.test.mjs`, mapping the changed Windows admission scenarios to shared callers and retained integrity/POSIX safeguards. Verify expected RED against the pinned baseline without actual storage, native queries, processes or network.
- [ ] 1.2 Replace obsolete permission-query expectations, not retained correctness assertions. Review the fake's operation order and failure mapping with architecture together with the boundary block below before implementation.
- [ ] 1.3 Implement design decisions 1-4 throughout the complete caller inventory. Verify ordinary Windows init, owner addition, existing config/local credentials, ownership lifecycle, operator keys and journal recovery/mutation through the unit suite. No initialization-only bypass or successful protection stub.
- [ ] 1.4 Preserve access denial, wrong kind, redirection, identity replacement, exclusive-create collisions, flush/integrity failures and conservative cleanup. Verify negative unit assertions and unchanged POSIX policy assertions. Existing authority, pairing, TLS, capability and principal suites retain their scope.
- [ ] 1.5 Update concise README and coupled preview.9 metadata, with matching unit expectations in existing release/package tests. Verify ordinary-access disclosure, key theft/record tampering warning, POSIX distinction and exact-version availability instructions without publication claims.
- [x] 1.6 Add only the new unit test paths, if any, to the existing `.github/workflows/ci.yml` command selection. Preserve check identity, action pins, permissions, versions, flags, timeouts and format-before-unit ordering. No new file is introduced. The existing selected Windows and metadata suites are already included, so the workflow is unchanged.

## 2. Integrated candidate verification

- [ ] 2.1 Run scoped pinned formatting, syntax, selected portable units and strict OpenSpec validation in the worktree. Record exact revision, commands, counts and failures separately from unrun checks.
- [ ] 2.2 Independently review the immutable complete candidate against the design caller table and both deltas. Verify no new POSIX prerequisites, no dormant custom Windows protection subsystem and no production dependency on test doubles. Record candidate-specific landing/exposure decision through the status owner.
- [ ] 2.3 Obtain declared spec-author delta review after independent candidate verification. Confirm later finalization is docs-only or revalidate affected evidence before archive/merge.

## Files and test mapping

Production allowlist: `src/state/{protection,path-trust,store,files,credentials,owner-credentials,ownership}.js`, `src/harness/operator-key.js`, `src/journal/journal.js`, `src/broker/{portable-runtime,runtime}.js`. `src/state/credential-file.js` is comment-only if touched. Matching `README.md`, `package.json`, `package-lock.json` root version entries and `server.json` may change for preview.9. No dependency change or unrelated cleanup. Tests and this tasks file are test-engineering-owned.

All IDs below are prefixes in `tests/windows-storage-node-unit.test.mjs`, except `PREVIEW-*` in `tests/release-metadata.test.mjs`. `tests/proceed-credential-windows-unit.test.mjs` replaces its obsolete shared-query fixture assertion with ordinary directory admission without a query. All token storage assertions and the shared token fixture remain unchanged. `tests/release-installed.test.mjs` and `tests/release-pack.mjs` receive only coupled preview.9 expectations. They are not executed under the unit-only restriction. Canonical unit command is step 3 below, with metadata units added after the implementation's version update. Evidence is the setup record below, then the implementation/candidate record appended before archive.

| Delta requirement / scenarios                                                         | Design                                           | Runnable assertions                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Windows state and credential admission verifies required protection`, both scenarios | Decisions 1-3, full caller table                 | `WIN-ORDINARY`, `WIN-LEGACY`, `WIN-RUNTIME`, `WIN-OWNERSHIP`, `WIN-KEY`, `WIN-JOURNAL`: ordinary access succeeds, foreign mode/UID and unavailable query do not block, no query/process/chmod                                      |
| `Windows protection correction preserves existing storage`, existing-state scenario   | Decisions 3-4                                    | `WIN-ORDINARY` snapshots unchanged loaded data, `WIN-PRESERVE` collisions/exact-instance release, `WIN-OWNER` record blocks mutation, `WIN-ROLLBACK` replacement/unknown subtree retained                                          |
| `Startup preserves local authority and truthful readiness`, local failure scenario    | Decisions 1, 4-5                                 | `WIN-IO`, `WIN-INTEGRITY`, `WIN-ATOMIC`, `WIN-JOURNAL`: actual access/kind/link/identity/flush/corruption failures refuse, sequence does not advance, no private bytes for known invalid opened objects                            |
| Same Windows requirement, unchanged POSIX/token clauses                               | Decisions 1, 3-4                                 | `POSIX` mode, UID, ancestor and chmod assertions, plus absence of new POSIX reader/journal gates. `TOKEN` syntax/input assertions support unchanged dedicated token suites                                                         |
| `Public package and explicit prerequisites`, current-source and replacement scenarios | Minimal allowlist, diagnostics and compatibility | `PREVIEW-*` coupled preview.9 identity and unchanged publisher/argument assertions, existing `PACKAGE-LIFETIME` no install hook/state bundling. README disclosure remains focused independent review, not a regex proof of runtime |
| `First-use and restart preserve the approval workflow`, first approval/reuse          | Verification and handoff                         | Units are supporting caller proof only. Installed approval, actual native storage and reboot reuse remain deferred/unverified, not implied by memory assembly                                                                      |

Review order for this coherent large change: approved policy/deltas, shared storage correctness and POSIX split, config/credential writes and rollback, ownership/key read/create/release, journal mutation/upgrade, runtime admission ordering, README/metadata. Keep each caller's tests with that review unit and one final integrated candidate review. Large source/test deletions retire the superseded Windows query/descriptor subsystem, not retained integrity assertions. Advisory review-size signals are not a cap or a new approval request.

## Boundary Verification

Category: changed normative cross-component storage contract plus affected real filesystem boundary. No new network/wire contract. Unchanged TLS/Telegram/MCP interfaces need no new wire harness.

- Authority: design decisions 1-5 and caller table. Names, private factoring and injection belong to implementation engineering. Tests call existing exported operations and replace only Node effect boundaries.
- Windows observations: ordinary non-following kind, contiguous ancestry, handle/path identity before bytes and destination re-observation before success. Permission metadata/query availability cannot decide admission. A process/query/chmod observer fails if used.
- POSIX: preserve existing call-site modes, UID, ancestor checks and chmod. Do not turn removed Windows-only snapshots into new POSIX prerequisites. Token policy remains separate.
- Real-boundary proof: native Windows I/O, POSIX enforcement, crash/flush and installed first-use are deferred and unverified under the unit-only project restriction. Unit observations are not a substitute or an implicit landing waiver.
- Combined review requested: boundary fidelity, test-fake fidelity and decomposition. Checklist 1 YES (shared storage observations consumed across callers), 2 YES (rollback must preserve clean/preexisting state), 3 NO (no new receiver), 4 YES (caller coverage plus preservation), 5 NO (fixtures and assertions stay in each isolated test). Review all together once before implementation.

## Checks and run sequence

Commands use Node/npm and are portable to Linux and Windows shells. Run from the assigned worktree, with finite command timeouts. Never run `npm test` or wildcard selections because other repository tests own real resources.

1. `node node_modules/prettier/bin/prettier.cjs --ignore-path .gitignore --check tests/windows-storage-node-unit.test.mjs tests/proceed-credential-windows-unit.test.mjs tests/release-metadata.test.mjs tests/release-installed.test.mjs tests/release-pack.mjs openspec/changes/simplify-windows-storage-admission/tasks.md` (explicit ignore path includes owner-formatted files excluded by the default `.prettierignore`). Use the same scoped command with `--write` to format. Add changed production/README/metadata paths to the scoped check during implementation.
2. `node --check tests/windows-storage-node-unit.test.mjs`
3. `node --experimental-test-module-mocks --test tests/windows-storage-node-unit.test.mjs`
4. Follow the explicit unit-only file selections already maintained in `.github/workflows/ci.yml`, retaining each selection's Node flags. Run affected release/package units after the preview.9 metadata update, not before it.
5. `openspec validate simplify-windows-storage-admission --strict`

| Timing       | Check / status                                                                                                                                 | Failure, owner and trigger                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-merge    | Combined review, scoped format/syntax, selected units, strict structural validation, independent complete-candidate review, owner delta review | Open until evidence exists. Engineering owners correct through coordination                                                                                                              |
| Pre-exposure | Candidate-specific decision on native/installed proof                                                                                          | Unverified Windows ordinary-access behavior and POSIX enforcement. Product owner decides landing/exposure scope after candidate evidence, prior preview acceptances do not carry forward |
| Post-deploy  | Owner manual installed setup/reuse and first useful approval                                                                                   | Unverified terminal privacy, native I/O, restart and actual Telegram result. Operator, only after separately authorized deployment, never replay saved-token provisioning                |
| Deferred     | Native filesystem race/durability, login/reboot and multi-harness checks                                                                       | Unverified platform behavior. Test engineering/operator, when non-unit testing is authorized                                                                                             |

## Setup evidence

- Fresh root reconciliation: `main`, `origin/main` and HEAD all equal the pinned baseline. Only the known status edit and untracked change/worktree/operations paths were present. No unexpected tracked production change. Existing unrelated material was preserved.
- Pinned CLI reports `1.15.0`. Root status/instructions reported proposal/specs/design done and tasks ready before authoring. Worktree creation pinned the same baseline. All six copied change files, including CLI metadata and owner artifacts, matched byte-for-byte immediately after transfer. Only the test-engineering-owned tasks file changed afterward.
- Routine `npm ci --include=dev --ignore-scripts --no-progress` succeeded from the unchanged lock. It reported 24 moderate dependency vulnerabilities. No remediation, dependency change or security qualification is claimed.
- Node `v26.13.0` on Windows ran only portable unit code. Synthetic platform, environment, UID, filesystem and child-process bindings prevent native storage/query/process access. This is not actual Linux CI evidence.
- Final setup command: `node --experimental-test-module-mocks --test --test-reporter=tap tests/windows-storage-node-unit.test.mjs tests/release-metadata.test.mjs tests/proceed-credential-windows-unit.test.mjs tests/proceed-credential-posix-unit.test.mjs`. Exit 1, 235 Node records, 170 PASS, 65 expected RED, none skipped/cancelled/todo. Parent/subtest failure records are included in Node totals, not independent defect counts. Final output: ignored `.scratch/setup-red/final.tap`.
- RED reasons: baseline custom Windows admission still queries/refuses before the downstream operation, misleading NTFS/protection guidance is rejected, and release metadata still says preview.8. The POSIX and unchanged token behavior assertions pass. Downstream Windows assertions remain unproven until implementation reaches them. No successful implementation or native first-use claim.
- Earlier authoring runs exposed and corrected a synthetic POSIX UID assumption and corrected-version metadata fixture setup. Default formatter exclusions were detected and replaced with the explicit scoped ignore-path command. Current evidence supersedes earlier authoring counts, not an implementation failure.
- Scoped Prettier 3.9.10, syntax checks for all five changed JavaScript test files, `git diff --check` and strict OpenSpec validation PASS. Worktree CLI status reports planning artifacts complete. Apply instructions correctly report 2/9 tasks complete, 7 remaining, not implementation complete.
- Combined review remains pending. No production code, dependency, README, workflow, current baseline spec or archive content was edited. Publication, install, runtime mutation and non-unit execution remain unauthorized.

## Workflow follow-up

- After candidate verification, owner review and explicit authorization, implementation engineering runs the one CLI archive inside this PR. Do not edit archived content.
- PR merge, publication, installation and runtime actions require separate authority.
- Test engineering retains lifecycle responsibility through proven landing or explicitly authorized preserved abandonment, then safe registry/directory/branch cleanup.
