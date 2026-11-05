# 03A.1c — public reservation execution

Parent: [tasks](../tasks.md); authority: [design](../design.md) sections 2–4 and [portable waiting sequence](03a-portable-shared-waiting.md).

**Status: U1 implementation preparation ready under the targeted review conditions below.** No production implementation or behavioral pass. The U1 addendum supersedes Phase A's open sequencing questions, not later registration/waiting gates. One OpenSpec branch/worktree/PR; no separate slice PR or promotion.

## Goal and baseline

Founder-visible eventual success: the human's explicit decision reaches the original waiting MCP call without a harness API/password or proprietary metadata.

This checkpoint only enables that outcome: a generic MCP caller privately obtains durable request authority without pairing, an actionable request, or a Telegram question. A prepared handle is neither approval nor a human decision, and cannot wake an agent.

- Worktree: `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`; retain active.
- Project baseline: `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`.
- Preparation parent: `b9c463a73fcd1a86a32792b39c85b7e1302c40ca`; production prerequisite `ee6d720f706d18c2aa46f3ddfafd685c22045ff2` is present on this branch, independently setup-verified.
- Proof for this enabling boundary: actual `tools/call prepare_approval` returns the private key only after real broker reservation; subsequent reserved read/cancel/ack returns honest errors without mutation, including after graceful EOF/restart.
- Proxies: catalog/schema, journal byte/hash scan, internal authority tests, controlled Telegram transport. Bytes do not prove OS flush/interruption, and reserved-only negatives do not prove authorization on existing approvals. No waiting, real Telegram, host, Events, feature or release acceptance.

## Authorized Phase A files and constraints

Only `tests/portable-setup.test.mjs`, `tests/support/portable-waiting.mjs`, this slice and `../tasks.md`. No production/config/dependency edits. Preserve other owners' dirty/untracked material. Do not touch root runtime state, `.env`, real tokens, current host registration, model/global paths or unknown artifacts. Use existing ignored run-owned fixture namespaces only.

The helper's opt-in `strictProtocol` uses existing `catalogPeer`, `initializeResult`, `allTools` and `successful`; no new protocol consumer or mandated production helper design. Default future waiting setup retains `pair:true`; only reservation uses `pair:false`. First-use pairing/decision acceptance is unchanged and remains later work.

Capabilities are transferable bearer authority **within their bound transport principal**, not nontransferable agent identity. Labels, RPC IDs, `clientInfo`, known request IDs and `_meta` do not authenticate sessions. Do not impose one connection per agent session. EOF/registration loss ends reachability, never business cancellation.

## Boundary Verification

Source grounding: current design sections 2–4, MCP revision `2025-11-25`; existing sources `src/cli/main.js` (`runMcp`), `src/mcp/server.js`, `src/broker/portable-server.js`, `src/broker/portable-runtime.js`, `src/broker/portable.js`. These are private product IPC routes, not OpenCode APIs or MCP-over-HTTP. No names renamed.

| Boundary | Exact contract and check |
|---|---|
| Public entry | `proceed-mcp mcp --owner <owner_id> --state-dir <directory>`; stdio newline-delimited JSON-RPC, initialize revision `2025-11-25`, tools capability, no Events/tasks/sampling/resources or proprietary metadata prerequisite. Original RPC ID receives only its own response. Strict consumer rejects malformed/unmatched/unsolicited output through shutdown. |
| Preparation | `tools/call` with `name:prepare_approval`, `arguments:{session_label?}` only. Label 1–128 Unicode scalar values, display only; omitted label defaults to operator label. Success: `isError:false` and matching text/`structuredContent` `{schema_version:1,request_handle,request_id,request_capability}`. Formats: `hdl_` + 32 random lowercase hex, independent `req_` + 32, `cap_` + 64. |
| Real reservation | Exact destination `http://127.0.0.1:<configured-port>/v1/handles`, `POST`, owner `Authorization: Bearer <owner credential>`, JSON `{session_label?}`; `201` same reservation shape. No redirects/proxies/DNS substitution/remote addresses or automatic port selection. Derive owner from credential, never body/model/session metadata. Await durable append/flush before success. |
| Reserved lookup | `GET http://127.0.0.1:<configured-port>/v1/requests/{request_id}`, owner Bearer plus `X-Proceed-Request-Capability`; no JSON body. |
| Reserved cancel | `POST http://127.0.0.1:<configured-port>/v1/requests/{request_id}/cancel`, same two authorities, JSON `{}`. |
| Reserved ack | `POST http://127.0.0.1:<configured-port>/v1/requests/{request_id}/acknowledge`, same authorities, JSON `{decision_id}` (`dec_` + 32 lowercase hex). |
| Negative outcomes | Valid reservation without approval: `404` / `NOT_FOUND`, no effects. Missing/invalid/foreign/mismatched request capability: same nondisclosing result. HTTP uses `{schema_version:1,error:{code,message,retryable}}`; tool execution errors use `isError:true` with matching structured/text envelope. Malformed tool input: `INVALID_ARGUMENT`; missing/invalid transport authority: HTTP `401` / `AUTH_REQUIRED`; owner on control or browser Origin: `403`; no CORS. JSON body limit 64 KiB. |
| Persistence/privacy | Commit `{owner_id,request_handle,request_id,capability_hash,session_label,prepared_at}`, SHA-256 of complete capability string; never plaintext key. Control/owner/registration secrets never enter model results, arguments or journal. Request capability appears only in its preparation result/subsequent authorized arguments, never logs/errors/status/Telegram. Reserved identities create no business request or presentation. |

