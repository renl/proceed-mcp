# Tasks

Parent: [proposal](proposal.md). Contract: [design](design.md), [delta](specs/opencode-session-continuation/spec.md). Current authority remains the merged capability specs until this change lands.

## Delivery and lifecycle

First mergeable outcome: two legitimate same-owner adapters independently prepare, wait and acknowledge, with sibling-safe retirement and terminal closure. This is one independent change and one PR to `main`, not a prerequisite ladder. No dependency on README PR #20 or held guidance drafts.

- Worktree path: `.worktree/support-concurrent-owner-adapters`
- Branch/change: `support-concurrent-owner-adapters`
- Baseline: `main` at `4a7448523075c41a026cd311c1761b348cee9f27`
- Prerequisite: none
- Lifecycle owner: test engineering
- Status: active, executable setup and combined architecture review complete
- Nearest landing blocker: production implementation and independent candidate review
- Next action: coordinated implementation against this brief
- Cleanup evidence: no landing or abandonment, retain the active worktree. After authorized landing, verify merged content and safely remove through the normal lifecycle.

Founder-visible success: two OpenCode directories sharing one owner can complete independent approval interactions and close independently without losing pending work.

Proof would be both actual original calls returning their own human decisions, matching JSON-RPC IDs and independent acknowledgements through real clients. Current units model domain authority, routing and closure only. Their in-memory state, synthetic correlated decisions and fake transports are proxies for real directory, wire, process and installed first-use behavior. No automatic resumption or human approval follows from registration or retrieval.

## 1. Independent registration and executable setup

- [x] 1.1 Confirm pinned baseline, CLI v1.15.0 task dependency readiness, source routes and authored proposal/design/delta. Evidence: setup record below.
- [x] 1.2 Author unit regressions for same-owner registration, complete tuple checks, independent renewal/release and exact expiry. Verify syntax and expected baseline RED in `tests/portable-registration-unit.test.mjs`.
- [x] 1.3 Author in-memory composed regressions and positive controls in `tests/concurrent-owner-adapters-unit.test.mjs`. Verify distinct-owner controls reach both waits, reverse resolutions, acknowledgements and recovery, plus unknown create/release injection reachability.
- [x] 1.4 Complete one combined architecture boundary/decomposition/test-fake review of this file and the two changed tests. Accepted without edits or clarification. Evidence: review verdict below.
- [ ] 1.5 Implement independent records and operation-driven pruning in `src/broker/registration.js`, preserving authority and constants. Verify registration and composed selections in run steps 2-3 are GREEN. Independently inspect creation for a single finite pass over current records, pruning all expired owners before allocation, targeted expiry before authority checks and no tombstones/background sweeper. Observable expiry tests do not prove memory reclamation. Do not add a diagnostic API or assert a private map solely to claim that proof.

## 2. Adapter lifecycle and consumer behavior

- [ ] 2.1 Preserve binding single-flight refresh, generation fencing, permanent close and captured bounded release. Change conditional production paths only when a named regression requires it. Verify run steps 3-4, including injected create/release uncertainty, delayed heartbeat/replacement and stale rejection tests.
- [ ] 2.2 Preserve independent executor waits, principal/capability management, original-call routing and shutdown reporting fence. Verify both same-owner composed cases, transferred-capability positive control, foreign-owner/wrong-capability denials, surviving sibling wait and no reconnect creation/reattachment. Existing unit wait/cancellation suites must remain GREEN. No request-state or broker ownership edits.
- [ ] 2.3 Add the three focused registration/composition unit paths to the existing Linux CI selection only, if coordinated implementation includes the conditional CI allowance below. Verify exact-head Ubuntu Node 24.22.2 results. No broad test discovery or non-unit selection.

## 3. Integrated candidate review

