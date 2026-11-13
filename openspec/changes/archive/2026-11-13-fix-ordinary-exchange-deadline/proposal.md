## Why

After a supported preview.6 installation, the adapter still fails, one step later than before. The operator's setup is working. The protected broker is running, correctly owned and correctly configured, yet ordinary local use refuses it.

The observed manual failure, recorded in the project status log: a maintained `status` run returned `BROKER_UNAVAILABLE` after 42.7 seconds while broker PID 29232, its parent 12464, port 43189 and ownership instance `da93cd25bcffcdb386aed440e10d5ce3` all remained consistent. A transport-profile or instance mismatch would have classified as `BROKER_INSTANCE_CONFLICT` and was not observed.

Read-only source trace at baseline `daf0cf49d4782597b0c5e485165441fdcc6565ae`:

- `src/http/local-client.js` gives one exchange an absolute deadline and refuses any phase whose remaining time is already spent. That accounting is correct and stays unchanged.
- `src/cli/main.js` ordinary exchanges (`status`, `retry`, `pair`) and the MCP adapter's ordinary client still start a fixed 10,000 ms budget. The preceding readiness path already receives the remaining original deadline, so only the ordinary exchange still starts a short fresh budget inside a call that holds far more.
- Protected ownership reads in that same path are not cancellable and cost about 11 seconds each on the affected host, so two or three of them exceed 10,000 ms without any failure of authentication, ownership or connectivity.

The defect is internal budget allocation. A caller that still holds most of its documented deadline can be refused by a smaller budget created inside that same call. The exact contribution to the reported live failure follows from source plus the observed elapsed time, and is inferred rather than measured.

### Direction Check

- Subject: the operator and their agents, already on a supported installed setup, against the protected local broker they configured.
- Desired outcome: an ordinary authenticated local exchange (normal MCP use, `status`, `retry`, `pair`) reaches that same broker while the caller still has time remaining on its own deadline.
- Threat or problem: a fixed 10-second per-exchange budget expires inside a call whose real deadline is still open, because slow protected reads that cannot be cancelled are charged to it.
- Confirmation: the change addresses this subject and this threat directly. It gives the ordinary exchange the deadline the caller already holds. It raises no global budget, removes no ownership, key, identity, profile or protection comparison, and does not shift the burden onto the person resolving approvals or onto the harness.

## What Changes

Outcome in one line: the ordinary authenticated local exchange uses the remaining original startup or command deadline instead of a fixed 10-second per-exchange budget, preserving every ownership, key, identity, expiry, cancellation, timeout-classification and cleanup safeguard.

- The affected callers are the MCP adapter's ordinary client and the CLI `status`, `retry` and `pair` ordinary exchanges. A correction that reaches only some of them is incomplete.
- Preserved exactly as they are: the 150,000 ms global startup budget, the 1,000 ms occupancy and TLS subcaps, the 100 ms retry spacing, the exchange-deadline refusal of spent phases, the protected ownership and profile comparisons, the response ceiling, and every expiry, cancellation, single-resolution and teardown obligation.
- Independently landable against `main` at `daf0cf49d4782597b0c5e485165441fdcc6565ae`. No stacked parent and no dependency on another active change. One change, one PR, with the authorized archive inside it.
- This is an exposed correctness fix for existing behavior, not unexposed foundation work. Its user-visible value is that ordinary authenticated local traffic and normal operator commands reach the broker that is actually running and correctly owned. It does not by itself deliver a working approval wait on a host whose protected reads exceed the waiting-exchange budget. That limitation is deliberate and is set out under "Decided exclusion: the waiting exchange" below.
- Excluded on purpose: raising any global budget, weakening or removing any security check, retries or a retry framework, a logging framework, capturing child stdio, changes to provisioning, pairing, state or credentials, public error wording changes, and refactors or live-broker operations.

## Acceptance Outcomes

Implementation-independent and binary. Each is either met or not met, with no partial credit and no alternative interpretation.

