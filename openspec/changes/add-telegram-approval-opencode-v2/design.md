# Design

Define a durable, local decision broker with authenticated, exact-session OpenCode V2 continuation.

## Context

Parent: [proposal](proposal.md). Product authority: [Telegram](specs/telegram-approval/spec.md), [continuation](specs/opencode-session-continuation/spec.md), and [distribution](specs/npm-distribution/spec.md). Evidence: [external research](research.md). The repository has no application implementation to preserve.

This is a design for implementation and validation, not a compatibility or release claim. The CLI-generated design instructions were supplied for this change. Product artifacts still identify themselves as drafts; their approval remains separate from this technical design.

Research is sufficient to define the boundaries below. Live authentication, timeout continuation, busy-session behavior, prompt deduplication, and first publication remain validation prerequisites. OpenCode's HTTP surface is experimental; its OpenAPI `info.version = 0.0.1` is not a supported-runtime version.

## Goals / Non-Goals

**Goals:** Separate human resolution, Telegram presentation, and session continuation; preserve each across broker restart; keep one delivery mechanism regardless of MCP-call lifetime; make every sensitive boundary independently testable.

**Non-Goals:** Execution enforcement, permission-rule modification, automatic approval of OpenCode permission prompts, remote broker hosting, automatic host discovery, and recovery of an exited OpenCode process. The service supplies cooperative decisions; OpenCode's permissions and the operator's execution policy remain the enforcement boundary.

## Decisions

### 1. One persistent broker, many short-lived MCP adapters

The package shall expose a `proceed-mcp` executable; this binary name does not reserve the npm package name. It shall contain three logical components:

| Component | Responsibility | Prohibited responsibility |
|---|---|---|
| Local broker | Durable state, pairing, Telegram polling, single-winner resolution, delivery outbox | Executing requested actions |
| Stdio MCP adapter | MCP handshake/catalog, trusted session metadata extraction, forwarding to its configured origin binding | Holding Telegram credentials, accepting human decisions, choosing another origin |
| OpenCode adapter | Authenticated origin validation, prompt admission/reconciliation, diagnostic classification | Starting a replacement host, discovering a different server, changing permissions |

The broker shall run as an explicit foreground process under the operator's terminal or supervisor. MCP startup shall not spawn another poller. Stdio adapter shutdown, MCP cancellation, and execution timeout shall not stop the broker or close a committed request. One broker shall own one dedicated Telegram bot token and one state directory. Sharing that token with another poller or webhook is unsupported and shall produce a setup diagnostic, not automatic webhook removal.

The proposed runtime floor is Node.js 24 LTS, with a portable npm artifact containing executable JavaScript and all runtime dependencies. No compiler, native add-on installation, database service, or postinstall script shall be required on the user's machine. This selects a deployment runtime, not an application source language or framework. Native and WASM database dependencies are unnecessary at this workload; the single-writer journal contract below supplies transactions. The implementation may choose its private module structure and protocol library, pinned in the lockfile.

**Alternatives rejected:** per-session Telegram pollers compete for offsets and cannot reliably outlive tool calls; notification-only delivery does not schedule a turn; a mandatory OpenCode plugin adds an unnecessary installation boundary before the HTTP path is proven.

### 2. Public CLI and secure configuration

All commands accept `--state-dir <directory>`; otherwise use `PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`. This documented product directory is independent of the working repository. No command shall silently read or modify OpenCode's private service registration files.

| Command | Contract |
|---|---|
| `proceed-mcp init` | Create empty versioned configuration, protected state directory, and local control credential; refuse to overwrite existing state. Print missing prerequisites, not a success claim for pairing/integration. |
| `proceed-mcp origin add <origin_id> --url <url> --password-env <name>` | Store an immutable origin binding and the environment variable name, never the password. Generate a separate MCP-origin credential file. Require the broker stopped; duplicate IDs are errors. |
| `proceed-mcp serve` | Open protected state, acquire exclusive ownership, recover journal, validate configuration, and run broker. Telegram token comes only from `PROCEED_TELEGRAM_BOT_TOKEN`; origin passwords come from their configured environment names. |
| `proceed-mcp pair` | Ask the running broker to issue a one-use pairing challenge. Print the code only to the invoking operator, never ordinary logs. Refuse when already paired. |
| `proceed-mcp mcp --origin <origin_id>` | Run stdio MCP for that operator-configured origin. Read only its local-origin credential; no interactive output or secrets on stdout. |
| `proceed-mcp doctor` | Check configuration, storage protection, broker reachability, Telegram `getMe`, pairing, origin auth/version, and source-contract compatibility. Report each separately; do not send decisions. |
| `proceed-mcp status [--request <request_id>]` | Show resolution, Telegram presentation, delivery stage, last redacted error, and next action. |
| `proceed-mcp retry <request_id>` | Resume a blocked delivery after the operator repairs its prerequisite; reuse the persisted prompt ID and payload. Never reopen the request or select a new origin. |

