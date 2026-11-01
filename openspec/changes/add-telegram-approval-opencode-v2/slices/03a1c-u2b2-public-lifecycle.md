# U2b-2 — public registration lifecycle preparation

Parent: [tasks](../tasks.md). Contract: [design](../design.md), sections 3/7. Product mapping: [continuation delta](../specs/opencode-session-continuation/spec.md), **Exact originating-session delivery / Capability does not cross transport principals** and **Portable waiting-call outcome delivery / Prepare then ask and wait**. This is prerequisite coverage, not completion of either outcome.

**Ready for bounded implementation handoff:** Architect accepted the public lifecycle/fault preparation and focused corrections completed at `391091fb0df254e6b42b5b6c035d3c52a034b9aa`; implementation-selected cut/forecast is recorded below. This is not wiring acceptance.

## Independent affected verdict — 2026-11-01

**PASS, bounded enabling only.** Immutable code candidate `0d94855e3a288d3439287e510495f5eaa64818b9`, project baseline unchanged. Exactly three authorized production paths: 122 additions + 20 deletions = **142 gross / 220 ceiling**. No production/test/dependency/configuration edits during verification. Historical readiness/RED statements below are superseded for this bounded scope only.

Executed on Windows project Node **24.22.2**, using the ordered commands below:

| Check | Result / assertion scope |
|---|---|
| Seven production/test/helper syntax checks | PASS, exit 0 |
| Consumer + public lifecycle, 120s bound | **3/3 PASS**, exit 0, 41286ms: one consumer calibration proxy, two actual public executable/real private-broker tests |
| EOF/fault packet, 180s bound | **8/8 PASS**, exit 0, 72863ms; mapping in fault verdict |
| Binding/actual local HTTP abort | **10/10 PASS**, exit 0, 1260ms; fake-client binding assertions remain unit evidence, actual abort tests exercise real HTTP |
| U2a registry/public HTTP | **5/5 PASS**, exit 0, 10206ms; controlled-clock lease logic is not 45s wall-clock proof |
| Setup/CLI/catalog/reservation, 300s bound | **14/14 PASS**, exit 0, 45208ms; both PORT-RESERVE plus three setup, eight CLI and one catalog |
| Build / formatter / candidate whitespace | PASS, exit 0; 36 production modules parse; formatter excludes tests/OpenSpec |

Zero failed/cancelled/skipped in every run. Binding and U2a ran sequentially in one 120s outer command, with finite repository test deadlines. These and setup regressions were rerun to cover changed wiring, not counted as public lifecycle proof. Untouched helper/authority/strict-consumer evidence remains reusable only within its pinned original scope; no blanket historical suite replay or acceptance.

Direct public proof: brokerless catalog/invalid/unknown/unimplemented/EOF cause zero HTTP; valid preparation registers first; serialized submitted calls reuse registration; duplicate owner gets `OWNER_IN_USE` without handle/journal mutation or incumbent deletion; EOF releases captured authority and immediate replacement succeeds. The SAME retained adapter observes real production heartbeat after at least 9500ms, real broker restart rejects its old heartbeat with 401, re-registration occurs without another tool call, and replacement heartbeat again uses production cadence. No preparation replay. Captured owner/registration authority authenticates lifecycle traffic and never appears in bounded stdout/stderr through shutdown.

Source review: `server.js` raises its closed fence and invokes `onInputClosed` before chain drain; queued closures check the fence and suppress post-close writes. Executor close immediately aborts ordinary requests, then awaits terminal/idempotent binding close. CLI callback/finally share that close promise rather than restarting cleanup. Binding retains **10000ms heartbeat / 2000ms shutdown** defaults; captured release uses the sole shutdown timer. No independent drain timeout extends it. Closed tool-code validation redacts unknown/malformed envelopes. Execution remains serialized: this is **not** overlapping public execution/single-flight proof and is incomplete for concurrent waiting. Unit single-flight remains separate evidence.

