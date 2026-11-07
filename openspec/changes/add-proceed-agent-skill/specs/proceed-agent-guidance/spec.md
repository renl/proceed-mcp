# Proceed agent guidance delta

## Purpose

Give humans reusable, installable agent instructions for safe use of Proceed's existing Telegram workflow without repeating the workflow for each task. Parent: the `add-proceed-agent-skill` change's `proposal.md`, including scope and authoritative behavioral dependencies.

## ADDED Requirements

### Requirement: Installable and explicitly loadable guidance

The product MUST supply a reusable Proceed skill and README instructions for project-local installation in OpenCode V2 at `.opencode/skills/proceed/SKILL.md`. The skill MUST have a description identifying its Telegram human-approval and instruction use cases. The documented path MUST work without a new catalog, installer, global configuration change, or unpublished companion file.

#### Scenario: Install and load in a consuming project

- **GIVEN** a consuming project without the skill and an OpenCode V2 agent permitted to load it
- **WHEN** the operator follows the README to obtain the supplied artifact, install it at the documented path, and explicitly request loading through the agent's `skill` tool with `id: proceed` or through `@proceed`
- **THEN** the skill is registered as `proceed` and its instructions can be loaded
- **AND** real host discovery and returned installed instructions are observed through the chosen loading route. Either route satisfies this scenario without requiring a separate demonstration of the other route
- **AND** the README identifies the artifact source and distinguishes skill installation from MCP server installation and connection.

#### Scenario: Explain discovery limits

- **GIVEN** an operator reading installation guidance
- **WHEN** discovery and loading are described
- **THEN** the guidance distinguishes description-based advertising from explicit loading
- **AND** it makes no guarantee of automatic invocation, universal model compliance, or permission enforcement and does not invent an `opencode skill add` command.

### Requirement: Supported first use from empty state

The README MUST connect skill installation and loading to the supported empty-state Proceed setup and a harmless first-use procedure. It MUST identify required broker, owner, pairing, and MCP prerequisites without embedding secrets or requiring manual edits to stored product data. Expected results MUST remain distinct from observed proof.

#### Scenario: Complete the first useful interaction

- **GIVEN** no installed skill, Proceed configuration, owner, pairing, requests, or decisions, and operator access to the external prerequisites
- **WHEN** the operator follows the linked supported setup, installs and loads the skill, and follows the harmless first-use procedure
- **THEN** the procedure prepares one request and asks the paired human to Approve a clearly labeled test while its waiting call is active
- **AND** it checks the matching request and `approved` outcome, acknowledges the returned decision, and reports a capability-free receipt
- **AND** the procedure requires no shell command or file modification as the proposed action and performs no consequential action.

### Requirement: First-use acceptance order

The operator's hands-on demonstration is scheduled after deployment of the complete program preview, not as a prerequisite to developing subsequent program outcomes. This changes acceptance order, not the required first-use result or independent boundary-proof obligations. The change proposal's Delivery and Acceptance Order section governs any still-unmet landing or exposure check. The guidance MUST preserve this acceptance order.

#### Scenario: Schedule the operator demonstration

- **GIVEN** the complete program preview has not yet been deployed
- **WHEN** the operator's hands-on demonstration is scheduled
- **THEN** it is scheduled after deployment of the complete program preview, not as a prerequisite to developing subsequent program outcomes
- **AND** the required first-use result and independent boundary-proof obligations remain unchanged
- **AND** the proposal's delivery and acceptance order governs any still-unmet landing or exposure check.

### Requirement: Current workflow instruction coverage

The skill MUST teach when to use Proceed for a human approval or request-specific instructions under the user's task and existing permission rules. It MUST describe the current prepare, request-and-wait, and terminal acknowledgement workflow using exposed tool definitions, without redefining the existing approval or delivery contracts.

#### Scenario: Review the normal interaction

- **GIVEN** the supplied skill and the current configured Proceed tools
- **WHEN** its workflow instructions are inspected
- **THEN** they cover `prepare_approval`, private retention of the returned identity and authority, and `request_approval` with an exact proposed action and distinguishing context
- **AND** they distinguish preparation from sending a question and waiting for an outcome from a creation receipt
- **AND** they require use of the actual exposed tool names and definitions rather than assuming every harness uses one prefix or tool-access mode
- **AND** they cover acknowledgement of a returned `decision_id`, separation of delivery state from decision outcome, and prevention of repeated action from retrieval or replay.

