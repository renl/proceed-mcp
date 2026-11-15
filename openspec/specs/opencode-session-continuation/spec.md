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

The standard MCP request tool call MUST remain waiting for the human outcome while the call and transport remain active and the request is actionable. A product-internal exchange, attempt, poll or command duration ceiling MUST NOT end that waiting call while the caller's call and transport remain active and the request is actionable.

#### Scenario: Return actual outcomes within documented waiting limits
- **GIVEN** a standard MCP request tool call
- **WHEN** it waits for or returns an outcome
- **THEN** an accepted Approve, Reject, or Respond MUST return as that call's actual result, including the request identity, outcome type, and unchanged response text where applicable. An immediate creation receipt alone MUST NOT satisfy this behavior.
- **AND** waiting-call operation MUST NOT require MCP Events, proprietary session metadata, a harness API/password, or an OpenCode API support allowlist.
- **AND** the caller's client execution and transport timeouts, together with the request's disclosed expiry, are the bounds on how long the call can wait. The product MUST document these caller-side limits and the request's disclosed expiry without promising indefinite waiting.
- **AND** expiry and explicit cancellation MUST return their non-approval closure when the call remains active. Failures MUST NOT be represented as human decisions.

#### Scenario: Waiting call outlives internal durations
- **GIVEN** a standard MCP request tool call for an actionable request whose caller's call and transport remain active, where the protected read plus handshake cost inside one waiting exchange exceeds what the old internal waiting-exchange duration left available for that work and does not exceed the ordinary exchange budget, so the request is created and the wait begins
- **WHEN** the time the product spends inside that waiting exchange exceeds that old internal waiting duration
- **THEN** the exchange and the call MUST keep waiting for the human outcome or return that outcome, and that internal waiting duration MUST NOT end the call, close the request, or be reported as an expiry, cancellation or failure.
- **AND** the caller's client execution and transport timeouts and the request's disclosed expiry MUST remain the only bounds on how long the call waits.
- **AND** a client or transport timeout MUST NOT expire or cancel the durable request, and a pending or timed-out request MUST NOT grant approval.
- **AND** a stopped or unresponsive broker MUST be surfaced when the caller's own limit is reached, without an internal capability timer closing the wait as though the request had closed, and without claiming a human decision, successful delivery, automatic resumption or late delivery.
- **AND** the request-create exchange and the registration exchanges made inside the same invocation MUST keep their existing ordinary exchange budget. This scenario's obligation is the waiting exchange's own internal duration only. Where protected read plus handshake cost also exceeds that ordinary budget, the create or registration exchange can end the call before the wait begins, and that host MUST be reported as bounded by the ordinary exchange budget rather than as receiving a working end-to-end approval from this change.

#### Scenario: Prepare private authority before the waiting interaction
- **GIVEN** a caller using the supported baseline interaction
- **WHEN** it prepares authority and makes the question's create-and-wait call
- **THEN** the supported interaction MUST prepare request-specific private authority through an ordinary MCP tool call before the question's create-and-wait call.
- **AND** preparation MUST NOT send a Telegram question, create an actionable approval, or count as delivery of a human outcome.
- **AND** the caller MUST receive the prepared request identity and authority before waiting so it can retain them if that call is lost.
- **AND** creation, retrieval, explicit cancellation, and receipt acknowledgement MUST require both the matching request capability and its bound transport principal. A model-supplied label or request ID MUST NOT substitute for either.
- **AND** baseline use MUST support shared connections without a proprietary wrapper or dedicated per-agent connection. Exact tool contracts belong to design decision 3 in the archived baseline design, `openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/design.md`.

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

The product MUST document the portable waiting-call baseline separately from trusted harness interaction and unsupported automatic continuation, including the protocol/runtime target, configuration, timeout constraints and actual verification scope. Resolving Proceed requests MUST NOT be described as bridging or bypassing native harness permissions.

#### Scenario: Disclose compatibility and enforcement limits

- **GIVEN** the preview's setup instructions and compatibility claims
- **WHEN** supported hosts, authorization or enforcement are described
- **THEN** OpenCode V2 MUST be identified as the first manual validation target, not a mandatory core dependency. Supplied successful live first-use results MUST be distinguished from independent reproduction, complete integration verification and broader compatibility claims.
- **AND** trusted harness interaction support MUST be claimed only for actually qualified versions and configurations, including concurrent-session routing and genuine human-response authority. OpenCode v2.2.5 requires that qualification before a support claim. Additional harness implementations and validation remain deferred. Portability MUST NOT be presented as tested multi-harness compatibility.
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

