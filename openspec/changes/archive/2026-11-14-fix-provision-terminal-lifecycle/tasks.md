# Tasks

## Delivery and lifecycle

One independent change and one PR to `main`. Prerequisite: none.
Baseline: `2bbce072314fc046ad9c089514b386edb8a6957b` (fresh `main` and `origin/main`).
Mergeable outcome: provisioning releases its input activity without disrupting caller input.
Nearest landing blocker: finish active owner finalization, then one authorized CLI archive, final-head green CI and freshness-checked merge of [PR #18](https://github.com/renl/proceed-mcp/pull/18). Preview.8 alignment, independent complete-candidate unit/static review and prearchive exact-head Linux CI are complete.

- Path: `.worktree/fix-provision-terminal-lifecycle`
- Branch/change: `fix-provision-terminal-lifecycle`
- Lifecycle owner: test engineering
- Status: active, independent unit/static candidate review PASS. Candidate-specific deferred-proof acceptance recorded below.
- Next action: complete pending owner finalization, archive once through the authorized executor, then final-head CI and authorized fresh merge.
- Cleanup evidence: not eligible, no landed or abandoned outcome.

The user-visible success condition is regaining the shell after provisioning without Ctrl+C.
Unit stream behavior proves owned cleanup only, a proxy for installed natural exit.
The user has authorized this candidate's archive, final green CI and freshness-checked merge, followed by preview.8 npm publication, matching Registry update and global installation from clean merged `main`. This task finalization executes none of those actions. Provisioning must not be rerun. Never read, hash, overwrite or delete the existing token. Pairing, state and keys remain unchanged, as does npm `latest`.

## 1. Terminal lifecycle correction

- [x] 1.1 Add portable unit regressions and record baseline RED evidence using the command below.
- [x] 1.2 Correct `src/cli/terminal-input.js` under design decisions 1-3. Verify the focused unit suite passes without changing its assertions.
- [x] 1.3 Independently review the integrated candidate and rerun affected unit/static checks before owner delta review and archive. Code review, focused units, syntax, strict structural validation and scoped formatting pass. Execution and reused evidence are separated below.

Files to touch: `src/cli/terminal-input.js`, `tests/proceed-setup-cli-unit.test.mjs`, its existing `tests/fixtures/proceed-credential-memory.mjs` only if needed, and this change's artifacts. No production changes elsewhere are planned. Preserve all other work.

## Test mapping and sequence

Authority: [delta](specs/opencode-session-continuation/spec.md), requirement "Provisioning releases its input lifecycle without disrupting callers", and [design](design.md) decisions 1-3.

- First provisioning / failed provisioning: existing command units plus shared cleanup assertions cover successful input, cancellation, invalid/oversized input, EOF, read error and timeout. Add reader units for explicitly paused input, premature close, partial setup and persistence failure.
- Caller preservation: synthetic readable input remains open, retains caller listeners and delivers subsequent input without a caller restart after success/failure.
- Pre-acquisition refusal: existing private-mode and command prerequisite tests remain.

Run in the assigned worktree, Node >=24, Linux-portable commands, each bounded to 60 seconds:

1. `node --check tests/proceed-setup-cli-unit.test.mjs`
2. `node --experimental-test-module-mocks --test tests/proceed-setup-cli-unit.test.mjs`
3. `openspec validate fix-provision-terminal-lifecycle --strict`

Format only changed files with repository Prettier 3.9.10: `node node_modules/prettier/bin/prettier.cjs --check --ignore-path .gitignore src/cli/terminal-input.js tests/proceed-setup-cli-unit.test.mjs openspec/changes/fix-provision-terminal-lifecycle/`. The explicit ignore override includes tests and active artifacts excluded by `.prettierignore`. Use the installed pinned executable, not an unpinned download. Use `--write` only on owned files for correction, never format archives. The user subsequently authorized worktree-local `npm ci --include=dev --ignore-scripts`, completed before this final evidence refresh.

## Boundary and decomposition

The delta clarifies the public provisioning lifecycle. Architect design decisions 1-3 supply its ownership semantics. No wire, credential payload, exit-code or cross-component interface changes are proposed. Reader bookkeeping is private, not a new contract.

Boundary verification: one focused Architect conformance review of this mapping and tests against the new public lifecycle delta, combined with any necessary owner review. Native terminal behavior remains unverified under the unit-only restriction. No separate private-seam review.

Decomposition checklist: all five cross-unit triggers NO. One correction and one shared suite, no new cross-unit state, receiver, split proof or fixture dependency. No decomposition review is needed.

## Checks and evidence

- Pre-merge: focused units, syntax/format, structural validation and independent candidate review PASS within the recorded scope. Prearchive exact-head Linux CI PASS. Final archived-head CI and immediate head/target, required-check, review and mergeability checks remain required and unrun for the future revision. Failure owner: implementation for production failures, test engineering for test defects, delivery owner for landing checks. Trigger: finalization and merge.
- Pre-exposure: the project owner explicitly accepts this candidate's deferred Windows natural-exit proof for archive, merge and preview.8 delivery. This is scoped risk acceptance, not a passing native check or release-readiness qualification. Release owner must obtain a fresh authorized version-conflict check before publication and deliver from clean merged `main`.
- Post-deploy/deferred: owner manual Windows natural-exit and terminal restoration verification remains UNVERIFIED, not passed. Named risk: command may still retain a native resource despite unit cleanup. Owner: project owner. Trigger: a separately authorized safe manual check after deployment, or a new exit/restoration failure. Do not rerun provisioning or access the saved token to obtain proof. Installed/package execution and real external behavior for preview.8 also remain UNVERIFIED under the unit-only restriction, not inferred from earlier preview runtime proof.
- Baseline evidence: Node v26.13.0 on Windows, synthetic Linux memory dependencies. Syntax check PASS (exit 0). Final focused unit run exit 1, 43 Node records, 22 PASS / 21 FAIL including parent summaries, zero skipped/cancelled. Linux execution itself is not claimed.
- RED findings: idle input stays active after submit/cancel, explicitly paused input is not consumed without caller restart, partial raw acquisition is not restored, listener/prompt setup errors expose the synthetic exception, premature close retains activity, and command success/input failures/persistence failure retain reading. Already-flowing caller input continues on submit/cancel. No production code was edited.
- First exploratory run: 42 records, 23 PASS / 19 FAIL. One test-owner defect incorrectly required pausing input never acquired during private-mode refusal. Corrected to require activity release only after acquisition. Subsequent run and final timer-tracking run: 43 records, 22 PASS / 21 FAIL. These are red development runs, not verification passes.
- Historical `openspec validate fix-provision-terminal-lifecycle --strict`: exit 1 solely for the owner delta's requirement-text-length warning (>500 characters). Product author subsequently shortened the delta, and current strict validation passes.
- Historical formatter availability and strict-validation warning are superseded by the completed authorized bootstrap and final checks below. Earlier unrun/failed checks were not passes.

### Independent review of implementation

- Reviewed production revision `971db29b61b2a31ced4ad9d347ab5ee135ec1e40`, parent `2bbce072314fc046ad9c089514b386edb8a6957b`. The complete candidate also includes the five untracked files in this active change directory. A commit-only view omits proposal, design, delta, metadata and tasks. Preserve them for finalization.
- Input suite SHA256 matched `8299607C2137268436DBCFD11D665B353F70A2AEC681B89DFCA4D7711D3C05D5`. After identifying a concrete defect, test engineering added one bounded completion-output regression in the same suite. This test delta supersedes that input hash and requires correction/revalidation, not another test matrix.
- Original verdict at `971db29`: HOTFIX NEEDED. `src/cli/terminal-input.js:110` writes the final newline outside exception handling after setting `settled` and releasing the deadline. A synchronous output exception escapes the asynchronous input callback, exposes the original exception and leaves the returned promise pending. A finite synthetic-stream diagnostic confirms escaped output failure, unsettled promise, restored raw mode, paused input and zero reader data listeners. This preexisting path remains inconsistent with the change's failure-settlement and secret-free diagnostics obligations.
- Gap `PROVISION-OUTPUT-001`: corrected on attempt 1 and closed by the affected review below. Original correction: handle completion-output failure with secret-free rejection after ownership-limited cleanup, without changing established successful input behavior or weakening the regression.
- Executed `node --check` for production and tests: PASS. Executed the focused unit command above after the added regression: exit 1, 44 records, 43 PASS / 1 FAIL, zero cancelled/skipped. The one failure is `SETUP-LIFECYCLE: completion output failure rejects safely after releasing input`. Execution used Windows Node with portable JavaScript and memory dependencies, not Linux execution or native terminal proof.
- The existing 43 passing records cover idle/paused/caller-flowing cleanup, partial raw/listener/prompt setup, premature close, input failure/deadline, persistence failure and unchanged input safeguards. Owned resources are released in the reproduced output failure, but promise settlement and exception sanitization fail. Test streams are destroyed by test teardown. No external resource or runtime was acquired.
- Reused supplied implementation evidence: strict OpenSpec validation PASS for the current shortened product delta. This supersedes the earlier requirement-length warning. Structural validation is not behavioral proof.
- Formatting remains UNRUN. No installed dependency directory or repository-local Prettier/cache executable was found in the authorized worktree. The manifest and lockfile pin Prettier `3.9.10`. If separately authorized, the standard dev-dependency restore is `npm ci --include=dev --ignore-scripts`, then use `node node_modules/prettier/bin/prettier.cjs --check src/cli/terminal-input.js`. For the owned test/task files use `--ignore-path .gitignore` with explicit file paths because `.prettierignore` excludes `tests/` and `openspec/`. No install or external cache scan was performed.
- Production, specs and dependencies were not edited during review. Only the focused test and this evidence changed. Later archive/finalization is not yet performed or confirmed docs-only. Native Windows natural exit remains deferred and unverified, not passed.
- The inherited checkout status summary is stale. Coordination confirms the root status already records the authorized task and owns reconciliation. This is not an authorization ambiguity or an additional review gate.

### Affected correction review

- Candidate: `5149d2b2cc96b3fcc2491b82bc4ea007c61ddcf7`, parent `971db29b61b2a31ced4ad9d347ab5ee135ec1e40`, plus the five preserved untracked active change artifacts. Baseline remains `2bbce072314fc046ad9c089514b386edb8a6957b`.
- Independent verdict: CLEAN for the affected code and unit/static scope, conditional on completing the separate required formatter gate before finalization. The newline write is now caught after cleanup. Failure rejects with fixed `unavailable()` diagnostics and returns without parsing or resolving success. Existing cleanup ordering and caller ownership are unchanged. No contract delta or further production defect is identified.
- Regression SHA256 remains `F01B2143B97DB53DE3A088DE4E55A020A0B81308FA3F754BEFB52FBE568DA87C`, byte-identical to the test added during independent review and now committed. It checks non-escaping output failure, secret-free rejection, cancelled timer, restored mode, paused reusable input and listener removal.
- Reused current implementation evidence at this candidate: 44/44 focused unit records PASS, production/test syntax PASS and strict OpenSpec validation PASS. Node 26 on Windows with portable memory dependencies is not actual Linux execution or native Windows exit proof. No duplicate unit run was needed. Independent inspection verified the exact production delta, unchanged regression hash and clean `git diff --check`.
- Unchanged review findings and coverage from the prior pass remain valid. Assertion status: PASS in authorized unit/static scope. Cleanup status: unit resource assertions pass in reused evidence, no external runtime acquired, worktree cleanup pending landing.
- Product-author final delta review is APPROVED per the correction handoff. No repeat owner review or new review gate is required for this unchanged contract.
- Formatting is still UNRUN pending user permission for `npm ci --include=dev --ignore-scripts` and pinned Prettier 3.9.10. No dependency installation, runtime/token access, archive, merge or publication was performed. This review changes only task evidence.
- Remaining finalization: complete required formatting and any affected revalidation if code/tests change, finish active artifacts, obtain the existing required archive/landing authorization, execute one CLI archive inside the single PR and confirm the subsequent finalization delta is docs-only. Native natural exit stays deferred to owner manual verification after separately authorized deployment.

### Final formatted candidate evidence refresh

- Code revision remains `5149d2b2cc96b3fcc2491b82bc4ea007c61ddcf7`, against base `2bbce072314fc046ad9c089514b386edb8a6957b`. Selected evidence commit includes all five active artifacts (`.openspec.yaml`, proposal, design, delta and tasks) plus the mechanical test formatting. Root drafts are not candidate inputs.
- Approved worktree-local bootstrap `npm ci --include=dev --ignore-scripts` completed per supplied execution evidence. Manifest and lockfile are unchanged. Local Prettier reports `3.9.10`. Bootstrap reported 24 moderate vulnerabilities, with no remediation performed. This existing dependency diagnostic is a separate nonblocking risk, not a passed security qualification.
- Independent actual-diff review: production is unchanged from the code revision. Test formatting changes only layout of the completion-output regression, preserving every assertion, timeout and callback. Design table padding is owner-completed mechanical formatting only. Proposal, delta and CLI-created metadata retain their approved meaning. No test skips or weaker assertions were introduced.
- A format-equivalence diagnostic initially failed because it used Prettier API defaults rather than repository configuration. Repeating that diagnostic with `prettier.resolveConfig` passes: the current test is exactly the repository-configured formatting of the committed test. This was a diagnostic configuration error, not a failing product assertion.
- Final focused suite SHA256: `2D8856FCE5920A28EEE3BD277E527527ED36D1A1D5FA8FE1DF9A424299DEBFF9`. Reused supplied fresh post-format execution at this exact hash: `node --experimental-test-module-mocks --test tests/proceed-setup-cli-unit.test.mjs`, exit 0, 44 PASS / 0 FAIL, zero skipped/cancelled. Production and dependency inputs are unchanged. No ritual replay was needed.
- The 44 records include parent summaries, not 44 independent scenarios. Lifecycle additions exercise idle/paused/flowing input across submit/cancel, partial raw acquisition, listener installation, prompt output, premature close, persistence failure and completion-output failure. Existing safety cases remain in the same shared suite.
- Executed final refresh checks: production/test `node --check`, scoped pinned Prettier with the ignore override above, `git diff --check`, and `openspec validate fix-provision-terminal-lifecycle --strict` using installed CLI `1.15.0`: PASS. The exact design path also passes pinned Prettier independently. Structural validation is not runtime proof.
- Product-author delta approval is unchanged. `PROVISION-OUTPUT-001` remains CLOSED after correction attempt 1. No further owner rewrite, production edit or contract change was made.
- Current `.github/workflows/ci.yml:48` already selects this focused file with `--experimental-test-module-mocks`, under Ubuntu 24.04 / Node 24.22.2 and a one-minute step timeout. That selection reaches all current 44 records, including the lifecycle and output-failure additions. Actual Linux execution for this candidate is PENDING, not established by local Windows evidence. The workflow's format step checks only its own YAML, so scoped local formatting supplies separate evidence.
- Assertion status: PASS for the authorized unit/static candidate scope. Unit cleanup assertions pass in reused execution. No external runtime resources were acquired. Worktree lifecycle cleanup remains pending landing, not complete.
- Windows installed terminal natural exit/restoration remains DEFERRED and UNVERIFIED for owner manual verification after separately authorized deployment. No provisioning rerun, token/state/config/key access, installed-runtime inspection, build, pack, integration or e2e was performed.
- Version disposition: preview.7 is already public. A new preview.8 is needed for delivery of changed behavior. Manifest, lockfile, Registry metadata and README changes are outside this evidence refresh and remain for authorized owners. This candidate is unit/static reviewed, not release-ready or authorized to archive, merge, install or publish.
- Finalization after this review must be confirmed docs-only. Any later code, test, dependency, configuration, version or baseline change requires affected revalidation. Archive has not run.

### Authorized version alignment

- CoS version decision: `0.1.0-preview.8`, because `preview.7` is already public. Aligned only the existing coupled version values: `package.json` version, both `package-lock.json` version fields, both `server.json` version fields, and the two existing README version tokens (source pin and install command). All other words, claims and availability-neutral presentation are unchanged.
- Historical supplied lookup observations: the exact preview.8 registry URL reportedly returned HTTP 404, with preview.7 returning HTTP 200 as a positive control. The implementation handoff also reports a denied web-fetch request followed by another HTTP route. That route is not endorsed as authorized evidence and does not clear the publication gate. Version assignment comes from coordination, not a new availability check. Before publication, the release owner must obtain a fresh conflict check through an authorized native permission path. No lookup was repeated during independent review.
- No dependency resolution, install, repack or lockfile dependency edit occurred. The pre-existing approved local dependency state is preserved.
- Static checks on explicit paths: JSON parse PASS for `package.json`, `package-lock.json` and `server.json`, Prettier `--check` PASS for those three files plus `README.md`, `git diff --check` PASS.
- At the metadata checkpoint, stale test literals remained in `tests/release-metadata.test.mjs`, `tests/release-installed.test.mjs` and `tests/release-pack.mjs`. The independent reconciliation below supersedes that pending work. Non-unit suites remain unrun.
- Production source, tests and assertions are unchanged. This is a value-only version alignment, not a normative behavior change, and it carries no archive, merge, install or publication authorization.

### Complete-candidate preview.8 reconciliation

- Input clean HEAD: `f4e207fca43038d10bc242993a8234421d6c2e51`, parent `92f539f73086d3ddf00d2783b424c744205c999e`. Production remains `5149d2b2cc96b3fcc2491b82bc4ea007c61ddcf7`, base `2bbce072314fc046ad9c089514b386edb8a6957b`. This reconciliation commits only this task evidence and the three release test files.
- Changed exactly five expected constants from preview.7 to preview.8: two metadata unit literals, one installed-test literal and the pack version/filename pair. An exact-text comparison against input HEAD confirms version substitution only, with no assertion, skip, timeout or control-flow changes. Installed and pack suites were not executed.
- Independently reviewed the complete input delta: exactly five version fields in three JSON files and two README version tokens, plus task evidence. README meaning and availability caveat are unchanged. Dependency entries, production, workflow and lifecycle test inputs are unchanged from the prior reviewed checkpoint. No proposal, design, delta or baseline edits were made.
- Configured Prettier equivalence independently PASS: the current lifecycle test equals formatting of the code-revision test using repository configuration. Its SHA256 still matches `2D8856FCE5920A28EEE3BD277E527527ED36D1A1D5FA8FE1DF9A424299DEBFF9`. Reused the recorded post-format 44 PASS / 0 FAIL, zero skipped/cancelled result at that hash and unchanged production/fixture inputs. The 44-record suite was not rerun.
- Executed `node --test --test-reporter=tap tests/release-metadata.test.mjs`: exit 0, 9 PASS / 0 FAIL, zero skipped/cancelled, Windows Node `v26.13.0`. These are portable unit assertions, not actual Linux execution.
- Executed syntax checks for production, lifecycle test and all three changed release test files: PASS. Pinned Prettier `3.9.10` with `--ignore-path .gitignore` passes on production, lifecycle test, three release tests, three JSON files, README and the active change directory. `git diff --check` and installed OpenSpec `1.15.0` strict change validation PASS. Structural checks do not prove runtime behavior.
- Read-only CI review: `.github/workflows/ci.yml:48` selects the 44-record focused file, and line 60 includes the nine metadata units in its final selected-unit step. Both have one-minute timeouts on Ubuntu 24.04 / Node 24.22.2. Workflow unchanged. Exact-head Linux CI remains PENDING, not passed.
- Independent verdict: CLEAN for complete-candidate authorized unit/static scope, ready for draft PR preparation. Prior code review and product delta approval remain valid. Actual Windows natural exit, installed behavior, package execution and external boundaries remain deferred and UNVERIFIED. No runtime, pack, installed, integration or e2e proof is claimed.
- Assertion status: PASS within unit/static scope, with execution versus reuse separated above. No external runtime resources acquired. Unit cleanup assertions pass in reused evidence. Worktree cleanup remains pending landing. The previously reported 24 moderate dependency vulnerabilities remain unremediated baseline diagnostics, not security qualification or a new gate.
- Later finalization must stay docs-only or receive affected revalidation. Archive, merge, deployment, installation and publication remain separately gated. The release owner must resolve the fresh authorized prepublication conflict check. No network, token, state or runtime action was performed in this reconciliation.

### Prearchive freshness and candidate-specific decision

- Fresh read-only checks on 2026-11-14 confirm local HEAD and PR #18 head `367583b9b275c835b1e24168d6adc9693f775213`, PR base and live remote `main` `2bbce072314fc046ad9c089514b386edb8a6957b`. PR is OPEN, draft and MERGEABLE. Production `src/` is byte-unchanged from reviewed code `5149d2b2cc96b3fcc2491b82bc4ea007c61ddcf7` by `git diff --exit-code`. No production, test or dependency re-execution was needed for this evidence-only finalization.
- [Linux CI run 43602499783](https://github.com/renl/proceed-mcp/actions/runs/43602499783), exact head above, is COMPLETED/SUCCESS with `validate` SUCCESS. The focused step actually passes all 44 Node records, including parent summaries. The nine metadata unit records actually pass inside the existing final selected-unit group, not a separate nine-record CI job. The earlier PENDING entries are historical and superseded by this result. Current CI does not prove native Windows terminal exit.
- Reuse the unchanged independent complete-candidate review, focused assertion evidence and version-only reconciliation above. `PROVISION-OUTPUT-001` remains CLOSED after correction attempt 1. Completion-output rejection and resource cleanup assertions pass. README version alignment is complete for preview.8 without a new README behavior claim. README PR #17 remains independent.
- Decision source: the current summary in the canonical [status log](https://github.com/renl/proceed-mcp/blob/main/docs/status_log.md), recording the user's explicit PR #18 proceed authorization. Scope is this reviewed candidate against the base above, archive/final CI/fresh merge and subsequent preview.8 npm/Registry/global delivery with `latest` unchanged. The user accepts deferred Windows natural-exit/manual proof and the disclosed no-merge-queue timing risk. Acceptance is not PASS, does not establish installed operation, and does not waive failed required checks, branch protection, native permissions or production safety.
- Mitigation and review trigger: preserve ownership-limited cleanup and secret-free failure handling, require final-head green CI and immediate revision/check/review/mergeability verification before head-pinned merge. Stop on drift, conflicts or failed checks. Acceptance expires for an affected code, test, dependency, configuration or baseline change, or a newly observed native failure, pending affected revalidation and owner decision. Project owner owns deferred manual acceptance. Delivery owner owns fresh landing and publication checks.
- The 24 moderate dependency vulnerabilities remain unremediated baseline informational diagnostics. No remediation or security qualification is claimed. Approval does not weaken credential, state, pairing or key protections.
- Task criteria and test mapping are unchanged. Other owners' pending proposal/design/delta finalization must finish before archive. Preserve their dirty files. All in-folder content and move-stable links must be final before the move. The relative delta/design links above survive the archive move. [PR #18](https://github.com/renl/proceed-mcp/pull/18) is the durable pointer for subsequent final-head, merge and cleanup evidence, which must not be backfilled into archived tasks.
- Assertion status: PASS only for the recorded unit/static scope. Deferred native/runtime status: accepted risk, UNVERIFIED. Cleanup status: unit assertions pass, no external resources acquired by this finalization, worktree cleanup pending verified landing. Archive, final CI, merge, publication and installation have not been performed by this task.

## Workflow follow-up

- Independent review, prior product delta approval, formatter gate, preview.8 alignment and prearchive exact-head CI are complete. Pending owner finalization must finish before the authorized executor performs one CLI archive inside PR #18.
- Confirm the archive/finalization delta is docs-only or revalidate affected inputs. Pass final-head CI and fresh landing checks before the already authorized merge. Record later evidence on PR #18 or the live status log, never inside the archive.
- Verify landing and safely remove the worktree afterward. Cleanup remains pending, not completed by archive or merge authorization.
