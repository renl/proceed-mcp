# 03A.1c U2a — broker registration readiness

Parent: [tasks](../tasks.md); contract: [design](../design.md) sections 2, 3 (registration timing/authentication/lease/restart/fencing), 7; predecessor: [U1 verdict](03a1c-reservation-readiness.md#u1-independent-affected-verification--2026-11-01).

**Review-ready, expected RED; no implementation acceptance.** Architect conditionally approved separate U2a registry/routes then U2b adapter binding. This packet supplies the executable/boundary review inputs; coordination must obtain affected interface/decomposition/test-artifact clearance before implementation. No production code changed.

## Goal, chain and ownership

Founder-visible eventual success: a human decision reaches its original waiting MCP call privately without a proprietary harness API. U2a only enables that outcome by authenticating ephemeral broker reachability; it neither asks a question nor returns a human decision.

- Same worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`; lifecycle owner Test engineering; **active, retain, not cleanup-ready**. Next: review this packet, then bounded implementation and independent affected verification. Cleanup evidence: run-owned harness resources only; worktree removal awaits verified landing or explicit abandonment.
- Project baseline `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`; packet comparison parent `1286ca4`. Prerequisite: U1 production `88d337de01faed0c595e8b880bd6a36e5c2199fc`, independent evidence `1286ca4`, present on this change branch. One OpenSpec PR; checkpoints are not separate PRs.
- Authorized owned paths: `tests/portable-registration-unit.test.mjs`, `tests/portable-registration-http.test.mjs`, this slice and `../tasks.md`. Production selected by implementation engineering: new `src/broker/registration.js`, additions to `src/broker/portable-server.js`, clock threading in `src/broker/portable-runtime.js`; forecast **~200 gross changed lines**, not permission to exceed the packet cap.
- U2a does not bind adapters. Existing U1 tools remain registration-free; initialize/catalog remain brokerless. U2b requires pinned passing U2a first, then public lazy/single-flight registration, heartbeat, duplicate-owner execution errors, EOF fencing/release/restart and actual lifecycle transport-abort proof. Actual request/wait comes only after registration proof, never before it.
- Preserve all other owner edits and unknown artifacts. No source/config/README/owner-document changes, root state, `.env`, real token, live Telegram, host/model/global files, external scratch, publication, PR, archive, push or nested dispatch.

## Boundary Verification

Source grounding: design 2/3/7 and actual `portable-server.js` / `portable-runtime.js` at U1. New registration module/routes are absent, not assumed implemented. Existing fixed loopback listener, Bearer/role/browser checks and JSON parser are reused. No new external platform or research spike; this is private product HTTP IPC, not MCP HTTP or a harness API. No names renamed.

| Wire boundary | Exact contract / executable check |
|---|---|
| Destination | `http://127.0.0.1:<configured-port>` only; same-machine HTTP. No redirects/proxies/DNS/remote destination or automatic production port choice. Fixture owns its disposable configured port. |
| Create | `POST /v1/adapter`, owner `Authorization: Bearer <owner credential>`, JSON `{}`; `201 {registration_id,registration_secret}` only. Duplicate live owner: `409` / `OWNER_IN_USE`. Different owners admit independently. Registration does not replace request authority or authenticate an agent session. |
| Heartbeat | `POST /v1/adapter/{registration_id}/heartbeat`, same owner Bearer plus `X-Proceed-Registration: <secret>`, JSON `{}`; `204` with zero response bytes. U2b sends every 10s; U2a asserts authenticated endpoint operation, not adapter scheduling. |
| Delete | `DELETE /v1/adapter/{registration_id}`, same two credentials, no JSON body requirement; `204` empty response. Release only captured owner/ID/secret, never owner slot alone; stale secret cannot remove replacement. |
| Order | Browser denial/readiness → Bearer (`401/AUTH_REQUIRED`) → owner role (control `403/FORBIDDEN`) → for POST, 64 KiB limit and JSON-object parsing (`400/INVALID_ARGUMENT`) → existing-registration authentication → remaining fields. Create/heartbeat permit no fields; create validates body before duplicate admission. Unknown methods/suffixes/missing path segments remain route-not-found. |
| Exact registration denial | Missing/malformed ID on recognized routes, missing/malformed/wrong secret, foreign owner, unknown/expired ID: HTTP `401`, exactly `{schema_version:1,error:{code:"AUTH_REQUIRED",message:"registration authentication required",retryable:false}}`. No existence details, renewal or mutation. A valid secret with extra heartbeat fields is `400`; invalid secret with those fields stays `401`. |
| Lease and restart | Default 45000ms; expires at `now >= last_authenticated_activity + 45000`, before lookup/admission without sweep. Only fully validated successful heartbeat/wait/returned renew; failed activity and owner-only handles/management never renew. Delete releases. Restart clears registrations, retains principal and request verifiers. U2a contains no wait/returned routes. |
| Privacy/state | ID/secret in memory only; secret returned only on create, never inventory/status/logs/journal/model/Telegram. Journal stays version 2 with unchanged bytes. Status retains `{schema_version:1,broker:{pid,port,started_at},requests:[]}` here. Reservation survives release/restart byte-for-byte; no actionable approvals exist, so approval noncancellation is not proven here. |

Selected internal binding (not a public encoding requirement): exports `REGISTRATION_LEASE_MS=45000`, `REGISTRATION_ID_PATTERN=/^reg_[a-f0-9]{32}$/`, `REGISTRATION_SECRET_PATTERN=/^[a-f0-9]{64}$/`; `createRegistrationRegistry({clock=Date.now,leaseMs=45000,logger=()=>{}}={})`. `register({ownerId})` asynchronously returns `{registration_id,registration_secret}`; `authenticate/heartbeat/release({ownerId,registrationId,secret})` return boolean; `close()` returns void, terminal/idempotent. Tests reject register after close without prescribing a new public error code. These are implementation-selected seams only; production must not import tests.

## Executable mapping, proof and limits

Product trace: continuation delta **Exact originating-session delivery** (scenarios **Another session attempts access**, **Capability does not cross transport principals**) and **Portable waiting-call outcome delivery** (scenario **Prepare then ask and wait**); Telegram delta **Durable decisions and single resolution**, **Fail closed without misleading status**. Design 3/7 supplies the registration-specific admission contract. This packet covers prerequisites only, not completion of those broad requirements.

| Test / command selector | Deterministic result required after implementation |
|---|---|
| `PORT-REG-UNIT` | Exact selected constants, independent secrets/IDs, per-owner duplicate conflict, correct/foreign/invalid authentication, secret-free logger. |
| `PORT-REG-CLOCK` | Just before/exact/after expiry; duplicate admission at exact expiry without sweep; stale heartbeat/delete cannot affect replacement. |
| `PORT-REG-RENEW` | Heartbeat renews; invalid heartbeat/authentication and foreign release do not; renewed deadline exact before/at/after boundary. |
| `PORT-REG-CLOSE` | Release only captured incarnation, idempotent terminal close, no subsequent admission/authentication/heartbeat or revival. |
| `PORT-REG-HTTP` | Actual protected broker HTTP create/heartbeat/delete positives; Bearer/role/Origin/secret/body/order negatives; duplicate admission; stale release fencing; graceful restart invalidates old authority and admits fresh; journal/config/credential bytes and credential inventory unchanged, no requests/Telegram effects/disclosure. |

HTTP success versus denial is direct proof of this enabling IPC boundary, not founder-visible outcome proof. Controlled-clock tests and source review are proxies with explicit limits: no actual 45s wall-clock scheduling, entropy quality, OS interruption/flush, actionable approval access, adapter heartbeat/fencing, live host, Telegram, Events or feature/release acceptance claim. Reuse U1's 14/14 at `88d337d` / `1286ca4` for unchanged reservation/setup/CLI/catalog scope only; no recount as new proof. After U2a rerun affected gates below. Review production registry ownership/close and runtime clock threading; ensure body validation completes before renewal. Public invalid-body nonrenewal at 45s is not measured by this HTTP test.

Decomposition checklist: **1 YES** (U2b consumes new registration), **2 NO** (run-isolated disposable state), **3 YES** (registry before binding/heartbeat), **4 YES** (split broker → adapter lifecycle proof), **5 NO** (HTTP setup and proof share one managed fixture). Architect affected decomposition/interface/test-artifact review required via coordination. No test-only public API or mock registry used.

**Open U2b question:** select implementation-owned cancellation binding for in-flight create/heartbeat/release HTTP work and late-completion fence. Architect requires actual local request/socket termination within the shared 2s shutdown budget; `Promise.race` alone is insufficient. This packet selects no private abort API, creates no U2b tests and does not authorize adapter binding.

## Run order and evidence (Windows PowerShell, project Node 24)

Use `$Node24` for project-owned `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` (root-relative); execute from the active worktree. No install or default Node 22. Native is representative for pure registry logic and the same-machine loopback/protected-state boundary only. Existing `portable`/`managed` harness owns startup, finite readiness, 55s total, HTTP 1s aborts, process-tree teardown, directory removal and fixture close/rebind; test timeout 65s. Ignored `tests/.artifacts/` only; no new scratch infrastructure.

1. `& $Node24 --check tests/portable-registration-unit.test.mjs`; same for HTTP (10s each).
2. `& $Node24 --test tests/portable-registration-unit.test.mjs tests/portable-registration-http.test.mjs` (100s outer). Registry gate first logically; HTTP is independent and may run concurrently. Both must pass before U2b readiness.
3. After implementation: `& $Node24 --test tests/portable-setup.test.mjs tests/portable-setup-cli-checkpoint.test.mjs tests/portable-mcp-catalog.test.mjs` (300s outer), plus syntax on the three changed production files. No waiting gate or live platform execution here.
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s); formatter excludes tests/OpenSpec, so manually review those plus `git diff --check` for owned paths (10s).

