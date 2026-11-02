# C2b question-send preparation - blocked before authoring

Parent: [tasks](../tasks.md). Authority: [design5/7 C2](../design.md), [Bot API10.3 research](../research.md), [Telegram delta](../specs/telegram-approval/spec.md).

## State and missing inputs

- Goal: a real adapter-created pending request produces the exact Telegram question while its original MCP call stays waiting, then explicit cancellation returns the proper non-approval outcome. Display is not a human decision.
- Baseline `11ef40d1ca7111f5637d609b3b657c5e97ed75c4`. Accepted allocation `789b7f3e` and receipts `39b25f06` are present. Delivery remains one OpenSpec change/worktree/eventual PR, target `main` at `f3854097`.
- Retain project-root `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, status active. Next action obtain the selected private worker binding and complete source forecast through coordination. Cleanup evidence: no resources created or removed, retained worktree not cleanup-ready.
- `src/telegram/portable-presentation.js` does not exist. Repository search found no selected factory/export, worker options, invocation method or lifecycle signatures. Design explicitly leaves private signatures implementation-owned. Do not invent them in executable tests.
- Needed from implementation owner: exact export and constructor/options signature, start/stop return contracts, how a deterministic native test admits/drains a work iteration, and any already-selected clock/wait injection. Supply only existing decisions, not a new public/test-only application API.
- Existing broker bindings are usable: `presentationWork().sends` contains `request_id`, `chat_id`, `callback_token`, `request`, `last_failure_code`. `preparePresentation({requestId})` is serialized and applies due expiry even for an existing token. `recordPresentationSent({requestId,callbackToken,chatId,messageId})` and `recordPresentationFailed({requestId,callbackToken,errorCode})` record actual attempts. Reuse these names, not a fabricated core admission method.
- Client generic code `TELEGRAM_REJECTED` already exists. Current client instead maps all method 403/404 results to `TOKEN_REJECTED`. Send/edit method-aware rejection is requested project policy, not an official Telegram method-to-error guarantee. Confirm the selected code if the implementation binding chooses otherwise. Preserve getUpdates and do not broaden callback-ack classification.
- Gap ID unassigned, correction attempts zero. Next owners: coordination obtains implementation binding/forecast, contract owner only if rejection semantics remain ambiguous. No tests authored, executable RED/calibration evidence or implementation-ready claim.

## Case outline and complete budget gate

Do not grow the packet until the missing binding and source budget are supplied. The supplied210-235 source forecast across six paths is not a measured complete upper bound. A235 source reservation leaves365 gross changed lines for ALL tests, helpers, fixture/stage rebindings and owned docs under600. This arithmetic is a ceiling, not evidence that complete coverage fits.

| Layer | Cases to author after binding | Likely paths |
|---|---|---|
| Native worker plus real Journal | Actual create, prepare flush barrier, exact renderer/three opaque buttons, one in-flight send, serialized eligibility before each attempt, no send for reserved/due/terminal/unhealthy work | New worker contract suite, existing receipt/allocation fixture patterns |
| Message admission | Object and required identity/type validation, positive safe message_id/date, private numeric chat identity exactly matching snapshot, extras grant no authority, truthful closed failures | Same shared worker contract suite |
| Failure/lifecycle | Transient ladder/retry_after, definitive rejection blocked, abort/backoff/late result after expiry or cancel, lost-send uncertainty, mapped suppression and restart-derived work, finite stop and partial-start cleanup | Worker suite plus runtime/public harness |
| Public fixed-origin client | Real adapter-created request, prepare visible at observed send, exact text/buttons/token/target/privacy, original call waiting, real explicit cancel result | New public suite using maintained public waiting runner and HTTPS interception |
| Public faults | Real403 rejection, invalid ok:true Message,429 recovery, actual in-flight signal destruction and no post-stop admission | Same public suite and minimal opt-in method-result scripting |
| Activation rebindings | Approved C2 pairing success, matching /start and CLI help only. Nonmatched onboarding/refusal unchanged, no per-question disclaimer | Existing poller/CLI tests and shared fixtures |

Production inventory to forecast separately: new worker, `src/telegram/client.js`, `src/broker/portable-runtime.js`, `src/telegram/portable-poller.js`, CLI help source and any genuinely necessary sixth path. Existing renderer is reused, not assumed to need edits. Include foundational tests, public/fault tests, all shared-helper consumers and both owned docs. Count gross additions plus deletions against the baseline, including untracked text, without charging unrelated owner changes.

If the complete packet exceeds600, partition complete production plus foundational contracts from a mandatory dependent public/fault packet on the same branch. Neither checkpoint accepts C2. Public proof must not be replaced by a fake-client suite or seeded request. C2c owns real terminal edits and their validated receipts. No fake worker edit success now.

## Boundary Verification and proof limits

- External wire: fixed `https://api.telegram.org/bot<token>/sendMessage`, POST JSON, exact snapshot `chat_id`, complete plain `text`, `reply_markup` from accepted portable renderer. No parse_mode, entities, capabilities, pairing code or authority metadata. Preserve token-path redaction.
- Validate accessible Message before receipt flush. Never infer chat identity from destination. A late valid result records a receipt only, not a decision. An uncertain send may leave duplicate or unauthorized orphan copies. Mapped copies suppress routine resend/restart.
- Offline HTTPS interception exercises the real client request construction and process assembly, not Telegram TLS/API acceptance or human receipt. Native Journal tests prove local ordering only. Actual authorized Telegram and useful human/original-call first-use proof remain blocked and outside this preparation authorization.
- Decomposition triggers:1YES (C2c/C3 consume mappings),2NO (disposable isolated state),3YES (worker and waiter must be active),4YES (native/public proof chain),5NO (public request creation is proof, not a seeded prerequisite). After completion request ONE combined boundary/decomposition/test-artifact review. This outline is not ready for that review.

## Run sequence once the packet exists

Windows PowerShell, retained worktree cwd, existing project-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`24.22.2 only. Native is representative for local Node/Journal/loopback assertions, not other OS or live Telegram. No installs, real credentials, .env, external network or existing-state changes.

1. Syntax on owned runnable files, scoped source Prettier check, scoped `git diff --check` and local links before resource execution. Tests/OpenSpec are formatter-excluded, owner-reviewed, not formatter-PASS.
2. Bounded native worker/client contracts and calibrations, recording expectedRED by assertion and missing implementation, never as acceptance. Reuse unchanged allocation/receipt evidence by revision/assertion scope.
3. Maintained resource runner owns aggregate startup/execution/teardown deadline, persisted progress, reachable inner waits, isolated local fixtures and verified finite process/socket/Journal cleanup. Public faults follow successful foundational admission, not seeded pending requests.
4. After implementation, full new suites plus affected shared-helper/poller/help/runtime consumers. Exact commands/timeouts depend on the selected binding and complete test inventory and are not yet ready.

Preparation checks: Node version24.22.2, scoped whitespace, local links and ASCII prose PASS. No executable test run, expectedRED or calibration result. Owned preparation53gross/2paths (49 new slice lines plus4 tasks additions) against the pinned baseline. Production upper bound unresolved, so no compliant combined<=600 forecast or readiness assertion.
