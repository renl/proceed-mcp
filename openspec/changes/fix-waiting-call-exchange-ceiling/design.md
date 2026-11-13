# Design

Bound the waiting MCP invocation by the caller's own limits and the request's disclosed expiry, not by a product-internal exchange budget.

## Context

Parent: [proposal](proposal.md). Requirement change: [delta](specs/opencode-session-continuation/spec.md), capability `opencode-session-continuation`, requirement `Portable waiting-call outcome delivery`. Baseline source trace: `daf0cf49d4782597b0c5e485165441fdcc6565ae`. Current contracts, named by repository-relative path because this change folder relocates on archive: `openspec/specs/opencode-session-continuation/spec.md`, `openspec/specs/telegram-approval/spec.md`, and the archived baseline design `openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/design.md`, which records the wait route as "Wait up to 25 seconds; `200` terminal / `204` still pending; adapter repeats while original MCP invocation lives".

The defect is one implementation budget. `src/cli/main.js` builds the adapter's waiting client with `timeoutMs: LOCAL_WAIT_TIMEOUT_MS` (`src/http/local-client.js`, 32,000 ms). `createSecureLocalClient` converts that value into one absolute per-exchange deadline that starts before the first protected ownership read and charges every later protected read to it. A waiting exchange performs the same three protected ownership reads as any ordinary exchange (`readSecureOwnership`, then two `stableRecord` comparisons), plus a broker response that may legitimately take a full 25,000 ms poll turnover. Its elapsed time is therefore `3R + H + T` where `R` is one protected read, `H` the handshake and `T <= 25,000` the turnover. A fixed client budget is consumed by host-dependent protected work before any outcome can be read.

This design decides only that mechanism and its boundary. It does not decide the ordinary-exchange question, and it does not raise any number.

## Goals / Non-Goals

**Goals:** no product-internal exchange, attempt, poll or command duration may end an actionable waiting call while the caller's call and transport remain active. Admission, identity, expiry, cancellation, response ceilings, cleanup, error classification and durable semantics are preserved exactly.

**Non-Goals:** any larger internal constant, any new retry or reconnection framework, any broker-side turnover change, any change to ordinary management exchanges, any change to the create/registration exchanges inside the waiting invocation, any public wording, any state or setup surface.

## Decisions

### 1. One closed exchange-deadline mode, and only the waiting client selects the open mode

`src/http/local-client.js` shall expose exactly two exchange-deadline modes for `createSecureLocalClient` and `secureExchange`, selected by one constructor parameter with a closed value set:

| Mode | Meaning | Producer |
|---|---|---|
| `budget` (default) | today's semantics: one absolute budget covering the protected read, TLS establishment, the HTTP exchange and the post-response re-read | every existing caller, unchanged |
| `caller` | no product-internal deadline: the exchange ends only on a settled response, a response-size breach, a transport error or end, or caller abort | the adapter's waiting client only |

Rules:

- `timeoutMs` is valid only with `budget`. Combining `caller` with a numeric `timeoutMs` shall be refused at construction as an invalid local-client argument, so no caller can pass a number that silently behaves as a ceiling. `caller` accepts no duration of any kind, and adding one later is a contract violation of the delta, not a tuning choice.
- `LOCAL_WAIT_TIMEOUT_MS` shall be deleted. It is not raised, renamed or kept as an unused constant. No replacement numeric waiting constant may be introduced.
- Mode is chosen at client construction, never per call site, so no ordinary exchange can become unbounded by accident.

Per-phase behaviour, where the only difference is the source of a phase's limit:

| Phase | `budget` | `caller` |
|---|---|---|
| Operation budget start | absolute budget before the first protected read | none |
| Protected ownership read before TLS | charged, expiry refuses the next phase | unbounded, only abort refuses the next phase |
| TLS handshake timer | `min(LOCAL_HANDSHAKE_TIMEOUT_MS, remaining)` | no timer, settle on `secureConnect` or socket `error` |
| Socket guard | timer at `remaining()` plus abort listener | no timer, abort listener only |
| Authorization emission gate | expiry check before send | abort check only |
| HTTP response timer | `remaining()` | no timer, settle on response `end`/`error` |
| Post-response record re-read and refusal | expiry check | abort check only |
| Response ceiling | `maxBytes` | `maxBytes`, unchanged |

