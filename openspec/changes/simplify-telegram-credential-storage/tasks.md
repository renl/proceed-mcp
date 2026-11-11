## Landing and lifecycle

Mergeable outcome: one independently landable correction lets private token provisioning and broker loading use ordinary separated plaintext storage, with matching README and unpublished preview.5 metadata. Owner scenario-name corrections and the combined Architect review are complete. Nearest landing blocker: production still enforces token-specific protection admission and metadata remains preview.4. This brief is implementation-ready, not candidate-verified.

- Baseline: `main` at `831b714158e9759be012e2826c75140bbd26e757`, confirmed against remote main before creation. Prerequisite: none. One change, one PR into main, no stacked parent.
- Worktree: `.worktree/simplify-telegram-credential-storage`. Branch/change: `simplify-telegram-credential-storage`. Lifecycle owner: test engineering. Status: implementation-ready. Next action: implement tasks 2.1-2.3 through the normal handoff, then independent complete-candidate review. Cleanup evidence: not eligible, implementation and landing pending.
- Preserve root owner drafts and superseded worktrees. This task does not authorize publication, installation, activation, archive or merge.

## Outcome and proof

An operator can privately configure Telegram once and later use normal token-free MCP startup without token-file permission preparation or a separate broker terminal.

The first useful increment is this complete correction, including token I/O, truthful CLI/README guidance and coupled preview.5 metadata. Internal checkpoints share one branch and do not land separately. No new framework or prerequisite-only increment is needed. Direct proof would be installed private setup followed by a fresh token-free launch and a matching human approval returned to the waiting call. That proof is prohibited in the current unit-only scope and remains unverified. Memory-only CLI/storage assertions prove the selected unit contracts, not native permissions, terminal privacy, installed startup or Telegram delivery.

Inputs: [proposal](proposal.md), [design](design.md), [delivery delta](specs/opencode-session-continuation/spec.md), [distribution delta](specs/npm-distribution/spec.md), and the current merged capability specs. The separately reviewed preview.4 README draft is not a dependency. Its owner may adapt it later, reconciling merged main without copying unpublished claims into released instructions.

## 1. Test-first contract and review checkpoint

- [x] 1.1 Transfer the CLI scaffold and all four owner artifacts byte-identically from the root drafts. Verify the feature HEAD equals the pinned baseline and preserve the original drafts.
- [x] 1.2 Replace superseded token-only protection assertions with ordinary-storage regressions in the existing shared unit suite. Keep protected state/key caller checks. Verify the explicit unit commands below and record RED/GREEN separately.
- [x] 1.3 Obtain one combined Architect boundary, decomposition and test-fixture review of this file and changed tests. Completion is the review disposition, not CLI structural validation. Approved disposition supplied with the readiness handoff. No duplicate pre-implementation review is required.

## 2. Ordinary token storage and matching operator guidance

- [ ] 2.1 Implement design decisions 1-4 in `src/state/credential-file.js`. Disconnect only the token caller from protection admission. Use ordinary creation defaults without mode overrides, permission queries or chmod. Keep type/nonredirection, exclusive creation, identity, separation including resolved ancestry with missing tails, bounded reads, flush completion and conservative cleanup. Verify U1 and U2 pass without weakening protected-caller assertions.
- [ ] 2.2 Update token help/success/error guidance in `src/cli/main.js` and the matching `README.md` flow. Explain ordinary plaintext exposure and no permission preparation/repair. Preserve CLI syntax, private input, no overwrite, source selection, protected state/key prerequisites and truthful local-persistence-only success. Verify U1, U2 and the manual static README checks below.
- [ ] 2.3 Prepare unpublished `0.1.0-preview.5` in `package.json`, both package-lock root versions, `server.json` top-level version and its npm package reference. Do not change dependencies, package identity, scripts or release tags. Verify U3 passes. README must be a concise current installation and use guide, not a release history. Keep actually released preview.4 installation primary until a later authorized publication is confirmed, with preview.5 behavior explicitly unreleased. Leave historical evidence in its existing records, not in README.

