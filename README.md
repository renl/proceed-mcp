# proceed-mcp

Proceed sends an agent's approval request to your private Telegram chat and returns the human decision to the waiting MCP call. Only an explicit Approve grants approval. Proceed records the outcome and never executes the action.

This guide matches source version `0.1.0-preview.7`. Check that this exact version is available from npm before installing.

Package: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)

## Install

```console
npm install --global @meshimize/proceed-mcp@0.1.0-preview.7
proceed-mcp --help
```

Install the exact version so you get the behavior described here. Installation is an ordinary npm global install. It does not ask for or store the Telegram token. State, keys and the token file stay outside the package, so an upgrade preserves them.

If `proceed-mcp` is not on `PATH`, run the entry point directly. `npm root --global` prints the global root, and the entry point is `<npm-global-root>/@meshimize/proceed-mcp/bin/proceed-mcp.js`.

## Requirements

- Node.js 24 or newer.
- One dedicated Telegram bot and one private chat with that bot. Do not configure a webhook or run another poller against the bot.
- The broker and the MCP client on the same machine. You can answer from a phone anywhere.
- A protected state directory owned by your OS account, outside repositories and the npm installation. On POSIX the state directory and its files need owner-only permissions. On Windows the state directory needs a local fixed NTFS volume with persistent ACLs.

The Telegram token has separate, ordinary storage. It does not need the protected-state requirements above.

## Telegram token

`telegram provision` reads one token through private terminal input and writes it once to a separate plaintext file. The default destination is `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`, where `<state-key>` is derived from the state directory. Keep the file outside repositories, product state, package directories and harness configuration.

**The token file is ordinary plaintext.** It is not encrypted. Proceed does not restrict it to your account, creates it with ordinary OS defaults and performs no token-specific permission checks or repairs. Any principal whose OS access permits reading it can obtain the token, including administrators, other processes and backups.

Provisioning is create-only. It refuses an existing file instead of overwriting it. To use another location, pass an absolute local `--telegram-token-file` path to provisioning and the same path to every later start.

Automatic startup selects one source in this order: `--telegram-token-file`, then a nonempty `PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment, then the default file. A selected source that fails does not fall back to another. To use the default file, remove any higher-priority token from the actual launch environment.

Only broker startup loads the token. The MCP adapter does not read it, and a matching running broker is reused without reading it. After provisioning, normal launches need no token in the harness environment or configuration. Never put the token in command arguments, an MCP `environment` block, a repository file, product state, a log or tool output.

To replace the token, stop the broker, provision a new file at a new path, and use that path on later starts. Changing a launch environment does not change a running broker.

## First-time setup

Do this once for a new installation, with the same absolute state directory in every command. Keep state and keys outside the repository and npm installation.

If a working setup already exists, skip these steps. `init`, `owner add` and `pair` create state and pairing, so rerunning them is not a repair. Existing state, keys and pairing remain usable after an upgrade.

### 1. Create protected state

```console
proceed-mcp init --state-dir <absolute-state-dir>
```

`init` writes a protected `config.json`, a local control credential and an empty journal. It refuses to overwrite existing state and never prints a credential value.

### 2. Add one owner

```console
proceed-mcp owner add <owner-id> --label "<display-label>" --state-dir <absolute-state-dir>
```

`<owner-id>` must match `[a-z0-9_-]{1,64}`. The label is display-only and appears in Telegram. Owner records are immutable. The owner is the transport principal the MCP adapter uses.

### 3. Create a bot and provision the token

Create a bot with @BotFather and keep its token private. Use it only for this broker.

```console
proceed-mcp telegram provision --state-dir <absolute-state-dir>
```

The prompt does not echo input and the token is never printed. Provisioning success means only that the file was written locally. It does not prove Telegram validity, pairing or approval.

If private terminal input is unavailable, the existing `--token-stdin` route accepts bounded input from a trusted nonterminal source. Do not put the token in an argument.

### 4. Pair the private chat

```console
proceed-mcp pair --state-dir <absolute-state-dir>
```

The command starts or reuses the secure broker and prints a one-use code that expires after five minutes. In the private chat with the bot, send `/start`, then exactly `/pair <code>` before expiry. Group chats and malformed commands do not pair. `/start` alone grants nothing. Only the first pairing succeeds and there is no in-chat re-pair.

## Connect an MCP client

Configure a local stdio server in any MCP client to run:

```console
proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

For OpenCode V2, add a local server under `mcp.servers` in `opencode.jsonc` that runs the same command, and set `codemode: false` to expose the tools directly. Do not add a token to that file.

The adapter starts a broker when the state is safely unowned, or reuses a matching running broker, so no separate broker terminal is needed. It connects only to the local broker and needs no OpenCode API, password or provider credential. Startup waits up to 150 seconds for local readiness, and your client may time out sooner. A startup error is never a human decision.

## Approval tools

- `prepare_approval` (optional `session_label`): reserve a request identity and a private capability. Sends no Telegram question.
- `request_approval` (`request_handle`, `request_capability`, `client_request_id`, `action`, `context`, optional `expires_in_seconds`): create or replay the request, then wait for the human outcome.
- `get_approval` (`request_id`, `request_capability`): read that request after a lost wait. It does not wake the agent.
- `cancel_approval` (`request_id`, `request_capability`): cancel that pending request.
- `acknowledge_approval` (`request_id`, `request_capability`, `decision_id`): record receipt of the matching decision. It is idempotent and creates no second decision.

