# 03A.1b-ii-b — public owner stdio catalog

Parent: [tasks](../tasks.md); normative authority: [design sections 2–3/6–7](../design.md), [portable continuation delta](../specs/opencode-session-continuation/spec.md), [approval delta](../specs/telegram-approval/spec.md). Review input only; interface/decomposition approval and bounded sizing remain required before implementation.

## Goal, dependency and scope

Founder-visible question: can an ordinary MCP client discover the portable approval workflow after protected owner setup, without a harness API/password? Catalog proof answers discovery only; it is an enabling proxy for the actual goal of a human outcome returning on the original waiting call. No waiting capability, first-host, Telegram, feature or release pass follows.

Use existing `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`; retain active, lifecycle owner test engineering, implementation custody implementation engineering. Baseline `main@f385409792aff3d46d96b5c4f03358f10c8dc5ba`; authoring parent `2ebedece47bdf1f2ca2cf02d867b25ff2b856ceb`. Prerequisite: chain on schema-2 CLI `2c47218`, journal-2 `ac83d18`, corrected authority `2794261992f5ca9fc27aa71a97a736f3adbd9dda`, present on this one branch. No new worktree/PR; one eventual change PR. Cleanup evidence: only per-run harness resources may be removed; unknown artifacts/dirty owner files remain untouched. Next action is targeted architecture review and production split selection, not implementation.

Owned files: `tests/portable-mcp-catalog.test.mjs`, this slice, `../tasks.md`. Reuse ordinary `tests/support/spike-rpc.mjs` and `managed-spike.mjs` unchanged. Proposed production paths from the prior implementation plan: `src/mcp/server.js`, `src/cli/main.js`, `src/http/local-client.js`; no production edits in this task. Private layout is implementation-owned.

Run actual CLI `init` → assert schema 2 → `owner add shared --label ...` → `mcp --owner shared --state-dir <protected fixture>`. No broker or Telegram, credentials/token environment, proprietary `_meta`, host/version API gate, Events, model or network fixture. No configuration override, test server posing as product, app reset endpoint or runtime adapter registry invented here. Tool descriptions/instructions must remain honest about incomplete execution; catalog advertisement alone is not an implemented tool outcome.

## Boundary Verification

| Item | Executable binding |
|---|---|
| Authority / sources | Design 3 and source pins in design 6: MCP revision `2025-11-25` lifecycle/stdio/tools. Existing pinned boundary reused; no novel external platform integration or new spike. |
| Wire endpoint | Actual production executable over newline-delimited JSON-RPC stdio, not HTTP/SSE; no URL applies. Operator selects `--owner shared`; protected per-owner credential binds transport principal, not authenticated agent-session identity. |
| Setup vs proof | Public setup creates isolated state and independent control/owner files; separate OS ACL/mode inspection verifies fixture protection. Proof then crosses production CLI/stdio initialize → initialized notification → tools/list. No credential or request authority is supplied as model input. |
| Request | Initialize carries only revision, empty client capabilities and generic clientInfo. Tools/list has `{}` after `notifications/initialized`. No tools/call is sent. |
| Assertions | `PORT-CATALOG`: matching RPC response via reused peer; revision and tools capability; exactly design 3's five tool names, exact required/property sets, closed object schemas, field types and declared scalar bounds/client-ID pattern/expiry bounds/default. Tool ordering/descriptions/private module layout are not constrained. |
| Privacy / lifecycle | Allowlisted environment excludes application secrets; only run-owned generated credential values are read for non-disclosure comparison, never printed. Actual Windows ACL or POSIX owner/mode inspection is separate from protocol proof, not cross-platform protection acceptance. Adapter EOF exit 0; output capped at 64 KiB; finally closes peer and managed harness tears down process tree, proves absence and deletes its own fixture only. |
| Source mismatch | Current server exposes only three legacy tools, session `_meta`, prompt receipt semantics; CLI still selects `--origin`. This is the explicit expected RED contract gap, not a reason to adopt legacy behavior or bypass schema loading. |
| Deferred / unresolved | No tool effects/errors, reservation, broker registration, HTTP auth, runtime consumers, waiting or live host tests. Unknown-owner-before-credential-read ordering is not explicit in design 2/3, so no invented ordering assertion; Architect clarification needed if desired. Protected principal-to-runtime adapter registry remains a later unresolved binding. |