Cold automatic startup MUST support either a privately supplied environment token or a separately provisioned ordinary plaintext token file on Windows and POSIX. For cold automatic startup, an explicitly selected token file MUST take precedence. Otherwise a nonempty token in the configured Telegram token environment variable, `PROCEED_TELEGRAM_BOT_TOKEN` by default, MUST take precedence over the default credential file. An absent or exactly empty environment value MUST leave the default-file route available. The selected source MUST be validated without silently switching to another source on failure. File provisioning MUST be an explicit operator action through installed Proceed, with private interactive input or the existing explicitly selected nonterminal stdin route. The file MUST remain outside repositories, product state, package installation/prefix directories and harness configuration. It MUST NOT require owner-only protection. Only broker startup MUST load persisted token contents. Environment mode MAY supply the token to the trusted host and MCP startup process solely for broker startup, without requiring token persistence. Reusing a matching healthy secure broker MUST NOT require a token source or credential-file read.

#### Scenario: Explicitly provision the automatic-startup token

- **GIVEN** a clean installation and an operator choosing file-mode automatic startup
- **WHEN** the operator supplies the token through the supported one-time provisioning path
- **THEN** it is saved only in the separate plaintext credential file outside repositories, product state, package installation/prefix directories and harness configuration
- **AND** provisioning does not echo the token or expose it through CLI arguments, outputs or logs
- **AND** subsequent file-mode cold startup loads the token only in broker startup, not in the MCP adapter
- **AND** setup instructions disclose that any OS principal able to read the file can obtain the token, without promising account-only access, encryption or an OS credential store.

#### Scenario: Private interactive input belongs to Proceed

- **GIVEN** initialized protected state, an absent admissible credential destination and a trusted unrecorded interactive terminal
- **WHEN** the operator explicitly invokes installed Proceed's interactive provisioning path
- **THEN** Proceed establishes private input before consuming secret characters and accepts submission without displaying the token, masking characters or token length
- **AND** it restores the original terminal mode and releases its input listeners on success or any failure
- **AND** successful setup reports only the credential path and storage/trust guidance, not Telegram validity, pairing or approval
- **AND** package installation, ordinary MCP startup, pairing and foreground startup never automatically prompt for a token.

#### Scenario: Preserve explicit nonterminal input

- **GIVEN** an operator explicitly chooses the existing nonterminal stdin provisioning route
- **WHEN** provisioning runs
- **THEN** its terminal refusal, bounded validated input and EOF requirement remain effective
- **AND** Proceed does not silently switch between interactive and stdin modes.

#### Scenario: Cold startup uses a private environment token without a token file

- **GIVEN** otherwise complete supported setup, safely stopped state, no token file and a valid token privately supplied by the trusted launch environment
- **WHEN** normal MCP startup needs to start the broker
- **THEN** the broker uses that token without requiring file provisioning or a manual broker terminal
- **AND** the product does not persist the environment token.

#### Scenario: Select one cold-start source deterministically

- **GIVEN** more than one token source is available for cold automatic startup
- **WHEN** startup selects its source
- **THEN** an explicit token-file selection wins over the environment and default file, otherwise a nonempty environment token wins over the default file
- **AND** an unavailable, invalid or storage-separation-violating selected source fails without trying a lower-priority source.

#### Scenario: Fresh harness launch uses the configured credential

- **GIVEN** completed supported setup and an unchanged usable plaintext credential on Windows or POSIX, with the broker safely stopped
- **AND** a fresh supported harness process has no Telegram token in its actual launch environment or configuration
- **WHEN** normal MCP startup selects the default credential or the same explicit credential path used during setup
- **THEN** broker startup loads that credential without token re-entry, harness-specific secret handling or a separate broker terminal
- **AND** the adapter, TUI, readiness probes and metadata helpers do not load persisted token contents
- **AND** the same configured state and credential selection remain usable through normal MCP startup by another supported harness without provisioning its token again.

#### Scenario: Healthy reuse needs no credential access

- **GIVEN** a matching healthy secure broker already serves the configured state
- **WHEN** another configured adapter starts without a token source
- **THEN** it reuses the broker without a credential-file read, another broker or another Telegram poller
- **AND** it preserves authenticated confidential admission, existing work and human authority.

### Requirement: Provisioning and startup prevent token disclosure

Provisioning and startup MUST NOT echo the token or expose it through CLI arguments, MCP client configuration including JSON environment entries, tool or environment outputs, diagnostics, logs, package contents or published evidence. The token MUST NOT enter repositories, product state, state journals or request history. The product MUST NOT read `.env` files for this provisioning or startup path. Private environment inheritance by the trusted host and MCP startup process is permitted only for the supported environment route. Product-launched helpers that do not need the Telegram token MUST NOT inherit it. File mode MUST NOT supply file contents to the adapter environment. Provisioning MUST NOT automatically capture an environment token or expose an agent-facing MCP provisioning tool. Invalid arguments and private-input failures MUST use value-free diagnostics without reproducing supplied values, token fragments or raw input. These obligations govern product handling, not unrelated parent processes.

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

