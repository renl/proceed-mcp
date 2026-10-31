# Checkpoint 2B — consolidated executable-readiness package

Parent: [timeout spike](02-timeout-spike.md); index: [tasks](../tasks.md). Authority: [design](../design.md) sections 2–7 and continuation delta requirements “Exact originating-session delivery”, “Outcomes preserve human intent”, “Continuation after tool timeout”, “Safe pending delivery and replay”.

## Disposition and scope

`TIMEOUT-PROOF-001`: **OPEN; correction attempts 2**. Next owner: architecture review through coordination. Offline package ready for review, **not SE implementation-ready or live-ready**. Earlier handshake/deadline and bounded collector acceptance remain accepted; the final-window edge is corrected here. No SE contract handoff is issued.

Founder-visible condition: a real paired-human decision causes a useful, correct-intent turn in only the requesting running session after its actual MCP timeout. Everything measured here is **supporting/proxy evidence**, not that proof.

| Lifecycle field | Value |
|---|---|
| Worktree / branch / change | `.worktree/add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` / same name |
| Baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Authoring candidate | `cb84297956d3ccbac2755d0817b9b94083f5b481`; existing setup and accepted test prerequisites present |
| Owner / status | Test engineering / active, retained |
| Next action | Consolidated decomposition/interface/test-artifact review; preserve parallel research |
| Cleanup evidence | No worktree removal authorized; test namespaces removed, PID absence and listener rebind asserted |
| Delivery | Sequential checkpoints in the single change branch; one eventual PR, user merges |

Only tests, this slice, the parent slice pointer and `tasks.md` change. No production, dependency, config or other owner's artifact edits. No credentials/.env, Telegram calls, existing user host, global configuration, other worktree, publication, PR, push or archive. Production must not import these test-only consumers. The parallel `assistant-schema-research.md` is read-only input, excluded from this test commit.

## Internal executable stages

| Stage | Files to touch / test locations | Assertions and dependencies |
|---|---|---|
| 2B.1 Collector/extraction | `tests/continuation-evidence.test.mjs`, `tests/support/continuation-evidence.mjs`; `tests/assistant-extraction.test.mjs`, `tests/support/assistant-extraction.mjs` | Final snapshot **starts** at/after replay+30,000ms. Regression inserts a duplicate after the 28s target read while another read crosses the edge. Source-shaped raw records feed the collector. Depends on accepted collector at parent. |
| 2B.2 Fault/lifecycle | `tests/http-fault-topology.test.mjs`, `tests/fixtures/http-spike-process.mjs`; reuse `tests/support/managed-spike.mjs` unchanged | Separate HTTP process loses one selected admission response after upstream completion. Auth/nonmatching requests pass. Four logical fixture roles bind exclusive OS-allocated ports before readiness. Detached registered listener survives intermediate exit; success/failure/never-ready cleanup verifies PID absence and listener rebind. |
| 2B.3 Durability/runner consumers | `tests/spike-runner.test.mjs`, `tests/support/spike-runner.mjs`; `tests/spike-production-prereq.test.mjs` | Minimal committed-state/public-restart assertions, authenticated fixed-origin reader, accepted timeout sequence composed with collector, direct public product prerequisite RED. Consumes 2B.1/2B.2; no private production modules imported. |

These are one package's internal stages, not separate branches/PRs or success claims. Minimum implementation scope remains design sections 1–7's vertical broker/MCP/pairing/request/outbox/prompt path; private implementation layout stays implementation-owned. Test seams below do not define production interfaces.

Size split: consumer/extraction/runner/docs land first, HTTP fixture/lifecycle tests second on that commit. Against the authoring candidate, initial scoped gross delta was 700 changed lines across 12 files (688 additions + 12 deletions), excluding parallel research. Each internal commit stays below ~600 gross lines; only their combined package is handed off for review.

## Boundary Verification supplement — review required

### Assistant extraction and actual evidence collection

