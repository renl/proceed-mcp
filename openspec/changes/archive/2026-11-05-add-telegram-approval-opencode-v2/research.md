# External Interface Research: OpenCode V2, Telegram Bot API, npm

Status: Research complete for the confirmed items below; live-behavior items remain unverified. Parent: [proposal](proposal.md). Read next: `design.md` and `tasks.md` once written.

Retrieved: 2026-10-31. Every claim below is either **Confirmed** (stated in an official source, quoted or paraphrased with URL) or **Undocumented** (not stated in any source read; must be resolved by a live test or an owner decision). Nothing here is an invented contract.

## 1. Version pins

| Platform | Pinned evidence | Notes |
|---|---|---|
| OpenCode V2 docs | `https://opencode.ai/v2/docs/` and linked pages, read 2026-10-31 | Docs are unversioned; the site is the only V2 source of truth. V1 docs at `/docs` were not used. |
| OpenCode HTTP API | `https://opencode.ai/v2/openapi.json`, `openapi: 3.1.0`, `info.version: "0.0.1"`, 138 paths, 363 schemas, 169 operations | `info.version` is a placeholder, not a release pin. The document describes itself as an "Experimental HttpApi surface". |
| OpenCode client | `@opencode/client` npm dist-tag `latest` = **2.2.5**; registry metadata `time.modified` = 2026-10-31T07:32:28Z | Generated from the same contract as the API reference. |
| MCP protocol | OpenCode defaults to classic `initialize`, "speaks protocol revisions up to **2025-11-25**"; opt-in `2026-07-28` revision | MCP `_meta` key rules verified in the 2025-11-25 spec. |
| Telegram Bot API | **10.3**, "Recent changes" dated **August 24, 2026** (`https://core.telegram.org/bots/api`) | Applies to the cloud Bot API at `https://api.telegram.org`. |
| npm trusted publishing | npm CLI **≥ 11.5.1** and Node **≥ 22.14.0**; page last edited 2026-10-06 | dist-tag over OIDC needs npm ≥ 11.21.0 (or ≥ 12.2.0). |

Runtime version detection is available: `GET /api/info` returns `ServerInfo.version`, so a tested-version floor can be enforced against the running host rather than assumed from docs.

## 2. OpenCode V2: session identity and continuation

### 2.1 How an MCP server learns which session called it — Confirmed

OpenCode attaches the invoking session ID as request metadata on `tools/call`, for **direct tools and Code Mode, over stdio and Streamable HTTP**:

```json
{ "method": "tools/call",
  "params": { "name": "lookup", "arguments": {}, "_meta": { "ai.opencode/sessionID": "ses_..." } } }
```

Source: `https://opencode.ai/v2/docs/mcp-servers/` (section "Context"). Documented properties:

| Rule | Documented behavior |
|---|---|
| Identity | Identifies the invoking OpenCode session, not the MCP transport session. |
| Presence | "It can be absent for calls without session context." |
| Security | "Do not use it by itself for authentication or authorization." |
| Privacy | Remote servers receive the raw ID and may log or retain it. |

MCP `_meta` key format is valid: an optional dot-separated prefix plus `/`, with name characters `[A-Za-z0-9._-]`; only prefixes whose second label is `modelcontextprotocol` or `mcp` are reserved (`https://modelcontextprotocol.io/specification/2025-11-25/basic`, section "General fields → `_meta`"). This gives the product an opaque correlation key per request, but it is a correlation value only — the paired-human check is separate.

### 2.2 Server discovery and authentication — Confirmed

Two documented paths exist.

**Path A — operator-configured URL plus Basic auth.** "Other HTTP clients use Basic auth. The username is always `opencode`, and only the password can be changed."

```bash
curl -u opencode:a-long-secret http://127.0.0.1:4096/api/info
```

Password sources: `OPENCODE_PASSWORD` (fixed), `opencode service set password`, the generated password printed by `opencode serve`, or a session token redeemed from a pairing code. Default ports: macOS/Linux/WSL `49374`, Windows `28894`; `opencode serve` accepts `--hostname/--port`. Source: `https://opencode.ai/v2/docs/cli/web/` (sections "Access", "Standalone → Authentication").

