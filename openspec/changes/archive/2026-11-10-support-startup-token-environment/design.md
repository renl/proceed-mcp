# Design

Extend the existing detached broker startup with a private environment-token source, without another launcher or persistence mechanism.

## Context

Motivation and acceptance are in [proposal.md](proposal.md) and the [product delta](specs/opencode-session-continuation/spec.md). This change targets merged `main` independently. It does not depend on, inherit contracts from, or repair the active Windows protection change.

Source facts at planning baseline `df2c8d0958676ba8465db8959d6299bd278125e0`:

| Source | Existing behavior relevant to this change |
| --- | --- |
| `src/config/portable-config.js` | `TELEGRAM_TOKEN_ENV` is `PROCEED_TELEGRAM_BOT_TOKEN`. No configurable token-variable selector exists. |
| `src/cli/main.js` | `runMcp` and `runPair` always launch with an explicit/default file path. `runServe` already consumes its own environment in secure foreground mode. Explicit foreground file plus nonempty environment is rejected. |
| `src/broker/availability.js` | `spawnDetachedBroker` removes the token, uses the installed entry point and current Node executable, ignores stdio, and propagates the original startup deadline. Availability authenticates readiness and launches only under safely absent ownership and refused occupancy. |
| `src/state/credential-file.js` | Protected-file loading and provisioning already exist. `parseTokenInput` accepts bounded non-whitespace ASCII with an optional file/stdin line terminator. |
| `src/state/protection.js` | The ACL helper environment copies `process.env`, removes `PSModulePath`, then adds nonsecret ACL inputs. It currently inherits the Telegram token unnecessarily. |
| `src/harness/node-helper.js` | `helperEnvironment` already constructs a clean allowlisted environment. No Telegram token is needed there. |
| `src/telegram/client.js`, `src/broker/portable-runtime.js` | Existing client/runtime handle Telegram rejection and poller status. Local broker readiness is not proof of Telegram acceptance or a human decision. |

No external platform interface changes. Existing Telegram and host integrations remain unchanged.

## Goals / Non-Goals

**Goals:** Give both automatic `mcp` and initial `pair` startup the same deterministic source selection. Carry an environment token only to the broker that needs it. Preserve file loading, startup admission, deadlines and existing failure meanings.

**Non-Goals:** New executables, secret providers, launcher frameworks, build/signing steps, global persistence, `.env` loading, credential rotation in place, state migrations, ACL/key repairs, or changes to approval authority. No new HTTP route, MCP field, journal field, helper protocol or public package export is required.

## Decisions

### 1. Select the source only when a cold launch is admitted

The CLI produces the source from its command options and supplied command environment (`io.env` when injected, otherwise `process.env`). The same environment input must reach child-environment construction. It must not silently be replaced by ambient `process.env` further down the launch path.

Keep existing early syntax validation of `--telegram-token-file`. Do not load a file, validate an environment token, or require either source merely to reuse a matching healthy broker. Resolve the following table inside the existing availability launch callback for both `mcp` and `pair`:

| Condition, in priority order | Selected source | Cold-launch behavior |
| --- | --- | --- |
| Explicit `--telegram-token-file` | That file | Ignore the environment token. Broker alone validates and loads the file. |
| No explicit file and nonempty `PROCEED_TELEGRAM_BOT_TOKEN` | Environment | Validate the value locally, then pass it unchanged to the detached broker environment. Do not inspect the default token file. |
| Neither above | Existing default file | Broker alone validates and loads the default file. |

No selected-source failure may retry another source. Empty means exactly the empty string or absent value, not whitespace. A whitespace-only value selects environment mode and fails validation rather than falling back.

For this new automatic environment route, accept exactly 1-4096 bytes of non-whitespace ASCII (`0x21` through `0x7e`). Reject non-string injected values, NUL, whitespace, line terminators, non-ASCII and overlong values without echoing them. Unlike file/stdin input, an environment value has no line terminator to remove. Do not trim or normalize it or invent a Telegram token-format expression. This reuses the existing file token content bound without changing file parsing or foreground compatibility.

Invalid selected environment input produces existing prerequisite classification `TELEGRAM_CREDENTIAL_UNAVAILABLE` (CLI exit 3). The MCP mapping remains `BROKER_UNAVAILABLE`, with fixed guidance to supply `PROCEED_TELEGRAM_BOT_TOKEN` privately on the next launch or repair/select the file source. It must not include the token or raw exception. Keep existing file protection/storage classifications and bounded timeout behavior. Detached child failure need not acquire a new reporting channel.

Local validation establishes safe input shape only. A syntactically acceptable token rejected by Telegram follows existing rejection/status handling, with no fallback or success claim about Telegram. Do not add a startup `getMe` probe or make local readiness depend on a new remote check.

**Alternative rejected:** Always checking sources before discovery would unnecessarily prevent token-free reuse and rotation-safe operation of an existing broker.

### 2. Keep the existing broker entry point and explicit child environment

The CLI launch producer and detached spawn consumer shall satisfy this process boundary:

| Selected source | Broker arguments after installed entry point | Token in broker environment |
| --- | --- | --- |
| Environment | `serve --secure-local --state-dir <state-directory>` | Exactly the selected value under `PROCEED_TELEGRAM_BOT_TOKEN` |
| Explicit/default file | `serve --telegram-token-file <selected-file> --state-dir <state-directory>` | Absent, even if present in the caller |