- [ ] 3.1 Freeze the implementation-complete revision and independently review all changed production, tests and artifacts. Run the bounded sequence below. Record pass/fail counts, source-pruning review and candidate-specific remaining risk without counting unrun boundaries passed.
- [ ] 3.2 Obtain the primary capability author's delta review against latest merged specs after independent review. Verify any later finalization delta is docs-only, otherwise revalidate affected evidence. Candidate-specific landing/exposure acceptance is required through coordination for the unverified real boundary under the unit-only restriction.

## Implementation filebrief

Required production edit: `src/broker/registration.js`. Remove exclusive owner occupancy, not owner authentication. Use the complete owner/ID/secret tuple. Preserve 45,000 ms lease and operation-driven expiry defined by design decisions 1-3. No quota, persisted registration, secret logging or owner-wide retirement.

Conditional production edits, only for demonstrated lifecycle correctness or obsolete singleton comments:

- `src/mcp/registration.js`
- `src/mcp/execution.js`
- `src/mcp/server.js`
- `src/cli/main.js`
- `src/broker/portable-server.js`

Do not change working code merely to consume the allowlist. Preserve public routes, schema/status/error vocabulary, TLS/channel authentication, principal/capability authorization, pairing, explicit decisions, broker/poller locking and journal integrity. Keep 10,000 ms heartbeat, one lifecycle exchange at a time and the shared 2,000 ms release budget. Never guess unknown registration authority, clean by owner, retry after terminal close, kill processes or cancel durable requests on adapter loss.

Test edit allowlist:

- `tests/portable-registration-unit.test.mjs` (changed)
- `tests/concurrent-owner-adapters-unit.test.mjs` (new)
- `tests/portable-registration-binding.test.mjs` (existing, unchanged)
- `tests/portable-execution-cancel.test.mjs` (existing, unchanged)
- `tests/portable-wait-unit.test.mjs` (existing, unchanged)

SDET owns test changes and task criteria. Implementation feedback on an infeasible assertion returns through coordination, not test weakening. No production dependency on test doubles.

Conditional coordination request: `.github/workflows/ci.yml` currently selects wait/cancellation units but omits registration, binding and the new composition file. Request only adding those three paths to that bounded existing unit step. This is not permission for test engineering to edit CI or for broad CI redesign. All other files are excluded, including README, metadata, dependencies, config, status, AGENTS, archived content, held tests/drafts and other worktrees. Any necessary expansion returns to coordination.

## Unit mapping and run sequence

Commands run from the assigned worktree. Node commands are Linux-compatible and use normal `node:test`, with no PowerShell, Windows APIs, compiler, subprocess or network dependency in the new tests. Local execution is Windows Node v26.13.0, not evidence of actual Linux execution.

| Delta requirement/scenario                                                                                 | Design  | Executable mapping                                                                                      | Deterministic observation                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent adapters share an owner without registration conflict / independent approval interactions       | 1, 2, 5 | `PORT-REG-UNIT`, `CONCURRENT-CALLS-shared`                                                              | Distinct live authority, both waits reached before reverse decisions, A stays pending until A's decision, distinct outcomes/IDs and idempotent receipt                     |
| Registration authority does not grant sibling request access / admission and owner isolation               | 1, 5    | `CONCURRENT-REG-TUPLE`, `CONCURRENT-RECOVERY-shared`                                                    | Mixed tuple denial, wrong capability and foreign owner cannot read/cancel/acknowledge, deliberately transferred capability succeeds without waiter transfer                |
| Registration renewal and retirement are independent / all scenarios                                        | 3       | `CONCURRENT-REG-TUPLE`, `CONCURRENT-REG-RETIRE`, existing `PORT-REG-CLOCK/RENEW/CLOSE`                  | Only named registration renews/releases, exact deadline denial, no revival, reconnect and restart isolation                                                                |
| Adapter reconnect and closure preserve durable request recovery / reconnect and lost-registration recovery | 4, 5    | `CONCURRENT-RECOVERY-shared`, existing `WAIT-U-401/INCARNATION/RECONNECT`, `EXEC-CANCEL-*`              | Release leaves request pending, survivor stays waiting, reconnect creates no request/wait, explicit get/ack retains decision                                               |
| Observed shutdown stops activity despite late completions                                                  | 4, 5    | existing `PORT-BIND-CLOSE/REFRESH/RELEASE`, `WAIT-U-ABORT`, new composed late `reportWritten` assertion | Held work actually entered, abort recorded, late settlement creates no calls, captured report suppressed after close                                                       |
| Creation or release outcome is unknown                                                                     | 3, 4    | `CONCURRENT-UNKNOWN`, existing `PORT-BIND-CLOSE/RELEASE`                                                | Remote creation reached, held lifecycle aborted, no guessed DELETE for unknown create, one bounded release, late result cannot restart work, orphan denied at exact expiry |
| Supported first use / shared startup and process ownership                                                 | 5       | Not executed                                                                                            | Real startup, first use, actual host EOF and broker/poller exclusivity remain unverified                                                                                   |