Cleanup **PASS separately**: harness verifies registered owned process absence and run-directory removal; relay asserts actual socket set empty, listener close and same-port rebind. Recovery teardown is not EOF assertion evidence. Unknown artifacts untouched; worktree remains active/retained, not cleanup-ready. Native Windows stdio/loopback represents this bounded local boundary only; no other OS, real host/model, Telegram, waiting, Events, first-use, integrated feature or release proof. Existing seven dirty owner documents and nine untracked entries remain outside this evidence commit. Later finalization must remain evidence-only or require affected revalidation.

Next prerequisite: coherent request/wait plus Telegram vertical preparation against approved contracts and full PORT-A/PORT-B gates, with implementation-selected bounded cuts/paths/gross forecast and applicable decomposition/boundary review. Shared-stdio concurrency/original-RPC correlation, registration-bound wait/returned authority, durable terminal outcomes and real Telegram boundary proof remain required. Do not prescribe a registration-header accessor or concurrency API; private design belongs to implementation engineering. Baseline toolkit is standard MCP, not an OpenCode callback.

## Goal and ownership

Founder-visible question: can an ordinary MCP adapter privately acquire, maintain and release its broker registration without making catalog use depend on a running broker? Direct proof is public executable/MCP output plus authenticated real broker HTTP lifecycle; journal byte preservation and consumer calibration are supporting proxies. None proves a human decision or cancellation of an actionable approval.

- Worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change `add-telegram-approval-opencode-v2`; owner Test engineering. Project baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`; preparation baseline `cfc0edda7520a57d3d183ee49761d619ff9918aa`.
- Prerequisite: accepted U2b-1 `bc4ac686d66bb3cea23f4c53cffa3310b19b27a7` is present on this branch. Same worktree, sequential checkpoints, one eventual OpenSpec PR. Status active/retained, not cleanup-ready; no new worktree or promotion.
- Owned files: `tests/support/public-registration.mjs`, `tests/portable-registration-public.test.mjs`, `tests/public-registration-consumer.test.mjs`, this slice and the mapped tasks entries. Fault packet reuses this helper without recounting it.
- Wiring is limited to existing `src/mcp/execution.js`, `src/mcp/server.js`, `src/cli/main.js`; exact supplied cut/forecast and post-code gates follow below. This documentation update makes no production edits. Public tests require no production test API; private executor and callback choices remain implementation-selected, not public contract additions.
- Preserve all other owner edits, credentials/setup data and unknown artifacts. No design/product/index-owner/README/config edits, real Telegram/pairing/host/model, external scratch, install, push, PR, archive, publication or nested agents.

## Boundary Verification

Source cross-check at the preparation baseline: `src/broker/portable-server.js` and `src/broker/registration.js` already implement the private lifecycle; `src/http/local-client.js` supports actual AbortSignal cancellation; `src/mcp/registration.js` contains the accepted 10000ms/2000ms binding. `src/cli/main.js` still constructs only `createToolExecutor({client})`; `src/mcp/execution.js` forwards implemented operations without registration, and `src/mcp/server.js` waits for its execution chain at EOF. Those missing connections are expected RED, not missing contract authority. Reuse pinned U2a/U2b-1 evidence in tasks; this is an unchanged known loopback boundary, not a novel external-platform integration.

| Wire boundary | Executable observation |
|---|---|
| Public CLI/MCP | Actual `bin/proceed-mcp.js init`, `owner add shared`, `mcp --owner shared --state-dir <isolated-state>`; newline JSON-RPC/MCP `2025-11-25`, strict initialize and five-tool discovery. No proprietary host metadata or replacement MCP server. |
| Address/auth | Product adapter connects to `http://127.0.0.1:<isolated-configured-relay-port>`. Test relay forwards unchanged method/path/body/auth to real `serve` at a separate isolated loopback port. No redirect, proxy environment, remote endpoint or MCP-over-HTTP claim. Only run-owned config copies change port. |
| Registration | Owner Bearer; `POST /v1/adapter` with `{}`; real `201 {registration_id,registration_secret}`. First valid prepare registers before `POST /v1/handles`; two concurrently submitted, serialized calls reuse one registration. This is not overlapping execution/single-flight proof; reuse accepted U2b-1 binding-unit single-flight evidence at `bc4ac68`. Duplicate adapter's tool result is `OWNER_IN_USE`, with no extra handle/journal write or deletion. |
| Heartbeat/release | `POST /v1/adapter/{registration_id}/heartbeat`, `{}`, owner Bearer plus `X-Proceed-Registration`, real 204. Observe production 10s cadence (at least 9500ms since observed create, arrival allowance up to 12500ms). `DELETE /v1/adapter/{registration_id}` uses captured owner/secret; EOF exits, then a newly launched adapter succeeds immediately without lease waiting. |
| Restart | Gracefully stop only the owned real broker through existing fixture IPC-to-SIGTERM handling, restore its backend port for startup/readiness, then restore relay config. Retain the SAME adapter. Old heartbeat receives 401; one new registration and subsequent real 10s heartbeat succeed. No tool is called to trigger recovery and no business replay occurs. |
| Privacy | Bounded 65536-byte consumer per process, full per-stream chunk concatenation, dynamically learned raw owner/control/registration secrets checked through shutdown. Strict MCP consumer rejects unexpected/malformed frames. Setup output is checked after credentials are known. Legitimate prepare capability output is allowed; raw registration authority is not. |

