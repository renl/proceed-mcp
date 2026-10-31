# 03A — portable shared-stdio waiting calls

Parent: [tasks](../tasks.md). Authority: [design sections 1–7](../design.md), [delivery delta](../specs/opencode-session-continuation/spec.md), [Telegram delta](../specs/telegram-approval/spec.md). Supersedes the topology blocker in [03 preflight](03-portable-waiting-preflight.md), not its historical evidence.

## Goal, baseline, readiness

Founder-visible success: a paired human's Approve, Reject, or exact Respond text returns on the correct original waiting MCP call, even when unrelated requests share one connection.

| Field | Value |
|---|---|
| Worktree | `.worktree/add-telegram-approval-opencode-v2` |
| Branch / change | `add-telegram-approval-opencode-v2` |
| Project baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Authoring baseline | Initial `dff3da959843a0cda592c525f559b538ccf391be`; refinement `f0359ce2b98808bd57eff37a0387ea049066fe0d` plus corrected dirty proposal/specs/design; preserve all parallel artifacts |
| Prerequisite | Approved request-key ownership, corrected design and deltas present in this worktree; no dedicated agent-session connection prerequisite |
| Status | Architect approved 03A.1 enabling / 03A.2 vertical per scoped refinement brief; enabling gates below make the sizing boundary executable. Product RED, not slice-ready or live-ready |
| Delivery | Internal ordered checkpoints on the one change branch; one eventual PR, no separate slice PR/archive |

Direct proof ultimately requires real Telegram interaction, the original tool result, and useful subsequent assistant acknowledgement in the first validation harness. This packet's real CLI/broker/stdio assertions with controlled Telegram updates are an **offline integration proxy** for that outcome. Fixture self-tests, journal scans and RPC writes alone are not human interaction, host dispatch, OS flush proof, Events support, or release proof.

## Bounded implementation sequence

1. **03A.1 enabling checkpoint:** correct empty schema-2 `init`, stopped-broker `owner add`, protected principal credentials, durable handle reservation and `prepare_approval` catalog/result. This enables proof, not an approval workflow by itself. Keep owner IDs, capability hashes and registration authority distinct. No API/password/version admission or proprietary metadata requirement.
2. **03A.2 waiting vertical:** connect public broker routes, capability validation, waiter correlation, Telegram pairing/presentation/choices and actual terminal MCP results. Pass PORT-A and PORT-B together before claiming the offline vertical complete. Never replace waiting results with receipts or fixture-produced product responses.
3. **03B follow-up, not authorized here:** add full expiry/race/idempotency/replay, abrupt-loss/flush/storage-failure and comprehensive missing/malformed authority assertions; actual host timeout, first Telegram use and native trusted-host result dispatch/private retention. Reuse this packet, do not enlarge it by default. Events remain wire/code BLOCKED until sourced design and live capability proof.

Expected production touch areas for implementation engineering (private file decomposition remains theirs): `src/config/`, `src/state/`, `src/cli/`, `src/mcp/`, `src/http/`, `src/broker/`, `src/telegram/`; executable wiring only as needed. This is not permission to replace all of them in one oversized patch. Estimate and define bounded checkpoints before production work: split enabling from the coherent waiting vertical if either approaches ~20 files/~600 gross changed lines. No partial promotion or separate PR. SDET adapts any changed private transport seam; production must not depend on test code.

SDET-owned refinement changes: `tests/portable-setup.test.mjs`, `tests/support/portable-waiting.mjs`, this slice and `tasks.md`. Existing waiting tests/preload/preflight remain preserved. No production/config/dependency/owner document edits.

### Checkpoint gates and sizing

Selected 03A.1a seam and focused executable gate: [additive owner/config helpers](03a1a-additive-owner-helpers.md). Only two new unused production modules; no existing consumer switch. Helper RED is explicit and distinct from PORT-SETUP.

03A.1 makes the later human-outcome proof possible; it does not deliver a waiting approval workflow. The reported first setup forecast is **7 production files / 550–670 gross changed lines**, not a measured diff or an approved exception. Use additions plus deletions against each pinned pre-checkpoint commit, and account for associated test/spec changes separately without double counting this preparation packet. No new packet may silently exceed ~20 files / ~600 gross lines.

