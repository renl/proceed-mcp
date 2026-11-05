# W1c packet 2: incarnation, conflict and cancellation races

Parent: [tasks](../tasks.md). Authority: current [design](../design.md) sections 3/6/7, accepted [W1b](03b4-adapter-wait-public.md) and [packet 1](03b5-adapter-wait-breadth.md).
Baseline `307b320aa7f2d29a6ca5d590d474dbd4d87140a4`, unchanged production `c548045e8a976dc04ab70e0607c5ce6b8b82d333`. Same retained `.worktree/add-telegram-approval-opencode-v2` from project root, branch/change `add-telegram-approval-opencode-v2`, target `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. One change/PR, no new worktree.

## Outline and forecast before writing

User question: can cancellation, transport loss or stale registration work affect another incarnation or produce a late original-call result?
Direct proof: actual original MCP calls, recognized nonretryable409 result, suppressed raw frames, actual upstream disconnect and independently observed broker slot release. Clock-driven lease/generation contracts prove pure ordering only. Journal and relay records support these assertions, not human approval or successful stdout-write reporting.

Forecast 350-520 gross, hard600 including helpers/tasks/evidence. Extend coherent existing executor-wait and broker-wait suites, plus new public race suite. Do not duplicate established invariants. No production changes. Stop on real failure, preserve strict expected results and record exact incomplete remainder.

| Area | Cases and controls |
|---|---|
| Lease | Existing real HTTP attached expiry/release/replacement tests extended with stale heartbeat/delete refusal, successful fresh heartbeat and exact replacement expiry/nonrenewal boundaries. Controlled private registry time, not elapsed45s proof |
| Incarnation | Pending old heartbeat200/401 and old wait401 complete after fresh replacement. Deterministic timers prove fresh-only renewal, no extra creation/delete, close captured fresh only |
| Conflict | Lose downstream while deliberately retaining real broker waiter. Original reconnect receives real409 and ends, no polling/registration transfer. Explicit cancellation later cannot forward a result to ended original |
| Cancellation/EOF | Prearmed raw/transport observers and response/admission barriers at registration, admission, attached wait, real204 gap, reconnect backoff and committed terminal completion. Surviving protocol ping/prepare controls for notification, exact EOF release and no frame/retry/business cancellation |

## Boundary Verification

Normative MCP/HTTP and real isolated localhost TCP/serve/MCP/Journal only. Protocol2025-11-25, actual typed tools/call IDs, notifications/cancelled. HTTP `http://127.0.0.1:<isolated-port>`, owner Bearer, request capability header, captured registration ID body/secret header for wait. Pairing-only journal seed, all public original requests created by actual adapter. Fault relay holds responses or admission and optionally propagates downstream disconnect to upstream. Conflict case deliberately does NOT propagate it, so retained broker waiter produces authentic409. Relay socket closure alone never establishes broker detachment.
Private deterministic clocks/timers are distinct from actual elapsed/wire assertions. No knobs/endpoints, fake host, human decision, external network, credentials, global state or fabricated successful-write report. Request cancellation is used explicitly only as a terminal producer or after detachment to inspect initial ledger.

Combined owning test-artifact/boundary/decomposition review through coordination. Trigger checklist1YES (shared helper),2NO (isolated namespaces),3YES (prearmed observers),4YES (HTTP/stdio/journal ordering),5NO (pairing setup only). No repeated unchanged W1a/W1b contract review.

## Run sequence and lifecycle

