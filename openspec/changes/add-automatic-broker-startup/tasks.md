# Tasks

Parent: [proposal](proposal.md). Contract: [design](design.md) sections 1-6 and [delta](specs/opencode-session-continuation/spec.md). This file defines execution and evidence, not new contract semantics.

## Delivery and ownership

One independently landing change, one branch/worktree, one PR to `main`. No dependency on the agent-skill branch. Baseline: `main` at `f3d60184f03963774ed6a5954bb75331d54918d4`. Internal groups below are ordered checkpoints, not separate PRs.

Founder-visible success: after one-time setup, normal MCP use starts a safely stopped broker or reuses the correct running instance without a manual terminal, including concurrent clients.

Proof is a public installed CLI/MCP interaction with actual protected files, processes, authenticated matching readiness, one ownership winner/poller and verified clean stop. Help text, unit counts, a successful spawn, TCP accept and mocked Telegram are supporting proxies, not that proof. Setup alone never proves an approval.

| Lifecycle field | Value |
| --- | --- |
| path | `.worktree/add-automatic-broker-startup` |
| branch / change | `add-automatic-broker-startup` |
| owner | Test engineering |
| status | active, setup awaiting combined architecture review |
| next action | Review tasks/tests, then minimal synthetic spike before broad implementation |
| cleanup evidence | Not eligible. Retain until verified landing or explicitly authorized abandonment. Root returns to `main` during development. |

Production owner: software engineering, limited to `src/cli/`, `src/state/`, `src/http/local-client.js`, `src/broker/`, and affected `src/mcp/` availability wiring if needed. Reuse the existing runtime/poller/journal. Private module names are not prescribed. Tests and `tests/support/`/`tests/fixtures/` extensions belong to test engineering. README setup/lifetime/limitations copy needs the documentation owner routed through coordination, with CLI help maintained alongside implementation. Product owns proposal/spec, architecture owns design, coordination owns status/index. No dependency/version, generated OpenSpec, archive, deployment or publishing edits in implementation setup.

## 1. Minimal safety spike and executable prerequisites

- [ ] 1.1 Review the Boundary Verification block and decomposition triggers below together. Verify explicit architecture approval before implementation readiness.
- [ ] 1.2 Test engineering lands `tests/automatic-startup-cli.test.mjs` and records meaningful RED through the public CLI dispatcher for new command/option admission and missing-state refusals. Verify no credential access, process launch or writes outside run-owned ignored scratch.
- [ ] 1.3 Before broad implementation, test engineering extends existing process fixtures minimally for protected create/load, actual cold start, automatic/manual contention and authenticated stop. Verify one synthetic representative Node 24/Ubuntu run with assertion and cleanup outcomes separate. No new framework or containment driver. If safe ownership cannot be established, return the exact blocker rather than running detached children locally.

## 2. Protected provisioning and lifecycle contract

- [ ] 2.1 Implement design sections 1-2 CLI provisioning/path selection and broker-only loading in CLI/state code. Test engineering adds `tests/automatic-startup-credentials.test.mjs`. Verify bounded stdin, exact accepted bytes, pre-write protection, create-only races, no-clobber existing files, symlink/reparse/hard-link and identity-substitution refusals, current-account ownership, ancestor protection, input/read/write failures and exact-object rollback. Include default state-key and override separation cases, no `.env` import and no adapter read. README/help document trusted stdin supply and same-account readability without token examples or encryption claims.
- [ ] 2.2 Implement authenticated readiness and shutdown in existing runtime/server per design sections 4 and 6. Test engineering adds `tests/automatic-startup-lifecycle.test.mjs` using real loopback HTTP. Verify exact success envelopes, both readiness roles, denied owner shutdown, invalid auth/origin/body, stale instance refusal, not-ready/storage health, Telegram-state distinction, drain-before-lock-release and stop timeout without forced termination. Preserve existing public tool and journal schemas.

## 3. Shared automatic availability and public proof