CLI exits: `0` completed command, `2` invalid arguments/configuration, `3` unavailable prerequisite or blocked integration, `4` storage/integrity failure. `serve` readiness does not imply first-use or release verification. Diagnostics go to stderr; `status` and `doctor` also support `--json` with versioned output `{schema_version:1, checks:[]}` for doctor and `{schema_version:1, requests:[]}` for status. Each check contains `name`, `state` (`ok|blocked|failed`), `code`, and redacted `message`.

Configuration schema version 1 shall contain `telegram.token_env` (fixed value `PROCEED_TELEGRAM_BOT_TOKEN`), `broker.port` (default 43189), and `origins[]` entries `{origin_id,url,password_env}`. Origin IDs match `[a-z0-9_-]{1,64}`. URLs shall have scheme `http`, literal host `127.0.0.1`, an explicit port, and no username, password, path other than `/`, query, or fragment. Remote addresses, DNS hostnames, URL redirects, proxy routing, and automatic URL substitution shall be rejected. A different URL requires a new origin ID; old requests retain their original binding.

The explicit port shall use canonical ASCII decimal notation: one to five digits, first digit `1`–`9`, numeric value `1`–`65535`. Leading zeros, signs, whitespace within the port, and other representations shall be rejected as invalid configuration (CLI exit `2`), without changing existing state. Thus `:4096` and `:80` are accepted; `:04096` and `:00080` are rejected, not rewritten. Persist the port digits exactly, including explicit `:80`; do not remove a default port. This is a canonical-input contract for the immutable binding: the accepted port text and numeric wire destination have one representation, without alias normalization. Leading zeros are not themselves evidence of a remote destination or an authentication weakness; their rejection does not reserve a port range or restrict which valid numeric port the operator may select.

Same-machine loopback is the transport topology of this first implementation, not a permanent product limitation or a requirement that the approving human be local. The broker and OpenCode host run on the same machine; the paired human supervises remotely through Telegram. This topology is not an unauthenticated HTTP exception and requires no public exposure of OpenCode. A future transport topology requires a separately reviewed design; this clarification neither enables remote origins nor weakens authentication.

Every OpenCode request shall carry Basic authentication with username `opencode` and a nonempty configured password. Missing/invalid authorization blocks the origin; there is no unauthenticated fallback. The broker shall never expose these credentials to Telegram or the model. Setup documentation shall explain operator-controlled OpenCode password configuration and loopback listening, without embedding a real password or asking users to expose the server publicly.

The broker listener shall bind only `127.0.0.1`, require a 256-bit random Bearer credential on every route, reject browser `Origin` headers, provide no CORS allowance, and accept only JSON bodies up to 64 KiB. Separate control and per-origin credentials shall authorize control routes versus MCP routes. A per-origin credential shall not access another origin or pairing/retry controls. Credentials shall be generated into protected local files, not command arguments, committed configuration, journal records, or package files. Authentication failures return `401` with no request details.

The state directory and credential files shall be accessible only to the current OS account: owner-only permissions on POSIX and an owner-restricted ACL on Windows. Windows shall not be treated as protected merely because a POSIX mode was requested. If protection cannot be established or verified, setup/start shall fail with an actionable diagnostic. The local account and its OpenCode configuration are trusted; this product does not sandbox a malicious process running as that same account. Pairing and reply text are sensitive local data even though they are not credentials.

**Alternatives rejected:** generated-password discovery is not documented for every host topology; a default shared-service lookup could silently target the wrong host; accepting unauthenticated loopback requests would weaken the approved security posture.

### 3. MCP and local cross-component contracts

