# Tasks

## Outcome and scope

Normal MCP use should reach authenticated broker readiness within the remaining original startup deadline without weakening admission. The first independently landable increment is the readiness-budget correction with its focused regressions, delivered in one OpenSpec PR into `main`.

- Baseline: `837f360afe67caac1c8011939d7b9ad2481f0a47`. No stacked parent or other active-change dependency.
- Inputs: [proposal](proposal.md), [approved design and fake-fidelity review](design.md), and the existing [availability contract](../../specs/opencode-session-continuation/spec.md#requirement-automatic-broker-availability-for-normal-mcp-use). The product author confirms no requirement delta. CLI v1.15.0 confirms `specs: skipped`, `design: done` and `tasks: ready` after the authorized top-level `skip_specs: true` declaration.
- Production allowlist: `src/broker/availability.js`, limited to the authenticated readiness budget. `src/http/local-client.js` is reference-only and already owns exchange deadlines and cleanup. Any needed production change outside the allowlist returns to the delivery coordinator.
- Delivery metadata, only if included: coupled preview.6 version fields in `package.json`, `package-lock.json` (both root entries) and `server.json` (server and npm package). No dependency changes. A routed documentation owner may update README version references only, not rewrite the README.
- Test ownership: `tests/authenticated-readiness-deadline.test.mjs`. Test criteria and any required release-metadata expectation updates remain with test engineering, not implementation.
- Exclusions: global timeout increases, guard removal/caching, retries or logging frameworks, refactors, setup/migration, state changes and live-broker operations. No source changes are part of task preparation.

## 1. Readiness deadline correction

- [x] 1.1 Prepare dependency-valid tasks and the focused Linux-compatible JavaScript unit suite. Verify CLI task dependencies and preserve the approved test artifact unchanged. Reuse supplied baseline evidence: 18 cases, 16 PASS and 2 expected RED against baseline `837f360afe67caac1c8011939d7b9ad2481f0a47`. This is reported prior evidence, not a new execution or green implementation result.
- [x] 1.2 Give authenticated readiness the remaining original startup budget in `src/broker/availability.js`, without resetting the 150,000 ms deadline or changing occupancy/TLS subcaps. Verify all focused unit assertions pass with the command below, including slow protected reads and near-expiry admission.
  - Evidence: `awaitSecureAvailability` passes `Math.max(1, remaining())` to `attemptReadiness`; occupancy still uses `PROBE_TIMEOUT_MS` and the TLS subcap stays `LOCAL_HANDSHAKE_TIMEOUT_MS` in `src/http/local-client.js`. `node --test tests/authenticated-readiness-deadline.test.mjs` -> 18 pass, 0 fail. Slow-protected-read case observes 4 reads, one `/v1/ready` request and a 4,000 ms total; near-expiry case observes 500/480/480 ms. Pre-change run of the same unchanged suite was 16 pass, 2 fail, matching the supplied reported RED.
- [x] 1.3 Retain all initial and stable ownership comparisons, cancellation/expiry gates, confidential admission, lifecycle validation and socket/agent/timer/listener cleanup. Verify the focused table-driven refusal and teardown assertions, and inspect the production diff against the approved design. Additional reads in the baseline RED case arise from timeout-induced retries. Do not remove security guards to satisfy its count.
  - Evidence: no guard, comparison, admission or cleanup line was removed or reordered. Production diff is one argument expression plus a comment in `src/broker/availability.js`. The suite's four-phase expiry/cancellation tables, ownership-substitution, lifecycle-mismatch and occupancy-cap cases pass, and every case's teardown assertion (timers cleared, sockets destroyed, agents destroyed, abort listeners detached, no synthetic secret in diagnostics) holds. `node --check` and the Prettier check pass on the source and on the unchanged approved test.
- [ ] 1.4 Resolve version disposition before PR preparation. Recommend preview.6 in the same functional PR if preparing the next distributable artifact. If selected, coordinate version-only metadata, README ownership and test-owner updates together. Verify coupled versions and `tests/release-metadata.test.mjs` after its expected-version update. Retaining preview.5 requires an explicit recorded release-preparation disposition, not a publication claim.

## 2. Independent integrated-candidate review

- [ ] 2.1 Record immutable implementation head/base and inspect the complete changed/untracked set. Verify the allowlist, focused formatting and syntax checks, affected unit results and CLI structural validation below. Reuse trustworthy unchanged evidence by revision and assertion scope. Record failures honestly and route corrections through the delivery coordinator.
- [ ] 2.2 Complete independent unit/static candidate review before owner finalization, archive or merge routing. Confirm any later finalization delta is docs-only or revalidate affected code, tests, dependencies, configuration or baseline. Verify candidate-specific landing/exposure risk disposition is recorded in the status log by its owner. Unit-only evidence is not runtime or release readiness.

## Test mapping and run sequence

All commands run from the assigned change worktree. Native unit/static commands are bounded to 60 seconds each, formatting/CLI commands to 30 seconds. No server, native helper or wire is started. Do not run `npm test` or directory-wide discovery because that includes prohibited suites.

1. If formatting dependencies are absent, the authorized bootstrap is `npm ci --ignore-scripts --cache .scratch/readiness-setup/npm-cache --no-audit --no-fund`, bounded to 120 seconds after `git check-ignore .scratch/readiness-setup/npm-cache`. Keep the lockfile unchanged and scratch ignored/local.
2. Format check before execution: `node node_modules/prettier/bin/prettier.cjs --check src/broker/availability.js`. Task-owner artifact check: `node node_modules/prettier/bin/prettier.cjs --ignore-path .gitignore --check openspec/changes/fix-authenticated-readiness-deadline/.openspec.yaml openspec/changes/fix-authenticated-readiness-deadline/tasks.md`. If necessary, use the same explicit file list with `--write` only for files owned by the executing role. Repository formatter defaults ignore tests and OpenSpec, so a default check is not proof of their formatting. Preserve the approved test unchanged. Do not format the repository or archive.
3. Syntax: `node --check src/broker/availability.js` and `node --check tests/authenticated-readiness-deadline.test.mjs`.
4. Focused units: `node --test tests/authenticated-readiness-deadline.test.mjs`. Expected completed result: all 18 cases pass. Slow-read and fast-exchange cases prove remaining-budget propagation in the synthetic model. Near-expiry and phase tables prove no fresh budget, no adoption after expiry/cancellation and no later unauthorized phase. Ownership substitution and lifecycle mismatch prove refusal. Occupancy cases preserve its subcap. Every case checks modeled teardown and synthetic-secret nondisclosure.
5. Only when metadata changes: after test-owner reconciliation, run `node --test tests/release-metadata.test.mjs`. Format the exact changed metadata/README files and inspect version-only diffs. No package build, pack, installed-artifact or publication test is authorized.
6. Structural check: `openspec validate fix-authenticated-readiness-deadline --strict` and `openspec instructions apply --change fix-authenticated-readiness-deadline --json`. Real schema errors return to the appropriate owner through the delivery coordinator. Advisory warnings do not create another gate. Never disable validation.

## Boundary Verification

Category: real local transport boundary plus existing normative availability/admission contracts. This block references the already approved [design decisions and combined boundary/fake review](design.md#boundary-and-test-fake-review), without changing them or requiring another unchanged review.

- Wire: `GET /v1/ready` over TLS-PSK at `127.0.0.1` and the configured port. Ownership supplies the PSK. Preserve TLSv1.2, `PSK-AES256-GCM-SHA384`, identity `proceed-mcp-local-v1`, profile/authorization validation, no session reuse/tickets and disabled renegotiation. Bearer authority follows secure admission and the pre-Authorization ownership comparison.
- Adoption: HTTP 200, the closed lifecycle envelope and matching instance/PID/port. Preserve all three stable-record comparisons plus initial discovery, 16,384-byte response limit and error classifications. The total remains 150,000 ms. Occupancy and TLS retain their separate 1,000 ms maxima clipped to remaining time. Retry spacing stays at most 100 ms, also clipped.
- Unit fidelity: production availability, secure-exchange sequencing and lifecycle validation execute against synthetic ownership, clock, TLS and HTTP collaborators. The approved fake checks destination, method/path, bearer placement, identity/key/profile and modeled resource release. No production seam is added.
- Real-boundary proof: UNRUN and UNVERIFIED under the project unit-only restriction. These units do not prove real TLS negotiation/confidentiality, native protected reads, OS event ordering, actual socket closure, installed startup or Telegram outcomes.
- Decomposition checklist: all five cross-unit triggers are NO. This is one correction and one shared suite with self-contained synthetic fixtures, no new persisted state, receiver or split proof chain. The supplied combined Architect approval covers unchanged boundary and fake fidelity.

## Checks and evidence

Preparation evidence: CLI v1.15.0 strict validation passes and apply instructions report `ready` with one of six tracked tasks complete. Scripts-disabled formatter bootstrap completed with no manifest/lock changes. Explicit task/metadata formatting and test syntax checks pass. No units were rerun. The unchanged approved test SHA-256 is `64b36103ae704bb23e98a43b59c3a657c585d561330dd7bc0f17ba813a64b4a2`. No production, runtime or native checks were executed.

| Stage        | Required observation / current state                                                                                                                                                            | Failure, owner and trigger                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-merge    | Focused units green after implementation, scoped format/syntax, structural validation and independent candidate review. Baseline remains 16 PASS / 2 RED, reused only for regression readiness. | Incorrect authenticated exchange budget. Implementation owner corrects before final review. Failed/unrun checks remain incomplete.           |
| Pre-exposure | Candidate-specific decision for unrun runtime/boundary checks in the status log. No existing release acceptance is inherited automatically.                                                     | Unit proxies cannot establish installed readiness. Product owner decides before archive/merge/exposure as applicable to the authorized step. |
| Post-deploy  | Owner manual verification of normal installed MCP readiness and actual Telegram approval outcome, only when separately authorized. Currently UNRUN / UNVERIFIED.                                | Reported live MCP timeout may persist for another reason. Operator verifies after deployment without bypassing guards.                       |
| Deferred     | Real protected-record/platform behavior, TLS/wire and actual cleanup proof, rendered/public workflow and cross-platform runtime verification. Currently UNRUN / UNVERIFIED.                     | Fake-only evidence cannot prove real boundary operation. Test engineering and operator revisit when non-unit testing is authorized.          |

Founder-visible proof is a successful normal installed MCP interaction with the expected human outcome. Focused unit assertions are direct proof of the modeled deadline invariant but proxies for that live outcome. The historical timeout's exact runtime cause remains unproven.

## Worktree lifecycle

- Path: `.worktree/fix-authenticated-readiness-deadline`
- Branch/change: `fix-authenticated-readiness-deadline`
- Owner: test engineering
- Status: active, ready for bounded implementation, not verified or landed
- Mergeable outcome: authenticated readiness uses remaining original startup time with every existing guard and cleanup obligation intact.
- Nearest landing blocker: production correction, green deterministic regressions and independent candidate review, then required owner/risk/authorization gates.
- Next action: implement tasks 1.2-1.3 on this branch, then settle coupled version preparation and return the immutable candidate for independent review.
- Cleanup evidence: retained for active work. No cleanup attempted. Lifecycle ownership continues through verified landing or explicit abandonment and safe removal.

## Workflow follow-up

- After independent candidate review and required owner/risk decisions, obtain separate archive and landing authorization. Deliver one change PR into `main`, with the authorized CLI archive inside it.
- No push, PR creation, archive, merge, publication, installation, runtime operation or cleanup is authorized by this task-preparation handoff.
- Record terminal landing and cleanup evidence outside immutable archive content. Preserve existing brokers, protected state, unknown work and all other retained worktrees.
