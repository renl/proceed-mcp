# 02F — Fail-closed broker ownership correction

Parent: [tasks](../tasks.md). Authority: [design sections 4/7](../design.md), [02E R2/R7/R8](02e-review-plan.md), and [telegram-approval: Durable decisions and single resolution / Fail closed without misleading status](../specs/telegram-approval/spec.md). This is an internal correction checkpoint, not another branch or PR.

## Goal and scope

Founder-visible success remains unchanged: the human's decision reaches only its requesting running session, including after MCP timeout. This checkpoint prevents an unauthorized second writer from damaging that later proof; offline refusal/order assertions are proxies, not Telegram continuation proof.

- Worktree: `.worktree/add-telegram-approval-opencode-v2`; branch/change: `add-telegram-approval-opencode-v2`; lifecycle owner: test engineering; active, retain.
- Project baseline: `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. Authoring/production HEAD: `2e1190b0981ff336848c18c399802c41ca7b3e55`.
- Prerequisite: existing implementation at that HEAD on the same branch. No dependency on uncommitted containment work. Next: 02G consumes the shared offline harness, not 02F's production behavior.
- Status: reviewed correction implemented; attempt 1's ten affected assertions PASS on diagnostic Windows Node 22. Representative Node 24 acceptance and stronger race/quiescence evidence remain outstanding; see verdict below. Coordination's verification brief confirms review authorization.
- Cleanup evidence: executed test namespaces removed; worktree retained until verified landing or explicit abandonment. Next action: representative ownership acceptance and separately authorized 02G implementation.

## Implementation brief and files

Likely production touch points: `src/broker/runtime.js`, ownership helpers chosen by implementation engineering, `src/state/store.js` only if shared stopped-state checks require adjustment. Keep correction below approximately 20 files / 600 gross lines; measure new production changes separately from 02E's existing packets. Private exclusion mechanism and identity representation remain implementation choices.

Required behavior from design section 4:

1. Establish exclusive state-directory ownership before journal open/replay, tail truncation, mutation or polling. Listener availability alone is insufficient; different configured ports cannot share state ownership.
2. Refuse an existing live, stale, malformed or uncertain record without replacing/deleting it or changing journal bytes. Report unavailable ownership as exit 3, encountered storage/integrity errors as exit 4. An existence-only refusal need not read a record to refuse it.
3. Partial assembly failure and graceful shutdown release only ownership demonstrably acquired by that invocation, after journal activity stops. Preserve a replacement/unowned record.
4. No force/recovery flag, automatic stale-owner removal, PID-based stealing, listener fallback or journal repair. Ordinary crash restart may remain blocked. Disposal of wholly test-owned fixtures is not operator recovery authority.

Tests/support owned here: `tests/broker-ownership.test.mjs`, `tests/support/startup-guards.mjs`, `tests/fixtures/startup-guards-preload.mjs`. Reuse `tests/support/managed-spike.mjs` unchanged. Do not modify tests to match production or import them from production. Current bindings observe the implementation-selected `broker.lock` artifact and `fs.promises.open` journal seam; they do not prescribe a new lock identity schema. A changed artifact/seam must return to test engineering for equivalent boundary binding, not silently bypass assertions.

## Executable mapping and sequence

PowerShell/Windows native Node authoring command, outer bound 120 seconds:

```text
node --test tests/broker-ownership.test.mjs
node --test tests/host-version-admission.test.mjs
npm run format:check
git diff --check
```

Run ownership first after its correction; the second command is 02G's separate gate and remains RED until 02G is implemented. Rerun only affected failures. Node 22 authoring is diagnostic; provisional Node 24 execution and applicable OS-specific verification remain required before compatibility claims. No bootstrap/build/dependency changes here warrant repeating clean setup suites.

| Assertion | Executable ID | Expected result |
|---|---|---|
| Refuse prior record before recovery; preserve exact bytes | Five `OWN-REFUSE` cases | Live/stale/malformed exit 3; unreadable existence refusal 3 or encountered read failure 4; no journal open, header initialization or tail truncation; same record/journal bytes |
| Ownership before first recovery and own graceful release | `OWN-ORDER` | All observed journal opens have an owner record; own record absent after graceful shutdown |
| Failure cannot delete another record | `OWN-ASSEMBLY` | Existing record and corrupt journal unchanged |
| Changed record is not invocation-owned | `OWN-REPLACED` | Replacement bytes survive graceful shutdown |
| State isolation is not port isolation | `OWN-CONCURRENT` | Running owner plus differently configured contender: contender exits 3, record/journal unchanged |
| No record residue on failed fresh assembly | `OWN-FAILED-OWN` | Corrupt-journal fresh start exits 4 and leaves no owner record; this alone does not prove successful acquisition |

## Boundary Verification and environment

No real Telegram/OpenCode calls. Public `bin/proceed-mcp.js init`/`serve` run out of process in ignored, uniquely owned `tests/.artifacts/spike-*` directories under the existing finite harness. Real Windows ACL protection remains enabled. Setup command bound 10 seconds, readiness 8 seconds, completion 5 seconds, total per case 30 seconds plus existing bounded teardown. IPC requests the same SIGTERM shutdown path; it is test wiring, not a new production API. The preload refuses every HTTPS request before socket creation, supplies only fabricated environment values, observes journal opens without changing them, and injects EACCES only for the run-owned `READ_DENIED` record. It grants no admission or recovery bypass.

Existing harness owns registered process teardown and directory absence checks; this is not acceptance of the parallel non-breakaway containment work or permission for live execution. Fixture ports are OS-assigned then released before product binding; a collision fails readiness rather than choosing another product port. Production's finite ACL children run normally; no unknown process/data is killed or removed. Native Windows is appropriate for this diagnostic OS-lock/protection boundary, not cross-platform or Node 24 acceptance.

Decomposition checklist (02F/02G): 1 NO, 2 NO (separate namespaces), 3 YES (preload observer before journal open), 4 NO (no cross-case proof), 5 NO (setup/assertions colocated). Test-only observer/IPC artifact review and interface-fidelity review are required through coordination before implementation readiness.

## Gap and RED evidence — 2026-10-31

Historical preparation: `SPIKE-OWNERSHIP-001` was OPEN, correction attempts **0**, next owner implementation after review. The attempt 1 verdict below supersedes this status, not the original RED observations.

At pinned production HEAD, final combined affected command `node --test tests/broker-ownership.test.mjs tests/host-version-admission.test.mjs` exited **1**: 11 tests, 1 pass, 10 fail, zero cancelled/skipped, 37999.8782 ms. Ownership subset: **9 RED / 1 PASS**. Live-record refusal exited 3 but deleted its record and initialized the empty journal before refusal. Stale (including incomplete-tail), malformed and injected-unreadable starts reached readiness and exited 0 after harness shutdown instead of refusing. First journal open had no owner. Corrupt-journal assembly and competing-port refusal deleted another record; graceful shutdown deleted the replaced record. Fresh corrupt-journal cleanup passed only the no-residue check.

Bounded raw evidence retained locally at `.scratch/startup-regressions/red.tap`; authoritative summary is above. Cleanup **PASS** independently for every executed case: managed PID/directory checks succeeded and `tests/.artifacts` contained zero entries. Earlier harness-authoring runs failed before behavioral assertions (stripped PATHEXT, then Windows import path); corrected only test wiring, not production/protection. No controlled-harness-versus-host discrepancy was observed. No completed unrelated suite rerun, live boundary, calibration, real credential, environment file, PR/archive/push or feature verification.

Authoring checks: four new test/support syntax checks, `npm run format:check` and `git diff --check` exit 0; formatter excludes tests/planning by existing policy. No production/dependency/configuration edits. New owned preparation against authoring HEAD: **7 paths / 413 gross added lines**, comprising 405 new-file lines plus 8 task-index additions (excluding its preexisting 1-line review-plan pointer); no deletions/staged changes. Internal 02F packet: 4 new paths / 288 lines plus 8 shared task-index lines = **5 paths / 296 lines**. New production correction growth is unknown, not reserved permission.

## Attempt 1 — independent affected verdict (2026-10-31)

**Bounded assertion verdict: PASS; full ownership acceptance remains pending.** `SPIKE-OWNERSHIP-001` remains **OPEN**, production correction attempts **1**. Next owner: test engineering for representative-runtime acceptance and review of uncovered races/quiescence through coordination; implementation engineering owns any required correction. This is not feature verification or a race-proof claim.

- Immutable production candidate: `88754b63b79a43602b83fd23240c5ed586f89508`, project baseline unchanged. Candidate changes only `src/broker/runtime.js` and new `src/state/ownership.js` (2 paths, 184 additions / 100 deletions). HEAD matched before execution; no tracked production, dependency, configuration or existing harness changes were present. Tests/support were reviewed, untracked preparation files, not part of that production commit. Other dirty owner/containment artifacts were preserved and not used as proof.
- Windows native Node **22.23.1**, PowerShell, finite 120-second orchestration: `node --test tests/broker-ownership.test.mjs` exit **0**, **10 PASS / 0 fail / 0 cancelled / 0 skipped**, **31510.471 ms**. Exact test/support contents were unchanged during verification. Raw local evidence: `.scratch/ownership-attempt1/ownership.tap`. No scoped Node 24 executable was found; no runtime acquisition, global lookup or network install was attempted. Native Windows exercises actual filesystem exclusion and ACL checks, but this runtime remains diagnostic under the approved plan.
- Five `OWN-REFUSE` cases pass: public startup refuses existing records without journal open/recovery and preserves record/journal bytes. `OWN-CONCURRENT` passes for a running owner plus a different-port contender. This is genuine public-CLI/file-boundary evidence for those schedules, not simultaneous-acquisition stress proof.
- `OWN-ORDER`, `OWN-ASSEMBLY`, `OWN-REPLACED`, `OWN-FAILED-OWN` pass: owner exists at observed journal opens, graceful stop removes the ordinary own record, preexisting/replaced bytes survive the tested paths, corrupt fresh assembly exits 4 without owner residue. `OWN-ASSEMBLY` does not assert its exit code, and `OWN-FAILED-OWN` alone does not assert successful acquisition.
- Read-only affected review: ownership uses real `open(..., 'wx', 0600)`, writes and flushes its per-invocation identity before journal open, refuses EEXIST without reading/recovering it, and compares exact bytes before ordinary release. Runtime stops sweep/poller/delivery/listener, then awaits broker close before release; broker close marks closed, awaits its queue, and closes the journal. This supports the intended ordering but the existing tests do **not** instrument journal-close/flush completion or assert quiescence under an in-flight append, nor test simultaneous first acquisition, creation/write/sync faults, or replacement between the release comparison and unlink. The acquisition write-failure path also unlinks without a fresh identity check. These unexercised interleavings are limitations, not proven safe or newly reproduced defects; route stronger acceptance work separately rather than change tests/code in this verification.
- Cleanup **PASS** independently: existing harness checked registered PID absence and owned directory removal in every case; final `tests/.artifacts` held **0 entries**. No claim of completed non-breakaway containment or live-topology cleanup. No host-versus-controlled-harness discrepancy was observed.
- Separate `node --test tests/host-version-admission.test.mjs`: exit **1**, **0 PASS / 1 FAIL / 0 cancelled / 0 skipped**, **5426.1862 ms**; received **201 / no error code**, expected **503 / UNSUPPORTED_HOST**. Authentication and actual fixture `/api/info` assertions ran before this failure; later unchanged-journal/no-POST assertions were not reached and are not passed. Cleanup PASS, including fixture listener closure. Raw local evidence: `.scratch/ownership-attempt1/version.tap`. `SPIKE-VERSION-001` remains OPEN, attempts 0; see [02G](02g-version-regression.md).

No real Telegram/OpenCode boundary, useful continuation, replay/durability acceptance, cross-platform compatibility, clean bootstrap, PR/archive/publication or release gate was run or passed. Existing offline setup evidence is not replayed or promoted into this verdict. README's obsolete port/PID-lock explanation is noted for its implementation owner; no edit is authorized here. Worktree active/retained.

Post-verdict `npm run format:check` and `git diff --check` exited **0** (formatter still excludes tests/planning). Evidence preservation is limited to these seven reviewed paths: this slice, `slices/02g-version-regression.md`, `tasks.md`, `tests/broker-ownership.test.mjs`, `tests/host-version-admission.test.mjs`, `tests/support/startup-guards.mjs`, `tests/fixtures/startup-guards-preload.mjs` (planning paths relative to this change). The four runnable test/support files are the same bytes just executed, not post-verification test edits; tracking them is not a docs-only delta to the production candidate. The preexisting tasks pointer to the local, untracked 02E plan is preserved, not evidence that its artifact has been committed. Architecture, coordination, research, review-plan and containment files remain outside this preservation commit; the worktree is intentionally not clean.
