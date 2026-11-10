# Tasks

## Delivery and lifecycle

Authority: [proposal](proposal.md), [design](design.md) decisions 1-4 and [delta](specs/opencode-session-continuation/spec.md). The delta defines behavior, design defines process handling, tests verify conformance without defining a new ABI. CLI 1.15.0 tasks instructions were obtained with telemetry disabled after specs/design dependencies completed.

Success: complete supported setup and the first Telegram decision through normal MCP startup with a private launch token, no token file and no manual broker terminal. The first independently mergeable increment is this entire bounded source-selection/helper-filtering change, independently based on `main` at `df2c8d0958676ba8465db8959d6299bd278125e0`. No dependency on the Windows correction branch. Nearest landing blocker: production is still file-only, followed by independent unit review and a candidate-specific decision on unrun runtime proof. Unit assertions prove memory-level contracts only, not the user-visible first decision.

| Lifecycle field | Value |
| --- | --- |
| Path | `.worktree/support-startup-token-environment` |
| Branch / change | `support-startup-token-environment` |
| Owner | SDET lifecycle role |
| Status | active, setup authorized |
| Next action | Commit only change planning files, move the branch to its one worktree, author units, obtain combined review, then implement |
| Cleanup evidence | Not eligible. Retain until proven landing on main or explicit abandonment with verified preservation. Other worktrees and root overlays remain untouched. |

## 1. Automatic source selection and failure handling

- [ ] 1.1 In `src/cli/main.js`, implement both `mcp` and `pair` launch-callback source selection and command-environment propagation per design decisions 1-2. Verify `tests/startup-token-environment.test.mjs` precedence, reuse and input-boundary cases. Explicit file wins even over invalid environment input. Absent/empty means default file. Environment mode accepts unchanged 1-4096 non-whitespace ASCII bytes only. No fallback, adapter file reads, normalization or new remote probe.
- [ ] 1.2 In `src/broker/availability.js`, preserve the installed entry point and startup safeguards while supplying the selected environment only to its broker. Verify the same suite captures actual spawn arguments/options, strips Windows casing variants in file mode, preserves unrelated environment and deadline, leaves inputs unchanged and retains shell false, detached lifetime, ignored stdio and unref. Synchronous launch failures must not expose raw exceptions/options.
- [ ] 1.3 In `src/broker/startup-failure.js` and existing CLI copy, supply fixed actionable private-launch-or-file guidance. Verify the same suite asserts `TELEGRAM_CREDENTIAL_UNAVAILABLE` exit 3, MCP `BROKER_UNAVAILABLE`, no canary disclosure or fabricated decision, and unchanged foreground explicit-file/environment conflict. Documentation of restart supply, trusted-parent limits and stop/replacement rotation belongs to the existing documentation owner, not an expansion of this production allowlist. Verify that owner delivery by review before finalization.

## 2. Helper inheritance

- [ ] 2.1 In `src/state/protection.js`, filter the Telegram token and Windows casing variants before invoking the existing ACL helper, retaining PSModulePath removal and ACL behavior. Verify `tests/startup-token-helper-environment.test.mjs` through in-memory exec capture. No real PowerShell, native API, file lifecycle or protection repair.
- [ ] 2.2 Verify the existing `helperEnvironment` allowlist directly in that suite. Keep `src/harness/node-helper.js` unchanged unless a focused regression proves a violation and scope is reconciled. Assert trusted Windows root keys only, no token or other injected authority, and no parent mutation.

## 3. Integrated candidate review

- [ ] 3.1 Complete one combined Architect boundary/test/decomposition review of these tasks and runnable units. Verify approval is recorded before implementation readiness. Checklist answers: cross-component environment obligation YES, baseline contamination NO, live receiver NO for units, split proof NO, split fixture/proof NO. No new test-only production interface or separate review ladder.
- [ ] 3.2 Independently review the immutable implemented candidate and run the bounded checks below. Record revision, per-suite counts/exit codes and remaining risks here before archive. Confirm later finalization changes are docs-only or revalidate affected inputs.

