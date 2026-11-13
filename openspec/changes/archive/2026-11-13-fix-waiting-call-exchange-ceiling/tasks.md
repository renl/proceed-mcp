# Tasks

Change `fix-waiting-call-exchange-ceiling`, branch and worktree `fix-waiting-call-exchange-ceiling`, baseline `daf0cf49d4782597b0c5e485165441fdcc6565ae`. Parent artifacts: [proposal](proposal.md), [delta](specs/opencode-session-continuation/spec.md), [design](design.md). Delivery is one PR into `main` with the authorized CLI archive inside it. This change is independently landable: no stacked parent, no dependency on the ordinary-exchange correction, no state, migration or public surface.

## Mergeable outcome and landing path

- **Mergeable outcome.** The adapter's waiting client runs an exchange with no product-internal deadline: no exchange, handshake or socket-guard timer exists on that path, so a wait survives protected work slower than any ordinary local duration and returns the broker body, while every admission, refusal, response ceiling, teardown and error classification stays exactly as written.
- **Reachable delivery band on this change alone.** `3R + H <= 10,000 ms`, where `R` is one protected ownership read and `H` the handshake, because the create and registration exchanges inside `request_approval` stay on their ordinary 10,000 ms budget (design, "Contract consistency").
- **Nearest landing blocker.** Independent verification of this branch's integrated candidate must pass before the owner delta review, the authorized CLI archive and the merge. Nothing else blocks.
- **Honest limit of this change.** The user-visible approval symptom measured on the Windows host (protected reads about 11 s each, about 33 s per exchange) persists until the ordinary-exchange correction lands, because those create and registration exchanges still exceed 10,000 ms first and the call returns an error before the wait loop starts. This change must not report that case fixed. It removes the waiting exchange's internal ceiling, which is a different call-site class, and it leaves the ordinary budget untouched.

## Slice

Single slice inside the one change branch. Internal checkpoints are commits, not PRs.

- **Goal.** Two exchange-deadline modes on the local client, with `budget` as the default that preserves today's behaviour byte-equivalently and `caller` selected only by the adapter's waiting client.
- **Worktree.** `.worktree/fix-waiting-call-exchange-ceiling`.
- **Baseline.** `main` at `daf0cf49d4782597b0c5e485165441fdcc6565ae`.
- **Production allowlist, exactly two files.** `src/http/local-client.js` and `src/cli/main.js`. Explicitly not allowed: `src/mcp/execution.js`, `src/mcp/server.js`, `src/broker/*`, CLI `USAGE`, README, `server.json`, `package.json`, proposal, delta, design, baseline specs, status log, `AGENTS.md`, archive.
- **Constraints to preserve.** Ownership and identity validation, key and TLS profile checks (`authorized`, no authorization error, `TLSv1.2`, `PSK-AES256-GCM-SHA384`, no resumed session, `disableRenegotiation`), expiry and cancellation admission, the `LOCAL_LIFECYCLE_BYTES * 64` and `LOCAL_PRODUCT_RESPONSE_BYTES` ceilings, socket, agent, timer and abort-listener cleanup, `LocalRequestError`/`SecureChannelError` codes with their `retryable` mapping and CLI exit codes, no retry added, unchanged `STARTUP_BUDGET_MS` startup gate and durable-state semantics. Only the source of a phase's time limit may change, never a state-based refusal.
- **Test locations.** `tests/wait-exchange-deadline.test.mjs` (new, owned), `tests/portable-wait-unit.test.mjs` (owned, one assertion removed). Runnable tests never live in `openspec/`.
- **Boundary.** Purely private, software-engineer-owned in-process seam inside `src/http/local-client.js`. It carries no wire, no published API (the package exports only `./tui`) and no normative public or cross-component contract, and the design already fixed the mechanism. No Boundary Verification block and no separate Architect boundary review are required; the module's observable contract is asserted here and independent review still applies.

### Executable contract the tests pin

`createSecureLocalClient({ port, lockFile, token, mode = 'budget', timeoutMs, maxResponseBytes })` and `secureExchange({ lock, token, method, path, body, headers = {}, mode = 'budget', timeoutMs, maxBytes, signal })`.

