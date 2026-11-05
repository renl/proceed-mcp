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

## Independent affected verdict — 2026-11-01

**FAIL — correction needed; A0 not accepted.** Verified immutable implementation `c126b2b8e75d9c27f75429bf0040586e696d9d0d`, branch `add-telegram-approval-opencode-v2`, project baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No production, authoritative test, dependency or configuration edits during verification. Existing dirty owner documents and unknown untracked artifacts were inventoried and preserved. Current working design 4/7 was the contract; supplemental implementation-engineering diagnostics were not reused as independent proof.

### Executed checks

Windows project Node **24.22.2**, finite native execution directly represents this in-process decoder/ordinary journal filesystem seam on Windows, not all-OS durability. No server, network, Telegram, model, real configuration or credentials used. Ordered commands are those above; A0 outer bound 120s, authority 60s, static/build/format bounded together at 120s.

| Check | Result / assertion scope |
|---|---|
| Test syntax; full unfiltered A0 | PASS, exit 0; **148 runner entries**, zero failed/cancelled/skipped, 2907ms. These are **144 leaf cases plus 4 parent containers**, not 148 independent behavioral assertions; one leaf is fixture calibration. |
| Authority regression | PASS, exit 0; **8/8**, zero failed/cancelled/skipped, 326ms: authority/principal/owner drift, framing and serialized flush-before-visibility. |
| Production syntax / build | PASS, exit 0; 36 production modules parse, existing bin target ready. No bootstrap/release claim. |
| Project formatter | PASS, exit 0; tests/OpenSpec excluded, not automatic formatting proof for them. |
| Candidate diff / whitespace | PASS; `git diff --check c126b2b^ c126b2b -- src/broker/portable.js` and working owned-path checks. Source/tests/scripts/manifests matched the candidate; unrelated dirty documents excluded from evidence commit. |
| Independent diagnostics | Requested discrimination PASS below, but additional array-hash probe proves a schema failure. Diagnostic exit 0 confirms explicit observed-result assertions, **not A0 acceptance**. |
| Cleanup | PASS separately: suite fixtures remove each run directory and assert absence; A0 scratch namespace empty. Supplemental run directories removed in `finally` with absence assertions; script/namespace removed by shell `finally`, empty/absence verified. Active worktree retained; unknown artifacts untouched. |

### Independently recreated discriminators

Disposable `.scratch/a0-independent/check.mjs` imported normal `Journal` and `createPortableBroker`, used ordinary append/close/reopen and isolated `run-*` journals, without source rewriting or private helper exports. Histories used exact fields, synthetic IDs `0071`/`0091`, default hash `a` repeated 64. Each rejection asserted `exitCode:4`, `code:JOURNAL_STATE_INVALID`, the exact private message below prefixed by `journal replay failed: `, null pairing, empty snapshot, refused first-recovery writes, unchanged bytes and sequence. Positive controls asserted exact pairing and unchanged bytes/sequence. Script/state removed; reproducible inputs/source anchors follow.

| Input / control | Observed result / competing cause excluded |
|---|---|
| Declaration `2026-11-01T00:00:00Z` → `00:05:00Z`; consume/set both `00:01:00Z` | Recovery succeeds; aligned valid baseline. |
| Same declaration; consume **and** paired time `2026-11-01T00:01:00-00:00` | `pairing.challenge.consume has a malformed consumption time`. Aligned companion excludes unequal timestamps. `readConsume` 208–217 calls strict `readInstant` before transition/equality. |
| Declaration `2026-02-30T00:00:00Z` → `2026-02-30T00:05:00Z`; consume/set both `2026-02-30T00:01:00Z` | `pairing.challenge has a malformed creation time`. Independent `Date.parse` control normalizes to **March 2**; expiry minus creation **300000ms**, consume minus creation **60000ms**. TTL/equality cannot explain rejection: strict calendar round-trip at 144–160 precedes duration at 199–203. |
| Same aligned calendar history with **February 28** throughout | Recovery succeeds, exactly five-minute duration. |
| Valid declaration; consume hash `g` repeated 64; aligned valid time | `pairing.challenge.consume has a malformed code hash`, at 210–211 **before** lookup 269–270. Not merely generic unknown-hash rejection. |
| Declaration hash `a` repeated 64; consume hash `b` repeated 64 | `a consumption names no declared challenge`. Corresponding declaration **and** consume hash `b` repeated 64 succeeds. |
| Declaration **and** consume hash `g` repeated 64 | `pairing.challenge has a malformed code hash`. This aligned case alone cannot prove consume validation because declaration rejects first; preceding source-backed consume diagnostic plus valid/unknown controls supplies that discrimination without test changes. |
| Full-suite isolation: installed pairing/reservation, then new valid reservation followed by unknown reset, malformed challenge or repeated consume/set | All three independently rerun cases PASS: no prefix installed, old pairing/snapshot/authorization retained, bytes/sequence unchanged. Fresh maps/local pairing install only after all history at 344–375. |