### Registration prerequisites — not silently omitted

Design requires `POST http://127.0.0.1:<configured-port>/v1/adapter`, owner Bearer, JSON `{}`, `201 {registration_id,registration_secret}`. Only one live registration **per owner** (`OWNER_IN_USE`, HTTP `409`), not per logical session. Secret: protected random 256 bits, ephemeral, not model-visible or journaled. Design does not prescribe registration ID encoding; do not invent one.

`POST http://127.0.0.1:<configured-port>/v1/adapter/{registration_id}/heartbeat`, owner Bearer plus `X-Proceed-Registration`, JSON `{}`, returns `204`; every 10 seconds even without a wait. Lease expires after 45 seconds without authenticated activity. `DELETE` at the same registration URL, same owner and registration secret, returns `204` and releases only that registration. Secret mismatch returns `401`. Restart resets registrations; retained adapter may register again, never steal a live registration. EOF teardown must release reachability without cancelling approvals.

**Source gap:** `runMcp` currently verifies then discards its owner credential and calls the catalog-only `runMcpServer()` with no broker binding. Every known `tools/call` returns `ENHANCEMENT_UNAVAILABLE`. HTTP already implements real durable `POST /v1/handles`, but no registration/heartbeat/delete or request routes exist. Unknown routes currently return generic `404`, which is not proof of authorized reserved lookup. `portable-runtime.js` starts no Telegram poller. No missing production interface or execution success is assumed.

## Executable mapping and outstanding bindings

Product sources: [continuation delta](../specs/opencode-session-continuation/spec.md) requirements **Portable waiting-call outcome delivery** (scenario **Prepare then ask and wait**, preparation portion only) and **Exact originating-session delivery** (scenarios **Another session attempts access**, **Capability does not cross transport principals**, **Capability shared within its transport principal**), plus telegram-approval **Distinguishable approval requests**, **Durable decisions and single resolution**, **Fail closed without misleading status**. Design sections 2–4 supply the reservation-specific details; reserved-only errors do not complete those broader scenarios.

| Gate / location | Deterministic assertions / evidence limit |
|---|---|
| Existing `PORT-RESERVE`, `tests/portable-setup.test.mjs` | Generic public handshake/catalog then two equal-label prepares with independent handle/ID/key; exact private response, persisted identities/hash not plaintext before response; no pairing required. Not catalogue-only success. |
| Same case, downstream | Two malformed prepares return `INVALID_ARGUMENT`. Three reserved operations × three key combinations (correct, other handle, fabricated) × shared/foreign/restarted shared connections = 27 `NOT_FOUND` results with matching text/structured errors and redaction. No journal changes or business requests, no Telegram effects. All remain unexecuted until preparation succeeds. |
| Existing strict consumer, opt-in fixture | Owner/control credential byte checks, bounded output, exact RPC matching, JSON framing, EOF/both streams verified; request keys allowed only in intended prepare responses, excluded from later results/logs/journal/notifications. No host API/password/metadata inherited. |
| Existing setup proof, reused | `ee6d720`: three PORT-SETUP cases, eight CLI cases, one strict catalog PASS; protects setup, roles/browser/body limits, real HTTP reservation and graceful replay. Rerun affected cases at eventual implementation; unchanged full setup evidence is not replayed during test-only preparation. |
| Existing authority proof, reused | `2794261`: 8/8 authority/journal cases, including verifier/principal binding and awaited append. Stronger real OS interruption/flush proof remains later. |
| Missing executable binding | Real MCP adapter's outbound owner credential/capability headers, registry lifecycle/duplicate owner/heartbeat/expiry/deactivation, and no fallback to catalog-only success. Select test binding after SE proposes internal cuts. No production-imported fake schema/helper. |

