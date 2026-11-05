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
