# C2c-P2 remaining copy, ledger, expiry and stale-stop breadth

Parent: [tasks](../tasks.md). Authority: [design5/7](../design.md), [durable decisions](../specs/telegram-approval/spec.md). Human success is an exact question and truthful terminal outcome reaching the waiting caller and Telegram user. This packet proves local public-process/client behavior, not Telegram delivery or human receipt.

## Scope and allocation

- Baseline `bf1ae43674ef53282908f5ce09245d8250be64a6`. Accepted primary `239f2de8`, source `8a3b2463`, accepted post-stop review supplied with authorization. One active change worktree/branch `add-telegram-approval-opencode-v2`, path `.worktree/add-telegram-approval-opencode-v2` from project root. Target `main`. No new worktree, production, config or owner-artifact edits.
- Outline before implementation: copy producers and scoped403/404 versus global401, stale actual-client result across returned and acknowledgement, shown-flush/queued-ledger companion, actual60s expiry and restart, post-stop stale captured pair. Forecast450-550 gross lines including helpers and evidence, maximum600. Previous179-line packet excluded from this new baseline, not relabelled.
- Paths: `tests/portable-edits-breadth.test.mjs`, `tests/fixtures/edits-breadth-preload.mjs`, `tests/support/poller-public.mjs`, this slice, `../tasks.md`.
- COPY: public empty-state pairing/prepare/request. Start a second ordinary production worker against the same broker while the first actual send is pending. Both actual clients receive separate accessible Messages and both production writers independently commit tuples using the same durably allocated token. Stop the extra worker before terminal proof. This is controlled producer composition, not a claim that normal serve launches concurrent workers. No seeded mappings, synthetic receipt or adopted unknown tuple.
- STALE: actual client fulfills and continuation is held before the real shown writer. Commit the actual returned producer or public acknowledgement, then release. No stale append/marker replacement, and a fresh exact current edit must commit. FLUSH companion admits shown and holds fsync before invoking public acknowledgement. Observe real writer entry while queued, then require shown commit before ledger transition and a new current edit.
- EXPIRY: observer armed before request creation. Public minimum60s request is created and mapped. No status read, cancellation, clock/deadline rewrite or seeded resolution supplies expiry. Assert autonomous expire commit, original non-approval outcome, exact expired rendering, ordered separate receipts and stable decision after restart.
- POSTSTOP: actual client fulfilled before stop, real public acknowledgement changes pair, stop precedes entry into real shown writer. Stale receipt has no append and no new edit/retry. This is distinct from accepted current-pair post-stop proof.

## Boundary verification and proof limits

Normative public/cross-component contract: design5 ordered per-copy receipts and status concurrency, design7 drain. Actual MCP stdio, protected loopback HTTP, actual fixed-origin Telegram client and real Journal append/fsync/recovery are exercised. HTTPS interception verifies `https://api.telegram.org/botoffline-synthetic-token/<method>`, POST, payload, headers and client deadline. Accessible Message tuples are controlled test responses, not Telegram receipts. No external socket, credential reads or human receipt claim. Existing primary/native invariant evidence is reused only for unchanged scope.

Combined boundary/decomposition/test-artifact owning review is required. Trigger1YES (durable producer state),2NO (isolated disposable baseline),3YES (prearmed observers),4YES (ordered proof chain),5YES (producer composition/barriers). No readiness or full C2 acceptance before review.

## Run sequence and environment

