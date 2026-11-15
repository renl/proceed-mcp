# proceed-mcp

**Answer your agent's approval questions from Telegram, not just the terminal.**

Useful agents sometimes need your judgment before taking the next step. Proceed sends their questions to your private Telegram chat, so you do not have to watch the terminal constantly.

Proceed is a Model Context Protocol (MCP) server for agent apps that can launch local stdio MCP servers, not an OpenCode-only plugin. You tell your agent when to ask. Proceed does not automatically intercept tools or enforce the app's native permissions. Setup for OpenCode V2, OpenAI Codex CLI and Anthropic Claude Code is in [Connect an MCP client](#connect-an-mcp-client).

## When it helps

- Before deploying, the agent asks you to approve the target and timing.
- When work needs to go beyond the agreed scope, the agent asks before making those changes.
- Before spending money or deleting data, the agent asks for explicit approval.

## How it works

The agent requests approval -> you answer in Telegram -> the decision returns to the same waiting MCP call while it remains active. Proceed records the outcome. The agent, not Proceed, performs any approved action under its normal permissions.

Only **Approve** authorizes the requested action. **Reject** does not authorize it. **Respond** supplies instructions, not approval, even if you type "yes".

**Preview limits:** a timeout can end the wait without cancelling the request. Recorded outcomes remain retrievable, but answering later cannot wake the agent. See [Limits](#limits).

This guide matches source version `0.1.0-preview.9`. Check that this exact version is available from npm before installing.

Package: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)

## Install

```console
npm install --global @meshimize/proceed-mcp@0.1.0-preview.9
proceed-mcp --help
```

Install the exact version so you get the behavior described here. Installation is an ordinary npm global install. It does not ask for or store the Telegram token. State, keys and the token file stay outside the package, so an upgrade preserves them.

If `proceed-mcp` is not on `PATH`, run the entry point directly. `npm root --global` prints the global root, and the entry point is `<npm-global-root>/@meshimize/proceed-mcp/bin/proceed-mcp.js`.

## Requirements

- Node.js 24 or newer.
- One dedicated Telegram bot and one private chat with that bot. Do not configure a webhook or run another poller against the bot.
- The broker and the MCP client on the same machine. You can answer from a phone anywhere.
- A state directory outside repositories and the npm installation, on local storage. Proceed relies on ordinary file creation, atomic rename and flushing, which not every network or virtual filesystem supports.
- On POSIX, the state directory and its files need owner-only permissions. On Windows, ordinary OS file access is enough: Proceed applies no custom permission checks, inheritance requirements or repair, and the security of your account's files is your responsibility.

The Telegram token has separate, ordinary plaintext storage. It has no token-specific permission requirement on either platform.

## Telegram token

`telegram provision` reads one token through private terminal input and writes it once to a separate plaintext file. The default destination is `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`, where `<state-key>` is derived from the state directory. Keep the file outside repositories, product state, package directories and harness configuration.

**The token file is ordinary plaintext.** It is not encrypted. Proceed does not restrict it to your account, creates it with ordinary OS defaults and performs no token-specific permission checks or repairs. Any principal whose OS access permits reading it can obtain the token, including administrators, other processes and backups.

Provisioning is create-only. It refuses an existing file instead of overwriting it. To use another location, pass an absolute local `--telegram-token-file` path to provisioning and the same path to every later start.