- **AO-1 Slow protected reads, owned broker.** GIVEN a configured, safely owned, matching healthy protected broker whose ownership reads take roughly 33 seconds in total, WHEN an ordinary authenticated local exchange runs, THEN it completes successfully inside the deadline the caller already holds. Met only if the exchange completes. The former fixed budget alone does not make it incomplete.
- **AO-2 No safeguard is traded for time.** GIVEN any completed exchange under AO-1, WHEN the exchange is inspected, THEN every ownership, key, identity, profile and protected-record comparison still runs, in the same order and with the same failure classification, and no protected read is skipped, cached across a call, or satisfied by an earlier result. Met only if the safeguard set is unchanged.
- **AO-3 The real deadline still bounds.** GIVEN a caller whose remaining deadline is spent, WHEN the exchange is attempted, THEN it ends with a non-approval failure, no success and no human decision are reported, and no indefinite wait, extra attempt or automatic retry is started. Met only if it ends.
- **AO-4 Budgets are unchanged.** The global startup budget, the occupancy and TLS subcaps and the retry spacing keep their current values. Met only if none is raised.
- **AO-5 Durable and cleanup semantics are unchanged.** Expiry, cancellation, single resolution, timer and socket teardown, agent destruction and non-disclosure of private authority behave as they do today. Met only if all still hold.
- **AO-6 No new surface for the operator.** No new state, configuration, migration, provisioning step, pairing step, credential read, command, option, tool or public message wording is introduced. The path from an empty installation to the first approval interaction is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None at the requirements level. The affected behavior serves [`opencode-session-continuation`](../../specs/opencode-session-continuation/spec.md), specifically "Automatic broker availability for normal MCP use", whose current text already requires that starting the normal MCP adapter makes the configured broker available, that a matching healthy secure instance is reused or one is started when state is safely unowned, and that broker-dependent calls wait for verified readiness within a documented finite startup deadline. Its scenarios cover safely stopped startup, healthy reuse and readiness never arriving. The confidential-admission, exclusive-ownership, truthful-readiness and durable-work requirements remain unchanged. This repository-relative reference stays valid after archive.

**Delta applicability verdict: `skip_specs: true`.** No capability delta and no baseline spec update is needed, for the reason that follows from the current text.

The current spec fixes the outer constraint, not the internal allocation this change corrects. It states the caller's bound as "within a documented finite startup deadline", it fixes fail-closed admission, and it fixes what may be reported. No requirement or scenario states a per-exchange or per-command time budget, any ten-second figure, or how one deadline is divided among phases of a call. Therefore choosing which existing budget value an ordinary exchange receives changes no requirement statement, no scenario and no acceptance obligation.

The correction also adds no guarantee, because the documented outer deadline, the subcaps and the admission boundary keep their current values, and it relaxes nothing, because every ownership, key, identity, profile, protection, expiry, cancellation and cleanup obligation named in "Private local authority requires authenticated confidential admission", "Shared startup preserves exclusive ownership and client independence", "Startup preserves local authority and truthful readiness" and "Automatic startup preserves existing durable work" stays in force. What it does is make installed behavior match the availability outcome the current text already requires. That is a correction of conformance, not a new or amended contract, so drafting a delta here would invent requirements the product does not have.

Two separate, already recorded obligations in the current text are outside this change and are not claimed by it:

- "fail with an actionable diagnostic" and "expose truthful status and an applicable next action". The observed generic `BROKER_UNAVAILABLE` fallback is not clearly an actionable diagnostic. Honest error classification is a separate follow-up, and this change neither fixes it nor makes it worse.
- Documented timeout and limitation wording for operators. This change alters no documented limit and no public message text, so it creates no documentation obligation. The waiting-exchange bound is the one limit class a follow-up would have to disclose, and it is decided separately below.

The `skip_specs` declaration is change metadata rather than proposal content. It belongs at the top level of this change's `.openspec.yaml`, beside `schema`, as the earlier specification-unchanged readiness correction did.

## Decided exclusion: the waiting exchange

The MCP adapter's waiting exchange keeps `LOCAL_WAIT_TIMEOUT_MS` (32,000 ms) and is not corrected here. Measured Windows protected reads cost roughly 33 seconds inside one exchange, so on that host a waiting exchange can end before its own required protected work completes. This exclusion is recorded rather than assumed, and it means this change claims no working `request_approval` wait on such a host. No runtime proof exists for either path, so the decision below rests on source and current spec text, not on measurement.