| Internal unit | Executable gate and dependency | Safe review boundary / likely production touch areas |
|---|---|---|
| 03A.1a additive helper/data unit | No new consumer is switched. Preserve currently runnable old behavior; run only existing affected tests for those still-active consumers. New helper/data assertions must be runnable before claiming this unit green; SDET binds focused tests to the SE-selected seam before its implementation. | Candidate split: schema-2 owner value validation/serialization and protected owner credential helpers, or journal format-2 framing support, additive and unused by old consumers. SE chooses layout/design and supplies exact subset/files/forecast plus unchanged-consumer commands. Do not bump a shared schema constant while old consumers still depend on it. |
| 03A.1b consumer switch / setup | Depends on 03A.1a commit if used. `PORT-SETUP` in `tests/portable-setup.test.mjs` must pass all three cases. No prepare call is required by this gate. | Switch coherent config/store/CLI/broker/MCP consumers to schema 2 and owner routes. Likely `src/config/`, `src/state/`, `src/journal/`, `src/cli/`, `src/broker/`, `src/mcp/`. Additive helpers can land first on this branch; only the complete switch claims setup acceptance. |
| 03A.1c reservation | Depends on 03A.1b present. `PORT-RESERVE` must pass; setup remains green. | Preparation authority / hash persistence / tools and broker handle route; no request creation or Telegram presentation. Full durability/replay proof remains in the integrated waiting/lifecycle gates, not inferred from a journal scan. |
| 03A.2 waiting vertical | Depends on 03A.1c present. Whole `tests/portable-waiting.test.mjs` passes PORT-A and PORT-B together. | Actual request/wait/result consumer wiring and Telegram decisions; size before work, additional internal additive seams if needed, never partial promotion. |

These are internal commits on one branch, not separate PRs. Pin each prerequisite commit in implementation evidence before its dependent unit begins. The helper split is a safe **candidate**, not a mandated private architecture or a ready unnamed unit test: SE must first identify its additive seam and forecast; SDET supplies the focused executable gate if that seam is chosen. The already-approved 03A.1/03A.2 separation is not awaiting blanket re-review. Any new cross-unit contract/proof-chain change still needs targeted review via coordination. If neither this candidate nor a smaller coherent consumer switch stays within budget, return exact candidate files/counts, preserved guarantee, tests and the specific unsafe dependency; runtime atomicity alone does not justify an exception. No exception is authorized here.

First implementation review should therefore return the bounded 03A.1a seam/forecast or a demonstrated <=600-gross 03A.1b scope; it need not make full PORT-A green. Do not demand the entire reported 670-line setup packet as one atomic unit. Do not label a partially executed PORT-A as enabling acceptance.

## Executable mapping

| Requirement/scenario and design | Test / deterministic assertion |
|---|---|
| Portable waiting-call outcome delivery / Prepare then ask and wait; design 3 | PORT-A: separate durable authority, independent handles with equal labels, no Telegram question from preparation |
| Exact originating-session delivery / Another session attempts access, Capability does not cross transport principals; design 2–3 | PORT-A: wrong bound key under same principal and valid foreign-principal key denied for creation/read/cancel/ack with NOT_FOUND and no request details; missing-key read denied; pending state unchanged |
| Same requirement / Capability shared within its transport principal; design 3 | PORT-A: another RPC context with deliberately transferred same-principal key reads/cancels; cancellation returns to original waiting RPC ID, not cancelling RPC |
| Telegram Fail closed; delivery Waiting result is lost but request authority is retained; design 3/4/6 | PORT-A: controlled caller-side 250ms timeout, protocol cancellation reason does not business-cancel; later controlled Approve retrievable with retained key; stable decision survives graceful broker restart; no automatic-wake claim |
| Exact originating-session delivery / Decisions arrive out of order; design 3/7 | PORT-B: three concurrent waits on ONE shared stdio, same caller-chosen ID/label and distinct handles; resolve third, second, first; actual terminal results retain RPC IDs 202, 201, 200 |
| Portable waiting-call outcome delivery / Decision before tool completion; Outcomes preserve human intent; Telegram Responses are instructions only; design 3/5 | PORT-B: actual Approve, Reject, ForceReply Respond through controlled Bot API updates; Respond button alone remains waiting; exact approval-like text remains responded, never approved |
| design 2–4/6; Telegram Distinguishable approval requests | Both: no capabilities in Telegram/logs/unmatched notifications/journal; only preparation's authorized result may disclose key; reads never echo it; stable terminal reread and capability-authorized acknowledgement |
| Harness only | FIXTURE: controlled Bot API envelope roundtrip, child preload HTTPS-to-local forwarding and process cleanup, listener close/rebind; NOT product acceptance |
| Design 2 and Migration Plan 5 | PORT-SETUP-CLI/SCHEMA: empty schema-2 init, repeat refusal, stopped-broker owner add, duplicate byte preservation, independent protected control/owner credentials; journal format 2 and format-1 refusal with unchanged journal/config |
| Design 2–3 | PORT-SETUP-IPC: owner-bound CLI MCP handshake; explicit five-tool catalog; owner/control route separation, authenticated browser Origin 403/no CORS, invalid credential 401; no Telegram question |
| Prepare then ask and wait; design 3 | PORT-RESERVE: prepare returns independent handles/keys; all reserved read/cancel/ack return NOT_FOUND; no pairing or Telegram question required |

