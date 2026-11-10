# Tasks

## Delivery and lifecycle

Authority: [proposal](proposal.md), [design](design.md) decisions 1-4 and [delta](specs/opencode-session-continuation/spec.md). The delta defines behavior, design defines process handling, tests verify conformance without defining a new ABI. CLI 1.15.0 tasks instructions were obtained with telemetry disabled after specs/design dependencies completed.

Success: complete supported setup and the first Telegram decision through normal MCP startup with a private launch token, no token file and no manual broker terminal. The first independently mergeable increment is this entire bounded source-selection/helper-filtering change, independently based on `main` at `df2c8d0958676ba8465db8959d6299bd278125e0`. No dependency on the Windows correction branch. Nearest landing blocker: production is still file-only, followed by independent unit review and a candidate-specific decision on unrun runtime proof. Unit assertions prove memory-level contracts only, not the user-visible first decision.

| Lifecycle field  | Value                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path             | `.worktree/support-startup-token-environment`                                                                                                             |
| Branch / change  | `support-startup-token-environment`                                                                                                                       |
| Owner            | SDET lifecycle role                                                                                                                                       |
| Status           | active, unit setup prepared for combined review                                                                                                           |
| Next action      | Obtain one combined boundary/test/decomposition review, then implement the four-file production delta                                                     |
| Cleanup evidence | Not eligible. Retain until proven landing on main or explicit abandonment with verified preservation. Other worktrees and root overlays remain untouched. |

## 1. Automatic source selection and failure handling

- [x] 1.0 Author the two runnable pure Node unit suites against actual production behavior. Verify scoped formatting, syntax and structural validation pass and record truthful pre-implementation RED evidence below.
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

1. `node node_modules/prettier/bin/prettier.cjs --ignore-path .gitignore --check openspec/changes/support-startup-token-environment/tasks.md tests/startup-token-environment.test.mjs tests/startup-token-helper-environment.test.mjs` (use the same paths with `--write` to format, because the broad repository check intentionally excludes owner-authored tests/planning).
2. `node --check tests/startup-token-environment.test.mjs` and `node --check tests/startup-token-helper-environment.test.mjs`, then `git diff --check`.
3. With `OPENSPEC_TELEMETRY=0`, `openspec validate support-startup-token-environment --strict --no-interactive`.
4. `node --experimental-test-module-mocks --test tests/startup-token-environment.test.mjs`
5. `node --experimental-vm-modules --test tests/startup-token-helper-environment.test.mjs`

## Checks and evidence

Setup evidence, 2026-11-10: production remains exactly baseline `df2c8d0958676ba8465db8959d6299bd278125e0`. Planning checkpoint `f47458dc59ade0bd7dda76f570600a2a2e3375e8` contains only the five new change files. Root returned nondestructively to main and the assigned worktree HEAD was verified at that checkpoint before test authoring. Remote main matched the baseline at setup. Root coordination/operations/unknown files and every other worktree were preserved.

Scripts-disabled locked restore `npm ci --ignore-scripts --no-audit --no-fund` exited 0 in this worktree, without tracked dependency or lockfile changes. It reported existing dependency deprecations, not addressed by this scope. Scoped Prettier with `--ignore-path .gitignore`, both `node --check` commands, `git diff --check` and CLI 1.15.0 strict validation exited 0. The initial default formatter invocation excluded owned paths through `.prettierignore` and was replaced with the explicit scoped check. An initial test-author cwd assertion compared equivalent paths with different trailing separators. It was corrected with path normalization before final evidence.

Final source suite: 44 tests, 4 PASS / 40 expected RED, exit 1, Windows Node v26.13.0. Node counts nested failed containers as tests. RED identifies the existing file-only selection, invalid-input acceptance, ambient rather than command environment propagation, eager default lookup on MCP reuse, Windows casing leakage, file-only guidance and raw synchronous pair-launch exception disclosure. PASS covers pair reuse, MCP launch-failure non-disclosure, foreground conflict rejection and broker-only selected-file missing/protection classifications. No fallback was introduced to make a test pass.

Helper suite: 2 tests, 1 PASS / 1 expected RED, exit 1 on the same host. Existing harness allowlist passes. The actual ACL environment builder, executed in a memory-only Windows process facade, leaks the synthetic token and fails its exclusion assertion. No helper ran. The source suite uses native Node module mocking and an in-memory replacement of the JavaScript process environment reference, restored in finally, without inspecting the user's environment. No production test seam or ABI was added. The helper suite evaluates the unmodified production module body and invokes existing `verifyOwnerOnly` with fake exec and forbidden filesystem sinks. Linux execution is UNRUN, not claimed from portable source review. The broker casing regression has a Windows-specific assertion. ACL casing is exercised by its memory facade on either OS.

No integration, real process, broker, socket, filesystem lifecycle, Telegram, native helper, renderer, e2e, preflight, calibration, package/build or installed first-use check ran. Combined Architect review and independent implemented-candidate review remain pending. This is executable setup, not slice-ready, feature-verified, release-ready or landing authorization.

| Timing       | Check / status                                                                                                                                                                                                                 | Owner and trigger                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Pre-merge    | Scoped format, syntax and strict structure PASS at setup. Pure Node units are expected RED before implementation. Independent candidate review remains required.                                                               | Test/implementation owners, before finalization                                                                              |
| Pre-exposure | Installed detached startup, real-process privacy, full empty-state first decision, Telegram rejection and restart/rotation are UNRUN/UNVERIFIED, prohibited by unit-only scope. Unit success is not runtime proof or a waiver. | Release decision owner records candidate-specific risk/mitigation/expiry in status log before landing/exposure authorization |
| Post-deploy  | Actual supported first use and restart, only when non-unit testing is authorized. Not pre-merge evidence.                                                                                                                      | Runtime owner, deployment plus explicit testing authority                                                                    |
| Deferred     | Windows state/key protection defects and native ACL qualification remain separate and blocked. Local MCP/TUI stay disabled.                                                                                                    | Protection/runtime owners, separate correction and activation authorization                                                  |

## Workflow follow-up

- One change branch and one PR into main. No per-task PR, framework, executable, persistence provider or build/signing work.
- After independent review, route capability-owner delta review and one authorized CLI archive through coordination. No push, PR, archive, merge, deployment or publication is authorized by setup.
- Production allowlist is exactly `src/cli/main.js`, `src/broker/availability.js`, `src/state/protection.js`, `src/broker/startup-failure.js`. Tests/tasks stay test-owner controlled. Preserve all file/security invariants and other worktrees. Do not edit archived content, root coordination overlays or operations files.
