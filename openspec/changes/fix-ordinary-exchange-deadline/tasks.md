# Tasks

## Outcome and scope

The ordinary authenticated local exchange must reach the configured broker when its protected
ownership reads are slow. Mergeable outcome: the ordinary authenticated local exchange uses the
remaining original startup or command deadline instead of a fixed short per-exchange budget, with
every ownership, key, identity, expiry, cancellation and cleanup safeguard unchanged. One change,
one PR into `main`, archive inside the PR.

- Baseline: `main` at `daf0cf49d4782597b0c5e485165441fdcc6565ae`. No stacked parent, no other active-change dependency.
- Change folder: `openspec/changes/fix-ordinary-exchange-deadline/` on branch `fix-ordinary-exchange-deadline` in `.worktree/fix-ordinary-exchange-deadline`.
- Owner inputs already complete: [proposal](proposal.md), [design](design.md), and the recorded `skip_specs: true` change metadata. `openspec validate fix-ordinary-exchange-deadline --strict` exits 0 with the informational no-delta notice.
- Test engineering owns this file and `tests/ordinary-exchange-deadline.test.mjs` only. Production design and implementation stay with the software engineer, which may update task checkboxes and evidence text in this file and may not change criteria.
- First independently landable increment: this budget correction plus its focused regressions. It is the whole change. It exposes no new state, option or message, so no unexposed foundation slice is planned.
- Nearest landing blocker: the four allowlisted budget arguments, the focused suite at 7 of 7 on the corrected candidate, and independent integrated-candidate review that diff-reviews the three non-executable call sites.

### Founder-visible success and proof class

Founder-visible success: an installed operator's normal `status`, `retry` and `pair` commands and
normal MCP adapter traffic reach the broker they configured and correctly own, instead of failing
after about ten seconds of correct protected reads.

- Direct proof available now: the focused unit suite asserts the deadline invariant through the real `run(['status'])` dispatch and the real secure-exchange sequencing over a synthetic clock, record, TLS socket and HTTP reply.
- Proxy, not proof: every other caller. `runPair`, `runRetry` and the `runMcp` ordinary client have no executable assertion, so their conformance is established by diff review in task 3.1.
- Not established by this change: real Windows protected reads, real TLS, OS socket closure, installed startup, Linux execution of this suite, Telegram delivery, and any working `request_approval` wait on a host whose protected reads exceed 32,000 ms. Those stay UNRUN and UNVERIFIED.

## Approved contract

Supplied by [design](design.md), fixed for implementation. The value passed is the raw remaining
time. Existing exchange admission refuses a spent remainder before the first protected read and
existing timer rounding clamps its own timers, so no new clamp, new constant or new deadline is
added.

| Call site in `src/cli/main.js` | Required ordinary exchange budget |
| --- | --- |
| `runStatus` | Remaining time of one command deadline captured at command entry after argument validation and before the first state read, of `STARTUP_BUDGET_MS` magnitude |
| `runRetry` | Same as `runStatus` |
| `runPair` | `remainingStartupBudget(attemptStart)` of the existing attempt |
| `runMcp` ordinary client (the one without `timeoutMs`) | `remainingStartupBudget(attemptStart)` evaluated once when that client is constructed, reused as that client's per-exchange ceiling |
| `runMcp` wait client (`timeoutMs: LOCAL_WAIT_TIMEOUT_MS`) | Deliberately unchanged, see "Decided exclusion" |
| `runStop` readiness and shutdown exchanges, `awaitSecureAvailability`, readiness exchange, harness operator helper | Unchanged, already budgeted by their own remaining original budget |

The adapter value is a snapshot taken once at construction, not a recomputation per call. A
long-lived adapter holds no enclosing command deadline, so a per-call remainder from launch would
shrink toward zero and eventually refuse a healthy exchange.

## 1. Focused regressions (complete)