The MCP adapter shall implement the classic initialize handshake with support for protocol revision `2025-11-25`, advertise tools, and expose only the following model-visible tools. Inputs are objects with no additional properties. All identifiers are case-sensitive strings; times are UTC RFC 3339 strings.

| Tool | Arguments | Effect |
|---|---|---|
| `request_approval` | Required `client_request_id` (1–128 ASCII letters/digits/`_-`), `action` (1–1000 Unicode scalar values), `context` (0–1000); optional `expires_in_seconds` integer 60–86400, default 3600 | Durably create one pending request, or return its existing identity for an identical retry. Return promptly; do not wait for the human. |
| `get_approval` | Required `request_id` | Read the requesting session's own request, applying expiry first. No delivery side effect. |
| `cancel_approval` | Required `request_id` | Resolve the requesting session's pending request as cancelled; return an existing terminal outcome unchanged if already resolved. |

The adapter shall take `session_id` solely from `CallToolRequest.params._meta["ai.opencode/sessionID"]`, never from tool arguments. Missing metadata yields `MISSING_SESSION_CONTEXT`. The broker shall validate that session through the bound authenticated origin before creation. Operator wiring binds the MCP adapter to its host; metadata alone is not authentication. A model cannot nominate a URL, origin, session, paired user, or decision through tool arguments.

The idempotency key is `(origin_id, session_id, client_request_id)`. Reuse with a different action, context, or effective expiry duration yields `IDEMPOTENCY_CONFLICT`; retry does not extend the original deadline. Request creation shall allocate `request_id = req_` plus 32 lowercase random hexadecimal characters. Length checks include the complete Telegram rendering; an over-limit request fails before persistence rather than silently omitting action/context.

Tool success shall contain matching JSON in `structuredContent` and a text content block, with `isError:false`. The common request representation is:

| Field | Type / meaning |
|---|---|
| `schema_version`, `request_id`, `client_request_id` | `1`, stable IDs |
| `origin_id`, `session_id`, `session_label` | Origin binding, exact session, display label from authenticated session title or session ID |
| `action`, `context`, `created_at`, `expires_at` | Immutable request and deadline |
| `resolution` | `pending|approved|rejected|responded|expired|cancelled` |
| `resolved_at`, `response_text` | Nullable; text non-null only for `responded` |
| `telegram_state` | `pending|sent|failed` |
| `delivery_state` | `not_applicable|pending|admitted|delivered|blocked` |
| `delivery_error` | Null or `{code,message,retryable}`; redacted |

Creation returns this receipt, not an authorization boolean. All human decisions shall travel through the single OpenCode prompt-delivery path below, even if a tool call is still active. A status query is an observation, not another continuation. This avoids racing a late MCP result against a separate injected decision. MCP instructions shall say: do not perform the requested action while pending; wait for the identified decision input; rejection forbids the requested action; responses are instructions requiring a new request for any action still needing approval. No `notifications/message` or resource update shall be described as session delivery.