Every phase, ordering, comparison and refusal in `secureExchange` stays: initial record read, stable-record comparison before the Authorization header, `profileProblem` (authorized, no authorization error, TLS 1.2, `PSK-AES256-GCM-SHA384`, no resumed session), `disableRenegotiation`, second stable-record comparison after connect, optional third after a readiness response, size-limited parse, `releaseGuard()` and `socket.destroy()` in `finally`, `agent.destroy()`, timer clear, abort-listener detach. Only time-based refusal changes, never state-based refusal.

`caller` mode also drops the handshake timer, because a slow handshake currently becomes `BROKER_INSTANCE_CONFLICT`, which the adapter treats as terminal, so a product-internal duration would still end the wait. A listener that never completes the handshake receives no Authorization byte and produces no success, so admission is not weakened, the failure is simply reported later.

### 2. Why a larger constant cannot satisfy this

With the waiting exchange performing the same `3R + H` protected work as an ordinary exchange and adding `T <= 25,000`:

- an ordinary exchange succeeds while `3R + H <= 10,000`;
- the waiting exchange succeeds while `3R + H <= 32,000 - T`, that is about `3R + H <= 7,000` at a full turnover.

The window in which the wait budget is the binding constraint is therefore `3R + H` in roughly `(7,000, 10,000]` ms, and it is host-dependent with no upper bound. Any chosen number re-creates the same failure on a slightly slower host, which is why the delta forbids a larger constant and why the mode, not the value, is the design decision.

### 3. The wait stays bounded by events and by the caller

After this change a waiting invocation is bounded only by:

- **Progress:** the broker answers each 25,000 ms turnover with `204`, the adapter repeats on the same invocation. `204` remains a poll result, never an outcome or a closure.
- **Outcome:** a `200` terminal representation validated against the captured handle and committed request.
- **Request closure:** the request's disclosed expiry or an explicit capability-authorized cancellation, committed by the broker and returned as the closure on the next poll.
- **The caller:** MCP invocation cancellation, adapter EOF/close (the invocation's own `AbortController` combined with the adapter's ordinary controller), the caller's client execution timeout, and transport end.
- **Documented startup readiness:** the existing `STARTUP_BUDGET_MS` prerequisite gate the adapter awaits before a broker-dependent call. That is a documented startup window, not a waiting bound, and it is unchanged.

Accepted residual, deliberate and stated in the delta: a broker that stops responding mid-exchange is surfaced when the caller's own limit arrives, because an open exchange that never settles produces neither an error nor a false closure. Re-adding any timer to shorten that is a regression, not an improvement.

### 4. The adapter loop and the broker are unchanged

`src/mcp/execution.js` needs no change. Its existing waiting loop already satisfies the delta once the exchange stops expiring, and every one of these behaviours must stay as written: creation is sent exactly once and never retried, `204` repeats, `BROKER_UNAVAILABLE` repeats on the existing `1/2/4/8/16/30` s ladder with no attempt cutoff while the invocation lives, `401` refreshes the captured registration through the existing single-flight lifecycle, `WAIT_ALREADY_ACTIVE` and every recognized broker envelope stay terminal, and a pending or unusable `200` is never promoted to an outcome. `WAIT_TURNOVER_MS` in `src/broker/waiters.js` shall not change.

## Preserved internal durations

These remain exactly as they are. None may be raised, lowered, reused or deleted by this change.