Source: [assistant-schema-research.md](../assistant-schema-research.md), public OpenAPI SHA-256 `92CC33EF9A107C8AF6295E6FCBDF6D339D4374955910924456BD91A76844A5DB`; pointers `Session.Message.Assistant`, Text/Reasoning/Tool members and `SessionMessagesResponse`. Existing authenticated history routes/envelopes from design section 6 remain unchanged.

`extractAssistant` retains ordered `content[].type == "text"` parts without trimming or inventing a merge rule. Reasoning/tool output never supply the acknowledgement. Unknown parts and missing extraction fields fail. Empty/nontext content supplies no prose. The controlled oracle requires one intact exact text part; split/partial text and error/retry are inconclusive/failing, not success. This is focused extraction validation, not a complete OpenAPI validator.

`finish`/`time.completed` remain observations, **not completion semantics**. Missing markers mean completion not established, not schema-declared incompleteness. `completionEstablished:false` is test bookkeeping, never a wire field. Live record mutation, turn grouping and pagination stability remain unverified. No fabricated assistant `sessionID`, top-level `text`, `complete` or `intentVerified` is consumed. Joined prose is used only for conservative suspicious-marker detection; it cannot satisfy the exact acknowledgement oracle.

`composeTimeoutIO`/`runTimeoutCase` baseline both sessions before arming the receipt fault/invoking the actual host. Required adapters observe pending creation, assert actual call unsettled, observe withholding, reassert unsettled, observe actual host timeout, check same host, then accept real paired-human resolution and await acknowledgement. A failed prerequisite prevents human resolution. The grounded extractor feeds the collector; the legacy synthetic checker is not used. The real entry has no clock/window override; self-tests inject virtual time only.

For live cases, omit `request_id`/`resolved_at` before invocation. Orchestration returns the **actually observed pending receipt**; collector reads the existing owned broker GET after resolution. Creation origin/session/action/context and every predeclared accepted outcome/response field must match. Product-generated random ID/timestamp are bound from observed public data, not preselected by the test. Baseline still precedes creation; no request is seeded. Known-record mode remains for deterministic fixtures.

### HTTP fault, fixed-origin reads and lifecycle

The broker-facing fault listener and its single loopback backend destination are fixed before any request. An out-of-process fault completes upstream admission but withholds every downstream response byte for exactly the selected POST prompt ID. Other headers/payloads/responses pass unchanged. It neither follows redirects nor chooses request-supplied destinations. **Architect must review placement relative to the real canonical host listener before live use.** This fixture topology is not permission to substitute a product origin or proxy real traffic. Fixture retry safety is not real host deduplication proof.

`authenticatedReader(origin, authorization)` uses native HTTP with in-memory Basic/Bearer credentials, literal loopback/canonical port, absolute 10s abort budget, bounded body, no redirects or proxy discovery. Routes/auth/envelopes remain design-defined; no test-only product endpoint exists. Fixture tests assert authorization forwarding and redirect rejection, not real authorization.

Controlled registered descendants, including a deliberately detached orphan, are covered. This is **not Windows job containment** or proof that arbitrary real host/MCP grandchildren self-register. Real executables must not launch until complete ownership and their readiness/listener release checks are verified. Port 0 binds allocate/reserve listeners, not racy free-port probes. The finite fixture 15s failsafe supplements, never replaces, managed teardown. Native rationale: Windows process/loopback mechanics are directly exercised; no OpenCode scheduling claim.

### Minimum product durability/public prerequisite contract

`assertCommitBeforeEffect` requires a fresh read-only committed-journal projection at an intercepted effect boundary. `assertPublicRestart` restarts only broker/same state, reads the existing owned public GET, then compares committed request/exact outbox. Self-tests cover pending/no outbox and accepted pending/admitted/delivered stages, missing commit/outbox, changed public recovery and changed payload bytes.

An implementation-selected test decoder must reject invalid/unflushed records; no journal format, flush API or new production route is imposed. Actual effect observers must be installed **before** effects, sample committed state before releasing receipt/Telegram confirmation/admission, and prove pending/decision/exact-outbox survival by actual process restart. Reading status later is insufficient. Self-tests cannot attest that decoder or OS flush. Concrete product adapters/observers and this real execution remain absent.

