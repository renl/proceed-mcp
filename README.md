# proceed-mcp

Review your MCP agent's approval requests from Telegram.

`proceed-mcp` sends an agent's proposed action to your private Telegram chat. Choose Approve,
Reject, or Respond with instructions, and the waiting MCP call receives your decision. Only an
explicit Approve grants approval. The server records the outcome. It does not execute the action.

To get started, install the package, pair your Telegram chat, and connect your MCP client using the
steps below.

> **Preview:** `@meshimize/proceed-mcp@0.1.0-preview.1` is published on npm and listed in the
> official MCP Registry. Pin the exact version. MCP Events, automatic continuation after a timeout,
> `doctor`, and `retry` are not implemented in this preview.

## Distribution

`@meshimize/proceed-mcp` is the npm package for this product. It installs the `proceed-mcp` command
and its runtime sources. It is not a hosted MCP endpoint, and there is no cloud broker. The MCP
adapter and the broker run on your machine. The broker listens only on `127.0.0.1` and calls
`https://api.telegram.org` for Telegram.

- npm: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)
- MCP Registry: [io.github.renl/proceed-mcp](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.renl%2Fproceed-mcp)

The current version is `0.1.0-preview.1`. Both the `preview` and `latest` dist-tags point to it, so
pin the exact version rather than relying on either tag. Publishing automation is planned but not
implemented.

## Requirements

- Node.js 24 or newer. `package.json` declares `>=24`.
- One dedicated Telegram bot and one private chat with that bot. Do not share the bot with another
  poller or a webhook.
- The broker and the MCP adapter must run on the same machine. The human may be remote.
- On Windows, `powershell.exe` and `icacls` must be available for the owner-only ACL check. On
  POSIX, the state directory must support owner-only mode bits.
- No build tool, native addon, or postinstall script is required.

## Install

Install the exact preview version globally:

```console
npm install --global @meshimize/proceed-mcp@0.1.0-preview.1
proceed-mcp --help
```

Or run it without a global install:

```console
npx --yes --package @meshimize/proceed-mcp@0.1.0-preview.1 -- proceed-mcp --help
```

The scoped package installs the same `proceed-mcp` command.

## Set up the broker and Telegram

### 1. Create protected state

Choose an absolute directory that is empty or does not exist yet. Keep it outside the repository.

```console
proceed-mcp init --state-dir <absolute-state-dir>
```

`init` creates a protected `config.json`, a local control credential, and an empty journal. It
refuses to overwrite existing state. It prints the state path, never a credential value.

### 2. Add one owner

The owner is the transport principal used by the MCP adapter.

```console
proceed-mcp owner add <owner-id> --label "<display-label>" --state-dir <absolute-state-dir>
```

`<owner-id>` must match `[a-z0-9_-]{1,64}`. The label is display-only and appears in Telegram. Run
this before the first `serve`, because `owner add` refuses while a broker ownership record exists.
Owner records and credentials are immutable.

### 3. Create a dedicated Telegram bot

Create a new bot with @BotFather and keep its token private. Use this bot only for this broker. Do
not configure a webhook for it and do not run another poller against it. `proceed-mcp` never deletes
a webhook and never rewinds or drops pending updates. If Telegram reports a competing consumer,
Telegram processing stops with a diagnostic, and you must repair the bot and restart `serve`.

### 4. Start the broker in the foreground

Put the token only in the broker's own process environment.

PowerShell:

```powershell
$env:PROCEED_TELEGRAM_BOT_TOKEN = '<bot-token>'
proceed-mcp serve --state-dir 'C:\absolute\path\to\proceed-state'
```

POSIX:

```sh
export PROCEED_TELEGRAM_BOT_TOKEN='<bot-token>'
proceed-mcp serve --state-dir /absolute/path/to/proceed-state
```

Wait for `proceed-mcp: broker ready on http://127.0.0.1:43189` and the state directory line. Leave
this terminal open.

The token is read only from the broker process environment. It is never stored in the state
directory, the journal, Telegram, or the request history. The product does not read `.env` files.
Never put the token in the MCP adapter's environment or in the MCP client configuration.

