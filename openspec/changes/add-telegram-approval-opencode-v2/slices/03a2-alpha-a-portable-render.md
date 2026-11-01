# Alpha-A — portable full-message measurement

Parent: [tasks](../tasks.md). Authority: [design](../design.md) sections 3–5/7; [Telegram delta](../specs/telegram-approval/spec.md), Distinguishable approval requests, Responses are instructions only, Fail closed without misleading status. Status: **review packet only; presentation binding requires Architect fidelity approval before implementation**.

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
