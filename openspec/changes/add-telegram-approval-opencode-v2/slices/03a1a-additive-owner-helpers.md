# 03A.1a — additive owner/config helper binding

Parent: [03A checkpoint gates](03a-portable-shared-waiting.md#checkpoint-gates-and-sizing), [tasks](../tasks.md). Authority: [design section 2](../design.md), corrected [Telegram](../specs/telegram-approval/spec.md) and [portable delivery](../specs/opencode-session-continuation/spec.md) deltas. The exact private exports below are the implementation-selected seam supplied for this binding, not new public requirements.

## Goal and custody

Founder-visible success remains: the paired human's exact Approve, Reject or Respond reaches the correct original waiting MCP call among parallel shared-connection requests. These helper units only enable later proof; their assertions are **unit proxies**, not setup, waiting, Telegram, host or release proof.

| Field | Value |
|---|---|
| Worktree / branch / change | `.worktree/add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` |
| Project baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Authoring parent | `0653b16`; corrected dirty owner artifacts present and preserved |
| Prerequisite | Accepted 03A decomposition/boundary and supplied implementation-selected additive seam; no consumer-switch prerequisite |
| Status / next action | Test/spec binding prepared, helper tests RED; implement only the two new modules, then affected independent acceptance |
| Owner / lifecycle | Test engineering; active/retain; same change worktree, no cleanup due |
| Delivery | Internal checkpoint on the existing branch, one eventual OpenSpec PR; no partial promotion/archive |

## Exact implementation scope

Only new production files `src/config/portable-config.js` and `src/state/owner-credentials.js`. Forecast supplied by implementation: approximately 115 + 45 LOC, **not a measured diff**. No existing consumer, shared schema constant, journal, CLI, broker, waiting code, catalog, dependency or public boundary changes. Existing config and journal schema/format stay 1. Production must not import test code. Reuse existing error/credential/protection helpers as appropriate; private implementation algorithms remain implementation engineering's choice.

Test-owned files: `tests/portable-config-unit.test.mjs`, `tests/owner-credentials-unit.test.mjs`, `tests/portable-helper-invariants.test.mjs`, this slice, parent 03A link and `tasks.md` index. No unrelated tests or owner documents change. Review measured additions plus deletions against the pinned pre-checkpoint revision; include associated test/spec surface, with preparation and later production growth accounted separately. Keep the combined review packet near 20 files/600 gross lines; no exception authorized.

### Selected signatures and deterministic assertions

| Module / exports | Selected behavior and test binding |
|---|---|
| `portable-config.js`: `CONFIG_SCHEMA_VERSION`, `OWNER_ID_PATTERN`, `OWNER_LABEL_MAX_SCALARS` | `2`, `/^[a-z0-9_-]{1,64}$/`, `128`; distinct from still-active legacy constants |
| `validateOwnerId(value)`, `validateOwnerLabel(value)` | Return valid original strings. IDs match that pattern; labels contain 1–128 Unicode scalars, preserve exact whitespace/normalization, reject unpaired surrogates. Invalid input: `INVALID_ARGUMENT`, exit 2 |
| `createOwner({ownerId,label})` | Return validated `{owner_id,label}` |
| `createEmptyConfig()` | `{schema_version:2,telegram:{token_env:'PROCEED_TELEGRAM_BOT_TOKEN'},broker:{port:43189},owners:[]}`; no origins |
| `withOwner(config,owner)` | Return immutable append; duplicate owner ID fails exit 2 without changing original records; equal labels with distinct IDs allowed |
| `parseConfigDocument(text)` | Malformed JSON: `CONFIG_CORRUPT`/4; old or unknown schema: `UNSUPPORTED_CONFIG_VERSION`/4; invalid structure/env/port/owners/duplicates: `INVALID_ARGUMENT`/2. Ports integers 1–65535. Canonical rebuild retains only schema-2 fields, not origins/unknown fields |
| `serializeConfig(config)` | JSON with two-space indentation and final newline; schema-2 roundtrip |
| `owner-credentials.js`: `OWNER_CREDENTIAL_PREFIX`, `OWNER_CREDENTIAL_SUFFIX` | `'owner.'`, `'.token'` |
| `ownerCredentialFileName(ownerId)`, `ownerCredentialPath(credentialsDir,ownerId)` | Validate ID, derive `owner.<id>.token` in explicit directory; traversal/invalid IDs fail exit 2 |
| `writeOwnerCredential(file)` | Create independent 256-bit token; return only `{file}`, never token. Existing file: `OWNER_ALREADY_CONFIGURED`/2 with original bytes unchanged |
| `readOwnerCredential(file,ownerId)` | Return 64 lowercase hex token from selected file; absent: `CREDENTIAL_MISSING`/3; malformed: `CREDENTIAL_INVALID`/4, without exposing malformed contents |

`PORT-HELPER-CONFIG` covers schema/scalars/IDs/immutability/parse/serialize; `PORT-HELPER-CREDENTIAL` covers path validation, independent files/tokens, immutable duplicates, return-value secrecy and read failures. `PORT-HELPER-OLD` checks the existing config roundtrip and journal header/frame schema 1. `PORT-HELPER-UNUSED` scans existing production modules for references to the additive seams. These last two are deliberately checkpoint-local invariants: rebind/retire only at the separately authorized consumer switch, not to make this additive checkpoint green.

## Boundary and decomposition applicability

No new external platform/transport or normative cross-component contract. Existing 03A Boundary Verification remains accepted and unchanged; no blanket re-review. Local filesystem credential creation uses an isolated ignored test namespace. This test does not claim OS ACL/permission proof; protected state and credential verification through public setup remain required by PORT-SETUP. No live credentials, `.env`, network, host or Telegram used.

Checklist scoped to changes beyond the accepted 03A sequence: 1 NO (same approved schema/credential contract, selected private seam only); 2 NO (unused additive files, isolated scratch); 3 NO; 4 NO (helper pass never replaces later gates); 5 NO (no fixture/proof dependency crosses units). No new test-only schema/interface/prototype is introduced. If implementation changes a cross-unit contract or consumes the helpers early, stop and request narrow fidelity review through coordination; existing approval does not authorize that expansion.

## Run sequence — PowerShell, Windows Node 24

From the assigned worktree, set `$Node24` to the provided project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`; system Node 22 is not this execution environment. Pure value/filesystem unit checks require no service harness. No install/build/network required for this test-only preparation.

1. Confirm `git check-ignore .scratch/small03a1a/probe` before any fixture writes. The credential test explicitly roots `mkdtemp` under worktree `.scratch/small03a1a/`, never OS temp; unique run directory removed and absence asserted in `finally`. No child process/service is started by these tests.
2. `& $Node24 --check tests/portable-config-unit.test.mjs`; repeat for `tests/owner-credentials-unit.test.mjs` and `tests/portable-helper-invariants.test.mjs` (10s each).
3. `& $Node24 --test tests/portable-config-unit.test.mjs tests/owner-credentials-unit.test.mjs tests/portable-helper-invariants.test.mjs` (30s outer bound; credential case 15s). All seven tests must pass for helper acceptance; missing imports fail explicitly, never skip.
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s; repository excludes test/OpenSpec files); `git diff --check` on the exact six owned paths. Implementation also runs its affected syntax/build/format checks.
5. Do not require PORT-SETUP green here. At the later coherent consumer switch run its three cases per parent 03A, then reservation, then waiting. The earlier forecast of three bounded consumer-switch internal commits is follow-on sizing input only, not implementation/refinement authority in this packet. Pin the accepted helper commit before those consumers begin.

## Authoring evidence

At parent `0653b16`, Windows Node **24.22.2**, all three syntax checks exit 0. Combined command exits **1**, **7 tests: 2 PASS / 5 RED / 0 cancelled / 0 skipped**, 111.5558ms. Five helper cases stop at `ERR_MODULE_NOT_FOUND` for the two selected modules; assertions beyond imports are unexecuted. Both legacy schema/framing and no-consumer-reference invariants PASS. Scratch ignore confirmed; missing imports occur before fixture creation, so no credential namespace/process/listener exists to clean up. Full PORT-SETUP remains RED per the unchanged schema-1 prerequisite and prior 03A evidence, not rerun here.

Repository formatter and staged owned whitespace checks exit 0. Final preparation packet versus `0653b16`: **6 owned files / 252 gross added lines / 0 deletions**; supplied production forecast adds about 160 lines in 2 files (combined forecast about 412 lines / 8 files, not measured production). No production diff; `.scratch/small03a1a` absent. The format exclusions mean syntax plus explicit assertion review, not formatter coverage, applies to these test/spec files.

This is executable preparation for implementation, not green slice acceptance or integrated-candidate verification. Parallel dirty/untracked owner, operations, containment and research artifacts are preserved. Worktree cleanup status: retained active; next action bounded helper implementation and affected verification.