Source review confirms fractional comparison without millisecond rounding (144–173), lossless ASCII positive-string identities (178–187), order-independent declaration/consume/set and permanent burn (260–287), fresh exact getter copies (381–382), unchanged status/snapshot and reservation authority. Only the approved production path changed; no writer, route, poller, CLI change, legacy replayer or fixture import added. These findings do not override the failure below.

### Blocking schema gap — PAIRING-HASH-TYPE-001

- **Gap ID:** PAIRING-HASH-TYPE-001; **correction attempts: 0**, first corrective packet, next owner implementation engineering after affected architecture review through coordination. Separate from earlier closed gaps and sizing.
- **Authority:** design 4 requires hashes to be 64 lowercase hexadecimal SHA-256 characters, not arrays. Full-file green misses this type boundary.
- **Exact reproduction:** append one transaction containing `{op:'pairing.challenge',hash:['a'.repeat(64)],created_at:'2026-11-01T00:00:00Z',expires_at:'2026-11-01T00:05:00Z'}` through ordinary `Journal.append`, close writer, reopen journal, construct portable broker with normal owners/port, call `recover()`.
- **Expected:** `JOURNAL_STATE_INVALID`; no successful recovery/write admission. **Actual:** recovery succeeds, pairing null, bytes/sequence unchanged. The standalone challenge is valid otherwise, so lookup/equality/TTL cannot mask this schema defect. Diagnostic explicitly asserted successful recovery to reproduce the bug, not to pass a negative gate.
- **Source cause:** `readChallenge` 192–193 and `readConsume` 210–211 use `HASH_PATTERN.test(mutation.hash)` without a string type guard; JavaScript coerces a one-element array to its contained string. Challenge returns the original array as map key at 205. Consume has the same coercive validation, though ordinary decoded array identity can cause later unknown-challenge rejection; generic refusal there does not prove type validation.
- Original verification made no production/test correction. The authorized test-only correction packet follows; production remains unchanged. Do not expand into unrelated existing reservation semantics.

### PAIRING-HASH-TYPE-001 corrective packet / affected review input

Baseline: evidence `7d964814718854d860cdd79489935344b576044e`, executable candidate `c126b2b8e75d9c27f75429bf0040586e696d9d0d`; same worktree, branch, authority and Boundary Verification above. Added only the named regression block; all prior 148 runner entries and positive controls preserved. Design 4/7 already requires string hashes and normal semantic storage failures; no schema broadening or new product behavior.

