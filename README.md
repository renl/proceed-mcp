# proceed-mcp

An MCP server that routes agent approval requests to a Telegram chat, so an operator can approve
or deny an action from a chat client instead of a terminal prompt.

**Status: setup checkpoint only.** The package currently provides the empty-state setup commands
(`init`, `origin add`). It does not yet run a broker, poll Telegram, expose MCP tools, or continue an
OpenCode session. Nothing here is a support, compatibility or release claim.

## Requirements

- Node.js 24 LTS is the provisional target of this build. It is not yet verified: earlier
  diagnostics ran on Node.js 22, which is not the release target.
- Windows or a POSIX system that can restrict a directory to the current account. Setup fails rather
  than continuing when that protection cannot be established and verified.

The package ships runnable JavaScript with no compile step, no native add-on and no postinstall
script. `npm install` is only needed when working on the sources (the formatter is a development
dependency).

## Run the executable

```console
node bin/proceed-mcp.js --help
```

## Setup

Setup is two local, offline commands. Neither contacts Telegram or OpenCode, and neither starts a
service.

1. Create the state directory, an empty configuration and a local control credential:

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
  password itself is never written to state or passed on the command line.

Both commands accept `--state-dir <directory>`. Resolution order is `--state-dir`, then
`PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`.

### Environment variables

| Variable                                   | Used by               | Meaning                                         |
| ------------------------------------------ | --------------------- | ----------------------------------------------- |
| `PROCEED_STATE_DIR`                        | every command         | State directory when `--state-dir` is absent.   |
| `PROCEED_TELEGRAM_BOT_TOKEN`               | future `serve`        | Telegram bot token. Not read by setup commands. |
| _(operator-chosen, from `--password-env`)_ | future `serve`, `mcp` | Password for one bound OpenCode origin.         |

Never commit these values. Setup writes them nowhere; only variable names are stored.

### State directory contents

| Path                                   | Contents                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `config.json`                          | Schema version 1: Telegram token variable name, broker port, immutable origin bindings. |
| `credentials/control.token`            | Local control credential for privileged local routes (written by `init`).               |
| `credentials/origin.<origin_id>.token` | Per-origin credential for MCP routes (written by `origin add`).                         |

The state directory and its files are restricted to the current OS account: an owner-only ACL on
Windows verified through the file system ACL, and owner-only mode bits on POSIX. Credential values
are never printed by these commands.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | Command completed.                                                    |
| `2`  | Invalid arguments or configuration.                                   |
| `3`  | Unavailable prerequisite, such as missing state or a running broker.  |
| `4`  | Storage or integrity failure, including unverifiable file protection. |

Diagnostics go to stderr; command results go to stdout.

## Development

```console
npm install
npm run build         # validates that shipped modules parse and the bin entry is usable
npm run format:check  # formatting gate for production sources
```

## Not implemented yet

`serve`, `pair`, `mcp`, `doctor`, `status` and `retry` are documented targets, not available
commands. Telegram pairing, request persistence, decision delivery and exact-session continuation
are not implemented. Package identity, license and the supported Node.js floor remain undecided:
`package.json` carries the placeholder `private: true` and `UNLICENSED` so this build cannot be
published by accident.