Normal flow: call `prepare_approval`, call `request_approval` with the returned handle and capability, then use the returned `resolution`. If the result contains a `decision_id`, acknowledge that exact decision. Act only on `approved`, and only within your own permission rules.

- `approved`: an authorized human explicitly approved this request.
- `rejected`: an authorized human rejected it. This does not authorize the action.
- `responded`: an authorized human supplied instructions. This is not approval.
- `expired`: the deadline passed without a decision. This is not approval.
- `cancelled`: the request was cancelled. This is not approval.

In Telegram, Approve grants approval, Reject records rejection, and Respond opens a text prompt for instructions, or send exactly `/respond <request_id> <text>`. Approval-like words in Respond text stay instructions.

Keep `request_capability` private. Under the same owner, it authorizes later `get_approval`, `cancel_approval` and `acknowledge_approval` calls for that one request. Never put it in Telegram, assistant messages, logs, `session_label`, `action` or `context`, because those text fields are shown in the Telegram question.

A client or transport timeout does not cancel the request. Keep the `request_id` and capability, then read the same outcome later with `get_approval`. `delivery_state` describes reporting, not the decision. `proceed-mcp status` shows the current state.

## State and privacy

Approval state and key protections are unchanged by ordinary token storage. The token exception covers only the token file and its dedicated parent directories, not the state directory or its other files.

- `config.json`, `credentials/control.token`, `credentials/owner.<owner-id>.token`, `journal.log` and `broker.lock` remain protected state. A protection check that cannot confirm the required storage, ownership or metadata refuses the operation. Do not weaken it.
- Channel and operator keys keep their existing protection requirements.
- `journal.log` records request text, decisions and timestamps. Treat the state directory as sensitive local data.
- The broker listens only on `127.0.0.1`. Closing a client does not stop the shared broker. Use `proceed-mcp stop --state-dir <dir>` when you want it stopped.
- Back up only while the broker is cleanly stopped. Copy the whole state directory after `stop` confirms. Do not delete a lock or journal to get past a failure.
- Other processes running as the same account, administrators and backups can read protected state too. Owner-only protection is not isolation between processes of one account.

## Optional: launch environment

If you cannot provision a token file, supply `PROCEED_TELEGRAM_BOT_TOKEN` privately in the environment that starts the broker or MCP host. This mode is for advanced or one-off use. The token is not persisted and must be supplied again for each fresh broker start. The adapter passes it only to the broker it launches. Supply it through the trusted process environment, never through harness JSON, a repository file, product state or a log. A provisioned file avoids recurring entry.

To reuse existing state in a foreground terminal, start the secure broker with the environment token already set:

```console
proceed-mcp serve --secure-local --state-dir <absolute-state-dir>
```

`--secure-local` gives the MCP adapter the secure local channel it requires. A foreground `serve` reads only the environment token and does not load the default token file. To start it from a provisioned file, name that file and the same state directory explicitly:

```console
proceed-mcp serve --secure-local --telegram-token-file <absolute-token-file> --state-dir <absolute-state-dir>
```

`serve` refuses `--telegram-token-file` together with a nonempty `PROCEED_TELEGRAM_BOT_TOKEN`, so choose one source. That rejection applies to `serve` only. Automatic startup keeps its own order and ignores an inherited token when it selects the file route.

## Common errors

- `TELEGRAM_CREDENTIAL_UNAVAILABLE`: the selected token source is missing, empty or unusable. Supply the token privately at launch or choose a valid selected file. The chosen source does not fall back.
- `TELEGRAM_CREDENTIAL_EXISTS`: provisioning never overwrites. Choose another destination.
- `BROKER_UNAVAILABLE`: check initialized state, owner setup, the selected token source and a matching `--state-dir`, then start a new adapter.
- `STATE_NOT_INITIALIZED`: run `init` first.
- `PROTECTION_UNVERIFIED` or `PROTECTION_UNAVAILABLE`: a required storage, path, identity or protection condition cannot be confirmed. Choose a dedicated local location. Do not weaken protected state or key checks.
- `NOT_PAIRED`: complete `/pair` before creating a request.
- `NOT_FOUND`: wrong owner, state directory or capability, or an unused handle.
- `DECISION_MISMATCH`: the request is not terminal, or the `decision_id` does not match.
- `INVALID_ARGUMENT` or `PREREQUISITE_UNAVAILABLE` during provisioning: input was cancelled, ended early, passed the 60-second deadline, was invalid, or private input was unavailable. Retry in a trusted terminal or use `--token-stdin`.
- Telegram processing stopped: check the token privately, confirm no webhook or second poller owns the bot, then stop the broker and restart it.

Exit codes are `0` for completion, `2` for invalid arguments or configuration, `3` for an unavailable prerequisite and `4` for a storage or integrity failure.

## Limits

- This source has unit-level verification only. Installed startup, native platform permission behavior, actual Telegram delivery, login or reboot startup and multi-client compatibility remain unverified.
- One paired Telegram human and one bot token per broker, and one broker per state directory. A separate owner is a separate transport principal, not another human or bot.
- The product does not execute actions and does not enforce your client's permission rules. Approval is cooperative.
- A client timeout does not cancel the request. There is no automatic continuation after a timeout, no session reattachment and no agent wake-up from retrieval.
- Token provisioning is create-only. There is no overwrite, rotation or deletion command, so replacing a token means choosing a new destination and using it everywhere.
- OpenCode V2 is the configuration example. No multi-client compatibility is claimed.

## License

MIT, copyright 2026 Ng Cheng Leong.
