## Why

Normal MCP use currently fails when the local broker is stopped. Operators must start `serve` in a separate terminal and keep it open, even after completing setup. Starting the MCP adapter should make the configured broker available without that recurring manual step.

## Direction Check

Subject: the operator and paired human. Desired outcome: normal MCP approval use works after one-time setup without a manual broker terminal.
Problem: the adapter only connects to a broker. This change starts or safely reuses the broker, rather than moving the recurring startup burden to the operator.

## What Changes

- The normal MCP entry point starts the configured local broker when safely stopped, or reuses a matching healthy instance, including a manually started broker.
- Concurrent clients share at most one broker and Telegram update poller per configured state. One client closing must not disrupt another client or a manually started broker.
- Broker-dependent approval calls wait for readiness within a documented finite startup deadline, or return an actionable failure. A listening port alone does not prove broker identity, health, Telegram availability, pairing or human delivery.
- Startup preserves protected state, request authority, durable pending requests and accepted decisions. Unknown ownership, uncertain locks and unrelated processes are not repaired or replaced automatically.
- Explicit operator provisioning during supported one-time setup saves the Telegram bot token in a separate protected owner-only credential file outside the repository, product state directory and MCP adapter configuration. Only broker startup loads and uses it, without giving the token to the adapter or exposing it through client configuration, tool results or diagnostics.

### User Stories

- As an operator, I want connecting my configured MCP client to start the stopped broker, so that I do not need a separate `serve` terminal for normal use.
- As a paired human, I want multiple clients to share the broker safely, so that opening or closing one client does not interrupt another request or change a recorded decision.

## Capabilities

### New Capabilities

None. Automatic startup extends the existing portable MCP interaction, not a new approval channel or delivery model.

### Modified Capabilities

- `opencode-session-continuation`: add safe automatic broker startup, bounded readiness, shared-instance lifetime safety and first-use startup outcomes. The retained capability name does not restrict this behavior to OpenCode.

## Boundary and Dependencies

This change delivers the complete automatic-startup outcome, not an unexposed foundation. It can land independently on `main` and has no dependency on the separate agent-skill change or its unmerged delta.

It relies on the current [portable MCP contract](../../specs/opencode-session-continuation/spec.md), [Telegram pairing and durable-decision contract](../../specs/telegram-approval/spec.md), and [supported first-use path](../../specs/npm-distribution/spec.md#requirement-complete-first-useful-action-from-empty-state). It follows the [historical implementation](../archive/2026-11-05-add-telegram-approval-opencode-v2/proposal.md) without editing that record.

### Exclusions

- Native integration, dual-channel approval and agent-skill implementation.
- System services, login startup, automatic stale-lock takeover, `doctor`, delivery retry and new public APIs solely for tests.
- Dependency or package-version changes, npm or MCP Registry publishing, and publishing automation.
- Automatic recovery of exited clients, MCP Events, post-timeout agent resumption, action execution or changes to the existing five-tool approval contract.

## Impact and Design Decisions

The MCP startup path, broker ownership/lifetime, operator setup and startup instructions will need coordinated changes. Exact process management, readiness proof, finite deadline, credential path selection, setup commands and credential lifecycle belong to the technical design, not this proposal.

The user approved the security-posture change from broker-environment-only input to an explicitly provisioned owner-only token file for automatic startup. This is necessary for cold startup without a manual broker terminal. Owner-only protection does not isolate the token from other processes under the same account and does not promise encryption or an OS credential store. Existing foreground broker use with a broker-process environment token remains supported.

Automatic startup MUST retain broker-only token access, existing local authorization and owner-only state protection. Missing credentials or unsafe credential ownership, permissions or paths MUST fail closed with an actionable next step, not approval. Provisioning and startup MUST NOT echo token values or expose them in CLI arguments, MCP configuration or adapter environment, tool outputs, diagnostics, logs, published evidence, the state journal or request history. The approval does not authorize reading or saving existing live credentials now, general filesystem access, agent secret storage or publication.

## Acceptance and Delivery Boundary

The [product delta](specs/opencode-session-continuation/spec.md) defines the acceptance outcomes. Startup work must preserve the existing five tools, capability-and-principal authorization, explicit human approval and truthful delivery status.

The user's hands-on test follows full program delivery, not an immediate pairing or click requirement during development. Independent applicable pre-merge verification remains required. Unavailable live checks remain BLOCKED until executed or covered by eligible scoped acceptance at the relevant delivery step. Historical preview exceptions do not waive this change's checks.

Implementation uses temporary development worktrees followed by prompt PR landing on `main`. Any later separately authorized publication must use clean merged `main`. This proposal neither authorizes testing against real credentials or Telegram nor authorizes publication. Landing this change alone is not a claim of full program deployment.