Judged from the current text, including the waiting exchange here would be a product contract change, not conformance correction.

- The spec fixes no numeric per-exchange or per-command duration, but it does fix what ending a waiting call means. `Portable waiting-call outcome delivery` requires: "The standard MCP request tool call MUST remain waiting for the human outcome while the call and transport remain active and the request is actionable." Its scenario `Return actual outcomes within documented waiting limits` adds: "client execution and transport timeouts constrain how long the call can wait. The product MUST document these limits without promising indefinite waiting." `Continuation after tool timeout` then requires that "tool timeout alone MUST NOT expire or cancel the request", and the `telegram-approval` scenario `Waiting call ends before the human decides` states that the request "remains pending and can accept the paired human's decision until expiry or explicit cancellation, without claiming that session delivery succeeded".
- Those clauses attribute the end of a waiting call to client and transport timeouts. They do not say whether the product itself may end the wait through an internal exchange budget. That question is unsettled requirement meaning today, and a bounded internal wait budget is exactly what the product currently relies on. Settling it is a specification decision, not a budget substitution, so it must not be made silently inside an unrelated correctness fix.
- The choice is user-visible and documented-limit bearing. Raising the waiting exchange budget changes how long one waiting exchange holds before reporting a lost wait, and how late a stuck or unreachable broker is reported. The spec ties that disclosure obligation to the waiting behavior itself, so the new bound has to be stated before it is implemented.
- The principle this change applies cannot be transferred as written. The ordinary exchange receives the remainder of a deadline its caller already holds, but the waiting client is constructed once for the adapter's whole lifetime and has no enclosing command or startup deadline at request time. "Remaining original deadline" therefore names nothing for the waiting path, and a value would have to be chosen.
- The bound also has to stay above one broker poll turnover so a live wait is not aborted mid-cycle, and it must stay finite, consistent with the documented 150,000 ms startup deadline and honest about caller-side client timeouts.

The preserved obligations are not in question and would carry into any follow-up unchanged: a client timeout does not cancel the durable request, a pending or timed-out request grants nothing, expiry and explicit cancellation return their non-approval closure, failures are never reported as human decisions or successful delivery, and no retry, second attempt or automatic resumption is added.

Consequences recorded for the follow-up, which is outside this change and is not authorized here:

- It needs a delta against `opencode-session-continuation`, not `skip_specs`. That delta must state what bounds a waiting call and how that bound is disclosed, keep the preserved obligations above, promise no indefinite wait, and claim no automatic resumption or late delivery.
- The success criterion for that follow-up is the one the user actually needs: after supported setup on a host whose protected reads exceed the old waiting-exchange budget, the waiting call returns the matching human outcome while the request remains actionable.

`skip_specs: true` remains correct for this change precisely because the waiting exchange stays out of it. If the waiting exchange were folded in, `skip_specs` would become false and this change would require that delta.

## Impact

- Scope: deadline handling for the ordinary authenticated local exchange in `src/cli/main.js` and `src/http/local-client.js`, plus focused deterministic regressions owned by test engineering.
- Out of scope with intent: the adapter's waiting exchange and its 32,000 ms budget, which is the separate contract decision recorded above. Also out of scope: honest error classification, README wording, retries, logging, stdio capture, provisioning, pairing, state, credentials and all security policy.
- First-run state: unchanged. This change introduces no stateful surface, so the existing supported path from an empty installation to the first useful approval interaction remains the only path and needs no new acceptance outcome. On a host whose protected reads exceed the waiting-exchange budget, the approval step of that path still fails as recorded above until the separate waiting-bound change lands.
- Current evidence: focused unit suite 6 pass and 1 deterministic failure, the failure being the second slow protected read exhausting the fixed budget. The related readiness suite is 18 pass. Real protected reads, real TLS, OS socket closure, installed readiness and Telegram delivery remain unverified and must not be reported as satisfied by this correction.
- Landing and exposure: the unit-only project restriction applies. Correctness of the correction is established by the focused regressions and by independent review of the diff, including confirmation that every affected caller received the remaining deadline. That review does not establish real-boundary operation, and installation or publication is not evidence of it.