The relay is a test-only observer/fault injector, not the source of positive registration or prepare results. Broker startup uses the existing `startup-guards-preload.mjs` for finite readiness/stop and offline HTTPS refusal only; no Telegram/pairing is performed. No synthetic positive broker result substitutes for real lifecycle proof.

## Tests, run sequence and environment

Windows PowerShell, project Node 24.22.2 only. Native Windows is representative of the selected same-machine stdio/loopback socket/process boundary; no all-OS, host or release claim. Set `$Node24='../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe'` from this worktree. No foreground service: repository-owned finite harness contains startup, readiness, execution, teardown and namespace rebind.

1. Syntax-check the three owned test/helper files (10s each).
2. `& $Node24 --test tests/public-registration-consumer.test.mjs tests/portable-registration-public.test.mjs` (120s outer). Consumer is calibration only. `PORT-PUBLIC-LAZY` asserts brokerless zero HTTP for initialize/catalog, invalid prepare/management, unknown tool, unimplemented request and EOF; then real lazy create/order, duplicate denial/no mutation, captured release, replacement success. `PORT-PUBLIC-RESTART` asserts the retained-adapter sequence above.
3. Run the dependent fault packet, then accepted binding/transport tests, U2a tests and affected setup/CLI/catalog/reservation tests in the U2b-1 sequence. No waiting tests are implied by this packet.
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s); scoped `git diff --check` (10s). Formatter excludes tests/OpenSpec; owner reviews those. After production implementation also run its syntax/build and obtain independent affected verification.

Harness limits: 50s work deadline / 65s per test; 8s broker readiness; 3s ordinary RPC/fault observation. Each owned process is registered with accepted `managed-spike.mjs`, which verifies process-tree absence and removes only its own ignored `tests/.artifacts/spike-*` directory. Relay cleanup destroys owned upstream/client sockets, closes listener, verifies socket absence and rebinds the same port. Teardown recovery never substitutes for an EOF assertion. Unknown existing artifacts remain untouched.

Decomposition triggers **1 YES / 2 YES / 3 YES / 4 YES / 5 YES**: the wiring consumes accepted binding state, restart resets the registration baseline, the HTTP observer must precede heartbeat, lifecycle/fault conclusions span packets, and setup/proof use distinct real processes. Supplied Architect bounded approval covers both packets, subject to the now-resolved release barrier and evidence-label corrections. No unit independently authorizes partial wiring acceptance.