## 3. Integrated candidate review before finalization

- [ ] 3.1 Run scoped format, structural and unit checks on the complete candidate and obtain independent review tied to its revision. Verify the changed path set stays within the allowlist and shared protected callers remain unchanged. Record failed or unrun checks truthfully.
- [ ] 3.2 Resolve candidate-specific landing/exposure acceptance through the project status record and obtain primary spec-author delta review against current main. Completion requires explicit dispositions. Prior preview acceptance does not carry over.

## Files and constraints

Implementation allowlist: `src/state/credential-file.js`, token-related text only in `src/cli/main.js`, `README.md`, version fields only in `package.json`, `package-lock.json`, `server.json`. Tests and this tasks file are test-engineering owned. Owner artifacts are preserved transfers, not implementation-editable criteria. No production changes were made during setup.

Review-size plan: setup exceeds the advisory line signal, mainly from transferred owner artifacts. Review in order: approved contract transfer and CLI scenario-preservation correction, shared storage/CLI regressions together with unchanged protected-caller inventory, then production disconnect with matching guidance and metadata. Keep one combined pre-implementation review and one independent complete-candidate review, not extra PRs or a framework prerequisite.

Do not edit shared `src/state/path-trust.js` or `src/state/protection.js`, or reroute protected callers. Review design decision 4's full shared-caller inventory together with the token disconnect. State/configuration, operator/control/owner keys, journals, ownership locks, channel keys, pairing and decision authority retain existing admission. No new JSON/config schema, chat-ID rule, command/config rename, `.env` loader, helper, compiler, signing, harness, migration or install hook. Changes to this allowlist require owner routing, not incidental scope expansion. Do not touch other worktrees, unknown files, root status or immutable archive content.

## Boundary Verification and combined review

- Category: normative public CLI and cross-component broker credential contract. No new Telegram/network protocol or wire URL is introduced. Filesystem and terminal behavior are real OS boundaries, represented only by controlled unit substitutes here. Actual OS boundary proof remains deferred, not passed.
- Contract: design decisions 2-4 and the delta requirements `Automatic startup preserves credential and readiness boundaries`, `Credential provisioning and loading fail closed`, `Credential limitations and foreground compatibility remain explicit`, plus distribution requirements `Public package and explicit prerequisites` and `Complete first useful action from empty state`.
- Exact interface remains `proceed-mcp telegram provision [--token-stdin] [--telegram-token-file <absolute-file>] [--state-dir <directory>]`. Existing `stateKey`, default `.proceed-mcp-credentials/<state-key>/telegram.token`, one 1-4096-byte ASCII non-whitespace line plus LF, 4098-byte input limit and 60000 ms input deadline remain. No name or payload mapping is introduced.
- Explicit file > nonempty configured token environment > default file. Empty/absent environment permits default selection. No selected-source fallback, no adapter file-content load, and healthy secure reuse precedes token selection. Existing collision `TELEGRAM_CREDENTIAL_EXISTS` exit 2, missing/malformed `TELEGRAM_CREDENTIAL_UNAVAILABLE`, and storage-failure compatibility remain.
- Source cross-check: baseline `credential-file.js` implements the existing entry points and constants but deliberately differs on owner/mode/Windows protection admission. That is the approved behavior delta, not an interface-name mismatch. `src/cli/main.js` and the existing source-selection suite preserve orchestration signatures. No production-imported test API is added.
- Fixture review: `proceed-credential-memory.mjs` replaces filesystem, subprocess, platform/path, configuration and runtime boundaries before subject imports. Added observations record ordinary creation arguments, controlled access/flush failures and realpath resolution. They do not supply a replacement policy. Existing actual shared protection policy evaluates synthetic Windows reports. No real token/state/terminal/process/native query is touched.
- Decomposition triggers 1-5: NO, NO, NO, NO, NO for newly split cross-unit proof obligations. One correction, fresh per-case memory state, no event producer or dependent branch. Public/security boundary and changed test-only observations still trigger the combined review. Do not mark implementation-ready before that disposition.