The shared stdio fixture represents logical invoking contexts only by distinct RPC IDs. It does not authenticate independent agents or prove that a host keeps contexts private. Same-principal key transfer intentionally grants request access. Keys grant no paired-human decision authority and do not wake an agent.

## Boundary Verification — approved 03A interface, catalog gap corrected

| Boundary | Exact contract and fixture binding |
|---|---|
| Public CLI | `init`, `owner add <owner_id> --label <label>`, `serve`, `pair`, `mcp --owner <owner_id>`, all with explicit `--state-dir`. Schema 2; only isolated generated `broker.port` is set to an available loopback port. No existing configuration or `.env` is read. |
| MCP stdio | MCP `2025-11-25` initialize with empty capabilities and generic `clientInfo`, initialized notification, tools/list and tools/call; newline JSON-RPC and identical response IDs. `prepare_approval {session_label}` returns `{schema_version:1,request_handle,request_id,request_capability}`; `request_approval {request_handle,request_capability,client_request_id,action,context,expires_in_seconds}` waits. Read/cancel/ack match design 3 exactly; no `_meta`, Events, OpenCode API/password or allowlist. |
| Broker IPC | Actual `http://127.0.0.1:<configured-port>`; authenticated control `GET /v1/status` for bounded readiness; actual adapter uses design 3 owner/registration credentials and `X-Proceed-Request-Capability`, never model-selected principal. No test reset/decision route. Pairing uses ordinary operator CLI, not seeded paired state. |
| Telegram | Design 5 Bot API 10.3 `https://api.telegram.org/bot<token>/<method>`; existing `https.request` transport is intercepted only in the child via a test-owned Node preload and redirected to an isolated parent fixture. Only synthetic token is installed; ambient application credentials are stripped. The fixture supplies `getMe`, `getUpdates`, `sendMessage`, answer/edit envelopes and private-chat updates. Actual product consumes updates, persists, resolves and returns MCP results. No fixture constructs MCP outcomes or production state. |
| Human decisions | Read actual InlineKeyboardMarkup `a:<token>`, `r:<token>`, `t:<token>` values; paired user/chat `7`; actual ForceReply message ID maps exact text. Local update injection is explicitly NOT a real Telegram human/client boundary. No production decision endpoint. |
| Timeout/restart | Controlled client timer plus `notifications/cancelled {requestId,reason}` is NOT real host execution timeout. Graceful EOF and broker SIGTERM/restart use public process lifecycle; no stale-owner deletion or automatic lock recovery. Explicit capability-authorized retrieval is observation, not resumption. |

Source grounding: design 6 pins official MCP 2025-11-25 base/tools/transports/lifecycle/cancellation URLs; design 5 and [existing research](../research.md) pin the unchanged Telegram boundary. Source cross-check: current `src/mcp/server.js` and `src/cli/main.js` still implement obsolete origin/metadata/immediate-receipt behavior; `src/telegram/client.js` uses the intercepted fixed-origin `https.request` seam. This mismatch is the intended RED, not a reason to preserve legacy semantics. If implementation changes that private transport, return to SDET to rebind the preload before executing; do not add a production test API or make the production transport depend on this fixture. Real Telegram and host acceptance remain required before feature sign-off; none is authorized by this packet.

Managed lifecycle: existing `managed-spike.mjs` owns isolated ignored `tests/.artifacts/spike-*`, tracked child PIDs and whole-tree termination; fixture closes/rebinds its listener in finally. Commands use allowlisted environment and task-local TEMP/TMP/TMPDIR; no global settings. Readiness 8s, RPC 12s except explicit timeout case, total 55s per product scenario, outer 145s. Output is bounded/redacted; capability assertions compare booleans, never print keys. Native Windows Node 24 is representative for local stdio/loopback protocol assertions, not cross-OS durability or live-platform proof. The reserved-port handoff is not a race-proof port reservation: bind failure must fail, never select another product port.

## Run sequence and evidence

