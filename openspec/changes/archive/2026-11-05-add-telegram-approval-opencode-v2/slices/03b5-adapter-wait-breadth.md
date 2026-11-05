# W1c packet 1: longevity, restart and automatic expiry

Parent: [tasks](../tasks.md). Authority: current [design](../design.md) sections 3/6/7, accepted W1a and W1b source `c548045e8a976dc04ab70e0607c5ce6b8b82d333`, evidence `c47651e0e01c6ffe921dcf3433a774d2bb92a8e9`.
Authoring baseline is that evidence commit on retained branch/change `add-telegram-approval-opencode-v2`, worktree `.worktree/add-telegram-approval-opencode-v2` from project root. Target remains `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No new branch or PR. Other-owner changes remain preserved.

## Outline before test growth

User question: does the original waiting call survive internal polling and a broker restart, and receive its exact durable non-human outcome without another creation or caller reassignment?
Direct proof is the original typed MCP response observed through actual stdio, real broker HTTP and public creation. Relay observations and decoded journal records support identity, timing and durability, not human approval, client receipt or returned-write reporting.

Full mandatory breadth would exceed a coherent 600-gross packet. Packet 1 forecasts 280-420 gross across new `tests/portable-adapter-wait-breadth.test.mjs`, minimal `tests/support/public-registration.mjs` extensions, this slice and tasks. Hard limit 600 including evidence. Packet 2 remains mandatory: real-boundary lease loss/replacement, stale-heartbeat/wait401 races with controlled private clocks where representative, 409 finality, and notification/EOF at admission, turnover, reconnect/backoff and terminal completion. Packet 1 is independently reviewable test evidence, not complete waiting acceptance. SOURCE returned-write follows only after all waiting gates.

| Case | Ordered assertions | Inner / aggregate bounds |
|---|---|---|
| TURNOVER | Prearm raw observer and relay hold. Public create once, real 25s pending204, no original result. Duplicate during held204 gap rejected locally without HTTP/journal effect. Release204, same invocation re-enters same authority, actual cancel returns exact committed result | 30s turnover, 3s re-entry, 5s result / 65s work + 10s teardown allowance |
| RESTART | Live original pending, graceful broker stop releases its lock without journal mutation. Transparent relay preserves upstream transport loss rather than manufacturing503. Retain same adapter and call through actual 1/2/4/8/16/30/30 ladder. Restart without ownership edits, authenticated refresh, no creation replay or response reassignment, exact cancellation result | 100s ladder, 8s restart, 35s reconnect / 145s work + 10s teardown allowance |
| EXPIRY | Public60s creation, real elapsed time and automatic committed expiry, no read/status/sweep or deadline rewrite before outcome. Original returns exact durable expired decision. Graceful recovery and explicit identical repeat preserve identity and journal | 85s original / 110s work + 10s teardown allowance |

## Boundary Verification

Category: normative public MCP/HTTP plus actual isolated local broker/journal, no external provider. MCP revision2025-11-25 initialize/tools/call, typed RPC response identity, matching JSON text/structured content, request capability privacy and no unsupported Events remain guarded by maintained consumers. HTTP uses `http://127.0.0.1:<isolated-port>` only, Bearer owner, request capability header and captured registration ID/secret on POST wait. Creation uses the real route, seed pairing only. No decision API or fake human outcome. Cancellation is an actual authorized public operation. Expiry uses the production scheduler and real time. Test relay may hold a real completed204 or preserve a real upstream transport failure, never inject a terminal outcome. A relay-side socket close alone is not proof of upstream waiter detachment.

Combined owning test-artifact/boundary/decomposition review required through coordination. Trigger checklist 1 YES (helper consumers), 2 NO (fresh namespaces), 3 YES (prearmed observers), 4 YES (wire/journal/original response chain), 5 NO (pairing only setup, public creation remains proof). No repeated W1a/W1b contract review.

## Execution sequence and environment

