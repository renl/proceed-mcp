# opencode-session-continuation Specification

## Purpose
Deliver remote decisions through a portable waiting MCP tool call in an installable preview. Automatic post-timeout resumption is deferred and Events are unsupported. The existing capability path is retained, not an OpenCode restriction. Parent: [proposal](../../changes/archive/2026-11-05-add-telegram-approval-opencode-v2/proposal.md). Live first-host and assistant acknowledgement proof follow the proposal's [scoped evidence limits](../../changes/archive/2026-11-05-add-telegram-approval-opencode-v2/proposal.md#approved-preview-boundary-and-scoped-risk-acceptance). Supplied manual first-use results are not independent full-release verification or general compatibility proof.

## Requirements

### Requirement: Exact originating-session delivery
The product MUST bind each prepared request to independent private bearer request authority (a request key or capability) and its protected transport principal. Creation, retrieval, cancellation, and receipt acknowledgement MUST require the matching capability and principal without proprietary host metadata or a harness API/password.

#### Scenario: Enforce the approved bearer authority boundary
- **GIVEN** a prepared request bound to a capability and transport principal
- **WHEN** request access or agent identity is assessed
- **THEN** display labels, model-supplied session identifiers, or knowledge of a request identifier alone MUST NOT grant access.
- **AND** a valid capability shared with another context under the same principal MUST authorize that context for the bound request. It MUST NOT authorize access under a different principal.
- **AND** the product MUST NOT claim authenticated nontransferable agent-session identity.