| Duration | Value | Path that keeps it |
|---|---|---|
| `LOCAL_REQUEST_TIMEOUT_MS` | 10,000 ms | ordinary adapter exchanges (registration create/heartbeat/release, `POST /v1/handles`, `POST /v1/requests` create, `get`/`cancel`/`acknowledge`, returned report) and CLI `pair`, `status`, `retry` |
| `LOCAL_HANDSHAKE_TIMEOUT_MS` | 1,000 ms | TLS establishment inside every `budget` exchange |
| `guardOwnedSocket` / `httpOverSocket` timers | remaining budget | every `budget` exchange |
| `WAIT_TURNOVER_MS` | 25,000 ms | broker wait route, returns `204` pending |
| `WAIT_RETRY_DELAYS_MS` | 1/2/4/8/16/30 s | adapter delay between failed wait transports, unchanged, no cutoff, abortable |
| `STARTUP_BUDGET_MS`, `PROBE_TIMEOUT_MS`, `PROBE_SPACING_MS` | 150,000 / 1,000 / 100 ms | adapter availability gate and CLI startup |
| `STOP_BUDGET_MS` | 30,000 ms | `stop` command only |
| `REGISTRATION_HEARTBEAT_MS`, `REGISTRATION_LEASE_MS`, `REGISTRATION_SHUTDOWN_BUDGET_MS` | 10,000 / 45,000 / 2,000 ms | adapter registration lifecycle |
| `SWEEP_INTERVAL_MS`, `EXPIRY_SWEEP_MS`, `ADMITTED_POLL_MS`, `RETRY_BACKOFF_MS`, `BLOCK_AFTER_MS`, `PAIRING_CHALLENGE_TTL_MS`, `PAIRING_ATTEMPT_WINDOW_MS`, provisioning input deadline | unchanged | broker paths outside the waiting exchange |

Also preserved exactly: `MIN_EXPIRY_SECONDS`/`MAX_EXPIRY_SECONDS` (60-86400) as the disclosed expiry domain, the `LOCAL_LIFECYCLE_BYTES * 64` and `LOCAL_PRODUCT_RESPONSE_BYTES` response ceilings, and every `LocalRequestError`/`SecureChannelError` code with its `retryable` mapping and CLI exit codes.

## Production allowlist

Two files, and nothing else:

1. `src/http/local-client.js`
   - add the `budget` / `caller` mode to `createSecureLocalClient` and `secureExchange`, with the phase behaviour above;
   - delete the `LOCAL_WAIT_TIMEOUT_MS` export and its comment;
   - leave every `budget`-mode code path byte-equivalent in behaviour.
2. `src/cli/main.js`
   - replace `timeoutMs: LOCAL_WAIT_TIMEOUT_MS` in the `waitClient` construction with the `caller` mode and drop the now-unused import;
   - replace the two comments that describe the waiting call as owning a longer deadline so they describe the caller-bounded wait instead.

Explicitly not in the allowlist: `src/mcp/execution.js`, `src/mcp/server.js` (its tool description sentence about client and transport timeouts stays true and unchanged), `src/broker/*`, `src/cli/main.js` `USAGE` text (it names no number and stays accurate), README, tests, tasks, proposal, delta, baseline specs, status log, `AGENTS.md`, archive.

## Unit boundary

The project is unit-test only, so the proof is memory-only, socket-free, native-query-free, PowerShell-free, and identical on Windows and Linux.

New test file `tests/wait-exchange-deadline.test.mjs`, using the established `registerHooks` pattern of `tests/authenticated-readiness-deadline.test.mjs`: module-level substitution of `../state/ownership.js`, `node:tls`, `node:http`, plus fake `performance.now`, `setTimeout` and `clearTimeout` driving an integer fake clock. The fake `read` advances that clock by a configured cost, so "the wait outlives 10,000 ms, 32,000 ms and 150,000 ms" is proven by advancing a counter, in real time near zero, with no OS call and no socket.

Cases:

1. `budget` mode regression: timer schedule, per-phase expiry refusal, socket/agent/listener cleanup unchanged. This is the guard that the ordinary path cannot be changed by this work.
2. `caller` mode outlives internal durations: three protected reads at 60,000 fake ms each, handshake 5,000, response held open, clock advanced past every internal duration, then settled. Asserts the exchange never rejected, the Authorization header was sent once after the record comparisons, the broker body is returned, and no exchange, handshake or guard timer was ever scheduled.
3. `caller` mode cancellation: an abort mid-exchange destroys the socket and rejects `BROKER_UNAVAILABLE`, with the abort listener detached.
4. Admission fidelity in `caller` mode: unauthorized socket, wrong TLS version, wrong cipher, resumed session, absent record, schema-1 record and ownership replacement at each of the three reads still refuse, and no Authorization byte leaves before the checks pass.
5. Response ceiling in `caller` mode: an oversized body still fails as unavailable with the socket destroyed.
6. Construction contract: `caller` plus a numeric `timeoutMs` is refused, and the default mode still applies `LOCAL_REQUEST_TIMEOUT_MS`.

