# C3 P3 packet A - activated privacy and context

Parent: [tasks](../tasks.md). Authority: [design5 C3 and design7](../design.md), [copy annex](../proposal.md#c3-product-copy-annex), and the capability deltas linked from tasks.

## Goal and pinned scope

Can only the paired human resolve the intended opened request, while malformed or misbound input discloses no outcome and leaves the original calls usable?

- Worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain. Target `main` baseline `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No independent landing or new branch.
- Packet baseline/evidence HEAD `e5810a981d3c647ea88bcdb22aa0416c4767bf10`. Accepted production `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`. Initial source diff from that revision empty. Existing owner/unknown tracked and untracked work preserved, excluded from commits.
- Test-only authority: tests/helpers/fixtures and active tasks plus this slice. Production, design, proposal and capability specs remain read-only. No external network, existing runtime-state/secrets access, installs, remote Git, archive or publication.
- Direct offline proof: actual admitted inputs through the assembled CLI/broker/stdio MCP and intercepted fixed-origin production Telegram client, exact original-call outcome and pending isolation. Journal transaction/cursor and CLI observations are supporting proxies. No private handler substitution or claim of live Telegram/human proof.

## Outline and budgets before writing

Each packet is an internal checkpoint, hard 600 gross additions plus deletions including tests/helpers/docs, measured against its own starting HEAD. These are forecasts, not claims of actual size.

| Packet | Coherent proof and concrete paths | Forecast tests/helpers/docs | Dependency |
|---|---|---|---|
| A, this packet | `tests/portable-privacy-p3.test.mjs`: callback actor/chat/token/message/prompt-role refusals, text actor/context/role refusals, Unicode limits and positive original-call controls. This slice and tasks | 300/0/100 = 400 | Accepted corrected source present |
| B | `tests/portable-races-p3.test.mjs`, test-only clock fixture under `tests/fixtures/`: public exact equality/backlog/restart, duplicate/stale/retained/cancelled/expired, Respond re-press and competing callback/text/cancel/expiry. Existing maintained public runner, no production knobs | 310/130/100 = 540 | Same accepted source, A independent fresh state |
| C | `tests/portable-faults-p3.test.mjs`, existing public runner/fault fixture: positive held-flush/install/wake/ack, failed/uncertain append and client UI fault isolation, global401 versus ack403/404/409, rate/transient/abort. No private mocks relabeled as workflow | 300/170/100 = 570 | Same source, existing journal/client runner |
| D | `tests/portable-lifecycle-p3.test.mjs`, `tests/portable-copy-p3.test.mjs`, maintained runtime/public helpers: actual assembled three-worker normal/partial-start fences, send-only prompt, valid late drain and fanout. Public full prefix/current-ledger/status/retained/refusal/no-echo selection. Raw non-object polling envelopes and snapshot-change discrimination if not reachable via public control | 300/180/100 = 580 | Same source, current runtime/public harness |

Full breadth cannot safely fit packet A's 600 gross boundary. B/C/D are exact outstanding proof obligations, not authorization for new source. Re-estimate/split D if its two independent suites need separate checkpoints. Packet A does not assert immutable snapshot divergence via impossible state surgery. Private snapshot proof remains supporting only until assembled discrimination is supplied.

## Tests and run sequence

1. Windows PowerShell, project Node24.22.2: `$node='../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe'`. Run `& $node --check tests/portable-privacy-p3.test.mjs` and `git diff --check` on owned paths. Tests/OpenSpec are formatter-excluded, no production formatting edits.
2. Full unfiltered `& $node --test --test-reporter=tap tests/portable-privacy-p3.test.mjs`, bounded shell timeout 180s. Each test uses maintained `portable`, existing 55s work/63s aggregate lifecycle and 65s outer bound, persisted progress and guaranteed owned-process/run-directory/listener cleanup. Scratch stays ignored under `.scratch/c3-activation/`.
3. Reuse accepted full PORT-A/B and pairing correction evidence by unchanged revision/assertion scope, not by rerunning unrelated matrices. Review new assertions against current authority and actual output. Record failures before any correction or unrelated continuation.
4. Check local Markdown targets, owned ASCII/whitespace, exact final path scope and gross charge, then commit only the named test and two owned docs. Later docs-only evidence does not change production/test identity.

Native Windows is representative for bounded local JS/stdio/journal behavior. Transport interception is a controlled offline boundary substitute, not a real Telegram endpoint. Test setup creates fresh synthetic state through existing maintained public runner. No managed environment is launched by an ad-hoc foreground command.

## Boundary and review

- Normative MCP/Telegram admission and public-copy contract. Reuse pinned design5 Bot API research and accepted fixed `https://api.telegram.org/bot<token>/<method>` POST JSON interception. Original stdio JSON-RPC public calls remain the outcome boundary. No new production schema, route or private signature is prescribed.
- Real boundary remains BLOCKED pending separate authorization. Useful human/assistant acknowledgement and release remain unproved. No waiver or complete C3 acceptance.
- Decomposition checklist: 1 NO, 2 NO, 3 NO, 4 YES for the eventual combined P3 conclusion, 5 NO. Fresh independent runs preserve setup/proof isolation. Request one focused combined boundary/test-artifact/decomposition owning review through coordination before overall readiness. No nested dispatch.

## Evidence

Execution and actual size follow below. Historical unmatched cleanup records have no identified residual, but retrospective process proof is unavailable. This packet neither repairs nor reclassifies them.

### Independent bounded verdict - 2026-11-04

- **PASS for packet A assertions, overall P3 incomplete.** Production remains accepted `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`, starting evidence HEAD `e5810a981d3c647ea88bcdb22aa0416c4767bf10`. No source fix or normative-contract change. Current owner working copies govern, not stale committed design/spec copies.
- Full unfiltered maintained command in step2: exit0,3/3 top-level tests PASS,0fail/cancelled/skipped/todo,33987.4348ms. Artifact `.scratch/c3-activation/p3a-complete.tap`. Syntax PASS before execution. This verification lane authored and independently reviewed/executed the assertions against already accepted production. Separate owning contract judgment remains pending, not self-approved.

| Obligation | Actual new assertion and verdict | Remaining limit |
|---|---|---|
| Activated callback privacy | CALLBACK PASS:20 table rows across resolve/open routing. Independent actor/chat checks, bot/string/unsafe actor, group/inaccessible/unknown/string-ID message, response-prompt role, cross-request/unknown/uppercase/trailing token and inline/nonobject message. Each has one exact cursor-only transaction and exact generic acknowledgement. Missing ID is silent, serial barrier proves no stray ack. Refused Respond cannot open request B | Immutable snapshot divergence not manufactured by editing state. Terminal retained/refusal privacy remains D |
| Text tuple/context | TEXT PASS:5 unauthorized tuple variants silent.12 paired refusals cover unknown/foreign/question-role/malformed/nonobject context, independently foreign/group context chat, unopened/unknown target, ordinary question-role reply, no-recency fallback and malformed command precedence. Each cursor-only, exact guidance where paired, all three requests pending before controls | Raw whole polling-envelope variants remain D. More command grammar is reused only where current accepted evidence applies |
| Exact public outcome/isolation | CALLBACK/TEXT PASS: original negative numeric RPC IDs preserved, unrelated pending requests remain unchanged, final Approve/Reject/Respond controls match exact request/decision and one durable human winner. Approval-like whitespace/newline text stays responded. Absent-context command succeeds only after opening | Not deadline/race proof or a distinct returned-ledger assertion |
| Scalar/raw input | SCALAR PASS: empty/null/array text, lone high/low surrogate,4097 ASCII/non-BMP scalars, zero message ID and date0 refused. Caption-only and edited input silent.4096 non-BMP scalars (8192 UTF-16 units) returned exactly on original call | Not malformed whole-batch or all-OS proof |
| No echo/capability privacy | TEXT/SCALAR PASS: after a subsequent committed serial barrier, actual sendMessage payloads never echo accepted response text or refused private instructions. Existing public runner scans Telegram/logs/unmatched frames/journal for plaintext generated authority | Full prefix-by-ledger, retained/refusal terminal selection and live/human receipt remain unproved |

### Reuse, overlap and preserved failures

- Reuse [pair correction independent verdict](03c3i-pair-text-correction.md#independent-attempt1-verdict---2026-11-04), accepted source `dae0a47a`, artifact `.scratch/c3-pair-text-001/independent.tap`:13/13 points across6 top-level tests. Original full PORT-A/B, C3-ACT and seven legitimate pairing-text rows plus malformed-intent/challenge discrimination remain unchanged. This is primary original-call/cancellation/restart/parallel/capability-ack proof, not the new P3 matrix. Overlap: mapped/absent-context command success, unknown-context refusal, exact response preservation, pending isolation and no plaintext capability leak. Counts are not added as distinct workflows.
- Accepted native raw/core/prompt-worker proofs remain supporting unchanged scopes only. No parser matrix, private-core negative suite or P2 worker fault matrix was copied here. No claim those discharge activated races, fault ordering or assembled three-worker lifecycle.
- Initial unfiltered run `.scratch/c3-activation/p3a-first.tap`: exit1,2PASS/1FAIL,33407.7332ms. TEXT's original RPC transport closed after repeated unchanged public get reads. First bounded diagnostic `p3a-cap-diagnostic.tap` still hit transport closure. Second `p3a-cap-confirmed.tap` discriminated the maintained harness's explicit65536-byte output fence: failed resource with66623 output bytes. Production was not repaired or reclassified as passing that failed run.
- Test correction removed repeated identical get reads after every refusal, retaining every cursor-only transaction assertion and one complete public pending check before positives. The output ceiling, original-call outcome, exact text and privacy assertions were not weakened. A maintained resource-cap guard remains. Intermediate corrected full run `p3a-final.tap`3/3 PASS,35682.9016ms. Then added four Respond-specific privacy rows and serial no-echo barriers, producing the final unfiltered run above. No unrelated production continuation after a confirmed production defect occurred.

### Cleanup and finalization

- Final three run namespaces `spike-9sWE3T`, `spike-aXZHb6`, `spike-VIsttY` each have setup/assertions/teardown/cleanup-pass in `.scratch/c3-activation/progress.log`. Maintained cleanup asserts owned process-tree absence, run-directory removal and fixture listener rebind/close before test result reporting. Assertion PASS and cleanup PASS are separate. Earlier failed runs also reached maintained cleanup-pass, no historical unmatched record is backfilled.
- Only ignored TAP/progress retained, no owned runtime remains. Existing worktree and branch retained active. No unknown cleanup, external service, deployment, live Telegram or useful human/assistant acknowledgement. B/C/D remain required before complete C3 and owning judgment.
- Finalization after executable verification changes only owned tasks/slice prose. No later source/test/dependency/configuration/baseline delta. Final measurement and structural checks are recorded below.

- Final packet charge against `e5810a98`: tests184 + helpers0 + docs81 = **265 gross across3 paths**, below hard600. Test Git blob `e8c8d36ce5d56c47aba88eb026689efef602d162` identifies the executed final test artifact. Affected links/anchors5, owned ASCII and whitespace PASS. Tests/OpenSpec are formatter-excluded, formatter invocation adds no behavioral proof. No whole-change size exception or complete P3 claim.