Reserved-only wrong-owner/key errors cannot distinguish correct validation from generic route-not-found. Final acceptance additionally requires source review of actual owner/key validation and a selected positive/negative boundary test that distinguishes them; existing authority tests support, not replace, that consumer seam. Authorization on actionable requests remains a later waiting gate, not waived here.

## Historical Phase A sequencing and questions (superseded by U1 below)

1. **First proposed enabling unit:** real ephemeral registration lifecycle over authenticated private HTTP, without request creation/pairing. This supplies the later adapter's prerequisite. SE must select safe internal cuts, exact production paths/forecast, and its internal test binding; no private signatures imposed here.
2. Subsequent checkpoint(s): owner-selected adapter connection to real handle reservation, private response/error handling, then capability-authorized reserved request operations and EOF/restart. Keep final PORT-RESERVE vertical gate intact. No partial promotion or separate PRs.
3. Only afterward: existing 03A.2 pairing/human waiting tests. Never make reservation depend on those later actions.

Before implementation, obtain through coordination:

- SE-selected cuts and measured/forecast gross production delta per cut; do not assume HTTP/registry/adapter/request-management together fit 600 lines. Freeze an internal binding only after SE selection, then author bounded executable tests and map each cut's commands/prerequisites.
- Architect confirmation of registration timing versus offline catalog discovery: current accepted `PORT-CATALOG` runs without a broker, while execution needs a live registration. Keep honest brokerless catalog behavior or explicitly reconcile that test/contract; do not silently force catalog discovery to need pairing or broker startup.
- Architect confirmation of request-route reserved validation coverage before business request implementation: missing routes must not masquerade as validated `NOT_FOUND`. Which selected seam demonstrates actual principal/key validation? No extra production test API authorized.
- Preserve honest partial execution instructions: prepare may be available while waiting remains unavailable. Current claim that **every** call is unavailable must change if prepare executes, without claiming waiting/delivery works. Do not weaken catalog privacy/workflow checks.

Decomposition checklist: **1 YES** (ephemeral registry consumed by adapter), **2 UNCERTAIN** (deactivation/restart baseline), **3 YES** (registration/heartbeat precede consumption), **4 YES** (registry → adapter → durable HTTP proof chain), **5 YES** (fixture preparation versus later pairing/wait proof). Architect decomposition-fidelity and interface-fidelity reviews required through coordination before readiness. No new product ownership decision requested.

## Run sequence (Windows PowerShell, project Node 24)

Use `$Node24` for the existing project-owned Node 24.22.2 executable; do not install or use the default Node 22. Run from this active worktree. Native execution is representative for this local stdio/loopback/account-ACL boundary only; controlled Telegram is not live platform proof.

