# Tasks

Parent: [proposal](proposal.md). Contract: [design](design.md). First executable checkpoint: [01 setup](slices/01-setup.md).

## Readiness and delivery

Checkpoint 1 is ready for implementation within the approved project direction. Product clarification removes the obsolete draft-signoff blocker; Architect interface/decomposition review accepted checkpoint 1, as confirmed in the scoped readiness correction brief (2026-10-31). This disposition does not approve execution of checkpoints 2–5. One change, one branch/worktree, one eventual PR to `main`; internal checkpoints are sequential commits, not separate PRs. Production scaffold belongs to implementation; tests belong to verification.

Founder-visible success: a paired human's Approve, Reject, or Respond reaches only the requesting running OpenCode V2 session, with unchanged intent and a useful subsequent assistant turn even after the original MCP call times out.

Direct proof is real Telegram interaction followed by that exact session's acknowledgement of request ID and outcome, with no duplicate decision-driven continuation on replay. Journal records, fixture tests, HTTP admission, history presence, and local tarball installation are supporting proxies, not that proof.

| Worktree field | Value |
|---|---|
| path | `.worktree/add-telegram-approval-opencode-v2` |
| branch / change | `add-telegram-approval-opencode-v2` |
| baseline | `main` and fetched `origin/main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| owner | Test engineering (lifecycle); implementation engineering (implementation custody) |
| status | active; checkpoint 1 implementation-ready; checkpoints 2–5 not execution-ready |
| next action | Implement checkpoint 1 from the reviewed setup slice; supply a Node 24 test environment for its proposed runtime target |
| cleanup evidence | Initial registry contained only repository root on `chore/project-workflow`; no pre-existing dangling worktree. No removal authorized now. After verified landing return to current `main`, verify registry/directory removal; retain unknown work. |

Root bootstrap originals remain untouched. Worktree copies are the delivery artifacts; do not implement in the root or silently overwrite newer owner edits there. No publication, archive, license selection, or PR operation is authorized by this setup.

### Phase A evidence (2026-10-31)

- Baseline fetched once from `origin`; `main`, `origin/main` and setup HEAD all matched the pinned revision. Created the one change worktree at that revision; 27 bootstrap/task files copied with exact byte-hash equality, leaving originals untouched.
- `node --check tests/cli-setup.test.mjs`: exit 0. `node --test tests/cli-setup.test.mjs`: exit 1, one test failed at explicit missing-executable prerequisite, zero skipped. Expected RED, not a behavioral implementation result; no subprocess or state directory was created.
- CLI 1.15.0 `openspec validate add-telegram-approval-opencode-v2 --strict`: exit 1 because all three product deltas have `## Related Artifacts` sections that archive will not carry into current specs. Route these warnings to the spec owner; no normative file edited here.
- Non-strict `openspec validate add-telegram-approval-opencode-v2`: exit 0 with those three warnings. Fresh `openspec status --change add-telegram-approval-opencode-v2 --json` recognizes all four planning artifacts; this does not approve product content or prove implementation. `git diff --cached --check`: exit 0.
- Size against pinned baseline, gross additions plus deletions: preservation snapshot 28 files / 3676 added lines before this evidence addition, of which the three new verification-owned files account for 191 lines. The large remainder is existing owner/generated bootstrap, not one implementation slice; do not split its delivery into additional PRs. Future implementation checkpoints should stay near 20 files / 600 changed lines or be refined internally before dispatch.
- Current native Node 22.23.1/npm 10.9.8 are below the proposed release toolchain; Node 24 compatibility, formatter/build, managed spike harness, actual host auth/timeout/busy semantics and Telegram live first use remain BLOCKED/unexecuted. No gate waived; no secret or private host registration inspected.

### Readiness correction (2026-10-31)

- Product-owned proposal/spec corrections remove obsolete draft-signoff text and delta `Related Artifacts` sections; no normative behavior changed. Existing user authorization covers checkpoint 1 setup; no blanket reapproval is required.
- Architect interface/decomposition acceptance applies to checkpoint 1 only. Later transport-fault sequencing, managed harness readiness and live-boundary proof remain required before their respective execution gates.
- Root project-local `.tools/node_modules/@fission-ai/openspec/bin/openspec.js` reports `1.15.0`; invoked from this worktree with `validate add-telegram-approval-opencode-v2 --strict`: exit 0, valid, no warnings. This supersedes the earlier strict-validation failure, not the missing implementation evidence.
- Node 24 is the provisional technical design target to test, not declared actual compatibility or an owner-approved support floor. Available Node 22.23.1 supports structural/test-authoring checks only; representative Node 24 execution is a checkpoint verification prerequisite, not a reason to block already-authorized scaffold implementation. Build/format and behavioral acceptance remain unexecuted until implementation exists. Security, actual OS state protection, authenticated live continuation and release-owner decisions remain unwaived gates.

