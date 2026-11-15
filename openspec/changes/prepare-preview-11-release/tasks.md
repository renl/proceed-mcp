# Tasks

## Delivery and scope

[Proposal](proposal.md) and [design](design.md) define this no-behavior release. One change, one branch, one PR targeting `main`. Baseline: `f9804abceb56ab9f6826382c5142d9ce46690116`. No parent dependency.

User-visible success is the corrected README reaching npm preview.11 with matching MCP Registry identity. This change enables that publication. Metadata units prove source consistency, not published bytes, installation or runtime behavior.

The independently mergeable outcome is five coupled version fields, two README pins and six maintained test literals at `0.1.0-preview.11`. Nearest landing blocker is source alignment followed by independent metadata review and exact-head CI. Last landed useful outcome is the corrected README already in the baseline.

| Lifecycle field | Value |
| --- | --- |
| Path | `.worktree/prepare-preview-11-release` |
| Branch / change | `prepare-preview-11-release` |
| Owner | Test engineering |
| Status | active |
| Next action | Implement only the metadata allowlist, then independent review |
| Cleanup evidence | Not landed. Retain through verified landing and safe cleanup |

## 1. Metadata and maintained expectations

- [x] 1.1 Preserve completed proposal/design and add only top-level `skip_specs: true` to scaffold metadata. Verify CLI 1.15.0 reports specs skipped and tasks ready, preserving `schema` and `created`.
- [x] 1.2 Change exactly three current-version literals in `tests/release-metadata.test.mjs`, two in `tests/release-pack.mjs` and one in `tests/release-installed.test.mjs`. Verify literal-only diff, unchanged negative controls and the expected RED metadata run. Do not execute the non-unit files.
- [x] 1.3 Set only `package.json.version`, `package-lock.json.version`, `package-lock.json.packages[""].version`, `server.json.version` and the existing npm entry's `version` to `0.1.0-preview.11`. Verify all nine metadata units pass and static comparison shows no other JSON changes. Do not regenerate the lockfile. Committed `63b1398`.
- [x] 1.4 Include the separately owned README source-version statement and exact installation pin updates only. Verify README differs from baseline by exactly those two substitutions, retaining all corrected guidance. Owner edit committed byte-identically in `6544a8e`.
- [ ] 1.5 Review the complete candidate independently after source alignment. Verify explicit-path syntax/format/whitespace and strict OpenSpec checks, nine passing metadata records, unchanged excluded paths and exact-head CI. Record candidate revision, reused evidence scope and all unverified checks before finalization.

### File brief

| File | Edit allowance |
| --- | --- |
| `package.json` | One version field |
| `package-lock.json` | Two root version fields, no dependency regeneration |
| `server.json` | Two version fields, no identity/description/transport/argument changes |
| `README.md` | Two version pins only, separately owned |
| `tests/release-metadata.test.mjs` | Three version literals only, completed |
| `tests/release-pack.mjs` | Two version literals only, completed, unexecuted |
| `tests/release-installed.test.mjs` | One version literal only, completed, unexecuted |
| Change-local `.openspec.yaml` / `tasks.md` | Approved skip flag / task mapping and evidence |
| Change-local `proposal.md` / `design.md` | Completed owner artifacts, preserve bytes during setup |

No runtime, skills, dependencies, CI, global configuration, installation, token/state or unrelated test changes. Leave all older owner-conflict assertions and associated journal/reservation/delete expectations untouched and deferred. No new tests, framework or boundary gate. Decomposition checklist 1-5: NO for changed cross-unit obligations. This is one routine version-alignment unit with no changed interface or split proof chain.

### Run sequence

Run from the assigned worktree. Commands use Node and the existing CLI and work on PowerShell or a POSIX shell. Use bounded execution, at most 30 seconds per command. No installs.

1. Syntax: `node --check tests/release-metadata.test.mjs`, `node --check tests/release-pack.mjs`, `node --check tests/release-installed.test.mjs`. These parse files without running them.
2. Format owned setup: `node ../../.tools/postmerge-recovery/2026-11-06/implementation/node_modules/prettier/bin/prettier.cjs --check openspec/changes/prepare-preview-11-release/tasks.md openspec/changes/prepare-preview-11-release/.openspec.yaml tests/release-metadata.test.mjs`. Existing formatter version MUST be `3.9.10`. Do not format entire non-unit files, owner artifacts or README.
3. Metadata units only: `node --test tests/release-metadata.test.mjs`. Nine records map identity/coupling, public preview config, descriptions, mutation controls, package metadata, license, Registry identity, parser mapping and mapping mutation controls. No actual Registry/client/wire proof is implied.
4. Static JSON comparison against baseline permits only the five listed substitutions. Review test diff for only the six authorized literals, README for only two substitutions, and all remaining paths for exclusion compliance.
5. `git diff --check` and `openspec validate prepare-preview-11-release --strict`.
6. After implementation, independent complete-candidate review and existing exact-head CI. No forbidden suite is added to execution.

