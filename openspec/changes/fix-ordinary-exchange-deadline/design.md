# Ordinary Exchange Deadline - Design

## Context

The [proposal](proposal.md) corrects an internal budget allocation inside the existing
[automatic broker availability](/openspec/specs/opencode-session-continuation/spec.md#requirement-automatic-broker-availability-for-normal-mcp-use)
behavior. It changes no capability requirement. `skip_specs: true` is consistent with that scope, and the
reason is recorded under "Spec applicability" below.

Read-only trace at baseline `daf0cf49d4782597b0c5e485165441fdcc6565ae`:

- `src/http/local-client.js` already gives one exchange one absolute budget through `exchangeDeadline`,
  spends that same remainder on the protected-record comparisons, TLS and HTTP, refuses any phase whose
  remainder is spent, and tears down the owned socket, HTTP agent, timers and abort listener. That
  accounting is correct and is not redesigned here.
- `src/cli/main.js` passes a fixed 10,000 ms `LOCAL_REQUEST_TIMEOUT_MS` to the four ordinary exchange call
  sites, while `awaitSecureAvailability`, the readiness exchange, `runStop` and the harness operator helper
  already receive a remaining original budget.
- `src/state/ownership.js` `readSecureOwnership` performs path inspection, two `verifyWindowsProtection`
  calls and opened-handle checks per read. Those reads are not cancellable, so two or three of them exceed
  10,000 ms on the affected Windows host without any failure of ownership, key, identity or connectivity.

This change is independently landable against that baseline. It has no stacked parent and no other active
change dependency. The exact contribution of this defect to the reported live failure is inferred from
source plus observed elapsed time, not measured.

## Decisions

### One documented budget per ordinary exchange

The ordinary authenticated local exchange shall receive the remaining time of the deadline its caller
already holds, instead of a fixed 10,000 ms budget created inside that call. The value passed is the raw
remaining time. The existing exchange admission refuses a spent remainder before the first protected read,
and existing timer rounding clamps its own timers, so no new clamp or new deadline is introduced.

| Call site | Ordinary exchange budget |
| --- | --- |
| `runStatus` | Remaining time of one command deadline that starts at command entry after argument validation and before the first state read, valued at the existing `STARTUP_BUDGET_MS` (150,000 ms) |
| `runRetry` | Same as `runStatus` |
| `runPair` | Remaining time of the existing startup attempt, `remainingStartupBudget(attemptStart)` |
| `runMcp` ordinary client | `remainingStartupBudget(attemptStart)` evaluated once when that client is constructed, reused as that client's per-exchange ceiling |
| `runMcp` wait client | Unchanged `LOCAL_WAIT_TIMEOUT_MS` (32,000 ms) |
| `runStop` readiness and shutdown exchanges | Unchanged: readiness clipped to 1,000 ms and the remaining `STOP_BUDGET_MS`, shutdown limited to the remaining `STOP_BUDGET_MS` |
| Readiness in `src/broker/availability.js` and the harness operator helper | Unchanged: both already receive the remaining original active budget |

The adapter case is a deliberate snapshot, not a recomputation. A long-lived adapter has no enclosing
command deadline, so a per-call remainder measured from launch would shrink toward zero and eventually
refuse a healthy exchange. Taking the remainder once at client construction, immediately after the
adapter's own prerequisite reads, gives that client the documented global budget as a finite per-exchange
ceiling and still charges prerequisite time already spent. `status` and `retry` gain no prerequisite timer
and no new classification. Their command deadline only supplies the exchange remainder, and an overrun
prerequisite path therefore ends with the existing fail-closed refusal rather than a new timeout error.

`LOCAL_REQUEST_TIMEOUT_MS` stays defined and stays the default of `createLocalClient` and
`createSecureLocalClient`. No ordinary call site in scope continues to pass it explicitly. Call-site
completeness is part of the design, because a correction that reaches only some callers is incomplete:
`runPair`, both `runMcp` clients and `runStatus` and `runRetry` shall all be corrected in the same change.

### Preserve every guard, comparison and cleanup obligation

The correction changes which budget argument is supplied and nothing else. The following shall remain
exactly as they are:

- The initial protected ownership read, and the stable-record comparisons before TLS, after TLS before the
  Authorization header, and after a readiness response. No read is removed, reordered, cached across a
  call, or satisfied by an earlier result.
- The TLS-PSK profile: `TLSv1.2`, `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`,
  `rejectUnauthorized`, no tickets, no session reuse, disabled renegotiation, and the 1,000 ms handshake
  subcap clipped to the remaining exchange time.
- Expiry and cancellation admission before each phase and after each awaited boundary, the owned-socket
  guard that destroys a live transport during a non-cancellable read window, and the refusal of a late
  result.
- The 64 KiB operator response ceiling, the general client's larger allowance, and the response-size bound.
- Timer clearing, owned-socket destruction, HTTP agent destruction and abort-listener removal on every
  settlement, and secret-free diagnostics and refusal text.
- The existing classification: a failed secure admission or expired exchange stays `BROKER_UNAVAILABLE`,
  a listener that cannot prove the channel stays `BROKER_INSTANCE_CONFLICT`, exit codes and public message
  wording are unchanged, and no plaintext or unauthenticated fallback is added.
- No retry, no second attempt, no fresh budget per phase, and no change to launch-at-most-once, exclusive
  ownership, durable state, expiry, single resolution or the 150,000 ms global startup budget.

`src/state/ownership.js` shall not change. `src/http/local-client.js` is allowlisted but is expected to need
no change, because `secureExchange` and `createSecureLocalClient` already accept and honor a supplied
budget. If implementation finds a required change there, it returns to the delivery coordinator, because a
local-client change would touch the guard and accounting code this design freezes.

### Superseding the earlier fixed per-exchange decision

The archived design of
[add-automatic-broker-startup](../archive/2026-11-07-add-automatic-broker-startup/design.md) records that
the existing "10000 ms local-operation and 32000 ms wait-exchange limits remain separate after
availability". This design supersedes the ordinary local-operation part of that decision only. The 32,000 ms
wait-exchange limit remains. The archived record stays unmodified history, and the supersession is an
engineering decision, not a capability requirement change.

## Boundary and test-fake review

**Verdict: a combined Architect boundary and test-fake review is not required as a gate. Confirmed.** The
test engineering judgment is correct, for three reasons grounded in the code and the current spec:

1. Boundary category is a purely private, implementation-owned seam. The diff supplies a different value to
   an existing parameter. No wire route, URL, TLS profile, key, identity, payload, header placement, public
   error code, exit code or CLI output shape changes. No external platform or source-grounded research is
   involved.
2. The current spec fixes the outer constraint, "within a documented finite startup deadline", and never
   fixes a per-exchange or per-command figure or the split of one deadline across phases. There is therefore no
   public or cross-component contract to review against.
3. The test fake creates no production seam. Module registration happens inside the test, is deregistered
   after it, and substitutes only ownership, credential, configuration, store, `node:tls` and `node:http`
   imports for those two production modules. Production dispatch, `secureExchange`, its deadline
   accounting, its socket guard and its cleanup execute unmodified.

I ran the fidelity check anyway, because a budget is observable through timing. **Verdict on the fake:
approved for focused unit fidelity**, with the limits below.

Faithful and relevant to this defect:

- The defect case drives the real `run(['status'])` dispatch, so the production `runStatus` budget argument
  and the real exchange sequencing are what execute.
- Fake timers plus fake `performance.now()` drive the same absolute-budget arithmetic. `advance()` fires due
  timers created by callbacks, so a deadline reached during a pending non-cancellable read destroys the
  owned socket at the point production expects, and the later result is refused.
- The fake TLS asserts the exact preserved profile: `127.0.0.1`, the configured port, `rejectUnauthorized`,
  `TLSv1.2` min and max, `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1` and the record's PSK. The
  fake HTTP asserts bearer placement and refuses any Authorization byte on a destroyed socket.
- Guard removal is detectable, not masked. The defect case requires at least three protected reads, at least
  33,000 ms charged to the deadline and exactly one `/v1/status` request, so deleting, deduplicating or
  caching a comparison fails the suite. Falling back to the insecure `createLocalClient` also fails, because
  that path performs no ownership read, opens no secure socket, and issues its `http.request` with a URL
  rather than the request options the fake inspects.
- Teardown assertions cover timers, sockets, agents and abort listeners on every case, and both captured
  streams are checked for the synthetic credential and channel key.

Recorded realism limits, accepted as the project's unit-only restriction and not treated as a waiver:

- TLS is reported authorized. No real negotiation, key agreement, native key protection or OS socket
  closure is proven.
- A protected read is one constant clock advance. Real `inspectRecordParent`, `verifyWindowsProtection` and
  opened-handle costs, and Windows scheduling and cancellation behavior, are not exercised.
- The synthetic response is one small chunk, so HTTP framing and the 64 KiB bound are not exercised here.
- Only the CLI `status` call site has an executable assertion. `pair`, `retry` and the adapter's ordinary
  client are verified by diff review in the independent review task, because driving them needs a stdio
  server or live broker run that the unit-only restriction excludes.
- These units are deterministic proxies for the deadline invariant. Real-boundary operation stays UNRUN and
  UNVERIFIED, never waived.

## Spec applicability

`skip_specs: true` is consistent with the current spec meaning. The affected requirement states that
broker-dependent approval calls must wait for verified readiness within a documented finite startup deadline.
The spec fixes no per-exchange or per-command budget, no ten-second figure and no phase division. This change
keeps the documented outer deadline, the occupancy and TLS subcaps, the retry spacing and every admission,
authority and cleanup obligation unchanged, and adds no guarantee. Therefore no requirement, scenario or
acceptance obligation changes, and a delta would invent requirements the product does not have.

Two precise notes so nothing is approved silently:

- **One genuine engineering decision changes, and it is named above**: the archived "ordinary local
  operation stays at 10,000 ms after availability" decision is superseded. That is a design record, not
  capability meaning, so `skip_specs` remains correct.
- **No documentation obligation is created**, because the ordinary exchange budget is not a documented
  operator limit today. The files read for this design (README and CLI usage text) disclose waiting-call and
  client timeout limits, not a local exchange budget, and every public message text stays unchanged. The
  `skip_specs` declaration itself still has to be recorded in this change's `.openspec.yaml`, which is change
  metadata owned by the product author. Until it is, structural validation reports the missing
  no-delta declaration.

## Scope, risks and verification

- Expected production scope is the four ordinary budget arguments in `src/cli/main.js`. The focused unit
  suite and the task definition stay with test engineering.
- Risk accepted by this design: a path that previously failed in about 10 seconds can now fail only after
  the documented budget is spent. Classification, message wording, exit codes and output shape are unchanged,
  so this is a latency-to-failure change, not a contract change.
- Residual risk outside this change: the adapter's waiting exchange keeps its 32,000 ms limit, which is below
  the measured total of roughly 33 seconds of protected reads in one exchange. If field evidence shows a
  waiting call aborting before its outcome, that needs a separate change, because the spec requires the
  documented waiting limit to stay honest and this change's scope is the ordinary exchange. Fixing it here
  would change a documented waiting limit silently.
- Related, already recorded and explicitly out of scope: honest failure classification and README clarity.
- Verification for this change is the focused unit suite plus the related readiness suite, with diff review
  confirming that every ordinary caller received its remaining deadline. This design step ran no command,
  test, broker or runtime operation and establishes no real-boundary readiness.
