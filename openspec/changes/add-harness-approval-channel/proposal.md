## Why

People using a harness currently must switch to Telegram to resolve Proceed requests. They need to answer the same request inside their trusted harness or in Telegram, without creating a second approval or letting agent-generated text become authorization.

## Direction Check

Subject: the human using the harness. Desired outcome: resolve the same Proceed request from either Telegram or the harness, with the first valid accepted decision taking effect once.
Problem: Telegram is the only human decision path. This change adds a trusted local operator path for Proceed requests, not permission for agents to approve themselves.

## What Changes

- Mirror a Proceed request's action, distinguishing context, deadline and Approve/Reject/Respond choices through an operator-configured trusted harness interaction.
- Recognize that local harness operator as an additional authorized human decision-maker. This explicitly does not require proof that the operator is the paired Telegram person.
- Keep one durable request and one accepted resolution across both surfaces. Respond text, including "approved", remains instructions only.
- Allow one unresolved request per trusted harness session, with distinct sessions operating concurrently. Replay of the same pending request is idempotent. A different request in the occupied session gets an explicit busy result, not silent loss or a global queue.
- Preserve portable Telegram operation when trusted host interaction is unavailable. Declined or cancelled forms, transport failure and a lost waiting call are not request cancellation or approval.

### User Stories

- As a human using a trusted harness, I want to answer a Proceed request where I am working, so that I need not switch to Telegram.
- As a human working across sessions, I want either surface's first accepted choice to settle only its matching request, so that late or competing answers cannot authorize other work.

## Capabilities

### New Capabilities

None. This extends the existing approval and portable waiting-call capabilities.

### Modified Capabilities

- `telegram-approval`: extend explicit human decision authority to the approved local operator while preserving Telegram pairing and instruction-only Respond semantics. Delta: [spec](specs/telegram-approval/spec.md).
- `opencode-session-continuation`: add trusted harness interaction, session admission, fallback and truthful compatibility outcomes. Delta: [spec](specs/opencode-session-continuation/spec.md). The retained capability name remains portable.

Both are product-behavior deltas under the primary authorship declared in [the project index](../../../AGENTS.md). Neither `npm-distribution` nor the merged `proceed-agent-guidance` capability is modified.

## Boundary and Dependencies

This is a user-visible dual-channel outcome, not an unexposed foundation. Its `add-automatic-broker-startup` dependency is satisfied by merged `main` at `a42e23c5dd026c76cf41c43eab21b7f3a4cf5c45`, integrated into this branch at `00e1e8172bc347accf2b6f12e2d17fdcccc4d55b`. This change can now land independently in its own PR into `main`. Current authority is the merged [approval](../../specs/telegram-approval/spec.md) and [delivery](../../specs/opencode-session-continuation/spec.md) baseline. The startup [proposal](../archive/2026-11-07-add-automatic-broker-startup/proposal.md) and [design](../archive/2026-11-07-add-automatic-broker-startup/design.md) are read-only history, not active dependencies.

The deltas retain the merged baseline's existing requirements and scenarios except for the explicit extensions shown. Protected storage, authenticated confidential local admission on every connection, private capability and principal boundaries, truthful readiness and shared-broker lifecycle remain required. Before archive, recheck these deltas against the then-current merged specs and verify no inherited active startup folder remains.

### Exclusions

- Bridging native harness permission prompts is a separate follow-up, not completed or dropped by this change. Native permission rules remain independently effective.
- Agent-facing decision-submission tools, caller-supplied human flags as authority, standing grants, extra reviewer roles and automatic action execution.
- Automatic post-timeout resumption, MCP Events, exited-process recovery, new global queues and unrelated startup changes.
- Installable skill implementation, publication, deployment and live credential access. The merged `proceed-agent-guidance` capability remains unchanged. Any necessary guidance alignment must preserve that contract rather than silently redefine it.

## Acceptance and Delivery Boundary

The linked deltas are the product acceptance criteria. Architecture chooses the host interaction and its authenticated correlation contract. Protocol form acceptance alone does not establish a domain Approve choice or human provenance. Session routing metadata is not authorization.

OpenCode V2 is the first qualification target, not a core dependency. Actual OpenCode v2.2.5 trusted interaction and concurrent-session qualification are required before claiming that support. Standard elicitation capability alone does not prove session routing or a trusted human response. Unsupported clients retain Telegram without an elicitation requirement.

The supported empty-state setup must establish Telegram pairing, local principal and explicit trusted-harness configuration before the first dual-channel request, without manual stored-data edits. Setup never approves work.

The user's hands-on test follows full program development and deployment. Independent applicable pre-merge verification remains mandatory. Deferred, unavailable or post-deploy checks are not pre-merge passes, and historical preview exceptions do not waive these checks. This proposal grants no publication, deployment or credential-use authority.

Version `0.1.0-preview.2` is the merged but unpublished startup candidate, not an assigned harness release. This independently landing runtime change needs its own version disposition before PR. No version or publication choice is made here.

## Impact

Human interaction, decision admission and session routing need coordinated design and verification. The README must explain supported setup, the additional operator trust boundary, session limits, Telegram fallback and the separate native-permission follow-up. Exact interaction mechanisms and contracts belong to architecture.
