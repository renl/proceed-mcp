# C3 P3 Packet B - activated deadlines, replay and competing outcomes

Parent: [tasks](../tasks.md). Authority: [design5/7](../design.md), capability deltas linked from tasks, [A partition](03c3j-p3-privacy.md), [activation](03c3h-activation.md), [pair correction](03c3i-pair-text-correction.md).

## Scope and outline before implementation

Can a delayed or repeated human input replace the first durable outcome, or turn a deadline closure into approval?

- Same retained worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain. Target `main` baseline `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. One OpenSpec PR, internal checkpoint only.
- Starting HEAD `c1b6c1d451556a753258b8589a0401e5dbc291ef` (accepted A). Production `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`, initial `git diff` against `src` empty. Existing owner tracked/untracked work preserved and excluded. Working-copy design/specs govern.
- Authorized tests/helpers/fixtures, this slice and tasks only. No source, normative-owner changes, external network, existing runtime-state/secrets reads, installs, push, PR, merge, archive or publication.
- Forecast: `tests/portable-races-p3.test.mjs` 300, test-only clock preload/helper 55, slice/tasks 100 =455 gross. Hard600 additions plus deletions against starting HEAD, no accounting exclusions.
- Cases: actual public pairing/create/question/Respond/prompt producers, repeated Respond cursor-only without deadline renewal, duplicate and stale updates, retained/cancelled/expired controls, callback/text/cancel competitors, exact equality and stopped backlog/recovery.
- Mechanism: actual public stdio MCP calls and fixed-origin production Telegram client intercepted offline. Test-only preload freezes broker Date.now from isolated runner clock file, real timers remain unchanged. Restart before deadline obtains a fresh valid registration before equality, avoiding unrelated lease expiry as a discriminator. No production test hooks or synthetic business-history mutation.
- Direct bounded proof: exact original-call outcome, same decision after competing inputs and restart. Supporting evidence: one durable closure, cursor atomicity, recovered question/prompt tuples and offsets. Controlled clock proves logical equality, not elapsed60s or cadence. Offline client assembly does not prove live Telegram/human receipt.

## Sequence and constraints

1. Windows PowerShell, project Node24.22.2: `$node='../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe'`. Syntax-check named new/changed test JS with `& $node --check <path>`. `git diff --check` on owned paths. Tests/OpenSpec are formatter-excluded.
2. Full unfiltered `& $node --test --test-reporter=tap tests/portable-races-p3.test.mjs`, shell bound240s. Existing maintained `portable` runner owns55s work/63s lifecycle per case,65s test ceiling, progress, process-tree/run-directory teardown and listener rebind proof. Logs only in ignored `.scratch/c3-activation/`.
3. Independently review assertions against working-copy authority and actual outcomes. Reuse accepted PORT-A/B, correction and A only within unchanged revision/assertion scopes. Preserve failures. A real source defect stops execution for routed correction, never relaxed assertions/deadlines.
4. Owned link/ASCII/whitespace and scope checks, actual gross accounting, local owned commit. No environment/setup rebuild. Windows native represents local JS/stdio/journal behavior only.

## Boundary and decomposition

- Normative MCP/Telegram public contract. Reuse pinned design5 URL `https://api.telegram.org/bot<token>/<method>`, POST JSON fixed-origin interception and actual original-call JSON-RPC IDs. No new schema/decision route/private implementation constraints.
- Real external proof remains BLOCKED separately. No complete P3/C3, useful human/assistant acknowledgement, feature or release acceptance.
- Checklist1 NO,2 NO,3 NO,4 YES (eventual P3 combined conclusion),5 NO. Fresh independent namespaces avoid A/B/C/D state dependencies. Request focused combined contract/test-artifact/decomposition owner review via coordination, including the controlled clock fixture and proof limits. Not self-approved.
- Exact C remainder: held flush/install/wake/ack, failed/uncertain append, client UI fault isolation, global401 versus ack403/404/409, rate/transient/abort through the activated consumer.
- Exact D remainder: assembled three-worker normal/partial-start shutdown fences, send-only prompt, valid late drain/fanout, full public prefix/current-ledger/status/retained/refusal/no-echo selection, raw non-object poll envelopes and snapshot-change discrimination where publicly reachable. Private unchanged proofs remain supporting only. No automatic C/D authorization or omission.