| Rule | Expectation |
|---|---|
| `mode` value set | closed: `'budget'` (default) or `'caller'`. Any other value is refused as `LocalRequestError('INVALID_REQUEST', ...)`. |
| `caller` with a numeric `timeoutMs` | refused at construction as `LocalRequestError('INVALID_REQUEST', ...)`, and refused by `secureExchange` before any protected read. `caller` accepts no duration of any kind. |
| `budget` | unchanged: one absolute budget before the first protected read, `min(LOCAL_HANDSHAKE_TIMEOUT_MS, remaining)` handshake timer, `remaining()` socket guard and HTTP timers, per-phase expiry refusal. |
| `caller` | no exchange, handshake, socket-guard or response timer. The socket guard keeps its abort listener. Settlement is by response `end`, socket or response `error`, transport end, response-size breach or caller abort only. |
| Every phase and ordering | unchanged in both modes, including the initial record read, abort checks, `profileProblem`, `disableRenegotiation`, the record comparisons, the size-limited parse, `releaseGuard()` and `socket.destroy()` in `finally`, `agent.destroy()`, timer clear and abort-listener detach. |
| `LOCAL_WAIT_TIMEOUT_MS` | deleted, comment included. Not raised, renamed or kept unused, and no replacement waiting constant may be introduced. |
| `src/cli/main.js` | `waitClient` built with `mode: 'caller'` and no `timeoutMs`, `LOCAL_WAIT_TIMEOUT_MS` dropped from the import while `LOCAL_REQUEST_TIMEOUT_MS` stays used, and the two comments that describe a longer waiting deadline rewritten to describe the caller-bounded wait: the sentence ending "the waiting call waits on a longer deadline" in the `runMcp` function comment, and the comment "The waiting call keeps its own longer deadline, because one broker poll turnover is slower than an ordinary management exchange." above the `waitClient` construction. |

The seam names and the `INVALID_REQUEST` code are part of the executable contract. If implementation needs a different name or code, return it through coordination instead of renaming silently, and update the tests in the same authorized unit.

## Test mapping

| Unit | Proof |
|---|---|
| T1 local client modes | `tests/wait-exchange-deadline.test.mjs`, 39 tests: `WXD-BUDGET-SCHEDULE`, `WXD-BUDGET-REFUSAL` (4), `WXD-BUDGET-ABORT-HELD`, `WXD-BUDGET-STALLED-HANDSHAKE`, `WXD-BUDGET-DEFAULT` (4), `WXD-CALLER-OUTLIVES` (3), `WXD-CALLER-HELD`, `WXD-CALLER-ABORT` (3), `WXD-CALLER-ABORT-HELD`, `WXD-CALLER-STALLED-HANDSHAKE`, `WXD-CALLER-ADMISSION` (9), `WXD-CALLER-PREABORT`, `WXD-CALLER-CEILING`, `WXD-CALLER-ALLOWANCE`, `WXD-OPERATOR-CEILING`, `WXD-OPERATOR-ALLOWANCE`, `WXD-CONSTRUCTION-TIMEOUT`, `WXD-CONSTRUCTION-MODE`, `WXD-CONSTRUCTION-EXCHANGE`, `WXD-CONSTANT-DELETED`, `WXD-CALLER-NO-DURATION` |
| T1 delta traceability | "Waiting call outlives internal durations" is `WXD-CALLER-OUTLIVES`, `WXD-CALLER-HELD` and `WXD-CALLER-STALLED-HANDSHAKE`. "Return actual outcomes within documented waiting limits" (caller-bounds clause) is `WXD-CALLER-OUTLIVES` plus the construction cases. Preserved closure and non-approval semantics are the budget-mode and abort cases. |
| T2 adapter wiring | No unit test exists in this change's declared boundary for adapter composition, so it is verified statically: module link, deletion grep and a two-file production diff. Installed adapter behaviour stays unverified. |
| T3 run sequence | The three commands below, plus the static checks. |

