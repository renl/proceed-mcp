# Delta for opencode-session-continuation

## MODIFIED Requirements

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
