# Concurrent owner adapters

Permit independent adapter lifetimes under one authenticated owner without changing request authority or delivery.

## Context and boundary

Parent: [proposal](proposal.md). Behavior: [delta](specs/opencode-session-continuation/spec.md). Preserved contracts: [delivery and recovery](../../specs/opencode-session-continuation/spec.md) and [human decisions](../../specs/telegram-approval/spec.md).

This is one independently landable change against `main`, based on `4a7448523075c41a026cd311c1761b348cee9f27`. It has no stacked parent or dependency on README PR #20. The useful outcome is two same-owner adapters preparing and waiting independently, receiving reverse-order decisions on their own invocations, and closing independently. Registration retirement is part of that outcome, not a separate foundation.

The supplied discovery confirms separate OpenCode directory connections under the same owner. Official context: [shared connections](https://opencode.ai/docs/mcp-servers#shared-connections). The installed development version is unknown. This design changes only Proceed's existing broker-adapter contract. It adds no host API, metadata, transport, Events or version-support claim and does not infer host internals.

### Source-grounded baseline

Paths below are repository-relative. These are implementation evidence, not new public extension points.

| Boundary | Existing source and responsibility |
| --- | --- |
| Registration authority | `src/broker/registration.js`, `createRegistrationRegistry`: in-memory records, credential-derived owner, secret matching, lease, release and terminal registry close. The current owner index admits only one live record and emits `OWNER_IN_USE`. |
| Local wire | `src/broker/portable-server.js`, `createPortableServer`: owner authentication, role checks, registration handlers, wait attachment and returned-write evidence. Owns the registry and closes it during broker drain/close. |
| Adapter binding | `src/mcp/registration.js`, `createRegistrationBinding`: lazy single-flight creation, renewal, captured-authority refresh, generation fencing and bounded release. |
| Tool execution | `src/mcp/execution.js`, `createToolExecutor`: per-invocation transport, unchanged request capability, waiting and one captured successful-write report. |
| MCP framing | `src/mcp/server.js`, `runMcpServer`: independent dispatch, exact JSON-RPC ID correlation, serialized complete output frames, cancellation and observed input closure. |
| Lifecycle composition | `src/cli/main.js`, `runMcp`: secure availability, owner credential, binding/executor composition, input-close callback and final cleanup. `src/broker/availability.js` and `src/state/ownership.js` retain broker acquisition semantics. |

## Decisions

### 1. Owner identity is not occupancy

The broker SHALL accept each valid authenticated registration independently, including multiple registrations for the same owner. A new or reconnected adapter SHALL NOT evict, replace, release or renew another registration. Same-owner occupancy SHALL no longer produce `OWNER_IN_USE`. Existing error decoding may retain that code for compatibility, without using it as a reason to steal or retry ownership.

Each registration retains its own random `registration_id`, independent 256-bit `registration_secret`, authenticated owner and last validated activity time. Existing encodings remain `^reg_[a-f0-9]{32}$` and `^[a-f0-9]{64}$`. The owner comes only from the authenticated Bearer credential, never a registration body, label, directory or model-supplied session ID.

The registry SHALL index independent records by registration identity rather than treat an owner as one occupied slot. Private collection structure belongs to implementation. An owner index, if retained, MUST support multiple records and MUST NOT authorize owner-wide retirement.

Authentication, heartbeat and release SHALL match the complete owner, registration ID and secret tuple. Knowing a sibling ID or possessing only the owner credential cannot renew or release that sibling. Wrong, malformed, missing, foreign, released and expired registration authority retain the same nondisclosing denial.

### 2. Preserve the existing wire

The normal adapter continues to use the existing TLS-secured loopback channel at the configured port, with `Authorization: Bearer <owner-credential>`. TLS profile, channel admission, Origin refusal, credential roles and readiness checks are unchanged. Registration secrets use `X-Proceed-Registration`. Request capabilities use `X-Proceed-Request-Capability`. Neither belongs in URLs, logs, Telegram or public request representations.

| Existing operation | Body sent by adapter | Success | Registration authority |
| --- | --- | --- | --- |
| `POST /v1/adapter` | `{}` | `201`, exactly `{registration_id, registration_secret}` | Owner authentication only. Each success creates independent authority. |
| `POST /v1/adapter/{registration_id}/heartbeat` | `{}` | `204`, no body | ID in path and secret in header, bound to authenticated owner. |
| `DELETE /v1/adapter/{registration_id}` | No body | `204`, no body | Same captured tuple. Retires only that record. |
| `POST /v1/requests/{request_id}/wait` | `{registration_id}` | Existing `204` pending turnover or `200` terminal representation | Live registration plus matching request capability and owner. |
| `POST /v1/requests/{request_id}/returned` | `{registration_id, decision_id}` | Existing `200` representation | Same authority plus matching request capability and terminal decision. |

No route, response field, status code or schema version is added. Lifecycle `204` is not a request cancellation or human outcome. Repeating DELETE for retired authority returns the existing `401`, not fabricated successful cleanup.

Preserve the actual validation order:

- Create and heartbeat parse a JSON object, accepting an absent body as `{}` under existing parsing. The adapter sends `{}`. Create rejects members before registry admission.
- Heartbeat parses JSON, authenticates its tuple, rejects nonempty members, then renews. A valid JSON object with extra members and invalid authority therefore gets the registration denial, not a membership error. Malformed JSON is `400`.
- DELETE uses the captured path/header authority. It has no new body parser or body contract.
- Wait and returned parse JSON and authenticate the registration before rejecting unlisted fields or checking request authority. Returned renews only after successful evidence recording. A late failed renewal cannot undo already committed evidence.
- Wait checks the captured registration at admission and settlement. Only an attached, valid settlement renews that registration. Detachment destroys that exchange without a fabricated response or business cancellation.

Errors retain `{schema_version: 1, error: {code, message, retryable}}`. Registration denial is `401 AUTH_REQUIRED`, message `registration authentication required`, `retryable: false`. Missing/unknown Bearer credentials retain the existing `401 AUTH_REQUIRED`. A valid credential on the wrong role retains `403 FORBIDDEN`. Invalid JSON or disallowed members retain `400 INVALID_ARGUMENT`. Unrecognized route shapes retain `404 NOT_FOUND`. Existing storage/readiness classifications remain unchanged.

Preparation (`POST /v1/handles`), creation (`POST /v1/requests`), retrieval (`GET /v1/requests/{request_id}`), explicit cancellation (`POST .../cancel`) and receipt acknowledgement (`POST .../acknowledge`) do not gain a broker-side registration dependency. The normal executor still lazily ensures its own registration before implemented tools. Recovery therefore needs a usable authenticated connection, not the lost registration.

### 3. Independent leases and finite retention

The lease remains **45,000 ms** from the last fully validated registration-bound activity. The adapter heartbeat cadence remains **10,000 ms**. A registration is invalid when `now >= lastActivity + 45000`, including exactly at the deadline. Authentication alone, owner-only calls, invalid bodies and failed authority checks SHALL NOT renew it. Valid heartbeat and existing successful wait/returned activity renew only the named live record.

Release or expiry forgets that record and secret. Old authority SHALL NOT revive itself or affect any later registration. A fresh owner-authenticated POST is required after expiry. An ID/secret from an earlier broker lifetime cannot control registrations after broker restart.

Expiry enforcement SHALL happen before targeted authentication, heartbeat or release, without depending on a sweep timer. To prevent authenticated registration churn from retaining abandoned entries indefinitely, each create operation SHALL also prune expired records across the registry before allocating its new record. That pass visits the finite current population once, not a retry loop or background service. Targeted checks prune the named expired record. Registry close clears all records. No expired tombstone history is required.

This bounds retention by ongoing registry operations, not a promised fixed number of adapters or constant-time creation. An idle registry may retain expired records until a subsequent applicable operation or broker close, but they are already unusable. Active population and creation-pass cost grow with admitted concurrency. Do not introduce an arbitrary process/session quota or claim unlimited capacity.

The current registry is entirely in memory and never journals registrations. No stored-history migration, reset, credential rotation, owner recreation or re-pairing is needed. Durable requests and capability verifiers remain in their existing store.

### 4. Adapter closure is terminal

Retain one lazy single-flight binding per adapter and one heartbeat at a time. Refresh applies only to a rejected captured registration. Concurrent refreshes share creation, and a stale rejection cannot invalidate newer authority. A heartbeat transport failure or unrecognized outcome does not establish release, expiry or successful renewal. Preserve conservative authority handling and existing error redaction.

On observed input closure or another existing orderly cleanup path:

1. The MCP server fences input/output work and aborts that adapter's active invocations and admitted reports.
2. The executor fences new ordinary exchanges and aborts its own transports.
3. The binding becomes permanently closed before awaiting anything, stops heartbeat scheduling, invalidates its generation and aborts outstanding lifecycle exchanges.
4. Only authority already validated and held at closure may receive one best-effort DELETE. Repeated close shares the same cleanup and budget.

The existing release budget remains **2,000 ms**, shared across repeated close calls, with the release transport aborted when that budget ends. Cleanup does not wait indefinitely for an unknown create result. A create that settles after closure SHALL NOT install authority, start a heartbeat, initiate ordinary work or trigger another release. A late heartbeat, refresh, result-write callback or release completion SHALL NOT restore activity or mutate newer authority.

An unknown creation result leaves no usable local authority. Do not guess its secret or enumerate registrations by owner. Unknown release results do not prove remote cleanup. Only an observed successful release can be reported as such. Any orphan left without renewal becomes unusable at its lease deadline.

These are adapter behavior guarantees after shutdown is observed, not proof that every host closes stdin or that a process exits. Abrupt termination may bypass orderly release. Lease expiry neither kills that process nor cancels its durable requests. No new signal framework, forced exit, process sweeper or broker stop on last-adapter closure is required.

### 5. Preserve request and broker independence

- Separate adapters have distinct registrations but the same protected transport principal when configured with the same owner. Registration is a reachability lease, not authenticated agent-session identity.
- Every request retains its independently prepared capability and principal binding. Registration authority alone cannot retrieve, cancel, acknowledge or decide a sibling request. Deliberately transferring a valid capability within its principal remains authorized and does not redirect an existing waiting response.
- Keep concurrent invocation dispatch and exact JSON-RPC ID type/value correlation. Reverse-order human decisions return only to their original live calls. No global owner queue is added.
- A still-live invocation may refresh its own lost registration and continue waiting on the same created request under existing retry/conflict rules. A lost invocation is not reattached by reconnect. Reconnect alone creates no request, transfers no waiter and schedules no automatic agent turn.
- Release, expiry, transport loss and adapter closure do not cancel requests or erase accepted outcomes. Existing request expiry, explicit cancellation, single durable resolution, retrieval and idempotent matching-decision acknowledgement remain unchanged.
- Successful-write reporting remains one attempt for an actual error-free original terminal-result write, using its captured still-held registration. It never swaps in sibling/newer authority or retries after rejection. Retrieval, terminal creation replay and late suppressed writes are not this evidence.
- Broker/poller exclusivity remains per configured state. An adapter never stops a shared or manual broker on closure. Existing explicit `stop` and lock safety remain authoritative, with no stale-lock takeover or unrelated process termination.

## Alternatives and risks

Separate owners per directory would change principal and recovery semantics merely to bypass occupancy. It is rejected. Owner-wide replacement or release would disrupt siblings and is rejected. Persisting registrations or introducing a coordinator/service is unnecessary.

Removing occupancy exclusivity increases authenticated concurrent resource use. Operation-driven pruning prevents abandoned expired registrations from accumulating under continued creation, but is not a denial-of-service quota. Existing owner admission and secret boundaries remain intact. No material security relaxation is required. Any implementation proposal to drop owner/secret matching, widen request authority or weaken TLS/storage/lock guards must return for an explicit decision rather than be treated as cleanup.

## Implementation and documentation boundary

Recommended exact production edit allowlist:

- `src/broker/registration.js`: replace singleton occupancy and implement operation-driven expiry pruning.
- `src/mcp/registration.js`: only if needed for lifecycle correctness or obsolete singleton comments.
- `src/mcp/execution.js`: only if needed for the closure fence or obsolete singleton comments.
- `src/mcp/server.js` and `src/cli/main.js`: only if existing input-close composition needs a bounded correctness correction.
- `src/broker/portable-server.js`: only if needed to preserve the documented registration handlers with multiple records. No route/auth/transport redesign.

The last five paths are conditional, not a requirement to change working code. Collection choices, helpers and other private in-process seams remain implementation-owned. Expansion beyond these paths requires a concrete gap routed through coordination, not a generic refactor.

Recommended test edit allowlist: `tests/portable-registration-unit.test.mjs`, `tests/portable-registration-binding.test.mjs`, `tests/portable-execution-cancel.test.mjs`, `tests/portable-wait-unit.test.mjs`, and one focused new `tests/concurrent-owner-adapters-unit.test.mjs` if needed for composed in-memory coverage. Avoid test-only production dependencies.

Documentation scope is this change's `proposal.md`, `design.md`, capability delta and `tasks.md`, each edited by its owner. The content owner may separately update `README.md` using the merged-main baseline, only to explain sharing one owner across directories, independent close, unchanged private-capability recovery and explicit broker stop. Do not import PR #20 examples or held drafts. This design authorizes no README edit by its author.

No dependency, compiler, native helper, test harness, runtime configuration, state-format or publication change is needed. Do not automatically bump `package.json`, `package-lock.json` or `server.json`. Any coupled feature-release version convention is a separate ownership decision before finalization, not permission to publish or install.

## Verification and handoff

Test engineering SHALL map the delta to focused Linux-runnable JavaScript/TypeScript units using existing Node tooling, fake clients, deferred completions and injected clocks. Recommended minimal selections:

| Unit selection | Required modeled behavior |
| --- | --- |
| `tests/portable-registration-unit.test.mjs` | Two same-owner registrations, foreign owner rejection, mixed ID/secret rejection, independent renewal/release, exact expiry, stale authority denial, create-time pruning and registry close. Replace obsolete duplicate-owner rejection expectations. |
| `tests/portable-registration-binding.test.mjs` | Single-flight ensure/refresh, stale rejection, unknown create/release, close during create/heartbeat/replacement, finite release abort and no late activity. |
| `tests/portable-execution-cancel.test.mjs` and `tests/portable-wait-unit.test.mjs` | Per-invocation cancellation, terminal executor close, surviving sibling work, preserved wait retry/conflict and no duplicate creation. |
| `tests/concurrent-owner-adapters-unit.test.mjs`, if existing units cannot express composition | Two bindings/executors against the real in-memory registry through a fake client. Separate capabilities, reverse-order outcomes, independent receipt acknowledgement and closing one while the other remains usable. Any stream framing uses in-memory streams only. |

Use existing fixtures/patterns, not a new harness. Distinguish unit-modeled outcome routing and authority from real human, socket or process proof. Static review SHALL trace the wire table and lifecycle ownership against production source and confirm that no request-state or lock path changes.

Boundary Verification is triggered by this changed cross-component registration contract. Before implementation, review the test plan's authority tuple, exact existing routes/headers/statuses, validation order, captured-generation handling and proof classification together in one focused architecture pass. Decomposition review is needed if test engineering introduces test-only compilable contracts or splits setup from the concurrency/closure proof. No test-only interface overrides this design or dictates private production structure.

The user permits only units. Do not execute actual HTTP/public-client, child-process EOF, native integration, renderer, e2e, calibration or preflight suites. In particular, existing `portable-registration-http`, `portable-registration-public`, `portable-registration-eof`, `portable-concurrent-stdio` and public adapter-wait/write-report suites are not unit selections, even though they use `node:test`. Do not run the broad `npm test` command as a substitute for selecting allowed units.

Real local-wire admission and TLS, actual OpenCode closure/reconnect, installed first use, real process exit, broker/poller exclusivity under simultaneous starts, disk/crash durability and Telegram delivery remain unverified here. Units do not satisfy the genuine-boundary proof floor. Test engineering records these limits in tasks, and coordination records the candidate-specific landing/exposure decision under the existing unit-only restriction. No runtime qualification or waiver is inferred.

Next: test planning and the combined applicable boundary/decomposition review, then coordinated implementation in this existing worktree. Independent integrated-candidate review and primary-author delta review against the latest merged specs precede authorized CLI archive and the single PR into `main`. No additional worktree, stacked change, installation or publication is part of this design.