#### Scenario: Reject secret-bearing arguments without reproducing them

- **GIVEN** unsupported provisioning arguments, positional token data or invalid private input
- **WHEN** Proceed rejects the invocation or input
- **THEN** diagnostics do not repeat supplied values, token fragments, raw terminal events or secret-bearing parser errors
- **AND** an environment token or `.env` file does not become a substitute provisioning input.

### Requirement: Credential provisioning and loading fail closed

Telegram token-file provisioning and loading MUST use ordinary OS file access without token-specific ACL, owner, inheritance, exact-mode or local-fixed-NTFS protection admission. These operations MUST NOT query or repair token-file or dedicated credential-parent permissions as a prerequisite, require a special protected parent, or refuse solely because other OS principals have access. They MUST NOT perform token-specific chmod repair. Ordinary OS permissions, I/O errors and native permission prompts still apply. This exception MUST NOT weaken protection for approval state, journals, control/owner credentials, confidential-channel keys, operator keys or private request authority.

Provisioning MUST verify command prerequisites, destination separation, destination absence and usable private input before consuming token input. Separation MUST cover the eventual destination even when parent directories do not yet exist and MUST NOT be bypassed by path resolution or redirection. Existing destinations MUST NOT be opened for content comparison, adopted as successful provisioning or overwritten. Creation MUST be exclusive. Ordinary file type, identity and write-completion checks MUST prevent reporting success for a different destination or an incomplete write. They MUST NOT become owner-only protection gates or a promise of resistance to hostile local mutation. Loading MUST establish required storage separation and load a valid selected file for broker startup without permission-protection snapshots. Observed file replacement or incomplete access MUST produce failure rather than successful loading. No native handle-pinning or adversarial race-protection framework is required.

Missing, empty, invalid or unreadable selected credentials and invalid selected environment tokens MUST produce actionable secret-free cold-start failure, not approval or a claim of working Telegram approval. Startup failure MUST NOT prompt for a secret, obtain one from agent arguments or silently change sources. Failure MUST preserve preexisting and uncertain objects, existing pairing, keys, durable work and uncertain broker ownership. Cleanup MUST be limited to objects still proven to belong to the attempt.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the selected file credential is missing, empty, invalid, unreadable or violates required storage separation
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses or fails for that prerequisite with a supported operator next step and no token disclosure
- **AND** it does not bypass ordinary OS access denial, load a separation-violating token, claim working Telegram approval or return a human decision.

#### Scenario: No usable cold-start source is available

- **GIVEN** cold startup is needed and the environment token is absent or empty with no usable selected file, or a nonempty selected environment token is invalid
- **WHEN** normal MCP startup attempts to start the broker
- **THEN** startup fails with a supported next step to supply the token privately at launch or correct the selected file prerequisite through supported operator action
- **AND** it neither prompts for a secret nor obtains one from agent arguments, discloses token values, falls back after selected-source failure or returns a human decision.

#### Scenario: Supported Windows credentials can be provisioned and loaded

- **GIVEN** the documented Windows runtime, an absent separated token destination and ordinary OS access sufficient to create and later read the file
- **WHEN** the operator provisions a new credential and a later cold broker startup selects it
- **THEN** both operations can succeed without token-specific ownership, ACL, inheritance or NTFS admission
- **AND** refusing every Windows persisted-credential operation does not satisfy this requirement.

#### Scenario: Windows file protection is unsupported or unverifiable

- **GIVEN** ordinary file access and storage separation are usable but Windows token protection queries are unavailable or the storage is outside the former local-fixed-NTFS envelope
- **WHEN** provisioning or selected-file loading is attempted
- **THEN** protection-query availability and that former envelope do not block the operation
- **AND** actual selected-file failure does not fall back to the environment
- **AND** environment-mode startup without explicit file selection requires no token-file provisioning or loading.

#### Scenario: Windows parent inheritance is unsafe

- **GIVEN** an otherwise usable separated default or explicit token destination whose parent permits access by additional OS principals, including ordinary inherited Windows permissions or POSIX modes other than 0700/0600
- **WHEN** provisioning validates the destination or cold startup loads the selected file
- **THEN** those permissions and differing ownership do not cause refusal or permission repair
- **AND** no account-only inheritance preparation or exact-mode prerequisite is imposed.

#### Scenario: Existing destination or create race prevents replacement

