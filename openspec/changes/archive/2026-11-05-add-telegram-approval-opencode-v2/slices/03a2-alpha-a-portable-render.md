# Alpha-A — portable full-message measurement

Parent: [tasks](../tasks.md). Authority: [design](../design.md) sections 3–5/7; [Telegram delta](../specs/telegram-approval/spec.md), Distinguishable approval requests, Responses are instructions only, Fail closed without misleading status. Status: **Alpha-A independently PASS, ENABLING ONLY**; Architect fidelity approval supplied by the verification brief. Preparation/review-pending wording below records the historical packet.

## Goal, scope and prerequisites

Founder-visible question: can the full portable approval presentation fit without losing action/context or confusing instructions with approval? This pure-function checkpoint supplies local measurement proof only; it is a proxy/enabler for the real Telegram/original-call outcome, not that outcome's proof.

- Worktree: `.worktree/add-telegram-approval-opencode-v2` from repository root; branch/change `add-telegram-approval-opencode-v2`. Retain existing lifecycle owner and baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba` in tasks.
- Authoring HEAD `f84c03b5715cfe13454834050b785cba6975d53d`; accepted A0 `1541c32` is present on this branch. Current dirty owner design, not stale root copy, is the source. No new worktree, separate PR or production edits in preparation.
- Implementation-selected sole production path: new `src/telegram/portable-render.js`, supplied forecast **95–120 gross**. Ordinary exports below; no broker integration, validator, transport, status outcome, replay/snapshot, expiry or creation in this cut.
- Owned paths: `tests/portable-render.test.mjs`, this slice, `../tasks.md`. No production import of test oracle. Later replay/snapshot alpha, beta expiry and creation cuts require separate tests/review; none prepared here.

## Proposed presentation binding — not normative until reviewed

Design pins required fields/plain text/ceiling, but not exact layout or labels. The following narrow binding is proposed for review, not a new product rule. Export names/signatures/path were selected by implementation engineering in the task brief. Existing `src/telegram/render.js` supplies the plain-text array/join and exact reply-prompt precedent, but its legacy origin/session fields, pending-only render and scalar length check must **not** be reused as portable proof.

`MAX_TELEGRAM_TEXT = 4096`. Frozen ordinary maps have exactly these own string entries:

| Map | Exact key → value |
|---|---|
| `PORTABLE_RESOLUTION_LABELS` | `pending→pending`, `approved→approved`, `rejected→rejected`, `responded→responded (instructions only)`, `expired→expired`, `cancelled→cancelled` |
| `PORTABLE_DELIVERY_LABELS` | `not_applicable→not_applicable`, `pending→pending`, `returned→returned`, `confirmed→confirmed`, `unavailable→unavailable`, `blocked→blocked` |

`renderPortableRequestMessage(request) -> string`: join these nine lines with LF, no trailing LF; interpolate exact supplied strings, no trimming/escaping/normalization/truncation. Empty line is line 2. Resolution/delivery use the maps, not secret or free-form diagnostic fields.

```text
Approval request <request_id>

Owner: <owner_id>
Caller-supplied context (display only, not verified identity): <session_label>
Action: <action>
Context: <context, or literal (none) only when context === ''>
Expires: <expires_at>
Resolution: <resolution label>
Delivery: <delivery label>
```

`renderPortableReplyPrompt(request) -> string`: exact existing reply text, full request ID; five lines joined with LF, no trailing LF:

```text
Respond to request <request_id>

