## ADDED Requirements

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

The merged [delivery baseline](../../../../specs/opencode-session-continuation/spec.md) requirements for protected storage, authenticated confidential admission on every connection, private capability and principal boundaries, truthful readiness and shared-broker lifecycle MUST remain effective.

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

## MODIFIED Requirements

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
