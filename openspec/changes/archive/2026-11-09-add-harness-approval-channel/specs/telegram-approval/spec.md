## MODIFIED Requirements

### Requirement: Explicit approval and rejection
Only an explicit Approve choice from the paired human or the additional local operator authorized under [trusted harness interaction](../opencode-session-continuation/spec.md) for an actionable request MUST produce an approval. An explicit Reject choice MUST produce a rejection for that request, not authorization to perform the requested action.

#### Scenario: Approve a pending request
- **GIVEN** an unexpired pending request
- **WHEN** the paired human explicitly selects Approve for it
- **THEN** the product records approval for that request and confirms the recorded choice to the human.

#### Scenario: Reject a pending request
- **GIVEN** an unexpired pending request
- **WHEN** the paired human explicitly selects Reject for it
- **THEN** the product records rejection and confirms it without recording approval.

#### Scenario: Additional trusted operator decides
- **GIVEN** an unexpired pending request mirrored through the configured trusted harness
- **WHEN** its authorized local operator explicitly selects Approve or Reject through the genuine request-bound human interaction
- **THEN** the matching choice can resolve that request under the same durable single-resolution rules as Telegram
- **AND** proof that the operator is the paired Telegram person is not required.

### Requirement: Responses are instructions only
Respond MUST allow the paired human or authorized local harness operator to supply text associated with one identified pending request. Accepting that response MUST resolve the request as an instruction response, not as approval or rejection. Performing an action that still requires approval MUST require a separate explicit approval. Response text MUST NOT satisfy it.

#### Scenario: Respond with approval-like text
- **GIVEN** the human selects Respond for a pending request on either authorized surface
- **WHEN** the human submits text, including text such as "yes" or "approved"
- **THEN** the text is recorded as instructions for that request and no approval is recorded.

#### Scenario: Ambiguous typed reply
- **GIVEN** multiple requests are pending
- **WHEN** text cannot be unambiguously associated with one request
- **THEN** it is not applied to any request and the human is asked to identify the intended request.