No prerequisite slice orders these tests: each file is an independent Node process. Run `tests/wait-exchange-deadline.test.mjs` first because it carries the changed behaviour.

## Run sequence and format command

1. `node --test tests/wait-exchange-deadline.test.mjs` must be 39/39 pass. At baseline it is 20 pass and 19 fail.
2. `node --test tests/portable-wait-unit.test.mjs` must stay 85/85 pass.
3. `node --test tests/authenticated-readiness-deadline.test.mjs` must stay 18/18 pass. Unaffected control that also exercises the same hook pattern.
4. Static checks: `node --check src/http/local-client.js`, `node --check src/cli/main.js`, and `node -e "import('./src/cli/main.js').then(() => console.log('linked'))"`.
5. Static production scope: `git grep -n LOCAL_WAIT_TIMEOUT_MS -- src/` returns no match (its exit status 1 is the pass condition), and `git diff --name-only daf0cf49d4782597b0c5e485165441fdcc6565ae -- src/` lists exactly the two allowlisted files.
6. Format command: `npm run format:check`. Not runnable in this worktree because `node_modules/` is absent and installing is out of scope. `tests/` and `openspec/` are `.prettierignore` entries, so only the two `src/` files are in scope for the formatter and must stay conformant to `printWidth 100`, `singleQuote`, `trailingComma: all`, LF. `format:check` therefore stays unrun here and is an owner/CI check at landing, never a passed check.

## Completed by test engineering

- [x] WXD-TESTS-NEW Created `tests/wait-exchange-deadline.test.mjs`, 39 memory-only tests. `registerHooks` substitutes `../state/ownership.js`, `node:tls` and `node:http` for `src/http/local-client.js`, with a fake `performance.now`, `setTimeout` and `clearTimeout` driving an integer fake clock. No file, socket, OS timer, native query or PowerShell. Teardown asserts zero timers, zero live sockets, zero live agents, zero abort listeners and secret-free diagnostics in every case.
- [x] WXD-TESTS-EDIT Removed exactly one line from `tests/portable-wait-unit.test.mjs` in `WAIT-U-CREATE`: `assert.equal(local.LOCAL_WAIT_TIMEOUT_MS, 32000);`. Every other case in that file is unchanged, including `WAIT-U-RECONNECT` and `WAIT-AUTHORITY-001-DUPLICATE`. The `* as local` import stays used by four other lines.
- [x] WXD-TESTS-RED Recorded the deliberate baseline failure, below.

## Implementation tasks

- [ ] T1 `src/http/local-client.js`: add the `budget`/`caller` mode to `createSecureLocalClient` and `secureExchange` per the contract above, keep every `budget` path byte-equivalent in behaviour, refuse `caller` with a numeric `timeoutMs` and every unknown mode before any protected read, and delete the `LOCAL_WAIT_TIMEOUT_MS` export and its comment.
- [ ] T2 `src/cli/main.js`: build `waitClient` with `mode: 'caller'` and no `timeoutMs`, drop `LOCAL_WAIT_TIMEOUT_MS` from the import while keeping `LOCAL_REQUEST_TIMEOUT_MS`, and rewrite the two comments that describe a longer waiting deadline.
- [ ] T3 Run the sequence above and report the exact pass/fail counts, the static check outcomes and any file outside the allowlist that had to change.
- [ ] T4 Implementation evidence for coordination: candidate revision, the three test totals, the two static check results, and confirmation that nothing under `src/mcp/`, `src/broker/`, `USAGE`, README or `server.json` changed.

## Checks

Pre-merge, required now:

- Unit: `tests/wait-exchange-deadline.test.mjs` 39/39, `tests/portable-wait-unit.test.mjs` 85/85, `tests/authenticated-readiness-deadline.test.mjs` 18/18.
- Static: both `node --check` calls, the module link check, the deletion grep and the two-file production diff.
- CI selection: `.github/workflows/ci.yml` must select `tests/wait-exchange-deadline.test.mjs` before merge. It enumerates test files and does not run the `npm test` script, so the changed behaviour has no CI gate today (finding V-1). Owner: implementation and delivery through coordination. The workflow file is outside this change's two-file production allowlist and was not edited by test engineering.
- Review: independent verification of this branch's integrated candidate, then the owner delta review of the modified requirement before the authorized archive and merge.

