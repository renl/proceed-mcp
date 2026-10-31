# Proposal

Status: Active change based on the approved project direction; not merged current behavior. Parent: [project direction](../../../../AGENTS.md). Read next: capability specs below.

## Why

Humans supervising parallel OpenCode V2 sessions need to approve, reject, or give instructions from Telegram without returning to each terminal. Ordinary MCP notifications do not guarantee a new agent turn, so a decision must also reach the exact requesting session after its tool call times out, while OpenCode remains running.

## Direction Check

- Subject: humans remotely supervising parallel OpenCode V2 sessions; desired outcome: their decisions reach the exact requesting session.
- Problem: a timed-out tool call and ordinary MCP notifications do not guarantee session continuation. This change addresses targeted continuation, not merely Telegram notification delivery.

## What Changes

- Provide approval requests in a private Telegram chat controlled by a paired human, with Approve, Reject, and Respond actions.
- Keep typed responses as instructions, never implicit approval. Silence, timeout, expiry, cancellation, and errors never grant approval.
- Persist requests and decisions, distinguish parallel sessions, and prevent duplicate or conflicting decisions and wrong-session delivery.
- Continue the originating running OpenCode V2 session after the original tool call times out; show pending or failed delivery honestly when continuation cannot be confirmed.
- Support first use from an empty installation through documented setup, pairing, request creation, and a first confirmed decision delivery.
- Distribute publicly through npm. Pull-request CI builds/tests without publishing; version-tag CI validates and publishes the package.

## Capabilities

### New Capabilities

- `telegram-approval`: paired-human requests, explicit decisions, durable state, and race/expiry safety. [Delta](specs/telegram-approval/spec.md).
- `opencode-session-continuation`: exact-session routing and continuation for running OpenCode V2, including after tool timeout. [Delta](specs/opencode-session-continuation/spec.md).
- `npm-distribution`: clean installation, documented first use, and validated public release through CI. [Delta](specs/npm-distribution/spec.md).

### Modified Capabilities

None. There are no current capability specs.

## User Stories

- As a supervising human, I want to approve, reject, or respond in Telegram, so that I can direct work remotely without accidentally authorizing an action.
- As a human running parallel sessions, I want each decision delivered only to its originating session even after tool timeout, so that unrelated work is not affected.
- As a new operator, I want to install a public npm package and complete documented setup, so that I can make my first useful decision without repository-only tooling or preloaded data.
- As a maintainer, I want tested version-tag releases and non-publishing pull-request checks, so that reviewed releases are reproducible and changes do not publish accidentally.

## Scope and Readiness

The linked scenarios define completion. Other harnesses, exited-process recovery, browser inboxes, and floating widgets are excluded. MCP alone is not an execution-permission enforcement boundary.

The approved project direction authorizes work within that scope, including the empty-state setup checkpoint; the deltas' active-change status does not require renewed blanket approval. The scenarios elaborate that direction, not a claim that the user separately approved every authored detail. Material changes to scope or security and explicitly reserved owner decisions require targeted confirmation.

External contracts require source-grounded OpenCode V2 and Telegram research; authenticated access and busy-session behavior require evidence, not assumed compatibility. If these constraints prevent the required continuation, return the limitation for a product decision rather than silently narrowing the outcome.

Exact package identity and ownership, license, support floors, and publisher setup remain unresolved release decisions. Prefer trusted npm publishing; never commit credentials. No package availability, authenticated integration, or release success is claimed here.

## Impact

This introduces a new MCP product, Telegram bot interaction, persistent approval history, a running OpenCode V2 integration, operator documentation, and public npm release automation. Application stack, interfaces, storage, authentication mechanisms, and CI implementation belong to subsequent design; this proposal does not prescribe them.

## Related Artifacts

- [Project status](../../../../docs/status_log.md)
- Product acceptance: the three capability deltas linked above.
