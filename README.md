# proceed-mcp

An MCP server that routes agent approval requests to a Telegram chat, so an operator can approve,
reject or answer an action from a chat client instead of a terminal prompt. Each accepted outcome is
delivered to the exact OpenCode V2 session that asked, including after the original MCP call has
timed out while its host is still running.

**Status: minimum vertical path implemented, not verified against a live platform.** The package now
provides the setup commands, a local broker with a durable journal, one-time Telegram pairing,
request/decision handling, the stdio MCP adapter and the authenticated OpenCode admission and
reconciliation path. Nothing here is a compatibility, support or release claim: no live Telegram
chat, OpenCode host or packaged installation has been verified for this build, and no OpenCode
version is admitted by a release allowlist yet. See [Limits](#limits) before relying on it.

## Requirements

- Node.js 24 LTS is the provisional target of this build. It is not yet verified: earlier
  diagnostics ran on Node.js 22, which is not the release target.
- Windows or a POSIX system that can restrict a directory to the current account. Setup and broker
  start fail rather than continuing when that protection cannot be established and verified.
- One dedicated Telegram bot token, used only by this broker. Sharing the token with a webhook or a
  second poller is unsupported and is reported as a conflict.
- One authenticated loopback OpenCode V2 host per configured origin. This build targets a single
  host on the same machine; the approving human may be remote.

The package ships runnable JavaScript with no compile step, no native add-on and no postinstall
script. `npm install` is only needed when working on the sources (the formatter is a development
dependency).

## Run the executable

```console
node bin/proceed-mcp.js --help
```

## Setup

1. Create the state directory, an empty configuration, a local control credential and an empty
   journal:

```console
node bin/proceed-mcp.js init
```

`init` refuses to overwrite existing state.

2. Bind one OpenCode host origin:

```console
node bin/proceed-mcp.js origin add <origin_id> --url http://127.0.0.1:<port> --password-env <PASSWORD_ENV>
```

- `<origin_id>` matches `[a-z0-9_-]{1,64}`.
- `--url` must be `http`, the literal host `127.0.0.1`, an explicit port, and no path, query,
  fragment or embedded credentials. A different address needs a new origin ID, because bindings are
  immutable.
- `--password-env` names the environment variable that will hold that host's OpenCode password. The
  password itself is never written to state or passed on the command line. OpenCode's documented
  loopback access uses Basic auth with the fixed username `opencode`, so configure that password on
  the host yourself and keep the host listening on loopback only.

3. Start the broker in its own terminal or under a supervisor, with the secrets in its environment:

```console
PROCEED_TELEGRAM_BOT_TOKEN=... <PASSWORD_ENV>=... node bin/proceed-mcp.js serve
```

The broker owns its loopback port exclusively, recovers the journal, then prints one readiness line.
It keeps running when the Telegram platform is temporarily unreachable and retries with backoff; it
stops with a diagnostic if another consumer owns the bot's updates or the token is rejected.

4. Pair exactly one human private chat:

```console
node bin/proceed-mcp.js pair
```

The command prints a one-use code valid for five minutes. In the private chat with the bot the human
sends `/start`, then `/pair <code>`. `/start` alone grants nothing, group chats are refused, and the
code is never logged or stored in plain text.

5. Wire the MCP adapter into the OpenCode host as a local server:

```json
{
  "mcp": {
    "servers": {
      "proceed": {
        "type": "local",
        "command": [
          "node",
          "/path/to/proceed-mcp/bin/proceed-mcp.js",
          "mcp",
          "--origin",
          "<origin_id>"
        ],
        "codemode": false
      }
    }
  }
}
```

The adapter reads only that origin's local credential and never receives the Telegram token. The
requesting session is taken solely from the host-supplied `_meta["ai.opencode/sessionID"]`, never from
tool arguments.

All commands accept `--state-dir <directory>`. Resolution order is `--state-dir`, then
`PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`.

### Environment variables

| Variable                                   | Used by       | Meaning                                       |
| ------------------------------------------ | ------------- | --------------------------------------------- |
| `PROCEED_STATE_DIR`                        | every command | State directory when `--state-dir` is absent. |
| `PROCEED_TELEGRAM_BOT_TOKEN`               | `serve`       | Telegram bot token. Required by `serve` only. |
| _(operator-chosen, from `--password-env`)_ | `serve`       | Password for one bound OpenCode origin.       |

Never commit these values. State writes them nowhere; only variable names are stored.

### State directory contents

| Path                                   | Contents                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `config.json`                          | Schema version 1: Telegram token variable name, broker port, immutable origin bindings. |
| `credentials/control.token`            | Local control credential for pairing, status and retry routes.                          |
| `credentials/origin.<origin_id>.token` | Per-origin credential for MCP request routes.                                           |
| `journal.log`                          | Append-only transaction journal; the only mutable product state.                        |
| `broker.lock`                          | Ownership record written by a running broker; informational, removed on clean stop.     |

The state directory and its files are restricted to the current OS account: an owner-only ACL on
Windows verified through the file system ACL, and owner-only mode bits on POSIX. Credential values
are never printed by any command. Back up a **stopped** broker's entire state directory; there is no
history deletion or compaction in this build.

## Commands

| Command                                | Behaviour                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `init`                                 | Create protected empty state (config, credentials, empty journal).            |
| `origin add <id> --url --password-env` | Store one immutable origin binding; requires a stopped broker.                |
| `serve`                                | Recover, own the port, poll Telegram, deliver decisions. Foreground process.  |
| `pair`                                 | Ask the running broker for one pairing code; refuses when already paired.     |
| `mcp --origin <id>`                    | Run the stdio MCP adapter for that origin.                                    |
| `status [--request <id>] [--json]`     | Show resolution, Telegram presentation, delivery state and redacted error.    |
| `retry <request_id>`                   | Resume a blocked or scheduled delivery with the persisted prompt ID and text. |

`doctor` is a documented target that this build does not implement; it fails as an unknown command
rather than pretending to check anything.

## MCP tools

| Tool               | Arguments                                                                                        | Effect                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `request_approval` | `client_request_id`, `action`, `context`, optional `expires_in_seconds` (60–86400, default 3600) | Durably create one pending request and return its receipt.      |
| `get_approval`     | `request_id`                                                                                     | Read this session's own request, applying expiry first.         |
| `cancel_approval`  | `request_id`                                                                                     | Cancel this session's pending request; terminal outcomes stand. |

The receipt is the request representation (`resolution`, `telegram_state`, `delivery_state`,
`delivery_error` and so on), not an authorization flag. Creation does not wait for the human. A
decision arrives as a new session input, not as the tool result, so an expired tool call does not
lose the decision.

## Decision delivery

At resolution the broker allocates `msg_` plus the request's 32 hex characters and persists the exact
prompt text: a plain-language outcome heading plus a JSON data record holding the request identity,
action, context, resolution, response text and resolution time. Every retry and every restart reuses
that ID and text, and delivery reconciles against the session's projected history and inbox first, so
a lost admission response cannot create a second decision-driven turn.

Delivery states are distinct from the resolution: `not_applicable`, `pending` (decision recorded,
admission unconfirmed), `admitted`, `delivered` (present in the session's projected input history) and
`blocked` (non-retryable prerequisite or exhausted retry period, with `proceed-mcp retry` as the
repair path). `delivered` means the input reached the exact session; it does not mean the requested
action ran.

Reject and Respond never grant approval. Respond text is stored and delivered exactly, including
whitespace and approval-like words; it is instructions only.

## Journal format

```text
header   8 bytes "PROCEEDJ" + uint32be format version (1)
record   uint32be frame length | uint32be payload length | uint64be sequence | payload | SHA-256
```

The digest covers the record bytes before it, so an edited, reordered or truncated record cannot pass
validation. A transaction commits with one record whose payload lists its mutations; its file flush
completes before the broker acknowledges the operation or performs any Telegram or OpenCode effect.
Recovery discards only an incomplete final record, and stops with exit code 4 on a checksum failure,
sequence gap, unsupported version or corruption before the tail. There is no test-only storage API:
the journal is the only durable state, and its records are readable by an independent decoder.

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Command completed.                                                            |
| `2`  | Invalid arguments or configuration.                                           |
| `3`  | Unavailable prerequisite, such as missing state, token or a reachable broker. |
| `4`  | Storage or integrity failure, including unverifiable file protection.         |

Diagnostics go to stderr; command results go to stdout. The MCP adapter writes only protocol frames
to stdout.

## Limits

- One paired human, one bot token, one broker per state directory. Re-pairing needs a separately
  authorized local procedure; there is no in-chat identity change.
- The product supplies cooperative decisions. It does not enforce execution permissions and does not
  modify OpenCode's permission rules; that policy remains the operator's responsibility.
- No recovery of an exited OpenCode process, no automatic host discovery or replacement, no remote
  broker hosting, and no delivered state across two origins in this build.
- OpenCode's HTTP surface is experimental. Only a running version verified by a boundary spike may be
  admitted by a release allowlist; until then version compatibility is unproven and unsupported host
  shapes fail closed.
- Package identity, license and the supported Node.js floor remain undecided: `package.json` carries
  the placeholder `private: true` and `UNLICENSED` so this build cannot be published by accident.

## Development

```console
npm install
npm run build         # validates that shipped modules parse and the bin entry is usable
npm run format:check  # formatting gate for production sources
```
