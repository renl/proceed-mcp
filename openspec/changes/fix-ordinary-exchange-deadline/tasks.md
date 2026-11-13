# Tasks

## Outcome and scope

Normal MCP use and the ordinary operator commands must reach the configured broker when its protected ownership reads are slow. The mergeable outcome: the ordinary authenticated local exchange uses the remaining original startup or command deadline instead of a fixed short per-exchange budget, preserving every ownership, key, identity, expiry, cancellation and cleanup safeguard. The first independently landable increment is that budget correction with its focused regressions, delivered in one OpenSpec PR into `main`.

- Baseline: `main` at `daf0cf49d4782597b0c5e485165441fdcc6565ae`. No stacked parent and no other active-change dependency.
- Change folder: `openspec/changes/fix-ordinary-exchange-deadline/` on branch `fix-ordinary-exchange-deadline` in `.worktree/fix-ordinary-exchange-deadline`.
- Inputs: [approved implementation record of the readiness correction](../archive/2026-11-13-fix-authenticated-readiness-deadline/design.md) and the existing [availability contract at the unchanged baseline](../../specs/opencode-session-continuation/spec.md#requirement-automatic-broker-availability-for-normal-mcp-use).
- Owner artifacts still to write: `proposal.md` (product manager) and `design.md` (software architect). Task and test engineering owns `tasks.md` and the runnable tests only. Spec applicability (`skip_specs`) is the product author's decision, not this file's.
- Production allowlist: `src/cli/main.js` and `src/http/local-client.js`. Any needed production change outside that allowlist returns to the delivery coordinator.
- Test ownership: `tests/ordinary-exchange-deadline.test.mjs`. Test criteria stay with test engineering.
- Excluded on purpose: raising the global startup budget, removing or shortening any ownership, key, identity, profile or protection check, retries or a retry framework, a logging framework, capturing child stdio, changes to pairing, provisioning, state or credentials, public error wording changes, refactors and live-broker operations. Honest error classification is a separate follow-up owned by product and architecture and is not part of this change.

## Reported field defect

After preview.6 installation, the adapter fails one step later than before. The ordinary exchange keeps a fixed 10,000 ms budget, while roughly 33 seconds of Windows protected-record reads occur in the same command path outside it. A maintained status run returned `BROKER_UNAVAILABLE` after 42.7 seconds while broker PID 29232, parent 12464, port 43189 and ownership instance `da93cd25bcffcdb386aed440e10d5ce3` all remained consistent. A TLS or profile mismatch would have classified as `BROKER_INSTANCE_CONFLICT` and was not observed. The generic MCP message is an unmapped fallback, so classification honesty is not evidence about the cause.

Read-only source trace at the baseline:

- `src/http/local-client.js` gives one exchange an absolute budget (`exchangeDeadline`) and refuses any phase whose remaining time is spent. That behavior is correct and stays.
- `src/cli/main.js` ordinary exchanges (status, retry, pair) and the MCP adapter's ordinary client pass the fixed `LOCAL_REQUEST_TIMEOUT_MS` of 10,000 ms. `awaitSecureAvailability` and the readiness exchange already receive the remaining original budget, so only the ordinary exchange still starts a short fresh budget.
- `src/state/ownership.js` protected reads (`verifyWindowsProtection`, path protection and the opened-handle checks) are not cancellable and cost about 11 seconds each on the affected host, so three such reads alone exceed 10,000 ms.

## 1. Focused regressions

- [x] 1.1 Write the memory-only, Linux-compatible unit suite at `tests/ordinary-exchange-deadline.test.mjs` that drives the real production CLI dispatch and the real secure-exchange sequencing over synthetic collaborators only. Require no native query, PowerShell, real process, real state or credential.
  - Evidence: registration of hooks covers only these seams: ownership reads for `src/cli/main.js` and `src/http/local-client.js`, CLI configuration and control-credential reads, and the `node:tls`/`node:http` transports used by `src/http/local-client.js`. Production `secureExchange`, its deadline accounting, its guard and its cleanup stay unmodified and under test. `node --check tests/ordinary-exchange-deadline.test.mjs` passes.
- [x] 1.2 Record the red baseline result for the right reason, then prove the assertions are satisfiable without delivering a production change.
  - Evidence, baseline: `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 tests, 6 pass, 1 fail. The failing case is `ORDINARY-EXCHANGE: status completes when its protected reads cost the measured 33 seconds`: exit code 3, stderr `proceed-mcp: the secure broker is not reachable`, `reads=2`, `requests=0`, modelled elapsed 22,000 ms. The fixed 10,000 ms exchange budget expires during the second protected read, which is the reported defect class at the first phase where it bites. The six passing cases are guard and cleanup preservation assertions, not defect proof.
  - Evidence, satisfiability check: in a disposable copy under ignored `.scratch/` (now removed), one minimal correction of the `runStatus` ordinary exchange budget -> the existing `STARTUP_BUDGET_MS` gives 7 pass, 0 fail, with the same production code and tests. This proves the suite is satisfiable by the intended correction and is not an unreachable assertion. It patched only the `status` call site, so it demonstrates satisfiability, not correction completeness, and the adapter caller still depends on review per task 3.1. It is a throwaway check, was never committed, and is not a delivered production edit.

## 2. Production correction

- [ ] 2.1 Give the ordinary authenticated local exchange the remaining original startup or command deadline instead of the fixed 10,000 ms per-exchange budget, in the allowlisted files. `awaitSecureAvailability`, the readiness exchange, the 1,000 ms occupancy and TLS subcaps, the 100 ms retry spacing and the global 150,000 ms startup budget stay exactly as they are.
  - Acceptance: `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 pass, 0 fail, 0 skipped.
  - The MCP adapter's ordinary client in `runMcp`, and the CLI `status`, `retry` and `pair` ordinary exchanges, are the affected callers. A correction that fixes one caller while another keeps the short fixed budget is incomplete. The adapter caller is verified by diff review in task 3.1, because driving it would need a stdio server run that the unit-only restriction excludes.
  - Do not satisfy a case by removing a protected-record comparison, a profile/key/identity check, a cancellation or expiry gate, a socket/agent/timer teardown, or the response bound.
- [ ] 2.2 Re-run the focused suite and the existing related unit suites that consume the touched modules, then record the implementation commit. Reuse unchanged baseline evidence by revision rather than replaying unrelated suites.
  - Acceptance: affected suites pass with the corrected source. Report actual counts.

## 3. Independent integrated-candidate review

- [ ] 3.1 Record the immutable implementation head and base, inspect the complete changed and untracked set, confirm the production allowlist, and verify the focused suite, syntax and formatting checks below independently. Explicitly confirm by diff review that the MCP adapter's ordinary client and every CLI ordinary exchange caller received the remaining deadline, since only the CLI `status` caller has an executable unit assertion. Report failures honestly and route corrections through the delivery coordinator.
- [ ] 3.2 Confirm any later finalization delta is docs-only, or revalidate affected code, tests, dependencies, configuration and baseline. Unit-only evidence is not runtime or release readiness.

## Test mapping and run sequence

All commands run from the change worktree with that worktree as the working directory. Native unit and static commands are bounded to 60 seconds each. No server, native helper, wire or live broker is started, and no state directory, credential or token is read.

1. Syntax: `node --check tests/ordinary-exchange-deadline.test.mjs`.
2. Focused units: `node --test tests/ordinary-exchange-deadline.test.mjs`.
   - Expect 7 pass, 0 fail after task 2.1. Baseline is 6 pass and 1 fail, and that failure is the defect.
   - Case mapping: the measured-33-second case is the direct modelled proof of the deadline invariant. The pre-socket slow-read, in-exchange exhaustion, substitution, cancelled-caller and absent-record cases are preservation assertions for the existing guards. The fast-exchange case proves a remaining budget still admits exactly one authenticated exchange.
   - Every case also asserts teardown: timers cleared, owned sockets destroyed, HTTP agents destroyed, abort listeners detached, and no synthetic credential or channel key in command output or refusal text.
3. Existing related unit suites, only after task 2.1 changes source, using explicit file paths and no wildcards: the readiness suite `tests/authenticated-readiness-deadline.test.mjs`, because it shares `src/broker/availability.js` and `src/http/local-client.js`. Do not run `npm test`, directory discovery or any integration, end-to-end, renderer, harness, build, pack or install suite.
4. Formatting: the repository formatter is not installed in a fresh worktree and `.prettierignore` excludes `tests/` and `openspec/`, so the maintained format gate does not cover this change's artifacts. CI checks formatting only for `.github/workflows/ci.yml`, which this change does not touch. If the coordinator wants explicit formatting anyway, the authorized bootstrap is `npm ci --ignore-scripts --cache .scratch/ordinary-exchange-setup/npm-cache --no-audit --no-fund` with the lockfile unchanged, then an explicit file list with `--check` or `--write` for owned files only. Never format the repository or the archive.
5. Whitespace and diff hygiene: `git diff --check`.
6. Structural check: `openspec validate fix-ordinary-exchange-deadline --strict` and `openspec instructions apply --change fix-ordinary-exchange-deadline --json`. Structural success is not behavioral proof, and advisory warnings do not create another gate.

## Boundary Verification

Category: none required. This is a private, implementation-owned seam inside an already reviewed and unchanged contract. No wire protocol, URL, TLS profile, key, payload, route, public error code or CLI output shape changes. The only intended difference is which existing budget value an ordinary exchange receives, so there is no normative public or cross-component contract delta, no new external boundary, and no spec requirement delta for the product author to author.

- Unchanged wire and admission: TLSv1.2 with `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`, `rejectUnauthorized`, no tickets or session reuse, disabled renegotiation, Bearer authority only after a stable-record comparison, three stable-record comparisons, the 64 KiB operator response ceiling, and every expiry and cancellation gate.
- Real-boundary proof: UNRUN and UNVERIFIED under the project unit-only restriction. The suite models protected reads, the clock and the transport. It does not prove real Windows protection calls, real TLS, actual OS socket closure, installed startup or any Telegram outcome.
- Decomposition checklist: all five cross-unit triggers are NO. This is one correction, one shared suite with self-contained synthetic collaborators, no new persisted state, no new receiver and no split proof chain.
- Boundary review signal: a combined Architect boundary and test-fake review is not required in the test owner's judgment, because no contract, payload or name changes and the realism gap is the already accepted unit-only restriction. If the coordinator disagrees, the only question for architecture is whether a unit-only fake surface is acceptable for a budget-only correction.

## Checks and evidence

Preparation evidence, executed in this worktree on Windows with Node v26.13.0, all bounded to 60 seconds:

- `node --check tests/ordinary-exchange-deadline.test.mjs` exits 0.
- `node --test tests/ordinary-exchange-deadline.test.mjs` reports 7 tests, 6 pass, 1 fail. The single failure is the intended red with the reason recorded in task 1.2.
- `node --test tests/authenticated-readiness-deadline.test.mjs` reports 18 pass, 0 fail, confirming the unaffected related suite is green at this baseline.
- Trailing-whitespace scan and `git diff --check` are clean for the changed paths.
- `openspec validate fix-ordinary-exchange-deadline --strict` exits non-zero with exactly one issue: no delta specs and no `skip_specs: true` declaration. `openspec status --change fix-ordinary-exchange-deadline` reports tasks complete with proposal, specs and design blocked by the unwritten proposal, and apply instructions report `ready`. This is the product author's spec-applicability decision plus the two unwritten owner artifacts. The test owner did not declare `skip_specs` or write a requirement delta, because neither is a test-engineering decision and inventing either would change accepted contract meaning. Remedy is one recorded choice by the product author.
- No formatter, formatter bootstrap, integration, end-to-end, renderer, harness, build, pack, install, runtime, broker, status, state, token or global-configuration command was executed. The repository formatter is absent from this worktree and `.prettierignore` excludes this change's owned paths.

| Stage        | Required observation / current state                                                                                                                                                    | Failure, owner and trigger                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-merge    | Focused suite 7/7 on the corrected candidate, related readiness suite passing, production diff inside the allowlist, independent review PASS, owner proposal and design complete. | Wrong budget or a weakened guard. Implementation owner corrects before landing. Stop on drift, failed checks or conflicts.                      |
| Pre-exposure | Not applicable beyond this project's recorded unit-only acceptance. No version, metadata or README change is planned here.                                                              | If an exposure step is later added, its owner records the risk decision in the status log first.                                                |
| Post-deploy  | Owner manual verification of installed MCP and normal status behavior stays UNRUN and UNVERIFIED. Publication and installation do not satisfy it.                                      | The live failure may persist for another reason. Operator verifies after deployment without bypassing guards.                                   |
| Deferred     | Real protected reads, real TLS and OS socket closure, installed readiness, cross-platform runtime and Telegram outcomes stay UNRUN and UNVERIFIED.                                      | Fake-only evidence cannot prove real boundary operation. Test engineering and the operator revisit when non-unit testing is authorized.          |

Founder-visible proof is a normal installed MCP interaction and a normal `status` command completing against the protected broker. The focused unit assertions are direct proof of the modelled deadline invariant and proxies for that live outcome.

## Worktree lifecycle

- Path: `.worktree/fix-ordinary-exchange-deadline`
- Branch/change: `fix-ordinary-exchange-deadline`
- Owner: test engineering
- Baseline: `daf0cf49d4782597b0c5e485165441fdcc6565ae`
- Status: active, tests written and red for the right reason, production correction pending
- Mergeable outcome: the ordinary authenticated local exchange uses the remaining original startup or command deadline instead of a fixed short per-exchange budget, with every existing safeguard and cleanup obligation intact.
- Nearest landing blocker: the minimal production correction, its deterministic unit result and independent review. Owner proposal and design are also unwritten.
- Next action: owner proposal and design, then the allowlisted production correction and independent integrated-candidate review. Preserve lifecycle ownership through landing or an explicit abandonment.
- Cleanup evidence: retained for active work. No cleanup attempted.

## Workflow follow-up

- No commit, push, PR, archive, merge, publication, installation, runtime operation or cleanup is performed by this task-authoring step. Those actions remain with their authorized owners and recorded gates.
- Record terminal landing and cleanup evidence outside immutable archive content. Preserve the live broker, protected state, credentials and every other retained worktree.
