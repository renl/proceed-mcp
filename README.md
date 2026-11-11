# proceed-mcp

Review your MCP agent's approval requests from Telegram or a trusted local harness.

`proceed-mcp` sends an agent's proposed action to your private Telegram chat. Choose Approve,
Reject, or Respond with instructions, and the waiting MCP call receives your decision. Only an
explicit Approve grants approval. The server records the outcome. It does not execute the action.

This guide is for operators installing the npm package, provisioning one private Telegram credential,
and connecting a local MCP client. OpenCode V2 appears only as the first tested harness example. The
same state, credential selection and pairing work with any local stdio MCP client.

> **Version status:** `@meshimize/proceed-mcp@0.1.0-preview.1` is published on npm and listed in the
> official MCP Registry. It requires a manual foreground broker, does **not** include automatic
> startup, and has no harness channel. `0.1.0-preview.2` is published with automatic startup and the
> harness channel, but its automatic startup uses the protected token file only. `0.1.0-preview.3`
> is published with the private launch-environment token route and the Windows state and key
> protection correction. On Windows, published preview.3 supports only that environment route.
>
> This source is prepared as `0.1.0-preview.4` for release. Availability of that exact version
> depends on the npm registry. It adds Proceed-owned, explicitly invoked private credential setup
> and supported Windows credential file persistence, described below. A recent public metadata
> reading reported `latest` = 0.1.0-preview.1 and `preview` = 0.1.0-preview.3, so an unqualified
> install resolves to preview.1. Check the npm package page for the versions currently served, and
> install an exact version. MCP Events, automatic continuation after a timeout, `doctor`, and
> delivery retry remain unavailable.

The instructions in this repository describe the `0.1.0-preview.4` source with the verification
limits below. They are not proof that the version is published, installed, or working at runtime.

