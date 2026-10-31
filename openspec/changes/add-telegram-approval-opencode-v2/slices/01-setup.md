# 01 — Empty-state setup and risk-first proof chain

Parent/index: [tasks](../tasks.md). Authority: [design](../design.md) sections 1–3, 6–7; [research](../research.md), retrieved 2026-10-31. Status: checkpoint 1 implementation-ready under existing user authorization and Architect interface/decomposition acceptance, confirmed in the scoped readiness correction brief (2026-10-31). Checkpoints 2–5 are not execution-ready.

## Goal and scope

Enable the operator's first useful setup action from empty state. This checkpoint makes later decision proof possible; it does not itself deliver a decision. Baseline `main` @ `f385409792aff3d46d96b5c4f03358f10c8dc5ba`; prerequisite none. Worktree `.worktree/add-telegram-approval-opencode-v2`, branch `add-telegram-approval-opencode-v2`. All subsequent checkpoints share that branch and require the preceding implementation/evidence commit present, not just a branch name.

Likely implementation files: root production manifest/lockfile, executable/build source chosen by implementation, README setup instructions. Test files: `tests/cli-setup.test.mjs`; later harness/tests remain under `tests/`. Owned task detail is this slice and `tasks.md`. Preserve generated `.opencode/`, other owners' normative content, and dirty root bootstrap. Production MUST NOT depend on tests. No package name/license invention, publication, global config changes, discovery of private host registrations, or test-only application decision endpoints.

First runnable acceptance maps `npm-distribution` / “Complete first useful action from empty state” / “Incomplete configuration” and `telegram-approval` / “Explicit first-use pairing” to design section 2. Tests cover only the enabling subset: init refuses overwrite; valid immutable origin can be added once; invalid origin IDs/topologies are rejected. Full pairing and first decision remain required in checkpoint 2/5.

## Run sequence

Target shell: PowerShell on Windows. Node 24 is a provisional technical design target to verify, not declared actual compatibility or a final support floor. Available Node 22.23.1 can run test-authoring/structural checks; checkpoint behavioral verification needs a representative Node 24 environment and actual OS protection checks. No dependencies or installation needed for test authoring checks. The missing Node 24 environment does not block authorized scaffold implementation.

1. `node --check tests/cli-setup.test.mjs`
2. Before implementation, `node --test tests/cli-setup.test.mjs` must fail explicitly because no executable command was supplied (RED setup evidence, not application behavior proof).
3. After implementation, clean dependency/bootstrap and build using committed production scripts. Implementation supplies the path to its executable without tests dictating private source layout: `$env:PROCEED_TEST_COMMAND='["node","<built-executable-path>"]'` (replace placeholder), then `node --test tests/cli-setup.test.mjs`.
4. `npm run format:check` after production tooling exists; currently BLOCKED (no formatter/manifest). Do not invent a successful formatting check.
5. Before checkpoint 2 live execution, test engineering must land the managed harness and remaining spike assertions; no service starts during this setup. Each command has a caller timeout of 120 seconds; CLI child commands have a 5-second deadline. Setup commands MUST exit without background descendants; serve/MCP services are outside this first test's scope.

The harness creates only run-owned directories beneath `tests/.artifacts`, passes `--state-dir`, removes them in `finally` and verifies absence. Never use real home state. Assertion failure and cleanup failure are separate failures. A protected-state failure on the actual OS must not be skipped or weakened.

## Boundary Verification

No existing production source implements these boundaries. Name mappings: none. The contracts below are inherited, not new API design. Setup checkpoint stores an operator binding only; external calls start in checkpoint 2 after review.

### OpenCode V2 (highest-risk spike)

Research pins unversioned V2 docs/OpenAPI retrieved 2026-10-31, OpenAPI 3.1.0 `info.version:"0.0.1"` (NOT a runtime pin); client 2.2.5 is NOT host compatibility evidence. Sources: `https://opencode.ai/v2/docs/mcp-servers/`, `https://opencode.ai/v2/docs/cli/web/`, `https://opencode.ai/v2/docs/build/plugins/server/`, `https://opencode.ai/v2/openapi.json`.

Wire origin: immutable `http://127.0.0.1:<explicit-port>`; no alternate host/path/query/fragment/userinfo, redirects or proxy routing. Every call uses Basic username `opencode` and nonempty password from the configured environment variable. Missing/invalid auth blocks; no anonymous/discovery fallback. Percent-encode identifiers as individual path segments.