`tests/portable-wait-unit.test.mjs` must drop its `local.LOCAL_WAIT_TIMEOUT_MS === 32000` assertion (WAIT-U-CREATE), which pins the deleted constant. Its other cases are executor-level fakes and stay as they are, including `WAIT-U-RECONNECT` (no attempt cutoff) and `WAIT-AUTHORITY-001-DUPLICATE` (turnover-safe reservation).

Every cleanup assertion belongs in the suite's teardown, before globals are restored: no timer left, every owned socket destroyed, every HTTP agent destroyed, zero abort listeners, and no diagnostic containing the token or channel key.

Not proven here and not to be claimed: real TLS-PSK behaviour, real protected-read cost, installed adapter operation, Telegram receipt, and a live outcome reaching an MCP call. Those stay deferred and unverified under the project's unit-only restriction.

## Contract consistency

- **Delta covers the mechanism.** The modified requirement statement, the narrowed limit clause and the added scenario all state exactly what this design implements, and the "carried verbatim" scenarios are untouched by it.
- **No documented waiting limit changes.** Neither the README nor the CLI usage text nor the MCP tool description states a numeric waiting limit. README documents only the 150,000 ms *startup* window, which is unchanged. The 32,000 ms value existed only as an internal constant and a source comment, so removing it contradicts no published statement and needs no wording change. The delta's own statement stays true and is not weakened.
- **No archived-contract contradiction.** The archived design records the wait route as a 25,000 ms poll with `200`/`204` and an adapter that repeats while the invocation lives. It never mandates a client-side exchange budget, so removing one conforms to it and the turnover stays as documented.
- **Acceptance wording gap, previously open, now closed by the primary spec author.** An earlier revision of this design recorded that the delta's `WHEN` clause and `AO-1`/`AO-2` read as covering every product-internal duration inside the waiting invocation, while this design deliberately leaves the create exchange and the registration exchanges inside `request_approval` on their ordinary 10,000 ms budget, so on a host where `3R + H > 10,000` those exchanges could fail before the wait loop starts. The owned proposal and delta now carry that clarification:
  - `AO-1` and `AO-2` are scoped to the waiting exchange's own internal duration, and each states that the create and registration exchanges made inside the same invocation keep their existing ordinary exchange budget, which is a separate subject neither required nor included by those outcomes.
  - `AO-9` states the band this change fixes on its own and presents the numeric anchor as a derived illustration rather than a new limit, and `AO-10` forbids reporting an end-to-end approval where the ordinary exchange budget still binds.
  - The added delta scenario carries the same scope in its `GIVEN` and in its ordinary-exchange clause, which requires a host above that budget to be reported as bounded by the ordinary exchange budget rather than as receiving a working end-to-end approval.
  - The delta's `WHEN` clause is scoped to the time the product spends inside that waiting exchange, so it is no longer broader than this design.

  Nothing else moves with that clarification: decision 2 and the residual risk still state the same reachable band, `3R + H` in roughly `(7,000, 10,000]` ms, and the mechanism, production allowlist, preserved durations and unit boundary are unchanged.

## Risks and trade-offs

- A silent transport death inside one open exchange is detected only at the caller's limit. Accepted explicitly by the delta and by `AO-7`. No timer may be reintroduced to shorten it.
- Request closure observed on a waiting call is now bounded by the broker turnover rather than by the client budget, so expiry or cancellation still reaches an active call within one turnover. That is the existing broker behaviour, not new latency.
- On a host whose ordinary exchanges already exceed 10,000 ms the user-visible symptom of the proposal's measured Windows case persists until the ordinary-exchange work lands. This design must not report that case as fixed.
- No live or installed verification exists under the unit-only restriction. Independent review establishes that no product-internal duration can still end an actionable wait, and the installed, Telegram and slow-host outcomes stay recorded as unverified.

## Out of scope

Error classification and public failure wording, README and usage wording, retries and any retry or reconnection framework, logging, captured child output, state, credentials, provisioning, pairing, broker turnover, ordinary management exchanges, and unrelated refactors.