**Path B — client service discovery.** `@opencode/client/service` exposes `Service.discover()` (healthy registered endpoint, no process start), `Service.ensure({file?, version?, command?, onStart?})`, `Service.stop()`, and `Service.headers(endpoint)` which "creates the authentication headers for a client". Default registration path and default command `opencode serve --service`. Source: `https://opencode.ai/v2/docs/build/client/` (section "Local background service"). Documented registration file: `~/.local/state/opencode/service.json`; private service config `~/.config/opencode/service.json` (`https://opencode.ai/v2/docs/troubleshooting/`).

**Pairing-code flow — Confirmed.** `POST /api/pair` → `PairingCode { code: string, expires_in: integer }`; `GET /auth/connect/{code}` → `PairingSession { token: string }` for JSON-accepting requests; "requests that accept JSON receive a session token to use as the password." Links work once and expire in 5 minutes; sessions last 30 days; changing the password signs sessions out.

**Schema caveat — Confirmed.** The OpenAPI document declares **no** `securitySchemes` and `security: []` on operations. Authentication is therefore not derivable from the schema; the Basic-auth requirement comes from the docs and must be implemented on purpose.

**Undocumented:** whether a local (stdio) MCP server process receives its host's server URL and password. The docs state only that a local server's `environment` is added to "OpenCode's inherited process environment", so an operator-set `OPENCODE_PASSWORD` would be inherited, while a generated password or a second `opencode serve` instance would not be discoverable this way. Discovery is documented only for the shared background service; the docs do not state whether a foreground `opencode serve` or `--standalone` instance registers a discoverable endpoint. **Multi-host correlation is the main architectural open question** (see §5).

### 2.3 Prompt delivery, idempotency, and queue semantics

**Admission — Confirmed.** `POST /api/session/{sessionID}/prompt`, operation `session.prompt`, described as: "Durably admit one session input and schedule agent-loop execution unless resume is false."

```jsonc
POST /api/session/{sessionID}/prompt
{
  "id": "msg_...",             // optional, pattern ^msg_
  "text": "string",             // required
  "files": [], "agents": [], "skills": [],
  "metadata": {},               // free-form object
  "delivery": "steer",          // or "queue"
  "resume": true
}
```

`200` → `{ "data": Session.Inbox.User }` where `Session.Inbox.User = { id, sessionID, time: { created }, type: "user", payload: { text, files?, agents?, skills?, metadata? }, delivery }`.
`409` → `ConflictError { _tag: "ConflictError", message, resource? }`; `404` → `SessionNotFoundError | LocationNotFoundError`; `401` → `UnauthorizedError { _tag, message }`.

**Idempotency — Confirmed, from the prompt-admission hook contract** (`https://opencode.ai/v2/docs/build/plugins/server/`, section "Sessions → Prompt admission"):

- "Retrying an ID already pending or delivered returns the original admission without rerunning hooks."
- "Concurrent submissions can run hooks more than once, but only the first successful admission wins."
- "Session and message IDs are readonly; a hook cannot redirect admission."
- Default `delivery` is `"steer"`, changeable to `"queue"`.

This is the strongest documented basis for exactly-once decision delivery: the product supplies its own `msg_`-prefixed ID derived from the request, and a retry after a crash or timeout returns the same admission instead of a second turn.

**Steering vs queue — Confirmed.** `Session.Inbox.Delivery = "steer" | "queue"`. `PATCH /api/session/{sessionID}/inbox/{inboxID}` with `{ "delivery": "steer" | "queue" }` — "Change a pending inbox item's delivery mode. Steering wakes session execution." `POST /api/session/{sessionID}/interrupt?resume=true` — "execution resumes pending steering input and next-in-line control items (manual compaction, moves) while queued prompts remain parked."

**Undocumented:** exactly which state yields the `409 ConflictError` on `prompt`. No source read states whether a busy session rejects, queues, or steers an incoming prompt.

### 2.4 Observing delivery and busy state

