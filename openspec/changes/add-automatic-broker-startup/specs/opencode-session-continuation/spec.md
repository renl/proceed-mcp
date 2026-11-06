## ADDED Requirements

### Requirement: Automatic broker availability for normal MCP use

After supported one-time setup, starting the normal MCP adapter MUST make the configured local broker
available without a separate operator-maintained `serve` terminal. The product MUST reuse a matching
healthy secure instance or start one when the configured state is safely unowned. Broker-dependent
approval calls MUST wait for verified broker readiness within a documented finite startup deadline or
fail with an actionable diagnostic. Startup failure MUST NOT be represented as a human decision.

#### Scenario: Start from a safely stopped configured broker

- **GIVEN** protected initialized state, a configured transport principal, completed private pairing,
  available broker-only Telegram credentials and no broker ownership record or conflicting listener
- **WHEN** the operator starts the normal MCP adapter and invokes the existing approval interaction
- **THEN** the broker starts without a manual `serve` command or separate terminal
- **AND** broker-dependent calls proceed only after readiness is verified within the documented startup
  deadline
- **AND** the paired human can resolve the request through the existing waiting-call interaction.

#### Scenario: Reuse an existing healthy broker

- **GIVEN** a matching healthy secure broker already serves the configured state, whether started
  manually or automatically
- **WHEN** another configured MCP adapter starts
- **THEN** it reuses that broker without starting another broker or Telegram update poller
- **AND** existing requests, waiting clients and paired-human authority remain unchanged.

#### Scenario: Readiness never arrives

- **GIVEN** automatic broker startup is requested but the broker does not become ready
- **WHEN** the documented finite startup deadline is reached
- **THEN** the waiting startup-dependent operation ends with an actionable failure rather than waiting
  indefinitely
- **AND** no success, human approval or confirmed delivery is claimed
- **AND** any cleanup is limited to resources proven to belong to that startup attempt and not adopted
  by another client.

### Requirement: Shared startup preserves exclusive ownership and client independence

Automatic startup MUST preserve at most one broker and one Telegram update poller per configured state,
including concurrent adapter starts and races with manual startup. Closing one adapter MUST NOT stop a
broker needed by another adapter or stop a manually started broker. The product MUST document the
automatic broker's lifetime and supported clean-stop path. It MUST NOT kill an unrelated process or
replace, delete or take over uncertain ownership to make startup succeed.

#### Scenario: Concurrent clients start against stopped state

- **GIVEN** safely unowned configured state and multiple authorized MCP adapters
- **WHEN** the adapters start concurrently, including a concurrent manual broker start
- **THEN** at most one broker acquires ownership and at most one Telegram update poller runs for that
  state
- **AND** successful adapters use the same matching ready broker
- **AND** adapters that cannot establish readiness within the startup deadline report failure without
  bypassing ownership or corrupting state.

#### Scenario: One client closes while another remains

- **GIVEN** two active adapters share the broker and one has a pending approval interaction
- **WHEN** the other adapter closes
- **THEN** the remaining adapter's broker access and pending interaction are not interrupted by that
  closure
- **AND** the closed adapter's requests and decisions retain the existing lost-call and durable-state
  semantics.

#### Scenario: A client closes after reusing a manual broker

- **GIVEN** an adapter reused a manually started broker
- **WHEN** that adapter closes, including when no other adapters remain
- **THEN** the adapter does not stop the manual broker or remove its ownership record.

#### Scenario: Occupied port or uncertain ownership

- **GIVEN** an unrelated listener, a mismatched broker, or an ownership record whose safe reuse cannot
  be established
- **WHEN** the adapter attempts automatic startup or reuse
- **THEN** it reports the applicable conflict or uncertain ownership with a safe next action
- **AND** it does not treat an open port as proof of a matching healthy instance
- **AND** it does not kill the listener, remove or replace the ownership record, recover stale
  ownership, or modify the protected journal to bypass the conflict.

### Requirement: Automatic startup preserves credential and readiness boundaries

The supported setup path MUST require explicit operator provisioning to persist the Telegram bot token
for later automatic startup in a separate protected owner-only credential file outside the repository,
product state directory and MCP adapter configuration. Only broker startup MUST load and use that
token, never the adapter. Provisioning MUST be required for cold automatic startup, not reuse of a
matching healthy secure foreground broker using its own environment token.