### Checks and evidence

| Phase | Status / obligation | Owner and trigger |
| --- | --- | --- |
| Pre-merge | Setup units: nine executed, seven PASS and two expected RED (`PREVIEW-SCOPE`, `PREVIEW-META`) against preview.10 source. Exit 1, zero skipped. Node 26.13.0 on Windows. Source still needs alignment | Implementation, then independent Test engineering review |
| Pre-merge | Setup syntax for all three test files, owned explicit-path Prettier 3.9.10 check, whitespace and strict CLI validation PASS. Static assertions confirm exactly six literal edits, unchanged source metadata and byte-identical proposal/design. Independent candidate review and CI pending | Test engineering / delivery, on complete candidate |
| Pre-exposure | New preview.11 artifact identity, exact README source-copy comparison and candidate-specific exposure disposition pending. Preview.10 hashes are not reusable for new packed inputs | Release operations / release owner, after clean merged `main`, separately scoped |
| Post-publication | Exact-version npm bytes/tags and matching Registry public readback pending, not performed by this setup. Preserve latest preview.1 | Release operations and independent verifier, after authorized publication |
| Deferred | Non-unit release checks and obsolete owner-conflict probes remain unrun/unverified, not passed or repaired by version maintenance | Test engineering, when separately authorized |
| Deferred | Installed startup, native platform, Telegram/client, multi-directory and runtime first use remain unverified for preview.11. No installation is authorized | Release owner, when separately authorized after deployment |

## Implementation evidence

Candidate: base `f9804abceb56ab9f6826382c5142d9ce46690116`, test engineering setup `f506fe1657564f220c9e9b756be36a9baf7c0986`, metadata commit `63b139821f07362416a7e133229994c1d788151e`, README commit `6544a8e86dc2bde62b303bc850f8072dcac4d942`.

- Changed paths against the setup head: `package.json`, `package-lock.json`, `server.json` for the five version fields, and the owner-completed `README.md` for two pins. No other tracked path differs from `f506fe1`; this tasks file is the only other edit and carries just these ticks and this evidence. No dependency, identity, publish-config, description or behavior edit is present.
- README preservation: the two pins are the only README substitutions against the baseline, and the committed file is byte-identical to the owner-prepared working copy (SHA-256 `20F1AE224330252F7C85829C26A5538BB8E3DBD5B9ECFF35544BB4E79D76BC2D` before and after commit). The 5-line skill-scope table at lines 203-207 is pre-existing alignment debt that fails identically on baseline `f9804ab`, so it is left unmodified rather than reformatted.
- Focused metadata units: `node --test tests/release-metadata.test.mjs` moved from 9 records, 7 pass, 2 expected RED (`PREVIEW-SCOPE`, `PREVIEW-META`), exit 1 against preview.10 source, to 9 pass, 0 fail, 0 skipped, exit 0 after task 1.3. Node 26.13.0 on Windows. This is source consistency only, not published-bytes, installation or runtime proof.
- Static coupling comparison against the base blobs, parsed and flattened leaf by leaf: exactly five permitted version leaves differ, namely `package.json` `version`, `package-lock.json` `version` and `packages[""].version`, and `server.json` `version` and `packages[0].version`, each `0.1.0-preview.10` to `0.1.0-preview.11`. Zero unexpected leaf diffs confirm the whole dependency graph and every other field are unchanged, with no lockfile regeneration.
- Syntax: `node --check` passes for all three maintained test files. `git diff --check` passes. CLI 1.15.0 `openspec validate prepare-preview-11-release --strict` passes with zero deltas accepted under `skip_specs`.
- Scoped format: pinned Prettier 3.9.10 byte comparison passes for `package.json`, `server.json`, `tasks.md`, `.openspec.yaml` and the three maintained test files. The repository ignore file skips `openspec/`, `tests/` and `package-lock.json` for explicit-path checks, so those paths were compared through the same pinned formatter instead. `package-lock.json` is formatter-ignored by owner decision.
- Unrun under the unit-only restriction: pack, installed, integration, renderer, e2e, calibration, preflight, build, install and publication checks. Deferred and unverified, never recorded as passed.
- Failure history: the two expected RED records were the only failures. No repeated failure without new evidence occurred. Evidence reuse applies only to unchanged inputs and assertion scope.

## Workflow follow-up

- Obtain owner finalization review and repair move-sensitive owner links before archive. Do not edit archived content.
- After independent review and required checks or eligible recorded scoped acceptance, obtain the separate ready-PR merge decision. One authorized CLI archive belongs inside this change's single PR.
- Qualify and publish only from clean merged `main`. Publication authority does not grant installation, runtime operation or a forbidden test run.
- Retain this worktree until verified landing, then complete safe cleanup under Test engineering ownership. Record terminal evidence outside the immutable archive.