Automatic startup selects one source in this order: `--telegram-token-file`, then a nonempty `PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment, then the default file. A selected source that fails does not fall back to another. To use the default file, remove any higher-priority token from the actual launch environment.

Only broker startup loads the token. The MCP adapter does not read it, and a matching running broker is reused without reading it. After provisioning, normal launches need no token in the harness environment or configuration. Never put the token in command arguments, an MCP `environment` block, a repository file, product state, a log or tool output.

To replace the token, stop the broker, provision a new file at a new path, and use that path on later starts. Changing a launch environment does not change a running broker.

## First-time setup

Do this once for a new installation, with the same absolute state directory in every command. Keep state and keys outside the repository and npm installation.

If a working setup already exists, skip these steps. `init`, `owner add` and `pair` create state and pairing, so rerunning them is not a repair. Existing state, keys and pairing remain usable after an upgrade on either platform, with no migration, reset or re-pairing.

### 1. Create state

```console
proceed-mcp init --state-dir <absolute-state-dir>
```

`init` writes `config.json`, a local control credential and an empty journal. On POSIX it makes the state directory and files owner-only. On Windows it uses ordinary OS defaults. It refuses to overwrite existing state and never prints a credential value.

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

Proceed is one local stdio server. Each client below launches the same executable against the same state directory, so installation, `init`, `telegram provision` and `pair` stay one-time steps. The adapter starts a broker when the state is safely unowned, or reuses a matching running broker, so no separate broker terminal is needed. Startup waits up to 150 seconds for local readiness, and your client may time out sooner. A startup error is never a human decision.

If `proceed-mcp` is not on `PATH`, use `node` plus the absolute entry point from [Install](#install) in place of the single `proceed-mcp` command.

### One owner per client

An owner is the transport principal an MCP adapter authenticates as, not a person, a second bot or a second pairing. Your clients share one broker, one bot and one private chat. Give each client its own owner id so their adapter credentials stay separate:

- OpenCode V2: `opencode`.
- OpenAI Codex CLI: `codex`.
- Anthropic Claude Code: `claude`.

`owner add` refuses while a broker ownership record exists for this state directory. Run the supported stop command first, then add only the owners you need:

```console
proceed-mcp stop --state-dir <absolute-state-dir>
proceed-mcp owner add codex --label "Codex CLI" --state-dir <absolute-state-dir>
```

`stop` reports `No broker is running for this state directory.` when none is reachable. Only that report lets you skip the `stop` line and run `owner add` alone. A closed client or an absent process is not that report. Repeat `owner add` with the owner id for each client you use.

Each call creates one owner record and one owner credential and starts nothing. Do not put an owner credential, the bot token or a password in any client configuration. The broker alone loads the Telegram token.

In the JSON and TOML examples below, write a Windows state path with forward slashes, for example `C:/Users/you/proceed-mcp-state`.

### Non-default token file

The examples below assume the default token file, so they need no extra option. If you provisioned with `--telegram-token-file <absolute-token-file>`, that path is not the default, and each client entry that can start a broker must name it too. It is a file path, never the token value.

- OpenCode V2: add `"--telegram-token-file", "<absolute-token-file>"` to the `command` array.
- OpenAI Codex CLI: add `"--telegram-token-file", "<absolute-token-file>"` to `args`.
- Anthropic Claude Code: append `--telegram-token-file <absolute-token-file>` after `--state-dir <absolute-state-dir>`.

A running broker that already loaded the path is reused without reading the file again. The next automatic start after that broker stops must receive the same path, or another selected source, because a selected source that fails does not fall back.

### OpenCode V2

Add one global local server to `~/.config/opencode/opencode.jsonc`, or to `$XDG_CONFIG_HOME/opencode/opencode.jsonc` when `XDG_CONFIG_HOME` is set:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "proceed": {
        "type": "local",
        "command": [
          "proceed-mcp",
          "mcp",
          "--owner",
          "opencode",
          "--state-dir",
          "<absolute-state-dir>"
        ],
        "codemode": false
      }
    }
  }
}
```

Keep every existing entry under `mcp.servers`. `codemode: false` exposes the five Proceed tools directly instead of through Code Mode. Global configuration applies to all projects, so do not add a second `proceed` entry to a project `opencode.jsonc`.

No API key, provider credential or password is needed in this entry. The adapter connects only to the local broker.

OpenCode reloads MCP configuration after a save, and `/reload` forces a full reload. Check the server with `opencode mcp list` or `/mcps`. Official reference: [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers).

### OpenAI Codex CLI

Add one user-level server to `~/.codex/config.toml`, creating the file if it does not exist:

```toml
[mcp_servers.proceed]
command = "proceed-mcp"
args = ["mcp", "--owner", "codex", "--state-dir", "<absolute-state-dir>"]
```