The fake local client maps existing domain seams, not transport admission. The in-memory journal stores cloned append/replay data only, not SQL/disk/crash durability. Synthetic pairing and mapped callback choices use existing broker methods. No token/state/configuration is read. Distinct-owner CALLS and RECOVERY controls exercise the downstream assertions on the old implementation, so same-owner admission RED is not misreported as executed downstream proof.

Run in this order. All five test files must exist on this branch, no prerequisite from another worktree.

1. Cheap syntax and scoped formatting before unit execution:
   - `node --check tests/portable-registration-unit.test.mjs`
   - `node --check tests/concurrent-owner-adapters-unit.test.mjs`
   - `node ../add-harness-approval-channel/node_modules/prettier/bin/prettier.cjs --check --ignore-path .gitignore tests/portable-registration-unit.test.mjs tests/concurrent-owner-adapters-unit.test.mjs openspec/changes/support-concurrent-owner-adapters/tasks.md openspec/changes/support-concurrent-owner-adapters/proposal.md openspec/changes/support-concurrent-owner-adapters/specs/opencode-session-continuation/spec.md`
   - For authorized formatting, replace `--check` with `--write` for exactly those owned paths. Never use repository-wide formatting or format immutable archives.
2. `node --test tests/portable-registration-unit.test.mjs`
3. `node --test tests/concurrent-owner-adapters-unit.test.mjs`
4. `node --test tests/portable-registration-binding.test.mjs tests/portable-execution-cancel.test.mjs tests/portable-wait-unit.test.mjs`
5. `git diff --check` and `openspec validate support-concurrent-owner-adapters --strict`.

Use a 30-second outer command deadline for each unit invocation and 20 seconds for syntax/format/CLI commands. Tests use injected clocks/timers or existing bounded lifecycle waits. Never run broad `npm test`. Existing non-unit HTTP/public/EOF/concurrent-stdio/write-report suites are excluded even though they use `node:test`.

## Boundary Verification

Category: real broker-adapter wire plus normative cross-component registration contract. Source grounding: design decision 2 and `src/broker/portable-server.js` registration handlers, wait settlement and returned evidence handlers. `src/http/local-client.js` opens TLS-PSK to `127.0.0.1:<configured-port>` and carries HTTP request paths over that secured socket. Do not replace it with plain HTTP or assume a generic certificate-based HTTPS client. No framework mount/path transform exists. No new external platform or host API is introduced.

All operations retain `Authorization: Bearer <owner-credential>`. The authenticated credential supplies owner identity, never a body/label/directory. Secrets use `X-Proceed-Registration`, capabilities use `X-Proceed-Request-Capability`, never URLs or result representations.

