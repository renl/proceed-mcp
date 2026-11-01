# A0 — pairing replay prerequisite

Parent: [tasks](../tasks.md). Authority: [design sections 4 and 7](../design.md), pairing replay prerequisite/A0 proof obligations; [Telegram delta](../specs/telegram-approval/spec.md), private pairing and durable state requirements. Current owner design, not superseded private implementation suggestions, controls decoding.

## Goal, scope and dependency

Founder-visible success remains an actual paired human's outcome on the original active MCP call. **A0 is enabling replay evidence only**, not that outcome, public pairing, creation admission, waiting, Telegram, Events or first-use proof. Direct A0 proof is production replay of ordinary journal transactions and private copied getter assertions; saved records alone are proxy evidence.

- Same retained worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change `add-telegram-approval-opencode-v2`; project baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`.
- Preparation baseline: `9f195f471d871f7139129d22bf53b98b5d252e78`; handoff authoring HEAD: `576430f1e89e162b7ecbe7013af167b44d296261`. Accepted journal-2 authority and U2b predecessor are present on this branch. Owner design has uncommitted clarifications; preserve them and review the current file, not HEAD's older contract.
- Only approved production path: `src/broker/portable.js`, forecast **120–160 gross additions plus deletions**, plus **324 already-reviewed preparation gross**, combined **444–484**. Existing constructor/API unchanged; add only private copied `broker.pairing()` and strict staged whole-history replay. If coding materially exceeds the forecast, return a revised bounded brief before expanding. No extra paths or writers; do not weaken validation to fit the forecast.
- Owned preparation paths: `tests/portable-pairing-replay.test.mjs`, this slice, and `tasks.md`. No production/config/dependency/README or other owner edits.
- A0 precedes A1a durable request core, then A1b public creation/read/status; A2 ledger/closure precedes B original-call terminal output. C public pairing/Telegram remains separate. One OpenSpec change/PR; internal checkpoints only, no partial promotion.

## Executable acceptance mapping

| Test ID | Design obligation / deterministic result |
|---|---|
| A0-FIXTURE | Ordinary `Journal.open/append/close` then reopen retains exact synthetic transactions and sequence. Setup calibration only; no production pairing inference. |
| A0-REOPEN | Fresh exact private getter; historically valid pairing retained in 2040 and with no configured owners; one constructor clock read only. Existing reservation key/principal/handle/ID discrimination and exact redacted status/snapshot unchanged. |
| A0-ORDER | Six same-transaction declaration/consume/set permutations plus both consume/set orders with historical declaration succeed. |
| A0-INSTANTS | Creation inclusive, just-before-expiry permitted, equivalent UTC spellings and leap-day rollover; stored text retained, submillisecond precision not rounded. |
| A0-BURN | Standalone consumption creates no pairing; an unrelated still-valid challenge can later pair. Reuse/earlier-consume authorization denied by INVALID. |
| A0-INVALID | Exact fields including nested record, ASCII positive lossless identities (including leading zeros and >19 digits), UTC RFC3339 calendar/offset validation, exact five-minute duration, fractional inequality, expiry/existence/uniqueness, unknown ops, no reset/re-pair, one same-transaction consume per set. Each independent rejected history preserves journal bytes/sequence, leaves no pairing/reservations and blocks first-recovery writes. |
| A0-ISOLATION | After pairing/reservations installed, valid new reservation followed by unknown/malformed/invalid-transition tail fails whole-history replay without installing any prefix or replacing existing state; journal bytes/sequence unchanged. |

Private storage failure binding uses the existing `CliError` representation: `exitCode:4`, `code:JOURNAL_STATE_INVALID` (the private diagnostic of STORAGE_FAILURE). No HTTP error envelope is invented for this in-process test.

## Boundary Verification

- **Affected boundary:** existing journal-2 storage interface → portable production `recover()` → private `pairing()`. Read source `src/journal/journal.js`, `src/broker/portable.js`; use ordinary framed appends, never hand-built checksums, legacy replayer, or format-1 acceptance.
- Exact mutations/fields and validation are design 4's table. No Name Mapping Table: names unchanged. Pairing getter is exactly `{user_id,chat_id,paired_at}` or `null`; no challenge/hash/consumption disclosure. No pairing field on status/snapshot, HTTP or MCP.
- No network endpoint, authentication, external platform request or new writer in A0. Existing external research is sufficient for unchanged boundaries; no new external research/spike required here. Architect approved the storage boundary, test-artifact/decomposition and bounded implementation, subject to the post-code negative-discrimination acceptance below. This is not a new Telegram acceptance claim or a renewed user approval gate.
- All fixtures use isolated ignored `.scratch/a0-pairing-replay/run-*` journals. The writer closes before decoder reopen; fixture data contains no credentials, plaintext code/capability, approvals, decisions or cursor. Tests using actual reservations obtain keys from the ordinary production reservation API, never fabricate public authority.
- These core/storage tests do not start a broker process or prove filesystem protection/startup ownership. Later A1 public consumers must initialize protected test-owned state and owner through existing CLI; seed only while stopped with no ownership record, close writer before actual startup, and calibrate against this production replay first. Keep separate clean unpaired denial state. No setup endpoint/flag/reset API.

## Decomposition checklist / review status

1 YES: new pairing replay/getter is A1's fixture prerequisite. 2 NO: isolated run-owned journals preserve clean state. 3 NO: no event receiver. 4 YES: fixture calibration precedes dependent positive public tests. 5 YES: stopped-state fixture setup is distinct from later public proof. Test-only schema review also applies. **Architect review approved; ready for the bounded one-path implementation**, not behavior acceptance. No new PM tradeoff, portable-security signoff or live environment required for A0. Current schema, status/snapshot and reservation authorization remain unchanged.

## Post-code negative-discrimination acceptance condition

Before accepting the implemented candidate, independently establish that invalid histories are denied for the intended semantics, not an unrelated prerequisite. Full-file green alone does not discharge this condition; private generic rejection need not expose a new diagnostic/API.

- Malformed consume timestamp: align the companion `paired_at` text with the malformed consume value so unequal timestamps do not explain refusal. Compare with an otherwise equivalent valid aligned consume/set history that succeeds.
- Invalid calendar: align declaration/expiry and consume/set companion values to isolate calendar validity from the five-minute TTL and equality checks. Use a valid-calendar control with the exact permitted duration; do not accept a TTL mismatch as calendar proof.
- Malformed consume hash: align the declaration and consume hash so unknown-challenge lookup does not explain refusal. Use the corresponding valid-hash history as a successful control; isolate hash validation rather than existence.
- Where existing fixtures do not discriminate these causes and private generic rejection is sufficient, record supplemental checks grounded in the implemented source: exact validation location, competing prerequisite ruled out, aligned control/input and deterministic result. Do not infer semantic coverage from the error code alone. If fixture/test changes are needed, test engineering makes them in a separately authorized follow-up with affected Architect review and affected reruns; implementation must not edit tests or relax validation.

Record each discriminator and result against the pinned implementation revision during independent verification. Until then this acceptance condition is **unresolved**, not a blocker to the already-approved bounded coding handoff. The existing 147 RED count includes parent failures and missing getter/op barriers, not 147 distinct defects.

## Ordered commands and stopping rules

Windows PowerShell; `$Node24='../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe'` (project-local Node 24.22.2). Native finite storage tests are representative of this scoped Windows boundary, not all-OS durability or a service harness.

1. `& $Node24 --check tests/portable-pairing-replay.test.mjs`.
2. `& $Node24 --test tests/portable-pairing-replay.test.mjs` (120s outer bound). Before implementation expect RED; do not bypass missing getter/replay to claim downstream acceptance. After implementation require the entire file green, no filters/skips.
3. `& $Node24 --test tests/portable-authority-unit.test.mjs` (60s outer): unchanged reservation/framing/owner/flush regression. Reuse its existing assertions rather than duplicate them.
4. `& $Node24 --check src/broker/portable.js`; `& $Node24 scripts/build.mjs`; `& $Node24 node_modules/prettier/bin/prettier.cjs --check .`; `git diff --check -- <owned paths and production path>`. Tests/OpenSpec are formatter-excluded: manually check scoped whitespace, not a claim of automatic formatting.
5. Independently verify pinned implementation, source staging/precision/privacy and the negative-discrimination condition above, then report assertion and owned directory cleanup status separately. No public/service execution or whole legacy suite needed for this cut. Revalidate affected checks after any executable drift.

## Preparation evidence — 2026-11-01

At `9f195f4` plus preserved owner changes, project Windows Node **24.22.2** syntax PASS. Final full file exits **1**, **148 tests: 1 PASS / 147 expected RED**, zero cancelled/skipped, 1679ms. The sole pass is A0-FIXTURE, ordinary storage calibration, not pairing. REOPEN stops at missing `broker.pairing`; positive permutation/instant/burn/isolation cases stop at unknown `pairing.challenge`. INVALID cases reach expected storage refusal/privacy/byte checks but stop at missing getter; their semantic acceptance/denial discrimination remains unproven. Parent failures are included in the runner's count; do not count these as 147 independent product defects. Initial run before two extra fractional-edge cases was 1 PASS / 145 RED, 1798ms; final run supersedes it.

Owned run-directory cleanup PASS separately (each removed and absence asserted; scratch namespace empty). No broker/process/socket or credential resources created. Existing owner modifications/untracked artifacts preserved. Retain active worktree, not cleanup-ready; no archive/PR/push/promotion authority. Final size/static evidence is indexed in tasks; failure log was disposable owned scratch, not a durable acceptance artifact.

Handoff update at `576430f1e89e162b7ecbe7013af167b44d296261`: only this slice and tasks changed; no production/test changes or reruns. Prior preparation results above are reused only in their original scope. A0 paired journal fixtures remain prerequisites, not public pairing or first-use proof.