Keep your other tables and settings. Codex CLI, the IDE extension and the desktop app on this host share this file, so the entry is needed once. Do not also add `proceed` to a project `.codex/config.toml`. Start a new Codex session so it loads the file and starts the server. Official reference: [OpenAI Codex MCP](https://developers.openai.com/codex/extend/mcp).

### Anthropic Claude Code

Add one user-scoped stdio server, which stays private and applies to all your projects:

```console
claude mcp add --scope user --transport stdio proceed -- proceed-mcp mcp --owner claude --state-dir <absolute-state-dir>
```

Everything after `--` is passed to Proceed unchanged. This writes to `~/.claude.json`; do not also add `proceed` to a project `.mcp.json`. Start a new Claude Code session, then check with `claude mcp list` or `/mcp`. Official reference: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

### Load the Proceed skill

The npm package and the MCP entry above install the Proceed tools only. They do not install the agent skill, which is separate guidance that tells an agent when and how to use those tools. Install it as a setup step in each project where the agent should have it.

Source: [skills/proceed/SKILL.md](https://github.com/renl/proceed-mcp/blob/main/skills/proceed/SKILL.md) on `main`.

Copy that file unchanged into your client's project skill location. Keep the file name `SKILL.md` and its `name` and `description` frontmatter, so the skill ID stays `proceed`:

| Client | Path within your project | Official reference |
|---|---|---|
| OpenCode V2 | `.opencode/skills/proceed/SKILL.md` | [OpenCode skills](https://opencode.ai/docs/skills) |
| OpenAI Codex CLI | `.agents/skills/proceed/SKILL.md` | [Codex skills](https://developers.openai.com/codex/skills) |
| Anthropic Claude Code | `.claude/skills/proceed/SKILL.md` | [Claude Code skills](https://code.claude.com/docs/en/skills) |

Each client reads its own location, so copy the file into each project and client you use. Load it once explicitly to confirm the client found it:

- OpenCode V2: ask the agent to load the `proceed` skill, or mention `@proceed` in your prompt.
- OpenAI Codex CLI: mention `$proceed`, or run `/skills` to list available skills.
- Anthropic Claude Code: run `/proceed`.

The skill is guidance, not enforcement. It restates the approval flow and safety rules for the agent, while the five tools still come from the MCP server. Neither the skill nor Proceed enforces your client's permission rules, and installing the skill is not a guarantee that the model follows it. Approval remains cooperative.

### Check the connection

Ask the agent to call `prepare_approval`, then `request_approval` with an `action` such as `Connection test - no action will be taken`. Approve that question in Telegram. The `approved` resolution returns to the original waiting call, and its `decision_id` is the one to pass to `acknowledge_approval`. OpenCode's `/mcps` and Claude Code's `/mcp` show the server and its connection state.

If the test times out first, that call received no approval. A timeout does not cancel the request, so a later decision is recorded and can be read only with the same private authority: keep the request id and capability from the result and read the outcome later with `get_approval`. Answering later does not wake the agent or resume the call.

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

State, keys and the token file live outside the package and the repository. The platform rules for file privacy differ.

- On POSIX, the state directory, `config.json`, `credentials/control.token`, `credentials/owner.<owner-id>.token`, channel keys, operator keys and `journal.log` must stay owner-only. If Proceed cannot confirm that, it refuses the operation. Do not weaken it.
- On Windows, Proceed uses ordinary OS file access for the state directory, journals, broker ownership records, control and owner credentials, channel keys and operator keys. It does not check, require or repair ACLs, ownership, inheritance, modes or volume type. What remains is ordinary I/O safety: file or directory type, path identity and storage separation. Anyone your OS lets read those files can obtain their authority, and anyone it lets write approval records can tamper with them. Authentication and TLS do not prevent that.
- On both platforms, Proceed refuses create collisions, flushes writes before reporting success and refuses the operation when these checks fail.
- `journal.log` records request text, decisions and timestamps. Treat the state directory as sensitive local data.
- The token file is separate and ordinary plaintext, as described above. It has no token-specific protection on either platform.
- The broker listens only on `127.0.0.1`. The adapter and the `pair`, `status` and `stop` commands require its TLS-secured local channel and local credentials. Closing a client does not stop the shared broker. Use `proceed-mcp stop --state-dir <dir>` when you want it stopped.
- Back up only while the broker is cleanly stopped. Copy the whole state directory after `stop` confirms. Do not delete a lock or journal to get past a failure. Proceed does not remove a stale lock automatically.
- Other processes running as the same account, administrators and backups can read POSIX-protected state too. Owner-only modes are not isolation between processes of one account.

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
- `PROTECTION_UNVERIFIED` or `PROTECTION_UNAVAILABLE`: a required storage path, file type, file identity or write condition cannot be confirmed. Use a local directory you control, and on POSIX keep state and keys owner-only. Do not bypass the check.
- `NOT_PAIRED`: complete `/pair` before creating a request.
- `NOT_FOUND`: wrong owner, state directory or capability, or an unused handle.
- `DECISION_MISMATCH`: the request is not terminal, or the `decision_id` does not match.
- `INVALID_ARGUMENT` or `PREREQUISITE_UNAVAILABLE` during provisioning: input was cancelled, ended early, passed the 60-second deadline, was invalid, or private input was unavailable. Retry in a trusted terminal or use `--token-stdin`.
- Telegram processing stopped: check the token privately, confirm no webhook or second poller owns the bot, then stop the broker and restart it.

Exit codes are `0` for completion, `2` for invalid arguments or configuration, `3` for an unavailable prerequisite and `4` for a storage or integrity failure.

## Limits

- Normal MCP startup and a Telegram Approve returning to the waiting call were exercised once on Windows with OpenCode before this version changed Windows storage to ordinary OS access. That run does not verify this version's Windows storage path, which has portable unit-test coverage only. Native Windows first use, crash and reboot recovery, other platforms and other clients remain unverified. Optional TUI operation remains unverified.
- Automated coverage is unit-level. Native filesystem behavior, POSIX enforcement, terminal privacy and general platform compatibility remain unqualified. Other decision paths and failure cases are not covered by these checks.
- One paired Telegram human and one bot token per broker, and one broker per state directory. A separate owner is a separate transport principal, not another human or bot.
- The product does not execute actions and does not enforce your client's permission rules. Approval is cooperative.
- A client timeout does not cancel the request. There is no automatic continuation after a timeout, no session reattachment and no agent wake-up from retrieval.
- Token provisioning is create-only. There is no overwrite, rotation or deletion command, so replacing a token means choosing a new destination and using it everywhere.
- Client setup follows each vendor's documented local stdio configuration for OpenCode V2, OpenAI Codex CLI and Anthropic Claude Code. The Codex CLI and Claude Code entries are documented, not runtime verified, and no broader compatibility is claimed.

## License

MIT, copyright 2026 Ng Cheng Leong.