From the assigned worktree, PowerShell/Windows, set `$Node24` to the provided project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` (not system Node). No install/update required.

1. `& $Node24 --check tests/fixtures/portable-telegram-preload.mjs`; repeat `--check` for `tests/support/portable-waiting.mjs` and `tests/portable-waiting.test.mjs`.
2. First setup gate: `& $Node24 --test --test-name-pattern='PORT-SETUP' tests/portable-setup.test.mjs` (200s outer bound, three cases). Then reservation gate: `& $Node24 --test --test-name-pattern='PORT-RESERVE' tests/portable-setup.test.mjs` (75s outer bound). Run both at 03A.1c acceptance. Name-filtered nonselected cases are not passed coverage.
3. Waiting gate, only after reservation: `& $Node24 --test tests/portable-waiting.test.mjs` (145s outer bound). Full PORT-A still requires preparation plus waiting behavior even after schema 2 exists; it is NOT the setup gate. Final acceptance runs both files, with no name filter (350s outer bound).
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (repository format check; tests/OpenSpec are owner-managed exclusions). `git diff --check` for the exact owned paths. Include `--check tests/portable-setup.test.mjs` in syntax checks. No build/install replay is required for test-only authoring; production correction must run its affected build/static checks.

Initial Node 24 Windows run: syntax checks exit 0; test command exit 1, 3 tests: 1 fixture PASS, 2 product RED, no skips/cancellations. Both product cases stop at `config.schema_version`: actual 1, required 2. No broker/adapter or Telegram platform was launched, so later behavioral assertions remain unexecuted, not failed observations or passes. Managed namespace removal and fixture listener close/rebind completed before reporting behavioral RED. Re-run only after affected edits; no fixture fallback, weakening or legacy configuration bypass.

Final authoring run uses Node `24.22.2`: test exit 1, 1 PASS / 2 RED / 0 cancelled/skipped, 3792.4692ms; syntax/format checks exit 0; ignored artifact directory has no entries. Owned diff whitespace check exit 0. The schema prerequisite remains RED after the final assertion additions. Preparation packet budget against authoring HEAD: six owned files, 537 gross added lines (includes preserved pre-existing preflight/index content); no deleted lines. Production growth is separate and must be bounded before implementation.

Refinement evidence (2026-10-31), parent `f0359ce2b98808bd57eff37a0387ea049066fe0d`, Windows project Node `24.22.2`: `--check` on new setup test and changed support exits 0. `--test tests/portable-setup.test.mjs tests/portable-waiting.test.mjs` exits **1**, seven tests: **1 fixture PASS / 6 product prerequisite RED / 0 cancelled / 0 skipped**, 7111.3594ms. Every product case stops at configuration schema 1 versus required 2; all downstream setup/IPC/catalog/reservation/waiting assertions are **unexecuted**, not partial acceptance. Subsequent edits only indent the unentered pairing block and add an ACL assertion after the same failing prerequisite; no behavioral rerun warranted at unchanged production/schema 1. Repository format check and exact owned whitespace checks exit 0; formatter excludes test/OpenSpec content. Managed cleanup assertions passed before behavioral RED; `tests/.artifacts` has zero entries, fixture listeners closed/rebound. No product broker/adapter, live Telegram or host was exercised.

Refinement review budget against that parent is four owned files, **258 gross changed lines** (240 additions / 18 deletions), distinct from the SE production forecast. Other owners' dirty files and pre-existing untracked artifacts remain untouched. This is test/slice preparation for bounded SE review, not integrated-candidate verification or universal MCP compatibility.

Decomposition triggers remain 1 YES, 2 NO, 3 YES, 4 YES, 5 YES for the existing preparation→waiting chain. Architect approved 03A.1 enabling / 03A.2 vertical per the scoped refinement brief (2026-10-31); this refinement fixes the explicit catalog gap and adds setup assertions derived from design 2–4 without inventing new wire contracts. No renewed blanket implementation blocker. New helper seams need only affected test binding and targeted review if they change a cross-unit contract; approved request-key transfer security is not reopened.

Later waiting/lifecycle refinement: explicitly close an adapter's stdin while its approval remains pending; require graceful adapter exit and prompt release of its registration, then a new `mcp --owner` connects without waiting for the 45-second lease. With the retained capability, observe the same pending request and resolve/read it without redirecting any original RPC result. This follows design 1/3 (EOF ends reachability, not durable request lifetime). This expectation belongs to 03B's bounded lifecycle test packet; it is not claimed executed here or required to make PORT-SETUP green.

Lifecycle: active/retain, same path/branch/change; owner test engineering; next action bounded implementation sizing/seam review, then affected independent verification. Cleanup evidence: no worktree removal due; only scenario-owned temporary namespaces/listeners/processes are eligible for teardown. All pre-existing dirty/untracked owner, containment, research and operations artifacts remain preserved.