2026-11-01, parent `1286ca4`, Windows Node **24.22.2**: syntax both exit 0; combined command exit **1**, **0 PASS / 5 expected RED / 0 cancelled / 0 skipped**, 7493ms. Four registry tests stop at `ERR_MODULE_NOT_FOUND` for selected new module. HTTP creates its baseline reservation, then stops at first registration create: **404 instead of 201**. All downstream lifecycle/negative/restart/privacy assertions remain unexecuted, not passed. **Cleanup PASS separately:** managed cleanup checked before reporting assertion failure; controlled listener close/rebind completed. Later test-only addition strengthens downstream renewal boundary checks; unchanged missing-module barrier not replayed. No production acceptance or finalization delta claim.

Final Node 24 syntax, repository Prettier and owned whitespace checks exit 0; excluded tests/OpenSpec manually reviewed. Post-RED additions only strengthen downstream clock/state-inventory/status assertions; first-create/missing-module barriers unchanged, so no redundant RED replay. Metadata-only artifact listing contains only pre-existing unknown `spike-IHohKV`, untouched. Packet actual versus `1286ca4`: **4 owned paths / 291 gross changed lines** (unit 99, HTTP 118, slice 63, tasks 9 additions + 2 deletions); production actual **0**. With **~200** production forecast: **~491 gross / 7 unique paths**, below 600/20. Recount actual implementation growth; if over budget, split registry unit from HTTP packet before implementation, not an automatic oversize authorization. Previously reviewed U1 evidence is reused, not recounted.