| Exact wire operation                           | Request                                            | Result                                                  |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `POST /v1/adapter`                             | `{}`, owner credential                             | `201`, exactly `{registration_id, registration_secret}` |
| `POST /v1/adapter/{registration_id}/heartbeat` | `{}`, captured ID/secret plus owner                | `204`, no body                                          |
| `DELETE /v1/adapter/{registration_id}`         | No body, same captured tuple                       | `204`, no body, repeated/retired authority gets `401`   |
| `POST /v1/requests/{request_id}/wait`          | `{registration_id}`, tuple plus request capability | `204` pending turnover or `200` terminal representation |
| `POST /v1/requests/{request_id}/returned`      | `{registration_id, decision_id}`, same authority   | `200` representation                                    |

Errors retain `{schema_version: 1, error: {code, message, retryable}}`. Registration denial is `401 AUTH_REQUIRED`, `registration authentication required`, `retryable: false`. Existing missing/unknown credential `401`, wrong-role `403 FORBIDDEN`, malformed JSON/unlisted members `400 INVALID_ARGUMENT` and unknown route `404 NOT_FOUND` remain. No name mapping or new route/status/error is proposed.

Validation order is material: create parses object and rejects members before registry admission. Heartbeat parses, authenticates tuple, rejects members, then renews. DELETE has no new parser. Wait/returned parse and authenticate registration before rejecting members or checking request authority. Wait admission and attached settlement both check captured registration. Only valid attached settlement renews. Returned renews after evidence commit, and failed late renewal cannot undo it. Detached exchange is destroyed, not fabricated cancellation or outcome. Prepare/create/get/cancel/acknowledge do not gain broker-side registration dependency, although the executor lazily ensures its binding.

Unit assertions verify registry authority and modeled consumer calls only. Wire parsing/role/TLS/status fidelity is source-reviewed, not executed. Required real-boundary proof would run two normal adapters against the secured broker with separate requests, reverse human decisions and independent close/recovery. It is prohibited now and remains unverified. No mock success satisfies it and no implicit waiver is recorded.

Combined review scope: Architect checks this block against design/source, complete tuple and request authority, validation order, lifecycle ownership and captured-generation semantics. Review the test-only client/journal and synthetic decisions for faithful fields/order and no invented semantics. Decomposition trigger answers: (1) YES, registry change is consumed by binding/executor proofs, (2) NO, each case owns a fresh registry/broker, (3) YES, both waits must be attached before decisions, (4) YES, composed authority/routing/close proof is order-sensitive, (5) NO, fixture and proof share one test lifetime. One combined review is accepted. Do not replay it unless a material contract delta affects the reviewed scope.

Review verdict supplied through coordination: ACCEPTED for this tasks file and both changed unit files, without edits or clarification. Routes, authentication, bodies, statuses, errors and validation order match production source. Independent tuples, leases, retirement and closed fencing are valid. Distinct-owner controls reach downstream assertions, and capability transfer preserves the waiting route. Create-time expired-record reclamation remains an independent implementation algorithm-review obligation. This is architecture review, not additional test execution or real-boundary proof.

## Checks and setup evidence

