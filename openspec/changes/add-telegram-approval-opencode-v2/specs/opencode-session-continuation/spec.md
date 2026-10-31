# Spec Delta

## Purpose

Deliver remote decisions to the exact requesting running OpenCode V2 session, including after its original MCP call times out. Parent: [proposal](../../proposal.md). Status: Draft for product approval.

## ADDED Requirements

### Requirement: Exact originating-session delivery
The product MUST associate each request with its originating OpenCode V2 session and deliver its accepted outcome only to that session. It MUST NOT substitute the foreground, most recent, or another available session when the origin is unavailable or ambiguous.

#### Scenario: Decisions arrive out of order
- **GIVEN** two running sessions with separate pending requests
- **WHEN** the human resolves them in reverse order
- **THEN** each session receives only the outcome for its own request.

#### Scenario: Origin cannot be identified safely
- **GIVEN** an accepted decision whose originating session cannot be unambiguously reached
- **WHEN** delivery is attempted
- **THEN** no other session receives it and delivery is reported as unconfirmed or failed.

### Requirement: Outcomes preserve human intent
The receiving session MUST be given the request identity and its accepted approval, rejection, or response text without changing the outcome type. Respond MUST continue the session with instructions, not approval. Rejection MUST NOT be represented as authorization to perform the rejected action.

#### Scenario: Receive each decision type
- **GIVEN** an accepted Approve, Reject, or Respond outcome
- **WHEN** the originating session receives it
- **THEN** it receives the matching request and outcome type, including unchanged response text for Respond.

### Requirement: Continuation after tool timeout
While the originating OpenCode V2 host process remains running and the session remains available, the product MUST support targeted continuation with an accepted decision even after the original MCP tool call times out. Tool timeout alone MUST NOT expire or cancel the request. Posting an ordinary MCP notification without evidence of session continuation MUST NOT satisfy delivery.

#### Scenario: Decision before tool completion
- **GIVEN** the original request call remains active
- **WHEN** the human resolves the request
- **THEN** the originating session receives that outcome without requiring the human to return to the terminal.

#### Scenario: Decision after tool timeout
- **GIVEN** the original tool call timed out, the request is still pending and unexpired, and its OpenCode V2 host and session remain available
- **WHEN** the human resolves the request in Telegram
- **THEN** that exact session continues with the accepted outcome without a manual terminal message or a replacement request.

### Requirement: Safe pending delivery and replay
The product MUST retain accepted outcomes until their delivery status is known. Temporary host unavailability or a busy session MUST NOT be reported as successful continuation. Once the same running session can receive the outcome, supported recovery MUST allow delivery without creating another decision or duplicate decision-driven continuation. The product MUST expose an actionable pending or failed state when it cannot confirm delivery.

#### Scenario: Host cannot accept continuation yet
- **GIVEN** an accepted outcome and a running originating session that cannot currently accept it
- **WHEN** the product attempts delivery
- **THEN** the outcome stays recorded with pending or failed delivery, and no successful continuation is claimed.

#### Scenario: Recover delivery without duplicate effects
- **GIVEN** an accepted outcome and repeated transport events or a product restart while the OpenCode host remains running
- **WHEN** delivery resumes or is retried
- **THEN** the original session receives the outcome without an additional decision-driven continuation for the same request.

### Requirement: Honest compatibility and enforcement boundary
The first release MUST support only explicitly documented and verified OpenCode V2 versions and connection prerequisites. Setup MUST document required authorization without embedding credentials. The product MUST NOT claim that MCP alone prevents execution, supports other harnesses, or recovers an exited OpenCode process.

#### Scenario: Exited process or unsupported host
- **GIVEN** the originating OpenCode process has exited or the configured host is unsupported
- **WHEN** continuation is requested
- **THEN** the product does not claim successful recovery or redirect the decision to a new session, and reports the unsupported or unavailable condition.

#### Scenario: Required authorization is missing
- **GIVEN** the OpenCode integration requires authorization that is missing or invalid
- **WHEN** connection or continuation is attempted
- **THEN** the operator receives an actionable authorization failure, no unauthorized fallback is used, and no successful delivery is claimed.

## Related Artifacts

- [Decision safety and durable state](../telegram-approval/spec.md)
- [Clean first-use acceptance](../npm-distribution/spec.md)