Windows PowerShell, pinned project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`24.22.2. Native Windows stdio/HTTP is representative only of this local boundary. Tests/OpenSpec formatter-excluded, not format-PASS. No production format inputs change.
1. Pinned `--check` all changed executable paths, scoped whitespace and production freshness before resource startup.
2. Full unfiltered `--test --test-reporter=tap tests/portable-adapter-wait-races.test.mjs tests/portable-wait-unit.test.mjs tests/portable-wait.test.mjs`,180s command bound. Existing maintained runners own aggregate deadlines, progress, teardown, process absence, lock absence, socket closure, port rebind and state removal.
3. Affected shared helper consumers: full `tests/public-registration-consumer.test.mjs tests/portable-registration-public.test.mjs tests/portable-registration-eof.test.mjs tests/portable-concurrent-stdio.test.mjs tests/portable-adapter-wait-public.test.mjs`,240s bound. Packet1 long retry/default25s/60s evidence reused by exact unchanged scope, not repeated through breadth file.
   Also full `tests/portable-cancellation.test.mjs tests/portable-public-create-read.test.mjs tests/portable-public-delivery.test.mjs`,180s bound. Import inventory confirms remaining restart/retrieval consumer uses only unchanged outputGuard/observe exports.
4. Scoped links/whitespace/accounting/source freshness. Commit exact owned paths only. Preserve ignored TAP/progress and all other-owner work.

Lifecycle owner test engineering, active/retain. Next action execute and combined owning review. No worktree removal, push, PR, archive, publication or feature/release acceptance. Full waiting remains review-pending. Actual successful stdout-write/returned reporting is a separate later source unit.

## Executed verdict: bounded PASS, combined owning review pending

Executed against baseline HEAD `307b320aa7f2d29a6ca5d590d474dbd4d87140a4` plus exact owned test/helper bytes. Production `src/`, `bin/`, package and lock have zero diff from `c548045e8a976dc04ab70e0607c5ce6b8b82d333`. Design SHA256 `B6E70BF51F6DFE92BA2635A32604F564BBE9963292150C598ED72DAD72709EFA` unchanged from packet1. Preserve all pre-existing other-owner modifications/untracked files. No integrated-change verification claim.

Cheap pinned Node24.22.2 syntax4/source identity/scoped whitespace PASS before setup. Tests/OpenSpec are formatter-excluded by repository policy, not formatter-PASS. Final relevant code bytes identify:
- New public race suite SHA256 `367D4A348250E1F5A63B99F141C4AF8185051CB36A04C1E7FA26F7E78974E808`.
- Executor wait suite SHA256 `F760E1AA1B1A2295B757B8A9AB2685FFBBF7E061D41122CBDFD0473723E8DE7B`.
- Broker wait suite SHA256 `7FFC88C95471BE38AF354C5EA3AB9B26351FF87E7127F09CC398008ADD12585F`.
- Shared helper SHA256 `0A0131EF9DCFEA429C25AAA9652EB37F94D49980326111404D8C536F8E6C9FB5`.

| Area | Execution/evidence | Result and limits |
|---|---|---|
| Original reconnect conflict and cancellation/EOF | Full final new public file13/13, exit0,139840.1695ms, `.scratch/w1c2/races-final.tap` | Real surviving upstream409 preserves broker error and ends original once. Twelve notification/EOF cases at six barriers pass, including actual25s204 gaps, exact captured transport/release, suppression, no retry/recreation/business cancellation. Attached cases prove upstream request closure AND later explicit cancellation selects unavailable. Terminal cases retain the real committed decision without forwarding suppressed output |
| Incarnation | Full native wait suite84/84 from initial aggregate run, `.scratch/w1c2/run.tap` | New controlled old heartbeat204/401 and delayed original wait401 cases keep fresh authority, fresh-only heartbeat, no extra registration/create/delete and captured fresh close. This is deterministic generation proof, not real elapsed lease or wire401 race proof |
| Attached lease/replacement | Full final broker wait file36/36, exit0,29841.5382ms, `.scratch/w1c2/lease-final.tap` | Existing34 plus new expiry/release stale-heartbeat/delete/old-wait denials, fresh heartbeat control, OWNER_IN_USE before exact fresh expiry and replacement at equality. Actual HTTP/core/journal, controlled registry clock. No revival, replacement deletion/renewal or business mutation |
| Shared helper consumers | Full25/25, exit0,67173.9409ms, `.scratch/w1c2/consumers.tap`; additional full100/100, exit0,54026.7029ms, `.scratch/w1c2/other-consumers.tap` | All affected non-long consumers pass. Includes ordinary-operation EOF, registration release/heartbeat, overlapping owners, cancellation and public creation/ledger. No production config changed |

Failure history remains explicit: initial full three-file command exited1,131 entries129PASS/2FAIL,124581.7351ms. Both new stale cases incorrectly sent `{}` as DELETE body through the raw test client and got bare400 with no broker envelope, rather than expected401. A bounded two-case diagnostic repeated the same failure and identified DELETE. Corrected only request construction to empty DELETE body, retained exact401/code/retryability assertions. Full affected broker file then passed36/36. No production defect, source correction, weaker expectation or waiver. Initial public11 and native84 passed. Added two attached cases and explicit EOF socket assertions, then reran the whole final public13 file unfiltered. Earlier successful assertions are not counted twice.

Assertion status PASS, cleanup status PASS separately. Every managed run's maintained runner checked process/lock/port/socket/state cleanup. All227 persisted public progress files inspected after runs were `cleaned` with their named `tests/.artifacts/<namespace>` directory absent. Core progress records show cleanup-pass, with owned clients closed, journal handle EBADF and port rebind asserted by the runner. No unknown files/resources removed. Ignored TAP and progress retained. Worktree remains active/retain, not removal-ready.

Packet1 `307b320a` real25s turnover, full1/2/4/8/16/30/30 reconnect, graceful restart and real60s expiry evidence is reused only for those unchanged source/constants/assertions. The new relay options are opt-in fault controls, not production timing controls. No full retry/default-expiry replay was needed. W1b `c47651e` accepted original-call/authority evidence remains limited to its stated scope, with changed helper consumers superseded by current execution. Existing controlled registry45s and public10s heartbeat evidence supplies its unchanged scope, never a claim of45s wall-clock proof.

Ready for ONE combined owning test-artifact/boundary/decomposition review through coordination, triggers1/3/4YES,2/5NO. No remaining unexecuted packet2 case from this outline. Mandatory acceptance still pending: that owning review across waiting breadth and the separate successful stdout-write callback/returned-report source unit with independent public proof. No complete waiting, successful-write, host, human/Telegram, feature, release, archive or promotion claim. Negative real retry window is1250ms and closed-traffic observation150ms, supplemented by native generation/close contracts. Notification during shared registration does not assert cancellation of shared lifecycle HTTP, only no late invocation forwarding. Lost registration authority on EOF is not guessed for DELETE or claimed remotely released.

Final accounting against `307b320a`:279 gross/6 owned paths. Tests206 (public144, executor40, broker22), helper9 (7add/2delete), docs64 (tasks1, slice63). Production0, below600. Scoped whitespace and111 local links PASS. All337 core progress namespaces also checked cleanup-pass and absent. Post-execution finalization changed owned docs only, executed code hashes unchanged.