| Need | Endpoint | Documented meaning |
|---|---|---|
| Is this session running? | `GET /api/session/active` → `{ "data": { "ses_...": { "type": "running" } } }` | "Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive." |
| Is my input still undelivered? | `GET /api/session/{sessionID}/inbox` → `Session.Inbox.Info[]` | "List durable enqueued session work **not yet delivered**, ordered by enqueue sequence." Absence of the message ID means it left the queue. |
| Did the message land in history? | `GET /api/session/{sessionID}/message?type=user&limit=&order=asc\|desc` → `{ data: Session.Message.Info[], cursor: { previous, next } }` | `Session.Message.User = { id: "msg_...", time, text, metadata?, type: "user" }`. |
| Is the agent loop idle? | `POST /api/experimental/session/{sessionID}/wait` → `204` | "Wait for a session agent loop to become idle." May return `503 ServiceUnavailableError`. |
| Cancel undelivered input | `DELETE /api/session/{sessionID}/inbox/{inboxID}` → `204` | "Cancel an inbox item that has not yet been delivered. Unavailable items are a no-op." |
| Create a synthetic (non-user) message | `POST /api/session/{sessionID}/synthetic` `{ text, description?, metadata?, delivery?, resume? }` | Admitted like a user prompt but typed `synthetic`. Not a substitute for a human-originated decision. |

Combining inbox absence with message presence gives a documented, pollable delivery signal that is stronger than "Telegram accepted the message". Whether either signal proves the agent *acting* on it is not documented.

### 2.5 MCP transport, timeouts, and configuration

Confirmed from `https://opencode.ai/v2/docs/mcp-servers/`:

- V2 nests servers under `mcp.servers.<name>` (not directly under `mcp`).
- Local: `{ "type": "local", "command": ["npx","-y","pkg"], "cwd"?, "environment"?{ "KEY": "{env:KEY}" }, "disabled"?, "codemode"?, "timeout"?, "protocol"? }`.
- Remote: `{ "type": "remote", "url": "https://…/mcp", "headers"?, "oauth"? | false, "disabled"?, "codemode"?, "timeout"?, "protocol"? }` — Streamable HTTP, absolute URL required.
- Code Mode is **on by default**; tools are then grouped as `tools.<normalized_server>.<tool>`, and `"codemode": false` exposes them on the provider's native tool list.
- Tool names are `<server>_<tool>` after normalization (non `[A-Za-z0-9_-]` → `_`); permission action matches that name with resource `*`.
- Default timeouts: `startup` 30 s, `catalog` 30 s, `execution` **12 hours**. So "tool timeout" is an operator-tunable value, not a fixed platform constraint.
- Server instructions returned at initialize are injected into the system prompt as `<mcp_instructions>`.
- MCP elicitation input requests are supported and surface as forms.

**Not documented:** any mechanism by which an MCP **notification** creates or resumes an agent turn. Across the V2 pages read, the only documented way to schedule agent-loop execution is session input admission (`session.prompt` / `synthetic` / `command`) or `resume: true` on interrupt. The proposal's premise — notifications alone are not sufficient — is consistent with the docs, and the product should not claim notification-based delivery.

## 3. Telegram Bot API 10.3

### 3.1 Transport, auth, and secrets — Confirmed

- All methods: `https://api.telegram.org/bot<token>/<METHOD_NAME>`; GET or POST; parameters as query string, `application/x-www-form-urlencoded`, or `application/json`; UTF-8.
- Response envelope: `{ "ok": true, "result": … }` or `{ "ok": false, "description": …, "error_code": …, "parameters"?: ResponseParameters }`. `error_code` "contents are subject to change".
- `ResponseParameters.retry_after` = "the number of seconds left to wait before the request can be repeated" on flood control.
- Default broadcast ceiling: "all bots are able to broadcast up to **30 messages per second** to their users".
- Secret handling: the bot token is part of the request **path**, so full request URLs must be treated as credentials — never logged, never placed in error text, persisted only via environment/secret storage. `getMe` is the documented token check.

### 3.2 Long polling and offset handling — Confirmed

`getUpdates` parameters: `offset` (Integer), `limit` (1–100, default 100), `timeout` (seconds; 0 = short polling, "short polling should be used for testing purposes only"), `allowed_updates` (array of update type strings).

Documented semantics:

- Updates are stored server-side at most **24 hours**.
- "This method will not work if an outgoing webhook is set up." Webhook and `getUpdates` are mutually exclusive.
- `offset` "Must be greater by one than the highest among the identifiers of previously received updates." An update is confirmed once `getUpdates` is called with a higher offset; a negative offset fetches from the end and forgets earlier updates.
- "In order to avoid getting duplicate updates, recalculate offset after each server response."
- `allowed_updates` does not affect updates created before the call, so stale types can arrive briefly.

Implication for durable decisions: offset confirmation is at-most-once for a crash window. Persisting the offset **after** the decision is durably recorded, plus per-request single resolution, is the only safe ordering; the 24-hour retention window means a long outage loses undelivered updates and those requests must expire rather than wait.

### 3.3 Inline buttons and callback identity — Confirmed

- `InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][], force_reply?: true }` (Bot API 10.3 added `force_reply`; it "can't be changed when the inline keyboard is edited").
- `InlineKeyboardButton`: `text` required; "Exactly one of the fields other than `text`, `icon_custom_emoji_id`, and `style` must be used"; `callback_data` is **1–64 bytes**; `style` ∈ `danger` | `success` | `primary`; `disabled` is a valid button state.
- `CallbackQuery = { id, from: User, message?: MaybeInaccessibleMessage, inline_message_id?, chat_instance, data? }`. `MaybeInaccessibleMessage` is either a `Message` or an `InaccessibleMessage` whose `date` is always `0` — so the message may be gone while the query still arrives.
- "After the user presses a callback button, Telegram clients will display a progress bar until you call `answerCallbackQuery`… necessary to react by calling `answerCallbackQuery` even if no notification to the user is needed."
- `answerCallbackQuery` parameters: `callback_query_id` (required), `text` (0–200 chars), `show_alert`, `url`, `cache_time`.

Identity rules the product can rely on: the deciding user is `callback_query.from.id` (`User.id`, ≤52 significant bits, signed 64-bit safe); the private chat is `message.chat.id` with `Chat.type === "private"`. `chat_instance` is "a global identifier… corresponding to the chat", not a user identity. Because `from` and `chat` are both present and the chat may be inaccessible, authorization must check the sender, not the message.

### 3.4 ForceReply mapping for typed responses — Confirmed

`ForceReply = { force_reply: true, input_field_placeholder?: 1–64 chars, selective?: boolean }`. `selective` targets users "@mentioned in the text" or "sender of the original message" when the bot message replies to one. Clients then show a reply interface; the user's answer arrives as a normal `Message` whose `reply_to_message.message_id` equals the bot's prompt message, with `Message.text`.

Documented consequences worth designing around: `ForceReply` is "Not supported in channels and for messages sent on behalf of a user account"; a reply interface is a client affordance, not an enforced constraint, so the bot still receives ordinary messages and must correlate them itself. Correlation should use `reply_to_message.message_id` **and** an explicit request identifier in the prompt text, because reply quoting is not guaranteed (`reply_to_message` is only present "For replies in the same chat and message thread").

### 3.5 Sending and editing — Confirmed

- `sendMessage`: `chat_id` required, `text` 1–4096 chars, `parse_mode`, `entities`, `link_preview_options`, `reply_parameters`, `reply_markup` (InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply), `protect_content`, `disable_notification`, thread fields. Returns the sent `Message` (carry its `message_id`).
- `editMessageText`: `chat_id` + `message_id` (or `inline_message_id`), new `text` 1–4096. The only stated 48-hour limit applies to business messages not sent by the bot.
- `editMessageReplyMarkup`: same addressing; `reply_markup` is `InlineKeyboardMarkup` only — this is the documented way to retire buttons after a decision.
- `Message`: `message_id` is "Unique message identifier inside the chat", `from?`, `chat`, `date`, `text?`, `reply_to_message?`.
- Recommended by Telegram: editing the keyboard is "faster and smoother than sending a whole new message and deleting the previous one" (`https://core.telegram.org/bots/features`).

### 3.6 Pairing precondition — Confirmed

Bots cannot open a conversation with a user. The platform documents `/start` as the command that "begins the interaction with the user", and "Users will see a **Start** button the first time they open a chat with your bot" (`https://core.telegram.org/bots/features`, sections "Global Commands" and "Command Scopes"). The first-use path therefore has to wait for the paired human to message the bot; an unsolicited incoming message still must not establish authority, so pairing needs an operator-issued code (or equivalent) that the human echoes to the bot.