1. Syntax: `& $Node24 --check tests/portable-setup.test.mjs`; `& $Node24 --check tests/support/portable-waiting.mjs` (10s each).
2. RED/reservation: `& $Node24 --test --test-name-pattern='PORT-RESERVE' tests/portable-setup.test.mjs` (75s outer). Harness total 55s, test 65s; run-owned startup/readiness/ports/state/teardown, fixture close/rebind. No interactive foreground server.
3. After selected production cuts, run new cut-specific gates first, then PORT-RESERVE, affected CLI/catalog plus all three PORT-SETUP cases together (200s outer). Revalidate changed helper behavior with future waiting tests only once that production prerequisite is present; no pairing bypass.
4. Format: `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s). Tests/OpenSpec excluded by repository formatter; manually review them and run `git diff --check` on owned paths.

## Phase A execution — 2026-11-01

Windows project Node 24.22.2: both syntax checks exit 0. PORT-RESERVE exit 1, **0 PASS / 1 RED**, zero cancelled/skipped, 6761ms. Stops at the **first prepare**: existing production returns an execution error instead of private authority. All new downstream reservation/denial/restart assertions remain **unexecuted**, not passed. Source identifies the explicit catalog-only unavailable result; no missing broker or pairing false prerequisite. Strict peer inspected shutdown; managed process/tree/state cleanup and Telegram fixture close/rebind PASS separately. No unknown artifacts read/removed; retain worktree.

Sizing against `b9c463a`, gross additions plus deletions: **4 owned paths / 198 lines** (test 49+8, helper 31+7, tasks 4+4, new slice 95). Production actual **0**; forecast **unknown**, blocked pending SE-selected cuts. This packet does not reserve an invented production budget or authorize broad implementation.

Final syntax (both files), repository format check and owned whitespace checks exit 0. Tests/OpenSpec manually reviewed because formatter excludes them. Final test-only edit replaces error-JSON property-order comparison with semantic equality; unchanged first-prepare RED barrier not replayed. Full setup/CLI/catalog evidence reused only in its unchanged production scope, not claimed as executed against the extended test. Final artifact metadata listing contains only the pre-existing unknown namespace; not read or deleted. No production, dependency or configuration changes, and no archive/promotion authority.

## U1 — targeted-review correction and implementation handoff

Targeted Architect review supplied through coordination approves **U1 preparation/reserved denials before U2 registration**, conditionally on the boundaries here. Design section 3 makes handles owner-only; registration remains required for later actual request/wait execution. No eager broker registration for initialize/catalog discovery. No new public contracts, registration ID encoding or production test APIs.

This correction packet owns only this slice, `../tasks.md`, `tests/portable-setup.test.mjs`, `tests/support/catalog-consumer.mjs` and `tests/catalog-consumer.test.mjs`; no production edits. The five production paths below describe the subsequent implementation handoff, not work performed here.

- Prerequisite: shared change-branch commit `4c5a57f` (full setup prerequisite `ee6d720` present); use this worktree's committed U1 tests/spec, not a root copy. Same project baseline/path/branch/change and lifecycle owner as above; status active, retain; next action U1 implementation through coordination; cleanup evidence: only managed run resources removed, no worktree removal due.
- Selected production cut: approximately **300 gross changed lines / 5 paths**: new `src/mcp/execution.js`, existing `src/mcp/server.js`, `src/broker/portable-server.js`, `src/cli/main.js`, `src/http/local-client.js`. This is a forecast, not implementation or permission to exceed the 600-line unit limit. Recount new test/doc corrections plus U1 production against `4c5a57f`; split owned packets before exceeding it. The previously reviewed 198-line Phase A packet is reused separately, not automatically recounted as new U1 growth.
- Implement public prepare → real durable owner-authenticated `POST /v1/handles` → private original RPC response, plus reserved get/cancel/ack forwarding and denial. Keep `request_approval` explicitly `ENHANCEMENT_UNAVAILABLE`; no pairing, business request, wait, Telegram wiring or delivery success. Preserve all other dirty/untracked owner material.
- U2 is a **later separately prepared/reviewed gate**, not part of this authorization: real registration/duplicate owner/heartbeat/expiry/delete/restart/deactivation proof must pass before actual request creation/wait. EOF here proves graceful reachability loss and journal replay only, not registration release.
- Catalog instructions must honestly disclose prepare availability, reserved-only `NOT_FOUND` results and `request_approval` `ENHANCEMENT_UNAVAILABLE`, while retaining the two-call workflow, waiting-outcome purpose, private key retention and no echo. Consumer calibration accepts an explicit partial disclosure without weakening the catalog-only limitation branch or globally accepting vague unavailable text.

### Boundary Verification — U1 binding

Reuse the exact public MCP/HTTP URLs, authorities, bodies and envelopes in the boundary table above; no live external platform calls. The existing real broker, not a fake handler or injected production test API, serves the HTTP test. Native Windows Node 24 is representative for this local stdio/loopback/protected-state seam; Telegram remains a controlled proxy, not platform proof.

| U1 criterion | Required assertion / review |
|---|---|
| Route recognition | New `PORT-RESERVE-HTTP` in `tests/portable-setup.test.mjs`: exact GET request-ID, POST cancel and POST acknowledge with control credential produce `403/FORBIDDEN`; unknown suffix/extra segments/wrong methods produce `404/NOT_FOUND`. Retry stays control-only, not captured by request handlers. No wildcard route swallowing. |
| Authentication/denial | Recognized routes reject missing/bad Bearer `401/AUTH_REQUIRED`. Owner plus absent, malformed, fabricated, mismatched or foreign capability and valid reserved authority yield the same `404/NOT_FOUND` envelope; a nonexistent request does too. No durable effects. |
| Input ordering | Malformed JSON on cancel/ack returns `400/INVALID_ARGUMENT` for reserved and absent request IDs, independent of existence. No invented source-error message or code. Body/header validation preserves the design boundary and body limit. |
| Actual authorization trace | At implementation review, trace each recognized route into **real `broker.authorize`**, with owner derived from verified Bearer credential, request ID from the exact path, capability from `X-Proceed-Request-Capability`. Neither model/body owner nor path/key substitution is allowed. This source criterion supplements public execution; it is not a new prescribed private API. |
| Proof limitation | Reserved authority deliberately always denies. HTTP positive capability discrimination **cannot be proven here**, even if all tests pass. Keep the later actionable positive/negative gate: correct same-principal key succeeds, missing/fake/mismatched/foreign key denies with no mutation; existing authority unit cases are supporting evidence only. |
| Vertical enabling proof | Keep the existing unpaired strict `PORT-RESERVE`: direct MCP prepare must persist real broker handle/ID/hash before response, then malformed prepares and reserved MCP operations, EOF/replay, redaction and no Telegram effects. No replacing this with direct HTTP reservation alone. |

Decomposition checklist rerun: **1 YES** (U1 authority consumed later), **2 NO** (run-isolated reservation; no shared reset), **3 YES** (U2 receiver before actual wait, not before U1 prepare), **4 YES** (enabling/registration/wait proof chain), **5 YES** (unpaired setup versus later pairing proof). These are the targeted review's explicit conditions, now retained without a changed cross-unit contract; no additional Architect round required if implemented faithfully. Any actual ambiguity or changed condition returns through coordination, not an invented contract.

### U1 test order and evidence

PowerShell, same project-owned Node 24.22.2 (`$Node24`), active worktree; bounded native commands, existing managed harness only:

1. Syntax: `& $Node24 --check tests/portable-setup.test.mjs`; same for `tests/support/catalog-consumer.mjs` and `tests/catalog-consumer.test.mjs` (10s each).
2. Consumer proxy only: `& $Node24 --test tests/catalog-consumer.test.mjs` (15s).
3. RED first / implementation gate: `& $Node24 --test --test-name-pattern='PORT-RESERVE' tests/portable-setup.test.mjs` (150s outer; each test 65s / harness 55s). New HTTP seam first, unchanged MCP vertical gate second. All must pass after U1; inspect authorization trace separately.
4. After U1: affected setup/CLI/catalog regressions: `& $Node24 --test tests/portable-setup.test.mjs tests/portable-setup-cli-checkpoint.test.mjs tests/portable-mcp-catalog.test.mjs` (300s outer). Existing brokerless catalog must remain runnable; no U2 or pairing prerequisite introduced. Broader PORT-A/B remain blocked until their later implementations, not skipped acceptance.
5. Format `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s); manual test/OpenSpec review plus owned `git diff --check` (10s). No full waiting, host/model, live Telegram, archive, PR, push or publication authorized.