Windows PowerShell with project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`, Node24.22.2. Native represents this Windows process/stdio/storage ordering, not all-OS compatibility. No install/build or live boundary authorization.

1. Syntax all three changed executables, scoped Prettier under existing ignore policy, `git diff --check` and live links before execution. Tests/OpenSpec are formatter-ignored and must not be called formatter-verified.
2. Full unfiltered `node --test --test-reporter=tap tests/portable-edits-breadth.test.mjs`. Outer shell210s, test100s for expiry and28s others. Runner default aggregate24s/work16s, expiry aggregate95s/work85s, readiness/request observation3s. Expiry observer73s and MCP82s are reachable inside85s.
3. Shared runner change only makes unchanged default budgets explicit. Run scoped representative existing primary lifecycle and post-stop cases for default-budget/teardown compatibility. Reuse accepted unmodified full primary27 and post-stop3 scope, not duplicate their matrices.
4. Runner owns setup, resources, teardown, process trees, locks, streams, port rebind and run-directory absence. Progress `.scratch/c1-poller-public/progress.log`. State uses ignored `tests/.artifacts/`, TAP uses ignored `.scratch/c2c-breadth/`. Preserve unrelated state and owner work.

Commands with `$node` bound as above:

```powershell
& $node --check tests/fixtures/edits-breadth-preload.mjs
& $node --check tests/portable-edits-breadth.test.mjs
& $node --check tests/support/poller-public.mjs
& $node node_modules/prettier/bin/prettier.cjs --check tests/fixtures/edits-breadth-preload.mjs tests/portable-edits-breadth.test.mjs tests/support/poller-public.mjs openspec/changes/add-telegram-approval-opencode-v2/tasks.md openspec/changes/add-telegram-approval-opencode-v2/slices/03c2c-p2-breadth.md
& $node --test --test-reporter=tap tests/portable-edits-breadth.test.mjs
& $node --test --test-name-pattern='C2EP-LIFECYCLE|C2EP-POSTSTOP' tests/portable-edits-public.test.mjs tests/portable-edits-poststop.test.mjs
git diff --check
```

## Results

Final executable inputs tested on parent `bf1ae43674ef53282908f5ce09245d8250be64a6`. Source tree `642cece5326c2c482d847d89f01065a4fa3ad849` equals accepted `8a3b24631728a0c3eebddf946401e3e9f70aa6c7`, with no working-tree `src`/`bin` delta. Subsequent finalization changes are owned Markdown only.

| Remaining blocker | New result and exact observation |
| --- | --- |
| Genuine mapped copies | PASS403/404 leave701 unfinished while700 retires/shows. Both copies come from actual production workers/client Messages and committed mappings. PASS401 aborts actual poll and ceases all new Telegram traffic while public local status stays usable |
| Stale returned/ack and flush companion | PASS both actual fulfilled-client results held before writer. Real ledger transition commits before release, no stale append, fresh current edit commits exact receipt. PASS shown fsync holds acknowledgement in serialization, then shown precedes ledger commit and new confirmed edit |
| Public production expiry | PASS actual persisted deadline is exactly60000ms, observer prearmed before create, no reads/cancel until expire commit. Original id42 returns expired/null response, exact expired returned rendering, separate ordered receipts, stable public decision/delivery and no redundant edits after restart |
| Post-stop stale captured pair | PASS actual client fulfills, public acknowledgement commits, stop observed before real writer entry. No stale append/receipt, no new edit/retry, real writer result before storage close |

- Final full unfiltered packet8/8 PASS, exit0,136633.5582ms, zero failed/cancelled/skipped/todo, `.scratch/c2c-breadth/packet-verified.tap`. Initial full packet8/8 PASS,138683.0299ms, `.scratch/c2c-breadth/packet-first.tap`. Intermediate8/8 PASS,136607.9362ms, `.scratch/c2c-breadth/packet-final.tap`, followed stronger exact-receipt assertions, persisted60s check and observer timer/listener cleanup. Final rerun added explicit shown-commit-before-ledger-commit event assertions. No product or assertion failures occurred.
- Scoped shared-runner affected4/4 PASS, exit0,30621.7722ms, zero failed/cancelled/skipped/todo, `.scratch/c2c-breadth/affected.tap`. Primary lifecycle plus both accepted current-pair post-stop cases and injected-failure cleanup diagnostic. Default budgets unchanged. The explicit long-budget option is exercised by the new expiry case, not inherited by existing callers.
- Reused unchanged native core/worker invariants and accepted primary `239f2de8` full27/27 plus post-stop `bf1ae436` full3/3 and affected80/80 by exact source/test scope. No new public floor is counted as reused. Native/core results are supporting proof, not Telegram delivery.
- Separate cleanup PASS12/12 current runs: persisted setup/assertion/teardown/cleanup phases, process-tree and directory absence, adapter streams closed, broker lock absent and listener port rebind. Observer listeners/timers release in finally. No residual owned process, port, lock or run directory. Ignored TAP/progress retained as evidence, unknown spike/state/owner work untouched.
- Cheap gates PASS: syntax3, scoped Prettier ignore policy, whitespace and137 live relative-link targets across owned documents. Tests/OpenSpec were owner-formatted, not formatter-verified. No install, external network, credential read, production/design/spec/config edit, push or publication.
- Lifecycle remains active/retain with test engineering ownership. All four blockers now have maintained executable results, ready for ONE combined owning review. No full C2/live/human/feature/release/archive/merge acceptance. No worktree cleanup authorized.
- Actual new packet338 gross/5 paths against `bf1ae43674ef53282908f5ce09245d8250be64a6`: tests214, fixture52, shared runner4, this slice59, tasks9. Additions plus deletions including blanks and final evidence. Source0. Forecast450-550 was conservative, no split or cap exception needed. Prior accepted179 is outside this baseline and unchanged.