Tool execution errors shall use `isError:true` and structured/text `{schema_version:1,error:{code,message,retryable}}`. Codes: `INVALID_ARGUMENT`, `MISSING_SESSION_CONTEXT`, `NOT_PAIRED`, `ORIGIN_UNAVAILABLE`, `AUTH_REQUIRED`, `UNSUPPORTED_HOST`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`, `STORAGE_FAILURE`. Cross-session IDs yield `NOT_FOUND`, not existence disclosure. Unknown tools and malformed MCP messages use JSON-RPC protocol errors; a transport timeout shall not be translated to a rejection or cancellation.

The broker's authenticated HTTP API is product-defined, not an invented OpenCode API:

| Route | Credential / body | Success |
|---|---|---|
| `POST /v1/requests` | Origin credential; `{session_id,client_request_id,action,context,expires_in_seconds}` | `201` new / `200` identical replay, request representation |
| `GET /v1/requests/{request_id}?session_id=<encoded-id>` | Origin credential | `200` owned request |
| `POST /v1/requests/{request_id}/cancel` | Origin credential; `{session_id}` | `200` request after single-winner resolution |
| `POST /v1/pairing` | Control credential; `{}` | `201` `{code,expires_at}` |
| `GET /v1/status` | Control credential | `200` status JSON |
| `POST /v1/requests/{request_id}/retry` | Control credential; `{}` | `202` request with delivery scheduled, or `200` already delivered/not applicable |

HTTP errors use the tool error envelope: `400` invalid arguments, `401` authentication, `404` unowned/unknown request, `409` idempotency conflict/already paired, `503` missing pairing/unavailable origin/unsupported host, `500` storage failure. No HTTP endpoint shall approve, reject, or supply response text. The control credential authorizes setup/retry, not a substitute human decision API.

### 4. Durable data and single-winner transactions

The broker is the sole writer. It shall acquire exclusive state-directory ownership before replay or polling and bind the configured port before becoming ready. A second broker shall fail, not share the journal or choose another port. A stale ownership record shall require explicit operator recovery after verifying its owner has stopped; PID reuse shall not justify automatic lock stealing.

Persistence shall be a versioned, checksummed append-only transaction journal on a local filesystem. Each committed transaction contains a monotonic sequence, its complete mutations, byte length, and integrity checksum. Completion requires a full record and successful file flush before any corresponding acknowledgement or external effect. No in-memory-only approval or offset advancement is permitted. On restart, replay committed records; discard only an incomplete final record, and stop on a checksum failure, sequence gap, unsupported version, or corruption before the tail. Never silently reset to empty state. Journal creation and recovery shall establish the required filesystem durability before reporting readiness; interruption and disk-full behavior require OS-specific tests. Compaction and automatic history deletion are deferred; operators back up the stopped broker's entire state directory.

Logical entities and invariants:

| Entity | Required durable fields / uniqueness |
|---|---|
| Pairing | One `{user_id,chat_id,paired_at}`; Telegram numeric IDs stored losslessly as decimal strings; consumed challenge hash and expiry, never a reusable plaintext challenge |
| Request | Common representation above; immutable origin URL binding, session identity, effective duration, unique idempotency key, pairing identity snapshot |
| Resolution | At most one per request: type, accepted time, deciding user/chat, source Telegram update ID, exact response text if any |
| Telegram presentation | Request message IDs and reply-prompt IDs scoped by chat; callback tokens; durable `response_opened` flag; pending send/edit/acknowledgement work |
| Delivery outbox | One per human resolution: stable `prompt_id`, exact serialized prompt text, state, attempts, next-attempt time, redacted error, admission/confirmation times |
| Poll cursor | Last fully processed `update_id`; advance only in the same transaction as the update's durable consequences |
| Origin evidence | Configured origin binding, observed server version/PID, original session ID and creation time; no stored auth headers/passwords |

For each pending resolution attempt, the serialized transaction shall sample broker time and first test `now >= expires_at`. If true, commit `expired`; otherwise the first valid approve/reject/response/cancel wins. `Respond` button selection is not a resolution. Successful approval/rejection/response commits the resolution and outbox payload together. After commit, expiry/cancel/replayed/conflicting updates cannot replace it. Accepted outcomes remain deliverable after expiry. Expiry and cancellation create no approval and no human-decision outbox entry.

An update replay at or below the committed cursor has no new decision effects; callback acknowledgement may be repeated. Each update shall still be validated against pairing and request state. Process updates in increasing ID order; do not require contiguous IDs. Advance the next `getUpdates` offset to the committed ID plus one, never to the end of an uncommitted batch. Sweep pending deadlines at least once per second while healthy, and expire requests against current time before applying backlog after restart. Their maximum 24-hour lifetime matches Telegram's update-retention ceiling without pretending that offline updates are guaranteed.

**Alternatives rejected:** independent JSON overwrites lose atomic resolution/outbox/cursor ordering; a separate database daemon or native SQLite add-on complicates clean cross-platform installation. The journal is deliberately single-writer and small-scale, not a general database abstraction.

### 5. Telegram pairing and reply correlation

Use the Bot API 10.3 cloud endpoint `https://api.telegram.org/bot<token>/<method>` over HTTPS with JSON requests. Only this fixed platform endpoint receives the Telegram credential. Redact complete Telegram URLs, authorization headers, response text, and action/context from routine logs.

Pairing shall require the operator to run `pair`, which creates a cryptographically random 128-bit code, valid for five minutes and consumed once. The human must first open the bot and send `/start`, then `/pair <code>` in a private chat. `/start` alone grants nothing. Accept pairing only when `message.from.id` is present, `chat.type` is `private`, the challenge is valid/unconsumed, and no pairing exists. Persist both sender and chat IDs. Limit failed code attempts to five per sender per minute; do not disclose challenge or request details. Re-pairing is not an automatic incoming-message operation; loss/change of the paired human requires a separately authorized local administrative procedure, not a fallback identity.