| Gate                                                                                                           | Status / failure                                                                                                                                                 | Owner and next trigger                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pre-merge unit/static and pruning review                                                                       | Expected same-owner RED before implementation. Pruning reclamation requires independent algorithm review, not a private-metadata unit assertion                  | Implementation, then test engineering at frozen candidate                                            |
| Pre-merge combined review                                                                                      | ACCEPTED, boundary/decomposition/test-fake scope without edits or clarification                                                                                  | Architecture re-review only for a material contract delta                                            |
| Pre-merge strict OpenSpec validation                                                                           | PASS after primary-author correction moved normative clauses into explicit scenarios and removed the redundant introduction                                      | Test engineering reruns if active artifacts change                                                   |
| Pre-merge formatting                                                                                           | Pinned Prettier 3.9.10 reused from repository-local tooling, no install. Initial check identified only the two changed tests and tasks for mechanical formatting | Test engineering records final explicit-path check below                                             |
| Pre-merge Linux execution                                                                                      | Not run locally, current host is Windows                                                                                                                         | Implementation CI at exact head using existing Ubuntu/Node pins and scoped path addition             |
| Pre-exposure real boundary and multi-directory first use                                                       | Unrun/unverified under unit-only restriction, no candidate-specific landing/exposure acceptance inferred                                                         | Coordination records exact candidate decision before archive/merge/exposure                          |
| Post-deploy actual host closure/reconnect, independent waiting calls and acknowledgement                       | Deferred/unverified, host may not close stdin and abrupt exit may skip DELETE                                                                                    | Product operator after authorized clean-main deployment and separate runtime verification permission |
| Deferred TLS/wire admission, process exit, simultaneous broker/poller ownership, disk/crash and Telegram proof | Unrun/unverified. Units cannot detect actual protocol, process or durable-media failures                                                                         | Test engineering and operations when non-unit verification is authorized                             |

Setup at pinned baseline: `openspec --version` reports 1.15.0. CLI status reports proposal/specs/design done and tasks ready. `openspec instructions tasks --change support-concurrent-owner-adapters --json` read before authoring. Initial branch equals the named branch, HEAD and merge-base with main equal the pinned baseline. Initial dirty set is only the expected untracked active change directory. No unexpected drift, production edit, runtime operation, held-work change or install occurred.

Initial execution exposed a synthetic create-response wrapping mistake in the new client. Corrected it to the existing handler's `created.request` projection and status. This was a test-fixture defect, not a product failure. Subsequently all three control records (`CONCURRENT-CALLS-foreign`, `CONCURRENT-RECOVERY-foreign`, `CONCURRENT-UNKNOWN`) pass. Existing binding/cancellation/wait selection passes 95 records, zero failures/skips/cancellations. Full selected baseline run at `8e96590cc2904efd473420b0f0e501c26708acc6`: 106 records, 101 passed, five expected same-owner admission failures, zero cancelled/skipped. Evidence: `.scratch/concurrent-unit/setup-red.tap` in the assigned worktree. Same-owner failures stop at admission and do not claim the later assertions passed.

Continuation: the initial strict-validation failure (four warnings) is resolved by the primary author's active-delta correction. `openspec validate support-concurrent-owner-adapters --strict` exits 0. Existing pinned Prettier 3.9.10 is available at `.worktree/add-harness-approval-channel/node_modules/prettier/bin/prettier.cjs` from the repository root. Reuse it read-only from the assigned worktree as `node ../add-harness-approval-channel/node_modules/prettier/bin/prettier.cjs`, with `--ignore-path .gitignore` and explicit paths so normal Prettier ignore rules do not silently skip tests/OpenSpec. Mechanically format only the two changed tests and this tasks file. Check those three plus completed `proposal.md` and the corrected capability delta. Do not edit design while review is in flight.

Final continuation checks: scoped formatting, both test syntax checks and whitespace checks pass. The unit evidence above is reused, not rerun: test tokens/semantics and production inputs are unchanged by mechanical formatting. No Linux/runtime execution or dependency installation is added. Combined architecture review is accepted, and the completed setup brief is ready for coordinated implementation.

A bounded byte comparison confirms both current test files exactly equal pinned Prettier's formatting of their tested `8e96590cc2904efd473420b0f0e501c26708acc6` content. This supports reuse of the 106-record unit evidence without new unit execution.

## Workflow follow-up

- After independent candidate review and primary-author review, coordination authorizes one CLI archive inside the single change PR. No archive, PR creation, push, merge, installation or publication is authorized by this setup.
- Finish task/evidence content before archive. Archived content is immutable, later landing and cleanup evidence belongs on the PR or live status record.
- After proven landing, test engineering verifies correct target content and performs safe lifecycle cleanup. Preserve unknown or unrelated work and do not clean other worktrees under this brief.
