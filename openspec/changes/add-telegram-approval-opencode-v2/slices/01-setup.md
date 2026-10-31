# 01 — Empty-state setup and risk-first proof chain

Parent/index: [tasks](../tasks.md). Authority: [design](../design.md) sections 1–3, 6–7; [research](../research.md), retrieved 2026-10-31. Status: review required, not implementation-ready.

## Goal and scope

Enable the operator's first useful setup action from empty state. This checkpoint makes later decision proof possible; it does not itself deliver a decision. Baseline `main` @ `f385409792aff3d46d96b5c4f03358f10c8dc5ba`; prerequisite none. Worktree `.worktree/add-telegram-approval-opencode-v2`, branch `add-telegram-approval-opencode-v2`. All subsequent checkpoints share that branch and require the preceding implementation/evidence commit present, not just a branch name.

Likely implementation files: root production manifest/lockfile, executable/build source chosen by implementation, README setup instructions. Test files: `tests/cli-setup.test.mjs`; later harness/tests remain under `tests/`. Owned task detail is this slice and `tasks.md`. Preserve generated `.opencode/`, other owners' normative content, and dirty root bootstrap. Production MUST NOT depend on tests. No package name/license invention, publication, global config changes, discovery of private host registrations, or test-only application decision endpoints.

First runnable acceptance maps `npm-distribution` / “Complete first useful action from empty state” / “Incomplete configuration” and `telegram-approval` / “Explicit first-use pairing” to design section 2. Tests cover only the enabling subset: init refuses overwrite; valid immutable origin can be added once; invalid origin IDs/topologies are rejected. Full pairing and first decision remain required in checkpoint 2/5.

## Run sequence

Target shell: PowerShell on Windows; test code is portable Node and must later run on Node 24 for supported OS proof. No dependencies or installation needed for test authoring checks.

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

## Decomposition fidelity review request

Checklist answers: (1) YES journal/origin/outbox feeds delivery proof; (2) YES restart/offset/crash can contaminate state; (3) YES observation must precede timeout/resolution; (4) YES MCP→Telegram→outbox→host is order-sensitive; (5) YES setup and real proof span checkpoints. Architect review is required before readiness, including planned test transport fault. Tests do not define private module interfaces. Checkpoints 3–4 cannot begin broad implementation before checkpoint 2's real gate passes. If live environment remains unavailable, retain blocked gates and only separately authorized isolated work; do not call the broad plan ready.