- [x] 1.1 Memory-only, Linux-compatible unit suite at `tests/ordinary-exchange-deadline.test.mjs` that drives real production CLI dispatch and real secure-exchange sequencing over synthetic collaborators only.
  - Evidence: module hooks replace only ownership, credential and configuration/store reads for the two production modules, plus the `node:tls` and `node:http` transports for `src/http/local-client.js`, and deregister after the run. Production `secureExchange`, its deadline accounting, its socket guard and its cleanup execute unmodified. No native query, PowerShell, real process, real state, credential or network access.
- [x] 1.2 Record the red baseline for the right reason, at the defect class and the first phase where it bites.
  - Evidence, re-confirmed on this branch: `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 tests, 6 pass, 1 fail. The single failure is `ORDINARY-EXCHANGE: status completes when its protected reads cost the measured 33 seconds`, with exit code 3, stderr `proceed-mcp: the secure broker is not reachable`, `reads=2`, `requests=0`, modelled elapsed 22,000 ms. The fixed 10,000 ms exchange budget expires inside the second protected read.
  - The six passing cases are guard, classification and cleanup preservation assertions, not defect proof.
- [x] 1.3 Satisfiability already shown by a throwaway check in a disposable ignored copy: correcting only the `runStatus` budget yields 7 pass, 0 fail with the same tests and production code. That check patched one call site, so it proved the suite is reachable and satisfiable, not that the correction is complete, and it was never committed.

## 2. Production correction (software engineer)

- [x] 2.1 Give the ordinary authenticated local exchange the remaining original command or startup deadline instead of the fixed 10,000 ms per-exchange budget, in the allowlist below, and change nothing else.
  - Acceptance: `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 pass, 0 fail, 0 skipped. Report the actual counts in the evidence line.
  - A correction that fixes one caller while another keeps the fixed budget is incomplete. All four sites shall be corrected in this one commit series.
  - Evidence: `22da13a94c41f4aff4cfeee5ffff370d8a2776ff` changes one file, `src/cli/main.js`, in 15 insertions and 4 deletions: `runStatus` captures `commandStart` after `noPositionals` and before `commandStatePaths` and passes `remainingStartupBudget(commandStart)`, `runRetry` does the same after its one-request_id argument check, `runPair` passes `remainingStartupBudget(attemptStart)`, the `runMcp` ordinary client passes one `remainingStartupBudget(attemptStart)` snapshot at construction, and the `../http/local-client.js` named import narrows to `LOCAL_WAIT_TIMEOUT_MS`. The `runMcp` wait client still passes `LOCAL_WAIT_TIMEOUT_MS`, no ordinary site still passes `LOCAL_REQUEST_TIMEOUT_MS`, and `src/http/local-client.js`, `src/state/ownership.js`, `src/broker/availability.js`, `src/harness/**`, `tests/**` and the remaining budget constants are untouched. Focused suite after the correction: 7 tests, 7 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo.

  **Production allowlist, exhaustive.** Only `src/cli/main.js`. Four edits, at the `timeoutMs` argument of each ordinary exchange:

  1. `runStatus`, at the `secureExchange` call. Capture a command deadline start after `noPositionals` and before `commandStatePaths`, and pass its remaining time. The natural minimal form is `remainingStartupBudget(commandStart)` with `commandStart` captured at that point, or an arithmetically identical expression. Do not start it earlier than argument validation and do not start it after the first state read.
  2. `runRetry`, same shape, captured after the `retry requires exactly one request_id` argument check and before `commandStatePaths`.
  3. `runPair`, the `secureExchange` call for `/v1/pairing`, using the existing `attemptStart`.
  4. `runMcp`, the ordinary `createSecureLocalClient` construction that has no `timeoutMs` today: pass one `remainingStartupBudget(attemptStart)` snapshot taken at that construction, not a value recomputed per request.
  5. If no ordinary call site still references `LOCAL_REQUEST_TIMEOUT_MS`, narrow the import on the `../http/local-client.js` import line to what remains referenced. That import narrowing is the only other permitted edit in the file.

  **Not permitted:**

  - `src/http/local-client.js`. Allowlisted but expected to need no change, because `secureExchange` and `createSecureLocalClient` already accept and honor a supplied budget. Any required change there touches frozen guard and accounting code and returns to the delivery coordinator before editing.
  - `src/state/ownership.js`, `src/broker/availability.js`, `src/harness/**`, `tests/**`, `proposal.md`, `design.md`, `.openspec.yaml`, `.github/workflows/ci.yml`, README and every other path.
  - The `runMcp` wait client's `timeoutMs: LOCAL_WAIT_TIMEOUT_MS`, the `runStop` exchanges, `awaitSecureAvailability` and the harness operator helper stay as they are.
  - Any new budget constant, clamp, retry, fallback, log line, message wording, exit-code change or refactor. `LOCAL_REQUEST_TIMEOUT_MS` keeps its value and stays the default of `createLocalClient` and `createSecureLocalClient`.

