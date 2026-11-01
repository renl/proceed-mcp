# 03A.1b-ii-a — journal 2 and portable authority unit gate

Parent: [tasks](../tasks.md). Authority: [design](../design.md) §§2–4 and Migration Plan 5; approved request-key ownership. Prerequisite: 03A.1b-i on the same change branch. Baseline: `469ec7ce23cc9497a7d90bafcfbe150fbbb94a62`; project baseline remains `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`.

Worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change `add-telegram-approval-opencode-v2`; lifecycle owner test engineering; active/retain. Next action: affected architecture review and bounded implementation sizing. Cleanup evidence: no new worktree/service; run-owned fixture directories removed by assertions/finally, unrelated state untouched. One eventual OpenSpec PR, no per-unit PR/archive/promotion.

## Goal and limits

Founder-visible question: can private request authority survive restart without leaking or authorizing a different transport principal, so later public waiting-call delivery can be built safely? These unit observations are enabling proxies, not founder-visible workflow proof. Direct proof remains original public MCP result and first-harness acknowledgement after real Telegram interaction. No reservation HTTP route, runtime switch, pairing, waiting, Telegram, Events, host API or release claim is authorized here. Legacy runtime/MCP remains fail-closed against schema 2 until later units.

Production paths selected by implementation engineering: `src/journal/framing.js` (versions 2/2, binary layout unchanged), `src/journal/journal.js` (comment only), `src/util/values.js` (additive identifiers), new `src/broker/portable.js`. No existing consumer wiring. No network/OpenCode/Telegram imports or owner credential in the portable core. Tests are not a production dependency.

## Implementation-selected ordinary module interface

This records the supplied implementation plan, not a newly invented public API or production test hook.

- `values.js`: `REQUEST_HANDLE_PATTERN = /^hdl_[a-f0-9]{32}$/`, `REQUEST_CAPABILITY_PATTERN = /^cap_[a-f0-9]{64}$/`, `DECISION_ID_PATTERN = /^dec_[a-f0-9]{32}$/`; `randomRequestHandle()`, `randomRequestCapability()`. Existing request ID/hash/time helpers remain. No decision-ID writer yet.
- `portable.js`: `PORTABLE_REPRESENTATION_SCHEMA_VERSION = 1`; synchronous `createPortableBroker({journal,owners,port,clock=()=>Date.now(),logger=()=>{}})`. `owners` is the configured `{owner_id,label}[]`; journal is caller-owned existing `Journal.open/append/recover/close`.
- `recover()` resolves `{records}` (committed transaction count). Unknown operation, duplicate handle or repeated reserved request ID rejects `JOURNAL_STATE_INVALID`, exit 4, without rewriting valid bytes.
- `reserveHandle({ownerId,sessionLabel})` requires recovered/open state, known owner and a 1–128 Unicode-scalar label, preserving text; omitted label uses owner label. Resolve exactly `{schema_version:1,request_handle,request_id,request_capability}` only after serialized append/flush completion and state application. Every call allocates fresh independent identifiers; no secret replay/idempotent preparation.
- Persist only `{op:'handle.reserve',owner_id,request_handle,request_id,capability_hash,session_label,prepared_at}`; hash is SHA-256 of the complete capability string. Collisions/replay duplicates fail closed; no injected randomness/writer API is required.
- `authorize({ownerId,capability,requestHandle?,requestId?})` returns the matching redacted reservation or `null`. Missing/wrong key, foreign principal and mismatched supplied handle/ID return null; a transferred valid key within the same principal remains valid.
- Redacted reservation is exactly `{owner_id,request_handle,request_id,session_label,prepared_at}`. Hash is journal/internal-only, NEVER in snapshot/status/logs; the supplied example mentioning snapshot hash is explicitly superseded by this redacted interface.
- `snapshot()` returns `{prepared:[redacted reservations],requests:[]}`. `status()` returns `{schema_version:1,broker:{pid,port,started_at},requests:[]}`. `close()` is idempotent, drains accepted serialized commits, denies later mutation, and does NOT close the caller's journal. Caller closes journal after broker.

## Executable mapping and sequencing

