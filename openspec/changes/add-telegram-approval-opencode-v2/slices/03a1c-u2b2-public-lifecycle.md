# U2b-2 — public registration lifecycle preparation

Parent: [tasks](../tasks.md). Contract: [design](../design.md), sections 3/7. Product mapping: [continuation delta](../specs/opencode-session-continuation/spec.md), **Exact originating-session delivery / Capability does not cross transport principals** and **Portable waiting-call outcome delivery / Prepare then ask and wait**. This is prerequisite coverage, not completion of either outcome.

**Architect bounded preparation approval received; conditional corrections resolved below and in [EOF faults](03a1c-u2b3-public-faults.md). Public tests are ready for an implementation sizing forecast, not implementation authorization or wiring acceptance.**

## Goal and ownership

Founder-visible question: can an ordinary MCP adapter privately acquire, maintain and release its broker registration without making catalog use depend on a running broker? Direct proof is public executable/MCP output plus authenticated real broker HTTP lifecycle; journal byte preservation and consumer calibration are supporting proxies. None proves a human decision or cancellation of an actionable approval.

- Worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change `add-telegram-approval-opencode-v2`; owner Test engineering. Project baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`; preparation baseline `cfc0edda7520a57d3d183ee49761d619ff9918aa`.
- Prerequisite: accepted U2b-1 `bc4ac686d66bb3cea23f4c53cffa3310b19b27a7` is present on this branch. Same worktree, sequential checkpoints, one eventual OpenSpec PR. Status active/retained, not cleanup-ready; no new worktree or promotion.
- Owned files: `tests/support/public-registration.mjs`, `tests/portable-registration-public.test.mjs`, `tests/public-registration-consumer.test.mjs`, this slice and the mapped tasks entries. Fault packet reuses this helper without recounting it.
- Anticipated wiring consumers are existing `src/mcp/execution.js`, `src/cli/main.js`, `src/mcp/server.js`. This preparation grants no production edits. Implementation engineering must supply its exact bounded cut and gross-line forecast before implementation routing; no invented internal exports. Public tests require no production test API. The already-selected `onInputClosed` callback/ordinary abort semantics remain implementation choices, not new test-only hooks.
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
