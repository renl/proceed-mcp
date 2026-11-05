# Spec Delta

## Purpose

Let a paired human safely approve, reject, or instruct remote work through private Telegram messages. Parent: [proposal](../../proposal.md).

Preview acceptance follows the proposal's [scoped risk acceptance](../../proposal.md#approved-preview-boundary-and-scoped-risk-acceptance). The behavior below remains required. Live first use was deferred from prepublication acceptance. Subsequent supplied manual evidence reports pairing and Approve/Reject/exact Respond with concurrent correlation and acknowledgements, not independent full-release verification. Unexecuted checks remain unverified. Controlled evidence alone does not establish human receipt or OpenCode compatibility.

## ADDED Requirements

### Requirement: Explicit first-use pairing
The product MUST start with no paired human, requests, or decisions. It MUST provide a documented operator-authorized setup path to configure Telegram access and pair one human's private chat. Unsolicited incoming messages MUST NOT establish authority to decide requests.

#### Scenario: Establish a first pairing
- **GIVEN** a clean installation with no stored pairing
- **WHEN** the operator completes the documented configuration and pairing path
- **THEN** the selected human's private chat can receive requests and submit decisions without manually editing stored product data.

#### Scenario: Unpaired or group message
- **GIVEN** an unpaired sender or a group chat
- **WHEN** it attempts pairing without operator authorization or submits a request decision
- **THEN** no pairing or decision is accepted and no request details are disclosed to that sender or group.

### Requirement: Distinguishable approval requests
Each request MUST have a stable identity, capability-and-transport-principal ownership, and original-call correlation as defined by [delivery ownership](../opencode-session-continuation/spec.md). Originating-session associations in this spec mean that request context and routing, not independently authenticated nontransferable agent identity.

#### Scenario: Present a durable distinguishable question
- **GIVEN** a request for presentation to the paired human
- **WHEN** the request is presented as actionable
- **THEN** the paired human MUST see the requested action, enough context to distinguish its session from other pending work, its expiry, and Approve, Reject, and Respond choices.
- **AND** a request MUST be durably recorded before it is presented as actionable.

#### Scenario: Keep displayed context separate from private authority
- **GIVEN** request preparation, presentation and associated request access
- **WHEN** labels, request identity or capabilities are used
- **THEN** displayed session labels MUST be identified as caller-supplied context, not authenticated agent identity.
- **AND** request preparation alone MUST NOT create an actionable Telegram message.
- **AND** request capabilities MUST NOT be included in Telegram messages, logs, assistant acknowledgements, or published evidence. Knowing a displayed request identity or label MUST NOT authorize MCP request access.
- **AND** sharing a key within its bound transport principal transfers request access, not the paired human's authority to Approve, Reject, or Respond.

#### Scenario: Parallel requests
- **GIVEN** two sessions requesting approval at the same time
- **WHEN** their requests appear in Telegram
- **THEN** the human can distinguish their sessions and requested actions, and each choice applies only to its identified request.

### Requirement: Explicit approval and rejection
Only an explicit Approve choice from the paired human for an actionable request MUST produce an approval. An explicit Reject choice MUST produce a rejection for that request, not authorization to perform the requested action.

#### Scenario: Approve a pending request
- **GIVEN** an unexpired pending request
- **WHEN** the paired human explicitly selects Approve for it
- **THEN** the product records approval for that request and confirms the recorded choice to the human.

#### Scenario: Reject a pending request
- **GIVEN** an unexpired pending request
- **WHEN** the paired human explicitly selects Reject for it
- **THEN** the product records rejection and confirms it without recording approval.

### Requirement: Responses are instructions only
Respond MUST allow the paired human to supply text associated with one identified pending request. Accepting that response MUST resolve the request as an instruction response, not as approval or rejection. Performing an action that still requires approval MUST require a separate explicit approval; response text MUST NOT satisfy it.

#### Scenario: Respond with approval-like text
- **GIVEN** the human selects Respond for a pending request
- **WHEN** the human submits text, including text such as "yes" or "approved"
- **THEN** the text is recorded as instructions for that request and no approval is recorded.

#### Scenario: Ambiguous typed reply
- **GIVEN** multiple requests are pending
- **WHEN** text cannot be unambiguously associated with one request
- **THEN** it is not applied to any request and the human is asked to identify the intended request.

### Requirement: Durable decisions and single resolution
Requests, accepted decisions, response text, originating-session associations, expiry, and delivery status MUST survive a product restart. A request MUST accept at most one resolution. Duplicate Telegram events or competing decisions MUST NOT replace an accepted resolution or create additional decision effects.

#### Scenario: Duplicate or conflicting decisions
- **GIVEN** a request already has an accepted resolution
- **WHEN** the same choice is replayed or another choice arrives
- **THEN** the recorded resolution remains unchanged and no second resolution is delivered.

#### Scenario: Recover durable state
- **GIVEN** a request or accepted decision exists before a product restart
- **WHEN** the product resumes with its persistent state
- **THEN** the same identity, session association, decision, and delivery status remain available without creating another request or decision.

### Requirement: Expiry and cancellation are non-approval outcomes
Each actionable request MUST have a disclosed expiry deadline. Expiry and cancellation MUST close unresolved requests without approval. Decisions accepted before the deadline remain valid after it; a later deadline crossing MUST NOT erase an accepted decision. Expiry, cancellation, and decision races MUST yield only one resolution.

#### Scenario: Deadline has passed
- **GIVEN** an unresolved request whose expiry deadline has been reached
- **WHEN** a decision arrives
- **THEN** no decision is accepted and the human is told that the request expired.

#### Scenario: Decision races with closure
- **GIVEN** an unresolved request and competing decision and cancellation or expiry events
- **WHEN** the product resolves those events
- **THEN** at most one resolution is recorded, and a closed request cannot later become approved.

#### Scenario: Accepted decision awaits delivery past expiry
- **GIVEN** a decision was accepted before the deadline
- **WHEN** the deadline passes before session delivery completes
- **THEN** the accepted decision remains recorded and its delivery status remains distinct from expiry.

### Requirement: Fail closed without misleading status
Silence, tool timeout, transport errors, and processing errors MUST NOT imply approval. The product MUST distinguish a recorded decision from confirmed session delivery and MUST NOT report successful delivery solely because Telegram accepted a message.

#### Scenario: No human choice or delivery failure
- **GIVEN** no explicit approval has been accepted
- **WHEN** the human stays silent, the tool times out, or an error occurs
- **THEN** the product records no approval and shows the applicable pending, closed, or failed state rather than success.

#### Scenario: Waiting call ends before the human decides
- **GIVEN** an unresolved, unexpired request with no explicit cancellation
- **WHEN** its waiting tool call times out or its transport ends
- **THEN** the request remains pending and can accept the paired human's decision until expiry or explicit cancellation, without claiming that session delivery succeeded.

#### Scenario: Distinguish lost calls from request closure
- **GIVEN** a request with a waiting call that can time out or be lost
- **WHEN** request closure and accepted-decision retention are assessed
- **THEN** tool timeout or loss of the waiting call alone MUST NOT expire or cancel a request.
- **AND** an explicit supported cancellation or the disclosed expiry deadline is a separate closure condition. Accepted decisions remain subject to the durable single-resolution rules above.
