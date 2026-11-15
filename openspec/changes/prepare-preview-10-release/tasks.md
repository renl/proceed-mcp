# Tasks

Prepare a consistent source identity for `@meshimize/proceed-mcp@0.1.0-preview.10`.
This enables subsequent npm and MCP Registry publication from clean merged `main`.
It proves version coupling only, not publication, installation or runtime qualification.
Scope and criteria: [proposal](proposal.md), [design](design.md).

## Delivery and lifecycle

- One change, one branch and one PR targeting `main`. Baseline: `a26897ae6b4b764988b4494b8992c4f1b25dd6ee`.
- Worktree: `.worktree/prepare-preview-10-release`. Branch/change: `prepare-preview-10-release`. Owner: test engineering.
- First mergeable outcome: coupled preview.10 source versions, documentation and existing expectations only.
- Nearest landing blocker: version alignment, passing metadata units, independent candidate review and existing CI.
- Status: setup ready. Next action: software engineering metadata edits and documentation maintenance README edits, then independent review. Cleanup pending, no removal performed.
- No new behavior, normative contract, interface, package-content policy or wire changes. Boundary review is not triggered. Decomposition checklist 1-5: no genuinely changed cross-unit obligations or split proof chain. Routine unchanged version coupling is checked on the complete candidate.

## 1. Coupled release identity

- [x] 1.1 Test engineering: change only three current-version literals in `tests/release-metadata.test.mjs` to preview.10. Preserve all negative controls and assertions. Verify syntax and expected RED against preview.9 source.
- [x] 1.2 Test engineering: mechanically maintain only two version/filename pins in `tests/release-pack.mjs` and one manifest-version pin in `tests/release-installed.test.mjs`, as authorized by the design. Verify the literal-only diff and syntax. Do not execute either non-unit suite.
- [x] 1.3 Record the approved no-behavior decision as top-level `skip_specs: true` in `.openspec.yaml`, preserving `schema` and `created`. Verify pinned CLI status and strict structural validation without a delta or baseline spec edit.
- [ ] 1.4 Software engineering: edit only `package.json` top-level `version`, `package-lock.json` top-level `version` and `packages[""].version`, and `server.json` listing and npm entry versions to preview.10. Verify the focused metadata unit suite passes and review the five-field diff with no dependency or other metadata changes.
- [ ] 1.5 Documentation maintenance: edit only README source-version statement and exact npm install pin from preview.9 to preview.10. Preserve availability caveats, all client setup and historical evidence. Verify the two-literal diff and scoped formatting.

## 2. Integrated candidate

- [ ] 2.1 Independently review the immutable complete candidate against the baseline and exact allowlist. Run focused metadata units and scoped static checks in the sequence below. Record head, target, assertion results and unrun checks before owner final review or archive.
- [ ] 2.2 Confirm existing exact-head permitted CI passes, including its existing metadata unit selection. No CI edits or broad test execution. Confirm later finalization is docs-only or revalidate affected inputs.

## Checks and sequence

1. Cheap static: `node --check` on each of the three changed test files, then pinned Prettier 3.9.10 `--check` on explicit changed paths only. Reuse an existing registered repository worktree's pinned formatter if necessary, without installation. Never format owner proposal/design files.
2. Unit: `node --test --test-reporter=tap tests/release-metadata.test.mjs`. This Linux-compatible Node suite reads repository metadata and uses the pure argument parser. No runtime, token, state or client access. Setup expects RED before task 1.4. After tasks 1.4-1.5 it must be green.
3. Structural: `git diff --check` and `openspec validate prepare-preview-10-release --strict`, using CLI 1.15.0. Review exact changed/untracked paths and owner-file preservation. Structural success is not runtime proof.
4. Independent review, existing CI and primary-author final no-delta review precede the separately authorized archive and merge.

| Gate | Required evidence or explicit unverified disposition |
| --- | --- |
| Pre-merge | Five source fields and two README pins align, metadata units pass, scoped static/strict checks pass, independent review and existing exact-head CI pass. Owners: software engineering, documentation maintenance and test engineering. Trigger: complete candidate. |
| Pre-exposure | Operations separately admits the changed preview.10 artifact and verifies publishing prerequisites from clean merged `main`. Not performed here. Preview.9 hashes cannot qualify new bytes. Failure: unqualified or unavailable artifact. Owner: operations. Trigger: authorized publication. |
| Post-deploy/publication | Exact-version npm public readback and distinct Registry delivery evidence belong to operations. Installation is not authorized by this preparation and is not runtime proof. Trigger: publication or separately authorized deployment. Unrun here. |
| Deferred | Pack/installed suites, real wire, multi-directory, native/client/broker and first-use checks remain unrun/unverified under the unit-only restriction. Owner: test engineering for later permitted automated verification and operator for manual first use after deployment. Trigger: explicit permission or owner manual verification after deployment. Older owner-conflict probes are unchanged out-of-scope debt, not a passing broad-suite claim. |

No new tests, harness, framework, dependencies, tool pins, CI, runtime source, specs, archive, status log, AGENTS or global configuration edits are part of this brief. Do not run skill tests, broad `npm test`, non-unit tests, preflight, build, pack, install or publishing commands.

## Setup evidence

- Entry HEAD and local `main`: `a26897ae6b4b764988b4494b8992c4f1b25dd6ee`. Only the existing untracked change folder was dirty at entry. Owner proposal/design are preserved without content edits.
- Focused metadata units: 9 records, 7 pass, 2 expected RED (`PREVIEW-SCOPE`, `PREVIEW-META`), zero skips. Exit 1 is expected because source remains preview.9 while expectations are preview.10. Corrected-excerpt mutation controls pass. No complete-candidate or runtime pass is claimed.
- Syntax checks pass for all three changed test files. Pinned Prettier 3.9.10 explicit-path checks pass for those files, tasks and change metadata. `git diff --check` passes. CLI 1.15.0 strict validation passes with zero deltas accepted under `skip_specs`. CLI status reports proposal/design/tasks done and specs skipped, not implementation completion.
- Concurrent README edits appeared after entry and are left to their documentation owner, unstaged by this setup. Source version files remain untouched by test engineering. Both non-unit suites remain unrun, with only the three authorized pins maintained.

## Workflow follow-up

- After independent candidate verification, existing CI and owner final review, software engineering performs the one authorized CLI archive inside this change's single PR. Finish task evidence before the move. Never edit archived content.
- Publish only from clean merged `main` through the separately routed operational continuation. Test engineering retains worktree lifecycle ownership through verified landing and safe cleanup, with terminal evidence outside the archive.