Deferred, unverified, never counted as passed:

- Real TLS-PSK behaviour, real protected-read cost, installed adapter operation, Telegram receipt and a live outcome reaching a MCP call. Named failure: this change is claimed to fix an installed waiting call without installed proof. Owner: the operator's deployment verification. Trigger: the first authorized non-unit or deployed run after the unit-only restriction is lifted. This single change must not claim that case fixed on the measured Windows host.
- The measured Windows approval symptom itself, which remains failing until the ordinary-exchange correction lands. Owner: that separate change. Trigger: its landing.
- A stopped broker mid-exchange is now surfaced only at the caller's limit. This is the accepted residual of the delta and `AO-7`, not a defect. Owner: product acceptance recorded in the proposal. Trigger: any later proposal to shorten it, which would be a regression.
- `npm run format:check`. Owner: landing/CI. Trigger: the first environment with `node_modules/` present.
- `openspec validate --strict`. Run here and it exits 1 on two warnings inside the delta spec, which this unit does not own. See Evidence. Owner: the delta's declared author through coordination. Trigger: before the authorized archive if the archive or CI gate uses strict mode.

## Evidence

Baseline `daf0cf4`, Node v26.13.0, `node --test tests/wait-exchange-deadline.test.mjs`: exit 1, 39 tests, 20 pass, 19 fail, no unhandled rejection. Every failure is the expected reason:

| Red test group | Observed reason at baseline |
|---|---|
| `WXD-CALLER-OUTLIVES` (3) | The exchange rejects `BROKER_UNAVAILABLE` ("the secure broker did not answer in time") on the first, second or third protected read, because the default 10,000 ms budget expires and the broker is never reached. |
| `WXD-CALLER-HELD` | Same cause: no exchange reaches the broker, so `requests` stays empty. |
| `WXD-CALLER-ABORT` (pre-Authorization), `WXD-CALLER-ADMISSION` (6), `WXD-CALLER-CEILING`, `WXD-CALLER-ALLOWANCE` | The refusal, refusal code and no-Authorization-byte assertions already hold. The failing assertion is `timerCalls === []`: `[1000]` or `[1000, 10000]` are scheduled, proving `caller` is not selected yet. |
| `WXD-CALLER-ABORT-HELD` | `[1000, 10000, 10000]` scheduled while the response is held. |
| `WXD-CALLER-STALLED-HANDSHAKE` | A 1,000 ms handshake timer exists, so a listener that never handshakes is failed by a product timer. |
| `WXD-CONSTRUCTION-TIMEOUT`, `WXD-CONSTRUCTION-MODE` | No exception is raised for `caller` with a numeric `timeoutMs`, and no exception is raised for an unknown mode. |
| `WXD-CONSTRUCTION-EXCHANGE` | `secureExchange` accepts `caller` with a numeric `timeoutMs` and completes the exchange. |
| `WXD-CONSTANT-DELETED` | `LOCAL_WAIT_TIMEOUT_MS` is still exported. |

Green at baseline and required to stay green: `WXD-BUDGET-SCHEDULE` (timers `[1000, 8730, 7530]`, clock 2500, header after three record comparisons, socket and agent destroyed), `WXD-BUDGET-REFUSAL` (4), `WXD-BUDGET-ABORT-HELD`, `WXD-BUDGET-STALLED-HANDSHAKE`, `WXD-BUDGET-DEFAULT` (4, including an explicit 32,000 ms budget that still works), `WXD-CALLER-ABORT` (initial read and pre-TLS), `WXD-CALLER-ADMISSION` (absent record, schema-1 record, replacement before TLS), `WXD-CALLER-PREABORT`, `WXD-OPERATOR-CEILING`, `WXD-OPERATOR-ALLOWANCE`, `WXD-CALLER-NO-DURATION`.