#### Scenario: Explicitly provision the automatic-startup token

- **GIVEN** a clean installation and an operator choosing to enable automatic startup
- **WHEN** the operator supplies the token through the supported one-time provisioning path
- **THEN** it is saved only in the separate owner-only credential file outside the repository, product
  state directory and MCP adapter configuration
- **AND** provisioning does not echo the token or expose it through CLI arguments, outputs or logs
- **AND** subsequent cold startup loads the token only in broker startup, not in the MCP adapter
- **AND** setup instructions disclose the same-account access limitation without promising encryption
  or an OS credential store.

### Requirement: Provisioning and startup prevent token disclosure

Provisioning and startup MUST NOT echo the token or expose it through CLI arguments, MCP client
configuration, the adapter's environment, tool or environment outputs, diagnostics, logs or published
evidence. The token MUST NOT enter the state journal or request history. The product MUST NOT read
`.env` files for this provisioning or startup path.

#### Scenario: Startup does not disclose private authority

- **GIVEN** supported one-time provisioning and subsequent automatic startup
- **WHEN** MCP client configuration, tool results, environment outputs and startup diagnostics are
  inspected
- **THEN** none discloses Telegram, local control or owner credential values
- **AND** request capabilities remain confined to their existing authorized tool-result boundary and
  are not added to startup diagnostics or environment outputs
- **AND** the MCP adapter is not supplied the Telegram token through its environment
- **AND** neither the state journal nor request history gains the Telegram token, and persistent
  request capabilities remain stored only as verifiers rather than plaintext.

### Requirement: Credential provisioning and loading fail closed

Provisioning and automatic credential loading MUST refuse unsafe ownership, permissions or paths,
including symlinks or redirected paths that could bypass owner-only protection or the required storage
separation. Missing, empty or unreadable credentials and unverifiable protection MUST produce an
actionable failure for automatic startup, not approval or a claim of working Telegram approval.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the automatic-startup credential is missing, empty or unreadable, or its ownership,
  permissions or path cannot be verified as safe, including unsafe symlink or redirected-path cases
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses the unsafe storage or fails for the missing prerequisite with a
  supported operator next step and no token disclosure
- **AND** it does not weaken protection, load an unsafe token, claim working Telegram approval or
  return a human decision.

### Requirement: Credential limitations and foreground compatibility remain explicit

The product MUST document that owner-only file protection does not isolate the token from same-account
processes and MUST NOT imply an encryption or OS credential-store guarantee. Existing foreground broker
use with a token supplied only through its own process environment MUST remain supported without
requiring persistent token provisioning. Legacy HTTP foreground serving MUST remain available to legacy
clients. Secure foreground serving MUST permit upgraded-client reuse without a token file.

#### Scenario: Foreground environment mode remains available

- **GIVEN** an operator supplies the token only to the foreground broker's process environment without
  provisioning a persistent token file
- **WHEN** the operator starts the broker through the supported secure foreground path
- **THEN** that mode remains supported without requiring token persistence
- **AND** a configured adapter can reuse the matching healthy broker without receiving or loading the
  token.

### Requirement: Private local authority requires authenticated confidential admission

Upgraded local clients MUST authenticate the configured broker over a confidential channel before
sending any private authority on each connection, including reconnects and requests after readiness.
A listening port, ownership record or claimed identity alone MUST NOT authorize disclosure. Failed
or unsupported secure admission MUST fail closed without plaintext or unauthenticated fallback.

#### Scenario: An impostor listener cannot collect private authority

- **GIVEN** an impostor occupies the configured port or replaces a listener after successful readiness
- **WHEN** an upgraded client attempts readiness or any subsequent local request
- **THEN** no private application authority is disclosed to an endpoint that cannot authenticate
- **AND** failed secure admission returns an actionable non-approval failure without plaintext fallback
- **AND** uncertain ownership and durable state are preserved, not replaced to bypass the failure.

### Requirement: Legacy upgrade refusal has an explicit supported next step

Upgraded local clients MUST refuse a legacy-only broker before transmitting private authority.
Instructions MUST explain the one-time operator stop/restart into secure foreground or provisioned
automatic startup. No silent mode switch, forced termination, token persistence for secure foreground
reuse or stored-data migration is permitted. Old clients MUST NOT gain access to a secure broker.