The dedicated poller shall call `getUpdates` with `timeout:30`, `limit:100`, and `allowed_updates:["message","callback_query"]`; HTTP timeout shall exceed polling timeout (40 seconds). Unsupported stale update types are harmlessly consumed. Check Telegram's `ok` envelope, not HTTP status alone. Obey `parameters.retry_after` for rate limits; otherwise retry transient failures with bounded backoff of 1, 2, 4, 8, 16, then 30 seconds. Poller conflict/webhook diagnostics shall stop competing polling and require operator repair. `getMe` checks token identity; `sendMessage` returns the message ID used for durable presentation mapping.

Request messages shall use plain text (no `parse_mode`) and show the full request ID, origin/session label and ID, action, context, UTC expiry, resolution, and separate delivery status. Render at most 4096 characters; inputs that cannot fit shall be rejected before creating a request. Use `InlineKeyboardMarkup` with Approve, Reject, Respond buttons. Callback data shall be `a:<token>`, `r:<token>`, or `t:<token>`, where the token is 32 random hexadecimal characters mapped durably to one request; this is below Telegram's 64-byte limit. Tokens are correlation, not authority.

For every callback, check `callback_query.from.id` against the paired user and its message's private `chat.id` against the paired chat. Also check the stored callback token and originating message ID. Missing/inaccessible message context shall fail closed; `chat_instance` and forwarded request text are not authentication. Call `answerCallbackQuery` for accepted, duplicate, stale, expired, unauthorized, and malformed callbacks when a callback ID exists. Acknowledgement failure never undoes a committed decision; retry best-effort. Unauthorized acknowledgements disclose no request details.

Respond shall durably set `response_opened` before sending a separate plain-text prompt containing the full request ID and `ForceReply {force_reply:true}`. Persist the returned `(chat_id,message_id) -> request_id` mapping. Repeated Respond selections may produce multiple prompts mapped to the same unresolved request; they do not grant authority or resolve it. Accept nonempty `Message.text` up to 4096 Unicode scalar values only from the paired sender/private chat, correlated by a stored `reply_to_message.message_id`. Preserve accepted text exactly, including whitespace and approval-like words. Edited messages, attachments, and uncorrelated ordinary text shall not resolve requests.

If reply context is unavailable, support the explicit command `/respond <request_id> <text>` from the same paired identity, where `<text>` is the exact substring following the single separator after the ID. Require that a Respond interaction has already been opened for this pending request. Conflicting reply mapping and explicit ID shall be rejected. Bare `yes`, a quoted request ID, or multiple possible matches shall never select a pending request. Ask the paired human to use the identified prompt or explicit command without revealing other requests to unauthorized senders.

Commit a valid resolution before confirming it to Telegram; the confirmation shall distinguish “decision recorded” from “session delivery pending.” Retire controls with `editMessageReplyMarkup` and update status with `editMessageText`. Telegram send/edit calls have no documented idempotency key: a crash after send but before recording its ID may duplicate a presentation. All copies retain the same request identity and callback mapping, and can yield only one resolution. An unmapped reply prompt shall not accept text; the paired human can use the explicit response command. Unknown callback message IDs shall not be treated as authority merely to accommodate this crash window.

### 6. Exact-origin OpenCode V2 admission and delivery