Authority dependency is pinned before implementation: ii-a's durable capability reservation/authorization is enabling only. Public reservation must later pass distinct `PORT-RESERVE`, after runtime/IPC binding and full `PORT-SETUP`; no catalog pass discharges those obligations. Then full PORT-A/B waiting vertical and later real Telegram/first-host proof. No capability issuance is exercised here.

Decomposition triggers: (1) YES, changed public catalog consumed by later reservation/waiting; (2) NO, disposable namespace preserves other baselines; (3) NO, no event producer/receiver; (4) YES, eventual public proof spans setup/authority/runtime/waiting; (5) NO within this gate, actual CLI setup and catalog proof share one disposable run. Test-only expected schema table also requires Architect artifact review. Request targeted interface/decomposition review through coordination; prior authority approval does not approve this boundary.

## Run sequence and evidence

PowerShell/Windows; `$Node24` denotes the existing project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`. Run from this active worktree; native Windows is representative for local CLI/stdio and actual Windows ACL assertions, not other OS or host compatibility. No installation/download. Harness uses ignored `tests/.artifacts/spike-*`, bounded 55s work/65s test and whole-tree cleanup; outer test command bound 90s. Scratch/temp for spawned CLI/protection commands is the owned fixture.

1. `& $Node24 --check tests/portable-mcp-catalog.test.mjs`.
2. `& $Node24 --test tests/portable-mcp-catalog.test.mjs` — initial RED expected at owner/config consumer, never override it. Independent affected verification after implementation reruns this exact whole test.
3. `& $Node24 node_modules/prettier/bin/prettier.cjs --check .`; `git diff --check -- <owned paths>`. Tests/planning are formatter-excluded; run syntax plus owner review for them. After implementation also run project build and changed-production syntax/format checks.
4. Reuse ii-a 8/8 at `2794261` and CLI 8/8/helper 5/5 at `2c47218` only for unchanged scope, not a fresh pass. Do not run broader pending setup/reservation/waiting or legacy tests as catalog proof.

Evidence and measured gross size are recorded below after execution. No archive/push/publication/PR, `.env`, global path or live access is authorized. Keep assertion and cleanup status separate.

## Preparation evidence — 2026-11-01

At parent `2ebedece47bdf1f2ca2cf02d867b25ff2b856ceb`, Windows project Node **24.22.2**: syntax **exit 0**; whole catalog command **exit 1, 0 PASS / 1 RED / 0 cancelled/skipped**, 4746ms. Failure: initialize observation `transport-closed` instead of `response`; source `src/cli/main.js:233` still accepts `--origin`, not `--owner`. Schema-2 init/owner creation, independent actual Windows fixture ACL check and control/owner separation passed before RED. Protocol/catalog/EOF assertions remain unexecuted. No schema override or broker started. Secret non-disclosure check and managed process-absence/owned-directory removal assertions **PASS**; unrelated artifacts untouched. Formatter **exit 0** (tests/planning excluded), owned whitespace **exit 0**. Corrected authority ancestor confirmed; prior unit evidence reused by exact revision/scope, not replayed.

Gross review size against that parent, additions plus deletions: **3 owned files / 187 lines** = new test **132**, new slice **47**, tasks **5 additions + 3 deletions**; tracked/untracked measured separately without double-counting. Production remains **0 actual**, supplied forecast **420–500** in three other paths: combined **6 files / 607–687 gross lines**, above ~600 even at the low end. **NEEDS implementation-selected additive catalog-metadata/helper cut**, not a size exception or code-golfed test. Remaining production room with this complete gate is **413 gross lines** before any additional review/spec growth. Preserve the whole public gate and one change PR; review any smaller additive checkpoint as enabling only, then independently verify final owner-CLI/catalog integration. No ii-b implementation readiness declared.