- [x] 2.2 Run the bounded sequence in "Test mapping and run sequence", record the implementation commit and the actual counts, and stop.
  - Acceptance: `node --check src/cli/main.js` exits 0, the focused suite is 7 pass and 0 fail, `git diff --check` is clean, and the diff touches only allowlisted paths.
  - Evidence, on the implementation commit `22da13a94c41f4aff4cfeee5ffff370d8a2776ff` from this worktree, each command bounded to 60 seconds except the suite at 180 seconds: `node --check src/cli/main.js` exit 0, `node --check tests/ordinary-exchange-deadline.test.mjs` exit 0 unchanged, `node --test tests/ordinary-exchange-deadline.test.mjs` exit 0 with 7 tests, 7 pass, 0 fail, 0 skipped. The measured-33-second case, which was the recorded red at the same head's baseline, now passes with three protected reads and exactly one `/v1/status` request. `git diff --check` exit 0. The tracked diff of that commit is `src/cli/main.js` alone. `openspec validate fix-ordinary-exchange-deadline --strict` is UNRUN here, not passed: this worktree has no `node_modules`, so the pinned CLI is absent and installing it is outside the authorized scope. Its last recorded exit 0 covers the change metadata, which this correction does not touch. No `npm test`, discovery, readiness, integration, e2e, build, pack, install, broker, status or state command was run.
  - Do not run `npm test`, directory discovery, the readiness suite, integration, e2e, build, pack, install or any broker, status or state command. Do not edit the tests to fit the implementation. Do not push, merge or archive.

## 3. Independent verification (test engineering)