## 4. npm distribution

### 4.1 Name availability — queried, not reserved

| Query | Result |
|---|---|
| `GET https://registry.npmjs.org/proceed-mcp` | `HTTP 404`, body `{"error":"Not found"}`, response `Date: Sat, 31 Oct 2026 07:51:23 GMT` |
| `GET https://registry.npmjs.org/proceed` | `HTTP 200`, `dist-tags.latest = 0.0.1`, `time.modified = 2022-06-24T16:54:47Z` (unrelated legacy package) |
| `GET https://registry.npmjs.org/-/v1/search?text=proceed-mcp&size=5` | 112,678 fuzzy matches, none named `proceed-mcp` |

Reading: no package metadata exists for `proceed-mcp` at query time. This is **not** a reservation, and it proves nothing about who may claim the name, scope choice, or future availability. Package identity remains an owner decision; scope (`@scope/proceed-mcp`) remains an option that would also require an organization or user scope.

### 4.2 Trusted publishing requirements — Confirmed

Source: `https://docs.npmjs.com/trusted-publishers/` (page last edited 2026-10-06).

| Requirement | Detail |
|---|---|
| Toolchain floor | npm CLI **≥ 11.5.1**, Node **≥ 22.14.0** |
| Runners | GitHub Actions **GitHub-hosted runners only**; self-hosted is not supported |
| GitHub permission | `permissions: id-token: write` (plus `contents: read`); "The critical requirement" |
| Reference workflow | `actions/checkout@v6`, `actions/setup-node@v6` with `node-version: '24'`, `registry-url: 'https://registry.npmjs.org'`, `package-manager-cache: false` ("never use caching in release builds"), then `npm ci`, build, test, `npm publish` |
| Publisher registration | npmjs.com → package → Settings → Trusted publishing: organization/user, repository, **workflow filename including `.yml`/`.yaml`**, optional environment, optional allowed actions |
| Repository binding | `package.json` `repository.url` must **exactly match** the GitHub repository |
| Validation window | A new trusted publisher configuration "must complete its first successful publish within **2 days**" or it expires and must be recreated |
| Limits | Up to 10 trusted publishers per package; existing connections cannot be edited, only deleted and recreated |
| Allowed actions | `npm stage publish` always allowed; direct `npm publish` and `npm dist-tag` are separate opt-ins. New configurations after 2026-09-03 default to stage-only |
| Provenance | Automatically generated for OIDC publishes when the repository is public and the package is public; `--provenance` is not needed |
| dist-tags over OIDC | npm CLI **≥ 11.21.0** (or ≥ 12.2.0) and "Allow npm dist-tag" enabled on that connection |
| Non-OIDC commands | `install`, `view`, `access`, and interactive stage approval still need traditional auth; OIDC covers `npm publish`, `npm stage publish`, dist-tag operations |
| Hardening | After enabling trusted publishing: "Require two-factor authentication and disallow tokens"; enable GitHub tag protection rules; use deployment environments |

**Undocumented: first-publication bootstrap.** The trusted-publisher configuration lives on an existing package's settings page, and the docs describe no mechanism to configure a publisher for a name that has never been published. The requirement to complete "its first successful publish" within 2 days also presupposes a package and a working workflow. A first publish therefore needs a separate authorized path (interactive maintainer publish, or a short-lived granular token used once and then revoked) before OIDC-only publishing can be enabled. That bootstrap is an operations decision, not a documented npm feature; it must not be invented in design.

### 4.3 Local toolchain check

Observed in this environment: Node `v22.23.1` (meets ≥ 22.14.0), npm `10.9.8` (**below** the 11.5.1 floor). Local publishing or `npm publish --dry-run` checks cannot validate OIDC behavior with this npm; release CI must use a Node 24 image or explicitly install npm ≥ 11.5.1 (and ≥ 11.21.0 if dist-tags are managed from CI).

## 5. Open questions and live-test blockers

Ordered by risk to the approved outcome. Each is a test or a decision, not a documentation gap to be filled by guessing.