## Evidence

### Bounded independent verdict - 2026-11-04

PASS for Packet B assertions. No B split needed. Combined owning judgment remains pending. Production remains `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`, packet baseline `c1b6c1d451556a753258b8589a0401e5dbc291ef`. No source correction, contract change or promotion claim.

Full unfiltered final command: `& $node --test --test-reporter=tap tests/portable-races-p3.test.mjs tests/portable-waiting.test.mjs`, exit0,7/7 PASS,0fail/cancelled/skipped/todo,65784.8155ms. Artifact `.scratch/c3-activation/p3b-final.tap`. New suite4/4, affected existing fixture/PORT-A/B3/3. Syntax checks for all three changed JS paths PASS before execution. This test lane independently reviewed/executed against accepted production. It does not self-approve the normative contract or final combined conclusion.

| Obligation | Executable discriminator and verdict | Scope limit |
|---|---|---|
| Repeated Respond | REPLAY PASS: actual opening/prompt first, re-press exactly cursor-only, one original opening and prompt mapping/copy, unchanged deadline and pending state | No new prompt fanout/late-send proof, D |
| Duplicate/stale | REPLAY PASS: forced batches actually cross the production client despite a higher committed offset. Changed stale approval/rejection cannot resolve pending target. Exact winning update redelivered, cursor occurs once, no second business resolution | Remote replay controlled, not a claim Telegram guarantees replay |
| Retained/terminal | REPLAY/COMPETE/EQUALITY PASS: newer Approve/Reject/Respond and text on accepted, cancelled and expired targets consume cursor only, never reopen or replace outcome. An unrelated request remains pending then accepts Approve | Exact terminal copy/current ledger selection remains D |
| Callback/text/cancel competition | COMPETE PASS: callback-before-text wins approved, text-before-reject wins responded with exact approval-like text. Cancellation-first wins cancelled. Concurrent real public cancellation versus queued Approve/text accepts only approved or cancelled, same ID on cancel and original wait | The concurrent run proves one observed ordering, not exhaustive scheduler interleavings. Existing native serialized-invariant evidence remains supporting |
| Exact equality and expiry | EQUALITY PASS: actual opened requests recovered at deadline-1 remain pending. Positive Approve at deadline-1 records approval. At exact millisecond equality Approve/Reject/Respond/text plus cancellation yield only expired, exact resolved_at and one closure. Earlier approval survives | Broker Date.now controlled, real timers unchanged. Sweep/cancel/update may own expiry. This does not claim every equality expiry was written by the callback path or prove60s elapsed wall time |
| Backlog/restart | BACKLOG PASS: pending at graceful stop, advance clock and enqueue callback/text while stopped. Expiry observed from journal before any new HTTP/MCP/status read. Expiry transaction strictly precedes backlog cursor-only transaction. Original-call explicit retries retain exact expiry/response IDs through two restarts. Fresh post-restart Approve succeeds | Old pre-restart invocation is deliberately closed, not reattached or claimed delivered. No abrupt-stop lock removal |
| Original-call and cursor | All PASS: exact request and original numeric RPC ID/type/text, one durable winner with stable decision on authorized read. Each human winner and its update cursor share exactly one two-mutation transaction. Serial barriers followed by no unmatched frame prove no second response/unsolicited outcome | Journal and public reread support result assertions, not substitutes for them |

### Traceability and evidence reuse