- [ ] 3.1 Implement one availability attempt per adapter and `pair`, with same-package direct runtime launch, exact stable lock/readiness identity matching, inherited-secret exclusion and independent broker lifetime. Test engineering adds `tests/automatic-startup-process.test.mjs` and only focused support/preload extensions. Verify stopped start, foreground reuse without file, distinct-owner sharing, manual/automatic race, loser-before-journal/poller, responsive initialize/catalog, invalid arguments before mutation, EOF before readiness, last/nonlast close, no restart after explicit stop, and no replay of possibly committed operations. Update help/README in this group.
- [ ] 3.2 In that shared process suite, verify occupied port, same-shaped impostor, wrong port/instance/PID, unsupported lifecycle, missing/malformed/changing/stale lock and failed protection preserve original lock/journal bytes. Verify 150000 ms shared absolute readiness budget, <=1000 ms absolute probe, <=16 KiB body, >=100 ms settled-probe spacing, trickling socket abort, remaining-budget helper admission and separate <=30000 ms cleanup observation. Do not substitute inactivity timeout or port liveness. Clock-level assertions support, but do not replace, real-process timeout/cleanup proof.
- [ ] 3.3 Extend existing public waiting/restart fixtures with automatic start, not manual broker setup as the proof action. Verify pending/terminal identities, exact Respond text, expiry, delivery ledger, lost-call semantics, capability/owner separation and explicit paired-human decision via MCP. Scan synthetic inputs, all outputs, journal/state and helper environments for authority disclosure. Local synthetic Telegram proves orchestration only, not live Telegram receipt.

## 4. Integrated candidate verification

- [ ] 4.1 Independently review a pinned implementation-complete candidate against the target and dependency set. Execute the ordered checks below, including clean installed-package first use and focused regression suites. Verify later finalization is docs-only or rerun affected checks. No archive/merge readiness claim from structural validation alone.

## Boundary Verification

Normative public/cross-component contracts: exact CLI names/options and exit/diagnostic mappings in design sections 1 and 5, schema-2 configuration unchanged, existing five MCP tools and `{schema_version: 1, error: {code, message, retryable}}` with `isError: true`. Automatic failures use existing tool codes, not human outcomes. No name mapping or private module contract is introduced by these tests.

Actual wire: `http://127.0.0.1:<configured-port>/v1/ready`, GET, Bearer owner or control, no browser Origin, redirects/proxy/alternative port. Assert the exact design-section-4 fields and lock identity before and after the exchange. `POST http://127.0.0.1:<configured-port>/v1/shutdown` is control-only with exactly `{instance}` and exact section-6 `202` envelope. Assert denial/status/error mappings, and complete drain separately from acceptance. Existing source lacks these routes, which is expected RED, not a baseline contract disagreement.

Real OS boundary: exclusive ownership, detached process lifetime, actual filesystem identity/protection and cleanup need real process/filesystem assertions. Never signal a recorded PID or delete uncertain locks. Test fixtures are synthetic and ignored repository-local. Positive credential storage cannot be placed beneath a visible repository marker: use a container-mounted run-owned scratch directory outside the container's source/package mount. Keep host backing data inside worktree scratch. Do not bypass repository detection or grant development access to home/global credential stores.

Telegram wire is unchanged. Reuse prior pinned evidence only after checking relevant client/poller inputs and assertion scope are unchanged. The existing `portable-telegram-preload.mjs` injects an environment token and IPC readiness. Reuse its synthetic transport concept, not that behavior as proof of file-only detached startup. No production Telegram URL override, auth bypass or test-only endpoint is allowed. New lifecycle/OS proof cannot inherit historical wire proof.

Decomposition triggers: 1 YES (provisioned files/readiness feed startup), 2 YES (stop changes restart baseline), 3 YES (receiver must be active for approval proof), 4 YES (file/process/MCP chain), 5 YES (clean setup must precede proof without prestarting the broker). Request one combined architecture boundary/decomposition/test-fixture review through coordination. Groups 2-3 consume the validated spike from group 1 on this same branch. Group 4 consumes all implementation checkpoints. Keep each case run-isolated, and establish pending/terminal work before stop/restart assertions.

## Harness decision and check sequence