## Test mapping and run sequence

All commands are finite native Node commands, portable to Linux and Windows. Use Node >=24 with module mocks. Local results use Windows Node v26.13.0, not actual Linux CI. Each unit file owns isolated substitutes. They have no cross-file state prerequisite. Run format/static first, U1, U2, then U3. Stop for fixture/contract ambiguity rather than changing criteria. Do not run `npm test`, directory selections, wildcards, build, pack, preflight, native queries, integration, renderer, calibration, e2e or runtime checks.

| Check | Exact command | Contract/assertion scope |
| --- | --- | --- |
| U1 | `node --experimental-test-module-mocks --test tests/proceed-credential-posix-unit.test.mjs tests/proceed-credential-windows-unit.test.mjs tests/proceed-setup-cli-unit.test.mjs` | Ordinary Windows/POSIX token admission and no query/chmod/mode override, private/public CLI input, ordinary I/O failure, no overwrite, identity/replacement/cleanup, separation including missing tails, bounds and nondisclosure. POSIX operator-key caller remains protected. |
| U2 | `node --experimental-test-module-mocks --test tests/windows-storage-node-unit.test.mjs tests/startup-token-environment.test.mjs tests/startup-token-helper-environment.test.mjs tests/proceed-setup-package-unit.test.mjs` | Actual shared protected state/config/key/journal/lock caller admission under memory substitutes, unchanged token-source precedence and broker-only loading/reuse, secret-free helper environment and secret-free installation metadata. No real runtime or native query. |
| U3 | `node --test tests/release-metadata.test.mjs` | Candidate preview.5 coupled metadata and retained distribution identity. Static metadata only, not package admission. |
| Structure | `openspec validate simplify-telegram-credential-storage --strict` | Active change structure only. |

Format changed authored tests/tasks with `node node_modules/prettier/bin/prettier.cjs --write <explicit-paths>`, then `--check` on the same explicit paths. Owner artifacts may receive authorized mechanical formatting only, without semantic rewrites. Never format archive records. For implementation, extend that explicit path list only with the allowlisted changed files. `git diff --check` checks tracked whitespace. If dependencies are absent, the existing-lock `npm ci --ignore-scripts --no-audit --no-fund` bootstrap is allowed, with no dependency edits.

Manual static README review maps to the distribution delta's `Explain supported Windows credential prerequisites` and `Current installation guidance remains primary` scenarios: concise current installation/use only, no release history, current released installation first, unreleased preview.5 clearly separated, plaintext read/misuse risk including OS-accessible processes/admins/backups, no token permission preparation, state/transport/provision/pair/start steps distinct, consistent explicit path later, remove higher-priority launch token for default selection, environment/foreground alternatives retained, stop/replacement for rotation, no reinitialization required for existing safe setup and no claims of verified first use.

## Checks and evidence

| Phase | Status, failure/unknown, owner and trigger |
| --- | --- |
| Pre-merge | Required: combined Architect review, U1-U3 GREEN, scoped format/structure, independent complete-candidate review, owner delta review and current-baseline reconciliation. Current token and metadata RED belongs to implementation and is expected before implementation, never marked passed. |
| Pre-exposure | BLOCKED/UNVERIFIED installed/package, genuine OS/terminal and first-use proof under the explicit unit-only restriction. Owner: release owner. Trigger: candidate-specific recorded landing/exposure decision, not inherited preview.3/4 acceptance. No publication permission here. |
| Post-deploy | UNRUN: actual private configure-once, safely stopped broker then token-free fresh launch, same waiting-call human approval, existing setup preservation and login/reboot behavior. Owner: operator. Trigger: authorized deployment and permitted manual verification. |
| Deferred | UNRUN native protected state/key enforcement, terminal privacy, OS identity/races, actual Telegram delivery and multi-harness compatibility. Owner: release/verification owners. Trigger: non-unit testing authorized. The plaintext confidentiality tradeoff is accepted scope, not an unresolved check. |

