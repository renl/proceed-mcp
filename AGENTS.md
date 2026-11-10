# Proceed MCP - Project Index

Stable project instructions and navigation. Current work and history live in the status log.

## Project Facts

- Mode: CLI-managed OpenSpec v1.15.0 (`core`, `spec-driven`). Target branch: `main`.
- Portable Telegram approval MCP. OpenCode V2 is the first validation harness, not a core dependency. Current capability contracts and historical proposal are linked below.
- Canonical workflows: `workflow-routing`, `openspec-workflow`, `git-workflow`, `worktree-slicing`, `command-hygiene`. The scoped testing deviation below applies.
- User-approved testing deviation (2026-11-09): only unit tests are permitted until deployment to the user's OpenCode installation and public distribution. Reason: stop the repeated integration-harness loop and prioritize development completion. Do not execute integration, renderer, e2e, calibration or preflight tests during this scope. Independent review remains required. Unrun checks remain unverified, with candidate-specific landing/exposure risk decisions recorded in the status log rather than counted as passed. This does not authorize security changes, branch-protection bypass, merge or publication mechanics.
- User testing clarification (2026-11-10): author automated tests in JavaScript/TypeScript using normal unit-test tooling, not PowerShell scripts. Unit tests must run on Linux without PowerShell, Windows APIs, a native Windows helper or a Windows compiler. Playwright is appropriate for later user-interface verification when non-unit testing is authorized. This clarification does not lift the unit-only restriction.
- User risk-based verification direction (2026-11-10): do not create ad hoc PowerShell test harnesses or make PowerShell-only testing a delivery prerequisite. Use unit tests and proper e2e tooling when authorized. Uncovered platform/runtime checks may be left for owner manual verification after deployment, recorded as deferred and unverified, never passed. Preserve production safety checks and distinguish installation/deployment from confirmed runtime operation.
- Use temporary worktrees for feature development. Deliver verified features promptly through PRs into `main`, then return to the root checkout and complete safe worktree cleanup. Deployment and publishing use clean, merged `main`, never an unfinished feature worktree.
- Application sources, tests and OpenSpec use repository-relative paths. Consult the status log for live branch, revision and lifecycle state before operating.
- Primary CI uses Ubuntu 24.04 with Node 24.22.2. Verification records distinguish CI coverage, Windows evidence and package admission requirements without implying all-platform compatibility.

## Navigation

- [Canonical status log](docs/status_log.md): current work, blockers, verification, cleanup and history.
- [Implementation record](openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/tasks.md).

## Artifacts and Declared Authors

These are editing roles, not published human accountability. Each capability has one primary spec author.

| Artifact | Location | Declared author |
|---|---|---|
| Historical proposal | [proposal.md](openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/proposal.md) | @product-manager |
| Historical design | [design.md](openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/design.md) | @software-architect; portable baseline |
| `telegram-approval` | [spec](openspec/specs/telegram-approval/spec.md) | @product-manager; primary spec author |
| `opencode-session-continuation` | [spec](openspec/specs/opencode-session-continuation/spec.md) | @product-manager; primary spec author; retained path, portable meaning |
| `npm-distribution` | [spec](openspec/specs/npm-distribution/spec.md) | @product-manager; primary spec author |
| `proceed-agent-guidance` | `openspec/specs/proceed-agent-guidance/spec.md` | @product-manager; primary spec author |
| Current specs | [openspec/specs](openspec/specs/) | Capability authors listed above |
| Historical tasks and evidence | [tasks.md](openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/tasks.md) | @sdet-engineer; slice details and correction history |

Commands and check sequences belong in the referenced slice. For OpenCode facts use V2 documentation and the `opencode` skill. Consult the status log and tasks/lifecycle record before cleanup. Preserve secrets, runtime state and unknown artifacts.