Construct a new child environment without mutating the command/parent environment. Strip inherited token entries first, then add only the selected environment token in environment mode. On Windows, stripping must cover case-insensitive spellings of that variable so duplicate casing cannot bypass file-mode or helper filtering. Preserve unrelated launch environment behavior and the existing `PROCEED_STARTUP_DEADLINE_AT` propagation. Do not turn this into a general environment-policy redesign.

Retain the same installed package entry point, Node executable, package working directory, `shell: false`, detached lifetime, ignored stdio and unref behavior. Never put a token in arguments or an intermediate serialized launch description. Synchronous launch failures on this path must become fixed safe availability errors, not raw spawn arguments/options or environment dumps.

The existing secure `runServe` environment branch consumes the value. File mode continues stripping the inherited token so its existing foreground source-conflict check is not triggered by an automatic file launch. Manual `serve` behavior, including explicit file/environment conflict rejection and legacy HTTP serving, stays unchanged.

**Alternative rejected:** A new launcher, secret-provider abstraction or cross-process handoff protocol duplicates working startup and adds no required behavior.

### 3. Remove unnecessary helper inheritance, not parent authority

In `src/state/protection.js`, remove the Telegram token from the copied ACL helper environment before adding ACL inputs. Keep `PSModulePath` removal and existing ACL invocation/protection semantics. The helper never needs the token. Keep `src/harness/node-helper.js` unchanged unless a focused regression demonstrates its existing allowlist violates this requirement.

The trusted launch environment may place the token in the host and Proceed adapter for this route. The product must not persist or display it, copy it into MCP JSON configuration, or forward it to helpers that do not need it. This permission is not permission to disclose other credentials or expand request-capability access. No best-effort deletion from `process.env` can promise erasure from the host, parent or sibling processes.

Operators are responsible for privately supplying the launch environment and limiting its inheritance to trusted processes. Proceed cannot control an unrelated parent's environment or other MCP processes that parent starts. Guidance must disclose this boundary without claiming global disclosure permission or same-account isolation.

**Alternative rejected:** Constructing a trusted host launcher or rewriting parent environments is outside product control and this change's scope.

### 4. Keep production changes bounded and unit seams private

Expected production edits are limited to `src/cli/main.js`, `src/broker/availability.js`, `src/state/protection.js` and `src/broker/startup-failure.js`. They cover source production, the existing spawn sink, helper filtering and fixed actionable guidance. Update stale file-only CLI copy in the same CLI file. No new production subsystem or module is needed. File credential, Telegram client/runtime and harness helper implementations remain unchanged.

Setup/privacy documentation needs the two supported routes and restart/rotation caveats through its existing owner. It must not prescribe global environment persistence or embed a token value in an example. This design authorizes no edits to those files itself.

Use existing Node `node:test`/`node:assert/strict` tooling. SDET shall test actual production JavaScript functions with in-memory injected environment, storage/readiness and spawn/exec sinks. Minimal dependency injection or internal factoring needed to reach those functions is private implementation, selected by engineering. Do not mandate new public exports, a shared test-only interface, source-text assertions in place of behavior, or a ladder of wrappers. Production must not depend on test artifacts.

| Risk / contract | Minimal Node unit evidence |
| --- | --- |
| Wrong source or fallback | Both `mcp` and `pair` producer paths exercise explicit-file/environment/default precedence, absent/empty values, invalid selected environment input, and selected-file failure without fallback. File contents never reach the adapter. |
| Ambient environment used accidentally | Inject different command and ambient environments. Assert the actual production launch path uses the command input and leaves both original inputs unchanged. |
| Secret in wrong child | Capture actual detached spawn options/arguments for both modes. Assert exact token presence/absence, Windows casing removal, unchanged deadline and shell/stdio/lifetime settings. Capture ACL helper environment through an injected exec sink. Exercise the existing harness environment allowlist directly. No real helper starts. |
| Failure disclosure or false success | Use synthetic canary values and throwing sinks. Assert fixed CLI/MCP errors and captured outputs contain no canary, raw child options or environment dump. Confirm source failure is non-approval and does not invoke a fallback. |
| Reuse/regression | Existing healthy-broker reuse performs no token loading/validation or second launch. Preserve startup conflict/deadline/ownership cases and foreground/file-mode behavior in focused unit regressions. |

These are unit contracts, not a new test framework or proof of operating-system process behavior.

## Risks / Trade-offs

- Host/adapter now hold a sensitive token in environment mode -> This is the approved narrow privacy trade-off. Keep handling memory-only and document operator responsibility for launch inheritance. File mode remains available.
- Token changes do not affect an existing detached broker -> Require supported authenticated stop and replacement, with fresh private supply. Never take over uncertain ownership or start a second poller to rotate.
- Helper environment filtering does not fix Windows protection defects -> Preserve existing failures and separate Windows qualification/activation blocks. Do not activate local MCP/TUI as part of this change.
- Unit mocks cannot prove detached startup, installed first use, live Telegram, native ACL behavior or real-process non-disclosure -> These checks remain UNRUN/UNVERIFIED under the unit-only policy. Independent review remains required. Unit success is not feature verification or a landing/exposure waiver.

## Migration Plan

No stored-data migration or bootstrap capture. Existing file-mode installations keep working. Environment-mode launch contexts must resupply the token after each fresh launch, login or reboot as applicable. There is no one-time persistence promise.

Deliver one independent change PR after focused Node unit evidence and independent review, with the product delta reviewed against the latest merged baseline before authorized CLI archive. Deployment, publication and candidate-specific acceptance of unrun proof remain separate decisions. Rollback restores the prior file-only automatic path. Operators must stop and replace an environment-started broker if they need to change its running credential or return to file mode.
