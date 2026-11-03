# C2-MESSAGE-409-001 - attempt 0 corrective handoff

Parent: [tasks](../tasks.md). Authority: [design section 5](../design.md), clauses "C2 classification correction - message-method 409", "Evidence and inference" and "Correction boundary and required proof". Source grounding: [Bot API 10.3 research](../research.md#3-telegram-bot-api-103). Product scope: [Telegram approval delta](../specs/telegram-approval/spec.md).

## Goal and boundary

A refused Telegram question send/edit must not stop healthy requests, falsely report success or change a human outcome.
This corrects necessary existing C2 behavior, not C3 activation or a new capability. Existing accepted C2 evidence remains accepted within its original scope. Newly identified message409 proof is pending, not a retroactive rejection of all C2.

- Existing worktree: `.worktree/add-telegram-approval-opencode-v2` from project root, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain.
- Preparation baseline: `2acded565f78caf5a6658243034c53cc70ac2e83`. Accepted presentation `8a3b2463` and breadth `1fca2b17` are present. Target remains `main` at the declared project baseline. One OpenSpec PR, internal corrective commits only.
- Gap: C2-MESSAGE-409-001, attempt 0, OPEN. No source correction attempted. Next owner: implementation engineering through coordination, then independent test verification.
- Only production path authorized for the later correction: `src/telegram/client.js`. No worker/core rewrite. If normal rejection cannot meet existing worker behavior, stop and return the concrete gap.
- Owned preparation paths: `tests/portable-message409-client.test.mjs`, `tests/portable-question-public.test.mjs`, `tests/portable-edits-breadth.test.mjs`, this slice and `tasks.md`.
- Exclude acknowledgement policy implementation, C3 G1/G1b bindings, production changes during preparation, design/proposal/spec/config/README edits, installs, live network, credentials, existing operator state, publication and git delivery beyond the owned local commit.

## Exact source brief

Select only `sendMessage`, `editMessageText`, `editMessageReplyMarkup` for the message409 fallback. Failed HTTP409 and `ok:false,error_code:409` envelopes yield ordinary `TelegramError` with `code:TELEGRAM_REJECTED`, `retryable:false`. Use a fixed redacted message, not platform description. Keep the existing success-envelope admission and do not convert refusal to Message/true success.

Preserve independent HTTP/API401 credential rejection, HTTP/API429 and valid nonnegative integer `parameters.retry_after` rate limiting, server5xx/recognized transport transient classification. Apply those established conditions before the UI409 fallback. Existing classifier reads HTTP409 but not API409 for conflict, reads HTTP401 only for credentials and API429/retry_after for rate limits. The new envelope test deliberately exposes missing API401 precedence. Do not infer correctness from matching HTTP/API status pairs alone.

Keep actual `getUpdates` HTTP409 `POLLER_CONFLICT` fatal poll-consumption behavior. Do NOT globally replace 409 classification or broaden the UI-method set to acknowledgement. `answerCallbackQuery` 403/404/409 generic refusal is the latest separately pinned C3 policy, but implementation remains pending activation. This packet neither implements nor passes that acknowledgement policy. An unchanged legacy acknowledgement classification is not evidence of conformance.

Workers consume their existing rejection path. Actual send failure flushes `telegram.presentation.failed` with `error_code:rejected`, blocks only the request and preserves already-sent copies. Terminal refusal blocks only the tuple, with no retirement/status receipt. Failed retirement MUST NOT unlock status. Existing fixed rejection diagnostic occurs once per block, no raw description/URL/token and no scan/transient retry. Other tuples, polling, local observation, expiry and original calls remain usable. No mapping/business decision/returned/confirmed evidence may be manufactured by failure.

Source forecast: 20-65 gross changed lines. Hard sole-source ceiling: 100 gross additions plus deletions against preparation baseline. Whole preparation + source + independent verification ceiling: 600 gross, no exception. Reserve 40 for independent evidence. Stop before exceeding either ceiling, do not silently expand paths or consume unrelated work.

## Boundary Verification

- Known external boundary, unchanged wire construction: POST `https://api.telegram.org/bot<TOKEN>/<method>`, token in path, JSON body, `ok` envelope. Existing fixed-origin actual-client controls intercept `node:https` offline. No new wire endpoint, auth flow, payload field or fixture interface.
- Project inference, NOT official per-method error guarantee: official research establishes the error envelope and changing `error_code`, not a guaranteed method/status table. A potentially recoverable 409 may conservatively remain blocked until repair/restart.
- Public proof uses maintained `publicPoller` from empty protected state, real pairing/create/cancel/MCP and Journal producers plus actual client. Independent mapped copies use the accepted breadth preload, not seeded tuple receipts.
- Decomposition checklist 1-5: NO new cross-unit obligations, baseline contamination, receiver, split proof chain or fixture/proof split. Reuse unchanged sequential runner and producers. Owner-pinned policy supplies meaning. No new test-only interface/schema/prototype or additional review trigger found. If a material new boundary arises, route one focused review, not all C2.
- Proof: deterministic actual-client classification/redaction and public worker composition isolation/nonreceipt/retirement ordering under controlled responses. Proxy: intercepted HTTPS is not real Telegram TLS/platform/human first use. No live authorization here. Required live/human/feature/release acceptance remains unproved, never waived or passed.

## Executable mapping and order

Windows PowerShell, project-local Node24.22.2: `$node = (Resolve-Path '../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe').Path`. Native classifier is representative of envelope logic. Public runner owns its resources, aggregate setup/execution/teardown deadlines, progress, process trees, locks, port and isolated run directories. No foreground server improvisation.

1. Cheap first, outer30s: syntax-check the three owned test files and source with `& $node --check <path>`. Format command: `& $node node_modules/prettier/bin/prettier.cjs --check src/telegram/client.js`. Tests/OpenSpec are excluded by existing format policy, not a formatter PASS claim. Run scoped `git diff --check` and relative-link checks.
2. Outer15s: `& $node --test --test-reporter=tap tests/portable-message409-client.test.mjs`. MC409 three methods x HTTP/API refusals assert class/nonretryable/redaction. MC409-ENVELOPE asserts independent credential/rate precedence. MC409-CONTROLS preserves actual polling conflict, 401, rate floor and 5xx.
3. Outer120s: `& $node --test --test-reporter=tap --test-name-pattern='C2PP-MESSAGE409|C2EB-COPIES-(409|api409|403|401)|C2EB-STATUS-|C2PP-DISPLAY|C2PP-CREDENTIAL-question' tests/portable-question-public.test.mjs tests/portable-edits-breadth.test.mjs`.
4. After correction, independent execution of steps1-3 plus affected existing client/edit/public controls, not all C2: `& $node --test --test-reporter=tap --test-name-pattern='C2B-CLIENT|E-CLIENT|C2PP-RETRY|C2EP-RETRY|C2EP-CREDENTIAL' tests/portable-question-send.test.mjs tests/portable-terminal-edits.test.mjs tests/portable-question-public.test.mjs tests/portable-edits-public.test.mjs`, outer150s. Any changed test/code/config/baseline requires affected revalidation. No acknowledgement PASS from this command.

## Preparation evidence and limits

Logs, ignored and retained: `.scratch/c2-message-409/client-final.tap`, `public-final.tap`. Node24.22.2, Windows, source unchanged.

- Initial native run: six discriminating refusal failures, existing control passes. HTTP409 produced POLLER_CONFLICT, API409 ordinary refusal leaked platform description.
- Initial public run: 6 tests, 2 PASS/4 FAIL, exit1. Status cases initially stopped at first status admission because the test had not completed both retirements. This was a fixture sequencing error, not production evidence. Corrected to retire both independently produced copies before status, with added healthy status control. Original log `public-red.tap` retained.
- Final native8: 1 PASS/7 expected RED, exit1, zero cancelled/skipped/todo. Six message-method cases distinguish classification/redaction. Independent API401 precedence test is RED. MC409-CONTROLS PASS. A failing assertion blocks later assertions in that case, not implied coverage.
- Final public11: 8 PASS/3 expected RED, exit1, zero cancelled/skipped/todo. HTTP409 send fails awaiting actual failure commit. HTTP409 retirement/status fail awaiting healthy sibling operation because worker receives poller conflict and stops. API409 send/retirement/status composition PASS, healthy status PASS, existing 403 isolation/401 global fence/display/global send401 controls PASS.
- Downstream HTTP409 sibling/once-only diagnostic/nonreceipt assertions remain blocked until correction. API409 composition passes do not override native API409 diagnostic privacy failure. No whole packet GREEN or feature acceptance.
- Final cheap syntax/source format/scoped whitespace and relative-link target checks PASS. Tests/OpenSpec remain formatter-excluded under existing policy. Production diff empty. All other owners' dirty/untracked work preserved and excluded from staging.
- Preparation accounting against `2acded565f78caf5a6658243034c53cc70ac2e83`: 177 gross additions plus deletions across exactly five owned paths, including this final evidence. Source upper100 plus independent evidence reserve40 gives317, below600. Reserved growth is not actual source usage. Final public run's eleven setup/assertion/teardown records all end cleanup-pass in maintained `.scratch/c1-poller-public/progress.log`.
- Assertion status: expected RED, corrective source needed. Cleanup status: maintained runner completed owned process/run/port/lock cleanup even for assertion failures. No unknown state/resources removed. Ignored failure evidence retained. Worktree remains active, no removal or landing claimed.

Next action: route sole-client correction within the ceilings, then independent affected verification. Keep acknowledgement policy for its separately authorized activation. No live/human/feature/release acceptance.