- **GIVEN** a credential destination already exists or appears before exclusive creation
- **WHEN** the operator attempts provisioning
- **THEN** Proceed refuses without opening its contents for comparison, overwriting it, rotating credentials or claiming successful provisioning
- **AND** a destination found during initial validation is refused before token input
- **AND** preexisting or uncertain artifacts are preserved.

#### Scenario: Private input is cancelled or unavailable

- **GIVEN** the operator invokes interactive provisioning
- **WHEN** private terminal input cannot be established, or input is cancelled, invalid, times out or reaches EOF before submission
- **THEN** no credential is written and no echoed-input fallback is used
- **AND** private-input unavailability refuses before consuming secret characters
- **AND** any acquired terminal mode and input listeners are restored or released with secret-free guidance.

#### Scenario: Protection changes during credential access

- **GIVEN** initial ordinary path and I/O checks succeeded
- **WHEN** the operation observes destination replacement, loss of required separation or incomplete file access
- **THEN** it reports failure rather than success and does not release a loaded token to broker startup
- **AND** cleanup preserves objects whose ownership by the attempt cannot still be proven
- **AND** a permission change alone is not grounds for refusal when ordinary file access still succeeds and required separation is retained.

### Requirement: Credential limitations and foreground compatibility remain explicit

The product MUST document that the separate Telegram token file is ordinary plaintext. Any OS principal able to read the file can obtain and misuse the token. Proceed MUST NOT promise owner-only access, encryption, an OS credential store, historical confidentiality or resistance to local file mutation. It MUST disclose trusted runtime/package assumptions and exposure through administrators, other processes with OS access and backups. These token-file limitations MUST be distinguished from the unchanged protection of approval state, journals, control/owner credentials, channel/operator keys, pairing and request/decision authority.

Environment-mode instructions MUST disclose that the trusted host and MCP startup process may hold the token and that each fresh launch requires the trusted launch environment to supply it again. They MUST NOT require global or user-wide token persistence or promise one-time persistent, login or reboot setup for environment mode. Persisted-mode instructions MUST explain one-time private Proceed provisioning of the plaintext file, storage separation, consistent explicit-path selection and removal of higher-priority tokens from the actual launch environment to use the default file. Persisted credentials MUST remain available when the operator next starts the harness after login or reboot, without installing an automatic service. Existing foreground broker use with a token supplied only through its own process environment MUST remain supported without persistent token provisioning. Legacy HTTP foreground serving MUST remain available to legacy clients. Secure foreground serving MUST permit upgraded-client reuse without a token file. Changing a launch token or file selection MUST NOT be described as rotating an already running broker's token. Rotation requires supported broker stop and replacement without ownership takeover.

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

#### Scenario: Persisted setup survives a later login or reboot

- **GIVEN** supported persisted setup with an unchanged usable plaintext credential and protected state paths
- **WHEN** the operator next launches a supported harness after login or reboot without a Telegram token in its actual environment or configuration
- **THEN** normal MCP startup can use the persisted credential without token re-entry or a separate broker terminal
- **AND** no automatic login/reboot service, harness integration or native permission bridge is required or installed.

#### Scenario: Disclose verification and storage limits honestly

- **GIVEN** documentation or evidence for the persisted route
- **WHEN** Windows or POSIX storage and setup success are described
- **THEN** plaintext exposure and the absence of token-specific permission protection are explicit, with protected state/key requirements separately retained
- **AND** source review and controlled unit results are not presented as proof of terminal privacy, fresh-launch behavior, installed first use or Telegram delivery
- **AND** unrun outcomes and compatibility checks remain unverified rather than inheriting preview.3 acceptance.

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

An empty installation MUST remain unpaired with no requests or decisions until supported setup and approval actions create them. The documented installed-product setup path MUST create required protected state, a transport principal, either private launch-environment token supply or broker-only plaintext-file credential provisioning, and operator-authorized private pairing without manual stored-data editing. Windows and POSIX persisted setup MUST include explicit private Proceed provisioning without token-specific permission preparation and subsequent normal MCP startup without harness token supply. After setup, normal MCP use with the selected source available MUST support the first useful approval interaction with no separate manual broker launch. Setup instructions MUST distinguish environment supply on each fresh launch from one-time file provisioning. Existing safe state, keys and pairing MUST remain usable without reinitialization. Credential setup MUST NOT enable disabled integrations, create human decision authority or alter native harness permissions.

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

#### Scenario: First persisted approval follows a fresh token-free launch

