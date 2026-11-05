# Final candidate selection and owner-file handoff

Parent: [tasks](../tasks.md). Local verification: [CI alignment verdict](04d-preview-ci-alignment.md#independent-scoped-verdict---2026-11-05). This is an assessment and file-bound handoff, not integration, archive or publication authority.

## Pinned state and exact selection rule

- Source `97ce4250eea450f842ded4ccad78ef387aa9a6c8`, parent `07801b703ca80d3fc10df0ce7c16ce928edfdaa5`. Target local/main, origin/main and bounded live remote read agree on `de1c58021f4df25b03551faeb1b26958852275a7`. Source has329 implementation-only and2 main-only commits. Original common base `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No stacked child or second delivery PR.
- Recommended selection is the complete tracked source tree at that exact source SHA, plus ONLY the owner-approved working replacements listed below and this scoped evidence commit. `git ls-tree -r --name-only 97ce4250eea450f842ded4ccad78ef387aa9a6c8` is the exact committed path manifest, not a glob over the filesystem. Existing inventory plus the affected-delta ledger below describes its target comparison. No committed path is silently omitted. This explicitly includes inert deferred automation and historical tests/specs, not just shipped npm files.
- Selection is provisional for the owner files and whole-PR review disposition, not permission to stage all tracked dirt. Do not use `git add .`, `git add -A`, directory-wide staging or inferred ownership. Prepared scripts are already committed and WILL appear in the PR even if never staged again.
- Root checkout is `chore/project-workflow` at `f3854097`, not main. Its untracked copies of proposal/design/tasks/specs/research/generated integration are older coordination material, not replacements for implementation artifacts. Preserve root `.gitignore` dirt, nested worktree and other untracked root files. Never stage the root `.worktree/` directory.

## Owner-file commit list, all inside the implementation worktree

| File | Required disposition before integration/finalization |
| --- | --- |
| `openspec/changes/add-telegram-approval-opencode-v2/proposal.md` | Product owner confirms reconciled manual-preview scope, then exact-file commit |
| `openspec/changes/add-telegram-approval-opencode-v2/specs/telegram-approval/spec.md` | Product owner confirms exact working delta, then exact-file commit |
| `openspec/changes/add-telegram-approval-opencode-v2/specs/opencode-session-continuation/spec.md` | Product owner confirms exact working delta, then exact-file commit |
| `openspec/changes/add-telegram-approval-opencode-v2/specs/npm-distribution/spec.md` | Product owner confirms exact working delta, keeping Registry pending separately, then exact-file commit |
| `openspec/changes/add-telegram-approval-opencode-v2/design.md` | Architecture owner confirms reconciled working design, including unresolved support-policy wording, then exact-file commit |
| `README.md` | Current working bytes equal main's merged README. Commit those exact bytes before integrating main. A later owner correction must distinguish supplied first use/public-byte proof from independent acceptance, without changing commands or immutable package bytes |
| `AGENTS.md` | Coordination owner must supply a stable implementation/landing index. Existing dirty worktree copy has stale Current Work. Root stable map has worktree-prefixed links that cannot be copied unchanged to landed main. Preserve historical facts in status before removing stale status from this file |
| `docs/status_log.md` | Coordination owner combines canonical root current summary/history with unique worktree history. Existing dirty worktree log is NOT the current root log. Preserve both histories, do not overwrite one with the other. Commit the resulting owner-approved implementation copy |
| `openspec/changes/add-telegram-approval-opencode-v2/tasks.md` | Commit only test-owner criteria/evidence and later truthful dispositions, not blanket completion |
| `openspec/changes/add-telegram-approval-opencode-v2/slices/04d-preview-ci-alignment.md` | Commit independent local verdict |
| `openspec/changes/add-telegram-approval-opencode-v2/slices/04e-final-candidate-selection.md` | Commit this selection/remaining-gate assessment |

The four product files and design are reconciled but still uncommitted. That reconciliation is not the later canonical delta review. README's live-unverified claims need owner reconciliation. Root coordination documents are inputs to their owners, not a second independently staged delivery set.

Preserve without selecting these nine untracked implementation files: `docs/operations/integration-readiness.md`, `openspec/changes/add-telegram-approval-opencode-v2/assistant-schema-research.md`, `openspec/changes/add-telegram-approval-opencode-v2/slices/02d-containment.md`, `openspec/changes/add-telegram-approval-opencode-v2/slices/02e-review-plan.md`, `tests/fixtures/containment-tree.mjs`, `tests/support/containment-job.cs`, `tests/support/containment-job.ps1`, `tests/support/windows-containment.mjs`, `tests/windows-containment.test.mjs`. Operations needs its owner's explicit selection confirmation and disclosure review before inclusion. Other eight remain excluded from delivery, not deleted or abandoned. Repair any selected live link to an excluded operations file through its owner. Ignored artifacts, runtime state and scratch are preserved and never staged.

## Review size and concrete split assessment

These are gross additions plus deletions, not net growth or estimates of effort. Reuse the prior `.scratch/candidate-reconciliation-b78d5c9612f747caacaff033f7afff9e/current-inventory.json`321-path/49891 inventory against target main. Update only affected entries:

| Entry | Prior gross | Current gross before this evidence |
| --- | ---: | ---: |
| `tests/release-ci.test.mjs` | 792 | 699 |
| `tests/release-preview-ci.test.mjs` | 0 | 113 |
| `tasks.md` | 764 | 765 |
| `slices/04d-preview-ci-alignment.md` | 0 | 65 |
| `design.md` | 964 | 976 |
| `proposal.md` | 183 | 185 |
| `specs/npm-distribution/spec.md` | 161 | 178 |

All other inventory entries retain their counts, including workflow33 and README0 against main. Updated selected working tracked surface before this evidence:323 paths/50008 gross. Including this evidence:324 paths/50082 gross, before future owner/archive edits. This is the sole change against its target and also the cumulative unmerged surface, not a child packet plus charged ancestors. The immutable committed source alone still contains the stale README and owner artifacts. Its corresponding count is324 paths/49307 gross, derived by substituting the eight dirty-file HEAD counts, including README514. Working replacements remove that README difference rather than adding a second README delivery.

- Internal reviewable cuts already exist: preview test preparation300, source correction2, and this evidence packet. Accepted release-core checkpoints separate schema/readers, evaluator correction and digest with their own runnable proof. These permit focused independent review while preserving one final PR. They do NOT reduce the final PR's measured surface or grant a whole-PR exception.
- A genuinely separable enabling unit is the inert offline release core: exactly `scripts/release-policy-{schema,records,evaluator,digest,core}.mjs` (493 source lines), corresponding accepted core tests currently embedded in `tests/release-ci.test.mjs`, `tests/support/release-policy-fixture.mjs` and core slice history. It has no bin/src consumer. To extract it safely requires test-owner separation of shared preview/core/deferred tests and owner-defined spec/history attribution. Even before those tests/docs,493 source lines leaves107 of600. It is not a demonstrated within-limit standalone PR, and a new change is outside this finalization authority.
- Runtime-preview extraction can exclude inert automation from the final tree through authorized forward removals while preserving its commits in history. It must retain all shipped bin/src/license/metadata, complete matching public tests, pack/install runners and this reconciled change. It cannot be package-only because main has no runtime. Runtime alone42 files/13128 lines already exceeds both thresholds before tests/docs. Thus removing automation does not solve whole-PR fit. It adds removal/dependency/reverification work and risks losing traceability if done without owner selection.
- Separate foundations, broker/Telegram and distribution deliveries could reduce each review boundary only through new independently scoped outcomes, contracts, tests and parent-first archives. They are not ordinary internal slices of this existing change, would alter approved delivery order and could leave an unexposed/incomplete preview. No evidence here establishes all those new PRs fit600/20. Do not invent those scopes or a second completion PR.

Recommendation: preserve the coherent preview and inert history in the existing single change. Full manual-preview authorization is not a numeric whole-PR exception. Remaining blocker is the whole-PR review disposition after owner-file selection and archive/link-repair forecast are exact. Do not ask for a cap exception using50008 as a final count: this evidence, owner index/status/README corrections and CLI archive/spec output are still to be charged once. If smaller independently landing changes are required, obtain separate scope authority and owner decomposition before execution, not selective staging on this branch.

## Non-destructive integration prerequisites and sequence for implementation owner

1. Obtain file confirmations above, explicit main-integration authority and whole-PR disposition. Recheck source descendants are only the approved evidence/owner documents. No source/test/dependency/config change can inherit the local verdict without affected revalidation. Commit owner-approved exact files, including README identical to merged main, before merge. Do not stash or discard ambiguous dirty files to make a merge run.
2. Account for every remaining dirty tracked file explicitly. Unknown untracked files remain preserved in place. If Git reports an overwrite/conflict, stop. Refresh target once immediately before integration and require expected main `de1c58021f4df25b03551faeb1b26958852275a7`, or return target drift for assessment.
3. On `add-telegram-approval-opencode-v2`, under separate authority, use a normal merge of that exact main SHA, never rebase/reset/cherry-pick the implementation onto main. This preserves the full branch/history and merged README. The precommitted README equals main, so no old README should return. Any conflict goes to the file owner. No blanket ours/theirs resolution. Review the merge result's diff and pin its SHA and target.
4. Independently verify the assembled candidate using the [04d run sequence](04d-preview-ci-alignment.md#run-sequence-and-remaining-acceptance): cheap gates, exact preview command, focused version/catalog, full PORT-A/B public offline suite and maintained pack/install where packed README changed. Reuse unchanged native/P3, supplied live and exact public-artifact proof within their limits. New checkout pack is not the immutable published artifact. No aggregate npm test, deferred-driver restart or live Telegram repetition.
5. Actual PR job/pin provenance, Windows2025 Node24.22.2 availability and npm sibling-path layout remain unproven until real evidence. A local parsed-YAML PASS does not discharge them. Report expected required checks that are missing as pending/blocking, not passed. Registry schema/auth/listing is a separate approved pending delivery, not the deferred automation and not a passed check.
6. After integrated PASS, route canonical owner delta review. Finish active task dispositions and move-stable evidence links without labeling deferred failures passed. Obtain separate authorization for the single CLI archive on this branch. Inspect its output, then repair only live links and confirm the post-verification delta is docs-only. No manual spec sync, archive bypass, archived-content repair or new completion PR. Landing/publication remains separately controlled.

Assertion status here: local CI correction PASS only. Resource cleanup: reached native fixtures PASS separately. Lifecycle remains active/retain under test-engineering ownership. No resources launched, no unknown cleanup and no full-worktree cleanup-ready claim.