Actual failures: duplicate pollers, wrong-service adoption, leaked token, broker death at adapter EOF, unsafe secret writes and unfinished drain/cleanup. `tests/support/portable-waiting.mjs`, `managed-spike.mjs`, `startup-guards.mjs`, existing catalog/RPC peers and installed-package runner already cover much of the public path. However, the current managed helper uses IPC and force cleanup, its aggregate timeout excludes teardown, and it cannot own newly detached descendants. It is not qualified unchanged for this proof. Prefer a narrow extension with owned resource manifests, persisted setup/run/teardown phases and a single aggregate deadline over a new framework. Narrower delivery would not meet the approved automatic-startup outcome. No risk acceptance is currently granted.

Commands below target the worktree. PowerShell/Node 26 native execution qualifies only pure/static evidence. Runtime qualification requires Ubuntu 24.04 and Node 24.22.2, not host Node 26. No global runtime install is authorized.

1. `npm ci --ignore-scripts` using the unchanged lockfile if needed.
2. `npm exec --offline -- prettier --check openspec/changes/add-automatic-broker-startup/tasks.md tests/automatic-startup-*.test.mjs` and `git diff --check`. Format only owned files with the equivalent `--write` command.
3. `openspec validate add-automatic-broker-startup --strict` using installed CLI 1.15.0.
4. `node --test tests/automatic-startup-cli.test.mjs` (native minimal RED now).
5. After group 1 supplies the maintained bounded runner, Ubuntu/Node 24: `node --test tests/automatic-startup-credentials.test.mjs tests/automatic-startup-lifecycle.test.mjs tests/automatic-startup-process.test.mjs`. This is a planned command until those files/runner exist, not runnable evidence now. Runner owns setup/run/teardown within one finite budget, reserves cleanup before launching, uses per-attempt 180000 ms maximum observation windows, and reports unknown resources as cleanup failures. Container proof uses an isolated owned container with only package/source and repo-local scratch mounts, no host home, secret, Docker-socket or network credentials. Do not launch before this maintained runner and environment are reviewed and ready.
6. Run focused existing ownership, protection, local-client abort, registration/EOF, waiting, journal/restart and disclosure suites selected by affected inputs. Run `npm run build` and existing `tests/release-pack.mjs` installed-package procedure with the new cold-start first-use assertions. No broad unfiltered test command that starts blocked host/live suites.

## Checks and current evidence

| Gate | Status, failure, owner and trigger |
| --- | --- |
| Pre-merge | NOT RUN: combined architecture review, synthetic spike and new runtime suites. Test engineering owns execution after implementation and representative runner readiness. Static/RED results recorded below. |
| Pre-merge environment | BLOCKED: no current Node 24/Ubuntu startup candidate proof. Test engineering supplies maintained runner, operations supplies suitable existing container/CI execution when routed. No push/CI/dependency/environment changes authorized in this setup dispatch. |
| Windows qualification | BLOCKED: known sequential ACL timing and unreported transient-helper descendant absence remain unproven. Test engineering/operations, trigger before claiming Windows protected provisioning or detached startup. Do not restart containment program or infer pass from Linux. |
| Pre-exposure | BLOCKED: full useful automatic-start approval with real Telegram and supported host as applicable. No live credential/Telegram authority in this task. Coordination routes agent-owned proof/access before exposure, without interim operator test burden. Missing live proof is not silently accepted for merge if required by final applicability review. |
| Post-deploy | NOT RUN: operations verifies deployed clean merged-main artifact identity and health, test engineering verifies authorized public first-use smoke after separate deployment authority. Roll back exposure on mismatch/failure. Not pre-merge evidence. |
| Deferred | Automatic respawn, stale-lock recovery, services/login start and native permission channels excluded by proposal. Product owner, trigger a separately authorized change. No deferred current startup safety assertion. |

## Workflow follow-up

- After independent candidate verification, route declared-owner delta review and one authorized CLI archive inside the same PR. Finish evidence before archive. Archived content remains read-only.
- Software engineering owns PR/authorized landing. Test engineering owns verified landing, return-to-main and safe worktree cleanup. Publish/deploy only from separately authorized clean merged main.