- **GIVEN** an empty Windows or POSIX installation meeting protected-state and external prerequisites, with ordinary OS access to a separated token destination
- **WHEN** the operator uses supported setup for protected state, a transport principal, private Proceed plaintext credential provisioning and authorized private-chat pairing
- **AND** safely stops the broker and starts a fresh supported harness without a Telegram token in its environment or configuration
- **AND** normal MCP use prepares private authority and requests approval, and the paired human selects Approve while the call remains active
- **THEN** the same waiting call returns the matching explicit approval without token re-entry, token-specific permission preparation or a separate broker terminal
- **AND** local provisioning or readiness alone is not reported as human receipt or confirmed outcome delivery.

#### Scenario: Existing setup retains its authority boundary

- **GIVEN** safe existing state with keys, pairing, pending requests and recorded decisions
- **WHEN** the operator configures a new separate credential destination or later uses the persisted route
- **THEN** existing state remains usable without reinitialization or migration, and durable work keeps its existing expiry and single-resolution semantics
- **AND** credential setup does not enable a disabled integration, enroll a human decision-maker, bypass native permissions or take over uncertain broker ownership.

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

### Requirement: Trusted harness human decision authority

Harness decisions MUST require an operator-configured trusted harness interaction that establishes a genuine local human response bound to the specific Proceed request. The local operator is an additional authorized decision-maker, not necessarily the paired Telegram person. Capability advertisement, ordinary response correlation and session routing metadata MUST NOT alone establish human authority.

#### Scenario: Establish trusted operator access

- **GIVEN** an operator has explicitly configured a trusted harness interaction over the approved protected local and principal boundary
- **WHEN** that interaction establishes its local human's request-bound choice
- **THEN** the choice is eligible for validation and acceptance for that request only
- **AND** the same-account trust limitation is disclosed without claiming isolation from hostile same-account processes.

#### Scenario: Agent or untrusted client claims human authority

- **GIVEN** agent text, ordinary API reply records, tool arguments, a caller-supplied human flag or a client advertising an interaction capability without configured trust
- **WHEN** it claims to Approve, Reject or Respond as a human
- **THEN** no human decision authority is granted and no decision is recorded through that claim
- **AND** no agent-facing approval-submission tool or standing grant is provided.

### Requirement: Harness interaction preserves merged delivery safeguards

The existing delivery requirements in `openspec/specs/opencode-session-continuation/spec.md` for protected storage, authenticated confidential admission on every connection, private capability and principal boundaries, truthful readiness and shared-broker lifecycle MUST remain effective. This is a repository-relative path.

#### Scenario: Preserve safeguards with the harness channel enabled

- **GIVEN** the trusted harness channel is configured
- **WHEN** setup, connection, request handling, status reporting or shared-broker lifecycle operations occur
- **THEN** all merged delivery baseline safeguards remain effective without weakened protection, admission, authority boundaries, readiness reporting or lifecycle guarantees.

### Requirement: One request on two human surfaces

A mirrored request MUST remain one durable Proceed request with the same action, distinguishing context, expiry deadline and explicit Approve, Reject and Respond choices on both surfaces. Private request capabilities and credentials MUST NOT appear in human forms, messages, logs or published evidence. Session labels MUST remain routing context, not authentication.

#### Scenario: Present the same actionable request

- **GIVEN** a durably recorded actionable request and an available configured trusted interaction
- **WHEN** it is presented in Telegram and the harness
- **THEN** both identify the same request and show its action, distinguishing context, deadline and three choices without private authority
- **AND** a form submission is validated as a domain choice rather than automatically treated as Approve because the form was accepted.

### Requirement: First accepted valid decision resolves once

Both surfaces MUST compete for the same durable resolution. Only the first valid authorized choice accepted while the request is pending and unexpired MUST take effect. Duplicate, stale, losing or mismatched answers MUST NOT overwrite a resolution, add decision effects or authorize another request.

#### Scenario: Conflicting choices race across surfaces

- **GIVEN** the same pending request appears on both surfaces
- **WHEN** conflicting authorized choices arrive concurrently before expiry
- **THEN** exactly one is accepted and durably retained, with the same outcome available through existing authorized delivery and retrieval
- **AND** the losing answer cannot change that outcome or become a decision for subsequent work.

#### Scenario: Late host response targets a closed request

- **GIVEN** the host interaction belongs to a request already resolved, expired or explicitly cancelled
- **WHEN** its response arrives, including after a different request starts in that session
- **THEN** no decision is accepted for either request from that late response.

### Requirement: Host interaction failure preserves durable Telegram access

Declining or cancelling a host form, interaction failure, network loss or loss of the waiting call MUST NOT imply approval or silently close the durable request. Unless separately explicitly cancelled, resolved or expired, the Telegram request MUST remain actionable under existing authorization and retention rules.

#### Scenario: Host form does not produce a valid decision