Reply to this message with instructions for this request only.
Your reply is instructions, not approval: any action that still needs approval
requires a separate request.
```

`measurePortablePresentation(request) -> {request:number,reply_prompt:number,worst:{kind:'request'|'reply_prompt',length:number}}`: count UTF-16 code units in the **complete** corresponding strings. `request` is the maximum across initial pending/not_applicable and every terminal resolution × delivery `pending|returned|confirmed|unavailable|blocked` (26 presentations), irrespective of supplied current status. These combinations conservatively cover section 6; they do not authorize writers/transitions. `reply_prompt` is actual full prompt length. `worst` selects the larger; proposed deterministic tie preference is `request`. Renderer renders supplied status, not a maximum-status substitution. No mutation or I/O.

Input assumption: caller supplies a validated common representation with known enums and well-formed Unicode; no malformed-input error contract is added here. Broker later validates types/scalars/surrogates and rejects if either length exceeds 4096 **before append**, on replay and creation. This cut renders/measures even over-limit text intact. No response text, capability/hash, callback token, private pairing, legacy `origin_id`/`session_id`, or diagnostics are interpolated. This does not promise to scrub forbidden strings deliberately embedded in caller-controlled action/context.

## Independently checked local arithmetic

Measurement is a conservative local bound, **not a verified claim about Bot API character counting**. No `parse_mode`; JSON escapes are transport syntax, not displayed expansion. Supplementary characters count two, combining sequences stay unnormalized. The actual timestamp spelling is measured; there is no assumed timestamp-width ceiling.

- Fixed request prefixes have UTF-16 widths `[17,0,7,63,8,9,9,12,10]` plus eight LF: **143**. Add actual request ID, owner, label, action, effective context, expiry and mapped statuses.
- Resolution maximum **29** (`responded (instructions only)`); all-delivery maximum **14** (`not_applicable`); terminal-delivery maximum **11** (`unavailable`). Permitted maximum status pair **40**, not the impossible terminal/not_applicable pair's 43. Pending pair totals 21; terminal maximum is **19** longer.
- Empty context contributes **6** for `(none)`. Prompt fixed overhead **191**, plus full 36-unit ID = **227**.
- Boundary fixture: ID36 + owner64 + label128 + action2000 (1000 astral scalars) + expiry24 + fixed143 + status40 = **2435** without context. Context `😀` ×830 +`x` =1661 units gives **4096**; context `😀` ×831 =1662 gives **4097** (both831 scalars, within context1000). Both are below4096 if wrongly counted only as scalars. Pending-only count is19 shorter and would miss the over-limit case.
- `2026-11-01T01:00:00.` +100 fractional zeros +`+00:00` is106 units longer than `2026-11-01T01:00:00Z`, representing the same UTC instant. Rendering preserves spelling; timestamp validation belongs to later broker work.

`PORT-RENDER-ORACLE` independently checks literals/maxima/boundaries with UTF-16 byte widths; it does not import production. Remaining ten tests cover exports, 26 layouts/privacy, maximum-vs-current measurement, both boundaries, JSON/markup/unicode fidelity, placeholder, timestamp, prompt and purity. Exact string assertions plus separate byte-length arithmetic prevent self-comparison to production helpers. Pure native execution is representative for these deterministic strings; no server/harness needed.

## Boundary Verification and decomposition review

- Affected future boundary: design5 fixed HTTPS Bot API10.3 `https://api.telegram.org/bot<token>/<method>`, JSON, no `parse_mode`; request send/edit text and separate ForceReply prompt. This cut calls **no endpoint**, uses no credentials and tests no payload/markup/auth/correlation.
- Future C transport must actually send these exact plain-text strings, without extra prefixes, escaping or appended response text, and prove its real external boundary. Existing research remains pinned in design; no new platform/counting claim or live research needed for this local bound. Real Telegram conformity, private-chat identity, callbacks/buttons, ForceReply and first-use proof remain unexecuted.
- **interface-fidelity-review needed before implementation**: approve/provide exact label/layout/variant/measurement binding above. No authoritative exact layout currently exists. If rejected, revise owned packet only after contract-owner decision; do not infer Telegram semantics.
- Decomposition triggers: **1 YES**, new measurement seam consumed by later replay/creation and transport; **2 NO**, pure/no state; **3 NO**, no receiver; **4 YES**, admission and eventual actual send conform to the same bound across cuts; **5 NO**, no state fixture/proof split here. **decomposition-fidelity-review needed**; test-only oracle also needs fidelity review. Alpha-A is not A1a-i acceptance.
- Beta must add actual serialized expiry append/flush/install, close/reopen/recovery and failure faults plus awaited status integration before A1a-i acceptance. No temporary status outcome is selected or implemented here. No real expiry/creation/HTTP/pairing/Telegram/waiting/host/Events/release proof.

## Ordered execution and evidence