## Preparation evidence — 2026-11-01

Initial bounded combined run on baseline `cfc0edd`, Windows Node 24.22.2: syntax PASS; **1 consumer PASS / 10 public expected RED**, exit 1, 44385ms, zero cancelled/skipped. LAZY passed brokerless catalog/invalid prepare/unimplemented/no-contact/EOF and real prepare, then stopped at zero registrations versus one. RESTART stopped at the same missing binding before heartbeat. Fault stopping points are recorded separately. Subsequent additions expand invalid-call coverage and strengthen downstream shared-budget/privacy assertions; final evidence follows in tasks. All downstream registration/duplicate/heartbeat/restart/release assertions remain unexecuted. Managed process/directory and relay socket/listener cleanup PASS separately. This is not wiring acceptance.

Correction parent `119bfb23`: public assertion now explicitly labels registration reuse, not public single-flight. No production concurrency change is required; execution remains serialized until the waiting unit. Accepted binding-unit single-flight evidence is reused unchanged, not replayed or promoted into public proof. Corrected current run and separate correction size are recorded in tasks.

## Bounded implementation handoff — 2026-11-01

Preparation HEAD `391091fb0df254e6b42b5b6c035d3c52a034b9aa`; same retained worktree/branch and project baseline above. Reuse reviewed preparation **475 gross / 7 paths** and focused correction **78 / 6 paths** as separate existing review units. Unchanged tests are not new production lines. Supplied source-grounded production forecast is **145–195 gross**, ceiling **220**, only the three wiring paths above. Recount actual production at acceptance; return scope/ceiling growth through coordination before expanding.

Implementation-selected cut (not additional production design): private executor returns `{execute,close}`. One ordinary `AbortController` aborts actual local-client requests; close fences work, then awaits existing `registration.close` within one shared budget. Server `onInputClosed` runs immediately on stdin closure **before** draining the serialized execution chain and skips queued work. CLI constructs binding/executor and closes once in `finally`. Existing binding, local-client and broker stay unchanged; no new public API or test shape. Preserve valid-input/lazy-registration ordering and brokerless catalog behavior.

Post-code acceptance, in order, using the Node/environment and bounded harness above:

1. Syntax-check the three wiring modules and existing four public test/helper files (10s each).
2. Consumer/public lifecycle command above (120s), including actual production **10s** heartbeat and retained-adapter restart; then the EOF/fault packet command (180s). Both packets must pass; downstream RED barriers cannot be credited as proof.
3. Binding/actual abort: `& $Node24 --test tests/portable-registration-binding.test.mjs tests/local-client-abort.test.mjs` (20s); U2a: `& $Node24 --test tests/portable-registration-unit.test.mjs tests/portable-registration-http.test.mjs` (100s); affected U1/setup/CLI/catalog/reservation: `& $Node24 --test tests/portable-setup.test.mjs tests/portable-setup-cli-checkpoint.test.mjs tests/portable-mcp-catalog.test.mjs` (300s).
4. Review source ordering (immediate EOF fencing before drain, actual ordinary abort, captured release/shared 2000ms budget, no queued broker work, closed errors); `& $Node24 scripts/build.mjs` (30s), formatter above (30s), scoped production/owned-doc `git diff --check` (10s). Record assertion and owned cleanup verdicts separately, including process/directory/socket absence and listener rebind.

Readiness recheck: existing decomposition **1–5 YES** and boundary/test-artifact conditions are covered by supplied Architect acceptance; the combined release barrier is corrected. No new cross-unit contract or assertion is introduced here, so no further blanket review is required. A source/contract conflict returns for focused review; do not weaken assertions. Existing **1 consumer PASS / 10 public expected RED** is reused, not rerun for unchanged readiness; downstream lifecycle/fault assertions remain unexecuted. Implementation must pass the gates above before bounded wiring acceptance. No waiting, Telegram, Events, feature, release or promotion claim; worktree remains active/retained, not cleanup-ready.
