# Pure live plan packet - submitted for combined owner review

Parent: [tasks](../tasks.md). Controller and live acceptance: [runner contract](03c3r-portable-live-runner.md). This is the authoritative consuming brief for the implementation-owner private selection. It adds no application contract. The advisory binding report is not an authority or an approval.

## Scope, identity and proof

- Preparation baseline `3a955c0fba3a2bbe6fac9b0cbb578bf0aeb5e6e5`, existing branch/change `add-telegram-approval-opencode-v2`, worktree `.worktree/add-telegram-approval-opencode-v2`, target `main`, original base `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. Test-engineering lifecycle owner, blocked/retain pending combined review. No cleanup route is due.
- Goal: deterministic executable decisions for validation, sanitized contexts, absolute deadlines and outcomes. New `tests/live-lifecycle-plan.test.mjs` only. No fixture extraction or changes to existing controller tests. Future source `tests/support/live-run-plan.mjs` is NOT implemented in preparation. Its sole consumer will be `tests/support/live-run-lifecycle.mjs`.
- Founder-visible question remains whether a consenting human can pair, see the harmless question, Approve and receive the exact original waiting-call result plus matching acknowledgement. Pure assertions are direct proof only of these private decisions and enabling proxy evidence for that question. They prove no timer enforcement, listener disposal, cancellation cleanup, physical containment, wire, human or public behavior.
- Existing controller contract stays file-bound: `withLiveLifecycle(plan, driver, options)` resolves exactly `{assertion, cleanup, retained, code}`. Pure GREEN cannot satisfy any controller test. No live/public driver until complete orchestration AND caller cancellation are independently verified. Then B still needs physical/protocol tests, owner review and separate live authority.

## Selected representation

Exactly 13 interface members: constants `LIVE_PORT = 43189`, `RUN_ID_PATTERN = /^live-[a-z0-9-]{1,40}$/` without flags, and the 11 functions below. No additional interface is required. No application import or dependency on this test-only source is permitted.

All functions are deterministic and effect-free, including import: no environment/clock read, IO, network, timers, listener, abort or caller mutation. All created object outputs are deep-frozen. Driver and signal references, plus context signal/environments, preserve identity without copying, freezing or mutating foreign referents. No signal state/reason inspection. Unknown permitted fields are never read.

Plain objects have Object.prototype or null prototype, no own symbols or accessors. Inspect own descriptors, never invoke getters. Reject arrays, functions, instances and boxed primitives. Validators are total over their untrusted value, including primitives and cycles, and never throw for it. Trusted auxiliary arguments and builders instead use the fixed TypeError table below.

| Function | Complete accepted input and output |
|---|---|
| `validatePlan(value)` | Own keys only worktree/runId/candidate/port/environment/limits and optional authorization. First six required. Authorization value ignored. Worktree is nonempty, absolute, resolved exactly and NUL-free. Run ID matches the constant. Candidate is 40 lowercase hex. Port is strictly43189. Environment is plain, only present PATH/PATHEXT/SystemRoot/WINDIR/COMSPEC values are examined and must be strings. Other own string data keys are ignored/dropped. Limits must validate. Success value has exactly worktree/runId/candidate/port/directory/state/limits/environment. Directory is path.join(worktree,'.scratch','portable-live',runId), state its 'state' child. Limits and safe environment are new frozen copies. No authorization survives. |
| `validateLimits(value)` | Exactly totalMs/setupMs/runMs/cleanupMs/gracefulMs/forceMs, each positive safe integer. setup+run+cleanup <= total, graceful+force < cleanup. Success is a new frozen six-key copy. |
| `validateAuthority(value, plan, nowEpochMs)` | Exactly live/credentialAccess/consumeUpdates/exclusiveBot/noWebhook/privateHuman/runId/port/candidate/expiresAt. Six flags strictly true, binding exactly plan, expiry finite and strictly greater than finite epoch now. Success value null. Plan must be frozen sanitized eight-key plan. |
| `validateDriver(value)` | Plain object, own data function methods preflight/reserve/acquireCredential/setup/execute/stop/forceStop/verifyStopped/progress, all nine required. Extras allowed but not called. Async identity is not checked. Success value is original unfrozen driver. Controller must catch synchronous throws. |
| `validateOptions(value)` | undefined/null options or empty plain object or undefined signal -> success value `{signal:null}`. Otherwise only own signal key, actual AbortSignal by identity. Explicit `{signal:null}` invalid. Inherited/symbol/accessor/unknown keys invalid. Pre-aborted signals valid here without state read. |
| `buildEnvironments(plan, token)` | Frozen sanitized plan, nonempty string token. Frozen container exactly broker/cli/mcp, distinct frozen objects. All roles copy safe plan environment plus TEMP/TMP/TMPDIR = plan.directory. Only broker adds PROCEED_TELEGRAM_BOT_TOKEN. No ambient inheritance. |
| `buildContext(plan, spec)` | Frozen sanitized plan. Plain spec only deadline/signal/optional environments. Finite deadline and actual AbortSignal required. Optional environments exactly broker/cli/mcp of frozen plain string-valued objects. Frozen result exactly directory/state/port/candidate/deadline/signal plus environments only if supplied. Deadline unchanged, signal and environments by identity. Only setup receives environments from the controller. |
| `workDeadline(phase, limits, originMono, nowMono)` | Phase setup or run, frozen validated limits and finite times. setup -> origin+setupMs. run -> min(now+runMs,origin+setupMs+runMs). Returns absolute number. |
| `cleanupWindows(limits, cleanupStartMono, originMono)` | Frozen validated limits and finite times. Returns frozen `{startMono,endMono,graceful,force,verification}` with nested `{startMono,endMono}`. End=min(start+cleanupMs,origin+totalMs). Graceful starts at start and ends min(start+gracefulMs,end). Force starts at graceful end and ends min(forceStart+forceMs,end). Verification starts at force end and ends at end. |
| `progressDeadline(phase, window, nowMono)` | Phase setup/run/teardown/complete, plain exact finite startMono/endMono window with start<=end, finite now. budget=min(1000,max(1,floor((end-start)/10))). waitMs=0 if end-now<=0, otherwise min(budget,end-now). Frozen result exactly `{waitMs,endMono:now+waitMs}`. Zero means persist/await nothing, not a zero timer. |
| `resolveOutcome(facts)` | Plain exact six keys validationCode/cancelled/reserved/work/progressFailed/cleanup. Fixed domains, invariants and first-match table below. Frozen result exactly assertion/cleanup/retained/code. retained always equals reserved. |

Validator result wrappers are frozen, exactly `{ok:true,value}` or `{ok:false,code}`. Failure codes: plan/limits INVALID_PLAN, authority INVALID_AUTHORITY, driver INVALID_DRIVER, options INVALID_OPTIONS. No diagnostics or secret data. A synthetic credential may occur exactly once in environments.broker.PROCEED_TELEGRAM_BOT_TOKEN, hence setup only, never sanitized plan, other contexts, windows, outcomes or errors.

| TypeError condition | code | Exact message |
|---|---|---|
| Unvalidated plan to authority/environments/context | UNVALIDATED_PLAN | plan must be the frozen object returned by validatePlan |
| Invalid authority auxiliary epoch | INVALID_BUILD_INPUT | nowEpochMs must be a finite number |
| Invalid environments token | INVALID_BUILD_INPUT | token must be a non-empty string |
| Invalid context spec shape/deadline/signal | INVALID_BUILD_INPUT | invalid context spec |
| Invalid supplied context environments | INVALID_BUILD_INPUT | invalid environments |
| Unknown work/progress phase | INVALID_BUILD_INPUT | unknown work phase |
| Unvalidated limits to work/cleanup | INVALID_BUILD_INPUT | limits must be the frozen object returned by validateLimits |
| Nonfinite monotonic argument | INVALID_BUILD_INPUT | monotonic arguments must be finite numbers |
| Invalid progress window | INVALID_BUILD_INPUT | window must be {startMono, endMono} with finite startMono <= endMono |
| Invalid outcome shape/domain/invariant | INVALID_BUILD_INPUT | invalid outcome facts |

All *Mono values/deadlines are caller-owned monotonic absolute millisecond instants, possibly fractional, not durations or epoch. Authority epoch never mixes with monotonic time. Inside origin <= cleanupStart <= origin+setup+run, full cleanup reserve follows from validated limits. Arbitrary later finite starts clamp, with no positive-width promise. No per-method setup restart. Stop/force/verification contexts use respective segment ends and fresh independent signals. Progress owns setup/run phase, graceful for teardown and verification for complete. These are controller obligations, not pure execution proof.

## Outcome facts and exact precedence

Domains: validationCode null or INVALID_PLAN/INVALID_AUTHORITY/INVALID_DRIVER/INVALID_OPTIONS. cancelled/reserved/progressFailed booleans. work null/ok/refused/failed/timeout. cleanup passed/failed/not-needed. Refused covers preflight false/throw/timeout. Failed includes pre-reservation progress stalls. Reserved means reservation ATTEMPTED, not successful. Cancellation observed before settlement includes teardown and complete progress.

Invariants: cleanup not-needed iff !reserved. Refused implies !reserved and !progressFailed. Ok implies reserved. Null work implies validationCode nonnull or cancelled. Nonnull validationCode implies !reserved. Any violation throws, no defaults or unmatched fallback.

| First matching condition | assertion | cleanup | code |
|---|---|---|---|
| validationCode nonnull | blocked | not-needed | validationCode |
| cancelled, !reserved | blocked | not-needed | CANCELLED |
| cancelled, reserved, failed cleanup | failed | failed | CANCELLED_CLEANUP_FAILED |
| cancelled, reserved, passed cleanup | failed | passed | CANCELLED |
| !cancelled, failed cleanup | failed if work failed/timeout or progressFailed, otherwise passed | failed | CLEANUP_FAILED |
| !cancelled, progressFailed | failed | fact | PROGRESS_FAILED |
| !cancelled, refused work | blocked | not-needed | PREFLIGHT_BLOCKED |
| !cancelled, failed work | failed | fact | WORK_FAILED |
| !cancelled, timeout work | failed | fact | WORK_TIMEOUT |
| !cancelled, ok work | passed | passed | OK |

Validation short-circuits plan -> authority -> driver -> options -> pre-aborted check before effects/listeners. Pre-aborted valid input is blocked/not-needed/false/CANCELLED. Cancellation cannot abort/skip/re-enter cleanup or erase its independent verdict. Abandoned effect fulfillment AND rejection must be observed and fenced by the controller. Late work never resumes scheduling or changes settled results. No raw errors/reasons/private values enter outcomes/progress. Existing controller tests remain unchanged and mandatory.

## Execution, traceability and sequential review sizing

Windows PowerShell, project-local Node24.22.2 (`../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`). Bounded offline native commands only. Run syntax first, scoped git diff --check, ASCII and local links. Prettier file-info establishes applicability, excluded paths are not formatter-PASS. Then `node --test --test-reporter=tap tests/live-lifecycle-plan.test.mjs` with outer30000ms. After source exists, syntax-check it and independently verify pure assertions plus purity review. Then full non-CANCEL controller suite after orchestration, full unfiltered suite after cancellation, each outer30000ms. No service or installation.

PURE-PLAN/VALIDATE/LIMITS/AUTHORITY map runner authorization/fresh-state prerequisites. DRIVER-OPTIONS/CONTEXT map design3 privacy and selected private isolation. DEADLINES/PROGRESS/OUTCOME map runner bounded work/teardown decisions and fail-closed prerequisite for design6/7 and Telegram acceptance. CAL-PURE calibrates strict oracles only. Runnable proof is assertions/exit status, not this table. [Public and real-boundary gates](03c3r-portable-live-runner.md#boundary-verification-and-review-gate) and [canonical live prerequisites](03c3q-p3-remaining.md#next-real-telegram-prerequisites---preparation-only) remain intact.

- Safe split: pure decisions first, then effect scheduling without caller cancellation, then caller bridge, then physical/public driver. Each consumes a pinned independently verified predecessor on this one branch/PR. No hypothetical base is readiness. No partial live promotion.
- Proposed source split: `tests/support/live-run-plan.mjs` ceiling200 gross for pure decisions, `tests/support/live-run-lifecycle.mjs` ceiling200 for orchestration. Caller bridge later modifies that controller, ceiling120. Aggregate A-i proposal400. Original aggregate200 proposal remains unchanged pending renewed owner review. Advisory80 pure allowance is NOT approved authority. New ceilings are proposals, not implementation permission or demonstrated fit. Return owner feasibility conflict, never compress unreadably or omit safety to fit.
- Pure packet ceiling590 gross. Complete forecast is actual preparation below + source200 + remaining verification/correction room, bounded by590. Orchestrator ceiling590: source200 + tests/fixtures220 + docs/tasks/evidence100 + correction70. Cancellation ceiling590: source120 + tests/fixture180 + docs/tasks/evidence70 + correction40 =410 forecast. B ceiling590: source300 + tests180 + docs/tasks/evidence90 =570. All include shared-path edits and evidence. Re-pin actual bases before dispatch, measure actuals against each base. File separation alone is not a review split.
- Historical preparation304 + correction353 =657 sequential gross remains separate, cumulative prior surface627. No ancestor reclassification or extraction discount. Existing suites were not moved/deleted. Whole-change review remains separate and not excepted by these internal checkpoints.
- Decomposition triggers 1YES (pure results consumed by controller), 2YES (later clean namespace), 3YES (later waiter before choice), 4YES (split safety chain), 5YES (later shared setup/proof state). One combined owner safety/decomposition/test-artifact review is required before readiness. This seam is private/test-only, no new wire or normative public contract. Controller/live boundary block still applies to dependent work. Missing return/error schema blocker is resolved in this submitted brief, not an approved implementation gate.

## Preparation evidence

- Entry confirmed once at the preparation baseline above. Existing controller test/fixture are unchanged at that revision. Other-owner and unknown dirty/untracked artifacts remain untouched. No concurrent Git writers authorized. New source remains absent, source implementation actual0.
- Windows project Node24.22.2, pure command exit1:10 top-level tests,1 calibration PASS,9 RED,0 cancelled/skipped/todo,82.9207ms. All nine failures independently classified ERR_MODULE_NOT_FOUND for live-run-plan.mjs. TAP `.scratch/live-pure-preparation/red.tap`, blob `ed26569f801113f1bab1a882b8790c34c82ffab4`. Downstream pure assertions remain unexecuted/BLOCKED, not passed by RED.
- Unchanged controller command exit1:26 tests,2 calibration PASS,24 missing-controller import RED,0 cancelled/skipped/todo,100.7257ms. TAP `.scratch/live-pure-preparation/controller-red.tap`, blob `a3b73e5d0a36b82366bd8bef45b643d557de4ab0`. Existing safety obligations remain unproved. Neither suite supplies live acceptance.
- CAL-PURE accepts the exact frozen combined cancellation/cleanup-failure outcome and rejects extra disclosure keys, changed cleanup and an unfrozen wrapper. It proves only oracle sensitivity. Pure tests exhaust the finite outcome fact product, including invariant rejection and all12 result codes, when source is implemented. No substitute implementation or permissive stub was authored for calibration.
- Syntax1/1 and scoped whitespace PASS. Added prose/test ASCII4 and introduced local links/anchors7 PASS through the retained offline audit. Prettier reports test and new slice ignored, not formatter-PASS. Existing application/helper inputs were not changed, no unrelated suite replay. Later owned evidence finalization changes Markdown only.
- Cleanup: native test processes exited, calibration controller timers/listeners settled as retained tests prescribe. Pure suite creates no timer/listener/resource. No owned service, worker, listener, credential, state namespace or external side effect was created. Only ignored task-local audit/TAP evidence retained. Owner/unknown scratch and active worktree preserved, physical cleanup not due.
- Actual preparation against `3a955c0`:311 gross across4 owned paths = new tests213 + new slice93 + tasks3 + controller navigation2. No moved/deleted test or fixture and no source. Complete pure forecast311 + proposed source200 + future verification/correction60 =571, below packet ceiling590 and hard600. Historical657 sequential ancestor preparation remains separately charged, never relabeled or subtracted. Future implementation actual0 and no source fit approval implied.
- Recommendation: combined owner review of this packet and the linked controller split. Missing return/error schema is no longer the preparation blocker. Review, aggregate source-ceiling disposition and independently verified implementation dependencies remain blockers. No implementation dispatch, public/live driver, network, secret/runtime-state read, install, push, PR, archive, merge or readiness claim.