Windows PowerShell only verified here. Set `$Node24` to the project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` resolved inside the repository, not `../../.tools` from the nested worktree. No discovery/install/network. Missing runtime → report blocker. Run with this active worktree as explicit working directory, bounded20s for syntax/test and30s for formatter:

1. `& $Node24 --version`; `& $Node24 --check tests/portable-render.test.mjs` (post-code also check selected production file).
2. `& $Node24 --test --test-reporter=dot tests/portable-render.test.mjs`; expect11 passes after implementation, no skip/cancel; preparation expected missing-module RED only for ten product tests.
3. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .`; tests/OpenSpec are formatter-excluded and owner-reviewed. Post-code run `& $Node24 scripts/build.mjs` as affected parse/build check.
4. Scoped `git diff --check` and staged whitespace; measure additions+deletions against authoring HEAD over exact owned paths plus production. Stop/re-scope before exceeding600; no exception implied. Do not rerun unchanged181-entry A0 gate.
5. Independent affected product verification after implementation. Separate assertion and cleanup statuses. No scratch/process/state directory is needed; preserve all unknown and other-owner artifacts. Retain active worktree, not cleanup-ready; one eventual OpenSpec PR.

## Preparation verdict — 2026-11-01

At authoring HEAD above, current design SHA-256 `587bc8093306c2c535cb40f8d53e2ba56e09da927617d5afb7700dc2465a0cb2` was read directly. Final Windows Node24.22.2 syntax PASS; full TAP run exit1, **11 tests: 1 oracle PASS / 10 expected RED**, zero cancelled/skipped,92.4692ms. Product tests stop at `ERR_MODULE_NOT_FOUND` for the selected new module; downstream product assertions remain UNEXECUTED. Initial oracle calibration caught/corrected planning constants before final run; no incorrect preliminary arithmetic is retained as proof.

Project formatter exit0 (tests/OpenSpec excluded); scoped staged/unstaged whitespace exit0. No new production/build or unchanged A0 rerun claimed. Cleanup PASS separately: no task-owned scratch/process/state created; unrelated dirty/untracked material preserved. Review readiness only, not implementation readiness until binding/decomposition/interface review. Combined gross accounting against `f84c03b`: **275 actual / 3 owned paths** (177 new test,87 new slice,10 task additions +1 deletion), plus **95–120 production forecast**, total **370–395 / 4 paths**, below600; actual production must be measured before accepting growth. No cap exception or later-cut allocation.

## Independent affected verdict — 2026-11-01

**PASS — pure dependency checkpoint only; no hotfix needed.** Verified candidate `5f1846f0efd561e45c1981a783e7d359d550aeef`, direct parent `d13be7f8fdd2eb40beb0977575514f7b75ab3102`, on the retained change branch and baseline above. HEAD equalled candidate throughout execution. Parent→candidate adds only `src/telegram/portable-render.js`: **91 gross**. Reviewed preparation **275** plus production **91 = 366 gross / 4 paths**, below600; no growth exception. This later evidence is documentation finalization, not additional implementation allocation.

Current owner design read directly, SHA-256 `587bc8093306c2c535cb40f8d53e2ba56e09da927617d5afb7700dc2465a0cb2`, matches preparation input. Supplied dispatch confirms Architect presentation/interface/test-artifact/decomposition approval. Initial index empty; seven other-owner tracked documents and nine untracked entries were present and left untouched. No code/test/dependency/configuration edits were made during verification. Candidate code, test and build inputs are tracked and unchanged; dirty design/product/index documents are not claimed committed candidate content.

Windows project Node **24.22.2**, bounded native execution is representative for deterministic in-process string operations; no managed runtime or external endpoint is affected by this module alone.

| Check | Independent result |
|---|---|
| `--check tests/portable-render.test.mjs` and `--check src/telegram/portable-render.js` | PASS, exit0 |
| `--test --test-reporter=tap tests/portable-render.test.mjs` | **11/11 PASS**, exit0, zero failed/cancelled/skipped, 82.9281ms |
| `scripts/build.mjs` | PASS, exit0;37 production modules parse, executable present, no test-source imports detected |
| `node_modules/prettier/bin/prettier.cjs --check .` | PASS, exit0; tests/OpenSpec excluded, independently read |
| Parent→candidate, owned working diff and staged `git diff --check` | PASS, exit0 |
| In-memory independent boundary and maximum/tie assertions (`--input-type=module`, no file edits) | PASS, exit0; exact results below |

