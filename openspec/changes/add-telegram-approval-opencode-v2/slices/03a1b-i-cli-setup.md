# 03A.1b-i — public CLI setup consumer checkpoint

Parent: [03A](03a-portable-shared-waiting.md#checkpoint-gates-and-sizing), [tasks](../tasks.md). Authority: [design 2/4 and Migration Plan](../design.md), [portable delivery delta](../specs/opencode-session-continuation/spec.md), [Telegram delta](../specs/telegram-approval/spec.md).

## Goal, baseline and disposition

Founder-visible success remains a paired human's exact decision returning to its original waiting MCP call among parallel requests. This checkpoint only makes operator-owned schema-2 state and independent protected principal files available for later runtime proof. Public CLI assertions directly prove that setup subset; for the founder outcome they are **enabling proxies**, not waiting, broker, Telegram, host or release proof.

| Field | Value |
|---|---|
| Path / branch / change | `.worktree/add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` / `add-telegram-approval-opencode-v2` |
| Project baseline | `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba` |
| Prerequisite | Chain on helper `5ac0b2521edbac8ab6bd64bf421fd1f80b5724f2`, present here; independently helper-accepted, not feature-accepted |
| Authoring parent | `142962d` (helper evidence only); corrected dirty owner artifacts preserved, not committed by test engineering |
| Owner / lifecycle | Test engineering; active/retain; next action narrow clarification and implementation sizing, then bounded implementation through coordination |
| Status | Runnable RED test/spec draft; **not implementation-ready** pending sizing input and narrow fidelity clarification below |
| Delivery | Sequential checkpoint on the existing branch, one eventual OpenSpec PR; no merge/archive/promotion of intermediate state |

## Exact bounded scope

Production touch list for review: `src/state/paths.js`, `src/state/store.js`, `src/cli/main.js` only. Use accepted additive schema-2 config and owner credential helpers for init/load/owner creation. Add owner file derivation to state paths; enforce validated owner IDs before deriving files. Public `init` creates empty schema 2; `owner add <owner_id> --label <label>` creates immutable records with independently protected credentials. Preserve current exit categories, refuse duplicate/invalid IDs without changing config or existing credentials, print no secrets, and verify actual protection of state/config/journal/credential directory/control/owner files. Windows POSIX mode alone is insufficient. No new route, force flag, recovery command, production test API or test-dependent application.

Naming binding: the implementation-selected 03A.1a seam derives `credentials/owner.<owner_id>.token`; use the validated owner record, not an arbitrary caller-supplied path or a label. This is the chosen seam under test, not an invented public contract. Equal labels do not merge owners. The helper's `readOwnerCredential(file,ownerId)` does not itself bind that file; later MCP/startup consumers must verify correct selection separately.

Do not switch journal framing/schema constants, broker/server/MCP consumers or request/catalog/waiting logic in this packet. Current init may still create journal format 1; format-2 creation/rejection remains explicitly RED under PORT-SETUP-SCHEMA until the separately sized journal/runtime checkpoint. Do not fabricate a version-2 header without a compatible writer/replayer. Reuse existing protection/files helpers; if fulfilling this scope requires more production paths, return revised sizing before expanding it.

Switching the store configuration loader may make legacy origin-based CLI/broker consumers incompatible. That is an explicitly **branch-only prerequisite state**, not a passing feature or merge candidate. Do not retain an API/password fallback to make old tests pass. Full portable setup acceptance requires later compatible broker/runtime/MCP wiring and all three PORT-SETUP cases green together. Existing origin/API tests are historical, never portable acceptance.

### Stopped broker and immutable ownership

Design 2 requires broker stopped for owner creation. The focused test supplies a synthetic record with a known live PID and asserts exit 3 and unchanged lock/config/journal/credential inventory. It does not start a broker, prove exclusion under races, or authorize touching a real ownership record. Design 4's startup refusal/unchanged-record/no-stale-stealing contract remains mandatory for later serve/recovery binding. No dead PID, available port or malformed record licenses record removal, force recovery or migration.

**Narrow clarification through coordination:** for `owner add`, does any existing `broker.lock` block mutation (including stale/malformed/uncertain records), or is independently verified stopped-state addition allowed while preserving the record? Design 4 defines startup refusal, but does not explicitly select owner-add behavior/exit for these states. Existing `assertBrokerStopped` accepts a dead PID; do not silently preserve or tighten that semantic. The focused tests cover only the unambiguous live case. Architect must select the missing owner-add behavior and assess the loader-switch intermediate state; then test engineering binds additional affected assertions. No user security decision is reopened by this question.

## Unique executable gate and sequencing

Test-owned paths: `tests/portable-setup-cli-checkpoint.test.mjs`, this slice, parent 03A and `tasks.md`. `PORT-CLI-I` is a unique consumer gate, not the old no-consumer invariant or a filtered waiting test. It covers public init, actual owner addition, two independently named files, duplicate/invalid refusal, equal-label independent principals, no disclosure, actual native ACL inspection and live-lock refusal.

PowerShell/Windows project Node 24.22.2, `$Node24` = project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`:

1. Confirm ignore: `git check-ignore tests/.artifacts/probe`. Existing managed fixture owns unique local namespaces and verifies removal; public CLI subprocesses have 10s timeouts, scrubbed environment and local TEMP/TMP/TMPDIR. No service or network is started. Independent ACL inspection runs against only those generated paths. Native execution is representative of local CLI and Windows ACL behavior, not cross-OS proof.
2. `& $Node24 --check tests/portable-setup-cli-checkpoint.test.mjs` (10s).
3. `& $Node24 --test tests/portable-setup-cli-checkpoint.test.mjs` (200s outer, 95s/case). Require **2 PASS**, no skipped/cancelled cases. Run helpers `portable-config-unit.test.mjs` and `owner-credentials-unit.test.mjs` only if changed or at consumer acceptance to establish affected seam compatibility.
4. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s, tests/OpenSpec excluded); `git diff --check -- <exact owned paths>`; affected production syntax/build checks per implementation report. No installs, full legacy suite or live setup.
5. On the **actual consumer switch**, mark `portable-helper-invariants.test.mjs` historical/superseded in the active suite: its schema-1/no-consumer assumptions were valid solely for 03A.1a. Do not weaken/remove that historical evidence or run it as a future green gate. Pure helper tests remain active. This authoring packet has not switched consumers, so current invariants remain valid at the pinned helper candidate.
6. Later sequential checkpoints: compatible format-2 journal/store and broker/MCP owner wiring → all three `PORT-SETUP` cases → `PORT-RESERVE` → full offline PORT-A/B. Each needs its own pinned candidate, exact tests and fresh bounded sizing; none is accepted by PORT-CLI-I. First-host/real Telegram/ownership races/flush proof remain later required boundaries.

## Sizing and narrow review trigger

The dispatch refers to SE forecasts in `03asizing`, but no such file or supplied exact forecast is available in the active worktree. Available sourced forecasts only: parent 03A **7 production files / 550–670 gross changed lines** for the original setup packet; 03A.1a **2 files / about 160 lines**, now measured at 207 additions. These do **not** establish a 03A.1b-i forecast. Do not invent or infer a smaller forecast by subtraction. Coordination must supply the exact SE `03asizing` reference or fresh forecast for the three paths above, including changed-line additions plus deletions versus `142962d`; include this new test/spec/index packet separately without double counting. No >~20-file/~600-gross-line exception is authorized. If combined forecast approaches the limit, split a test-before-implementation review checkpoint or obtain a narrower implementation-selected subset with its own executable gate; do not demand a giant atomic consumer rewrite.

Decomposition checklist for this refinement: **1 YES** (schema-2 store feeds later runtime), **2 YES** (changed clean setup state/journal mismatch), **3 NO** (no receiver here), **4 YES** (setup→runtime acceptance), **5 YES** (later proof consumes this setup). Request **targeted decomposition-fidelity review** through coordination before marking ready; existing approval is not a blanket blocker for unrelated work. Boundary applicability: local public CLI/filesystem only; no new external platform interaction or changed wire contract. The accepted parent Boundary Verification remains pinned; no new Telegram/MCP interface-fidelity review required for this three-file scope. Expansion into broker/MCP/journal or a new cross-component contract requires renewed targeted review and test binding first.

## Authoring execution — 2026-10-31

At `142962d` (production identical to helper candidate `5ac0b25`), project Windows Node **24.22.2**: new test syntax exit **0**; exact two-case gate exit **1**, **0 PASS / 2 RED / 0 cancelled / 0 skipped**, 3549.8147ms. Both stop at public init output on disk: actual `schema_version:1`, expected `2`. Owner/file-binding/ACL/live-record assertions beyond that prerequisite are **unexecuted**, not passed. This is intended RED for future authorized consumers, not a regression in helper acceptance.

Scratch ignore confirmed before writes. Both managed namespace-removal assertions PASS; post-run `tests/.artifacts` contains no entries. No broker/MCP/poller/listener or network is started. Public CLI runs native existing init in isolated generated state; environment is scrubbed, no `.env` or real credentials accessed. Repository format check exits **0**; tests/OpenSpec excluded as declared. No production edits or full legacy tests. Evidence and suite/index edits follow in this same test-owned packet; the final delta contains tests/docs, not solely docs, and does not change already-tested helper inputs.

Preparation packet versus `142962d`: **4 owned files / 188 gross changed lines (186 additions, 2 deletions)**, including test/spec/index; production forecast remains unknown and is not reserved by that count. Exact staged whitespace check passes. All pre-existing parallel owner/research/operations/containment paths remain unstaged. Worktree retained active; no lifecycle removal authorized.