- **GIVEN** an unresolved unexpired mirrored request
- **WHEN** the human declines or cancels the form, the response is invalid, interaction transport fails or the waiting call is lost
- **THEN** no decision is inferred and the durable request remains pending for Telegram
- **AND** no successful outcome delivery or automatic session resumption is claimed.

### Requirement: One unresolved request per trusted harness session

Each trusted harness session MUST have at most one unresolved Proceed request. Replaying the same pending request MUST be idempotent. A different new request in that occupied session MUST receive an explicit busy result without creating a second actionable request or silently discarding either request. Distinct sessions MUST be able to proceed concurrently without a global queue.

#### Scenario: Replay or second request in an occupied session

- **GIVEN** a session has an unresolved request, including after form dismissal or loss of its waiting call
- **WHEN** the same request is replayed or a different new request is attempted
- **THEN** replay retains the existing identity and deadline without duplicate decision effects
- **AND** a different new request receives an explicit busy result without another actionable Telegram or harness request.

#### Scenario: Distinct sessions resolve in reverse order

- **GIVEN** distinct trusted harness sessions each have a pending request
- **WHEN** humans resolve the requests in reverse order using either surface
- **THEN** both can proceed concurrently and each accepted result remains bound to its request and original invoking context
- **AND** unavailable safe host-session routing disables that host path rather than selecting the foreground or most recent session.

### Requirement: Resolved surfaces report honest nonactionable status

After resolution or closure, the product MUST make best-effort updates to close or mark the other surface nonactionable. Failure to update a surface MUST NOT reopen a request or weaken rejection of stale answers. Status MUST distinguish recorded decisions, surface updates and confirmed originating-call delivery.

#### Scenario: Other surface cannot be updated

- **GIVEN** a request is resolved or closed and the other surface is unreachable or cannot dismiss its interface
- **WHEN** the product reports the outcome
- **THEN** the durable resolution remains unchanged, subsequent answers have no effect and any claimed surface closure or delivery reflects actual confirmation only.

### Requirement: First dual-channel action through supported setup

A clean installation MUST have no requests, decisions, pairing or configured harness decision authority. Supported setup MUST establish protected state, the local transport principal, operator-authorized Telegram pairing and explicit trusted-harness configuration without manual stored-data editing. Setup MUST NOT create an approval or waive native permission rules.

#### Scenario: Resolve the first request from an empty installation

- **GIVEN** a clean installation and operator access to the documented prerequisites
- **WHEN** the operator completes supported setup, uses normal MCP startup, prepares private request authority and requests approval through the existing waiting-call interaction
- **THEN** the first Proceed request is actionable in Telegram and the qualified trusted harness without a recurring manual broker terminal
- **AND** an explicit valid harness Approve returns the matching recorded approval on the active originating call without native permission bypass.

#### Scenario: Host interaction is unsupported or not trusted

- **GIVEN** a client lacks the required declared interaction capability, configured trust or qualified request/session routing
- **WHEN** it requests a Proceed approval through the portable baseline
- **THEN** no unsupported host interaction is attempted and Telegram waiting-call operation remains available
- **AND** the missing host path and supported next step are reported without granting substitute authority.

### Requirement: Broker-owned harness eligibility status

Harness-channel status MUST reflect the broker-owned established request context and current eligibility, never the observing adapter's configuration. Authorized observers MUST receive identical status for an unchanged request context and eligibility, including after broker restart. Actual enrollment, revocation, enablement or closure MAY change status.

#### Scenario: Absent-route reasons remain consistent across adapters and restart

- **GIVEN** one pending request prepared without a configured host and another prepared with a configured host but without safe session routing
- **AND** authorized observers use adapters with different host configurations
- **WHEN** those observers retrieve both requests before and after broker restart with request context and eligibility unchanged
- **THEN** every observation of the first request reports `unavailable/HOST_NOT_CONFIGURED` and every observation of the second reports `unavailable/SESSION_ROUTE_UNAVAILABLE`
- **AND** neither observer configuration nor restart retargets either handle, grants human authority or changes the reported reason.

### Requirement: Harness eligibility priority and authority limits

Terminal requests MUST report `closed` with reason `null` first. Pending requests MUST follow the new-preparation priority below, subject to the bounded legacy exception. Observation MUST NOT retarget an unrouted handle or grant human authority. Eligibility MUST NOT imply display, human receipt or outcome delivery.

#### Scenario: Evaluate pending status in priority order

- **GIVEN** a pending request with known preparation-time host configuration
- **WHEN** harness-channel status is evaluated
- **THEN** pending requests MUST report, in priority order, `unavailable/HOST_NOT_CONFIGURED` when preparation had no configured host, `unavailable/SESSION_ROUTE_UNAVAILABLE` when a configured host lacks safe request routing or routing is not enabled, `unavailable/OPERATOR_NOT_ENROLLED` when an enabled route lacks active matching operator enrollment, otherwise `eligible` with reason `null`.