Setup execution against production baseline `831b714158e9759be012e2826c75140bbd26e757`, Windows Node v26.13.0:

- Scripts-disabled existing-lock bootstrap: exit 0, no dependency metadata changed.
- U1: exit 1, 177 Node records, 158 PASS / 19 RED. Expected RED covers token owner/mode/link/query admission, chmod/default creation modes, permission-only changes, resolved ancestry with a missing tail and plaintext CLI guidance. Counts include Node parent/subtest records, not distinct behavior claims. The earlier run before the added POSIX protected-caller assertion was 157 PASS / 19 RED, superseded by this final run.
- U2: exit 0, 177/177 PASS, no skipped or cancelled records. Evidence covers the unchanged shared-caller/source-selection assertions and changed removal of the superseded token-only query refusal. This is controlled unit execution, not native or runtime proof.
- U3: exit 1, 6 PASS / 3 RED from metadata remaining preview.4 rather than the specified unpublished preview.5. No metadata was changed during setup.
- Scoped Prettier check: exit 0 for all seven changed test/fixture files and this tasks file. `git diff --check`: exit 0.
- `openspec validate simplify-telegram-credential-storage --strict`: exit 1. The CLI rejects omitted current scenario names in two MODIFIED blocks. In distribution `Public package and explicit prerequisites`, preserve `Explain supported Windows credential prerequisites`. In delivery `Credential provisioning and loading fail closed`, preserve `Automatic-startup credential is missing or unsafe`, `Supported Windows credentials can be provisioned and loaded`, `Windows file protection is unsupported or unverifiable`, `Windows parent inheritance is unsafe`, and `Protection changes during credential access`. Proposed renamed scenarios currently replace these names. Both delta files also have nonblocking introductory-text warnings. The primary spec author must reconcile this without restoring superseded permission semantics. No `--no-validate`, manual sync or archive bypass is permitted.
- Correction record: gap ID pending coordination assignment. Attempts: 0, owner artifacts deliberately unchanged. Next owner: primary spec author, via coordination. Trigger: strict validation output above. After correction, rerun structural validation and review only affected test mappings if meaning changes.

Readiness follow-up against setup HEAD `e4cec900f028500100a77ed1fcd9d6265bd9c570`:

- The primary spec author restored all six required scenario names in the two delta files, with scenario bodies unchanged. The Architect approved the combined boundary, decomposition and fixture review and updated the design to require a concise current-only README. This task update aligns the README criteria without changing test assertions or production semantics.
- Ordinary `openspec validate simplify-telegram-credential-storage`: exit 0, valid. Strict validation: exit 1 solely for two introductory-text warnings, one in each delta. No scenario-preservation errors remain. Strict is not passed. These advisory prose warnings do not block implementation readiness and are not authorization to bypass later archive or landing gates. Next owner: primary spec author for warning disposition before finalization, through coordination.
- U1/U2/U3 evidence above is reused, not rerun. Production, tests, fixtures, dependency metadata and unit inputs are unchanged. U1 and U3 remain expected RED, U2 remains GREEN within its recorded controlled-unit scope. No genuine OS, installed or runtime proof is claimed.
- Scoped Prettier check passes for this tasks file, the three corrected owner files and the seven existing changed test/fixture files. No mechanical formatting edits were needed. `git diff --check` passes. Only tasks, design and the two delta files change after the setup HEAD.

No integrated candidate exists yet. Scratch logs under `.scratch/simplify-unit/` contain bounded TAP output for the RED and GREEN runs. They are ignored local evidence, not production or release artifacts. Shared fixtures and tests are test-only. No production, root status, other worktree or archived file was edited.

## Workflow follow-up

- After independent review and owner delta review, obtain the separate authorization for one CLI archive and the single change PR merge. Finish active-folder evidence before archive. Confirm any later finalization delta is docs-only or revalidate affected inputs.
- Test engineering retains worktree lifecycle ownership until verified landing and safe removal, or explicitly authorized abandonment with recovery. Preserve the root drafts and superseded hotfix worktree. This setup authorizes no cleanup of those resources.