**Approval traceability:** This requirement retains its original name but replaces the prior unresolved nontransferable-session criterion with the [explicitly approved request-key boundary](../../changes/archive/2026-11-05-add-telegram-approval-opencode-v2/proposal.md#shared-connection-security-decision--approved-request-key-ownership). Same-principal capability transfer is authorized behavior; response correlation and denial without valid authority remain separate acceptance obligations.

#### Scenario: Preserve original-call routing independently of key transfer
- **GIVEN** active waiting calls, including parallel invocations on a shared connection
- **WHEN** a waiting result is delivered or its original call becomes unreachable
- **THEN** each active waiting result MUST return only on its original MCP invocation with the matching JSON-RPC request ID, including parallel invocations on a shared connection.
- **AND** the trusted harness MUST route that result only to its invoking context and keep its capability private.
- **AND** capability transfer MUST NOT redirect an existing call's response.
- **AND** if the original call is unreachable, the product MUST retain the outcome for authorized retrieval and report delivery uncertainty, not substitute the foreground, most recent, or another available session.
- **AND** a retained capability permits explicit request access, not automatic session reattachment or agent activity. Events are unsupported in this preview.
- **AND** the product MUST NOT present either the principal or key as establishing an automatic event route.

#### Scenario: Decisions arrive out of order
- **GIVEN** two running sessions with separate pending requests multiplexed over one standard MCP connection, even with equal display labels or caller-chosen request identifiers
- **WHEN** the human resolves them in reverse order
- **THEN** each result retains its original JSON-RPC request ID, the trusted harness routes it only to its invoking context, and neither outcome is mixed with the other request.

#### Scenario: Origin cannot be identified safely
- **GIVEN** an accepted decision whose original waiting call is unreachable and no verified exact-session event route is available
- **WHEN** delivery is attempted
- **THEN** no replacement session is selected, delivery is reported as unconfirmed or unavailable, and the unchanged outcome remains available only through capability-and-principal-authorized retrieval without claiming agent resumption.

#### Scenario: Another session attempts access
- **GIVEN** a request bound to one capability and principal and another session that knows its request identifier but lacks its valid request capability, including when both share a transport principal
- **WHEN** the other session attempts creation against the prepared authority, retrieval, cancellation, or receipt acknowledgement
- **THEN** access is denied without disclosing request details or changing the request, even if their display labels or host-local session identifiers match.

#### Scenario: Capability does not cross transport principals
- **GIVEN** a request capability bound to one transport principal
- **WHEN** a different transport principal presents it to retrieve, cancel, or acknowledge that request
- **THEN** access is denied without request disclosure or mutation.

#### Scenario: Capability shared within its transport principal
- **GIVEN** another context holds a valid request capability shared under its bound transport principal
- **WHEN** that context explicitly retrieves the request or cancels it while pending
- **THEN** access is authorized for that request under the same single-resolution rules, any active waiting result still returns only on its original call, and no automatic agent resumption or authenticated agent-session identity is claimed.

#### Scenario: Request capability is lost
- **GIVEN** the original waiting call is lost and its request capability is no longer available to the caller
- **WHEN** the caller attempts retrieval using only the request identity, label, or model-supplied session identifier
- **THEN** access is denied without request disclosure or mutation; no capability-recovery or alternate-session fallback is granted.

### Requirement: Portable waiting-call outcome delivery
The standard MCP request tool call MUST remain waiting for the human outcome while the call and transport remain active and the request is actionable.

#### Scenario: Return actual outcomes within documented waiting limits
- **GIVEN** a standard MCP request tool call
- **WHEN** it waits for or returns an outcome
- **THEN** an accepted Approve, Reject, or Respond MUST return as that call's actual result, including the request identity, outcome type, and unchanged response text where applicable. An immediate creation receipt alone MUST NOT satisfy this behavior.
- **AND** waiting-call operation MUST NOT require MCP Events, proprietary session metadata, a harness API/password, or an OpenCode API support allowlist.
- **AND** client execution and transport timeouts constrain how long the call can wait. The product MUST document these limits without promising indefinite waiting.
- **AND** expiry and explicit cancellation MUST return their non-approval closure when the call remains active. Failures MUST NOT be represented as human decisions.

#### Scenario: Prepare private authority before the waiting interaction
- **GIVEN** a caller using the supported baseline interaction
- **WHEN** it prepares authority and makes the question's create-and-wait call
- **THEN** the supported interaction MUST prepare request-specific private authority through an ordinary MCP tool call before the question's create-and-wait call.
- **AND** preparation MUST NOT send a Telegram question, create an actionable approval, or count as delivery of a human outcome.
- **AND** the caller MUST receive the prepared request identity and authority before waiting so it can retain them if that call is lost.
- **AND** creation, retrieval, explicit cancellation, and receipt acknowledgement MUST require both the matching request capability and its bound transport principal. A model-supplied label or request ID MUST NOT substitute for either.
- **AND** baseline use MUST support shared connections without a proprietary wrapper or dedicated per-agent connection. Exact tool contracts belong to [design decision 3](../../changes/archive/2026-11-05-add-telegram-approval-opencode-v2/design.md).

#### Scenario: Prepare then ask and wait
- **GIVEN** a configured caller on a standard shared MCP connection
- **WHEN** it calls `prepare_approval` and then uses its returned authority to call `request_approval`
- **THEN** preparation returns private authority without an actionable Telegram request, and the question call creates the request and remains waiting for its actual outcome rather than returning a creation receipt.

#### Scenario: Decision before tool completion
- **GIVEN** a configured MCP caller that prepared request authority, with no MCP Events capability, no proprietary session metadata, and no harness API/password, whose request call and transport remain active
- **WHEN** the paired human resolves the request with Approve, Reject, or Respond
- **THEN** the same waiting call returns the matching actual human outcome, with unchanged response text for Respond, without another request or a manual terminal message.

#### Scenario: Request closes while the call is waiting
- **GIVEN** an unresolved request whose call remains active
- **WHEN** its deadline is reached or its owner explicitly cancels it
- **THEN** the waiting call returns the matching non-approval closure and no approval is recorded.

#### Scenario: Waiting result is lost but request authority is retained
- **GIVEN** a created request whose caller retained its prepared identity and capability under the same transport principal
- **WHEN** the waiting call is lost and the paired human later resolves the still-actionable request
- **THEN** explicit authorized retrieval returns the matching unchanged outcome without creating another request or claiming automatic agent resumption; an ID or label without the capability cannot recover access.

### Requirement: Outcomes preserve human intent
The receiving session MUST be given the request identity and its accepted approval, rejection, or response text without changing the outcome type. Respond MUST continue the session with instructions, not approval. Rejection MUST NOT be represented as authorization to perform the rejected action.

#### Scenario: Receive each decision type
- **GIVEN** an accepted Approve, Reject, or Respond outcome
- **WHEN** the originating session receives it
- **THEN** it receives the matching request and outcome type, including unchanged response text for Respond.

### Requirement: Continuation after tool timeout
The preview MUST identify automatic post-timeout continuation and MCP Events as unsupported. They are deferred features, not incomplete preview acceptance outcomes.

#### Scenario: Preserve request access without automatic resumption
- **GIVEN** the preview's waiting-call operation with Events unsupported
- **WHEN** a tool timeout occurs or retained request access is described
- **THEN** tool timeout alone MUST NOT expire or cancel the request.
- **AND** retained decisions MUST remain available through explicit capability-and-principal-authorized retrieval.
- **AND** retrieval, acknowledgement, ordinary notifications and stored history MUST NOT be described as waking an agent or automatically resuming a session.
- **AND** lack of Events MUST NOT gate waiting-call operation.

#### Scenario: Decision after tool timeout
- **GIVEN** the original tool call timed out and the request is still pending and unexpired
- **WHEN** the human resolves the request in Telegram
- **THEN** the unchanged outcome is retained for authorized retrieval, automatic resumption is reported as unavailable, and no event-driven agent turn or late delivery is claimed.

#### Scenario: Harness lacks the enhanced capability
- **GIVEN** a harness supports the standard waiting MCP tool call but not the required event-triggered resumption capability
- **WHEN** its call times out before a decision
- **THEN** the product retains the request and later accepted decision under the durable-state rules, reports automatic resumption as unavailable, and does not claim late delivery; absence of this capability does not disable waiting-call operation.

### Requirement: Safe pending delivery and replay
The product MUST retain durable accepted outcomes and distinguish recorded, returned and acknowledged delivery.

#### Scenario: Report uncertain delivery and preserve replay safety
- **GIVEN** an accepted outcome
- **WHEN** delivery is unavailable or unconfirmed, or authorized retrieval or acknowledgement occurs
- **THEN** temporary unavailability or a lost waiting call MUST NOT be reported as successful continuation.
- **AND** explicit authorized retrieval and acknowledgement MUST preserve the same request, decision identity and human outcome without creating another decision or decision effect.
- **AND** the product MUST expose truthful status and an applicable next action when delivery is unconfirmed.

#### Scenario: Keep deferred commands separate from supported recovery
- **GIVEN** the preview's supported delivery and recovery behavior
- **WHEN** diagnostics, delivery retry or recovery capabilities are assessed
- **THEN** completed `doctor` diagnostics and delivery `retry` are deferred.
- **AND** exposed incomplete commands MUST report their actual unavailable or incomplete state without claiming checks, scheduling or delivery.
- **AND** this deferral MUST NOT weaken active-wait reconnect, authority checks, transport recovery, durability or duplicate-effect protection.

#### Scenario: Host cannot accept continuation yet
- **GIVEN** an accepted outcome and a running originating session that cannot currently accept it
- **WHEN** the product attempts delivery
- **THEN** the outcome stays recorded with pending or failed delivery, and no successful continuation is claimed.

#### Scenario: Retrieve without duplicate effects
- **GIVEN** a retained accepted outcome after a lost call or product restart
- **WHEN** a capability-and-principal-authorized caller retrieves or acknowledges it repeatedly
- **THEN** the same decision and unchanged outcome remain available without a new decision, automatic agent turn or additional decision effect.

#### Scenario: Waiting result precedes repeated retrieval
- **GIVEN** the waiting call has already returned the accepted outcome
- **WHEN** the outcome is retrieved or acknowledged again
- **THEN** the recorded decision remains unchanged and there is no second decision effect or automatic continuation.

#### Scenario: Deferred diagnostics or delivery retry is requested
- **GIVEN** the preview does not implement completed doctor diagnostics or delivery retry
- **WHEN** an operator consults the README or invokes an exposed incomplete command
- **THEN** the limitation is explicit and no completed diagnostic, scheduled delivery or successful continuation is claimed.

### Requirement: Honest compatibility and enforcement boundary
The product MUST document the portable waiting-call baseline separately from unsupported automatic continuation, including the protocol/runtime target, configuration, timeout constraints and actual verification scope.

#### Scenario: Disclose compatibility and enforcement limits
- **GIVEN** the preview's setup instructions and compatibility claims
- **WHEN** supported hosts, authorization or enforcement are described
- **THEN** OpenCode V2 MUST be identified as the first manual validation target, not a mandatory core dependency. Supplied successful live first-use results MUST be distinguished from independent reproduction, complete integration verification and broader compatibility claims.
- **AND** additional harness-specific implementations and validation remain deferred. Portability MUST NOT be presented as tested multi-harness compatibility.
- **AND** setup MUST document required MCP and Telegram authorization without embedding credentials or requiring an OpenCode API/password for the baseline.
- **AND** the product MUST NOT claim that MCP alone prevents execution or that it recovers an exited harness process.
- **AND** missing authorization MUST fail closed. No unauthenticated replacement API or cross-session fallback is authorized.

#### Scenario: Explain authority without claiming authenticated agent identity
- **GIVEN** documentation of request ownership and delivery
- **WHEN** transport, invocation and agent-context boundaries are explained
- **THEN** documentation MUST distinguish a protected transport principal, original-call response correlation, and the logical agent context routed by the trusted harness.
- **AND** it MUST explain the two-tool preparation/wait interaction and private capability retention, including that sharing a valid capability with another context under the same principal grants request authority in the approved bearer model but does not wake an agent.
- **AND** it MUST NOT present that model as authenticated nontransferable session identity or treat equal labels as authentication.
- **AND** capabilities MUST NOT be sent to Telegram, logs, assistant acknowledgements, or published evidence.
- **AND** these disclosures describe the approved boundary under `Exact originating-session delivery`, not proof of implementation or enhanced event routing.

#### Scenario: Exited process or unsupported host
- **GIVEN** the originating harness process has exited or lacks the capability needed for the requested delivery path
- **WHEN** continuation is requested
- **THEN** the product does not claim successful recovery or redirect the decision to a new session, and reports the unsupported or unavailable condition.

#### Scenario: Required authorization is missing
- **GIVEN** required MCP or Telegram authorization or the matching request capability and transport-principal binding is missing or invalid
- **WHEN** connection or continuation is attempted
- **THEN** the operator receives an actionable authorization failure, no unauthorized fallback is used, and no successful delivery is claimed.

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