Runnable gate: `tests/portable-authority-unit.test.mjs`. `PORT-AUTH-VALUES` binds identifiers; `PORT-AUTH-DURABLE` binds design 3 preparation/ownership, exact persistence, redaction, same-owner transfer and actual journal reopen/replay; `PORT-AUTH-GUARDS` binds scalar validation, recovery/open prerequisite and caller journal ownership; `PORT-AUTH-FLUSH` observes existing `journal.append` completion (which already awaits file sync), pending-state invisibility and queue draining; `PORT-AUTH-REPLAY` binds duplicate/unknown-op refusal. `PORT-JOURNAL2` binds design 4 versions, checksum-valid schema-1 refusal, format-1 byte preservation, checksum/sequence rejection and incomplete-tail truncation/append continuity. Append observation is test-only wrapping of an ordinary interface, not a new application API or direct OS-flush-failure proof. Crash/disk-full/platform durability remain later gates.

Corrected `tests/portable-setup.test.mjs` PORT-SETUP-SCHEMA requires a journal-specific diagnostic; generic configuration-schema rejection cannot pass. Existing fixtures declaring journal 1 remain historical, never portable acceptance.

PowerShell/Windows, project Node 24.22.2 (`$Node24` = project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`), native pure unit execution is representative for these local module/file assertions only:

1. `& $Node24 --check tests/portable-authority-unit.test.mjs`; also check `tests/portable-setup.test.mjs` (10s each).
2. `& $Node24 --test tests/portable-authority-unit.test.mjs` (30s outer). All six cases must pass after implementation, no name-filtered whole-unit acceptance. Scratch only `.scratch/portable-authority-unit/run-*`, ignored before use; finally closes broker then journal and removes only owned run directories.
3. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .` (30s; tests/planning intentionally excluded); `git diff --check -- <exact owned paths>`. Implementation also runs changed production syntax/build.
4. Future **ii-b** separately binds MCP catalog/adapter consumers; future **ii-c** binds runtime/IPC and all three PORT-SETUP tests together (200s outer), including the corrected public journal refusal. Those gates remain pending, not authorized by this packet. Then distinct 03A.1c PORT-RESERVE, then 03A.2 full waiting gates; no unit pass substitutes for them.

## Review and size gate

Decomposition triggers: **YES / NO / NO / YES / YES** (new replay state consumed later; split public proof chain). Architect decomposition/test-artifact review through coordination is required before implementation readiness. Boundary Verification: no external platform touched by this additive unit; interface-fidelity review of later public IPC/runtime refinement remains required before those consumers implement. This unit does not reuse old boundary approval as blanket authorization.

Supplied production forecast: four files / 340–400 gross changed lines. Measure tests/docs separately and combine before dispatch. If the combined review packet exceeds approximately 600, phase first: journal-2 format/refusal gate independently before portable-authority core, with explicit pinned prerequisite and matching test subsets; retain one change branch/PR and no partial feature promotion. Do not treat commit sequencing alone as a size reduction or silently authorize the upper forecast.

## Preparation evidence

At parent `469ec7c`, Windows project Node **24.22.2**: both `--check` commands exit 0; focused unit command exit 1, **0 PASS / 6 RED / 0 cancelled/skipped**. VALUES fails missing handle pattern; four authority cases fail missing `src/broker/portable.js`; JOURNAL2 fails format 1 versus 2. Downstream behavior assertions remain unexecuted. Formatter and owned whitespace checks exit 0 (formatter excludes tests/planning). Final two optional-selector assertions do not change these prerequisite failures; final syntax is checked before commit.

Owned run directory inventory: zero entries under `.scratch/portable-authority-unit`; each run closes its opened journal even when module import fails. No process/listener or external scratch created. Unrelated dirty owner files/fixtures and historical artifact namespaces preserved.

Measured preparation versus `469ec7c`: four owned files, **253 gross lines** (196 new test, 51 new slice, three task additions, two additions/one deletion in public schema assertion). Combined supplied production forecast is **593–653 gross lines**, not an approved <=600 implementation packet. Preparation is review-ready; implementation readiness is held for decomposition review and the journal-first phasing above or a concretely bounded revised forecast. No size exception requested, no production edits or feature pass.