Public prerequisite test invokes real `bin/proceed-mcp.js serve/status --state-dir <run-owned-missing-state>` in bounded credential-free child processes. Required exit is 3 for unavailable state, not unknown-command exit 2. Missing production commands are actual RED, never a fixture pass, rejection self-test or skip. No server/token/host is started.

No Name Mapping Table is needed: public routes/fields retain their names. New functions, IPC messages, fixture roles and observations are test-only consumer seams. No production decision/reset endpoint or private module dependency is introduced.

## Run sequence and measured evidence — 2026-10-31

PowerShell in the retained change worktree; bound each command to 60s. Native Windows Node `22.23.1`: diagnostic test-authoring runtime, not provisional Node 24 compatibility. No build/dependency/bootstrap change requires unrelated replay.

1. `node --test tests/assistant-extraction.test.mjs tests/continuation-evidence.test.mjs tests/http-fault-topology.test.mjs tests/spike-runner.test.mjs`
2. `node --test tests/spike-production-prereq.test.mjs` — deliberately nonzero until production prerequisites exist.
3. `npm run format:check` (tests/planning excluded; no new test formatting coverage claimed).
4. `git diff --check`, then staged equivalent before commit.

Command 1: **exit 0; 51 PASS, zero failed/cancelled/skipped; 4180ms**. Subsequent expansion of stage-3 delivery-state coverage: `node --test tests/spike-runner.test.mjs`, **exit 0; 4 PASS / zero failed/cancelled/skipped; 169ms**. Assertion status PASS for proxies only. Cleanup PASS: fixture-owned registered PIDs absent, scoped namespaces removed and listeners rebound. `tests/.artifacts` held zero entries after execution. Accepted unchanged stdio/RPC subset evidence is reused from parent and prior slice records, not claimed newly executed. Format and unstaged diff checks: exit 0; formatter excludes tests/planning.

Command 2: **exit 1; 0 PASS / 1 FAIL / zero cancelled/skipped; 231ms**. Actual `serve`/`status` both exit **2**, expected **3**. Run-owned scratch removed. An earlier authoring variant tried `init` under the minimal environment and returned 4; it is not reused as setup acceptance or diagnosed as a product regression. Final prerequisite isolates command availability without setup/ACL dependencies.

Earlier topology authoring runs failed the orphan-survival precondition (2 failures each; managed cleanup verified); attached child lifetime did not establish an independently surviving descendant. Bounded fixture stderr was empty. Explicitly detaching the registered leaf now exercises the strong survival and cleanup assertions. Final four-case topology passes. No controlled-harness-versus-host compatibility comparison was performed.

No real 30s observation, actual Telegram/host, product flush/restart, first-use or release gate was executed. Those are **BLOCKED/unexecuted**, not skipped, waived or passed.

## Exact remaining acceptance and routing

**Offline code complete for review:** final-start edge/crossing-read negative; source-pinned extraction and missing/nontext/partial negatives; out-of-process response loss; registered four-role topology/intermediate exit/listener readiness/release; authenticated read consumer; minimum durability assertion consumers; timeout sequencing composed with collected raw evidence; actual product prerequisite RED. The complete live launcher is not implemented.

**Required before live use:** reviewed canonical-origin fault placement; complete real-executable descendant containment beyond cooperative registration; authenticated host invocation/actual-timeout/same-host adapters; managed broker restart preserving the host; product journal decoder/pre-effect observers and actual pending/decision/outbox flush/restart execution; running-host schema/hash comparison and stable history capture; isolated authenticated host/two sessions, dedicated Telegram pairing/exclusive poller/human window, representative Node 24 and the full real matrix/30s replay window. Missing adapters fail, never fall back to fixtures. No allowlist entry is justified.

All five decomposition triggers remain **YES**: shared durable state, baseline/replay, observer-before-event, ordered proof chain, fixture/live split. Request one consolidated architecture decomposition/interface/test-artifact review through coordination. Keep `TIMEOUT-PROOF-001` open and the worktree retained; broad integration remains blocked. Historical attempt evidence remains unchanged.
