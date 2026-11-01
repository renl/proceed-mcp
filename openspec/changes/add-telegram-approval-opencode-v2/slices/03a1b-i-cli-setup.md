# 03A.1b-i — public CLI setup consumer checkpoint

Parent: [03A](03a-portable-shared-waiting.md#checkpoint-gates-and-sizing), [tasks](../tasks.md). Authority: [design 2/4 and Migration Plan](../design.md), [portable delivery delta](../specs/opencode-session-continuation/spec.md), [Telegram delta](../specs/telegram-approval/spec.md).

## Goal, baseline and disposition

Founder-visible success remains a paired human's exact decision returning to its original waiting MCP call among parallel requests. This checkpoint only makes operator-owned schema-2 state and independent protected principal files available for later runtime proof. Public CLI assertions directly prove that setup subset; for the founder outcome they are **enabling proxies**, not waiting, broker, Telegram, host or release proof.

| Field | Value |
|---|---|
| Path / branch / change | `.worktree/add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` |
| Project baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Prerequisite | Chain on helper `5ac0b2521edbac8ab6bd64bf421fd1f80b5724f2`, present here; independently helper-accepted, not feature-accepted |
| Authoring parent | Initial `142962d`; readiness correction `f67f6e4397615f932bcebc4c4d20d42745232af3`; dirty owner artifacts preserved, not committed by test engineering |
| Owner / lifecycle | Test engineering; active/retain; next action bounded three-file implementation through coordination, then affected independent verification |
| Status | **Ready for bounded implementation**, not behavior-accepted; clarified refusal tests remain RED at the schema prerequisite |
| Delivery | Sequential checkpoint on the existing branch, one eventual OpenSpec PR; no merge/archive/promotion of intermediate state |

## Exact bounded scope

Production touch list for review: `src/state/paths.js`, `src/state/store.js`, `src/cli/main.js` only. Use accepted additive schema-2 config and owner credential helpers for init/load/owner creation. Add owner file derivation to state paths; enforce validated owner IDs before deriving files. Public `init` creates empty schema 2; `owner add <owner_id> --label <label>` creates immutable records with independently protected credentials. Preserve current exit categories, refuse duplicate/invalid IDs without changing config or existing credentials, print no secrets, and verify actual protection of state/config/journal/credential directory/control/owner files. Windows POSIX mode alone is insufficient. No new route, force flag, recovery command, production test API or test-dependent application.

Naming binding: the implementation-selected 03A.1a seam derives `credentials/owner.<owner_id>.token`; use the validated owner record, not an arbitrary caller-supplied path or a label. This is the chosen seam under test, not an invented public contract. Equal labels do not merge owners. The helper's `readOwnerCredential(file,ownerId)` does not itself bind that file; later MCP/startup consumers must verify correct selection separately.

Do not switch journal framing/schema constants, broker/server/MCP consumers or request/catalog/waiting logic in this packet. Current init may still create journal format 1; format-2 creation/rejection remains explicitly RED under PORT-SETUP-SCHEMA until the separately sized journal/runtime checkpoint. Do not fabricate a version-2 header without a compatible writer/replayer. Reuse existing protection/files helpers; if fulfilling this scope requires more production paths, return revised sizing before expanding it.

Switching the store configuration loader may make legacy origin-based CLI/broker consumers incompatible. That is an explicitly **branch-only prerequisite state**, not a passing feature or merge candidate. Do not retain an API/password fallback to make old tests pass. Full portable setup acceptance requires later compatible broker/runtime/MCP wiring and all three PORT-SETUP cases green together. Existing origin/API tests are historical, never portable acceptance.

### Stopped broker and immutable ownership

Design 2's **Owner-add stopped-state prerequisite** requires established absence of `broker.lock` before mutation. Any existing record means exit **3**, including live/stale/malformed/empty/unreadable records. Stat/access failure establishing existence or absence means exit **4**; unreadability after existence is known still means exit 3. Preserve config, journal, all existing credential bytes/inventory and record bytes; create no new owner credential. No PID-based mutation, record deletion, force or recovery is authorized. Synthetic records and test-owned filesystem faults assert this through the public CLI; no real broker/record is touched. This is not race-free exclusion proof; design 4 concurrency acceptance remains later.

Clarification is resolved by the persisted design 2 clause and Migration Plan 5 **Setup-only sequencing**. Targeted Architect decomposition approval was conditional on faithful additional refusal tests and explicit incomplete-branch sequencing; this correction fulfills those conditions. No new contract is introduced by the fault shim: it wraps only Node filesystem operations on the run-owned lock path, never private application APIs. Production must not import or depend on it. Unreadable-case refusal may use existence alone without triggering a read; exit-4 cases require a fault-hit marker so an uninjected exit cannot pass.

## Unique executable gate and sequencing

Test-owned paths: `tests/portable-setup-cli-checkpoint.test.mjs`, this slice, parent 03A and `tasks.md`. `PORT-CLI-I` is a unique consumer gate, not the old no-consumer invariant or a filtered waiting test. It covers public init, actual owner addition, two independently named files, duplicate/invalid refusal, equal-label independent principals, no disclosure, native ACL inspection and seven immutable ownership-refusal cases. Mapping: portable delivery delta's transport-principal setup and Telegram fail-closed requirements → design 2/Migration 5 → these public CLI assertions. Local setup proof only; full outcome acceptance remains downstream.

PowerShell/Windows project Node 24.22.2, `$Node24` = project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`:

1. Confirm ignore: `git check-ignore tests/.artifacts/probe`. Existing managed fixture owns unique local namespaces and verifies removal; public CLI subprocesses have 10s timeouts, scrubbed environment and local TEMP/TMP/TMPDIR. No service or network is started. Independent ACL inspection runs against only those generated paths. Native execution is representative of local CLI and Windows ACL behavior, not cross-OS proof.
2. `& $Node24 --check tests/portable-setup-cli-checkpoint.test.mjs` (10s).
3. `& $Node24 --test tests/portable-setup-cli-checkpoint.test.mjs` (400s outer, 95s/case). Require **8 PASS**, no skipped/cancelled cases. Run helpers `portable-config-unit.test.mjs` and `owner-credentials-unit.test.mjs` at consumer acceptance to establish affected seam compatibility; no helper changes authorized here.
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s, tests/OpenSpec excluded); `git diff --check -- <exact owned paths>`; affected production syntax/build checks per implementation report. No installs, full legacy suite or live setup.
5. On the **actual consumer switch**, mark `portable-helper-invariants.test.mjs` historical/superseded in the active suite: its schema-1/no-consumer assumptions were valid solely for 03A.1a. Do not weaken/remove that historical evidence or run it as a future green gate. Pure helper tests remain active. This authoring packet has not switched consumers, so current invariants remain valid at the pinned helper candidate.
6. Later sequential checkpoints: compatible format-2 journal/store and broker/MCP owner wiring → all three `PORT-SETUP` cases → `PORT-RESERVE` → full offline PORT-A/B. Each needs its own pinned candidate, exact tests and fresh bounded sizing; none is accepted by PORT-CLI-I. First-host/real Telegram/ownership races/flush proof remain later required boundaries.

## Sizing and narrow review trigger

Correct sizing reference: [03A checkpoint gates and sizing](03a-portable-shared-waiting.md#checkpoint-gates-and-sizing), not a separate `03asizing` file. Supplied implementation forecast for this checkpoint: **3 production files / approximately 200 gross changed lines**, paths/store/CLI only. This is a forecast, not measured production or a reservation for other consumers. Compare the complete checkpoint against initial test-authoring baseline `142962d` using additions plus deletions; report the four measured test/spec/index paths separately from forecast production and never double count readiness corrections. Target combined review below approximately 600 gross lines; phase before approaching/exceeding that limit. No size exception, extra production paths or early journal version bump is authorized.

Decomposition checklist: **1 YES** (schema-2 store feeds later runtime), **2 YES** (changed clean setup state/journal mismatch), **3 NO** (no receiver here), **4 YES** (setup→runtime acceptance), **5 YES** (later proof consumes this setup). Targeted Architect conditional approval is now fulfilled as recorded above; no blanket review-pending blocker remains. Boundary applicability: local public CLI/filesystem only; no new external platform interaction or changed wire contract. The accepted parent Boundary Verification remains pinned; no repeated Telegram/MCP interface-fidelity review required for these faithful assertions. Expansion into broker/MCP/journal or a new cross-component contract requires renewed targeted review and test binding first.

## Authoring execution — 2026-10-31

At `142962d` (production identical to helper candidate `5ac0b25`), project Windows Node **24.22.2**: new test syntax exit **0**; exact two-case gate exit **1**, **0 PASS / 2 RED / 0 cancelled / 0 skipped**, 3549.8147ms. Both stop at public init output on disk: actual `schema_version:1`, expected `2`. Owner/file-binding/ACL/live-record assertions beyond that prerequisite are **unexecuted**, not passed. This is intended RED for future authorized consumers, not a regression in helper acceptance.

Scratch ignore confirmed before writes. Both managed namespace-removal assertions PASS; post-run `tests/.artifacts` contains no entries. No broker/MCP/poller/listener or network is started. Public CLI runs native existing init in isolated generated state; environment is scrubbed, no `.env` or real credentials accessed. Repository format check exits **0**; tests/OpenSpec excluded as declared. No production edits or full legacy tests. Evidence and suite/index edits follow in this same test-owned packet; the final delta contains tests/docs, not solely docs, and does not change already-tested helper inputs.

Initial preparation packet versus `142962d`: **4 owned files / 188 gross changed lines (186 additions, 2 deletions)**, including test/spec/index; production forecast was then unavailable. This historical count is superseded by the corrected packet measurement below, not added to it. Exact staged whitespace check passed. Parallel owner/research/operations/containment paths remained unstaged; worktree retained active.

## Readiness correction execution — 2026-11-01

Resumed at `f67f6e4397615f932bcebc4c4d20d42745232af3`; the interrupted eight-case correction already existed and was retained. Persisted design 2/Migration 5 were inspected before readiness. Project-root Node **24.22.2**: affected test syntax exit **0**; exact eight-case command above exit **1**, **0 PASS / 8 RED / 0 cancelled / 0 skipped**, 18896.6096ms. Every case stops at init's actual schema **1** versus required **2**. All downstream owner creation, refusal exits, fault injection, byte preservation, disclosure and ACL assertions are **not executed**, not passed. This is test-first readiness, not consumer or full PORT-SETUP acceptance.

Cleanup assertions passed for all eight run-owned namespaces independently of behavioral failure. One other namespace, `tests/.artifacts/spike-IHohKV`, was observed after the run; its ownership is unknown and it was preserved, not inspected or removed. No claim that the entire artifacts root is empty. Repository format command exit **0** (tests/OpenSpec excluded); scoped whitespace check required before commit. Prior helper acceptance at `5ac0b25` is reused for its unchanged seven-test helper/invariant scope; no helper or feature checks replayed. Only the four declared test/spec/index files belong to this correction commit; all parallel edits remain untouched and unstaged. Worktree remains active/retain.

Corrected packet versus `142962d`: **4 owned files / 253 gross changed lines (251 additions, 2 deletions)**, including this measurement paragraph. Together with the separate approximately 200-line, three-production-file forecast, expected combined review is approximately **453 gross lines / 7 files**; actual production remains unmeasured. Phase before expansion approaches approximately 600 gross lines. Scoped whitespace check passed; helper prerequisite ancestry confirmed on the active change branch.