RED on `4c5a57f` with only owned test corrections, Windows Node 24.22.2: **0 PASS / 2 RED / 0 cancelled / 0 skipped**, 13,903ms. HTTP test stops at first recognized route: actual `404` versus required control `403`; all downstream HTTP matrices unexecuted. MCP test still stops at first prepare (`ENHANCEMENT_UNAVAILABLE` in catalog-only production); downstream private-result/denial/EOF/replay assertions unexecuted. Managed assertion failures are separate from **cleanup PASS** (process/tree/state and fixture close/rebind). No feature pass or new platform compatibility proof.

Final syntax (three changed test/consumer files), isolated strict-consumer proxy **10/10**, repository format and owned whitespace checks exit **0**. After RED, added only downstream request-unavailable/redaction assertions and the `question` helper import; unchanged first-failure barriers were not replayed, and those downstream assertions remain unexecuted. Historical production setup/CLI/catalog evidence above is reused only for its pinned unchanged assertion scope; run affected regressions after U1. No finalization delta or implementation acceptance is claimed.

U1 correction size against `4c5a57f`: **152 gross changed lines / 5 owned paths** (additions plus deletions, including this record); production actual **0**. Combined with the selected **~300 production-line / 5-path forecast**: **~452 gross / 10 paths**, below 600/20; forecast is not actual implementation size. Recount only affected growth and split before exceeding the limit. Phase A's separately reviewed 198 lines remain reused evidence, not new correction growth.

## U1 independent affected verification — 2026-11-01