- **Compact Architect review before implementation:** review this block and `PAIRING-HASH-TYPE-001` in `tests/portable-pairing-replay.test.mjs`, especially its source-backed diagnostic discriminator. Existing decomposition/boundary unchanged; not a whole-A0 redesign. JSON arrays decode to distinct objects, so declaration/consume arrays cannot be made equal map keys through ordinary JSON. Source `readConsume` 208–217 validates before lookup 269–270; its current malformed-hash diagnostic is supplemental evidence, not a new public error contract. Unknown-hash refusal alone is not type proof.
- **Exact production correction:** only `src/broker/portable.js`, `readChallenge` and `readConsume` hash guards (192 and 210 at candidate). Require `typeof mutation.hash === 'string'` before regex evaluation; otherwise use each existing malformed-code-hash integrity failure. Forecast **2 additions + 2 deletions = 4 gross**, one path. No coercion/normalization, broad exception catch, new exports, replay/map/transaction/writer/getter changes or other decoders. Return before expanding this scope/forecast; do not edit tests.
- **Executable mapping:** eight ordinary JSON hash values (`[hash]`, `[[hash]]`, `null`, `false`, `1`, `{}`, `[]`, `{toString:null,valueOf:null}`), both mutation kinds, fresh and previously installed state: 32 leaves. Consume uses a valid fresh string-keyed challenge with aligned valid timestamps; fresh consume/set companion is otherwise valid, installed consume is standalone to avoid second-pairing masking. Existing valid string controls prove both successful pairing and standalone consumption. Every case asserts unchanged bytes/sequence, pairing/snapshot and installed reservation authorization before the negative verdict; actual first-recovery failures also assert write refusal/unchanged bytes.
- **Observed RED:** full A0 exit 1, **181 entries: 168 PASS / 13 FAIL**, no cancelled/skipped, 4789ms. New block: 20 passing leaves; 12 failing leaves plus parent. Four challenge array/nested-array leaves wrongly recover successfully; four consume array leaves return normal storage refusal but fail the supplemental schema diagnostic (lookup-masked, not proof of type checking); four noncallable-coercion object leaves expose raw **TypeError: Cannot convert object to primitive value** in both guards. These are JSON data, not injected functions. Byte/sequence/installed-state assertions execute and pass before these failures. Fresh challenge-array write-refusal and later diagnostic assertions are unexecuted where no failure exists, not passed.
- Final diagnostic-only assertion-message improvement rerun: `--test-name-pattern=PAIRING-HASH-TYPE-001 --test-reporter=spec`, exit 1, **33 entries: 20 PASS / 13 FAIL**, no cancelled/skipped, 553ms; confirms raw TypeError above. Reuse unchanged prior 148 PASS from full run. Windows project Node **24.22.2**, finite native storage boundary only; no live environment, network, host compatibility or public pairing claim.
- **Corrective run order:** test syntax → full unfiltered A0 (181/181 required after correction) → authority 8/8 → production syntax/build/format/scoped diff → independent affected verification with source review of both noncoercive guards. Use existing ordered commands/bounds above. This preparation runs affected A0 only plus syntax/format/scoped diff/cleanup; authority/build evidence at candidate is reused, not rerun or new acceptance. No production edits. A0 remains unaccepted; A1a blocked.

Final preparation checks: test syntax and project formatter exit 0; tests/OpenSpec excluded from formatter, scoped whitespace/diff checked separately. Owned fixture namespace empty; all run-directory removals/absence assertions passed even on RED. Production/authority/build/dependencies unchanged against candidate (`git diff --quiet`, exit 0). Packet measured against `7d96481` using owned-path numstat: **59 additions + 3 deletions = 62 gross / 3 paths**, no owned untracked files; retained A0 **532 + 62 = 594 gross**, exact corrective forecast adds 4 gross (**598 projected**, not measured implementation). No worktree removal, service resources or external scratch; owner/unknown artifacts preserved. Review scope remains narrow; return a revised brief before exceeding it.

### Scope accounting and next prerequisites

Actual production is **193 additions + 15 deletions = 208 gross / one path**, **48 above the 160 upper forecast** (88 above lower estimate). The required early sizing notice was missed; later authorization does not retroactively satisfy it. Coordination permits review of the retained same-scope **324 reviewed preparation + 208 production = 532 gross**, within 600, not a limit exception or future-growth authorization. No history rewrite/forced split performed.

Evidence finalization changes only this slice/tasks; executable candidate stays pinned above. A0 is not public pairing, private-chat, first-use, waiting, feature or release acceptance. **A1a blocked on corrected A0 independent acceptance.** After that, bind durable-core tests to implementation-owned request/replay encodings against design 4/7 before positive fixtures consume them: actual journal append/recovery, controlled clock, commit-failure faults, creation/idempotency, immutable paired snapshot, representation, serialized expiry and ledger; require bounded exact-path/size handoff and applicable review. A1b public HTTP/CLI proof remains later: normal protected setup while stopped/no ownership record, fixture writer closed before startup, production replay calibration, separate clean unpaired denial state. No production testing API or substitute public-pairing claim.

## PAIRING-HASH-TYPE-001 — independent correction verdict, attempt 1

**PASS; gap CLOSED; A0 accepted ENABLING ONLY.** Candidate `1541c321822d18ba78509836921bec52ca900a47` is present on the same active change branch; project baseline remains `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`. This verdict supersedes the earlier A0 FAIL and A1a prerequisite block, not the remaining A1a preparation requirements. Evidence HEAD is the subsequent tasks/slice-only commit carrying this section; it is not the executable candidate. No production/test edits occurred during verification.

### Execution and source review

Windows PowerShell, project-local Node **24.22.2**, exact ordered commands above; full A0 outer bound 120s, static/build/format bound 120s. Native finite execution directly represents this in-process JSON decoder and ordinary journal filesystem seam on Windows. No process server, network, credentials, real configuration, Telegram, host/model, external scratch or root-state execution. Bootstrap and public first-use gates are not applicable to this bounded type correction and are not claimed passed.