## Boundary Verification

Category: normative process-environment/cross-component contract, not a changed external wire. Architect reviews design decisions 1-3 against the two producer paths, spawn sink and helper sink together. Exact name: `PROCEED_TELEGRAM_BOT_TOKEN`. Environment arguments: `serve --secure-local --state-dir <state-directory>`. File arguments: `serve --telegram-token-file <selected-file> --state-dir <state-directory>`. Preserve `PROCEED_STARTUP_DEADLINE_AT`. No name mapping, URL, HTTP route, auth payload or new public export is introduced. Existing Telegram protocol and admission remain unchanged.

The command environment is authoritative, never an ambient replacement. Strip token entries before selecting broker inheritance, including case-insensitive Windows variants. Helpers never receive it. Only broker startup reads selected file contents. Invalid selected environment input fails closed without retry or raw secret/error disclosure. In-memory module/process substitutes exercise actual existing functions, not duplicate policy models. Production must not import test support. Review status: pending one combined pass.

## Test mapping and run sequence

The delta requirements "Automatic broker availability for normal MCP use", "Automatic startup preserves credential and readiness boundaries", "Provisioning and startup prevent token disclosure", "Credential provisioning and loading fail closed" and "Credential limitations and foreground compatibility remain explicit" map to `startup-token-environment.test.mjs` for both CLI producers, actual spawn capture, failure mapping and reuse. "Helpers do not inherit unnecessary token authority" maps to `startup-token-helper-environment.test.mjs` for actual ACL exec environment and existing harness allowlist. Synthetic canaries are generated only in test memory. No user environment secrets or credential files are read.

Run from the assigned worktree, Node >=24, Windows or Linux. Shell timeout 30 seconds per static/unit command, 120 seconds for authorized restore. No prerequisite code from another worktree. Use existing locked Prettier, or `npm ci --ignore-scripts` only if needed, without lock/dependency changes.

1. `node node_modules/prettier/bin/prettier.cjs --check openspec/changes/support-startup-token-environment/tasks.md tests/startup-token-environment.test.mjs tests/startup-token-helper-environment.test.mjs`
2. `node --check tests/startup-token-environment.test.mjs` and `node --check tests/startup-token-helper-environment.test.mjs`, then `git diff --check`.
3. With `OPENSPEC_TELEMETRY=0`, `openspec validate support-startup-token-environment --strict --no-interactive`.
4. `node --experimental-test-module-mocks --test tests/startup-token-environment.test.mjs`
5. `node --experimental-vm-modules --test tests/startup-token-helper-environment.test.mjs`

## Checks and evidence

| Timing | Check / status | Owner and trigger |
| --- | --- | --- |
| Pre-merge | Scoped format, syntax, strict structure, pure Node units and independent candidate review required. Setup results pending. | Test/implementation owners, before finalization |
| Pre-exposure | Installed detached startup, real-process privacy, full empty-state first decision, Telegram rejection and restart/rotation are UNRUN/UNVERIFIED, prohibited by unit-only scope. Unit success is not runtime proof or a waiver. | Release decision owner records candidate-specific risk/mitigation/expiry in status log before landing/exposure authorization |
| Post-deploy | Actual supported first use and restart, only when non-unit testing is authorized. Not pre-merge evidence. | Runtime owner, deployment plus explicit testing authority |
| Deferred | Windows state/key protection defects and native ACL qualification remain separate and blocked. Local MCP/TUI stay disabled. | Protection/runtime owners, separate correction and activation authorization |

## Workflow follow-up

- One change branch and one PR into main. No per-task PR, framework, executable, persistence provider or build/signing work.
- After independent review, route capability-owner delta review and one authorized CLI archive through coordination. No push, PR, archive, merge, deployment or publication is authorized by setup.
- Production allowlist is exactly `src/cli/main.js`, `src/broker/availability.js`, `src/state/protection.js`, `src/broker/startup-failure.js`. Tests/tasks stay test-owner controlled. Preserve all file/security invariants and other worktrees. Do not edit archived content, root coordination overlays or operations files.