### Requirement: Legacy harness eligibility preserves known route evidence

Legacy status MUST preserve retained valid routes without inferring eligibility from missing metadata. For a legacy pending request without a retained safe route and with unknown preparation-time host configuration, status MUST report `unavailable/SESSION_ROUTE_UNAVAILABLE`. This is a bounded exception to the normal new-preparation priority. Terminal status MUST still take precedence as `closed` with reason `null`.

#### Scenario: Evaluate retained legacy route without newer metadata

- **GIVEN** a legacy request with a retained valid route
- **WHEN** harness-channel status is evaluated
- **THEN** the request MUST be evaluated using normal route enablement and active matching operator enrollment
- **AND** missing newer metadata alone MUST neither grant eligibility nor invalidate that retained route.

#### Scenario: Interpret the legacy absent-route fallback

- **GIVEN** a legacy pending request without a retained safe route and with unknown preparation-time host configuration
- **WHEN** status reports `unavailable/SESSION_ROUTE_UNAVAILABLE`
- **THEN** the reason means no safe route was established, not that a host was known to be configured at preparation.

### Requirement: Legacy observation preserves requests without route repair

Observation, broker restart, current adapter configuration and operator enrollment MUST NOT repair an unrouted legacy request or target it to a new route. Handling legacy requests MUST NOT require migration writes, guessed backfills, deletion or retargeting. Existing authorized retrieval, Telegram access, expiry and recorded outcomes MUST remain unchanged.

#### Scenario: Legacy unknown preparation context remains stable and retrievable

- **GIVEN** a legacy pending request has no retained safe route and its preparation-time host configuration is unknown
- **AND** authorized observers use adapters with different current host configurations and operator enrollment
- **WHEN** those observers retrieve the request before and after broker restart with request context and eligibility unchanged
- **THEN** every observation reports `unavailable/SESSION_ROUTE_UNAVAILABLE` without assuming a host was configured at preparation
- **AND** observation, restart, adapter configuration and enrollment do not establish or retarget a route, grant human authority, trigger migration writes or guessed backfills, or delete the request
- **AND** existing authorized retrieval, Telegram access, expiry and recorded outcomes remain unchanged, with any subsequent terminal status reported first as `closed` with reason `null`
- **AND** configuration guidance concerns future requests only, not retroactive repair of this request.

#### Scenario: Offer future configuration without retroactive repair

- **GIVEN** an existing unrouted legacy request
- **WHEN** configuration guidance is provided
- **THEN** guidance about future configuration MUST apply to future requests, not claim to repair an existing unrouted request retroactively.

### Requirement: Document the dual-channel operating boundary

The README MUST explain trusted-harness setup, the additional local operator's authority, one unresolved request per session, concurrent distinct sessions, first-accepted resolution, instruction-only Respond and Telegram fallback. It MUST distinguish Proceed requests from the separate native-permission bridge and document native permissions as independently effective.

#### Scenario: Operator reads setup before first use

- **GIVEN** an operator preparing to enable the harness decision path
- **WHEN** the operator follows the README
- **THEN** the supported setup and these operating limits are explicit without secret-bearing examples or claims that unsupported hosts or native permission bridging work.

### Requirement: Windows environment startup and trusted TUI setup work

With documented prerequisites and safe storage, Windows setup MUST establish protected state, control and owner credentials, the confidential-channel key and the operator key required by the existing trusted TUI enrollment path. Normal MCP startup MUST support the privately supplied environment-token route without a Telegram token file or separate broker terminal. Refusing every Windows operation MUST NOT satisfy this requirement. Existing token-source precedence, confidentiality, non-persistence, helper environment filtering and trusted-human authority requirements MUST remain effective.

#### Scenario: Complete Windows environment setup and first approval

- **GIVEN** a clean Windows installation with documented prerequisites and no configuration, pairing, requests or decisions
- **WHEN** supported setup creates protected state, a transport principal and operator-authorized private pairing without manual stored-data edits
- **AND** the trusted launch environment privately supplies a valid token, with no explicit token-file selection and no token file
- **AND** normal MCP use calls `prepare_approval`, then `request_approval` with its returned private authority, and the paired human approves while the call remains active
- **THEN** the waiting call returns the matching explicit approval without a separate broker terminal
- **AND** the product neither persists the token nor requires `doctor`, delivery retry, a proprietary host API or manual stored-data editing
- **AND** setup and startup alone create no request or approval.

#### Scenario: Protected operator setup supports trusted TUI use

