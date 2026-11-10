# Spec Delta

## MODIFIED Requirements

### Requirement: Automatic broker availability for normal MCP use

After supported setup, starting the normal MCP adapter MUST make the configured local broker available without a separate operator-maintained `serve` terminal. Environment mode additionally requires private token supply by the trusted launch environment on each fresh launch. The product MUST reuse a matching healthy secure instance or start one when the configured state is safely unowned. Broker-dependent approval calls MUST wait for verified broker readiness within a documented finite startup deadline or fail with an actionable diagnostic. Startup failure MUST NOT be represented as a human decision.

#### Scenario: Start from a safely stopped configured broker

- **GIVEN** protected initialized state, a configured transport principal, completed private pairing, an available supported Telegram credential source and no broker ownership record or conflicting listener
- **WHEN** the operator starts the normal MCP adapter and invokes the existing approval interaction
- **THEN** the broker starts without a manual `serve` command or separate terminal
- **AND** broker-dependent calls proceed only after readiness is verified within the documented startup deadline
- **AND** the paired human can resolve the request through the existing waiting-call interaction.

#### Scenario: Reuse an existing healthy broker

- **GIVEN** a matching healthy secure broker already serves the configured state, whether started manually or automatically
- **WHEN** another configured MCP adapter starts
- **THEN** it reuses that broker without starting another broker or Telegram update poller
- **AND** existing requests, waiting clients and paired-human authority remain unchanged.

#### Scenario: Readiness never arrives

- **GIVEN** automatic broker startup is requested but the broker does not become ready
- **WHEN** the documented finite startup deadline is reached
- **THEN** the waiting startup-dependent operation ends with an actionable failure rather than waiting indefinitely
- **AND** no success, human approval or confirmed delivery is claimed
- **AND** any cleanup is limited to resources proven to belong to that startup attempt and not adopted by another client.

### Requirement: Automatic startup preserves credential and readiness boundaries

Cold automatic startup MUST support either a privately supplied environment token or the existing separately provisioned protected token file. For cold automatic startup, an explicitly selected token file MUST take precedence. Otherwise a nonempty token in the configured Telegram token environment variable, `PROCEED_TELEGRAM_BOT_TOKEN` by default, MUST take precedence over the default credential file. An absent or empty environment value MUST leave the existing default-file route available. The selected source MUST be validated without silently switching to another source on failure. File provisioning MUST remain explicit and owner-only, outside the repository, product state directory and MCP adapter configuration. Only broker startup MUST load file contents. Environment mode MAY supply the token to the trusted host and MCP startup process solely for broker startup, without requiring token persistence. Reusing a matching healthy secure broker MUST NOT require a token source.

#### Scenario: Explicitly provision the automatic-startup token

- **GIVEN** a clean installation and an operator choosing protected-file automatic startup
- **WHEN** the operator supplies the token through the supported one-time provisioning path
- **THEN** it is saved only in the separate owner-only credential file outside the repository, product state directory and MCP adapter configuration
- **AND** provisioning does not echo the token or expose it through CLI arguments, outputs or logs
- **AND** subsequent file-mode cold startup loads the token only in broker startup, not in the MCP adapter
- **AND** setup instructions disclose the same-account access limitation without promising encryption or an OS credential store.

#### Scenario: Cold startup uses a private environment token without a token file

- **GIVEN** otherwise complete supported setup, safely stopped state, no token file and a valid token privately supplied by the trusted launch environment
- **WHEN** normal MCP startup needs to start the broker
- **THEN** the broker uses that token without requiring file provisioning or a manual broker terminal
- **AND** the product does not persist the environment token.

#### Scenario: Select one cold-start source deterministically

- **GIVEN** more than one token source is available for cold automatic startup
- **WHEN** startup selects its source
- **THEN** an explicit token-file selection wins over the environment and default file, otherwise a nonempty environment token wins over the default file
- **AND** an unavailable, unsafe or invalid selected source fails without trying a lower-priority source.

### Requirement: Provisioning and startup prevent token disclosure

Provisioning and startup MUST NOT echo the token or expose it through CLI arguments, MCP client configuration including JSON environment entries, tool or environment outputs, diagnostics, logs or published evidence. The token MUST NOT enter the repository, product state, state journal or request history. The product MUST NOT read `.env` files for this provisioning or startup path. Private environment inheritance by the trusted host and MCP startup process is permitted only for the supported environment route. Product-launched helpers that do not need the Telegram token MUST NOT inherit it. File mode MUST NOT supply file contents to the adapter environment. These obligations govern product handling, not unrelated parent processes.

#### Scenario: Startup does not disclose private authority

- **GIVEN** either supported credential source and subsequent automatic startup
- **WHEN** MCP client configuration, tool results, environment outputs and startup diagnostics are inspected
- **THEN** none discloses Telegram, local control or owner credential values
- **AND** request capabilities remain confined to their existing authorized tool-result boundary and are not added to startup diagnostics or environment outputs
- **AND** the MCP adapter is not supplied file-sourced Telegram token contents through its environment
- **AND** neither the state journal nor request history gains the Telegram token, and persistent request capabilities remain stored only as verifiers rather than plaintext.

