# Proceed MCP - Project Index

Stable project instructions and navigation. Current work and history live in the status log.

## Project Facts

- Mode: CLI-managed OpenSpec v1.15.0 (`core`, `spec-driven`). Target branch: `main`.
- Portable Telegram approval MCP; OpenCode V2 is the first validation harness, not a core dependency. Scope and approved request-key ownership: proposal and capability deltas below.
- Canonical workflows: `workflow-routing`, `openspec-workflow`, `git-workflow`, `worktree-slicing`, `command-hygiene`. No approved local workflow deviations.
- Application sources, tests and OpenSpec use repository-relative paths. Consult the status log for live branch, revision and lifecycle state before operating.
- Validation uses project-local Node 24.22.2 on Windows. No all-OS or cross-harness compatibility is implied.

## Navigation

- [Canonical status log](docs/status_log.md): current work, blockers, verification, cleanup and history.
- [Implementation tasks](openspec/changes/add-telegram-approval-opencode-v2/tasks.md).

## Active Artifacts and Declared Authors

These are editing roles, not published human accountability. Each capability has one primary spec author.

| Artifact | Location | Declared author |
|---|---|---|
| Proposal | [proposal.md](openspec/changes/add-telegram-approval-opencode-v2/proposal.md) | @product-manager |
| Design | [design.md](openspec/changes/add-telegram-approval-opencode-v2/design.md) | @software-architect; portable baseline |
| `telegram-approval` | [delta spec](openspec/changes/add-telegram-approval-opencode-v2/specs/telegram-approval/spec.md) | @product-manager; primary spec author |
| `opencode-session-continuation` | [delta spec](openspec/changes/add-telegram-approval-opencode-v2/specs/opencode-session-continuation/spec.md) | @product-manager; primary spec author; retained path, portable meaning |
| `npm-distribution` | [delta spec](openspec/changes/add-telegram-approval-opencode-v2/specs/npm-distribution/spec.md) | @product-manager; primary spec author |
| Current specs | [openspec/specs](openspec/specs/) | Capability authors listed above |
| Tasks, tests and lifecycle | [tasks.md](openspec/changes/add-telegram-approval-opencode-v2/tasks.md) | @sdet-engineer; slice details and correction history |

Commands and check sequences belong in the referenced slice. For OpenCode facts use V2 documentation and the `opencode` skill. Consult the status log and tasks/lifecycle record before cleanup. Preserve secrets, runtime state and unknown artifacts.