#### Scenario: Upgrade while a legacy foreground broker is running

- **GIVEN** a legacy HTTP foreground broker serves existing configured state
- **WHEN** upgraded `mcp`, `pair`, `status` or `stop` attempts access
- **THEN** access is refused without sending private authority or treating the listener as a matching
  healthy secure instance
- **AND** guidance says to stop that broker through its own foreground interface, then restart with
  `serve --secure-local` using its environment token, or provision the token file for automatic startup
- **AND** the client does not stop the legacy broker, delete its ownership record or alter durable work
- **AND** after automatic-startup setup and that upgrade step, normal MCP use needs no recurring manual
  broker launch.

#### Scenario: Legacy foreground serving remains available

- **GIVEN** an operator chooses legacy foreground HTTP serving with its environment-only token
- **WHEN** a legacy client uses that broker
- **THEN** the existing foreground HTTP mode remains available without persistent token provisioning
- **AND** this availability is not described as secure reuse by upgraded clients.

### Requirement: Startup preserves local authority and truthful readiness

Automatic startup MUST preserve owner-only state protection, authenticated local access,
transport-principal separation and private request authority. The product MUST distinguish local
broker readiness from Telegram availability, completed pairing, human receipt and confirmed outcome
delivery.

#### Scenario: Local listener works but Telegram cannot operate

- **GIVEN** a reachable local broker with missing or rejected Telegram credentials, unavailable
  Telegram transport or a competing Telegram consumer
- **WHEN** startup or approval operation status is reported
- **THEN** the product identifies the missing or failed prerequisite and an applicable operator action
  without exposing credentials
- **AND** local connectivity alone is not reported as working Telegram approval, human receipt,
  approval or confirmed delivery
- **AND** existing pending requests and recorded decisions retain their existing durable-state and
  expiry semantics.

#### Scenario: Required local authority or state protection is unavailable

- **GIVEN** missing or invalid local credentials, an unknown transport principal or state that does not
  satisfy required owner-only protection
- **WHEN** automatic startup or request access is attempted
- **THEN** the operation fails closed with an actionable diagnostic
- **AND** no unauthenticated fallback, cross-principal access or weakened state protection is used.

### Requirement: First-use and restart preserve the approval workflow

An empty installation MUST remain unpaired with no requests or decisions until supported setup and
approval actions create them. The documented setup path MUST create required protected state, a
transport principal, broker-only credential provisioning and operator-authorized private pairing
without manual stored-data editing. After setup, normal MCP use MUST support the first useful approval
interaction with no separate manual broker launch.

#### Scenario: Complete setup and first useful action from empty state

- **GIVEN** a clean installation with no product configuration, pairing, requests or decisions and
  operator access to the required external prerequisites
- **WHEN** the operator follows supported one-time setup, connects the normal MCP adapter, calls
  `prepare_approval`, calls `request_approval` with the returned private authority and the paired human
  selects Approve while the call remains active
- **THEN** the waiting call returns the matching explicit approval through the existing tool contract
  without a separate manual broker launch
- **AND** no proprietary host API, direct stored-data editing, `doctor` or delivery retry is required
- **AND** setup and startup alone never create a request or grant approval.

#### Scenario: Setup or pairing is incomplete

- **GIVEN** missing initialized state, owner setup, credential provisioning or operator-authorized
  private pairing
- **WHEN** the operator connects the MCP adapter or attempts an operation that needs that prerequisite
- **THEN** the product identifies the incomplete prerequisite and supported next step without claiming
  completed setup or a successful approval interaction
- **AND** it does not invent pairing, create substitute authority or return a fake human decision.

### Requirement: Automatic startup preserves existing durable work

Automatic startup over existing state MUST preserve durable request identities, pending requests,
accepted decisions and delivery status under the current expiry and single-resolution rules.

#### Scenario: Automatic startup recovers existing durable work

- **GIVEN** safely stopped configured state containing pending requests and accepted decisions with
  retained request authority
- **WHEN** an MCP adapter automatically starts the broker and an authorized caller retrieves or
  acknowledges existing work
- **THEN** identities, accepted outcomes, response text and delivery status remain available under the
  current expiry and single-resolution rules
- **AND** no replacement request, duplicate decision, automatic agent resumption or confirmed delivery
  is inferred from the restart.
