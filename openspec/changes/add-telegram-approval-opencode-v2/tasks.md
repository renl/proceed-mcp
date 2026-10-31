# Tasks

Parent: [proposal](proposal.md). Contract: [design](design.md). First executable checkpoint: [01 setup](slices/01-setup.md).

## Readiness and delivery

Phase A setup only; not implementation-ready until product approval and Architect boundary/decomposition review. Product artifacts still say draft. One change, one branch/worktree, one eventual PR to `main`; internal checkpoints are sequential commits, not separate PRs. Production scaffold belongs to implementation; tests belong to verification.

Founder-visible success: a paired human's Approve, Reject, or Respond reaches only the requesting running OpenCode V2 session, with unchanged intent and a useful subsequent assistant turn even after the original MCP call times out.

Direct proof is real Telegram interaction followed by that exact session's acknowledgement of request ID and outcome, with no duplicate decision-driven continuation on replay. Journal records, fixture tests, HTTP admission, history presence, and local tarball installation are supporting proxies, not that proof.

| Worktree field | Value |
|---|---|
| path | `.worktree/add-telegram-approval-opencode-v2` |
| branch / change | `add-telegram-approval-opencode-v2` |
| baseline | `main` and fetched `origin/main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| owner | Test engineering (lifecycle); implementation engineering (implementation custody) |
| status | active; retained for review and implementation |
| next action | Product approval confirmation; boundary and decomposition review; then checkpoint 1 implementation |
| cleanup evidence | Initial registry contained only repository root on `chore/project-workflow`; no pre-existing dangling worktree. No removal authorized now. After verified landing return to current `main`, verify registry/directory removal; retain unknown work. |

Root bootstrap originals remain untouched. Worktree copies are the delivery artifacts; do not implement in the root or silently overwrite newer owner edits there. No publication, archive, license selection, or PR operation is authorized by this setup.

### Phase A evidence (2026-10-31)

- Baseline fetched once from `origin`; `main`, `origin/main` and setup HEAD all matched the pinned revision. Created the one change worktree at that revision; 27 bootstrap/task files copied with exact byte-hash equality, leaving originals untouched.
- `node --check tests/cli-setup.test.mjs`: exit 0. `node --test tests/cli-setup.test.mjs`: exit 1, one test failed at explicit missing-executable prerequisite, zero skipped. Expected RED, not a behavioral implementation result; no subprocess or state directory was created.
- CLI 1.15.0 `openspec validate add-telegram-approval-opencode-v2 --strict`: exit 1 because all three product deltas have `## Related Artifacts` sections that archive will not carry into current specs. Route these warnings to the spec owner; no normative file edited here.
- Non-strict `openspec validate add-telegram-approval-opencode-v2`: exit 0 with those three warnings. Fresh `openspec status --change add-telegram-approval-opencode-v2 --json` recognizes all four planning artifacts; this does not approve product content or prove implementation. `git diff --cached --check`: exit 0.
- Size against pinned baseline, gross additions plus deletions: preservation snapshot 28 files / 3676 added lines before this evidence addition, of which the three new verification-owned files account for 191 lines. The large remainder is existing owner/generated bootstrap, not one implementation slice; do not split its delivery into additional PRs. Future implementation checkpoints should stay near 20 files / 600 changed lines or be refined internally before dispatch.
- Current native Node 22.23.1/npm 10.9.8 are below the proposed release toolchain; Node 24 compatibility, formatter/build, managed spike harness, actual host auth/timeout/busy semantics and Telegram live first use remain BLOCKED/unexecuted. No gate waived; no secret or private host registration inspected.

## 1. Empty-state enabling checkpoint

- [ ] 1.1 Confirm product approval and obtain Architect interface/decomposition approval of `slices/01-setup.md`; evidence is explicit review disposition, not CLI artifact presence.
- [ ] 1.2 Implement the public executable and empty-state `init` / stopped-broker `origin add` contract from design sections 1–2; satisfy `tests/cli-setup.test.mjs` through the executable, without production imports from tests. Document setup prerequisites and environment-variable password references alongside implementation.
- [ ] 1.3 Add production build/lockfile and formatter with Node 24 runtime, without inventing public package identity/license; validate clean setup/build and `npm run format:check`, then run the checkpoint command in the slice. Supply a representative Node 24 environment before claiming compatibility; local Node 22 is diagnostic-only.

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