**PASS, bounded enabling checkpoint only.** This verdict supersedes the earlier U1 readiness/RED disposition, not the outstanding U2/waiting gates. Code candidate `88d337de01faed0c595e8b880bd6a36e5c2199fc`, parent/test packet `1e8210c`; project target baseline remains `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No production/test/dependency/configuration changes during verification. Other owners' seven dirty tracked documents and nine untracked files were preserved; their current design supplies the approved contracts, not executed code.

Windows project Node **24.22.2**, native representative local loopback/stdio/protected-state execution: `--test tests/portable-setup.test.mjs tests/portable-setup-cli-checkpoint.test.mjs tests/portable-mcp-catalog.test.mjs`, 300s outer bound, exit **0**, **14 PASS / 0 failed / 0 cancelled / 0 skipped**, 40,716ms. One run maps to both PORT-RESERVE gates **2/2**, affected PORT-SETUP **3/3**, CLI **8/8**, brokerless strict public catalog **1/1**. No duplicate replay required. Five changed production modules pass `--check`; repository Prettier check and production commit whitespace check exit **0**.

- HTTP proof: recognized get/cancel/ack distinguish control-role `403` from unknown method/suffix/extra-segment `404`; missing/bad Bearer `401`; uniform reserved/missing/key/principal denial; malformed POST JSON is rejected before existence lookup; retry remains control-only; no journal/business/Telegram effects. Existing setup checks also exercise browser denial and the 64 KiB body boundary.
- Public MCP enabling proof: actual CLI initialize/catalog and original `tools/call prepare_approval` responses reserve independent identities/private keys through the real broker without pairing. Identity/hash bytes exist before response; plaintext keys do not persist. Malformed prepares and explicit `request_approval` unavailable error pass. All **27** reserved management denials, shared/foreign/restarted connections, graceful EOF/replay, matching structured/text errors and privacy assertions execute successfully.
- Source trace: `runMcp` reads the bound owner credential and supplies the local client/executor. The executor uses fixed loopback `POST /v1/handles`; broker `reserve` awaits `reserveHandle`, which awaits journal append before returning authority. Recognized request routes enter `reserved`, check owner role before body/state, parse POST JSON before lookup, then call real `broker.authorize` with credential-derived `ownerId`, path request ID and `X-Proceed-Request-Capability`. Its existing verifier/principal/request binding is unchanged. No body/model owner or session metadata supplies authority; no redirect/proxy path is introduced.
- Privacy review and executed assertions: transport credentials remain private; request capabilities appear only in intended preparation results/authorized arguments, not tested errors/status/logs/journal/Telegram. Catalog honestly discloses partial availability; waiting remains `ENHANCEMENT_UNAVAILABLE`, not an outcome. Unchanged strict-consumer calibration **10/10** from `1e8210c` is reused only as test-consumer proxy evidence; unchanged authority **8/8** at `2794261` supports internal binding, not actionable HTTP access.

**Assertion PASS; cleanup PASS separately:** managed process/tree absence and run-directory removal assertions pass; controlled fixture listener closes and rebinds. Metadata-only artifact listing retains only pre-existing unknown `spike-IHohKV`, untouched. No worktree cleanup: same path/branch/change and lifecycle owner, **active / retained / not cleanup-ready**. No external scratch or real environment/token/root state/host/model/global access.

Actual production diff versus `1e8210c` (also unchanged production versus `4c5a57f`): exactly the five authorized paths, **284 additions + 76 deletions = 360 gross**: execution 144, server 73, portable-server 51, CLI 26, local-client 66. The 152-line correction packet plus production is **512 gross / 10 unique paths** before this evidence-only update, below 600/20. No other production paths changed.

**Limits:** reserved-only `404` results cannot prove positive actionable capability access or runtime discrimination between valid and invalid keys. Later same-principal success plus missing/fake/mismatched/foreign-key denial/no-mutation proof is still required. Journal bytes/graceful replay are not OS-interruption/flush proof. Controlled Telegram transport and custom MCP consumer prove neither live Telegram nor a live host connection. No waiting, host, Events, first-use, feature/release acceptance, promotion, PR/archive/publication authority.

**Next U2 prerequisites:** obtain implementation-selected bounded registration cuts/exact paths and gross forecast; author registration/duplicate-owner/secret/heartbeat-10s/lease-45s/delete/restart/deactivation tests and boundary mapping, including brokerless catalog preservation and EOF reachability without business cancellation. Review triggered decomposition/interface conditions through coordination before implementation; registration must pass before request/wait. No U2 tests, APIs or implementation were added here. Evidence finalization is limited to this slice and tasks; any later executable/configuration/baseline drift requires affected revalidation.