Windows PowerShell, project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` v24.22.2. Native Windows stdio/HTTP/journal is representative of this isolated local contract only. No all-OS, live host, Telegram or release claim. Explicit synthetic127.0.0.1 HTTP/serve/MCP/Journal authority, no real host/network/credentials/.env/global state. Maintained `publicRegistration` owns setup, phase evidence, bounded work, finally teardown, process absence, lock absence, port rebind and scratch removal. Extended work budgets preserve reachable inner deadlines. Production unchanged.
1. Pinned `--check` on new test and changed helper, scoped `git diff --check` (10s). Tests/OpenSpec formatter-excluded by `.prettierignore`, not format-PASS. Production formatting inputs unchanged.
2. Full unfiltered `--test --test-reporter=tap tests/portable-adapter-wait-breadth.test.mjs`, 360s command bound. Persist TAP under ignored `.scratch/w1c/`. No model polling or foreground server.
3. Because shared helper changes, run full affected consumers `tests/public-registration-consumer.test.mjs tests/portable-registration-public.test.mjs tests/portable-registration-eof.test.mjs tests/portable-concurrent-stdio.test.mjs tests/portable-adapter-wait-public.test.mjs`, 240s bound. Stop/report genuine assertion or cleanup defect without test weakening.
4. Scoped whitespace/link/source freshness and gross accounting, commit exact four owned paths. Existing native83 and broker34 accepted evidence reused only for unchanged rules, not new longevity. Helper18/public7 evidence is superseded for affected helper inputs by step3.

Lifecycle owner: test engineering. Status active/retain, next action execute then owning artifact review. Cleanup evidence pending execution, worktree not eligible for removal. No production, config, design, PM, CoS, README, dependency or archive edits. No push/PR/publication.

## Executed verdict - packet 1 PASS, owning review pending

Windows pinned Node24.22.2. Authoring/execution HEAD `c47651e0e01c6ffe921dcf3433a774d2bb92a8e9` plus these owned test/helper bytes. `src/`, `bin/`, package/lock exactly match accepted source `c548045e8a976dc04ab70e0607c5ce6b8b82d333`. Dispatched design SHA256 `B6E70BF51F6DFE92BA2635A32604F564BBE9963292150C598ED72DAD72709EFA`. Existing dirty/untracked owner work remains preserved, not part of this candidate or commit. No integrated-change acceptance.

Cheap syntax2, source freshness and scoped whitespace PASS before resource startup. Full unfiltered new file exit0, 3PASS/0FAIL/cancelled/skipped/todo, 195319.8874ms. No failed attempt or rerun. TAP `.scratch/w1c/breadth.tap` retained, secret-free result labels only.

| Case | Actual assertion result | Whole case duration |
|---|---|---|
| TURNOVER | PASS: real monotonic25s floor, actual204 held, locally rejected duplicate during gap, one create, same-authority re-entry, exact original numeric7 terminal cancel | 30508.2525ms |
| RESTART | PASS: graceful shutdown below8s with lock absent and journal unchanged, actual upstream transport loss, measured1/2/4/8/16/30/30s floors (50ms observation tolerance), same adapter/call, old wait401, exactly one authenticated replacement, one create, exact original terminal cancel | 96526.8885ms |
| EXPIRY | PASS: real60s floor and exactly60s disclosed duration, two actual204 turnovers, automatic terminal expiry without a status/read/sweep trigger, exact durable decision returned on original call, unchanged public repeat/recovery | 68156.7807ms |

Affected helper consumers command in step3: exit0, 25PASS/0FAIL/cancelled/skipped/todo, 68377.8104ms. This replaces affected helper18 and W1b public7 evidence for the changed helper, not additional independent28 waiting tests. Accepted native83 and broker34 remain reused at source/evidence pins above only for their unchanged parsing/authority/registry/core assertions. No unit evidence substitutes for new real25/60s proof.

Assertion status PASS and cleanup status PASS separately. Maintained runner verified process absence, released lock, journal closure via normal broker shutdown, socket cleanup, both ports rebound and owned state directory removal. All23 new managed namespaces' persisted phases independently read as `cleaned` and matching `tests/.artifacts/<namespace>` directories were absent. The3 new breadth namespaces are `spike-4iMti3`, `spike-g0kgHU`, `spike-c3AOVL`. Progress files and TAP remain ignored local evidence, not unknown state cleanup. Restart asserts actual upstream request closure/error, not remote detachment inferred solely from relay-client closure.

Ready for ONE owning test-artifact/boundary/decomposition review, triggers1/3/4YES and2/5NO as above. New helper preserves upstream transport failure only when explicitly selected, exposes graceful stop/phase markers and configurable work budget, retaining default50s/60s behavior for existing consumers. No production/private behavior redefined. No source correction or SE replan needed.

Remaining mandatory packet2: registration lease loss/release/replacement while attached, refreshed-incarnation/stale-heartbeat/wait401 races, ownership safeguards including no replacement deletion/OWNER_IN_USE bypass, real409 finality after reconnect, cancellation/EOF during admission, turnover gap, reconnect/backoff and terminal completion, matching transport cleanup and suppression with no late work/business cancellation. Controlled private clocks may prove pure race rules only, not real elapsed scheduling or upstream detachment. Actual successful original-response-write SOURCE proof remains separate after all waiting checks. No complete waiting, returned-write, human, Telegram, host, feature or release claim. Worktree retained, next action owning review then separate packet2 dispatch. Post-execution finalization is owned docs only, no tested bytes changed.

Final owned accounting versus `c47651e`:245gross/4paths (new test163, helper17add+6delete, tasks3add, slice56add), production0, below600 and within pre-growth upper420. Original historical packet charges remain unchanged. Scoped whitespace and108 local links PASS. Tests/OpenSpec formatter-excluded, not formatter-PASS.
Test SHA256 `6E5D27844518E291BD2E9EFA9C806ED23C9BDFFA82081EF93E8AD2032AEAEA52`, helper SHA256 `91BC6538EC8F754DF1ADA4B1CA11B76D166A1119D2873695E80C82F2151D4816`. These identify the executed bytes before docs-only finalization.
