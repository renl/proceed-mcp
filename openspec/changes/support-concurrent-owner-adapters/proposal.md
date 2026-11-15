## Why

Multiple OpenCode directories using the same Proceed owner must be able to request approvals concurrently. A legitimate second adapter must not fail with `OWNER_IN_USE`, and closing or reconnecting one adapter must not disrupt its siblings.

## Direction Check

Subject: authenticated adapters serving multiple OpenCode directories under one configured owner. Desired outcome: concurrent approval interactions and sibling-safe lifecycle handling.
Problem: treating owner identity as exclusive adapter occupancy causes conflicts and unsafe cleanup. This change separates adapter lifetimes without weakening request or human decision authority.

## What Changes

- Permit multiple authenticated adapters for one owner, each with independently renewable and releasable registration authority.
- Keep preparation, waiting results and receipt acknowledgements independent, including decisions returned in reverse order.
- Make registration renewal, release and expiry affect only the authorized registration. Expired or retired authority cannot revive itself or affect a replacement.
- Stop adapter activity on observed shutdown, bound best-effort registration release and prevent late completions from restarting closed activity.
- Preserve durable requests and explicit authorized recovery after reconnect, shutdown or registration loss. Reconnect neither reattaches a lost waiting call nor creates replacement requests.
- Clarify that exclusive ownership applies to the broker and Telegram poller, not adapter occupancy for an owner.

### User Story

As an operator using Proceed in multiple OpenCode directories, I want each adapter to request approvals and close independently, so that one directory does not block or interrupt another.

### Boundary and Landing

This is one independently landable behavior change against `main`. The first useful increment is two same-owner adapters completing separate approval interactions, with either adapter able to close without interrupting the other. Registration lifecycle handling belongs in this change because concurrency without independent retirement would leave that outcome unsafe.

There is no dependency on another active change. The change relies on the merged [delivery and lifecycle contracts](../../specs/opencode-session-continuation/spec.md) and [durable human-decision contracts](../../specs/telegram-approval/spec.md). Existing initialized state, owner credentials and pairing remain usable through supported setup without manual stored-data edits.

### Exclusions

- No broader owner or human decision authority, changed principal/capability boundary, automatic session reattachment, MCP Events or automatic post-timeout resumption.
- No arbitrary adapter/session limit, unrelated process termination, automatic stale-lock takeover, new helper/service, HTTP migration, framework or package-global change.
- No changes to TLS, authentication, pairing, broker locking, journal integrity, platform storage policy or explicit Approve/Reject/instruction-only Respond.
- The separate README PR #20 and held documentation drafts are not dependencies or deliverables.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: concurrent same-owner adapters with independent registration lifetimes, sibling-safe reconnect/closure and unchanged durable request recovery. See the [delta](specs/opencode-session-continuation/spec.md).

## Impact

Affected behavior is adapter registration, renewal, retirement, reconnect and shared-broker lifecycle. Exact registration contracts and internal implementation remain design decisions.

Verification is restricted to normal JavaScript/TypeScript unit tests runnable on Linux and independent unit/static review. Simulated contract results do not prove actual client closure, installed first use or Telegram operation. Non-unit, integration, e2e and native preflight checks remain unrun and unverified under the project restriction. Implementation, review and later authorized delivery are still required.