| Check | Independent result |
|---|---|
| Test syntax; full unfiltered `--test tests/portable-pairing-replay.test.mjs` | PASS, exit 0, **181 entries: 176 leaves + 5 parent containers**, 2781ms; zero failed/cancelled/skipped/todo. Includes one setup-calibration leaf, not 181 independent product behaviors. |
| Hash-type regression within full A0 | All **32 leaves + parent PASS**: eight ordinary JSON types × challenge/consume × fresh/installed. Existing normal storage failure code/exit and source-backed malformed-hash diagnostic asserted; coercion-object raw TypeError is excluded. Each case asserts byte/sequence and pairing/snapshot preservation, installed reservation authorization; every fresh failure executes write-refusal/unchanged-byte checks. |
| `--test tests/portable-authority-unit.test.mjs` | PASS, exit 0, **8/8**, 237ms; zero failed/cancelled/skipped/todo. |
| Production syntax / build / project formatter | PASS, exit 0; **36 modules** parse and existing bin target ready. Tests/OpenSpec formatter-excluded; scoped whitespace reviewed separately, not automatically formatted. |
| Candidate/working scoped whitespace and provenance | PASS. Candidate parent delta exactly **2 additions + 2 deletions / one path**, `src/broker/portable.js`; no extra correction. Source/tests/scripts/manifests unchanged against pinned candidate. Index initially empty; seven dirty owner documents and nine untracked entries preserved outside owned evidence. |
| Cleanup, separate from assertion status | PASS: all suite run directories removed with asserted absence; `.scratch/a0-pairing-replay` empty. Owned verification logs/namespace removed after recording evidence, absence confirmed. No service/socket resources created. Worktree remains active/retained, **not cleanup-ready**; unknown data untouched. |

Both `readChallenge` at 192 and `readConsume` at 210 short-circuit on `typeof mutation.hash !== 'string'` **before** `HASH_PATTERN.test`; existing integrity failures at 193/211 are retained. `recover()` maps through `readMutation` at 353 before `applyPairing`/lookup at 269–270; entire history installs only at 371–375. Arrays cannot pass through string coercion or reach lookup; noncallable coercion properties are never evaluated. No broad catch, normalization, export, writer, getter, map/transaction or other decoder changes.

**Exact evidence reuse:** prior independent discriminators at executable `c126b2b8e75d9c27f75429bf0040586e696d9d0d`, recorded in evidence `7d964814718854d860cdd79489935344b576044e` and the table above, remain valid for aligned malformed consume timestamp/companion, February 30 versus February 28 with exact TTL controls, malformed string hash versus valid/unknown controls. `git diff c126b2b 1541c32 -- src/broker/portable.js` contains only the two string guards: all these discriminator inputs are strings and retain identical regex, time/calendar, TTL/equality and lookup paths. This is scoped reuse, not a new supplemental execution. Full A0 and installed-state isolation were independently rerun here; no historical test suite replay or fabricated diagnostic contract.

### Accounting, limits and next action

Correction exactly matches approved **4 gross / one path**, no new architecture defect or broader review required. Against preparation baseline `9f195f4`, final production diff remains **193 additions + 15 deletions = 208 gross / one path**; final test diff **302 additions / one path** (261 original + 41 regression). Sequential review accounting is **324 preparation + 208 original production + 62 corrective preparation + 4 correction = 598 gross**, within 600 for that retained implementation/test packet, before this separately measured documentation-only evidence finalization. Summed checkpoint gross is not the same as consolidated baseline diff: replacing two already-added lines does not increase final baseline production numstat. Earlier missed production forecast notice remains recorded, not retroactively cured; no future growth authorization.

Founder-visible success still requires the actual paired human's result on the original active MCP call. A0 proves only its replay prerequisite; persisted fixtures/getter tests are proxies for that broader outcome. **No pairing writer/public human pairing/Telegram/waiting/first-use/feature/release acceptance.** Keep **A0 → A1a → A1b**. Next, before A1a code: bind tests to implementation-owned request/replay encodings under design 4/7; cover actual append/recovery, controlled clock and commit-failure faults, creation/idempotency, immutable pairing snapshot/common representation, serialized expiry and ledger; obtain the bounded exact production paths/gross forecast and applicable decomposition/boundary review. Do not invent request interfaces. A1b remains later actual public HTTP/CLI proof with stopped protected setup, closed fixture writer, production replay calibration and separate clean unpaired denial state. Same change/worktree/branch/lifecycle owner retained; no archive, PR, push, promotion or removal.