| Method / exact wire URL suffix | Request | Assertion |
|---|---|---|
| `GET /api/info` | no body | `200` unwrapped `ServerInfo`; capture actual version/PID, never follow advertised URLs |
| `GET /api/session/{sessionID}` | no body | `200 {data:Session.Info}`, exact `id`, record `time.created` |
| `POST /api/session/{sessionID}/prompt` | `{id:prompt_id,text:prompt_text,delivery:"steer",resume:true}` | `200 {data:Session.Inbox.User}`; matching `id`, `sessionID`, `type:"user"`, delivery |
| `GET /api/session/{sessionID}/inbox` | no body | `200 {data:Session.Inbox.Info[]}` (NOT bare array) |
| `GET /api/session/{sessionID}/message/{messageID}` | no body | `200 {data:Session.Message.Info}`, exact user ID/text |
| `GET /api/session/{sessionID}/message?type=assistant&order=desc&limit=100` | no body | `{data:[...],cursor:{previous?,next?}}`; follow cursor with same type, omit order |

MCP stdio uses initialize revision `2025-11-25` and `tools/call.params._meta["ai.opencode/sessionID"]`, not model arguments, for session context; configured per-origin credential is separate authentication. `request_approval` returns a durable receipt promptly. A test-owned out-of-process transport fault must force a real execution timeout AFTER durable creation and BEFORE receipt reaches host; merely sleeping after an asynchronous receipt is not timeout proof. Architect must review fault sequencing; never add a production delay/backdoor.

Real spike order: establish authenticated host identity and two sessions; start observation before requests/events; create via MCP and observe Telegram controls; resolve via real Telegram; assert stable `msg_` plus request hex, exact JSON intent, history AND inbox confirmation, then subsequent exact-session assistant acknowledgement. Repeat for each outcome, active/idle/busy, direct/Code Mode and timeout. Preserve same running host across broker restart; deliberately lose admission response and replay same persisted ID/text after inbox departure. Two-origin proof follows in checkpoint 4. Record host version, source hash, execution-timeout configuration and bounded duplicate-observation interval. Never infer `409` means busy. HTTP timeout 10s, admitted polling 2s; design section 6 owns retry/backoff/15-minute blocked semantics.

Unverified: busy/409 cause, timeout scheduling, Code Mode cancellation, deduplication lifetime/hooks, history versus useful continuation, idle location availability. Only spike-proven versions enter an allowlist. Failed semantics stop broad integration and route back for correction. Live auth/host sessions/dedicated bot access have not been supplied or checked in this dispatch; live proof is BLOCKED, not waived. Obtain secure environment readiness without requesting secrets in chat.

### Telegram Bot API 10.3

Wire `POST https://api.telegram.org/bot<token>/<method>` over HTTPS JSON; fixed host only, token from `PROCEED_TELEGRAM_BOT_TOKEN`, never logs/journal/artifacts. Sources `https://core.telegram.org/bots/api` and research section 3. `getMe` verifies token; `getUpdates` uses `{timeout:30,limit:100,allowed_updates:["message","callback_query"],offset:<committed-id+1>}`, HTTP deadline 40s; assert `{ok:true,result:...}` and obey `parameters.retry_after`. No automatic webhook removal.

`sendMessage` sends plain text without `parse_mode`, persists result message ID; inline callback data `a:<32-hex>`, `r:<32-hex>`, `t:<32-hex>`. Check paired `callback_query.from.id`, private `message.chat.id`, stored token/message ID; inaccessible context fails closed. `answerCallbackQuery` uses `callback_query_id` even for denied/stale inputs. Respond uses separate `ForceReply {force_reply:true}` prompt, then stored `(chat_id,message_id)` reply mapping or previously opened `/respond <request_id> <text>`; preserve text exactly and never approve from it. Retire with `editMessageReplyMarkup`, update using `editMessageText`. Mock poller/callback fixtures are proxies; real private-chat pairing/buttons/ForceReply and exact-session continuation remain mandatory.

### npm / CI (deferred, no access or publication now)

Design section 8/research section 4: public identity/license/rights and first-publication bootstrap remain owner/operations gates. Tag `v<package-version>`, protected main history/environment, Node 24 and npm >=11.5.1, GitHub-hosted publishing job, exact repository `https://github.com/renl/proceed-mcp`, workflow `release.yml`, explicit direct `npm publish` OIDC permission. PR CI has no publishing credentials or id-token write. Pack/install proxies cannot prove public registry delivery; exact published-version install remains an operational follow-up.