Source contracts: [V2 MCP context](https://opencode.ai/v2/docs/mcp-servers/), [Basic auth](https://opencode.ai/v2/docs/cli/web/), [prompt admission/idempotency](https://opencode.ai/v2/docs/build/plugins/server/), and [OpenAPI](https://opencode.ai/v2/openapi.json), retrieved 2026-10-31. The live OpenAPI was additionally checked for the response envelopes below. In particular, inbox listing returns **`{data:[...]}`**, not a bare array. This corrects the shorthand in research section 2.4 without changing that research file.

Every path below is joined to the immutable configured base origin, with identifiers percent-encoded as single path segments. Redirects are disabled. All calls use the configured Basic auth; OpenAPI's empty `security` arrays do not override the documented authentication requirement.

| Method/path | Request | Expected successful response / use |
|---|---|---|
| `GET /api/info` | None | `200` unwrapped `ServerInfo`, including `version`, `pid`, `urls`, `paths`; version/PID checks, never auto-follow advertised URLs |
| `GET /api/session/{sessionID}` | None | `200 {data:Session.Info}`; require matching `id`; capture `time.created` and display title |
| `POST /api/session/{sessionID}/prompt` | `{id:prompt_id,text:prompt_text,delivery:"steer",resume:true}` | `200 {data:Session.Inbox.User}`; verify returned `id`, `sessionID`, `type:"user"`, and delivery mode |
| `GET /api/session/{sessionID}/inbox` | None | `200 {data:Session.Inbox.Info[]}`; matching prompt ID means still pending delivery |
| `GET /api/session/{sessionID}/message/{messageID}` | None | `200 {data:Session.Message.Info}`; matching user message proves projected-history presence |
| `GET /api/session/{sessionID}/message?type=assistant&order=desc&limit=100` | None | `200 {data:[...],cursor:{previous?,next?}}`; useful-continuation evidence during live verification; follow cursors with the same type and without `order` |

Only versions explicitly validated by the boundary spike shall be admitted by the release's version allowlist. `@opencode/client` 2.2.5 research is not proof that the running host is version 2.2.5. Capture the actual version and a fixture/hash of the tested OpenAPI during verification. Unknown versions shall report `UNSUPPORTED_HOST`, not silently use V1 or claim broad semver support.

Creation shall capture the observed version/PID and session creation time. Delivery shall recheck them at the same origin; mismatching PID or session identity blocks with `ORIGIN_CHANGED`. An unavailable session shall never be replaced with the foreground session. PID/version checks are continuity diagnostics, not cryptographic process-incarnation proof; PID reuse and a host restarting while the broker is offline are outside the supported running-host promise. Do not implement automatic exited-host recovery or claim these checks solve it. Tests shall cover two live origins, including deliberately colliding session IDs in fixtures, and wrong-origin configuration.

At resolution commit, allocate `prompt_id = msg_` plus the request's 32 hex characters, and persist the exact prompt text. The text shall contain a plain-language outcome heading and a JSON data record with `schema_version`, `request_id`, `origin_id`, `session_id`, `action`, `context`, `resolution`, `response_text`, and `resolved_at`. JSON encoding preserves arbitrary response text without confusing it with an outcome field. The heading shall explicitly say whether this is approval for the identified action, rejection, or instructions only. Reject/Respond shall explicitly state that they grant no approval. Do not rely on model visibility of OpenCode `metadata`.

The delivery worker shall use that same ID and identical text for every retry, including after broker restart. There shall be no second prompt ID, synthetic-message fallback, interrupt, session fork, or permission reply. Serialize attempts per request. The documented idempotency contract returns the original admission for an already pending/delivered ID; this is the foundation for retry safety, not a claim of exactly-once arbitrary prompt-hook side effects.

Delivery state is orthogonal to resolution:

| State | Meaning / transition |
|---|---|
| `not_applicable` | Pending or non-human closure; no decision outbox |
| `pending` | Human resolution committed; admission unconfirmed, including lost POST response |
| `admitted` | Validated `200` admission or matching inbox item; continuation still unconfirmed |
| `delivered` | Matching exact user message exists in session history and the ID is absent from a successful inbox read |
| `blocked` | Non-retryable prerequisite, exhausted transient retry period, or incompatible/mismatched response; accepted resolution retained |

Before retrying an uncertain POST, reconcile history and inbox for the stable ID. If present in history, never create another input; require its `type` to be `user` and its text to equal the persisted prompt text before confirming delivery. A mismatched payload blocks as `PAYLOAD_MISMATCH`, rather than replacing or duplicating it. If still in inbox, poll rather than re-admit. Absence from both is not proof of non-admission, but retry with the identical ID is allowed only on a spike-verified host. Successful admission alone, an empty inbox alone, Telegram acknowledgement, or global active-session status shall never be called confirmed continuation.

Use 10-second OpenCode HTTP timeouts and poll admitted inputs every two seconds. Network errors, `5xx`, and `409 ConflictError` shall remain pending and reconcile/retry with 1, 2, 4, 8, 16, then 30-second backoff. Do not infer that `409` means busy; that condition is undocumented. After 15 minutes without progress, show `blocked` with actionable retry instructions, preserving the outbox. `401` blocks as `AUTH_REQUIRED`; `404` distinguishes the returned `SessionNotFoundError`/`LocationNotFoundError` tag for operator repair; `400`, schema mismatch, changed identity, or unexpected admission ID blocks without fallback. An explicit retry resumes reconciliation, not a new decision or changed payload.

`delivered` means delivery into the exact session's projected input history, not proof that the requested action ran. UI wording shall be “delivered to session,” never “action completed.” Useful agent continuation is an independent acceptance check: live verification must observe a subsequent assistant turn acknowledging the request ID and correct outcome, for Approve, Reject, and Respond, including after timeout. The MCP instructions shall request that acknowledgement. If the tested host can populate history without allowing such continuation, it is not supported for this release even though the API admission succeeded. Prompt hooks that rewrite human intent or force steering into an indefinitely parked queue are incompatible; do not bypass them or claim unchanged intent when verification fails.

### 7. Sensitive-boundary verification gates

Tests shall exercise the real component boundaries; production shall not depend on test-only schemas or expose reset/decision endpoints for tests. The state machine shall accept a controllable clock, durable store, and external-adapter seams for deterministic verification, while end-to-end fixtures shall drive the public CLI/MCP/HTTP/Telegram boundaries out of process.

| Gate | Required proof | What a mock cannot prove |
|---|---|---|
| Transaction safety | Concurrent decision/cancel/expiry, duplicate updates, crash before/after every commit/send/offset/admission boundary, disk-full/corrupt-tail recovery, unchanged response text | Actual OS file protection and flush/restart behavior |
| Telegram authorization | Unpaired/group/forwarded callbacks, inaccessible message, prompt correlation, ambiguous text, duplicate/conflicting choices; dedicated real bot/private chat first pairing | Telegram client ForceReply behavior, token/auth setup, actual forwarded-message behavior |
| Local isolation | Invalid/missing credentials, forbidden browser origins, cross-origin and cross-session access, secret-redacted diagnostics, two-broker exclusion | Windows ACL readiness on an untested OS |
| OpenCode spike, before broader integration | Authenticated exact-origin request; same host with two sessions; decision while tool active and after forced timeout; active/busy and idle cases; lost admission response; same ID retry after broker restart and after delivery; each outcome produces correct useful continuation once | Actual `409` behavior, scheduling after timeout, deduplication lifetime, model-visible unchanged intent |
| Package first use | Clean packed installation on Windows/macOS/Linux, no checkout/build tools, empty-state setup through paired decision and session delivery | Public registry availability or ownership |
| Release | Version/tag match, sanitized tarball, publish result, clean exact-version install from registry | Local pack success is not public delivery |

The OpenCode spike is the smallest vertical proof: one broker, one dedicated bot, one explicit authenticated loopback host, and two sessions. Record exact host version, direct-tool and Code Mode configuration, execution timeout override, requests/IDs, admission/inbox/history evidence, subsequent assistant acknowledgement, and absence of a duplicate decision-driven turn on retry. Deliberately time out the original MCP call after durable creation; keep its host running. An immediate asynchronous receipt is not a substitute for this timeout test. Run the same payload retry after the original admission has left the inbox. No tokens, passwords, raw private prompts, or unredacted response text belong in published evidence.

Unverified shapes/semantics remain marked **[UNVERIFIED — requires source check or live spike]**: busy `409` conditions; prompt-ID deduplication persistence and hook interactions; Code Mode internal cancellation behavior; exact scheduling after MCP timeout; correspondence of projected history to useful agent continuation; long-idle location readiness. A failed spike returns an architecture/product gap before broader slices; it does not authorize polling notifications as a substitute or relaxing exact-session requirements.

### 8. Package and release architecture

The package shall whitelist its published files: executable runtime files, required runtime dependencies/metadata, README/setup instructions, and the owner-selected license. Exclude state, credential files, repository-only build inputs, test fixtures containing private data, and handoff/tool-output directories. Package metadata shall declare the approved name, version, `bin` mapping, proposed Node floor, and exact repository URL `https://github.com/renl/proceed-mcp`. Identity and license remain placeholders in planning, not invented package claims.

PR CI shall use the pull-request event, build/test the proposed package, inspect the packed file list, and install/start the tarball in a clean environment. Use a Windows/macOS/Linux matrix on Node 24 for portable first use. No publishing job, registry credentials, or `id-token:write` permission shall be reachable from PR execution; do not execute contributor code in a privileged `pull_request_target` workflow.

An authorized protected tag `v<package-version>` shall trigger a separate release workflow, `.github/workflows/release.yml`. Require exact version equality, a commit reachable from the approved `main` history, passing build/tests/packaged-install checks, and deployment-environment approval before publication. The release shall use a clean GitHub-hosted Node 24 runner with npm at least 11.5.1, explicitly checked rather than assumed from Node's version. Pin action revisions and dependencies; disable release-build caching. Only the publishing job shall receive `id-token:write` and `contents:read`.

Prefer npm OIDC trusted publishing bound to repository `renl/proceed-mcp`, workflow filename `release.yml`, and the selected protected environment. Operations must enable the connection's direct `npm publish` permission; the research notes new configurations may default to stage-only. Publish public access with the approved package identity. Do not add dist-tag manipulation, which has additional CLI/permission prerequisites, or fall back silently to a long-lived token. Automatic OIDC provenance depends on public repository/package conditions; verify the actual result rather than declaring it from configuration alone.

First publication is a distinct operational gate. **[UNVERIFIED — requires registry source check and owner authorization]**: how the approved, previously unpublished identity is bootstrapped before a trusted publisher can be configured. This design does not authorize creating a package, using a token, or choosing an initial publication method. Ownership, license, bootstrap, publisher connection, and any required two-day initial validation window must be resolved before release. Code and non-publishing CI can proceed without registry access.

After publication, install the exact reported version from public npm in a clean supported environment and run startup/diagnostics through documented prerequisites. Record published identity/version, registry result, and clean-install result separately from live first-decision proof. A successful archive, tarball test, or publication log is not release verification.

## Risks / Trade-offs

- [Experimental OpenCode API and unpinned documentation] → Gate support on recorded runtime versions and captured source shapes; stop on incompatible responses. Research supports construction, not compatibility certification.
- [HTTP history can precede useful model activity] → Distinct admitted/delivered wording and real subsequent-turn proof; no claim that delivery enforces or completes an action.
- [Host restart cannot be fully identified by URL/PID] → Limit the promise to the same running host, reject detected changes, and never redirect or implement replacement-host recovery.
- [Journal growth and single writer] → Accept modest local supervision throughput; retain history and document stopped-process backups. No multi-machine database semantics or unattended journal repair.
- [Telegram send ambiguity] → Allow duplicate presentations of one identity but never duplicate resolution; fail closed on missing correlation.
- [One paired human, lost credentials, ACL failure, or bot conflicts] → Report actionable blocked setup; no automatic new authority or weakened file protections.
- [Typed instructions or malicious model behavior] → Preserve the outcome type and keep permission enforcement in OpenCode/operator policy; do not promise that cooperative text is a security sandbox.
- [Registry ownership/bootstrap unavailable] → Keep implementation and tarball validation separate from blocked public-release acceptance; no waiver or successful release claim.

## Migration Plan

1. Establish the isolated executable/state boundaries and run the OpenCode/Telegram spike before broad integration. Return any failure that undermines the required continuation rather than revising product scope silently.
2. Implement against the approved state and interface contracts; independently verify sensitive boundaries and empty-state packaged first use. Only spike-proven OpenCode versions enter the supported allowlist.
3. Resolve package identity/license and publisher/bootstrap decisions through the owner and operations. Release only after the real external prerequisites are available and recorded.
4. For version 1, initialize an empty journal; there is no legacy data migration. Later schema changes require explicit versioned migration and backup, not reinterpretation of old transactions.
5. Rollback stops the broker first and retains its state. An older runtime shall refuse a newer journal schema. Restore only a stopped, known-consistent backup under operator control; never erase decisions to make a downgrade start. Already admitted OpenCode inputs and published npm versions are external effects and cannot be undone by rolling back local files.

## Open Questions

Release-only decisions remain with the owner: exact npm identity and rights, selected license, and authorized first-publication/bootstrap and protected publishing environment. They do not change the broker's chosen approach. Actual supported OpenCode versions are an evidence gate, not a guessed compatibility floor. None of these items is recorded as passed or waived.
