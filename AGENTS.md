# Proceed MCP Agent Directory

Master index and current-work summary for the Telegram approval MCP.

## Project Mode

- CLI-managed OpenSpec v1.15.0; default `core` profile and `spec-driven` schema.
- Target branch: `main`. One implementation change, one worktree/branch, one PR with authorized CLI archive inside it. The user merges.
- Generated `.opencode/` integration is upstream-owned. Archive contents are immutable.
- Current setup branch `chore/project-workflow` has uncommitted bootstrap content; SDET must preserve it when preparing the change worktree. Do not discard or publish an incomplete feature.

## Approved Direction and Scope

- Subject: humans supervising parallel OpenCode V2 sessions remotely.
- Outcome: Telegram Approve / Reject / Respond reaches the exact requesting session, including after the original MCP tool call times out while the harness remains running.
- Problem: ordinary MCP notifications do not guarantee agent turn activation.
- First implementation: OpenCode V2 only; other harnesses and exited-process recovery are deferred. No browser inbox or floating widget in this version.
- Private Telegram chat with a paired human; typed responses are instructions, never implicit approval. No approval from timeout, silence, expiry, cancellation, or errors.
- Persist requests/decisions, correlate parallel sessions, prevent duplicate decisions and wrong-session delivery. Do not claim MCP alone enforces execution permissions.
- Public npm distribution approved. PR CI builds/tests without publishing; version-tag CI validates and publishes the package. Prefer trusted publishing; npm package availability/ownership and publisher setup remain unverified. Never commit credentials.
- Application stack, exact public package identity, version support floor, license, and authenticated OpenCode integration need owner decisions/evidence; do not invent compatibility or release success.

## Current Work

| Field | Value |
|---|---|
| Objective | Deliver Telegram approval MCP for running OpenCode V2 sessions with public npm release CI |
| Spec | `openspec/changes/add-telegram-approval-opencode-v2/` |
| Worktree | Not yet created; setup in repository root |
| Baseline | `main` @ `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Owner | @product-manager |
| Next action | Write proposal and product delta; ground external contracts before architecture and tests |
| Blocker | No implementation blocker confirmed; live OpenCode auth/busy semantics and npm publisher setup unverified |
| Correction-attempt link | none |
| Verified revision | Bootstrap only at `f385409`; no feature verification |
| Evidence | `docs/status_log.md`; public repository `https://github.com/renl/proceed-mcp` |

## Active Artifacts

| Artifact | Location | Owner | Status |
|---|---|---|---|
| Proposal | `openspec/changes/add-telegram-approval-opencode-v2/proposal.md` | @product-manager | Pending |
| Product capability deltas | `openspec/changes/add-telegram-approval-opencode-v2/specs/` | @product-manager | Pending; declare capability names in proposal |
| Current specs | `openspec/specs/` | Per-capability declared author | Empty |
| Design | `openspec/changes/add-telegram-approval-opencode-v2/design.md` | @software-architect | Pending |
| Tasks/tests | `openspec/changes/add-telegram-approval-opencode-v2/tasks.md` | @sdet-engineer | Pending |
| Status | `docs/status_log.md` | @chief-of-staff | Current |

External platform findings must use OpenCode V2 docs (`https://opencode.ai/v2/docs/`), not V1. Existing discussion findings are research, not tested compatibility. SDET owns runnable tests and independent first-use verification; SE implements production code and creates the delivery PR. Operations owns registry/environment configuration.
