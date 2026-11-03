# C3 P3 Packet C - activated persistence and acknowledgement faults

Parent: [tasks](../tasks.md). Authority: [design5/7](../design.md), [copy annex](../proposal.md#c3-product-copy-annex), capability deltas linked from tasks, [partition](03c3j-p3-privacy.md), [accepted B](03c3k-p3-races.md).

## Scope and outline before growth

Does a storage or Telegram UI failure ever expose an uncommitted human outcome, replay a decision, or send the original result to another call?

- Same retained worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain. Baseline target `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. One change PR, internal checkpoint only.
- Packet baseline `15e5a82dbc3a6ad8e0e80ba4e654a2f8a0eb4d20`, B bounded combined approval supplied. Production `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`. Initial source/bin/scripts/dependency diff empty. Existing dirty owner documents and unknown files preserved and excluded.
- Only tests/helpers/fixtures, this slice and tasks authorized. No source/owner-artifact edits, external network, secrets or existing runtime-state reads, installs, remote Git, archive or publication.
- Forecast tests240 + fixture105 + shared helper25 + docs100 =470 gross. Hard600 additions plus deletions against packet baseline. Split at persistence versus client/UI boundary if needed, without discarding any remainder.

| Cases | Actual mechanism | Proof versus supporting proxy |
|---|---|---|
| Held opening and text-resolution flush | Real producers through public pairing/create/Respond, real Journal append and file sync barrier. Observe actual wait settlement, copied committed state and client request order | Original waiting RPC remains pending before flush and returns exact text afterward. Journal, captured state and ordered observation events support flush/install/wake/UI order |
| Failed write and uncertain complete-frame sync | Fail actual run-owned journal handle write before bytes, or sync after complete bytes. No synthetic history. Verify storage error, no UI/offset advancement, journal-wide refusal, graceful restart and explicit recovery | Original call cannot return terminal success from failed append. With remote delivery held, recovery retains a valid complete decision once or leaves pending. Releasing backlog after explicit restart permits normal consumption, not an in-process append retry |
| Ack rejection/isolation and global401 | Actual fixed-origin client intercepted at loopback with HTTP/API403/404/409,429,503 and401 envelopes. Positive original-call and next-poll controls | Committed original-call winner retained, no replay. Method refusal leaves polling/local work usable.401 fences all shared Telegram work, not local observation |
| Rate/transient/abort | Actual polling429 retry_after and503 responses, real elapsed retry floor, admitted held ack aborted by graceful stop | No early poll or repeated business mutation. Actual socket close and no post-stop platform call. No live platform timing claim |

## Run sequence and boundary

1. Windows PowerShell, Node24.22.2 `$node='../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe'`. Syntax-check each owned JS path with `& $node --check <path>`, then owned `git diff --check`. Tests/OpenSpec are formatter-excluded.
2. Full unfiltered `& $node --test --test-reporter=tap tests/portable-faults-p3.test.mjs tests/portable-waiting.test.mjs`. Shell bound240s. Existing maintained portable runner owns55s work/63s lifecycle per case,65s test ceiling, persistent progress, process-tree/run-directory/listener cleanup. Ignored scratch `.scratch/c3-activation/` only.
3. Independent assertion review against working-copy authorities and observed outcomes. Real production failure stops unrelated work with durable discriminator. Test-harness failures stay separate and are retained before scoped repair.
4. Owned local links/ASCII/whitespace, exact scope and gross measurement, local owned commit. No D execution or full P3/C3 acceptance.

Native Windows represents local JS/stdio/filesystem semantics. Fixed-origin POST JSON interception exercises the real client and assembled public consumer, not Telegram TLS or real-human receipt. No new production hook, route, schema or signature is prescribed. Test-only instrumentation delegates ordinary core methods and real journal I/O, never supplies business outcomes.

Boundary: normative MCP/Telegram/journal ordering contract, pinned design5 Bot API10.3 research and `https://api.telegram.org/bot<token>/<method>` reused. Real Telegram proof remains BLOCKED separately. Checklist1 NO,2 NO,3 NO,4 YES for combined P3 conclusion,5 NO. Request one focused combined boundary/test-artifact/decomposition owning review via coordination. Tests do not self-approve contract meaning.

## Exact remaining scope

Packet D remains separately authorized later: assembled three-worker normal/partial-start fences, send-only prompt, valid late drain/fanout, full public prefix/current-ledger/status/retained/refusal/no-echo selection, raw non-object poll envelopes and publicly reachable snapshot discrimination. Earlier580 forecast has insufficient margin and requires re-estimation, likely separate lifecycle and copy packets. No speculative D detail or automatic D work here.

Execution, reuse, failure provenance, gross and cleanup evidence follow below.

- Initial unfiltered `.scratch/c3-activation/p3c-first.tap`:6PASS/3FAIL,75098.8575ms. Three opt-in journal-instrumented cases failed broker readiness before assertions. Test preload constructed a prototype-discovery broker with `journal:{}`, rejected by the real factory's required append/recover guard. Noninstrumented C UI/401/backoff and full existing PORT-A/B passed. This is a test-harness setup failure, not a production fault or executed persistence proof. Repair supplies real Journal method references only for prototype discovery. All owned runs reached maintained cleanup-pass.
- Focused `.scratch/c3-activation/p3c-storage.tap`:2PASS/1FAIL,33496.6194ms. ORDER and complete-frame sync failure passed. No-bytes write failure correctly fenced and preserved identical journal bytes, but post-restart pending assertion observed approval because the fixture immediately redelivered the original uncommitted backlog. This is missing test isolation between storage replay and normal restarted consumption, not evidence of an in-process business retry. Repair holds remote delivery during the recovery observation, then releases the real backlog. No production policy change or weakening of byte/fence/ordering assertions.

## Bounded independent verdict - 2026-11-04

PASS for Packet C executable obligations, ready for focused combined owning review, not self-approved or complete C3. Production remains `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`. No source correction or normative-contract change.

- Final full unfiltered maintained command in step2: exit0,11/11PASS,0fail/cancelled/skipped/todo,90580.6665ms. Artifact `.scratch/c3-activation/p3c-final.tap`. New suite8/8 and affected existing fixture/PORT-A/B3/3. Syntax3 PASS before execution. This lane authored, independently reviewed and executed boundary assertions against accepted production. Separate owning contract judgment remains pending.
- Intermediate full `.scratch/c3-activation/p3c-complete.tap`:10/10PASS,81369.7966ms. Final review added actual client send-start observations for opening/text ordering and a separate retry-wait abort discriminator. Final run above, not that earlier run, identifies the executed artifact.

| Obligation | Actual assertion and verdict | Limit |
|---|---|---|
| Positive ordering | ORDER PASS: actual opening bytes reach held sync with public request still pending, no prompt/ack. Real flush-complete precedes actual prompt/ack start. Text resolution remains pending with no waiter settlement or human copy during held sync. Ordered same-process observations prove flush, actual waiter settlement with installed terminal state, then human-copy send. Approve independently proves flush/install/wake before ack. Exact original numeric RPC IDs and text preserved | Observation delegates actual core/wait promises and client calls, not a mock wake. External receipt and model consumption unproved |
| Failed/uncertain append | WRITE/SYNC PASS: actual file write rejects before bytes or actual sync rejects after complete valid frame. Original waiting call returns STORAGE_FAILURE, no ack or next poll, unrelated preparation fenced. No-bytes journal exactly unchanged. Explicit graceful restart with remote delivery held shows pending versus retained same decision. Releasing original backlog resolves once only where no frame existed | Complete uncertain frame is not claimed durable until normal reopen sync. No abrupt-stop lock surgery, partial-tail/crash/OS-loss simulation |
| UI isolation | UI PASS: HTTP403/404/409 and API403/404/409,429,503 envelopes actually cross production ack client. First refusal follows a newly rejected decision, later variants use retained callbacks. Each reaches next committed serial barrier, same decision, one creation/resolution. Separate actual Respond/text human-copy send403 fails after exact original-call instructions, next request still approves | Actual best-effort UI failure isolation, not a claim of UI retry ladder execution. No retry count constrains a permitted implementation |
| Global credential scope |401 PASS: independent HTTP401 and API401 on new recorded approval. Previously produced open/prompt attempt fails transiently and installs retry prerequisite. After401 no poll/question/prompt retry/edit/ack traffic. Fresh public creation remains pending and prior decision readable locally | Already-admitted valid sends may drain. Canonical owned callbacks only, not arbitrary foreign-listener recovery |
| Rate/transient/abort | BACKOFF/PAUSE-ABORT PASS: actual poll429 retry_after2 floor then503 retain consecutive second-rung delay, no premature retry. Original Approve reaches held actual ack socket, stop destroys it. Separate actual retry_after30 response stops in less than3s, no repoll or business replay | Real elapsed first/second rungs only. Full private ladder reused below, not relabeled assembled. No live burst/rate test |

## Evidence reuse and overlap

- Full original PORT-A/B were executed now because the maintained shared runner changed. Their3 checks are regression execution, not recycled historical counts. Shared changes are opt-in journal preload and optional response interception. Default behavior remains covered by these public controls.
- [Accepted A](03c3j-p3-privacy.md#independent-bounded-verdict---2026-11-04), packet `c1b6c1d4`, suite blob `e8c8d36ce5d56c47aba88eb026689efef602d162`, `.scratch/c3-activation/p3a-complete.tap`: reuse only actor/chat/token/tuple/role/context/scalar/privacy assertions. New journal opt-in is absent on A. No repeated full privacy matrix.
- [Accepted B](03c3k-p3-races.md#bounded-independent-verdict---2026-11-04), packet `15e5a82d`, suite blob `a1526f417c69be92d4eed03bf448df87c53154bf`, `.scratch/c3-activation/p3b-final.tap`: reuse only exact equality, competing outcomes, stale/duplicate/restart-backlog assertions at unchanged production. Default clock/replay paths unchanged. C overlaps explicit retry/same decision/original-call ownership, not additional distinct primary workflows.
- [Pair correction](03c3i-pair-text-correction.md#independent-attempt1-verdict---2026-11-04), source `dae0a47a`, evidence `e5810a98`, `.scratch/c3-pair-text-001/independent.tap`: unchanged pairing classification only. C uses real pairing but does not replay its grammar matrix.
- [Native prompt fault evidence](03c3g-p2-prompt-faults.md#remaining-packet-execution---2026-11-04), source `5f48f704`, baseline `99a6bc5a`, `.scratch/c3-prompt-worker/remainder-verified.tap`: unchanged worker assertions only, including PW-RETRY/RATE full ladder/floors/reset, PW-STORAGE actual receipt write/sync, PW-STOP and canonical listener scope. Worker source diff is empty. Client changed acknowledgement policy after that evidence, so no old client classification PASS is reused. New UI tests exercise that changed boundary. Existing private-core/wait invariants remain supporting only. None discharge new assembled persistence/UI obligations by themselves.
- Review inspected actual producers, actual client/error envelopes, real Journal delegates, original-call destinations and before/after discriminators. No new production defect observed. Failed harness commands remain failures, not retroactive passes. No wire/TLS/live-human or whole-change acceptance.

## Cleanup and finalization

- Final10 portable namespaces: `spike-942rZ6`, `spike-OuxLxx`, `spike-wKs5Kx`, `spike-Nd9OIQ`, `spike-nizJRY`, `spike-xmwNf5`, `spike-P6qjZM`, `spike-0CwZMH`, `spike-pT0Ci3`, `spike-kwiUek`. Each records setup/assertions/teardown/cleanup-pass in `.scratch/c3-activation/progress.log`. FIXTURE separately proves listener release. Assertion PASS and cleanup PASS are separate.
- Maintained runner proves owned process-tree absence, run-directory removal under ignored `tests/.artifacts/`, fixture listener rebind/close. Only ignored TAP/progress retained. Unknown/owner data preserved. Active worktree/branch retained, next action focused combined C owner review. C has no known unexecuted bounded obligation. D and live/human/feature/release gates remain blocked as listed above.
- Executed Git blobs: suite `67d0745d0b9f393b931f94bc6735e776e621869b`, preload `af123cbe2088e0eefcf7dba1ff432b62e53f58a3`, helper `ea0ccb996f8c3979d783792013664a83cb2fece7`. Subsequent finalization edits only owned tasks/slice prose, not tests/source/dependencies/configuration/baseline. Exact final charge and structural checks follow below.

- Final charge against `15e5a82d`: suite238 + preload77 + shared helper6 + docs84 = **405 gross across5 paths**, below hard600. Source0. Syntax3, owned links/anchors10, ASCII and whitespace PASS. Formatter excludes all5 paths, not claimed formatter-checked. No whole-change size exception, C3 acceptance or D authorization.