## Decomposition fidelity review disposition

Independent verification (2026-10-31): candidate `533ea27b67e6c32c89b9e26bccc8432f73d63f27` FAILED additional public-CLI URL-contract assertions despite passing `SETUP-01`. [Evidence and next-checkpoint prerequisites](01-setup-evidence.md). Checkpoint 1 is not slice-ready; the historical implementation-ready status above is not a verification pass. No contract or acceptance criteria changed.

Checklist answers: (1) YES journal/origin/outbox feeds delivery proof; (2) YES restart/offset/crash can contaminate state; (3) YES observation must precede timeout/resolution; (4) YES MCP→Telegram→outbox→host is order-sensitive; (5) YES setup and real proof span checkpoints. Architect accepted checkpoint 1 interface/decomposition review, as confirmed in the scoped readiness correction brief (2026-10-31). This satisfies checkpoint 1's review gate only; planned transport-fault sequencing still requires Architect review before live execution. Tests do not define private module interfaces. Checkpoints 2–5 are not execution-ready; checkpoints 3–4 cannot begin broad implementation before checkpoint 2's real gate passes. If live environment remains unavailable, retain blocked gates and only separately authorized isolated work; do not call the broad plan ready.

## SETUP-URL-001 — bounded regression correction

Gap ID: **SETUP-URL-001**. Correction attempts: **1**. Next owner: **independent affected verification** (test engineering), routed through coordination. Status: regression tests ready, expected RED confirmed; production correction committed at `a9e74a9898c573a3303280cae18a6b745fc27fee` with its affected run sequence PASS recorded below; independent affected verification pending, so checkpoint 1 is not slice-ready. Authority and failure: [design section 2](../design.md), [independent evidence](01-setup-evidence.md). No product behavior, criteria, decomposition or external interface changed; existing checkpoint 1 review disposition remains applicable.

Goal: restore the already-approved literal-loopback and explicit-port setup behavior. Founder-visible success remains a real human decision reaching only its requesting running session after MCP timeout. This offline correction provides supporting setup proof only, not real Telegram/OpenCode continuation proof.

Use the existing worktree/branch named above, with prerequisite `a7d5fff860c5a7c6065c0d48d1382f1a99210076` present on that branch and the regression commit present in the same worktree. Delivery remains a sequential commit in the single OpenSpec change, not a new worktree or PR. Retain the worktree; no push, PR, archive or publication is authorized by this brief.

- Production scope: `src/config/origin-url.js`; adjust only other existing configuration validation callers if needed to preserve the approved behavior. Do not prescribe a private parser algorithm. No unrelated refactoring, dependency/toolchain changes, live requests or weakening OS protection.
- Test scope: authoritative public-executable regression `tests/cli-origin-url.test.mjs`; existing `tests/cli-setup.test.mjs` remains unchanged. Production must not import tests. Implementation does not edit tests or acceptance criteria; report a mismatch through coordination.
- Four regression cases: reject `http://127.1:4096`, `http://2130706433:4096`, `http://0x7f000001:4096` with exit 2 and unchanged protected state; accept `http://127.0.0.1:80` with exit 0 and persist that explicit-port binding. Then reject duplicate replacement with exit 2 and unchanged configuration/credentials. The default-port persistence/duplicate assertions are not reached until acceptance is fixed.
- Do not expand this correction to the exploratory normalized path/empty-query/empty-fragment cases in the failure report. Any disputed syntax interpretation goes to the contract owner through coordination.

### Affected run sequence and evidence

PowerShell on Windows; reuse the existing project-local Node 24.22.2 executable (private handoff supplies its absolute path). Set `$Node24` to that executable, then `$env:PROCEED_TEST_COMMAND = ConvertTo-Json -Compress -InputObject @($Node24, 'bin/proceed-mcp.js')`. No install or service harness needed for these finite offline public-CLI tests. Native Windows is representative for this same-host regression; no all-OS or support-floor claim.

