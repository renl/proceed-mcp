## Context

The [proposal](proposal.md) restores existing [automatic availability](../../specs/opencode-session-continuation/spec.md#requirement-automatic-broker-availability-for-normal-mcp-use) and [confidential admission](../../specs/opencode-session-continuation/spec.md#requirement-private-local-authority-requires-authenticated-confidential-admission). It changes no capability contract. `skip_specs: true` is consistent with that scope. The metadata owner must record it through the authorized workflow.

`src/broker/availability.js` currently gives the complete authenticated readiness exchange the same 1,000 ms cap as credential-free occupancy. `src/http/local-client.js` correctly charges protected reads, TLS and HTTP to that supplied exchange budget. Consequently, a protected read alone can exhaust the incorrectly shortened budget before TLS starts, even with time left in the original startup attempt.

This correction can land independently against `main` baseline `837f360afe67caac1c8011939d7b9ad2481f0a47`. It has no stacked parent or other active-change dependency. The reported live timeout's cause remains unproven.

## Decisions

### One original deadline, separate subcaps

The startup attempt retains its original 150,000 ms total budget. Only the authenticated readiness exchange receives the remaining original budget rather than the occupancy cap. Its complete exchange includes protected-record comparisons, TLS establishment, HTTP response and final identity validation. No phase receives a fresh startup budget.

| Operation | Preserved bound |
| --- | --- |
| Credential-free occupancy | Lesser of 1,000 ms and remaining startup time |
| Complete authenticated readiness exchange | Remaining original startup time at admission |
| TLS establishment within that exchange | Lesser of 1,000 ms and remaining exchange time |
| HTTP readiness response | Remaining exchange time, maximum 16,384 bytes |
| Existing retry spacing | At most 100 ms, clipped to remaining startup time |

Existing timer rounding does not authorize adoption at or after expiry. Admission checks remain before work and after awaited boundaries. Cancellation remains a transport teardown and admission failure, not permission to continue after a pending noncancellable read returns.

### Preserve authentication and ownership checks

The correction shall retain the initial protected ownership read and all existing stable-record comparisons: before TLS, after TLS before Authorization, and after the readiness response before adoption. Each comparison must still reject absent, incompatible or byte-changed ownership. No read is removed, cached or replaced by an earlier result to satisfy a test count.

The wire interaction remains `GET /v1/ready` at the configured `127.0.0.1` port over the existing TLS-PSK channel. The protected record supplies the key. TLSv1.2, `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`, authorization/profile validation, no session reuse, no tickets and disabled renegotiation remain unchanged. Bearer authority leaves only after secure admission and the pre-Authorization stable-record comparison.

Adoption still requires HTTP 200, the closed lifecycle envelope validated by `src/broker/lifecycle-envelope.js`, and matching instance, PID and port. Existing not-ready, storage-failure, conflict and cancellation classifications remain. Expiry of the original startup attempt remains `BROKER_STARTUP_TIMEOUT`, never a human decision or readiness success.

Every exchange retains owned-socket destruction, HTTP-agent destruction, timer clearing and abort-listener removal. Expiry or cancellation during an owned-socket read window destroys that socket, and the later read result cannot admit HTTP or adoption. Diagnostics remain secret-free. Existing launch-at-most-once, absence recheck, child deadline propagation, exclusive ownership and preservation of durable state remain unchanged.

## Boundary and test-fake review

Reviewed `tests/authenticated-readiness-deadline.test.mjs` against `availability.js`, `local-client.js` and `lifecycle-envelope.js`. Verdict: approved for focused unit fidelity. No production test seam is needed.

- Import hooks replace ownership, TLS, HTTP, occupancy and delay only inside the test. Production availability, secure-exchange sequencing and lifecycle validation still execute.
- The fake checks the loopback destination, readiness method/path, bearer placement, PSK identity/key and principal TLS profile. Its lifecycle body matches the current closed envelope. The fake agent/socket interfaces match the operations used by the real client.
- Synthetic time covers slow protected reads, remaining-budget propagation, the preserved TLS/occupancy subcaps, expiry and cancellation at read boundaries, deadline-time HTTP settlement, ownership substitution and lifecycle mismatch. Teardown assertions cover the modeled sockets, agents, timers and abort listeners. Synthetic secrets are checked against captured diagnostics.
- The fake marks TLS authorized and emits synthetic transport events. It does not prove native key protection, TLS negotiation, actual wire confidentiality, OS event ordering, real socket closure or installed runtime behavior. Those remain unverified under the unit-only policy. No native or wire test is authorized here.

### Repeated-read RED disposition

The slow-read success case currently asserts four reads: discovery plus the three existing stable-record guards. With the incorrect 1,000 ms exchange cap, its slow pre-TLS reads exhaust successive exchange budgets and cause additional iterations of the existing availability loop. That is a consequence of the deadline defect, not evidence that any security guard is redundant.

Giving the exchange the remaining original budget allows this synthetic successful exchange to finish without those timeout-induced extra iterations while retaining every guard. No separate repeated-read optimization is required. The four-read assertion is acceptable as a regression observation for this fixture, not a new public exact-call-count contract. If an implementation preserves the required checks and deadline semantics but changes private read or timer structure, adjust the test to those observable guarantees rather than removing guards or expanding this change. The supplied RED count is reported evidence, not a test execution by this review.

## Scope and verification

The first useful increment is the complete readiness deadline correction plus its focused deterministic regressions. Expected production scope is the readiness-budget argument in `availability.js`. `local-client.js` already owns the required exchange deadline, subcap and cleanup semantics and needs no redesign.

No global timeout increase, ownership-read elimination, cached rejection recovery, retry framework, logging framework, setup/migration, live-broker operation or durable-state change is included. Existing operational brokers remain untouched.

After this design, test engineering can define the bounded implementation task using the approved units. Required independent candidate review remains, but unchanged boundary/test-fake approval needs no separate replay. Only unit checks are permitted. This review ran no commands or tests and establishes neither live MCP readiness nor Telegram delivery. Merge, archive, publication and installation require their existing separate authorization.