- [Telegram delta](../specs/telegram-approval/spec.md): Durable decisions and single resolution / Duplicate or conflicting decisions / Recover durable state -> REPLAY/BACKLOG. Expiry and cancellation are non-approval outcomes / Deadline has passed / Decision races with closure / Accepted decision awaits delivery past expiry -> COMPETE/EQUALITY/BACKLOG. Responses are instructions only / Respond with approval-like text -> COMPETE. Design5 single-winner writer, repeat Respond and startup-backlog clauses plus design7 proof floor define mechanisms, not new semantics.
- [Waiting delta](../specs/opencode-session-continuation/spec.md): Portable waiting-call outcome delivery / Decision before tool completion / Request closes while the call is waiting / Waiting result is lost but request authority is retained -> all original-call assertions and BACKLOG explicit retry. No enhanced event/assistant-acknowledgement completion asserted.
- Reused [accepted A evidence](03c3j-p3-privacy.md#independent-bounded-verdict---2026-11-04), test blob `e8c8d36ce5d56c47aba88eb026689efef602d162` in accepted packet `c1b6c1d4`, artifact `.scratch/c3-activation/p3a-complete.tap`:3/3 actor/chat/token/role/context/scalar/privacy assertions. Production and that suite unchanged. New opt-in clock/replay/restart callbacks do not run on A's default path. Overlap: valid Respond/Approve/Reject, exact instructions, isolation and no key leaks. Not counted as additional workflows or replayed full privacy matrices.
- Reused [pair correction independent13/13](03c3i-pair-text-correction.md#independent-attempt1-verdict---2026-11-04), accepted production `dae0a47a`, evidence `e5810a98`, artifact `.scratch/c3-pair-text-001/independent.tap`, only unchanged pairing-command classification/assertion scope. Full original PORT-A/B were rerun now because the maintained shared runner changed. Those3 results are executed regression evidence, not merely reused historical PASS.
- Existing native raw/core/replay/prompt proofs are unchanged supporting scope only. No private matrix was copied, no private clock proof labeled assembled transport, no mocked UI fault or lifecycle matrix claimed passed here.

### Provenance and cleanup

- Initial `.scratch/c3-activation/p3b-first.tap`4/4 PASS,61233.5668ms. Review found fixture offset filtering prevented the intended stale payload from reaching the consumer. This was insufficient proof, not a source defect. Added explicit forced redelivery plus actual-batch discrimination, nearest-valid-instant positive and equality cancellation. Revised `.scratch/c3-activation/p3b-complete.tap`7/7 PASS,63941.1611ms.
- Final review added expired terminal inputs, no duplicate-result assertions, atomic winner/cursor checks and pre-readiness journal observation. Final unfiltered run above includes these changes. No failed B command, source defect, suppressed failure or deadline increase. Packet A output-cap failures remain preserved in its own evidence, not reclassified here.
- Final six portable namespaces `spike-o0uoQe`, `spike-NPQTeQ`, `spike-hrnESU`, `spike-ndzIxy`, `spike-BTPZZB`, `spike-1VHO8c` each have setup/assertions/teardown/cleanup-pass in `.scratch/c3-activation/progress.log`. Existing FIXTURE separately asserts managed cleanup and listener release. Maintained teardown proves process-tree absence, run-directory removal and fixture listener rebind/close. Assertion PASS and cleanup PASS are separate.
- Only owned ignored TAP/progress evidence retained. No owned runtime remains, no owner/unknown files removed. Same worktree/branch remains active/retain, next action focused combined review via coordination. C/D, real Telegram, useful human/assistant acknowledgement and release remain unproved. No automatic continuation.
- Post-execution finalization is owned tasks/slice prose only. Executed test/helper/fixture identity and exact gross/structural checks follow below.

- Final charge against `c1b6c1d4`: tests219 + helper/fixture52 + docs73 = **344 gross across5 paths**, below hard600. Executed Git blobs: suite `a1526f417c69be92d4eed03bf448df87c53154bf`, helper `a76c7996ad22cbaf0ce41fdce18f92333b1de0e3`, clock fixture `8c7449599f57adc53dad38dfa26ae30eebedc4e7`. Source/bin/scripts/dependency diff from accepted production empty. Scoped syntax3, local links/anchors9, added ASCII and owned whitespace PASS. Formatter excludes tests/OpenSpec, not claimed formatter-checked. Finalization changes only these owned docs. No whole-change size exception or complete P3 claim.