1. `& $Node24 --check tests/cli-origin-url.test.mjs`.
2. `& $Node24 --test tests/cli-origin-url.test.mjs` (RED before correction; all four cases must pass afterward).
3. `& $Node24 --test tests/cli-setup.test.mjs` after correction, to cover the existing setup/forbidden-topology boundary.
4. `& $Node24 scripts/build.mjs`, then `npm run format:check` with Node 24 selected for the formatter; preserve command exits. Formatter scope stays the committed production-owned scope. No formatting changes to other owners' artifacts.
5. `git diff --check`; record candidate revision, affected paths, assertion counts and separate cleanup result for independent affected verification. Do not rerun unrelated full suites or claim the complete feature verified.

Each command has a 120-second outer bound; each test CLI child has a 5-second deadline. Run-owned state is confined to `tests/.artifacts/origin-url-*`, removed in `finally`, and absence asserted. No credential values/hashes are printed. No servers or external API calls are used. Real host/live gates, checkpoint 2 harness readiness, other-OS protection, release and publication gates remain BLOCKED/unexecuted and unwaived as recorded in the independent evidence.

Regression setup evidence (2026-10-31): production prerequisite `a7d5fff860c5a7c6065c0d48d1382f1a99210076`, Windows Node 24.22.2. Syntax check exit 0. Targeted test exit 1 in 8.91 seconds: all four leaf cases fail for the previously reported exit mismatch (three aliases return 0 instead of 2; explicit port 80 returns 2 instead of 0). Node reports 5 failed tests including the aggregate parent, 0 passed/cancelled/skipped. This is behavioral RED, not a missing-executable or environment failure. Cleanup PASS: run directory absence assertion completed and `tests/.artifacts` had 0 entries. No other application checks rerun in this regression-authoring task.

### Correction attempt 1 — implementation record (2026-10-31)

Production change: `src/config/origin-url.js` now decides the approved topology from the operator's literal text instead of the already-normalized WHATWG URL, so IPv4 aliases cannot be expanded into a canonical loopback binding and an explicit default port is accepted and stored with its literal digits. Callers in `src/config/config.js` were unchanged; no dependency, toolchain, test, configuration-schema or protection change. Scope stayed within the bounded production file.

Affected run sequence on Windows Node 24.22.2, with `PROCEED_TEST_COMMAND` set to that executable plus `bin/proceed-mcp.js`:

| Step | Result |
|---|---|
| `node --check tests/cli-origin-url.test.mjs` | exit 0 |
| `node --test tests/cli-origin-url.test.mjs` | exit 0; 5 pass, 0 fail/cancelled/skipped (four regression cases plus parent); duration 6.95 s |
| `node --test tests/cli-setup.test.mjs` | exit 0; 1 pass, 0 fail/cancelled/skipped; duration 3.53 s |
| `node scripts/build.mjs` | exit 0; 11 production modules parse, bin target ready |
| `npm run format:check` with Node 24 first on `PATH` | exit 0; formatter reports all matched files conform |
| `git diff --check` before the evidence edits | exit 0 |

Cleanup PASS: each run-owned `tests/.artifacts/origin-url-*` and `setup-*` directory was removed in `finally` with absence asserted by the test, and `tests/.artifacts` held 0 entries afterwards. No credential value or hash was printed; no server, network request or external API call was used. This is the implementer's own affected-check result at revision `a9e74a9`, not independent verification: the FAIL verdict, first-use proof and every live/release gate remain unchanged and unwaived.

### Correction attempt 1 — independent disposition (2026-10-31)

Supersedes the pending/failed current disposition above for SETUP-URL-001 only: **CLOSED / affected checks PASS**, independently verified candidate `45bd060fec434194f78b703ffe43a07f44d55e26`, production `a9e74a9898c573a3303280cae18a6b745fc27fee`. Node 24.22.2 Windows: URL regression 5/5 Node-reported tests (four leaves plus parent), setup 1/1; syntax/build/formatter/diff checks exit 0; cleanup PASS. [Independent evidence, reuse scope and checkpoint 2 blockers](01-setup-evidence.md#correction-attempt-1--independent-affected-verification-2026-10-31).

The validator additionally rejects leading-zero port text. Diagnostics confirm `04096`/`00080` exit 2 without state change, but the existing contract does not explicitly settle this syntax policy. Next owner: Architect clarification through coordination before blanket syntax/slice acceptance; no new criteria or broad acceptance inferred. Checkpoint 2 remains not execution-ready for the documented harness, reviewed fault sequence, minimum implementation and secure live-environment prerequisites. No feature/e2e/release pass; worktree retained.