Source fidelity: frozen exact six-entry maps, nine/five LF-joined lines without trailing LF, full IDs/disclaimer/fields and exact instruction-only labels/prompts match the reviewed binding. All26 allowed variants are asserted; maximum enumerates initial pending/not_applicable plus5×5 terminal pairs, never the impossible terminal/not_applicable maximum. Renderer uses current status; measurement does not. Empty context alone becomes `(none)`; whitespace, JSON/markup characters, combining sequences, astral text and long UTC spelling remain intact. Exact equality assertions exclude response text, capability/hash, callback/private pairing, legacy identity and diagnostics, not just selected marker matches. This is omission of private fields, not scrubbing caller-controlled content.

Independent complete-message arithmetic and rendered UTF-16 byte counts agree, rather than merely comparing4096 constants: fixed143 + ID36 + owner64 + label128 + action2000 + expiry24 + status40 =2435 before context. Context1661/1662 yields4096/4097. Both scalar counts are2266; pending-only counts4077/4078; JSON-escaped complete-string widths4104/4105. Thus scalar-only and pending-only admission would miss4097, while escaped-string counting would incorrectly reject4096. Both render intact; **no admission/rejection writer is tested**. The separate text case discriminates escaping of embedded quotes/backslashes/newlines as well. Reply prompt measures227 here.

Source uses `>=` for request-preferred ties. Independent branch-only probes with empty identity fields (outside validated broker input, not admission evidence) assert request184/reply191→reply and request191/reply191→request. Frozen-input test plus inspection of all91 lines establishes no mutation, imports, clock, I/O or side effects; only local arrays/strings and returned fresh measurement objects. Production never imports the oracle.

Unchanged evidence reused, not replayed: A0 `1541c32`, evidence `f84c03b`, for pairing replay/installed-state/authority assertions; adapter `0d94855`, evidence `9f195f4`, for its bounded lifecycle/abort assertions. Parent→candidate changes none of their inputs. These results are not counted as new presentation or integrated-feature assertions.

**Proof limits:** the founder-visible outcome remains a paired human decision reaching the original active call with useful acknowledgement. This checkpoint proves only local pure presentation strings and their conservative UTF-16 bound. It is **not A1a-i acceptance**, broker admission/replay/snapshot/status/expiry/creation proof, actual Telegram character counting, payload/no-parse_mode/transport behavior, public pairing, waiting, host/model, Events, first-use, feature or release verification. No network, credentials, installation or runtime service was used.

**Cleanup PASS separately:** no owned scratch, state, server, socket, timer or persistent child process was created; bounded pure commands completed. All pre-existing unknown/other-owner material preserved. Worktree remains **active / retained / not cleanup-ready**, not removed; no landing/archive/promotion authorized. Evidence HEAD is the subsequent tasks/slice-only commit reported in the completion handoff; candidate SHA above remains the verified executable revision. Any later code/test/dependency/configuration/baseline change requires affected revalidation.

## Next bounded setup prerequisites

No later-cut tests or implementation are authorized by this verdict. Before a separately routed replay/snapshot/status-guard setup, obtain implementation-selected exact paths and gross forecast, ordinary replay/copied-view signatures/results/errors and status-guard integration binding; no new test-only application API or invented temporary public diagnostic. Reuse A0 and Alpha-A as pinned prerequisites and bind actual `Journal.open/append/close` stopped-state fixtures to design4's exact `request.create`/`request.expire` vocabulary.

Alpha setup must cover committed-before-transaction reservation/pairing binding (including unrelated same-transaction mutations), strict fields/Unicode/input/full-render limits, exact inherited label/private snapshot, time comparisons, decision uniqueness/early or repeated expiry, array-order staged request semantics, whole-history failure preserving bytes/installed state and independent nested copied views/privacy. Recovery must not sample current time or append expiry. Snapshot is committed-state only; reservation-only status stays unchanged. Request-bearing status must remain dependent on beta, not pass via stale pending, fabricated empty lists or a newly invented outcome. Obtain owner clarification through coordination if the selected guard cannot meet this without a new public contract.

Beta remains separately required for actual serialized expiry append→flush→install, authorized target-only reads, stable closure/initial ledger, before/at/after deadlines, collision/generator/flush faults, grouped-sweep partial-success preservation, close/reopen/recovery, and awaited truthful status integration at every existing consumer. Both complete A1a-i and later actual creation/idempotency remain prerequisites of A1b; this verdict prepares neither automatically.
