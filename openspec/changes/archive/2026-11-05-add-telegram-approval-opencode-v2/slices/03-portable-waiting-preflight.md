# Portable waiting-call preflight — historical, superseded

## Superseded disposition (2026-10-31)

The approved request-key decision and corrected design sections 2–3 now explicitly support shared/multiplexed stdio. Request authority is the capability plus transport principal; agent labels and RPC IDs are not authentication. Valid same-principal key transfer is authorized, not a session-isolation failure. The dedicated-session topology blocker below is **superseded**, not a current prerequisite. Its original finding remains unchanged as history; no compatibility proof is inferred from resolution.

Next executable packet: [03A shared waiting calls](03a-portable-shared-waiting.md). Interface/decomposition review is required before implementation; real Telegram and first-host proof remain pending. No identity redesign or mandatory per-agent launcher is requested.

## Original preflight record (superseded)

Parent: [tasks](../tasks.md). Authority: [design](../design.md), [delivery delta](../specs/opencode-session-continuation/spec.md), [Telegram delta](../specs/telegram-approval/spec.md).

## Goal and disposition

A paired human's Approve, Reject, or exact Respond text must reach the original active MCP call without a proprietary host dependency, and concurrent requests must remain correctly correlated.

**BLOCKED before slice/test readiness.** This is a preflight finding, not an executable slice specification or implementation brief. No workaround, new schema, production change, event wire, or mandatory per-session launcher is selected. Phase A cannot claim that a test-owned pair of stdio clients establishes native host session isolation.

| Field | Value |
|---|---|
| Worktree / branch / change | `.worktree/add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` |
| Project baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Inspected HEAD | `dff3da959843a0cda592c525f559b538ccf391be` plus dirty owner-authored proposal/specs/design |
| Scope changed | This preflight and `tasks.md` only |
| Gap ID | Pending coordination assignment; no new ID invented |
| Correction attempts | 0; initial topology finding, not another TIMEOUT-PROOF-001 attempt |
| Next owner | Architecture through coordination |
| Lifecycle | Active, retain; no cleanup due or runtime resources created |

## Boundary Verification — unresolved topology prerequisite

Sources read on 2026-10-31:

| Source | Observed contract and limit |
|---|---|
| [OpenCode V2 MCP servers](https://opencode.ai/v2/docs/mcp-servers/) — Config, Local, Context | Registration uses project/global `mcp.servers`; local command launches stdio. Distinct server names create separate connections/accounts, not documented session-exclusive access. Context metadata identifies the invoking OpenCode session, explicitly not the MCP transport session, and is not authentication/authorization by itself. No documented per-agent-session connection binding was found on this page. |
| [OpenCode V2 troubleshooting](https://opencode.ai/v2/docs/troubleshooting) | The shared background service owns sessions and application state. Separate UI/client launches cannot be assumed to establish separate MCP principals. This source does not by itself prove the precise installed connection-sharing implementation. |
| [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | Stdio carries newline-delimited JSON-RPC over child stdin/stdout. It does not specify an authenticated agent-session identity or one adapter process per logical agent session. |
| Active design sections 2–3 | Lines 60/66 require one dedicated connection and protected credential per logical session; multiplexed unrelated sessions are unsupported. Lines 79/81 derive ownership/idempotency from the adapter credential. Lines 235/242 require two dedicated native session connections as acceptance. |
| Existing production `src/mcp/server.js` | Lines 9/15/26 still require proprietary session metadata and describe immediate receipts; lines 174–175 forward `session_id` to the broker. This is obsolete production, not a portable implementation or topology proof. |

### Exact mismatch and consequence

The design requires session-exclusive operator wiring which the documented ordinary native registration does not establish. A fixed `mcp --owner <owner_id>` command binds a connection to one protected principal. If two agent sessions use that connection, the broker sees the same principal. Returning each outstanding response to its own JSON-RPC request ID is feasible, but that correlation does not distinguish their authorization for later read/cancel/acknowledge calls.

In that topology, `(owner_id, client_request_id)` also has a shared collision domain. Different model-supplied labels or IDs cannot repair it. Registering two named servers does not establish that each session can access only its own server. A second-adapter registration refusal detects concurrent credential reuse, not sessions multiplexed through one adapter.

This is a blocking unverified prerequisite, not a measured claim that OpenCode cannot support any isolated setup. No live wire traffic, registration process count, or per-session access denial was observed. The tool-catalog discovery for `proceed` returned no matching tools; that establishes only no exposed matching tool in this task, not the registered server's absence, health, or process topology. No existing runtime configuration/state was read or modified.

### Clarification needed before executable setup

Architecture must reconcile the session authorization boundary with ordinary first-host registration, or identify a source-grounded dedicated topology and its enforceable exclusivity conditions. If the intended principal is instead a shared trusted client/connection, architecture and product must reconcile that boundary with the delta's cross-session read/cancel/delivery denial; test engineering cannot silently weaken it.

The original-call waiting-result tests can verify JSON-RPC correlation independently of session authentication. They must not be presented as proof of protected session isolation. Once the contract is resolved, the bounded executable slice must map these as separate assertions and retain exact Respond text, non-approval closures, cancellation/connection-loss separation, durable single-winner and no-Events baseline coverage. Interface-fidelity and decomposition review remain required before readiness.

## Evidence, preservation, and bounds

- No new tests were authored or executed: work stopped at the explicitly required topology preflight. No RED behavioral or portable compatibility result is claimed.
- Previous setup/durability assertions may be reused only with revision/case/unchanged-semantics mapping. Origin admission, proprietary metadata, immediate receipt and API continuation evidence remain historical only. Existing evidence files are untouched.
- No live Telegram, token, `.env`, user-host/API access, model update, service launch/restart, credential/configuration change, event implementation, archive, publication, push, or PR operation occurred.
- Existing dirty owner documents and untracked containment/research/operations artifacts were preserved. No commit was needed to establish readiness, since readiness is blocked.
- Checks for this docs-only disposition: bounded `git diff --check` and explicit changed-file inspection. These check artifact hygiene only; no executable acceptance gate is passed.