Owned test-only evidence: `node --test tests/portable-wait-unit.test.mjs` is 85/85 pass after the one line removal, and `node --test tests/authenticated-readiness-deadline.test.mjs` is 18/18 pass as the untouched control.

Baseline static state, captured here so the after-change expectation is unambiguous:

- `git grep -n LOCAL_WAIT_TIMEOUT_MS -- src/` currently matches three lines: `src/cli/main.js:34` (the import), `src/cli/main.js:765` (`timeoutMs: LOCAL_WAIT_TIMEOUT_MS`) and `src/http/local-client.js:49` (`export const LOCAL_WAIT_TIMEOUT_MS = 32_000;`). After implementation the same command must match nothing.
- `node -e "import('./src/cli/main.js').then(() => console.log('linked'))"` prints `linked` today, so a stale import of the deleted export is a real link failure rather than an unchecked assumption.
- `git diff --name-only daf0cf49d4782597b0c5e485165441fdcc6565ae -- src/` is empty today.

Structural evidence, CLI-managed OpenSpec v1.15.0:

- `openspec status --change fix-waiting-call-exchange-ceiling`: 4/4 planning artifacts complete (proposal, specs, design, tasks).
- `openspec validate fix-waiting-call-exchange-ceiling`: valid, 1 `MODIFIED` delta parsed for `opencode-session-continuation`.
- `openspec validate --strict`: exit 1 on two warnings inside `specs/opencode-session-continuation/spec.md`, not in this file and not authored by this unit: "Text above the first '## ' section is not carried into the main spec by archive" and "Section '## Direction Check' is not carried into the main spec by archive". Non-strict validation is valid and the parsed delta is correct. The delta's declared author owns the placement decision, and no CI job in this repository invokes the validator, so this is a coordination finding rather than a test or tasks defect. It was not edited here.

## Independent verification of the integrated candidate

Verdict: PASS on the unit and static evidence available, with three delivery findings that are not production defects. No production defect was found in the two changed files.

Candidate `70d324e34c211fec31c3b80e53a1417c956346f8`, branch `fix-waiting-call-exchange-ceiling`, base `daf0cf49d4782597b0c5e485165441fdcc6565ae`, Node v26.13.0. Memory-only unit and static checks only, on explicit paths. No integration, e2e, build, pack, install, runtime broker, state, credential or global-config access.

Base relationship: `main` has advanced to `2937ea23a974e47acdb0352a9f71275e31f59b7d` with the separately landed ordinary-exchange correction. This branch does not include it, was not rebased or merged onto it, and keeps `LOCAL_REQUEST_TIMEOUT_MS = 10_000` for ordinary exchanges. That matches this change's independently landable claim.

### Executed in this verification, not reused

| Check | Result |
|---|---|
| `node --test tests/wait-exchange-deadline.test.mjs` | exit 0, 39 tests, 39 pass, 0 fail |
| `node --test tests/portable-wait-unit.test.mjs` | exit 0, 85 tests, 85 pass, 0 fail, after the single removed `LOCAL_WAIT_TIMEOUT_MS` assertion |
| `node --test tests/authenticated-readiness-deadline.test.mjs` | exit 0, 18 tests, 18 pass, 0 fail. Affected control: same module-hook pattern, and it exercises the changed budget-mode client |
| Independent RED check against the baseline module | 39 tests, 20 pass, 19 fail, exit 1. The baseline `src/http/local-client.js` was copied into ignored `.scratch/redcheck/`, run against the same test file, then deleted. The 19 failing names are exactly the recorded red groups: `WXD-CALLER-OUTLIVES` (3), `WXD-CALLER-HELD`, `WXD-CALLER-ABORT` (pre-Authorization only), `WXD-CALLER-ABORT-HELD`, `WXD-CALLER-STALLED-HANDSHAKE`, `WXD-CALLER-ADMISSION` (6 of 9), `WXD-CALLER-CEILING`, `WXD-CALLER-ALLOWANCE`, `WXD-CONSTRUCTION-TIMEOUT`, `WXD-CONSTRUCTION-MODE`, `WXD-CONSTRUCTION-EXCHANGE`, `WXD-CONSTANT-DELETED`. The 20 green baseline cases match the recorded list, so the suite is genuinely red before the fix and green after it |
| `node --check src/http/local-client.js`, `node --check src/cli/main.js`, module link import | exit 0, 0 and 0, link prints `linked` |
| `git grep -n LOCAL_WAIT_TIMEOUT_MS -- src/` | exit 1, no match. Deleted, not renamed or kept unused |
| `git grep -n "32_000\|32000" -- src/` | exit 1, no match. No replacement waiting constant of the same or any size |
| `git diff --name-only daf0cf4 70d324e` | exactly `src/cli/main.js` and `src/http/local-client.js` |
| Untouched-scope diff over `src/mcp`, `src/broker`, `src/cli/usage.js`, `README.md`, `server.json`, `package.json` | empty |
| `openspec validate fix-waiting-call-exchange-ceiling` | valid, exit 0, one `MODIFIED` delta parsed |
| `openspec validate --strict` | exit 1 on the two recorded warnings, both inside `specs/opencode-session-continuation/spec.md` |
| Format spot check on the two in-scope files | all 100 added lines are 100 characters or fewer, no CRLF. `main.js` has 37 pre-existing lines above 100 that are long string literals outside this diff. `tests/` and `openspec/` are `.prettierignore` entries |

