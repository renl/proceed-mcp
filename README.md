# proceed-mcp

Review your MCP agent's approval requests from Telegram or a trusted local harness.

`proceed-mcp` sends an agent's proposed action to your private Telegram chat. Choose Approve,
Reject, or Respond with instructions, and the waiting MCP call receives your decision. Only an
explicit Approve grants approval. The server records the outcome. It does not execute the action.

This guide is for operators connecting a local MCP client to Telegram approval, the preview.3
harness channel, or the private launch-environment startup route.

> **Version status:** `@meshimize/proceed-mcp@0.1.0-preview.3` is published on npm and listed in the
> official MCP Registry. Public npm tags are `latest` = `0.1.0-preview.1` and `preview` =
> `0.1.0-preview.3`, so an unqualified install still resolves to preview.1. Install an exact version,
> as shown under [Install a released version](#install-a-released-version). Preview.3 adds the
> private launch-environment token route and the Windows state and key protection correction
> described below. `0.1.0-preview.2` was the earlier automatic-startup release, and its automatic
> startup uses the protected token file only. Preview.1 requires a manual foreground broker, has no
> automatic startup, and has no harness channel.
>
> A public package and matching installed files prove only that the release was distributed as
> published. The installed runtime is not proven working, and no compatibility guarantee is made
> beyond the limits below. MCP Events, automatic continuation after a timeout, `doctor`, and
> delivery retry remain unavailable.

The [harness channel](#harness-channel-preview2-and-later) is part of `0.1.0-preview.2` and later,
including published preview.3. It is not in preview.1. It describes implemented behavior with the
verification limits below, not live harness behavior or a release-ready result.

Automatic startup in published `0.1.0-preview.3` accepts a token supplied through a private launch
environment as an alternative to the protected token file. On Windows that environment route is the
only supported credential source, because token-file provisioning and loading are refused there.
Supply the token as described under [Environment route](#environment-route).

## Distribution

`@meshimize/proceed-mcp` is the npm package for this product. It installs the `proceed-mcp` command
and its runtime sources. It is not a hosted MCP endpoint, and there is no cloud broker. The MCP
adapter and the broker run on your machine. The broker listens only on `127.0.0.1` and calls
`https://api.telegram.org` for Telegram.

- npm: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)
- MCP Registry: [io.github.renl/proceed-mcp](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.renl%2Fproceed-mcp)

The first public version was `0.1.0-preview.1`. The `latest` npm tag intentionally still resolves to
it, while the `preview` tag resolves to `0.1.0-preview.3`. Pin the exact version rather than relying
on a tag, and check the
[npm package page](https://www.npmjs.com/package/@meshimize/proceed-mcp) before installing.
Publishing automation is planned but not implemented.

## Requirements

- Node.js 24 or newer. `package.json` declares `>=24`.
- One dedicated Telegram bot and one private chat with that bot. Do not share the bot with another
  poller or a webhook.
- The broker and the MCP adapter must run on the same machine. The human may be remote.
- On Windows 10 or 11 desktop, use the standard Node runtime and the inbox Windows PowerShell 5.1
  and `icacls.exe` from `%SystemRoot%\System32`. Dedicated state, control and owner credentials, the
  channel key and the operator key must be owned by your current Windows account on a local fixed
  NTFS volume with persistent ACLs, at drive-qualified absolute local paths. Their complete ACL must
  grant that account only. Parent folders keep their ordinary Windows permissions: read, list,
  traverse and create-only entries for other principals are not refused by themselves, while
  ownership, security-descriptor, delete, replacement and selected-object modification rights there
  stay limited to your account, Windows system, administrators and TrustedInstaller. A create-only
  right on a parent never permits replacing an already protected child, and an ancestor entry whose
  effect cannot be fully interpreted is refused. Network, removable, UNC and device paths, any
  reparse point, alternate data streams and ambiguous metadata are refused. Protection checking uses
  only that system query and `icacls`. The query must resolve from the trusted Windows installation;
  a missing, denied or invalid tool path refuses. The product ships no separate helper executable,
  compiler, code signer or PowerShell test harness for it.
- On POSIX, the state directory must support owner-only mode bits.
- No build tool, native addon, compiler, code signer, or postinstall script is required.

Automated checks for this source are normal JavaScript unit tests that run on Linux. They exercise
the query decoding and the admission decisions, not Windows itself. An earlier attempt to query
Windows volume-root metadata returned the unavailable classification, and that cause is still
unclassified. Native Windows metadata and ACL enforcement, installed-package startup and live
Telegram or TUI first use therefore remain unverified. A public package and matching installed files
prove only that the release was distributed as published. Nothing in this guide establishes working
runtime behavior for that version. Protection and secure-channel checks refuse operation when they
cannot establish the required safety. A refusal leaves the feature refused or disabled. Do not bypass
it, loosen permissions, restore an automatic start outside the product, or delete a preserved
ownership record or state. After an authorized deployment, check ordinary use as
described under [Manual checks after deployment](#manual-checks-after-deployment).

### Manual checks after deployment

These are ordinary-use checks for the owner after an authorized installation. They are not an
interim test gate, and a check that cannot be run stays unverified.

1. Install the exact released version globally, then run `proceed-mcp --help`.
2. Create state and an owner outside the installation path, supply the Telegram token only in the
   launch environment, and pair the private chat.
3. Connect the MCP client and complete one harmless Telegram approval as in
   [Optional approval example](#optional-approval-example).
4. On Windows, run the same check through the launch host with the token only in that host's own
   environment, then complete one harmless TUI decision.
5. Stop the broker or observe a protection refusal, and confirm that state, keys and any preserved
   ownership record were kept rather than repaired.

## Install published preview.1 (manual broker only)

This section covers only the published preview.1 manual-broker behavior. For current preview.3 with
automatic startup, use [Install a released version](#install-a-released-version) below.

Install the exact preview.1 version globally:

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

## Install a released version

The current published release is `0.1.0-preview.3`. Install that exact version with the normal global
npm command:

```console
npm install --global @meshimize/proceed-mcp@0.1.0-preview.3
proceed-mcp --help
```

An unqualified `npm install --global @meshimize/proceed-mcp` follows the npm tags, and `latest`
still resolves to preview.1, so always state the exact version. Check the
[npm package page](https://www.npmjs.com/package/@meshimize/proceed-mcp) before installing.

In published preview.3, the install command does not ask for or store the Telegram token. Supply it
privately at launch as described under [Environment route](#environment-route).

`0.1.0-preview.1` and `0.1.0-preview.2` remain valid historical installs. Preview.1 has the
manual-broker behavior in
[Install published preview.1](#install-published-preview1-manual-broker-only). Preview.2 supports
file-based automatic startup and the harness channel, but not the environment route. Use preview.3
for the environment route and the Windows protection correction; on Windows, the environment route
is the supported one.

This install writes the package into the npm global prefix. Proceed's runtime protection checks
apply to state, keys and credentials when they are used, so they do not block or weaken a normal
global install. npm also places the package's own `proceed-mcp` shim on `PATH`. Do not assume an MCP
host resolves or executes that `.cmd` wrapper. Use the absolute Node entry point below instead.

If the exact version you need is not served by the registry, install a vetted local tarball for it
instead: `npm install --global <path-to-package.tgz>`. That is still an ordinary npm installation,
and `--ignore-scripts` remains optional because these previews need no build or postinstall step.
A public package and matching installed files prove only that the release was distributed as
published. Installed startup and live Telegram or TUI use remain unverified as described under
[Requirements](#requirements).

### Find the installed package root

Ask npm where its global packages live:

```console
npm root --global
```

The package root is `<npm-global-root>/@meshimize/proceed-mcp`, where `<npm-global-root>` is the
directory that command prints. Point both the MCP adapter and the TUI plugin at that same package
root so both run the same installed release. Do not point a durable MCP command or the TUI plugin at
a transient `npx` cache path. `npx` suits the one-off published preview.1 command above, not a
stable package reference.

MCP command array, with the Node entry inside the installed package:

```jsonc
"command": [
  "node",
  "<npm-global-root>/@meshimize/proceed-mcp/bin/proceed-mcp.js",
  "mcp",
  "--owner",
  "<owner-id>",
  "--state-dir",
  "<absolute-state-dir>",
  "--harness-id",
  "local-opencode"
],
```

TUI plugin entry in the global `cli.json`:

```json
{
  "package": "<npm-global-root>/@meshimize/proceed-mcp",
  "options": {
    "state_dir": "<absolute-state-dir>",
    "harness_id": "local-opencode",
    "owner_id": "<owner-id>",
    "operator_key_file": "<absolute-protected-operator-key-file>"
  }
}
```

Replace the placeholders, including the owner ID and state directory, and keep the matching harness
ID. Both values come from the same installed package root, so the adapter and the plugin run the
same release. OpenCode does not expand shell variables inside `opencode.jsonc` or `cli.json`, so
write fully expanded absolute paths. On Windows, escape backslashes or use forward slashes in both
JSON files.

Keep the state directory, the operator key file and any backups outside the npm installation. An
upgrade replaces files under the global prefix, so state or keys placed there could be removed. An
existing installation keeps its current state directory and operator key file when upgrading, and
this guide implies no migration. Keep the operator key file in a dedicated protected directory
outside repositories, product state and MCP configuration, as described under
[Trust and protected operator key](#trust-and-protected-operator-key). If you omit `--state-dir`,
state selection still ends at `<home>/.proceed-mcp` as described under
[Preview.2 and preview.3 commands](#preview2-and-preview3-commands).

### Optional: a versioned prefix for pinned versions

A versioned prefix is optional. Use it only when you want several versions installed side by side
or a pinned rollback target:

```console
npm install --prefix <prefix-directory> --no-save @meshimize/proceed-mcp@<released-version>
```

This is an ordinary npm prefix install, not a custom installer or a separate distribution channel.
The package root is `<prefix-directory>/node_modules/@meshimize/proceed-mcp`, which you reference
from the same two configuration places. `--no-save` leaves saved dependency metadata unchanged, and
`--ignore-scripts` remains optional because these previews require no build or postinstall step. The
installed copy is not a system service, a login-startup item or a reboot-surviving installation, and
it does not start the broker by itself. Use a local directory you control, keep state, keys and
backups outside it, and remove an old prefix only after both integrations reference the new one.

Back up only while the broker is cleanly stopped. Run
`proceed-mcp stop --state-dir <absolute-state-dir>`, wait for the confirmed stop, then copy the
entire state directory into the backup location. An unconfirmed stop or a timeout is not a safe
backup point.

## One-time setup for preview.2 and preview.3

This setup enables automatic broker startup for the current published release,
`0.1.0-preview.3`, and the [harness channel](#harness-channel-preview2-and-later) builds on it.
Preview.3 adds the private launch-environment token route in step 4. Published preview.2 is
historical for this flow and supports only the protected token file for automatic startup.
Use the preview.3 CLI for every step, not the preview.1 command. From the source checkout, replace
`proceed-mcp` in the commands below with `node bin/proceed-mcp.js`. A package installed from a local
build can use its own `proceed-mcp` command. For one installed package root shared by the MCP
adapter and the TUI plugin, see [Install a released version](#install-a-released-version).
The package, lockfile and Registry metadata identify this source tree as `0.1.0-preview.3`.
Publication and MCP Registry listing are separate operations.

### Existing setup: stop the old broker once

Do not run `init` or add an existing owner again. Stop a running legacy HTTP broker with Ctrl+C in
its original foreground terminal and wait for it to exit cleanly. Preserve the state, journal and
pairing. Upgraded `mcp`, `pair`, `status` and `stop` refuse legacy brokers before sending private
credentials. Old clients cannot use the new secure broker.

Then select the credential source in step 4 and connect the preview.3 adapter.
Existing pairing and an existing token file do not need repeating. Alternatively, supply the token
through the launch environment in step 4 or use secure foreground mode below. Those routes need no
saved token file. This stop is one-time. Automatic startup needs no separate broker terminal,
although the environment route still requires the token in each launch terminal.

### 1. Create protected state

Choose an absolute directory that is empty or does not exist yet. Keep it outside the repository and
outside the npm installation, and use the same path from both the MCP adapter and the TUI plugin. On
Windows, use a local fixed NTFS location owned by your account, as described under
[Requirements](#requirements).

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

### 4. Choose a broker credential source

Automatic cold startup in published `0.1.0-preview.3` accepts either a token supplied through a
private launch environment or the existing protected token file. The environment route is not
available in preview.2, which uses the protected token file for automatic startup. Use one
source for each broker start. Selection order is an explicit `--telegram-token-file`, then a nonempty
`PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment, then the default token file. A selected
source that fails does not fall back to a lower-priority one. Reusing a matching healthy secure
broker needs no token source. Selection and validation happen only when the broker must be started,
so an unusable value does not block reuse.

On Windows, only the environment route is supported. Token-file provisioning and loading are refused
with `TELEGRAM_CREDENTIAL_UNSUPPORTED` and CLI exit code 3 before any token input is read or file
content is opened. An explicitly selected `--telegram-token-file` still wins over the environment and
then fails without falling back, so use environment mode with no file option. Published preview.3
therefore offers no persisted token setup on Windows; private launch-environment supply is the
supported source there.

#### Environment route

Supply `PROCEED_TELEGRAM_BOT_TOKEN` privately to the trusted process that starts your MCP host, or
to the process that runs a cold `proceed-mcp mcp` or `pair`, from an
operator-controlled secret source. The product does not persist this value. When the broker must be
started, the value is passed only into that broker's process environment.

Do not put the token value in an MCP host configuration file such as `opencode.jsonc`, an MCP server
`environment` entry, a command argument, a repository file, product state, the journal, logs, tool
output or any chat message. That MCP entry is configuration, not a private launch environment. Do not
paste a token literal into a command you keep in shell history. On Windows, also omit
`--telegram-token-file` from `pair`, `mcp`, `serve` and `telegram provision`; an explicit file
selection wins over the environment and then fails.

Set the variable in the terminal that starts your MCP host, a cold `proceed-mcp mcp`, or
`proceed-mcp pair`, not in configuration. The value stays in that shell process and the processes it
starts. It is not saved user-wide and is not available in a different terminal. Every MCP host uses
the same variable; only the launch command depends on the host.

PowerShell 7 on Windows, with masked input:

```powershell
$secure = Read-Host -AsSecureString 'Telegram bot token'
$env:PROCEED_TELEGRAM_BOT_TOKEN = ConvertFrom-SecureString -SecureString $secure -AsPlainText
Remove-Variable secure
```

`-AsPlainText` requires PowerShell 7; it is not available in Windows PowerShell 5.1. The product's
internal Windows protection query still uses the inbox 5.1 runtime described under
[Requirements](#requirements).

Bash on POSIX, with masked input:

```bash
set +x
if IFS= read -r -s -p 'Telegram bot token: ' PROCEED_TELEGRAM_BOT_TOKEN; then
  printf '\n' >&2
  export PROCEED_TELEGRAM_BOT_TOKEN
fi
```

The typed value does not enter command arguments or shell history. Then start the host or the
Proceed command from that same terminal. Do not replace these prompts with
`PROCEED_TELEGRAM_BOT_TOKEN=<token> <command>` or another literal command, and do not persist the
variable with a user-wide environment setting.

For OpenCode as the current host on the [documented V2 CLI](https://opencode.ai/docs/cli),
`opencode --standalone` starts the TUI with a private server instead of reusing the shared
background service. That private server and the MCP processes it starts receive the launch
environment, so the token reaches the broker. This is a host-specific example; another client starts
its own process from the same terminal. [Enable the integration](#6-connect-an-mcp-client) first if
it is configured but disabled.

Launching plain `opencode` from the token terminal does not update an already running shared service.
The TUI can reconnect to that service, which keeps its original environment and has no token.
`opencode service status` shows whether one is running. Closing a TUI does not stop the shared
service. If you intentionally use the shared service, start it from a process that received the
variable. If it is already running without the token, stop it explicitly with
`opencode service stop`, which affects every local client using it, then start it from the token
terminal with `opencode service start`. Use this only for token inheritance; configuration edits need
no service restart.

The accepted value is 1-4096 bytes of non-whitespace ASCII. An absent or exactly empty value means
no environment source, so the default token file remains available. A nonempty but whitespace-only
or otherwise unusable value is still the selected source and fails startup without trying another:
`TELEGRAM_CREDENTIAL_UNAVAILABLE` with CLI exit code 3, reported as `BROKER_UNAVAILABLE` through
MCP. The failure reports the fixed classification and safe next step, not the value or a raw
environment dump.

Supply the variable again for each new broker start, including after restart, login or reboot. There
is no user-wide persistence, login-startup item, secret manager or `.env` loading. Changing the
parent environment does not change the token of a broker that is already running. To change the
token in use, or to switch to file mode, stop the broker with the documented `stop` command, then
start a replacement that receives the new source. Do not start a second poller or take over
uncertain ownership.

In OpenCode, saving `opencode.jsonc` or `cli.json` reloads configuration. It does not change the
process environment of a running service or broker. A configuration edit needs no service restart; a
token change needs a new launch as described here.

No command prints the token. A successful start reports the broker or pairing state, not the value.
A failed start fails closed with `TELEGRAM_CREDENTIAL_UNAVAILABLE` for a missing or unusable source,
or `TELEGRAM_CREDENTIAL_UNSUPPORTED` for a token-file operation on Windows. Correct the variable in
the launch terminal and start a new attempt. Do not add a diagnostic that prints the environment, do
not copy the value into logs or a report, and do not bypass the check.

The product removes the token before it launches helpers that do not need it, such as the Windows
ACL check. It cannot control an unrelated parent process, other MCP processes that parent starts, or
global environment settings. Treating a value as an environment variable does not make it private,
and this guide makes no same-account isolation claim.

#### Protected file route

Provisioning is optional when the environment route supplies the token. To use the file route, run
provisioning yourself in a trusted local shell, not through an agent or MCP tool. This route is
POSIX-only in this source. On Windows, both provisioning and loading refuse as described above, so
use the environment route. Pipe one token from an operator-controlled secret source into this
command's stdin:

```console
proceed-mcp telegram provision --token-stdin --state-dir <absolute-state-dir>
```

This command alone is not an interactive prompt. It refuses terminal stdin. The source must send
one nonempty ASCII token line, with no whitespace within the token, then close stdin within
60 seconds. Input is limited to 4096 token bytes, optionally followed by LF or CRLF. Never put the
token in command arguments, shell history, exported variables, MCP configuration or tool messages.
Disable shell tracing, transcription and session recording before handling secrets.

For example, in an interactive **Bash** shell, this hidden operator prompt pipes the token using
shell builtins. Replace the state path and use the matching preview.2 or preview.3 CLI as described
above:

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

In preview.2 and preview.3, `pair` starts or securely reuses the shared broker. No separate broker
terminal is needed. Issuing a code is not proof that pairing or Telegram delivery has succeeded.

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
          "/absolute/path/to/proceed-mcp/bin/proceed-mcp.js",
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

If the installed entry has `"disabled": true`, remove it to let the server connect. For the TUI
plugin, remove the `-` prefix from a `-proceed.harness` entry. Saving configuration reloads it.
Enabling an integration does not prove broker startup, Telegram delivery or approval.

This example selects the package by absolute path. For an installed release, use the package root from
[Find the installed package root](#find-the-installed-package-root). Use an absolute Node executable
path too if your client cannot resolve `node`. If you installed the package from a local build, start
the `command` array with its `proceed-mcp` executable and keep the same arguments. Do not substitute
the published preview.1 npx command and expect automatic startup.

With this server name, OpenCode exposes the tools as `proceed_prepare_approval`,
`proceed_request_approval`, `proceed_get_approval`, `proceed_cancel_approval`, and
`proceed_acknowledge_approval`. If you leave Code Mode enabled, OpenCode groups them under
`tools.proceed`.

Do not add `PROCEED_TELEGRAM_BOT_TOKEN` or any token value to the MCP server's `environment` block.
That block is MCP configuration, not a private launch environment. For the
[environment route](#environment-route), set the variable in the launch terminal as described there.
The OpenCode or other MCP host process inherits it, and Proceed passes it only to the broker it
launches. A shared service started without the variable does not gain it later.

#### Other stdio MCP clients

Use this command in any client that can start a local stdio server:

```console
proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

The adapter needs no OpenCode API, password, provider credential, or proprietary session metadata.
It connects only to the local broker. Preview.2 and preview.3 start a safely stopped broker or
securely reuse a matching instance. A protected token file or a private launch environment token is
required for cold startup, not for reuse of a matching secure broker.

Startup-dependent calls wait up to 150 seconds for verified local readiness. Your MCP host may
time out sooner. Local readiness does not prove Telegram availability, completed pairing, human
receipt or approval. A startup error is never a human decision.

The server advertises MCP protocol `2025-11-25` and exposes five tools: `prepare_approval`,
`request_approval`, `get_approval`, `cancel_approval`, and `acknowledge_approval`.

## Harness channel (preview.2 and later)

The client-local TUI path for answering Proceed requests alongside Telegram is available in
`0.1.0-preview.2` and later, including published `0.1.0-preview.3`. It is not in preview.1. The
target is exactly **OpenCode 2.2.5**, with TUI, OpenCode service and broker on the same machine and
OS account. Other versions disable this integration. Remote service operation is not qualified.
Actual product interaction, authority separation, secure transport, concurrent-session routing and
installed setup remain under qualification. These instructions describe implemented harness
behavior, not a runtime verification result, installed-package proof or Windows compatibility claim.

### Trust and protected operator key

Enrolling the local operator adds another authorized decision-maker. The operator need not be the
paired Telegram person. A one-time confirmation in the paired private chat delegates authority to
that operator key. The delegation covers answering individual Proceed requests through that trusted
interaction. It is not a standing approval for other work. Subsequent local decisions need no
per-request Telegram confirmation.

Keep the UI and its installation trusted. The separate operator-managed key file is owner-only,
not encrypted. Same-account processes, administrators or a compromised UI can access its authority.
Ordinary agent text, tool arguments, API reply records and caller-supplied human flags do not make
an agent a human decision-maker. The five agent-facing MCP tools remain unchanged.

Complete the [preview.3 setup](#one-time-setup-for-preview2-and-preview3) using the matching CLI,
including the owner, one broker credential source and private-chat pairing. Preserve
existing state and pairing instead of initializing them again. From the checkout root, generate a new operator key in a
dedicated protected directory outside repositories, broker state and MCP configuration:

```console
node bin/proceed-mcp.js harness keygen --operator-key-file <absolute-protected-operator-key-file> --state-dir <absolute-state-dir>
```

This create-only command refuses an existing destination and reports only its path and public
`key_id` fingerprint. It neither enrolls the key nor approves work. Let the command create the
protected file. Do not copy its contents into arguments, messages, environment variables, host
storage or configuration. The configuration below contains only the file path. Unsafe or
unverifiable protection is refused, not repaired automatically. On Windows, the key file and its
folders are admitted under the same current-account, complete-ACL, reparse and local-volume checks as
the state, so keep it on supported local storage. Those checks are implemented here but not verified
at runtime, as described under [Requirements](#requirements).

### Load the packaged TUI entry from the checkout

In OpenCode's global `cli.json`, merge this entry into `plugins`, preserving unrelated settings.
The file is `~/.config/opencode/cli.json`, or `$XDG_CONFIG_HOME/opencode/cli.json` when set. There
is no project-local `cli.json`. See the [CLI plugin guide](https://opencode.ai/v2/docs/cli/plugins)
and [CLI settings reference](https://opencode.ai/v2/docs/cli/config).

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/development-checkout",
      "options": {
        "state_dir": "/absolute/path/to/proceed-state",
        "harness_id": "local-opencode",
        "owner_id": "<owner-id>",
        "operator_key_file": "/absolute/path/to/protected-operator-keys/operator.key"
      }
    }
  ]
}
```

Replace every path and the owner ID. The package directory's `package.json` exports `./tui` as
`src/harness/tui-entry.js`. OpenCode discovers and loads that packaged entry, not a copied source
file or a server plugin. Load the package path you actually installed; this setup uses the checkout
path. An installed package uses the same package root as the adapter, as described under
[Find the installed package root](#find-the-installed-package-root).
The plugin accepts exactly the four options shown. Both IDs must match `[a-z0-9_-]{1,64}`.
Choose one harness ID for this local OpenCode service installation, not a shared ID across services.

In the [MCP command array](#opencode-v2), keep the absolute development CLI path, owner and state
directory, and add `"--harness-id", "local-opencode"` after the existing arguments. The adapter's
harness ID, owner and state must match the TUI options. Omit `--harness-id` for Telegram-only mode.
The adapter does not load the operator key. Normal MCP startup makes the broker available. The TUI
does not start, stop or repair it. Valid CLI configuration edits reload the TUI plugin.

### Enroll once, then open a session's question

1. Press **Ctrl+E** (`proceed.harness.enroll`) in the genuine TUI. The enrollment display shows the
   harness, owner, this TUI's public fingerprint and the broker fingerprint. A ready toast alone
   does not establish enrollment or approval.
2. For `State: pending`, send exactly `/harness <enrollment_id>` privately to the paired bot before
   the displayed expiry. Compare the chat's scope and fingerprint with the genuine TUI display,
   then choose **Confirm operator key** only for that enrollment. The proposal lasts five minutes.
   Deny or expiry grants no authority. Press Ctrl+E again to observe `State: enrolled`.
3. To answer a pending Proceed request, press **Ctrl+G** (`proceed.harness.open`). First select its
   session by title **and exact session ID**. The integration verifies that session before looking
   up its pending question. Selection alone sends no answer. An unresolvable session or one without
   a pending question produces no decision dialog.
4. The source supplies the request ID, caller label, action, context and deadline in the question
   dialog title. Complete question visibility with the decision controls is still a runtime
   qualification requirement, not asserted proven here. **Reject** is initially highlighted.
   **Respond** and **Approve** are separate choices. Respond opens a text prompt and always records
   instructions, even if the text says "approved". Only an explicit Approve grants approval.

The paired human can revoke the key with `/harness_revoke <key_id>` in the private chat. A different
key cannot replace an active enrollment without revocation. A new enrollment needs paired-chat
confirmation again. Enrollment and revocation do not approve work or erase recorded outcomes.

### Session and decision boundaries

- Telegram and the enrolled TUI address the same durable request. The first valid authorized choice
  accepted before expiry wins once. A losing or stale answer cannot change it or approve later work.
- Tab switches, foreground changes, equal titles and caller-supplied labels never retarget a
  captured question. Reopening requires a fresh exact-session lookup and local choice.
- One unresolved request is allowed per owner/harness/session. Identical replay keeps its identity
  and deadline. A different request receives `SESSION_BUSY`, not a silent queue. Distinct sessions
  can have pending requests concurrently and resolve in either order.
- Escape, dismissal, replacement, expiry and plugin Cleanup never imply approval. Cleanup fences
  late callbacks. Dismissal or TUI exit does not cancel the durable request. Telegram remains usable
  until separate resolution, explicit `cancel_approval` or expiry. Reopening does not resume an
  exited process. A transport error leaves the outcome uncertain until authoritative status is read.
- `harness_channel` reports eligibility, not proof of display, receipt or delivery. The broker
  computes it from the retained request, route enablement and current enrollment, so it does not
  vary by observer. `HOST_NOT_CONFIGURED` calls for matching adapter/TUI configuration,
  `SESSION_ROUTE_UNAVAILABLE` requires supported host session metadata, and `OPERATOR_NOT_ENROLLED`
  calls for enrollment. Missing safe routing never substitutes the foreground session. Telegram
  remains the fallback.
- This channel resolves Proceed requests only. Native permission bridging is a separate future
  outcome. OpenCode's native permissions remain independently effective, and Proceed executes
  nothing. A recorded TUI decision is not confirmed delivery to the original waiting call.

## Give your agent the Proceed skill

Install the [Proceed skill](skills/proceed/SKILL.md) so your agent can load the Telegram approval
workflow without you repeating its steps. It covers asking for approval or request-specific
instructions, acknowledging decisions, and retrieving a request after a lost wait.

The skill is reusable instructions, not a new approval mechanism. It does not start the broker,
execute actions, answer native permission prompts, or widen your agent's permissions. Loading it
does not guarantee that every model will follow it correctly.

### Obtain and install the file

The skill comes from the [public repository](https://github.com/renl/proceed-mcp), separately from
the npm runtime. The package definition does not include the `skills` directory, so installing the
package does not install this skill. Install the skill yourself as described below. Repository
README changes do not update an already-published package.

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

Choose the setup for your runtime before trying the skill:

- **Published preview.1:** [install published preview.1](#install-published-preview1-manual-broker-only)
  and follow that section's manual setup and adapter instructions. Keep its foreground broker
  running.
- **Preview.3 (current):** follow
  [One-time setup for preview.2 and preview.3](#one-time-setup-for-preview2-and-preview3) using the
  preview.3 CLI, not the published preview.1 command. Published preview.3 supports the
  [environment route](#environment-route) and, on POSIX, the
  [protected file route](#protected-file-route) for automatic startup. On Windows the environment
  route is the only supported one. Preview.2 is a historical install that supports only the file
  route. For empty state, complete all six steps, including
  [adding an owner](#2-add-one-owner),
  [choosing a credential source](#4-choose-a-broker-credential-source),
  [pairing the private chat](#5-pair-the-private-chat), and
  [connecting your MCP client](#6-connect-an-mcp-client).
  For existing state, first follow
  [Existing setup: stop the old broker once](#existing-setup-stop-the-old-broker-once).
  After the selected source is available, the matching runtime starts or securely reuses the broker
  without a separate terminal. [Optional foreground mode](#optional-foreground-mode) remains
  available without saving a token file.
  The harness channel is optional here. This skill flow answers through Telegram.

Follow the linked token privacy requirements. Installing the skill alone does not configure or
connect the MCP server or implement automatic startup.

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
For additional manual outcome checks, see [Optional approval example](#optional-approval-example).

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
| `approved`  | An authorized human explicitly approved this request.                     |
| `rejected`  | An authorized human rejected it. This does not authorize the action.      |
| `responded` | An authorized human supplied instructions. This is not approval.          |
| `expired`   | The deadline passed without a decision. This is not approval.             |
| `cancelled` | An authorized caller cancelled the pending request. This is not approval. |

In published preview.1, human decisions come only from the paired Telegram person. Preview.2 and
later add the separately enrolled local operator described above for Proceed requests.

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

MCP Events are unsupported in preview.1, preview.2 and preview.3. There is no automatic resumption
after a timeout and no automatic session reattachment. An approval records an outcome. It does not
execute the action.

`delivery_state` describes reporting, not the decision:

- `not_applicable`: no terminal decision yet.
- `pending`: a decision is recorded but delivery is not confirmed.
- `returned`: the adapter reported writing the result to the original call. Receipt is not confirmed.
- `confirmed`: a request-capability holder acknowledged that decision.
- `unavailable`: automatic delivery is unavailable. Retrieve with the retained capability.
- `blocked`: delivery is blocked. Check `proceed-mcp status`.

## Optional approval example

Use a harmless action. The product never executes it.

1. Connect the MCP client after completing setup. Preview.2 and preview.3 need no manual `serve`
   terminal.
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

To run a foreground broker without a saved token file, supply the token privately only to the
foreground broker's own `PROCEED_TELEGRAM_BOT_TOKEN` environment from a trusted operator-controlled
secret source. The masked input examples under [Environment route](#environment-route) also apply
here. Do not type the token into a command or copy it into MCP configuration. In this route the
adapter needs no token and reuses the running broker. Then run the secure foreground broker:

```console
proceed-mcp serve --secure-local --state-dir <absolute-state-dir>
```

Leave that terminal open. Preview.2 and preview.3 clients reuse this secure broker without a
token file.
On POSIX, `serve --telegram-token-file <absolute-file> --state-dir <absolute-state-dir>` also runs
secure foreground mode with an already provisioned file. Windows refuses that file option; use the
environment form above. Do not combine a file option with a nonempty environment token. Without
either new option, `serve` retains legacy HTTP/environment mode for old clients only, not secure
reuse by upgraded clients.

A foreground broker without a token can become locally ready but cannot process Telegram approval.
If Telegram rejects the token or reports another consumer, repair the cause, stop the broker and
restart it through the chosen mode.

## Preview.2 and preview.3 commands

| Command                                              | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `init --state-dir <dir>`                             | Create protected empty state. Refuses to overwrite existing state.              |
| `owner add <id> --label <label> --state-dir <dir>`   | Add an immutable owner and its credential. Requires a stopped broker.           |
| `telegram provision --token-stdin --state-dir <dir>` | Create the separate protected token file from non-TTY stdin (POSIX only).       |
| `serve --state-dir <dir> [--secure-local]`           | Run foreground environment mode. The flag selects the secure channel.           |
| `pair --state-dir <dir>`                             | Start or reuse the secure broker and obtain a one-use five-minute pairing code. |
| `mcp --owner <id> --state-dir <dir>`                 | Run the stdio adapter and start or reuse the secure shared broker.              |
| `stop --state-dir <dir>`                             | Request an authenticated clean stop and wait up to 30 seconds for confirmation. |
| `status --state-dir <dir> [--request <id>] [--json]` | Show requests, resolution, Telegram and delivery state, and the next action.    |
| `retry <request_id> --state-dir <dir>`               | Report that request retry is unavailable in preview.2 and preview.3.            |

`doctor` is not implemented and fails as an unknown command. The older `origin add` command in the
help output belongs to the retired origin-based configuration and refuses this state. Use owner
mode.

`telegram provision`, `pair`, `mcp` and `serve` accept `--telegram-token-file <absolute-file>`.
For `serve`, this selects secure file mode. In preview.3, for automatic `pair` and `mcp` startup,
an explicit file option wins over a nonempty `PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment,
which wins over the default file. On Windows, every token-file operation refuses, so an explicitly
selected file fails without environment fallback. `status` does not start a stopped broker. State
selection is `--state-dir`, then `PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`.

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

The state directory and its files are restricted to the current OS account. `init`, `owner add`,
`serve` and the automatic startup path verify that protection and fail rather than continue if it
cannot be established. On Windows, admission reads the owner, the complete access-control list, the
reparse attributes, the object type and the volume metadata through the fixed system Windows
PowerShell 5.1 query, then applies the policy in JavaScript. `icacls.exe` is used only to protect a
newly created empty directory. Missing, unavailable or partial metadata refuses with
`PROTECTION_UNAVAILABLE` or `PROTECTION_UNVERIFIED` and is never treated as account-only
protection. POSIX uses owner-only mode bits.

The journal stores request text, response text, pairing identifiers, decisions, timestamps, and
delivery state. Treat the state directory as sensitive local data. Back up a stopped broker's entire
state directory. Preview.2 and preview.3 have no history deletion or compaction.

Request capabilities are stored only as SHA-256 verifiers. The plaintext capability exists in the
tool result and in your retention. Credential and token values are never printed by a command.

The separate Telegram credential file is not part of this state directory. Keep it protected too.
An environment-supplied token is also not part of product state. The product does not persist it,
but the host and broker processes hold it while they run, and the product cannot erase it from a
parent environment. Secure local connections authenticate the broker before sending private request
credentials.
Processes able to read protected state can impersonate that local channel. Owner-only protection
does not isolate processes running under the same account.

The broker binds only `127.0.0.1`, requires a credential on every route, and rejects browser origins.
There is no public broker listener and no remote broker hosting.

The automatically started broker survives closing one or all MCP clients. It has no idle-stop timer
and is not a system service or login-startup installation. Survival across logout, reboot or host
process-container shutdown is not promised. Distinct owners can share it. Competing adapters using
the same owner still follow the existing `OWNER_IN_USE` registration rules.

To stop the secure broker explicitly:

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

- `BROKER_UNAVAILABLE`: check initialized state, owner setup, the selected credential source and
  matching `--state-dir`. For preview.2 and preview.3, follow the accompanying startup
  classification, repair the prerequisite, then start a new adapter. For published preview.1, keep
  its manual `serve` running.
- `TELEGRAM_CREDENTIAL_UNAVAILABLE`: supply the token privately in the next launch environment or
  repair or select the protected token file. The failure prints the classification and a safe next
  step, never the value or an environment dump. Keep the token out of MCP configuration, arguments,
  logs and tool output. A selected source that fails does not fall back to another.
- `TELEGRAM_CREDENTIAL_EXISTS`: provisioning is create-only. Choose another dedicated safe
  destination and use its file option consistently. No overwrite is performed.
- `TELEGRAM_CREDENTIAL_UNSUPPORTED`: a Windows token-file operation was requested. Use the
  environment route with no file option, or secure foreground mode. No token input is read.
- `PROTECTION_UNVERIFIED`: the owner, access-control list, ancestry, volume or path form is unsafe or
  incomplete. Choose a new dedicated local NTFS location owned by your account, or assess the
  existing storage offline. Do not weaken checks, loosen permissions, or move the token into product
  state or MCP settings.
- `PROTECTION_UNAVAILABLE`: the system metadata query or a supported prerequisite is missing, denied,
  timed out or overflowed. Use the supported Windows and Node runtime on local fixed NTFS storage.
  Do not bypass, disable or script around the check.
- `BROKER_INSTANCE_CONFLICT`: verify the state and port. Stop a conflicting service through its own
  interface. For a legacy broker, use its foreground Ctrl+C, then secure foreground mode or a new
  automatic start with the selected credential source. Do not delete its lock.
- `STATE_NOT_OWNED` or `BROKER_STARTUP_TIMEOUT`: preserve state and investigate ownership or the
  startup failure before a new attempt. A timeout does not establish safe cleanup.
- `NOT_PAIRED`: complete `/pair` before creating a request.
- `NOT_FOUND`: wrong owner or state directory, an unused handle, or a request capability that does
  not match.
- `DECISION_MISMATCH`: the request is not terminal, or the `decision_id` does not match.
- Telegram processing stopped: check the bot token privately and confirm no webhook or second poller
  owns the bot. Stop the broker and restart through your chosen mode after repair.

## Limits

- One paired Telegram human and one bot token per broker. Only the first pairing succeeds. There is
  no in-chat identity change or re-pair. The harness channel in preview.2 and preview.3 can
  additionally authorize the enrolled local operator described above, without changing the paired
  Telegram identity.
- One broker per state directory. A separate owner is a separate transport principal, not another
  human or bot.
- No hosted service and no remote broker. The broker is loopback-only.
- A public package and matching installed files prove only that the release was distributed as
  published. Installed runtime behavior, native Windows enforcement and live Telegram or TUI use
  remain unverified.
- MCP Events are unsupported. There is no automatic continuation after a tool timeout, and a timeout
  does not cancel the request.
- Retrieval does not wake an agent and does not create a new decision.
- The product does not execute actions and does not enforce OpenCode's permission rules. Approval is
  cooperative.
- No recovery of an exited MCP client or harness process, and no automatic session reattachment.
- OpenCode V2 is the first validation harness. Other harnesses are not tested. The generic stdio
  command is available, but no multi-harness compatibility is claimed.
- Requires Node.js 24 or newer and the state-directory protections described above.
- Windows supports the environment-token route only. Windows token-file provisioning and loading are
  refused, and an explicitly selected file fails without environment fallback.
- Windows admission is implemented in this source but not verified at runtime. A check that cannot
  establish the required protection refuses, and the affected feature stays refused or disabled.
  There is no bypass, permission loosening or automatic stale-state restore.
- `doctor` is not implemented. `retry` reports unavailable.

## License

MIT, copyright 2026 Ng Cheng Leong. The release package must include the standard MIT `LICENSE`
file at its root.
