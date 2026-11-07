# proceed-mcp

Review your MCP agent's approval requests from Telegram.

`proceed-mcp` sends an agent's proposed action to your private Telegram chat. Choose Approve,
Reject, or Respond with instructions, and the waiting MCP call receives your decision. Only an
explicit Approve grants approval. The server records the outcome. It does not execute the action.

This guide is for operators connecting a local MCP client to Telegram approval.

> **Release status:** `@meshimize/proceed-mcp@0.1.0-preview.1` is published on npm and listed in the
> official MCP Registry. It requires a manual foreground broker and does **not** include automatic
> startup. The automatic-startup setup below describes the unpublished `0.1.0-preview.2` candidate,
> not that npm version. MCP Events, automatic continuation after a timeout, `doctor`, and delivery
> retry remain unavailable.

## Distribution

`@meshimize/proceed-mcp` is the npm package for this product. It installs the `proceed-mcp` command
and its runtime sources. It is not a hosted MCP endpoint, and there is no cloud broker. The MCP
adapter and the broker run on your machine. The broker listens only on `127.0.0.1` and calls
`https://api.telegram.org` for Telegram.

- npm: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)
- MCP Registry: [io.github.renl/proceed-mcp](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.renl%2Fproceed-mcp)

The published version is `0.1.0-preview.1`. Both the `preview` and `latest` dist-tags point to it, so
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

Recorded synthetic startup checks use Ubuntu 24.04 with Node 24.22.2. Installed-package and live
Telegram first-use verification remain pending for this candidate. Windows protected provisioning,
detached startup and helper cleanup qualification also remain outstanding.
Protection and secure-channel checks refuse operation when they cannot establish the required safety.

## Install the published preview (manual broker only)

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

For this published version, create state and an owner as in steps 1-2 below, then create the bot.
Supply `PROCEED_TELEGRAM_BOT_TOKEN` privately to the foreground broker's own process environment
from a trusted operator-controlled source. Do not type the token into a command or MCP configuration.
Run `proceed-mcp serve --state-dir <absolute-state-dir>` and leave that terminal open. In another
terminal, run `proceed-mcp pair --state-dir <absolute-state-dir>` and complete the private-chat
pairing in step 5. Connect the published adapter with:

```console
npx --yes --package @meshimize/proceed-mcp@0.1.0-preview.1 -- proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

Keep both broker and adapter on preview.1 for this legacy HTTP mode. The new provisioning,
`--secure-local` and `stop` commands below are not available in preview.1.

## One-time setup for automatic startup (unreleased candidate)

Use the candidate's CLI for every step, not the published preview command. From the candidate
checkout, replace `proceed-mcp` in the commands below with `node bin/proceed-mcp.js`. An installed
candidate package can use its own `proceed-mcp` command. The package metadata identifies this
candidate as `0.1.0-preview.2`. It is not published on npm or listed in the MCP Registry.

### Existing setup: stop the old broker once

Do not run `init` or add an existing owner again. Stop a running legacy HTTP broker with Ctrl+C in
its original foreground terminal and wait for it to exit cleanly. Preserve the state, journal and
pairing. Upgraded `mcp`, `pair`, `status` and `stop` refuse legacy brokers before sending private
credentials. Old clients cannot use the new secure broker.

Then provision the token in step 4 and connect the candidate adapter. Existing pairing does not
need repeating. Alternatively, use secure foreground mode below without saving a token file.
This is a one-time stop/restart, not a recurring terminal requirement for automatic startup.

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
this before `pair`, `mcp` or `serve` can start the broker. `owner add` refuses while a broker ownership record exists.
Owner records and credentials are immutable.

### 3. Create a dedicated Telegram bot

Create a new bot with @BotFather and keep its token private. Use this bot only for this broker. Do
not configure a webhook for it and do not run another poller against it. `proceed-mcp` never deletes
a webhook and never rewinds or drops pending updates. If Telegram reports a competing consumer,
Telegram processing stops with a diagnostic. Repair the bot and restart the broker through your chosen mode.

### 4. Provision the broker-only token

Run provisioning yourself in a trusted local shell, not through an agent or MCP tool. Pipe one
token from an operator-controlled secret source into this command's stdin:

```console
proceed-mcp telegram provision --token-stdin --state-dir <absolute-state-dir>
```

This command alone is not an interactive prompt. It refuses terminal stdin. The source must send
one nonempty ASCII token line, with no whitespace within the token, then close stdin within
60 seconds. Input is limited to 4096 token bytes, optionally followed by LF or CRLF. Never put the
token in command arguments, shell history, exported variables, MCP configuration or tool messages.
Disable shell tracing, transcription and session recording before handling secrets.

For example, in an interactive **Bash** shell, this hidden operator prompt pipes the token using
shell builtins. Replace the state path and use the candidate CLI as described above:

```bash
(
  set +x
  set +a
  unset proceed_token
  IFS= read -r -s -p 'Telegram bot token: ' proceed_token || exit 1
  builtin printf '\n' >&2
  builtin printf '%s\n' "$proceed_token" | proceed-mcp telegram provision --token-stdin --state-dir /absolute/path/to/proceed-state
)
```

Do not paste Bash syntax into PowerShell. On other shells, use a trusted secret source that writes
only the token line to the command's stdin without putting it in arguments or the process environment.

Success prints the credential path, not its value. Provisioning does not contact Telegram, start
the broker or pair anyone. It creates a separate owner-only file at
`<home>/.proceed-mcp-credentials/<state-key>/telegram.token`. The key is derived from the canonical
absolute state path, so keep that state path stable.

The file is not encrypted. Other processes using the same OS account, administrators and backups
can access it. Only the broker loads it for use. It is not saved in product state, the journal or
request history. The product does not read `.env` files.

For another dedicated location, add `--telegram-token-file <absolute-file>` to provisioning and
repeat the same option for `pair` and `mcp`. Keep it outside all repositories, product state and MCP
settings. Network paths, redirected paths and unverifiable permissions are refused. Existing files
are never overwritten or repaired. There is no force, rotation or deletion command.

### 5. Pair the private chat

Run:

```console
proceed-mcp pair --state-dir <absolute-state-dir>
```

The command prints `Pairing code:` and `Expires at:`. In a private chat with the bot, send `/start`,
then send exactly `/pair <code>` before the expiry. Group chats are refused. `/start` alone grants
nothing. A bot-suffixed or malformed command does not pair. The code is one-use, valid for five
minutes, and is not stored in plaintext.

Only the first pairing succeeds. There is no in-chat re-pair or identity change.

In the candidate, `pair` starts or securely reuses the shared broker. No separate broker terminal
is needed. Issuing a code is not proof that pairing or Telegram delivery has succeeded.

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
          "node",
          "/absolute/path/to/candidate/bin/proceed-mcp.js",
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

This example selects the unreleased candidate by absolute path. Use an absolute Node executable
path too if your client cannot resolve `node`. If using an installed candidate package, start the
`command` array with its `proceed-mcp` executable and keep the same arguments. Do not substitute
the published preview.1 npx command and expect automatic startup.

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

The adapter needs no OpenCode API, password, provider credential, or proprietary session metadata.
It connects only to the local broker. The candidate starts a safely stopped broker or securely reuses
a matching instance. Provisioning is required for cold startup, not reuse of a secure foreground broker.

Startup-dependent calls wait up to 150 seconds for verified local readiness. Your MCP host may
time out sooner. Local readiness does not prove Telegram availability, completed pairing, human
receipt or approval. A startup error is never a human decision.

The server advertises MCP protocol `2025-11-25` and exposes five tools: `prepare_approval`,
`request_approval`, `get_approval`, `cancel_approval`, and `acknowledge_approval`.

## Give your agent the Proceed skill

Install the [Proceed skill](skills/proceed/SKILL.md) so your agent can load the Telegram approval
workflow without you repeating its steps. It covers asking for approval or request-specific
instructions, acknowledging decisions, and retrieving a request after a lost wait.

The skill is reusable instructions, not a new approval mechanism. It does not start the broker,
execute actions, answer native permission prompts, or widen your agent's permissions. Loading it
does not guarantee that every model will follow it correctly.

### Obtain and install the file

The skill comes from the [public repository](https://github.com/renl/proceed-mcp), separately from
the npm runtime. The published `0.1.0-preview.1` package does not contain or install the skill.
Repository README changes do not update that already-published package.

1. In the repository, select a release or commit that contains `skills/proceed/SKILL.md`. Confirm
   the file exists at that revision, open it, and record the full source commit hash. A planning
   commit without the file is not an installation source.
2. Obtain the complete file from that revision, including its YAML frontmatter. Use GitHub's raw
   file view to download it, or copy the file from a checkout of that same revision. Do not save
   the GitHub HTML page as the skill.
3. In the project where you want to use Proceed, inspect any existing destination before replacing
   it. Preserve local changes and resolve any duplicate `proceed` definition intentionally.
4. Create `.opencode/skills/proceed/` in that consuming project and copy the complete file to
   `.opencode/skills/proceed/SKILL.md`. Keep the installed contents identical to your chosen source.

This is a project-local copy, not a global installation. No installer command or companion files
are needed. Keep the directory name `proceed` and the filename `SKILL.md` exactly as shown.

### Discover and explicitly load

OpenCode V2 uses the skill's description to advertise its Telegram approval and instruction use
cases to a permitted agent. Advertising shows the ID and description, not the full instructions.
It does not mean the agent has loaded the skill or will invoke it automatically.

In that consuming project, explicitly load it by including `@proceed` in your prompt:

```text
@proceed Load the Proceed workflow before we use Telegram approval.
```

Where tool-based loading is needed, the agent calls the `skill` tool with the exact, case-sensitive
ID (`id: proceed`):

```json
{ "id": "proceed" }
```

Loading requires the selected agent's permission. Confirm that the returned instructions are the
installed Proceed workflow before continuing. See the [OpenCode V2 skills guide](https://opencode.ai/v2/docs/skills/)
for the discovery and loading contract.

### Try one harmless approval

Starting from empty state? First [install the runtime](#install), then follow
[Set up the broker and Telegram](#set-up-the-broker-and-telegram), including
[adding an owner](#2-add-one-owner), [pairing the private chat](#5-pair-the-private-chat), and
[connecting your MCP client](#6-connect-an-mcp-client). Keep the foreground broker running.
Installing the skill alone does not configure or connect the MCP server.

Once setup is complete, use the installed skill in a new agent session:

```text
@proceed Run a harmless Proceed first-use check. Prepare one request, retain its private authority,
then request approval with a fresh client_request_id, action "Proceed skill first-use check",
context "Test only. No consequential action, shell command, or file modification is authorized.",
and expires_in_seconds 300. Wait for my Telegram decision. Do not perform the proposed action.
If approved, check the matching request_id, acknowledge the returned decision_id, and report a
receipt naming the request_id and outcome without the request_capability.
```

1. Wait for the Telegram question. Preparation alone sends no question.
2. While `request_approval` is still waiting, select **Approve** in the paired private chat.
3. Check that the waiting call returns the prepared `request_id` and `resolution: approved`.
   The agent should acknowledge that same request's returned `decision_id` using
   `acknowledge_approval`, then give a capability-free receipt identifying the request and outcome.
4. Confirm the acknowledgement succeeded. A failed acknowledgement is not confirmed receipt.
   No proposed action, command, or file change should run during this check.

These are expected results to check, not a claim that your installation has been verified.
Rejection, Respond instructions, pending status, expiry, cancellation, and errors are not approval.
For additional manual outcome checks, see [First manual test](#first-manual-test).

### If something is missing

- **Skill absent or wrong instructions loaded:** check the consuming project's path and exact
  `proceed` ID, the frontmatter description, advertising flags, selected agent's skill permission,
  and conflicting definitions. Resolve the intended definition without weakening permissions.
- **Proceed tools absent:** check the [MCP connection](#6-connect-an-mcp-client). A loaded skill
  supplies instructions, not tools. Complete the linked broker, owner, and pairing setup as needed.
- **Setup or tool error:** report the safe diagnostic and use [Common failures](#common-failures).
  Do not claim approval or delivery, or share tokens, credentials, or request capabilities.
- **Waiting call timed out or was lost:** this is not a successful active-wait check. In a later
  authorized turn, retrieve the same request with `get_approval` using its retained `request_id`
  and private `request_capability` under the same transport principal. Do not send a replacement
  question just because the wait ended. Retrieval does not wake or automatically resume the agent.
  If the capability or matching principal is unavailable, report retrieval as blocked. Do not
  recover through credential stores or another session. See [Decisions and delivery](#decisions-and-delivery).

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

## Optional approval example

Use a harmless action. The product never executes it.

1. Connect the MCP client after completing setup. The candidate needs no manual `serve` terminal.
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

Closing the client does not stop the shared broker. Use the stop command below when you want to
stop it explicitly.

## Optional foreground mode

To avoid saving the Telegram token, supply it privately only to the foreground broker's own
`PROCEED_TELEGRAM_BOT_TOKEN` environment from a trusted operator-controlled secret source. Do not
type the token into a command or let the MCP client inherit it. Then run the candidate:

```console
proceed-mcp serve --secure-local --state-dir <absolute-state-dir>
```

Leave that terminal open. Candidate clients reuse this secure broker without a token file.
Alternatively, `serve --telegram-token-file <absolute-file> --state-dir <absolute-state-dir>` runs
secure foreground mode with an already provisioned file. Do not combine a file option with a
nonempty environment token. Without either new option, `serve` retains legacy HTTP/environment
mode for old clients only, not secure reuse by upgraded clients.

A foreground broker without a token can become locally ready but cannot process Telegram approval.
If Telegram rejects the token or reports another consumer, repair the cause, stop the broker and
restart it through the chosen mode.

## Candidate commands

| Command                                              | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `init --state-dir <dir>`                             | Create protected empty state. Refuses to overwrite existing state.              |
| `owner add <id> --label <label> --state-dir <dir>`   | Add an immutable owner and its credential. Requires a stopped broker.           |
| `telegram provision --token-stdin --state-dir <dir>` | Create the separate protected token file from non-TTY stdin.                    |
| `serve --state-dir <dir> [--secure-local]`           | Run foreground environment mode. The flag selects the secure channel.           |
| `pair --state-dir <dir>`                             | Start or reuse the secure broker and obtain a one-use five-minute pairing code. |
| `mcp --owner <id> --state-dir <dir>`                 | Run the stdio adapter and start or reuse the secure shared broker.              |
| `stop --state-dir <dir>`                             | Request an authenticated clean stop and wait up to 30 seconds for confirmation. |
| `status --state-dir <dir> [--request <id>] [--json]` | Show requests, resolution, Telegram and delivery state, and the next action.    |
| `retry <request_id> --state-dir <dir>`               | Report that request retry is unavailable in this preview.                       |

`doctor` is not implemented and fails as an unknown command. The older `origin add` command in the
help output belongs to the retired origin-based configuration and refuses this state. Use owner
mode.

`telegram provision`, `pair`, `mcp` and `serve` accept `--telegram-token-file <absolute-file>`.
For `serve`, this selects secure file mode. `status` does not start a stopped broker. State selection
is `--state-dir`, then `PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`.

Exit codes are `0` for completion, `2` for invalid arguments or configuration, `3` for an unavailable
prerequisite, and `4` for a storage or integrity failure. Diagnostics go to stderr. MCP stdout
carries protocol frames only.

## State, privacy, and shutdown

| Path                                 | Contents                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `config.json`                        | Schema version 2: Telegram token variable name, broker port, owner records.    |
| `credentials/control.token`          | Local control credential for pairing, status, and other control operations.    |
| `credentials/owner.<owner-id>.token` | Per-owner credential for MCP request routes.                                   |
| `journal.log`                        | Append-only transaction journal for durable product state.                     |
| `broker.lock`                        | Running-instance ownership record. Secure mode includes a private channel key. |

The state directory and its files are restricted to the current OS account. `init`, `owner add`, and
`serve` verify that protection and fail rather than continue if it cannot be established. The
Windows check uses an owner-restricted ACL through PowerShell and `icacls`. POSIX uses owner-only
mode bits.

The journal stores request text, response text, pairing identifiers, decisions, timestamps, and
delivery state. Treat the state directory as sensitive local data. Back up a stopped broker's entire
state directory. This preview has no history deletion or compaction.

Request capabilities are stored only as SHA-256 verifiers. The plaintext capability exists in the
tool result and in your retention. Credential and token values are never printed by a command.

The separate Telegram credential file is not part of this state directory. Keep it protected too.
Secure local connections authenticate the broker before sending private request credentials.
Processes able to read protected state can impersonate that local channel. Owner-only protection
does not isolate processes running under the same account.

The broker binds only `127.0.0.1`, requires a credential on every route, and rejects browser origins.
There is no public broker listener and no remote broker hosting.

The automatically started broker survives closing one or all MCP clients. It has no idle-stop timer
and is not a system service or login-startup installation. Survival across logout, reboot or host
process-container shutdown is not promised. Distinct owners can share it. Competing adapters using
the same owner still follow the existing `OWNER_IN_USE` registration rules.

To stop the candidate's secure broker explicitly:

```console
proceed-mcp stop --state-dir <absolute-state-dir>
```

Success prints `Broker stopped.` after confirming shutdown, or reports that no broker is running.
A timeout means stop is unconfirmed, not complete. Foreground secure mode also supports Ctrl+C and
prints `proceed-mcp: broker stopped` after clean shutdown. Pending requests are not cancelled by a
clean stop. Recorded decisions and request identities survive restart under the existing expiry rules.

An already connected adapter does not automatically restart an explicitly stopped broker. Start a
new adapter to make a new startup attempt. There is no periodic restart supervisor.

A clean stop releases the ownership record. If shutdown fails or a process is killed, `broker.lock`
may remain. Preserve the protected state directory and do not delete the lock or journal. Automatic
startup never takes over uncertain ownership or kills an unrelated process. There is no automatic
stale-lock recovery.

## Common failures

- `BROKER_UNAVAILABLE`: check initialized state, owner setup and matching `--state-dir`. For the
  candidate, follow the accompanying startup classification, repair the prerequisite, then start a
  new adapter. For published preview.1, keep its manual `serve` running.
- `TELEGRAM_CREDENTIAL_UNAVAILABLE`: provision the token or select the correct protected file.
  Never put the token in the adapter environment.
- `TELEGRAM_CREDENTIAL_EXISTS`: provisioning is create-only. Choose another dedicated safe
  destination and use its file option consistently. No overwrite is performed.
- `PROTECTION_UNVERIFIED`: use dedicated protected storage or explicitly repair its protection.
  Do not weaken checks or move the token into product state or MCP settings.
- `BROKER_INSTANCE_CONFLICT`: verify the state and port. Stop a conflicting service through its own
  interface. For a legacy broker, use its foreground Ctrl+C, then secure foreground mode or
  provisioned automatic startup. Do not delete its lock.
- `STATE_NOT_OWNED` or `BROKER_STARTUP_TIMEOUT`: preserve state and investigate ownership or the
  startup failure before a new attempt. A timeout does not establish safe cleanup.
- `NOT_PAIRED`: complete `/pair` before creating a request.
- `NOT_FOUND`: wrong owner or state directory, an unused handle, or a request capability that does
  not match.
- `DECISION_MISMATCH`: the request is not terminal, or the `decision_id` does not match.
- Telegram processing stopped: check the bot token privately and confirm no webhook or second poller
  owns the bot. Stop the broker and restart through your chosen mode after repair.

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