#### Scenario: Helpers do not inherit unnecessary token authority

- **GIVEN** the trusted launch environment supplied the Telegram token for automatic startup
- **WHEN** the product launches a helper that does not require that token
- **THEN** that helper's environment excludes it without changing unrelated parent-process environments.

### Requirement: Credential provisioning and loading fail closed

File provisioning and automatic file loading MUST refuse unsafe ownership, permissions or paths, including symlinks or redirected paths that could bypass owner-only protection or required storage separation. Missing, empty or unreadable selected credentials, invalid selected environment tokens and unverifiable file protection MUST produce an actionable failure for cold automatic startup, not approval or a claim of working Telegram approval. Failure MUST NOT prompt for a secret, obtain one from agent arguments or silently change sources.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the selected file credential is missing, empty or unreadable, or its ownership, permissions or path cannot be verified as safe, including unsafe symlink or redirected-path cases
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses the unsafe storage or fails for the missing prerequisite with a supported operator next step and no token disclosure
- **AND** it does not weaken protection, load an unsafe token, claim working Telegram approval or return a human decision.

#### Scenario: No usable cold-start source is available

- **GIVEN** cold startup is needed and the environment token is absent or empty with no usable selected file, or a nonempty selected environment token is invalid
- **WHEN** normal MCP startup attempts to start the broker
- **THEN** startup fails with a supported next step to supply the token privately at launch or repair the selected file source
- **AND** it neither prompts for a secret nor obtains one from agent arguments, discloses token values, falls back after selected-source failure or returns a human decision.

### Requirement: Credential limitations and foreground compatibility remain explicit

The product MUST document that owner-only file protection does not isolate the token from same-account processes and MUST NOT imply encryption or an OS credential-store guarantee. Environment-mode instructions MUST disclose that the trusted host and MCP startup process may hold the token and that each fresh launch requires the trusted launch environment to supply it again. They MUST NOT require global or user-wide token persistence or promise one-time persistent, login or reboot setup. Existing foreground broker use with a token supplied only through its own process environment MUST remain supported without persistent token provisioning. Legacy HTTP foreground serving MUST remain available to legacy clients. Secure foreground serving MUST permit upgraded-client reuse without a token file. Changing a launch token MUST NOT be described as rotating an already running broker's token. Rotation requires supported broker stop and replacement without ownership takeover.

#### Scenario: Foreground environment mode remains available

- **GIVEN** an operator supplies the token only to the foreground broker's process environment without provisioning a persistent token file
- **WHEN** the operator starts the broker through the supported secure foreground path
- **THEN** that mode remains supported without requiring token persistence
- **AND** a configured adapter can reuse the matching healthy broker without receiving or loading the token.

#### Scenario: Restart and rotation require fresh supply and broker replacement

- **GIVEN** an operator uses environment mode or changes the token in a new launch environment
- **WHEN** restart or rotation guidance is followed
- **THEN** instructions require private supply again for a fresh environment-mode launch and supported stop and replacement of an existing broker to use a changed token
- **AND** merely changing an adapter environment does not mutate the running broker, start a second poller or grant permission to take over uncertain ownership.

### Requirement: First-use and restart preserve the approval workflow

An empty installation MUST remain unpaired with no requests or decisions until supported setup and approval actions create them. The documented setup path MUST create required protected state, a transport principal, either private launch-environment token supply or broker-only file credential provisioning, and operator-authorized private pairing without manual stored-data editing. After setup, normal MCP use with the selected source available MUST support the first useful approval interaction with no separate manual broker launch. Setup instructions MUST distinguish environment supply on each fresh launch from one-time file provisioning.

#### Scenario: Complete setup and first useful action from empty state

- **GIVEN** a clean installation with no product configuration, pairing, requests or decisions and operator access to the required external prerequisites
- **WHEN** the operator follows supported setup using either credential source, connects the normal MCP adapter, calls `prepare_approval`, calls `request_approval` with the returned private authority and the paired human selects Approve while the call remains active
- **THEN** the waiting call returns the matching explicit approval through the existing tool contract without a separate manual broker launch
- **AND** environment-mode setup and first use require no token file
- **AND** no proprietary host API, direct stored-data editing, `doctor` or delivery retry is required
- **AND** setup and startup alone never create a request or grant approval.

#### Scenario: Setup or pairing is incomplete

- **GIVEN** missing initialized state, owner setup, a required selected credential source or operator-authorized private pairing
- **WHEN** the operator connects the MCP adapter or attempts an operation that needs that prerequisite
- **THEN** the product identifies the incomplete prerequisite and supported next step without claiming completed setup or a successful approval interaction
- **AND** it does not invent pairing, create substitute authority or return a fake human decision.