## 1. Empty-state enabling checkpoint

- [x] 1.1 Confirm checkpoint 1 is covered by existing user authorization and Architect interface/decomposition acceptance of `slices/01-setup.md`; scoped readiness correction brief confirms both (2026-10-31), not inferred from CLI artifact presence. No renewed blanket product signoff is required.
- [x] 1.2 Implement the public executable and empty-state `init` / stopped-broker `origin add` contract from design sections 1–2; satisfy `tests/cli-setup.test.mjs` through the executable, without production imports from tests. Document setup prerequisites and environment-variable password references alongside implementation.
- [x] 1.3 Add production build/lockfile and formatter targeting provisional Node 24, without inventing public package identity/license or a final support floor; validate clean setup/build and `npm run format:check`, then run the checkpoint command in the slice. Supply a representative Node 24 environment before claiming compatibility; local Node 22 is diagnostic-only.

### Checkpoint 1 implementation evidence (2026-10-31)

- Production added: `bin/proceed-mcp.js` and `src/` (argument parsing, schema-1 configuration with loopback-only immutable origins, owner-only state protection, atomic protected writes, `init` and stopped-broker `origin add`), `scripts/build.mjs`, `package.json` + `package-lock.json`, `.prettierrc.json`, `.prettierignore`, README setup documentation. No package identity, license or support-floor decision: `private: true`, `UNLICENSED`, provisional `engines.node >=24`. 18 files, 1047 added / 7 deleted lines; above the ~600-line guidance because the OS protection verifier, configuration guards and setup documentation are one indivisible checkpoint. This evidence addition brings the commit to 19 files, 1059 added / 9 deleted lines.
- Diagnostic runtime Node 22.23.1: `node --check tests/cli-setup.test.mjs` exit 0; pre-implementation `node --test tests/cli-setup.test.mjs` exit 1 (missing `PROCEED_TEST_COMMAND`, 1 fail / 0 skipped, no subprocess); post-implementation with `PROCEED_TEST_COMMAND=["node","bin/proceed-mcp.js"]` exit 0, 1 pass / 0 fail / 0 cancelled / 0 skipped.
- Representative runtime Node 24.22.2 (npm `node` distribution invoked through npx, Windows; not an OS install and not a support-floor decision): clean `npm ci` exit 0 (npm 10.9.8), `node scripts/build.mjs` exit 0 (11 production modules parse, bin mapped), `prettier --check .` exit 0, `node --test tests/cli-setup.test.mjs` exit 0 with the Node 24 executable, 1 pass / 0 fail. No claim of owner-approved support floor, cross-OS support, or npm >=11.5.1 release readiness.
- Public-executable behavior observed: `init` exit 0 then exit 2 on repeat with existing state intact; `origin add host_a` exit 0 storing an immutable binding plus a separate per-origin credential; duplicate origin id exit 2; eight forbidden topologies and three invalid identifiers exit 2; `origin add` before `init` exit 3; corrupt configuration exit 4; unsupported `schema_version` exit 4; manually widened origin URL exit 2; unknown command and unknown option exit 2. No credential value is printed; passwords are stored only as environment-variable names.
- Windows protection: state directory and credential files verified owner-only through `Get-Acl` (single Allow FullControl entry, owner = current account) on every setup command; `init` fails closed (exit 4) when the ACL verifier cannot run, and rolls back files it created. Fixed cause of the initial failure: an inherited newer-PowerShell `PSModulePath` broke Windows PowerShell core-module loading, so the verifier child process now drops it. POSIX 0700/0600 branch is implemented but unexecuted here.
- Test-owned artifacts: the harness created only `tests/.artifacts/setup-*` and removed it in `finally`; directory held 0 entries after the runs. `.gitignore` now covers `tests/.artifacts/`.
- Unexecuted and unwaived: POSIX/macOS/Linux protection and first use, every Telegram and OpenCode boundary, live authentication, package identity/license/publication, release tooling. Checkpoints 2–5 remain not execution-ready.

## 2. Risk-first boundary spike (before broad integration)