1. **Continuation after tool timeout (critical).** Docs say `session.prompt` "schedules agent-loop execution unless resume is false" and steering "wakes session execution", but no source states what happens to a session whose MCP tool call was aborted by timeout. Live test: start a tool call that waits, abort it, then `POST /prompt` with `delivery: "steer"` and observe `session.active`, `inbox`, and `message` for a new agent turn.
2. **`409 ConflictError` on prompt (critical).** Undocumented condition. Test prompting an active session with `steer`, with `queue`, and with `resume: false`; record which returns 409 and whether retry with the same `id` is safe.
3. **Host correlation for parallel sessions (critical).** The MCP `_meta` carries only a session ID — no server URL, port, or credential. Test whether a stdio MCP child can reach its host: (a) with operator-configured URL + password, (b) via `Service.discover()`/`Service.headers()` for the shared background service, (c) across two simultaneous `opencode serve` instances. Decide the supported topology (single shared service vs per-host configuration) before design commits to it.
4. **Idempotency across restart (high).** Docs cover in-process retry with the same `id`; test that a retry after a product restart and after the original admission was already delivered returns the original admission rather than a second turn.
5. **Delivery confirmation strength (high).** Test whether `inbox` absence plus `message` presence reliably means "the agent received it", including when the session was idle, busy, or had queued items ahead.
6. **Location loading (medium).** `prompt` can return `LocationNotFoundError`. Test whether a long-idle session whose directory is no longer loaded can still be prompted, and what error appears.
7. **Code Mode timeouts (medium).** `mcp.timeout.execution` defaults to 12 h, but any limit inside the `execute` runtime is undocumented. Test a long-running MCP tool call with Code Mode on and `codemode: false`.
8. **Model visibility of `metadata` (medium).** `Session.Message.User.metadata` is stored, but whether it reaches model context is undocumented. If the model must see the outcome type (approve / reject / respond), encode it in `text`.
9. **npm bootstrap and identity (high, owner decision).** Name claim, scope, license, and the single authorized first publish. Nothing can be published or configured as a trusted publisher until those exist.
10. **Telegram authorization edge cases (high).** Test that a third party who receives a forwarded copy of a request cannot produce an accepted decision, that `from.id`/`chat.id` checks reject group and unpaired senders, and that `answerCallbackQuery` is always sent (otherwise the client shows a stuck progress bar).
11. **Telegram outage semantics (medium).** Updates are retained at most 24 h; verify that a product outage longer than that leaves requests expired (not approved) and that offset persistence never skips an unrecorded decision.
12. **Experimental API surface (medium).** The API document calls itself experimental, and several needed routes are tagged experimental (`session.wait`, `client-mcp`). Pin against `ServerInfo.version` and treat route changes as a compatibility risk with a documented support floor.

## 6. Sources

- OpenCode V2 MCP servers (session `_meta`, transports, timeouts, Code Mode): `https://opencode.ai/v2/docs/mcp-servers/`
- OpenCode V2 client and local service discovery: `https://opencode.ai/v2/docs/build/client/`
- OpenCode V2 API reference: `https://opencode.ai/v2/docs/api/`; raw contract `https://opencode.ai/v2/openapi.json`
- OpenCode V2 web access, pairing, ports, Basic auth: `https://opencode.ai/v2/docs/cli/web/`
- OpenCode V2 server plugin contract (prompt admission, idempotency, session methods): `https://opencode.ai/v2/docs/build/plugins/server/`
- OpenCode V2 tools and Code Mode: `https://opencode.ai/v2/docs/tools/`
- OpenCode V2 troubleshooting (service files, logs, health): `https://opencode.ai/v2/docs/troubleshooting/`
- OpenCode V2 docs index: `https://opencode.ai/v2/llms.txt`
- MCP specification 2025-11-25, base protocol (`_meta`): `https://modelcontextprotocol.io/specification/2025-11-25/basic`
- Telegram Bot API 10.3: `https://core.telegram.org/bots/api`
- Telegram bot features (`/start`, inline keyboard guidance): `https://core.telegram.org/bots/features`
- npm trusted publishing: `https://docs.npmjs.com/trusted-publishers/`
- npm registry metadata queries: `https://registry.npmjs.org/proceed-mcp`, `https://registry.npmjs.org/proceed`, `https://registry.npmjs.org/@opencode%2Fclient`