- **GIVEN** safe Windows storage and an operator configuring the existing trusted TUI interaction
- **WHEN** supported enrollment creates the operator key and the configured TUI connects
- **THEN** the key and local channel satisfy existing protection and authenticated confidential admission requirements
- **AND** existing request-bound human decisions work without changing pairing, principal boundaries or decision authority.

### Requirement: Windows state and credential admission verifies required protection

Windows setup and admission MUST verify required ownership, ACLs, safe ancestry and redirected-path protection for affected state, control/owner credentials, channel keys and operator keys. Unsafe or unverifiable protection MUST cause refusal before secret reads, secret writes, private-authority disclosure or readiness through affected storage. Missing, null, empty or unreadable ACL evidence MUST NOT count as verified owner-only protection. Diagnostics MUST be actionable and secret-free and MUST NOT claim protection that was not verified.

#### Scenario: Safe Windows storage is admitted

- **GIVEN** Windows state and required local credentials satisfy the applicable owner-only and ancestry protection requirements
- **WHEN** supported setup or startup verifies that protection
- **THEN** the operation can proceed without skipping Windows checks or weakening authenticated local access
- **AND** local readiness alone does not claim Telegram availability, pairing, human receipt or confirmed delivery.

#### Scenario: Unsafe or unverifiable Windows storage is refused

- **GIVEN** affected Windows storage has an unsafe owner, ACL, ancestry or redirection, or required protection cannot be verified
- **WHEN** setup, startup or trusted TUI access attempts to use it
- **THEN** admission refuses before secret reads, secret writes, private-authority disclosure or readiness through that storage
- **AND** no assumed-safe ancestor, empty permission result or unsupported check authorizes access.

### Requirement: Windows protection correction preserves existing storage

Protection correction MUST NOT automatically repair unsafe storage, overwrite existing credential or key destinations, rewrite or migrate existing journal or pairing, or remove uncertain broker ownership records to succeed. Safe existing Windows state MUST remain usable without reinitialization or manual stored-data migration. Existing durable work, create-only credential/key behavior and POSIX file/environment safeguards MUST remain effective.

#### Scenario: Existing state or credential destination is encountered

- **GIVEN** existing Windows state, keys, credentials or an uncertain ownership record
- **WHEN** setup or admission encounters them
- **THEN** create-only operations refuse existing destinations without overwrite or automatic repair
- **AND** admissible existing state retains pairing, pending work and recorded outcomes under existing expiry and single-resolution rules
- **AND** unsafe or unverifiable storage is refused without rewriting durable work or deleting uncertain ownership records.

### Requirement: Provisioning releases its input lifecycle without disrupting callers

Interactive credential provisioning MUST release input activity acquired by its attempt on success and every failure, including cancellation. Cleanup MUST preserve unrelated caller resources, listeners and preexisting input use.

#### Scenario: Standalone completion requires no further input

- **GIVEN** a standalone provisioning command with no unrelated outstanding work
- **WHEN** its result and cleanup are complete
- **THEN** it MUST return control to the shell without further input, interruption or waiting for an input timeout
- **AND** cleanup MUST NOT force termination of an embedding caller or close shared input to make the standalone command exit.

#### Scenario: Existing credential protections remain effective

- **GIVEN** interactive credential provisioning
- **WHEN** provisioning succeeds or fails, including cancellation
- **THEN** existing private-input, terminal-mode restoration, token nondisclosure, exclusive creation and preservation of preexisting or uncertain objects requirements remain unchanged.

#### Scenario: First provisioning completes from a clean installation

- **GIVEN** a clean installation whose operator has initialized protected state through supported setup, an absent admissible credential destination and a trusted unrecorded interactive terminal
- **WHEN** the operator submits a valid token through supported interactive provisioning and creation succeeds
- **THEN** provisioning reports success without disclosing the token
- **AND** its terminal and input cleanup completes
- **AND** the standalone command returns control to the shell without another keystroke, interruption or input-timeout wait.

#### Scenario: Failed provisioning does not retain input activity

- **GIVEN** standalone interactive provisioning with no unrelated outstanding work
- **WHEN** it fails before or after acquiring private input, including cancellation, invalid input, input timeout, premature EOF or credential creation failure
- **THEN** it reports the applicable secret-free failure and releases any input activity acquired by the attempt
- **AND** it returns control to the shell without additional input, interruption or another input-timeout wait
- **AND** existing no-write and ownership-limited cleanup rules remain effective.

#### Scenario: Cleanup preserves unrelated caller input use

- **GIVEN** provisioning is invoked by a caller that already uses the input resource or has unrelated listeners or outstanding work
- **WHEN** provisioning succeeds or fails
- **THEN** its own input activity is released without removing unrelated listeners, closing shared input, interrupting the caller's preexisting input use or terminating unrelated work.