If the token is missing or empty, the broker still starts locally and prints a warning. A request
cannot be created until a human is paired, so complete Telegram setup before testing. If the token is
rejected, or another consumer owns the bot, Telegram processing stops with a diagnostic while the
local broker keeps running. Fix the bot and restart `serve`.

### 5. Pair the private chat

In a second terminal:

```console
proceed-mcp pair --state-dir <absolute-state-dir>
```

The command prints `Pairing code:` and `Expires at:`. In a private chat with the bot, send `/start`,
then send exactly `/pair <code>` before the expiry. Group chats are refused. `/start` alone grants
nothing. A bot-suffixed or malformed command does not pair. The code is one-use, valid for five
minutes, and is not stored in plaintext.

Only the first pairing succeeds. There is no in-chat re-pair or identity change.

### 6. Connect an MCP client

#### OpenCode V2

Add a local server under `mcp.servers` in `opencode.jsonc`. This shape follows the
[OpenCode V2 MCP documentation](https://opencode.ai/v2/docs/mcp-servers).

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "proceed": {
        "type": "local",
        "command": [
          "npx",
          "--yes",
          "--package",
          "@meshimize/proceed-mcp@0.1.0-preview.1",
          "--",
          "proceed-mcp",
          "mcp",
          "--owner",
          "<owner-id>",
          "--state-dir",
          "/absolute/path/to/proceed-state",
        ],
        "codemode": false,
      },
    },
  },
}
```

Replace `<owner-id>` and the state path. On Windows, escape backslashes or use forward slashes in
the JSON string. `codemode: false` exposes the tools directly. OpenCode reloads MCP configuration
after a save. Check the connection with `opencode mcp list`.

The `--package` argument selects the scoped npm package, and the argument after `--` is the
`proceed-mcp` command from that package. If you installed the package globally, start the `command`
array with `proceed-mcp` and keep the same `mcp --owner ... --state-dir ...` arguments.

With this server name, OpenCode exposes the tools as `proceed_prepare_approval`,
`proceed_request_approval`, `proceed_get_approval`, `proceed_cancel_approval`, and
`proceed_acknowledge_approval`. If you leave Code Mode enabled, OpenCode groups them under
`tools.proceed`.

Do not add `PROCEED_TELEGRAM_BOT_TOKEN` to `environment`. The adapter does not need it and must not
receive it.

#### Other stdio MCP clients

Use this command in any client that can start a local stdio server:

```console
proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

To run the published version without a global install:

```console
npx --yes --package @meshimize/proceed-mcp@0.1.0-preview.1 -- proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

The adapter needs no OpenCode API, password, provider credential, or proprietary session metadata.
It connects only to the local broker. Keep `serve` running.

The server advertises MCP protocol `2025-11-25` and exposes five tools: `prepare_approval`,
`request_approval`, `get_approval`, `cancel_approval`, and `acknowledge_approval`.

## MCP tools

| Tool                   | Arguments                                                                                                       | Effect                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `prepare_approval`     | optional `session_label`                                                                                        | Reserve a durable request identity and a private request capability. No Telegram question is sent.                          |
| `request_approval`     | `request_handle`, `request_capability`, `client_request_id`, `action`, `context`, optional `expires_in_seconds` | Create or replay the one request, then wait for its resolution, expiry, or cancellation. A terminal replay returns at once. |
| `get_approval`         | `request_id`, `request_capability`                                                                              | Read that authorized request and apply expiry first. No delivery side effect and no agent wake-up.                          |
| `cancel_approval`      | `request_id`, `request_capability`                                                                              | Cancel that pending request. An already terminal outcome is returned unchanged.                                             |
| `acknowledge_approval` | `request_id`, `request_capability`, `decision_id`                                                               | Record receipt of the matching terminal decision. Idempotent, and it creates no second decision.                            |

`action` accepts 1-1000 Unicode scalars, `context` accepts 0-1000, and `session_label` accepts 1-128.
`client_request_id` must match `[A-Za-z0-9_-]{1,128}`. `expires_in_seconds` is an integer from 60 to
86400 and defaults to 3600.

`request_approval` is the waiting call. It returns the actual outcome, not a creation receipt.
`prepare_approval` alone sends no Telegram question and creates no actionable request.

A normal agent flow is:

1. Call `prepare_approval` and keep the returned `request_handle`, `request_id`, and
   `request_capability` together.
2. Call `request_approval` with that handle and capability, a unique `client_request_id`, the exact
   action, and enough context for the human to distinguish the request.
3. Use the returned `resolution` and `delivery_state`. The call returns the human outcome itself.
4. If the result contains a `decision_id`, acknowledge that exact decision with
   `acknowledge_approval`.
5. Act only when the outcome is `approved`, and only within your own permission rules.

The request capability, together with its owner principal, authorizes later `get_approval`,
`cancel_approval`, and `acknowledge_approval` calls. Never put it in Telegram, assistant messages,
logs, `session_label`, `action`, or `context`. Those text fields are displayed in the Telegram
question. A label is caller-supplied display context, not authenticated identity.

Sharing the capability with another context under the same owner grants that context access to that
one request. It does not redirect the original waiting call and does not authorize a different
owner.

## Decisions and delivery

| Outcome     | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `approved`  | The paired human explicitly approved this request.                        |
| `rejected`  | The paired human rejected it. This does not authorize the action.         |
| `responded` | The paired human supplied instructions. This is not approval.             |
| `expired`   | The deadline passed without a decision. This is not approval.             |
| `cancelled` | An authorized caller cancelled the pending request. This is not approval. |

Only an explicit Approve grants approval. Reject records rejection. Respond records
request-specific instructions only after valid correlated text. To send instructions, press Respond
and reply to its prompt, or send exactly `/respond <request_id> <text>`. Approval-like words in
Respond text never grant approval. Respond text is stored and returned exactly, including
whitespace.

Each request has at most one resolution. Duplicate updates and competing choices do not replace it.
Before acting, deduplicate on `(request_id, decision_id)`.

A client or transport timeout does not cancel or expire the request. A lost waiting call does not
cancel it either. Keep the retained request identity and capability, then use `get_approval` in a
later turn to read the unchanged outcome. Retrieval does not wake an agent or start a new assistant
turn.

MCP Events are unsupported in this preview. There is no automatic resumption after a timeout and no
automatic session reattachment. An approval records an outcome. It does not execute the action.

`delivery_state` describes reporting, not the decision:

- `not_applicable`: no terminal decision yet.
- `pending`: a decision is recorded but delivery is not confirmed.
- `returned`: the adapter reported writing the result to the original call. Receipt is not confirmed.
- `confirmed`: a request-capability holder acknowledged that decision.
- `unavailable`: automatic delivery is unavailable. Retrieve with the retained capability.
- `blocked`: delivery is blocked. Check `proceed-mcp status`.

## First manual test

Use a harmless action. The product never executes it.

1. Keep `serve` running and the MCP client connected.
2. In a new agent session, ask for `prepare_approval`, then `request_approval` with
   `client_request_id` `manual-approve-1`, action `Report the text PROCEED TEST`, context
   `Harmless first-use check. Do not modify files.`, and `expires_in_seconds` 300.
3. While the second call is still waiting, press Approve in Telegram.
4. Expect that waiting call to return `resolution: approved` with the same `request_id`. Acknowledge
   the returned `decision_id` with `acknowledge_approval`. No file or command action needs to run.
5. In the next assistant turn, check the follow-up acknowledgement. It must name the same
   `request_id` and the recorded outcome `approved`. It must not repeat the `request_capability` and
   must not perform the action.
6. Repeat with a fresh prepared handle and `client_request_id` `manual-reject-1`, then press Reject.
   The call should return `rejected`, not authorization to perform the action. Check the next
   assistant turn the same way: matching `request_id` and outcome `rejected`, no capability echo, no
   action.
7. Repeat with `manual-respond-1`. Press Respond, reply to the prompt with the exact text
   `Read only. Do not modify files.`, and confirm the call returns `responded` with that text
   unchanged. Approval-like words in that text remain instructions. Check the next assistant turn
   for the matching `request_id` and outcome `responded`, which records instructions rather than
   approval, with no capability echo and no action.

If a waiting call times out before you choose, the request stays pending until its deadline. Use
`get_approval` with the retained `request_id` and `request_capability` in a later turn. Retrieval
will not wake the agent.

Finish by pressing Ctrl+C once in the broker terminal and waiting for `proceed-mcp: broker stopped`.

## Commands

| Command                                              | Purpose                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `init --state-dir <dir>`                             | Create protected empty state. Refuses to overwrite existing state.               |
| `owner add <id> --label <label> --state-dir <dir>`   | Add an immutable owner and its credential. Requires a stopped broker.            |
| `serve --state-dir <dir>`                            | Run the foreground broker. Reads the Telegram token from the broker environment. |
| `pair --state-dir <dir>`                             | Ask the running broker for a one-use five-minute pairing code.                   |
| `mcp --owner <id> --state-dir <dir>`                 | Run the stdio MCP adapter for one owner.                                         |
| `status --state-dir <dir> [--request <id>] [--json]` | Show requests, resolution, Telegram and delivery state, and the next action.     |
| `retry <request_id> --state-dir <dir>`               | Report that request retry is unavailable in this preview.                        |

`doctor` is not implemented and fails as an unknown command. The older `origin add` command in the
help output belongs to the retired origin-based configuration and refuses this state. Use owner
mode.

Exit codes are `0` for completion, `2` for invalid arguments or configuration, `3` for an unavailable
prerequisite, and `4` for a storage or integrity failure. Diagnostics go to stderr. MCP stdout
carries protocol frames only.

## State, privacy, and shutdown

| Path                                 | Contents                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `config.json`                        | Schema version 2: Telegram token variable name, broker port, owner records. |
| `credentials/control.token`          | Local control credential for pairing, status, and other control operations. |
| `credentials/owner.<owner-id>.token` | Per-owner credential for MCP request routes.                                |
| `journal.log`                        | Append-only transaction journal. The only mutable product state.            |
| `broker.lock`                        | Ownership record written by a running broker and removed on a clean stop.   |

The state directory and its files are restricted to the current OS account. `init`, `owner add`, and
`serve` verify that protection and fail rather than continue if it cannot be established. The
Windows check uses an owner-restricted ACL through PowerShell and `icacls`. POSIX uses owner-only
mode bits.

The journal stores request text, response text, pairing identifiers, decisions, timestamps, and
delivery state. Treat the state directory as sensitive local data. Back up a stopped broker's entire
state directory. This preview has no history deletion or compaction.

Request capabilities are stored only as SHA-256 verifiers. The plaintext capability exists in the
tool result and in your retention. Credential and token values are never printed by a command.

The broker binds only `127.0.0.1`, requires a credential on every route, and rejects browser origins.
There is no public broker listener and no remote broker hosting.

Stop the broker with Ctrl+C and wait for `proceed-mcp: broker stopped`. A clean stop releases the
ownership record. If shutdown fails or the process is killed, `broker.lock` may remain and the next
`serve` refuses to start. Preserve the protected state directory and do not delete the lock or the
journal. There is no automatic stale-lock recovery in this preview.

## Common failures

- `BROKER_UNAVAILABLE`: start `serve`, or check that the adapter and the broker use the same
  `--state-dir`.
- `NOT_PAIRED`: complete `/pair` before creating a request.
- `NOT_FOUND`: wrong owner or state directory, an unused handle, or a request capability that does
  not match.
- `DECISION_MISMATCH`: the request is not terminal, or the `decision_id` does not match.
- Telegram processing stopped: check the bot token and confirm no webhook or second poller owns the
  bot. Restart `serve` after repair.

## Limits

- One paired human and one bot token per broker. Only the first pairing succeeds. There is no
  in-chat identity change or re-pair.
- One broker per state directory. A separate owner is a separate transport principal, not another
  human or bot.
- No hosted service and no remote broker. The broker is loopback-only.
- MCP Events are unsupported. There is no automatic continuation after a tool timeout, and a timeout
  does not cancel the request.
- Retrieval does not wake an agent and does not create a new decision.
- The product does not execute actions and does not enforce OpenCode's permission rules. Approval is
  cooperative.
- No recovery of an exited MCP client or harness process, and no automatic session reattachment.
- OpenCode V2 is the first validation harness. Other harnesses are not tested. The generic stdio
  command is available, but no multi-harness compatibility is claimed.
- Requires Node.js 24 or newer and the state-directory protections described above.
- `doctor` is not implemented. `retry` reports unavailable.

## License

MIT, copyright 2026 Ng Cheng Leong. The release package must include the standard MIT `LICENSE`
file at its root.