- [x] 3.1 Record the immutable implementation head and base, inspect the complete changed and untracked set, confirm the production allowlist, and execute the focused suite and static checks independently.
  - Required diff review, because only the `status` call site has an executable assertion: confirm `runPair`, `runRetry` and the `runMcp` ordinary client each received the remaining original deadline, that the `runMcp` ordinary value is one construction-time snapshot rather than a per-request recompute, that the `runMcp` wait client still passes `LOCAL_WAIT_TIMEOUT_MS`, and that no call site in scope still passes the fixed 10,000 ms budget.
  - Required diff review of the invariants in "Preserved safeguards": no guard, comparison, admission gate, ceiling, teardown, classification, exit code or budget value changed.
  - Acceptance: focused suite 7 pass and 0 fail on the verified head, allowlist respected, both diff reviews PASS. Report failures honestly and route corrections through the delivery coordinator.
  - Evidence, candidate head `65698e9602e65ac2bc9287170a0d88bc9f0a5fa4` (code) over implementation `22da13a94c41f4aff4cfeee5ffff370d8a2776ff` from baseline `daf0cf49d4782597b0c5e485165441fdcc6565ae`, all in `.worktree/fix-ordinary-exchange-deadline`, Windows, Node v26.13.0, each command bounded:
    - Executed: `node --check src/cli/main.js` exit 0; `node --check tests/ordinary-exchange-deadline.test.mjs` exit 0; `node --test tests/ordinary-exchange-deadline.test.mjs` exit 0 with 7 tests, 7 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo (117 ms). `git diff --check` exit 0 at the candidate and in the working tree.
    - Reused, not replayed: the recorded red at preparation head (7 tests, 6 pass, 1 fail, exit 3) is cross-confirmed statically, because the removed lines passed `LOCAL_REQUEST_TIMEOUT_MS` (10,000 ms) while the defect case charges 33,000 ms over three protected reads with two reads before the first gate. `tests/authenticated-readiness-deadline.test.mjs` stays reused by revision and artifact at 18 pass: `src/http/local-client.js` is byte-identical to the baseline. Unrelated suites were not replayed.
    - Call-site diff review, PASS on all four: `runStatus` captures `commandStart` after `noPositionals` and before `commandStatePaths` and passes `remainingStartupBudget(commandStart)`; `runRetry` captures the same after its `retry requires exactly one request_id` check and before `commandStatePaths`; `runPair` passes `remainingStartupBudget(attemptStart)` where `attemptStart` is the attempt that already feeds `awaitSecureAvailability`; the `runMcp` ordinary client passes one `remainingStartupBudget(attemptStart)` inside the single `createSecureLocalClient` construction, and `createSecureLocalClient` closes over that argument, so it is a construction-time snapshot rather than a per-request recompute; the `runMcp` wait client still passes `LOCAL_WAIT_TIMEOUT_MS`. The `../http/local-client.js` import now names only `LOCAL_WAIT_TIMEOUT_MS`, no reference to `LOCAL_REQUEST_TIMEOUT_MS` remains in `src/cli/main.js`, and the constant keeps 10,000 ms as the default of `createLocalClient`, `createSecureLocalClient` and `createOperatorLocalClient`.
    - Allowlist: the complete source diff is `src/cli/main.js` alone, 7 hunks, 15 insertions and 4 deletions, all in the budget arguments, the `commandStart` captures, the import line and comments. `src/http/local-client.js`, `src/state/**`, `src/broker/availability.js`, `src/harness/**`, `tests/**` and every path outside `src/` are unchanged versus the baseline, and `tests/ordinary-exchange-deadline.test.mjs` is unchanged since preparation head `351e91ff0dc0cf1065127f779829f5262ec623cb`. No README, status, AGENTS, CI, package, metadata or archive change exists at this head.
    - Safeguard inventory diff review, PASS: ownership and identity validation, the TLS profile, expiry and cancellation admission, the response ceilings, socket, agent, timer and abort-listener cleanup, secret-free diagnostics, error classification and exit codes, and the absence of retry all live in unchanged files or unchanged regions of `src/cli/main.js`; the ordinary change supplies a different value to an existing parameter. `runStop` keeps its own `STOP_BUDGET_MS` deadline with the 1,000 ms readiness subcap and 16,384-byte ceilings, `STARTUP_BUDGET_MS` stays 150,000 ms, `LOCAL_WAIT_TIMEOUT_MS` stays 32,000 ms, the handshake subcap stays 1,000 ms, probe spacing stays 100 ms, and `src/state/**` is untouched.
    - A spent remainder stays a refusal in existing code: `exchangeDeadline` applies its pre-existing `Math.max(1, budgetMs)` window and the first `expired()` gate throws `BROKER_UNAVAILABLE`, so no clamp, constant, retry or classification was added. Observed residual, approved by design rather than a defect: a `status`, `retry` or `pair` invocation whose prerequisite reads consume most of 150,000 ms, and an `mcp` adapter constructed at that point, receive a correspondingly small single-exchange ceiling instead of a fresh 10,000 ms.
    - `openspec validate fix-ordinary-exchange-deadline --strict` is UNRUN at this head, in CI and here, and is not passed. The recorded exit 0 covers the working tree, not commit `65698e9`: that commit contains neither `proposal.md`, `design.md` nor the `skip_specs: true` line, which are uncommitted owner artifacts. The stated reason for leaving it unrun is inaccurate: `node_modules` is absent, yet a global `openspec` 1.15.0, the pinned version, is on `PATH` and no `package.json` dependency provides it, so the step is runnable by its owner and stays a completion gate, not a waiver.
  - CI coverage: `tests/ordinary-exchange-deadline.test.mjs` appears in no explicit file list in `.github/workflows/ci.yml`, so CI will not execute it. The delivery coordinator must either authorize adding that one path to an existing unit step as a test-only config change inside this change, or record landing on the independently executed suite plus green unchanged CI. Not performed here.
  - Working-tree state preserved exactly and not committed by test engineering: `openspec/changes/fix-ordinary-exchange-deadline/proposal.md` (15,659 bytes, SHA-256 `DCEC09CC138AA2C76F3822E9B43A4CDE86BA07E0E171C1B7A5EB4C0CEFDCCF5F`, untracked), `design.md` (13,568 bytes, SHA-256 `81008C6649BD185BC0761C8DEB3339070592894B1B461C0D0B0A646C7A61EE1C`, untracked), `.openspec.yaml` (modified in the working tree only by the owner's `skip_specs: true` line, SHA-256 `76A6EC53392589590FBC0E78155ADE9058BF8E9FEA93868232F1548326F48969`). Their owners must commit them before the PR, and the archive depends on that `skip_specs` line.
- [ ] 3.2 Confirm any later finalization delta is docs-only, or revalidate affected code, tests, dependencies, configuration and baseline.
  - Current state: no post-verification delta exists yet. Any commit that adds proposal, design, `skip_specs` metadata, CI coverage or this evidence file is a candidate delta and is checked here before archive and merge.

## Preserved safeguards

The correction changes which budget argument is supplied and nothing else. Each item below shall
remain exactly as it is, and the focused suite asserts the subset named in brackets.

- All ownership and identity validation: the initial protected ownership read and the three stable-record comparisons before TLS, after TLS before the Authorization header, and after a readiness response. No read is removed, reordered, cached across a call, deduplicated or satisfied by an earlier result. [reads counts and `requests` counts per case]
- Key and TLS profile checks: `TLSv1.2` min and max, `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`, `rejectUnauthorized`, no tickets, no session reuse, disabled renegotiation, and the 1,000 ms handshake subcap clipped to the remaining exchange time. [asserted on every socket]
- Expiry and cancellation admission before each phase and after each awaited boundary, the owned-socket guard that destroys a live transport during a non-cancellable read window, and refusal of a late result. [cancelled-caller, in-exchange-exhaustion and pre-socket cases]
- Response ceiling: the 64 KiB operator bound, the general client's larger allowance and the response-size bound.
- Socket, HTTP agent, timer and abort-listener cleanup on every settlement, refusal paths included. [teardown assertions after each case]
- Secret-free diagnostics and refusal text: no credential, token or channel key in output or in a thrown message. [asserted]
- Existing error classification and exit codes: failed secure admission or expired exchange stays `BROKER_UNAVAILABLE`, an unprovable channel stays `BROKER_INSTANCE_CONFLICT`, public wording unchanged, no plaintext or unauthenticated fallback. [asserted codes]
- No retry, no second attempt, no fresh budget per phase, no new attempt.
- Unchanged global startup budget at 150,000 ms, unchanged 1,000 ms occupancy and TLS subcaps, unchanged 100 ms retry spacing, unchanged `LOCAL_WAIT_TIMEOUT_MS` at 32,000 ms.
- Unchanged durable-state semantics: launch-at-most-once, exclusive ownership, expiry, cancellation, single resolution, pending and timed-out requests granting nothing.
- Unchanged availability, stop and harness operator paths.

## Decided exclusion: the waiting exchange

The `runMcp` wait client keeps `LOCAL_WAIT_TIMEOUT_MS` at 32,000 ms and is deliberately excluded.
The primary spec author ruled it a separate contract change with its own delta, and the coordinator
recorded that decision. It is not an oversight and must not be folded into this correction.

- This change therefore claims no working `request_approval` wait where one ordinary exchange's protected reads exceed the waiting budget. Measured Windows protected reads cost roughly 33 seconds inside one exchange, so on that host a waiting call can still end before its required protected work completes, even after this correction.
- Do not describe this change as fixing approval waiting, and do not let a green focused suite or a merged PR stand for a working wait.
- Recorded follow-up, outside this change and not authorized here: a delta against `opencode-session-continuation` that states what bounds a waiting call and how that bound is disclosed, keeps the preserved obligations unchanged, promises no indefinite wait and claims no automatic resumption or late delivery. It needs that delta rather than `skip_specs`, and its success criterion is a waiting call returning the matching human outcome while the request stays actionable.
- Preserved into that follow-up unchanged: a client timeout does not cancel the durable request, a pending or timed-out request grants nothing, expiry and explicit cancellation return their non-approval closure, failures are never reported as human decisions or successful delivery.

## Test mapping and run sequence

Run from the change worktree with that worktree as the working directory. Each command is bounded to
60 seconds. No wildcard, directory discovery, server, native helper, wire, live broker, state
directory, credential or token access. Run only these.

1. `node --check src/cli/main.js` after the correction, and `node --check tests/ordinary-exchange-deadline.test.mjs` unchanged.
2. `node --test tests/ordinary-exchange-deadline.test.mjs`. Expect 7 pass, 0 fail, 0 skipped after task 2.1. Baseline is 6 pass and 1 fail, and that failure is the defect.
   - Case mapping: the measured-33-second case is the direct modelled proof of the deadline invariant through the real `status` dispatch, requiring at least three protected reads, at least 33,000 ms charged, and exactly one `/v1/status` request. The pre-socket slow read, in-exchange exhaustion, substitution, cancelled-caller and absent-record cases are preservation assertions for the existing guards. The fast-exchange case proves a remaining budget still admits exactly one authenticated exchange.
   - Do not run the suite twice for the same head. One run per changed revision is the record, and a rerun is warranted only after a real input change or a failure.
3. `git diff --check` for whitespace and conflict hygiene on the changed paths.
4. `openspec validate fix-ordinary-exchange-deadline --strict`, expected exit 0 with the informational `skip_specs` notice. Structural validity is not behavioral proof.
5. Do not run `tests/authenticated-readiness-deadline.test.mjs`. It shares `src/http/local-client.js`, which this change does not touch, so its recorded 18 pass at the baseline is reused by revision and artifact. Run it only if `src/http/local-client.js` actually changes, which returns to the coordinator first.
6. Formatting is not applicable to this change's owned paths: `.prettierignore` excludes `tests/` and `openspec/`, the formatter is not installed in this worktree, and CI checks formatting only for `.github/workflows/ci.yml`. Do not bootstrap the formatter and do not format the repository or the archive.

## Boundary verification

Category: no boundary block applies. This is a purely private, implementation-owned seam. The diff
supplies a different value to an existing, already-reviewed parameter. No wire route, URL, TLS
profile, key, identity, payload, header placement, public error code, exit code or CLI output shape
changes, so there is no normative public or cross-component contract delta, no new external
boundary and no delta for a capability author to write. The design records the same verdict on the
test fake, and ran no command or runtime operation to establish it.

- Unchanged wire and admission detail for reference: TLSv1.2 with `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`, three stable-record comparisons, Bearer authority only after them, the 64 KiB operator ceiling, every expiry and cancellation gate.
- Real-boundary proof: UNRUN and UNVERIFIED under the project unit-only restriction. The suite models the clock, the protected read, the transport and the reply.
- Decomposition checklist: all cross-unit triggers are NO. One correction, one shared suite with self-contained synthetic collaborators, no new persisted state, no new receiver, no split proof chain, so no Architect decomposition review is triggered.

## Checks and evidence

Preparation evidence on Windows with Node v26.13.0, each command bounded to 60 seconds:

- `node --check tests/ordinary-exchange-deadline.test.mjs` exits 0.
- `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 tests, 6 pass, 1 fail, the intended red recorded in task 1.2.
- `openspec validate fix-ordinary-exchange-deadline --strict` exits 0 and reports the informational `skip_specs` no-delta notice.
- `git diff --check` is clean.
- No formatter, formatter bootstrap, integration, e2e, renderer, harness, build, pack, install, runtime, broker, status, state, token or global-configuration command was executed in this task-authoring step.

| Stage | Required observation / current state | Failure, owner and trigger |
| --- | --- | --- |
| Pre-merge | Focused suite 7 pass and 0 fail on the corrected candidate, static checks clean, production diff inside the four-site allowlist with no local-client or ownership change, independent diff review PASS for `runPair`, `runRetry` and the `runMcp` ordinary client, wait client still on `LOCAL_WAIT_TIMEOUT_MS`, `openspec validate --strict` exit 0. | Wrong or partial budget correction, a weakened guard, or an out-of-allowlist edit: implementation owner corrects before landing. Any needed `src/http/local-client.js` change: corrected through the delivery coordinator. |
| Pre-merge, CI coverage | `tests/ordinary-exchange-deadline.test.mjs` is not in the explicit file lists in `.github/workflows/ci.yml`, so CI will not run the focused suite. Current state: UNRUN in CI. | Coordinator decision required, owner delivery coordinator: either authorize adding that one test path to the existing unit step, as a test-only config change recorded in the change, or record landing on the independently executed suite plus green unchanged CI. Not an implementation-owner action. |
| Pre-exposure | Not applicable beyond the project's recorded unit-only acceptance. No version, metadata or README change is planned. | If an exposure step is added, its owner records the risk decision in the status log first. |
| Post-deploy | Owner manual verification of installed MCP traffic and a normal `status` command stays UNRUN and UNVERIFIED. Installation and publication do not satisfy it. | The live failure may persist for another reason, including the excluded waiting exchange. Operator verifies after deployment without bypassing guards. |
| Deferred | Real Windows protected reads, real TLS negotiation, OS socket closure, installed readiness, Linux CI execution of this suite, cross-platform runtime and Telegram outcomes stay UNRUN and UNVERIFIED. | Fake-only evidence cannot prove real-boundary operation. Test engineering and the operator revisit when non-unit testing is authorized or CI coverage is decided. |

| Stage | Unrun or waived item | Owner | Trigger to complete |
| --- | --- | --- | --- |
| Deferred | Linux execution of the focused suite (local evidence is Windows Node v26.13.0, primary CI is Ubuntu 24.04 on Node 24.22.2) | Test engineering | CI coverage decision, or the next authorized Linux unit run |
| Deferred | Every real-boundary behavior above | Test engineering and operator | Non-unit testing authorized, or post-deploy manual verification |

## Worktree lifecycle

- Path: `.worktree/fix-ordinary-exchange-deadline`
- Branch and change: `fix-ordinary-exchange-deadline`
- Owner: test engineering
- Baseline: `daf0cf49d4782597b0c5e485165441fdcc6565ae`
- Status: active. Correction implemented at `22da13a94c41f4aff4cfeee5ffff370d8a2776ff`, evidence recorded at `65698e9602e65ac2bc9287170a0d88bc9f0a5fa4`, independent integrated-candidate verification PASS for code and tests at that head. Uncommitted owner artifacts and the CI coverage decision remain.
- Mergeable outcome: ordinary authenticated local exchanges use the remaining original deadline with every safeguard intact, delivered as one PR into `main` with the archive inside it.
- Nearest landing blocker: owner commits for `proposal.md`, `design.md` and the `skip_specs: true` line, the pending `openspec validate --strict` run at the final head, and the delivery coordinator's CI coverage decision.
- Next action: delivery coordinator routes the owner delta commits and the CI coverage decision, then task 3.2 checks the final delta before archive and merge.
- Cleanup evidence: retained for active work. No landing or abandonment route exists yet. Cleanup happens only after the change PR merges, and terminal evidence is recorded outside archived change content.

## Completion signal

- Production edits, push, PR, archive, merge, deploy, publish and cleanup remain with their authorized owners and recorded gates. This task-authoring step performed none.
- Preserve the live broker, protected state, credentials and every other retained worktree.
