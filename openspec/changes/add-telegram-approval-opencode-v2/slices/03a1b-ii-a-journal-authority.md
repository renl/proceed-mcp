# 03A.1b-ii-a — journal 2 and portable authority unit gate

Parent: [tasks](../tasks.md). Authority: [design](../design.md) §§2–4 and Migration Plan 5; approved request-key ownership. Prerequisite: 03A.1b-i on the same change branch. Baseline: `469ec7ce23cc9497a7d90bafcfbe150fbbb94a62`; project baseline remains `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`.

Worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change `add-telegram-approval-opencode-v2`; lifecycle owner test engineering; active/retain. Next action: implement only the journal-first subcheckpoint below from `7ec97005524ae0eba552da21ac49842521917590` plus this readiness commit. Cleanup evidence: no new worktree/service; unrelated state untouched. One eventual OpenSpec PR, no per-unit PR/archive/promotion.

## Goal and limits

Founder-visible question: can private request authority survive restart without leaking or authorizing a different transport principal, so later public waiting-call delivery can be built safely? These unit observations are enabling proxies, not founder-visible workflow proof. Direct proof remains original public MCP result and first-harness acknowledgement after real Telegram interaction. No reservation HTTP route, runtime switch, pairing, waiting, Telegram, Events, host API or release claim is authorized here. Legacy runtime/MCP remains fail-closed against schema 2 until later units.

First production path: **only `src/journal/framing.js`**, changing `FILE_FORMAT_VERSION` and `RECORD_SCHEMA_VERSION` to 2 and necessary version comments. Keep binary layout, framing/recovery algorithms and all exports unchanged. Do not edit `src/journal/journal.js` for optional comments. No migration, identifier additions, portable module, consumer/runtime switch or other production edits in this subcheckpoint. Later authority/values work is separate and held until the journal commit is pinned. No network/OpenCode/Telegram imports or owner credential in the later portable core. Tests are not a production dependency.

## Later authority/values subcheckpoint — not ready for implementation

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

1. Journal-first: `& $Node24 --check src/journal/framing.js` (10s), then `& $Node24 --test --test-name-pattern="^PORT-JOURNAL2:" tests/portable-authority-unit.test.mjs` (30s outer). This existing case imports current journal/framing/values exports; it never calls the lazy portable-module loader. Missing `src/broker/portable.js` cannot block this gate. No new tests or test edits.
2. `& $Node24 node_modules/prettier/bin/prettier.cjs --check src/journal/framing.js` (30s); `git diff --check -- src/journal/framing.js`. Pin the passing journal-only production commit and affected verification before preparing the separate authority/values packet. Journal 2 is an unpromoted enabling state only: unchanged legacy loaders still reject configuration schema 2. A filtered pass is not helper, whole-unit, PORT-SETUP or feature acceptance.
3. Later authority/values: record its exact journal prerequisite commit and separately bounded size before readiness; run syntax on changed production/tests, then `& $Node24 --test tests/portable-authority-unit.test.mjs` (30s outer). All six cases must pass for ii-a completion, never a name-filtered substitute. Scratch only `.scratch/portable-authority-unit/run-*`, ignored before use; finally closes broker then journal and removes only owned run directories. Run applicable format/build and owned whitespace checks.
4. Future **ii-b** separately binds MCP catalog/adapter consumers; future **ii-c** binds runtime/IPC and all three PORT-SETUP tests together (200s outer), including the corrected public journal refusal. Those gates remain pending, not authorized by this packet. Then distinct 03A.1c PORT-RESERVE, then 03A.2 full waiting gates; no unit pass substitutes for them.

## Review and size gate

Decomposition triggers remain **YES / NO / NO / YES / YES** (new replay state consumed later; split public proof chain). Architect test-artifact review and journal-first dependency cut are **accepted**, per the readiness-refinement authorization (2026-11-01). No new contract or proof-chain change is introduced here; no additional approval round is required absent a new gap. Boundary Verification: no external platform touched by this journal-only subcheckpoint; interface-fidelity review of later public IPC/runtime refinement remains required before those consumers implement. This unit does not reuse old boundary approval as blanket authorization.

The original four-file production forecast of 340–400 gross lines is superseded for immediate dispatch by the journal-only cut. Production forecast reported by implementation: **18 gross lines**; authorized ceiling **40 gross changed lines, one file** versus the readiness HEAD. Constants and necessary comments only; stop and report if this scope or ceiling cannot hold. Later authority/values has its own measured packet after the pinned journal commit; this is a genuine separate review surface, not merely sequencing the original oversized packet.

## Preparation evidence

At parent `469ec7c`, Windows project Node **24.22.2**: both `--check` commands exit 0; focused unit command exit 1, **0 PASS / 6 RED / 0 cancelled/skipped**. VALUES fails missing handle pattern; four authority cases fail missing `src/broker/portable.js`; JOURNAL2 fails format 1 versus 2. Downstream behavior assertions remain unexecuted. Formatter and owned whitespace checks exit 0 (formatter excludes tests/planning). Final two optional-selector assertions do not change these prerequisite failures; final syntax is checked before commit.

Owned run directory inventory: zero entries under `.scratch/portable-authority-unit`; each run closes its opened journal even when module import fails. No process/listener or external scratch created. Unrelated dirty owner files/fixtures and historical artifact namespaces preserved.

Historical preparation versus `469ec7c`: four owned files, **253 gross lines** (196 new test, 51 new slice, three task additions, two additions/one deletion in public schema assertion). This already-reviewed artifact packet is reused, not newly authored or replayed. Its old combined 593–653 forecast is not authorized.

### Journal-first readiness refinement — 2026-11-01

At `7ec97005524ae0eba552da21ac49842521917590`, Windows project Node **24.22.2**: the exact filtered command above exits **1**, **0 PASS / 1 RED / 0 cancelled/skipped**, at test line 162 (`FILE_FORMAT_VERSION`: actual 1, expected 2). Remaining journal assertions are unexecuted; no full six-case rerun. Static inspection confirms the focused case uses only existing exports and never invokes the portable loader. Ignore coverage for its scratch root is confirmed. Failure occurs before fixture creation, so no run directory/process/cleanup obligation was created.

This refinement changes only this slice and `tasks.md`; no tests or production edits. Measured versus `7ec9700`, `git diff --numstat` gives **30 gross lines**: slice 15 additions/9 deletions, tasks 4 additions/2 deletions; no owned staged/untracked delta. Reused already-reviewed preparation **253** + actual refinement **30** + production forecast **18** = **301** gross lines; at production ceiling **40**, total **323**, below 600. Owned whitespace check passes. Journal-first is ready for bounded implementation, not accepted behavior; later authority/values readiness and all-six completion remain pending.