Reused: nothing for pass or fail. SE run counts and the previously recorded baseline counts were not taken on trust. No suite was replayed for a label, and the readiness-deadline suite was run because the changed file is in its dependency path, not as a label check.

Honest limit of this verification: the baseline RED copy proves the tests discriminate, not that the tests cover a real host. Nothing here exercises real TLS-PSK, real protected-read cost or an installed adapter.

### Diff review against the preserved-safeguard inventory

Confirmed in `src/http/local-client.js`:

- Closed mode set and refusals. One `EXCHANGE_MODES` set holds exactly `budget` and `caller`. `assertExchangeMode` refuses an unknown mode and a `caller` mode carrying a numeric `timeoutMs` with `INVALID_REQUEST`. It runs before the protected-record read in `secureExchange` and before client construction in `createSecureLocalClient`.
- No internal duration in caller mode. The three timer sites are guarded: the handshake timer is skipped when `timeoutMs` is `undefined`, the socket guard installs `undefined` when `remainingTime === null`, and the response timer is skipped when `timeoutMs` is `undefined`. Both `expired()` closures keep their signal check and skip only the budget term.
- Guard listener retained. `guardOwnedSocket` still registers the abort listener and returns the same detach, so cancellation still destroys the owned socket in caller mode.
- Teardown intact. `releaseGuard()` and `socket.destroy()` remain in the `finally`, `agent.destroy()` and the abort-listener detach remain in `httpOverSocket`'s `finish`, and both `clearTimeout(timer)` calls tolerate an `undefined` timer.
- Untouched safeguards. `profileProblem` (authorized, no authorization error, TLS 1.2, `PSK-AES256-GCM-SHA384`, no resumed session), the TLS options including `rejectUnauthorized`, `SSL_OP_NO_TICKET` and `disableRenegotiation`, `stableRecord`'s comparisons, the `lock.schemaVersion !== 2` refusal, the pre-abort refusal and the `LocalRequestError`/`SecureChannelError` code pairs are textually unchanged. Both default response ceilings stay `LOCAL_LIFECYCLE_BYTES * 64` and `LOCAL_PRODUCT_RESPONSE_BYTES` stays 65,536.
- Call-site audit. Every other `secureExchange` and `createSecureLocalClient` caller keeps the budget default: CLI pair, status and retry with `LOCAL_REQUEST_TIMEOUT_MS`, readiness and shutdown with their own remaining budgets, `src/broker/availability.js` with its passed budget, `operator-helper.js` with `timeoutMs: activeMs` and `maxResponseBytes: LOCAL_PRODUCT_RESPONSE_BYTES`, and `createOperatorLocalClient` with its 10,000 ms budget and 64 KiB ceiling. Only the adapter's `waitClient` selects `caller`.
- In `src/cli/main.js` the diff is one import line, the two rewritten comments, and `timeoutMs: LOCAL_WAIT_TIMEOUT_MS` replaced by `mode: 'caller'`. `EXIT_CODE`, `channelCliFailure` and the `USAGE` array are outside every hunk. `LOCAL_REQUEST_TIMEOUT_MS` stays imported and used.
- No retry added. The pre-existing `WAIT_RETRY_DELAYS_MS` ladder and its `hold()` sleep in `src/mcp/execution.js` are untouched and predate this change. That delay follows a lost transport, it is not an exchange ceiling, and it was not changed here.
- Startup gate unchanged. `gateClient` only awaits `availability` and adds no exchange timer. `STARTUP_BUDGET_MS` is untouched, so the documented startup window remains a prerequisite gate rather than a waiting bound.