The [harness channel](#harness-channel-preview2-and-later) is part of `0.1.0-preview.2` and later,
including this source. It is not in the published preview.1 package. It describes source behavior
with the verification limits below, not live harness behavior or a release-ready result.

Automatic startup accepts either the separately provisioned protected token file or a token supplied
through a private launch environment, as described under
[One-time setup](#one-time-setup-preview2-and-later). In this source both routes work on Windows and
POSIX storage that meets the documented protection requirements. The environment route remains a
supported alternative, and the provisioned file is the one-time setup this guide recommends.

## Distribution

`@meshimize/proceed-mcp` is the npm package for this product. It installs the `proceed-mcp` command
and its runtime sources. It is not a hosted MCP endpoint, and there is no cloud broker. The MCP
adapter and the broker run on your machine. The broker listens only on `127.0.0.1` and calls
`https://api.telegram.org` for Telegram.

- npm: [@meshimize/proceed-mcp](https://www.npmjs.com/package/@meshimize/proceed-mcp)
- MCP Registry: [io.github.renl/proceed-mcp](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.renl%2Fproceed-mcp)

The first public version is `0.1.0-preview.1`. The `latest` npm tag still resolves to it, while the
`preview` tag resolves to the newest published preview, `0.1.0-preview.3` in the metadata reading
above. Pin the exact version rather than relying on a tag, and check the
[npm package page](https://www.npmjs.com/package/@meshimize/proceed-mcp) for what the registry
currently serves before installing. `@0.1.0-preview.4` is a valid npm spec only when that exact
version is served. Publishing automation is planned but not implemented.

## Requirements

- Node.js 24 or newer. `package.json` declares `>=24`.
- One dedicated Telegram bot and one private chat with that bot. Do not share the bot with another
  poller or a webhook.
- The broker and the MCP adapter must run on the same machine. The human may be remote.
- On Windows 10 or 11 desktop, use the standard Node runtime and the inbox Windows PowerShell 5.1
  and `icacls.exe` from `%SystemRoot%\System32`. Dedicated state, control and owner credentials, the
  channel key, the operator key and the provisioned Telegram credential must be owned by your
  current Windows account on a local fixed NTFS volume with persistent ACLs, at drive-qualified
  absolute local paths. Their complete ACL must grant that account only. Parent folders keep their
  ordinary Windows permissions: read, list, traverse and create-only entries for other principals
  are not refused by themselves, while ownership, security-descriptor, delete, replacement and
  selected-object modification rights there stay limited to your account, Windows system,
  administrators and TrustedInstaller. A dedicated credential directory must also pass
  current-account-only full access to the files and directories inherited below it. An ordinary home
  default may not meet that requirement, and unsafe or unverifiable storage is refused rather than
  repaired. A create-only right on a parent never permits replacing an already protected child, and
  an ancestor entry whose effect cannot be fully interpreted is refused. Network, removable, UNC and
  device paths, any reparse point, alternate data streams and ambiguous metadata are refused.
  Protection checking uses only that system query and `icacls`. The query must resolve from the
  trusted Windows installation; a missing, denied or invalid tool path refuses. The product ships no
  separate helper executable, compiler, code signer or PowerShell test harness for it.
- On POSIX, the state directory must support owner-only mode bits.
- No build tool, native addon, compiler, code signer, or postinstall script is required.

Automated checks for this source are normal JavaScript unit tests that run on Linux. They exercise
the query decoding and the admission decisions, not Windows itself. An earlier attempt to query
Windows volume-root metadata returned the unavailable classification, and that cause is still
unclassified. Native Windows metadata and ACL enforcement, hidden interactive token input,
installed-package startup and live Telegram or TUI first use therefore remain unverified. Nothing in
this guide establishes publication, installation or working runtime behavior for that version.
Protection and secure-channel checks refuse operation when they cannot establish the required
safety. A refusal leaves the feature refused or disabled. Do not bypass it, loosen permissions,
restore an automatic start outside the product, or delete a preserved ownership record or state.
After an authorized deployment, check ordinary use as described under
[Manual checks after deployment](#manual-checks-after-deployment).

### Manual checks after deployment

These are ordinary-use checks for the owner after an authorized installation. They are not an
interim test gate, and a check that cannot be run stays unverified.

1. Install the exact released version globally, then run `proceed-mcp --help`.
2. Create state and an owner outside the installation path, provision the Telegram token privately
   with the installed Proceed command, pair the private chat, then confirm that a later launch needs
   no token in the harness environment or configuration.
3. Connect the MCP client and complete one harmless Telegram approval as in
   [Optional approval example](#optional-approval-example).
4. On Windows, run the same check through the launch host with no Telegram token in that host's
   environment or configuration, then complete one harmless TUI decision.
5. Stop the broker or observe a protection refusal, and confirm that state, keys and any preserved
   ownership record were kept rather than repaired.

## Install published preview.1 (manual broker only)

This section covers only the published preview.1 manual-broker behavior. For a preview.2 or later
package or source with automatic startup, use [Install a released version](#install-a-released-version)
below.

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

Keep both broker and adapter on preview.1 for this legacy HTTP mode. Proceed-owned provisioning,
`--secure-local`, `--telegram-token-file` and `stop` are not available in preview.1.

## Install a released version

Install the exact version you intend to run with the normal global npm command:

```console
npm install --global @meshimize/proceed-mcp@<exact-version>
proceed-mcp --help
```

This guide ships with the `0.1.0-preview.4` source. Use `@0.1.0-preview.4` when the registry
serves that exact version. Otherwise install the newest exact preview the registry does serve and
use that version's instructions. An unqualified install follows the npm tags, and `latest` still
resolves to preview.1, so always state the exact version. Check the
[npm package page](https://www.npmjs.com/package/@meshimize/proceed-mcp) before installing.

Installation never asks for or stores the Telegram token and runs no credential-setup hook. In this
source, credential setup is the separate explicit `telegram provision` step described under
[One-time setup](#one-time-setup-preview2-and-later). No npm lifecycle hook, custom installer, `.env`
loader, secret manager, wrapper or separate helper participates.

`0.1.0-preview.3` remains a valid historical install with the private launch-environment token route
and the Windows protection correction. On Windows it supports only that environment route and
refuses token-file provisioning and loading. `0.1.0-preview.2` supports file-based automatic startup
and the harness channel, but not the environment route. `0.1.0-preview.1` has the manual-broker
behavior in [Install published preview.1](#install-published-preview1-manual-broker-only).

This install writes the package into the npm global prefix. Proceed's runtime protection checks
apply to state, keys and credentials when they are used, so they do not block or weaken a normal
global install. npm also places the package's own `proceed-mcp` shim on `PATH`. Do not assume an MCP
host resolves or executes that `.cmd` wrapper. Use the absolute Node entry point below instead.

If the exact version you need is not served by the registry, install a vetted local tarball for it
instead: `npm install --global <path-to-package.tgz>`. That is still an ordinary npm installation,
and `--ignore-scripts` remains optional because these previews need no build or postinstall step.

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

Keep the state directory, the operator key file, the provisioned Telegram credential and any backups
outside the npm installation. An upgrade replaces files under the global prefix, so state, keys or
credentials placed there could be removed. An existing installation keeps its current state
directory, operator key file and provisioned Telegram credential when upgrading, and this guide
implies no migration. Provisioning is create-only, so an existing credential file is refused rather
than overwritten and needs no replacement. Keep the operator key file in a dedicated protected
directory outside repositories, product state and MCP configuration, as described under
[Trust and protected operator key](#trust-and-protected-operator-key). If you omit `--state-dir`,
state selection still ends at `<home>/.proceed-mcp` as described under
[CLI commands](#cli-commands-preview2-and-later).

### Optional: a versioned prefix for pinned versions

A versioned prefix is optional. Use it only when you want several versions installed side by side
or a pinned rollback target:

```console
npm install --prefix <prefix-directory> --no-save @meshimize/proceed-mcp@<exact-version>
```

This is an ordinary npm prefix install, not a custom installer or a separate distribution channel.
The package root is `<prefix-directory>/node_modules/@meshimize/proceed-mcp`, which you reference
from the same two configuration places. `--no-save` leaves saved dependency metadata unchanged, and
`--ignore-scripts` remains optional because these previews require no build or postinstall step. The
installed copy is not a system service, a login-startup item or a reboot-surviving installation, and
it does not start the broker by itself. Use a local directory you control, keep state, keys,
credentials and backups outside it, and remove an old prefix only after both integrations reference
the new one.

Back up only while the broker is cleanly stopped. Run
`proceed-mcp stop --state-dir <absolute-state-dir>`, wait for the confirmed stop, then copy the
entire state directory into the backup location. An unconfirmed stop or a timeout is not a safe
backup point.

## One-time setup (preview.2 and later)

This setup enables automatic broker startup without a Telegram token in the MCP client environment
or configuration, and the [harness channel](#harness-channel-preview2-and-later) builds on it. In
this source it includes Proceed-owned private credential provisioning on supported Windows and POSIX
storage.

- **`0.1.0-preview.4` (this source):** hidden interactive
  `telegram provision`, plus the protected token file or the environment route. Use the flow below.
- **`0.1.0-preview.3` (published):** the same flow without interactive provisioning. On Windows only
  the [environment route](#environment-route-alternative) is supported, and token-file provisioning
  and loading are refused there.
- **`0.1.0-preview.2` (published):** protected token file only for automatic startup, provisioned
  through the nonterminal `--token-stdin` route. The environment route and Windows file support are
  not available.

Use the CLI of the version you installed, not the preview.1 command. From the source checkout,
replace `proceed-mcp` in the commands below with `node bin/proceed-mcp.js`. A package installed from
a local build can use its own `proceed-mcp` command. For one installed package root shared by the
MCP adapter and an optional harness plugin, see
[Install a released version](#install-a-released-version).
The package and lockfile are prepared for the `0.1.0-preview.4` release. Check the npm package page
for exact availability. Publication and MCP Registry listing are separate operations.

### Existing setup: stop the old broker once

Do not run `init` or add an existing owner again. Stop a running legacy HTTP broker with Ctrl+C in
its original foreground terminal and wait for it to exit cleanly. Preserve the state, journal and
pairing. Upgraded `mcp`, `pair`, `status` and `stop` refuse legacy brokers before sending private
credentials. Old clients cannot use the new secure broker.

Then select the credential source in step 4 and connect the adapter for the version you installed.
Existing pairing and an existing provisioned credential file do not need repeating, and provisioning
never overwrites the file. Alternatively, supply the token through the launch environment in step 4
or use secure foreground mode below. Those routes need no saved token file. This is a one-time
stop/restart, not a recurring terminal requirement for automatic startup.

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

### 4. Provision the broker credential source

The file route is the recommended one-time setup: provision the token once with installed Proceed,
then start the broker normally without a token in the harness environment or configuration. The
environment route in this section remains a supported alternative. The published preview.3 release
supports only that environment route on Windows.

Selection order applies only when the broker must be started: an explicit `--telegram-token-file`,
then a nonempty `PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment, then the default credential
file. A selected source that fails does not fall back to a lower-priority one. Reusing a matching
healthy secure broker needs no token source, and selection or validation happens only when a start
is required, so an unusable value does not block reuse.

#### Provision once with Proceed

Run this yourself in a trusted, unrecorded terminal, not through an agent or MCP tool:

```console
proceed-mcp telegram provision --state-dir <absolute-state-dir>
```

The command validates its arguments, the initialized state, destination separation and protection,
and the absence of an existing destination before it reads any secret. It then disables terminal
echo, writes one fixed prompt, and accepts one token submitted with Enter. Backspace removes the
previous entered byte without displaying it. The token is never echoed, and no masking character,
token length or fragment is printed. Success prints only the credential path and storage guidance.
The accepted value is 1-4096 bytes of non-whitespace ASCII, and the prompt exchange is bounded to 60
seconds.

The default location is `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`. The key is
derived from the canonical absolute state path, so keep that state path stable. On POSIX the
credential directory is mode 0700 and the file mode 0600. This file stays outside the npm package
and prefix directories, product state, repositories and MCP configuration, and a package upgrade
neither moves nor deletes it. Only the broker reads it. The MCP adapter, harness plugin and
readiness checks receive the path, not the value.

On Windows the file route is supported under the same protection rules as state and keys: a
dedicated parent on a local fixed NTFS volume, owned by your account, granting that account only and
passing current-account-only full access to the files and directories inherited below it. An
ordinary home default may not qualify. An existing parent and its inheritance are admitted before
the prompt, unsafe or unverifiable storage is refused rather than repaired, and no credential is
written when a check fails. Choose a suitable parent or an explicit path.

For another dedicated location, add `--telegram-token-file <absolute-file>` to provisioning and
repeat the same option for `pair`, `mcp` and `serve`. Keep it outside every repository, product
state, npm installation and known MCP configuration directory, on a local path that is not
redirected, not a reparse point, and not network or removable storage. Existing files are never
overwritten or repaired. There is no force, rotation or deletion command.

Provisioning outcomes:

- Ctrl+C cancels input. EOF before submission, an unfinished 60-second deadline, invalid input, or
  no interactive terminal without `--token-stdin` writes no credential and is `INVALID_ARGUMENT`
  (exit 2). A terminal that cannot establish hidden input is `PREREQUISITE_UNAVAILABLE` (exit 3)
  with the `--token-stdin` alternative named. Proceed never falls back to echoed input.
- An existing destination is refused with `TELEGRAM_CREDENTIAL_EXISTS` (exit 2). It is not opened,
  compared, overwritten or rotated, so choose another dedicated destination.
- Missing initialized state is `STATE_NOT_INITIALIZED` (exit 3). Unsafe or unverifiable storage,
  separation or file identity is `PROTECTION_UNVERIFIED` (exit 4), and an unavailable protection
  query is `PROTECTION_UNAVAILABLE` (exit 4). No failure prints the token, an environment dump or raw
  child output.

Provisioning does not contact Telegram, start the broker or pair anyone, and success is not proof of
Telegram validity, pairing, delivery or approval. The file is not encrypted. Other processes using
the same OS account, administrators and backups can read it.

For a noninteractive source, `--token-stdin` preserves the earlier route. It refuses terminal stdin,
reads one nonempty ASCII token line that reaches EOF within 60 seconds, accepts at most 4098 input
bytes, and stores exactly one token plus LF. For example, this hidden prompt in an interactive
**Bash** shell pipes the token using shell builtins:

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
only the token line to the command's stdin. Disable shell tracing, transcription and session
recording before handling secrets.

Never put the token in a command argument, MCP configuration including a JSON `environment` entry,
an exported or user-wide environment setting, a repository file, product state, the journal, logs or
tool output. This project adds no `.env` loading, npm hook, secret-store integration, wrapper or
native helper, and there is no user-wide persistence, login-startup item or reboot-surviving
service.

#### Environment route (alternative)

Supply `PROCEED_TELEGRAM_BOT_TOKEN` privately to the trusted process that starts your MCP host, or
to the process that runs a cold `proceed-mcp mcp` or `pair`, from an operator-controlled secret
source. The product does not persist this value. When the broker must be started, the value is
passed only into that broker's process environment.

Do not put the token value in `opencode.jsonc`, an MCP server `environment` entry, a command
argument, a repository file, product state, the journal, logs or tool output. That MCP entry is
configuration, not a private launch environment. Do not paste a token literal into a command you
keep in shell history. On Windows, also omit `--telegram-token-file` from `pair`, `mcp`, `serve` and
`telegram provision` unless you deliberately select the file route.

The accepted value is 1-4096 bytes of non-whitespace ASCII. An absent or exactly empty value means
no environment source, so the default token file remains available. A nonempty but whitespace-only
or otherwise unusable value is still the selected source and fails startup without trying another:
`TELEGRAM_CREDENTIAL_UNAVAILABLE` with CLI exit code 3, reported as `BROKER_UNAVAILABLE` through
MCP. The failure reports the fixed classification and safe next step, not the value or a raw
environment dump.

Set the variable in the terminal that starts the host, then start the host or the Proceed command
from that same terminal. The value stays in that shell process and the processes it starts. It is
not saved user-wide and is not available in a different terminal. Any MCP host uses the same
variable; only the launch command depends on the host. OpenCode is one optional example: start it
with a private server so the MCP processes inherit that launch environment. Launching it from an
already running shared service does not update that service's environment, so a service started
without the token does not gain it later.

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

The typed value does not enter command arguments or shell history. Do not replace these prompts with
`PROCEED_TELEGRAM_BOT_TOKEN=<token> <command>` or another literal command, and do not persist the
variable with a user-wide environment setting.

Supply the variable again for each new broker start, including after restart, login or reboot. There
is no user-wide persistence, login-startup item, secret manager or `.env` loading. Changing the
parent environment does not change the token of a broker that is already running. To change the
token in use, or to switch to file mode, stop the broker with the documented `stop` command, then
start a replacement that receives the new source. Do not start a second poller or take over
uncertain ownership. In an MCP host, saving configuration reloads it but does not change the process
environment of a running service or broker.

The product removes the token before it launches helpers that do not need it, such as the Windows
ACL check. It cannot control an unrelated parent process, other MCP processes that parent starts, or
global environment settings. Treating a value as an environment variable does not make it private,
and this guide makes no same-account isolation claim.

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

In preview.2 and later, `pair` starts or securely reuses the shared broker, so no separate broker
terminal is needed. With a provisioned credential or a supplied environment token as in step 4, the
broker starts without further token handling. Issuing a code is not proof that pairing or Telegram
delivery has succeeded.

### 6. Connect an MCP client

Any local stdio MCP client can start the adapter. The first example uses OpenCode V2, the only
harness tested so far; other clients use the generic command below.

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
That block is MCP configuration, not private credential storage. After `telegram provision`, no token
is needed in the harness environment or configuration at all: the adapter passes the credential path
and only broker startup loads the token. For the
[environment route](#environment-route-alternative), the host inherits the variable from the trusted
terminal that starts it, and Proceed passes it only to the broker it launches.

#### Other stdio MCP clients

Use this command in any client that can start a local stdio server:

```console
proceed-mcp mcp --owner <owner-id> --state-dir <absolute-state-dir>
```

The adapter needs no OpenCode API, password, provider credential, or proprietary session metadata.
It connects only to the local broker. Preview.2 and later start a safely stopped broker or securely
reuse a matching instance. A provisioned credential file or a private launch environment token is
required for cold startup, not for reuse of a matching secure broker. In this source the provisioned
default file needs no token in the client's environment or configuration.

Startup-dependent calls wait up to 150 seconds for verified local readiness. Your MCP host may
time out sooner. Local readiness does not prove Telegram availability, completed pairing, human
receipt or approval. A startup error is never a human decision.

The server advertises MCP protocol `2025-11-25` and exposes five tools: `prepare_approval`,
`request_approval`, `get_approval`, `cancel_approval`, and `acknowledge_approval`.

## Harness channel (preview.2 and later)

Version `0.1.0-preview.2` adds a client-local TUI path for answering Proceed requests alongside
Telegram. It is not in the published preview.1 package. The target is exactly **OpenCode 2.2.5**,
with TUI, OpenCode service and broker on the same machine and OS account. Other versions disable this
integration. Remote service operation is not qualified. Actual product interaction, authority
separation, secure transport, concurrent-session routing and installed setup remain under
qualification. These instructions describe the harness behavior in preview.2 and later, including
this source, not a runtime verification result, installed-package proof or Windows compatibility
claim.

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

Complete the [One-time setup](#one-time-setup-preview2-and-later) using the matching CLI, including
the owner, one broker credential source and private-chat pairing. Preserve existing state and
pairing instead of initializing them again. From the checkout root, generate a new operator key in a
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
- **This source, `0.1.0-preview.4`:** follow
  [One-time setup](#one-time-setup-preview2-and-later) using the preview.4 CLI, not the published
  preview.1 command, and include
  [private provisioning](#4-provision-the-broker-credential-source) on supported Windows or POSIX
  storage. After setup, a fresh harness launch needs no token in its environment or configuration.
- **Published preview.3:** the same six steps without interactive provisioning. On POSIX you can
  provision the file with the `--token-stdin` route. On Windows only the
  [environment route](#environment-route-alternative) is supported, and token-file provisioning and
  loading are refused.
- **Published preview.2:** protected token file only for automatic startup, provisioned with
  `--token-stdin`. The environment route and Windows file support are not available.

For empty state, complete all six steps, including
[adding an owner](#2-add-one-owner),
[provisioning a credential source](#4-provision-the-broker-credential-source),
[pairing the private chat](#5-pair-the-private-chat), and
[connecting your MCP client](#6-connect-an-mcp-client).
For existing state, first follow
[Existing setup: stop the old broker once](#existing-setup-stop-the-old-broker-once).
After the selected source is available, the matching runtime starts or securely reuses the broker
without a separate terminal. [Optional foreground mode](#optional-foreground-mode) remains
available without a provisioned credential file. The harness channel is optional here. This skill
flow answers through Telegram.

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

MCP Events are unsupported in preview.1, preview.2, preview.3 and this preview.4 source. There is no
automatic resumption after a timeout and no automatic session reattachment. An approval records an
outcome. It does not execute the action.

`delivery_state` describes reporting, not the decision:

- `not_applicable`: no terminal decision yet.
- `pending`: a decision is recorded but delivery is not confirmed.
- `returned`: the adapter reported writing the result to the original call. Receipt is not confirmed.
- `confirmed`: a request-capability holder acknowledged that decision.
- `unavailable`: automatic delivery is unavailable. Retrieve with the retained capability.
- `blocked`: delivery is blocked. Check `proceed-mcp status`.

## Optional approval example

Use a harmless action. The product never executes it.

1. Connect the MCP client after completing setup. Preview.2 and later need no manual `serve`
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

To run a foreground broker without a provisioned credential file, supply the token privately only to
the foreground broker's own `PROCEED_TELEGRAM_BOT_TOKEN` environment from a trusted
operator-controlled secret source. Do not type the token into a command or copy it into MCP
configuration. In this route the adapter needs no token and reuses the running broker. Then run the
secure foreground broker:

```console
proceed-mcp serve --secure-local --state-dir <absolute-state-dir>
```

Leave that terminal open. Preview.2 and later clients reuse this secure broker without a token
source. `serve --telegram-token-file <absolute-file> --state-dir <absolute-state-dir>` also runs
secure foreground mode with an already provisioned file, on Windows as well when the file meets the
documented storage rules. Do not combine a file option with a nonempty environment token. Without
either new option, `serve` retains legacy HTTP/environment mode for old clients only, not secure
reuse by upgraded clients.

A foreground broker without a token can become locally ready but cannot process Telegram approval.
If Telegram rejects the token or reports another consumer, repair the cause, stop the broker and
restart it through the chosen mode.

## CLI commands (preview.2 and later)

| Command                                                                                 | Purpose                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `init --state-dir <dir>`                                                                | Create protected empty state. Refuses to overwrite existing state.                       |
| `owner add <id> --label <label> --state-dir <dir>`                                      | Add an immutable owner and its credential. Requires a stopped broker.                    |
| `telegram provision [--token-stdin] [--telegram-token-file <file>] --state-dir <dir>`   | Read one token privately and create the separate protected credential file. Create-only. |
| `serve --state-dir <dir> [--secure-local] [--telegram-token-file <file>]`               | Run the foreground broker. A secure flag or token file selects the secure channel.       |
| `pair --state-dir <dir> [--telegram-token-file <file>]`                                 | Start or reuse the secure broker and obtain a one-use five-minute pairing code.          |
| `mcp --owner <id> [--harness-id <id>] --state-dir <dir> [--telegram-token-file <file>]` | Run the stdio adapter and start or reuse the secure shared broker.                       |
| `stop --state-dir <dir>`                                                                | Request an authenticated clean stop and wait up to 30 seconds for confirmation.          |
| `status --state-dir <dir> [--request <id>] [--json]`                                    | Show requests, resolution, Telegram and delivery state, and the next action.             |
| `retry <request_id> --state-dir <dir>`                                                  | Report that request retry is unavailable in preview.2 and later.                         |

`doctor` is not implemented and fails as an unknown command. The older `origin add` command in the
help output belongs to the retired origin-based configuration and refuses this state. Use owner
mode.

`telegram provision`, `pair`, `mcp` and `serve` accept `--telegram-token-file <absolute-file>`.
For `serve`, this selects secure file mode. For automatic `pair` and `mcp` startup, an explicit file
option wins over a nonempty `PROCEED_TELEGRAM_BOT_TOKEN` in the launch environment, which wins over
the default file. On Windows, provisioning and loading require the safe account-only storage
described under [Requirements](#requirements); unsafe or unverifiable storage refuses without ACL
repair and without writing a credential, and an explicitly selected file still fails without
environment fallback. `status` does not start a stopped broker. State selection is `--state-dir`,
then `PROCEED_STATE_DIR`, then `<home>/.proceed-mcp`.

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
`telegram provision`, `serve` and the automatic startup path verify that protection and fail rather
than continue if it cannot be established. On Windows, admission reads the owner, the complete
access-control list, the reparse attributes, the object type and the volume metadata through the
fixed system Windows PowerShell 5.1 query, then applies the policy in JavaScript. `icacls.exe` is
used only to protect a newly created empty directory. Missing, unavailable or partial metadata
refuses with `PROTECTION_UNAVAILABLE` or `PROTECTION_UNVERIFIED` and is never treated as account-only
protection. POSIX uses owner-only mode bits.

The journal stores request text, response text, pairing identifiers, decisions, timestamps, and
delivery state. Treat the state directory as sensitive local data. Back up a stopped broker's entire
state directory. Preview.2 and later have no history deletion or compaction.

Request capabilities are stored only as SHA-256 verifiers. The plaintext capability exists in the
tool result and in your retention. Credential and token values are never printed by a command.

The separate Telegram credential file is not part of this state directory. `telegram provision`
creates it once under the protection above, and a package upgrade preserves it in place. An
environment-supplied token is also not part of product state. The product does not persist it, but
the host and broker processes hold it while they run, and the product cannot erase it from a parent
environment. Secure local connections authenticate the broker before sending private request
credentials. Processes able to read protected state can impersonate that local channel. Owner-only
protection does not isolate processes running under the same account.

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
  matching `--state-dir`. For preview.2 and later, follow the accompanying startup classification,
  repair the prerequisite, then start a new adapter. For published preview.1, keep its manual
  `serve` running.
- `TELEGRAM_CREDENTIAL_UNAVAILABLE`: supply the token privately in the next launch environment or
  provision, repair or select the protected token file. Keep it out of MCP configuration,
  arguments, logs and tool output. A selected source that fails does not fall back to another.
- `TELEGRAM_CREDENTIAL_EXISTS`: provisioning is create-only. Choose another dedicated safe
  destination and use its file option consistently. No overwrite is performed.
- `INVALID_ARGUMENT` during provisioning: input was cancelled, ended before submission, passed the
  60-second deadline, was invalid, or no interactive terminal was available. No credential was
  written. Retry in a trusted unrecorded terminal, or use `--token-stdin` from a trusted
  nonterminal source. Proceed never falls back to echoed input.
- `PREREQUISITE_UNAVAILABLE`: private terminal input could not be established. Use a trusted
  unrecorded terminal or the explicit `--token-stdin` route. No token is read without it.
- `STATE_NOT_INITIALIZED`: create protected state with `init` before provisioning or starting a
  broker.
- `PROTECTION_UNVERIFIED`: the owner, access-control list, inheritance, ancestry, volume, separation
  or path form is unsafe or incomplete. Choose a new dedicated local location owned by your account,
  outside repositories, product state, npm installation and MCP configuration, or assess the
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
  no in-chat identity change or re-pair. The harness channel in preview.2 and later can additionally
  authorize the enrolled local operator described above, without changing the paired Telegram
  identity.
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
- Provisioning is create-only. There is no overwrite, rotation, migration or deletion command, and
  an existing credential file must be reused. Replacing it means selecting a new dedicated
  destination and repeating that path consistently.
- Windows supports both credential routes under the documented storage envelope. Unsafe or
  unverifiable storage, including an ordinary home default without the required inheritance, is
  refused without writing a credential or releasing secret content and is never repaired
  automatically.
- Windows admission and hidden interactive input are implemented in this source but not verified at
  runtime. A check that cannot establish the required protection refuses, and the affected feature
  stays refused or disabled. There is no bypass, permission loosening or automatic stale-state
  restore.
- `doctor` is not implemented. `retry` reports unavailable.

## License

MIT, copyright 2026 Ng Cheng Leong. The release package must include the standard MIT `LICENSE`
file at its root.