### Requirement: Human decisions do not widen permissions

The skill MUST state that only the paired human's explicit Approve producing `approved` authorizes the identified request within existing permissions. It MUST distinguish every non-approval outcome and preserve Respond text as instructions, never authorization. It MUST NOT claim Proceed executes actions or replaces native permission controls.

#### Scenario: Respond contains approval-like wording

- **GIVEN** a recorded `responded` outcome containing text such as "yes" or "approved"
- **WHEN** the skill's handling instructions are inspected
- **THEN** they require preserving the response text and treating it as instructions only
- **AND** an action that still requires approval requires a separate explicit approval, not reinterpretation of Respond or automatic resubmission.

#### Scenario: Non-approval and native restrictions

- **GIVEN** rejection, expiry, cancellation, silence, an error, or a native permission restriction
- **WHEN** the skill's decision rules and examples are inspected
- **THEN** none treats those conditions as authorization
- **AND** the guidance does not direct an agent to approve its own request, manufacture a human outcome, bypass a permission, or automate answering a native permission prompt
- **AND** even an `approved` result does not widen the agent's existing permissions.

### Requirement: Retained request recovery without duplicate questions

The skill MUST explain that timeout or loss of a waiting call alone does not close the request. It MUST direct later explicit `get_approval` retrieval of that same request using retained private authority under the same transport principal, not a duplicate question. It MUST state that retrieval does not wake or automatically resume an agent.

#### Scenario: Waiting call is lost

- **GIVEN** a waiting call ends before its result is received and the caller retains the request identity and private capability
- **WHEN** recovery guidance is followed in a later authorized turn
- **THEN** it directs retrieval of the same request without preparing a replacement merely because of the lost call
- **AND** pending status is not approval and neither timeout nor retrieval is described as automatic cancellation, expiry, resumption, or successful delivery.

#### Scenario: Retained authority is unavailable

- **GIVEN** the request capability is lost or the matching principal is unavailable
- **WHEN** recovery instructions are inspected
- **THEN** they require reporting blocked retrieval and the missing prerequisite without claiming ID-only recovery, reading credential stores, or substituting another session
- **AND** they do not direct automatic duplicate submission or claim that a replacement would recover the earlier request.

### Requirement: Private authority stays out of public context

The skill and examples MUST require keeping request capabilities and credentials out of human-facing replies, Telegram-visible fields, logs, files used as public evidence, and published artifacts. Private capability use MUST be limited to authorized tool arguments and permitted private retention. The skill MUST NOT direct credential-store inspection or ask humans to paste secrets into the conversation.

#### Scenario: Inspect examples and receipt guidance

- **GIVEN** installation examples, request text, recovery examples, and assistant receipt instructions
- **WHEN** the supplied artifacts are reviewed
- **THEN** no real token or capability is embedded and no instruction echoes private authority into a displayed field or human-facing receipt
- **AND** receipt guidance identifies the request and outcome without the capability and does not treat a display label as authenticated identity.

### Requirement: Actionable failures without unsupported promises

The skill and README MUST identify actionable next steps for missing skill access, missing Proceed tools, incomplete setup, and tool errors while requiring truthful blocked or uncertain status. They MUST describe the current Telegram waiting-call baseline without promising automatic startup, native-channel answers, Events, post-timeout continuation, completed `doctor`, or delivery `retry`.

#### Scenario: Missing skill or tools

- **GIVEN** the skill cannot be discovered or loaded, or the Proceed tools are absent
- **WHEN** troubleshooting guidance is consulted
- **THEN** it directs checking the skill path, ID, description, permissions, or conflicting definition as applicable, and checking the MCP connection and existing setup for absent tools
- **AND** it does not weaken permissions or claim connection or successful skill loading before confirmation.

#### Scenario: Setup or tool failure

- **GIVEN** incomplete broker or pairing setup, denied access, or a failed tool call
- **WHEN** failure guidance is inspected
- **THEN** it directs reporting the safe diagnostic and applicable supported setup or operator action without disclosing secrets or claiming approval or delivery
- **AND** uncertain request creation is handled through retained identity and authorized retrieval rather than blind duplicate submission.