Non-blocking observation, for the implementation owner to decide: `mode: 'caller'` with `timeoutMs: null` is accepted because `null` is not a numeric duration and takes the same no-duration path as `undefined`. This is consistent with "caller accepts no duration of any kind" and no caller passes `null`. It is noted so the choice is deliberate rather than accidental.

### Delivery findings, not production defects

- **V-1 CI selection missing.** `.github/workflows/ci.yml` lists test files explicitly, includes `tests/portable-wait-unit.test.mjs`, and does not list `tests/wait-exchange-deadline.test.mjs`. CI does not run the `npm test` script, so the new proof would never execute as a merge gate. Owner: implementation and delivery through coordination. Required before merge.
- **V-2 Strict warnings belong to the delta author.** Both warnings are inside `specs/opencode-session-continuation/spec.md`: the summary text above the first `## ` section and the `## Direction Check` section are not carried into the main spec by archive. That file is authored by the capability's declared primary spec author, not by test engineering. The substance already exists in the proposal and design, so the fix is a placement decision by that owner. No workflow step invokes the validator, so non-strict validity is what CI would see. Not edited here.
- **V-3 Change artifacts still untracked.** `proposal.md`, `design.md`, `specs/opencode-session-continuation/spec.md` and `.openspec.yaml` are untracked on this branch. Test engineering commits only its owned tests and this file. The delivery owner must get those artifacts committed into the change PR. They were read and confirmed correct and were not modified.

### Remaining gates after this verdict

1. `T1` to `T4` stay the implementation owner's checkboxes. Each is confirmed above and the owner records its own evidence and ticks them.
2. CI selection for the new suite (V-1), and `npm run format:check` in an environment with `node_modules/`.
3. Owner delta review of the modified requirement by the declared spec author, after V-2 is settled by that owner.
4. Authorized `openspec archive` inside the PR, then the merge. Deployment, installed operation, Telegram receipt and a live wait on a slow host stay unverified.

### Honest limits of the change itself

- This change alone does not deliver a working approval wait on a host whose ordinary request-create or registration exchanges exceed 10,000 ms. On the measured Windows host, where one exchange costs about 33 s, the call can still fail before the wait loop starts. The user-visible symptom persists there until the ordinary-exchange correction is part of this branch's baseline. `AO-10` is met by disclosure, not by behaviour.
- A broker that stops responding mid-exchange is surfaced only when the caller's own limit arrives. That is the accepted residual of `AO-7`, not a defect.
- Unit and static proof only. Real TLS-PSK behaviour, real protected-read cost, installed adapter operation and Telegram delivery were not run and are not passed.

## Worktree lifecycle

- Path `.worktree/fix-waiting-call-exchange-ceiling`, branch `fix-waiting-call-exchange-ceiling`, change `fix-waiting-call-exchange-ceiling`, owner test engineering, status active.
- Next action: independent verification passed on candidate `70d324e` with findings V-1 to V-3. Coordination returns the modified requirement to its declared author for delta review, has CI select the new suite, and has the remaining change artifacts committed. Then the authorized archive and the single PR merge. No cleanup yet.
- Cleanup: not due. Evidence at creation is the branch point `daf0cf4` and this change folder; no merged or abandoned ending exists yet.