- [ ] 2.1 With checkpoint 1 present on this branch, test engineering supplies a finite repository-owned out-of-process spike harness: scoped state/ports, readiness and total deadlines, bounded redacted evidence, guaranteed whole-tree teardown and cleanup verification. Verify harness timeout/failure cleanup before real use. No foreground server improvisation.
- [ ] 2.2 Implement only the minimum broker/MCP/pairing/request/prompt path needed for design section 7's vertical spike; co-land authoritative executable tests and operator setup instructions. Verify MCP 2025-11-25 initialize/tools/call and trusted `_meta`, not internal handlers or a human-decision test endpoint.
- [ ] 2.3 Execute the real authenticated OpenCode V2 + dedicated Telegram private-chat spike per the Boundary Verification block. Record host version/OpenAPI hash, two sessions, active/idle/busy, direct tools and Code Mode, each outcome before completion and after forced MCP timeout while host lives, lost POST response, stable-ID replay after broker restart and after inbox departure. Assert exact-session assistant acknowledgement and no duplicate decision-driven turn within the harness's declared observation window. Report unobserved cases BLOCKED, never passed from fixtures.
- [ ] 2.4 Review spike evidence before broad integration; admit only actually verified host versions. If admission, timeout scheduling, intent, or deduplication fails, return the evidence for contract/product correction rather than substituting notifications or widening support.

## 3. Durable resolution and isolation (depends on checkpoint 2 pass)

- [ ] 3.1 Co-land deterministic transaction tests with journal implementation: first-winner decision/cancel/expiry, boundary time equality, cursor/outbox atomicity, replay, corrupt/incomplete tail, disk full and interrupted flush. Verify design sections 4/7 invariants plus OS-specific storage protection; document stopped-state backup/recovery.
- [ ] 3.2 Co-land Telegram authorization/correlation tests with full pairing/rendering/poller implementation: unauthorized/group/forwarded/inaccessible callbacks, ForceReply and explicit response mapping, exact approval-like text, duplicate choices, retry_after/conflict handling. Verify real private-chat client behavior as well as fixture assertions and document repair steps.
- [ ] 3.3 Co-land MCP/local API tests with credential isolation, origin/session ownership, browser-Origin/body limits, cancellation and idempotency implementation. Assert design section 3 envelopes/error codes and secret-free diagnostics through public interfaces; document cooperative enforcement limits.

## 4. Delivery reconciliation (depends on checkpoints 2–3)

- [ ] 4.1 Co-land adapter/outbox tests with retries, stable prompt ID/text, history/inbox validation, unsupported versions, changed origin, payload mismatch, 401/404/409/5xx/timeout classifications and explicit retry. Verify design section 6 without calling admission alone delivered; document pending/blocked repair.
- [ ] 4.2 Execute two-origin isolation tests including colliding session IDs in fixtures and real authenticated origins. Verify reverse-order outcomes and no wrong-origin/session delivery; unavailable real origin remains BLOCKED.

## 5. Installable distribution and non-publishing CI

- [ ] 5.1 Resolve owner-approved package identity/license/runtime floor and operations publisher/bootstrap decisions before release configuration depends on them; verify recorded decisions/rights, not name-query availability.
- [ ] 5.2 Co-land package whitelist/README and clean tarball install tests on Windows/macOS/Linux Node 24; assert executable startup without checkout/build tooling, secret-free contents, protected state, and empty-state first decision through real Telegram/MCP/OpenCode. Local pack alone does not prove registry delivery.
- [ ] 5.3 Co-land non-publishing PR CI with executable policy tests asserting no publish job/credentials/id-token write or privileged contributor execution; run build/tests/pack-install matrix.
- [ ] 5.4 Co-land separately gated `release.yml` and negative release-policy tests for version mismatch, unapproved history, failed checks and unavailable publisher. Verify pinned actions, npm >=11.5.1, no release caching, protected environment and publish-only OIDC scope. Do not publish or configure secrets in this task.

## 6. Independent integrated-candidate verification

- [ ] 6.1 Pin the implementation-complete candidate and target, test/build dependency identity and dirty paths; independently execute affected assertions from checkpoints 1–5. Record commands/exits/test counts, redacted artifacts, direct-proof versus proxy mapping and separate cleanup status. Missing required real boundaries block feature verification; structural OpenSpec validation is not behavioral proof.
- [ ] 6.2 Finish active evidence and owner delta review before authorized CLI archive. Confirm any finalization delta is docs-only; revalidate affected evidence for changes to code/tests/dependencies/configuration/baseline. Verification records after archive belong outside archived content.

## Workflow follow-up

- Only after independent verification and owner delta review: authorize one CLI archive inside the single change PR; implementation engineering owns PR preparation, user owns merge.
- Registry publication and exact-version clean public install are distinct operational/release gates requiring owner authorization and secure publisher readiness; neither is passed or waived here.
- Test engineering retains lifecycle accountability until verified landing or explicitly authorized abandonment and safe removal. Never edit archived content to record cleanup.
