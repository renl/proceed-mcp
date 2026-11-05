# Preview CI checkout determinism

Current direction: [Linux primary CI preparation](preview-ci-linux.md). The user
approved replacing the primary Windows CI platform, not a Windows cleanup-risk
exception. Windows failures and the blocked diagnostic below remain historical
and separately pending. Linux success would not prove Windows compatibility.

## Goal and authority

The preview PR must pass formatting, build, exact installed-byte comparison and
public installed smoke with deterministic checkout bytes for all shipped text.

This is necessary correctness work for the existing single preview PR, not a new
capability or publication. Gap `PREVIEW-CI-EOL-001`, attempt 1, remains open until
the corrected candidate passes independent affected-risk verification and actual CI.
Next owner: implementation engineer, routed by project coordination.

- Checkout: `.worktree/add-telegram-approval-opencode-v2` from the project root.
- Branch: `add-telegram-approval-opencode-v2`, retained and active.
- Initial preparation baseline: `a63052fef877c94b39c058cb1a10a92b959960de`.
- Current correction baseline: `9f0b965f2ed56e2755951ac2dbad06dd7ba01bf6`.
- Target: `main` at supplied `de1c58021f4df25b03551faeb1b26958852275a7`.
- Delivery: same [PR 2](https://github.com/renl/proceed-mcp/pull/2), no extra PR.
- Acceptance: [non-publishing PR validation](../../openspec/specs/npm-distribution/spec.md#requirement-non-publishing-pull-request-validation).
- Historical approved criteria: [archived design](../../openspec/changes/archive/2026-11-05-add-telegram-approval-opencode-v2/design.md), section 8, read-only.

## Evidence and intended correction

[Actual run 42048201506](https://github.com/renl/proceed-mcp/actions/runs/42048201506)
tested the preparation baseline. Checkout, setup-node, version, npm ci and preview
metadata/policy/artifact tests succeeded. The workflow Prettier command failed
with exit 1. Build and installed-package smoke were skipped, not passed.

The committed workflow uses LF. `.prettierrc.json` requires `endOfLine: lf`, but
there is no `.gitattributes`. The regression reproduces a real Git checkout with
`core.autocrlf=true`, then checks the resulting bytes using installed Prettier
3.9.10 and the existing formatter settings. Native Windows Git is representative
of this checkout risk. No application environment is needed.

[Official Git attributes documentation](https://git-scm.com/docs/gitattributes),
`text` and `eol`, defines checkout conversion. Explicit `text eol=lf` keeps an LF
index entry LF in the working tree. Without `eol`, checkout follows host settings.

The initial correction was one workflow rule, committed as `9f0b965f` after
preparation `6e291015` (175 preparation gross lines + 1 source line = 176).
That history is not reset by this broader correction.

[Actual run 42050419703](https://github.com/renl/proceed-mcp/actions/runs/42050419703)
tests `9f0b965f`. Required test selection, workflow formatting and build PASS.
Pack/install reaches `tests/release-pack.mjs:83`, then fails with
`AssertionError [ERR_ASSERTION]: installed contents equal clean package input`.
Installed `bin/proceed-mcp.js` has 287 bytes versus 288 staged bytes. The diff
removes CR only from the shebang newline. Other shown CRLF remains. The public
installed smoke at line 94 is not reached and is NOT passed. This is the same
checkout reproducibility gap, not an unrelated runtime defect.

The invalid initial ignored-probe result is not evidence of a passing checkout
or ignore check. Later real checkout controls and the explicit successful
`git check-ignore .scratch/preview-ci-eol/probe` establish the scoped fixture path.
Both actual CI failures above remain failures, not superseded passes.

## Complete shipped-input classification and correction brief

`package.json.files` selects `bin`, `src`, `README.md`. The maintained pack runner
stages those plus mandatory `package.json` and `LICENSE` (lines 56-83). Inspection
finds 46 shipped inputs: 1 executable JavaScript file, 42 source JavaScript files,
README Markdown, MIT license text and JSON metadata. All are valid UTF-8 text
without NUL, with canonical Git LF and current working-tree LF. There are no
shipped binary inputs. The pack allowlist rejects other paths, and the regression
fails for a newly introduced non-JavaScript file under bin/src until reclassified.

[Official npm files documentation](https://github.com/npm/cli/blob/latest/docs/lib/content/configuring-npm/package-json.md#files)
explains inclusion of files/directories and mandatory README/LICENSE/package.json.
[Official bin-links v6.0.0 source](https://github.com/npm/bin-links/blob/v6.0.0/lib/fix-bin.js)
replaces only a CRLF shebang with LF during executable installation. This matches
the actual runner diff. It does NOT justify saying npm normalizes every text line,
nor weakening installed-byte equality. The source is explanatory, not a claim
that the runner's exact npm dependency version was independently identified.

Git `text eol=lf` pins canonical LF checkout despite autocrlf. Attribute directory
patterns do not recurse, so use `**` for JavaScript. Restrict by extension to avoid
converting future binary files. Proposed root `.gitattributes` content:

```gitattributes
.github/workflows/*.yml text eol=lf
bin/**/*.js text eol=lf
src/**/*.js text eol=lf
/README.md text eol=lf
/LICENSE text eol=lf
/package.json text eol=lf
```

Implementation source scope: `.gitattributes` ONLY, ceiling 20 gross changed lines.
Preserve the existing workflow rule and append the five package-input rules.
No workflow/Prettier/package/production edits, blanket attributes, archive/test
normalization, `git add --renormalize`, global configuration or weaker assertions.
The broader config affects checkout only. Canonical package files, published
artifact and runtime contract remain unchanged. No publication is authorized.

## Executable mapping and run sequence

`tests/release-preview-ci.test.mjs` adds real checkout/Prettier calibration and an
actual-attributes regression to the existing policy suite. Fixtures use unique
ignored `.scratch/preview-ci-eol/checkout-*` directories. Git commands have
10-second limits and fixture cleanup runs in `finally`, with absence asserted.
System/global Git config and template inheritance are disabled for fixtures.

Use PowerShell on Windows with the project-owned Node 24.22.2 executable assigned
to `$node`. Do not use the host-default Node 26. Run from the implementation
checkout. No install or runtime startup is needed for the local checks.

1. `& $node --version` must report `v24.22.2`.
2. `& $node --check tests/release-preview-ci.test.mjs`.
3. `& $node node_modules/prettier/bin/prettier.cjs --check .github/workflows/ci.yml docs/verification/preview-ci-eol.md`.
4. `& $node --test tests/release-metadata.test.mjs tests/release-preview-ci.test.mjs tests/release-artifact.test.mjs`.
5. `git diff --check`. Inspect the exact changed path set and archive preservation.
6. After source correction, run `& $node scripts/build.mjs`, then the existing
   `& $node tests/release-pack.mjs` with explicit project-owned npm CLI assigned to
   `PROCEED_TEST_NPM_CLI`. Clear `PROCEED_TEST_ARTIFACT_DIR` for this process so the
   fresh artifact cannot overwrite published retention. Pack runner owns offline
   fixture install and cleanup, with 150-second aggregate and 180-second outer
   command limit. Do not alter real working files to force a pass. A local LF
   checkout pack pass alone cannot prove actual CI checkout determinism.
7. After the separately authorized push, actual PR CI must pass the unchanged workflow,
   including build and `tests/release-pack.mjs` installed smoke. A local policy
   pass does not substitute for GitHub execution. Bound local checks to 120 seconds.

Before implementation, the expected RED result is only the new shipped-input
actual-attributes regression. Existing missing/CRLF/wrong-extension workflow
controls remain. Workflow-only attributes must leave all 46 package paths CRLF
and uncovered. The complete proposed policy must reproduce canonical LF bytes
and effective `text=set`, `eol=lf` for all 46 paths, while workflow formatting
passes. A NUL/CRLF binary under bin stays byte-identical, with attributes unset.
Tests and archive sentinel attributes must remain unset. Do not replace the
actual-file assertion with the calibrated specimen. Each command above is finite.

## Initial preparation results (historical)

Executed on Windows with Node 24.22.2 against the baseline plus the new test:
syntax PASS, suite 6 PASS / 1 expected RED, exit 1. All three negative controls
and the proposed LF control passed. The real repository regression observed
`{ crlf: true, formatted: false }`, not the required LF/formatted result.
Fixture cleanup assertions passed independently of the expected RED assertion.
The complete existing preview CI test selection also ran: 16 PASS / 1 expected
RED, exit 1. Syntax, workflow/brief Prettier and whitespace checks passed.
All 104 archived change file blobs match baseline bytes using unfiltered Git
hashes. The fixture directory has zero remaining checkout children. Only the
test and this brief belong to the preparation commit. Concurrent coordination
status-log edits are excluded and preserved.

Proof: real Git checkout bytes and formatter results answer the changed risk.
Proxy: policy parsing alone cannot prove host checkout determinism. Actual CI
must separately prove downstream build/installed smoke are reached and pass.

## Broader correction preparation and revalidation

Node 24.22.2 syntax PASS. The complete preview selection executes 19 tests:
18 PASS / 1 expected RED, exit 1. The RED identifies all 46 package paths as
CRLF and missing effective attributes under the actual workflow-only policy.
The existing workflow real-file regression passes. Full-policy calibration
passes exact round-trip bytes and rule coverage across all 46 paths. Existing
three negative workflow controls, workflow-only package negative control and
binary/non-target controls pass. Fixture cleanup assertions pass separately.
This is real Git checkout proof, not pack/install or public-smoke success.
Syntax, workflow/brief Prettier and whitespace checks PASS. Raw Git blob hashes
match for all 104 archived change files plus the archive index `.gitkeep`.
No checkout fixture directories remain. Coordination dirt and all retained
originals, recovery notes and artifacts are excluded from this preparation.

This config change ends blanket docs-only evidence reuse. Revalidate checkout,
formatter and preview CI on the immutable corrected candidate. Reuse accepted
application, metadata, supplied live and package evidence only for unchanged
inputs/assertion scope. `.gitattributes`, tests and this brief are outside package
files. The LF policy matches existing canonical package blobs, not a new package
content revision. No new tarball equality, live Telegram or publication claim is
made. Reuse unchanged accepted runtime/live and metadata evidence only for its
original assertion scope. Independent corrected-candidate checkout, build and
maintained pack/install/public smoke are next, followed by actual CI. A fresh
artifact has its own identity and must not replace published retained bytes.

All 104 archived change files must remain byte-identical to the preparation
baseline, including any subsequent finalization. Archives are never edited or
backfilled. Preserve the six excluded originals, three recovery notes and all
retained artifacts. Worktree cleanup remains blocked by the open PR and retained
material, independently of fixture cleanup.

No new wire, payload, public contract or cross-unit sequencing is introduced.
The existing GitHub workflow boundary is unchanged. Decomposition checklist:
all five triggers NO for new cross-unit obligations. No extra contract review
is needed for this single tooling correction. An unexpected host-only difference
after the controlled checkout proof passes is a stop/report condition, not
permission for another narrowing hotfix.

Forecast: this coherent amendment plus source and final evidence stays within
600 gross changed lines, including the prior 176-line history. Reused controls
are counted once in the final diff, not presented as new work or a reset cap.
The source-only proposed ceiling is 20. No new worktree, archive operation,
main commit, push, PR management, merge or publication is authorized here.

Before final evidence additions, the amendment measured 191 gross lines
(112 brief + 79 tests). The cumulative selected diff from the original baseline
was 307 gross, counting reused controls once, including the existing source rule.
Conservative sequential history was 176 + 191 = 367. Reserve the remaining budget
for this evidence, at most 20 source lines and independent verification evidence.

## Installed-smoke diagnostic follow-up

Candidate `fbbc1ffb529959bc07438d372df4002dc0bc26d3` reaches a new failure in
[run 42053517930](https://github.com/renl/proceed-mcp/actions/runs/42053517930).
Checkout, setup, preview tests, formatter, build and installed-byte equality PASS.
The installed public smoke exits 1 at the pack runner's line 94. Its failing
assertion is unknown. Neither a runtime regression nor nonregression is proven.
The previous two failures remain historical failures. The earlier EOL packet's
reported 382 gross history is retained, not reset or enlarged by this diagnostic
unit. This is the third CI hotfix unit after two config corrections, not a third
configuration fix or a claimed resolution of the smoke failure.

Actual CI logs qualify Windows Server 2025, build 10.0.26100, runner image
`windows-2025-vs2026` version `20261103.298.1`, Node 24.22.2 and npm 11.19.1.
They show about eight seconds for the whole pack/install/smoke step, not eight
seconds for a known smoke phase. The shim uses cmd.exe. Protected CLI operations
use powershell.exe and icacls through production code. The smoke's synchronous
CLI limit is five seconds while the production ACL helper limit is twenty.
This is an unconfirmed timing lead, not grounds to change either deadline.
The actual ACL, shim, broker and MCP outcomes cannot be recovered from these logs.
No deleted or private log reconstruction is authorized or attempted.

Source inventory still contains 43 JavaScript paths across bin/src plus
package.json, README.md and LICENSE, totaling 46 staged inputs. Git shows no
change to these paths between `a63052fe` and this candidate. A reported fresh
45-file count versus an old 46-file count does not identify a changed path.
No runtime-file change is inferred without an actual manifest path diff.
Published tarball `43866cb0` and candidate tarball `e8f754...` remain distinct
identities. Neither is overwritten or republished.

The diagnostic-only change covers the two release runners and their existing
release-artifact test support. A fixed phase vocabulary, bounded elapsed time,
allowlisted error code, numeric exit and separate assertion/cleanup outcomes
are written to a run-local JSON report. The parent sanitizes again before
printing or retaining it. Missing reports yield an unknown/OTHER result, not
a pass. No message, stack, path, child TAP/stdout/stderr, authority, action or
state payload is included. Raw child TAP is no longer persisted. The existing
run directory is removed in the original bounded finally path. Package cleanup
has its own explicit pass/fail result. No assertion, deadline or expected result
is weakened. No application, workflow, dependency or configuration edit is made.

Local Windows Node 24.22.2 checks PASS: runner syntax, two diagnostic calibration
tests, complete preview selection 19/19, brief Prettier and whitespace. The
artifact-retention test also passed separately before the combined selection.
Calibration covers normal
and failure summaries, synthetic private markers in all candidate fields, and a
deliberately failing child whose report remains safe. Its disposable directory
absence is asserted separately. This does not count as installed-smoke success.
The earlier attempted worktree-relative runtime path did not exist. Qualification
then used the retained runtime in the primary checkout, as documented by the
existing readiness note. No global runtime/config/state discovery was used.

No additional pack was run locally. No npm CLI was found in the inspected
project-owned tooling, preview-preparation or dependency directories. Do not
install tooling or probe global stores just to replay the prior local pack pass.
The unchanged workflow supplies its explicit setup-node npm CLI and isolated
pack runner config/cache on the next authorized push. Before that push, run
`node --test --test-name-pattern="PREVIEW diagnostic" tests/release-installed.test.mjs`
using qualified Node 24.22.2, then the existing artifact test and syntax checks.
After the push, observe the new PR run using
`gh run list --repo renl/proceed-mcp --workflow ci --branch add-telegram-approval-opencode-v2 --limit 1`.
Use `gh run view <new-run-id> --repo renl/proceed-mcp --log-failed` for the
allowlisted phase report. Do not rerun the old opaque CI job.

Merge remains blocked pending actual required smoke PASS. If the new evidence
shows a design/environment gap, coordination must route the exact phase/code,
candidate and environment to architecture review before a fourth correction.
Production fixes belong to implementation, environment/workflow fixes to their
owner, and test semantics to the canonical contract owner. No blind retries,
host-specific assertion patches, Telegram, archive edits or publication follow.
All 104 immutable archive hashes are reused unchanged. Concurrent status edits,
six excluded originals, three recovery notes and retained artifacts stay untouched.

## Architect-audited timing correction: blocked on cleanup coverage

Audited candidate: `cf512ea9873688c4c6ca249aa76c711025889ce8`, target
`de1c5802`. Supplied actual CI merge candidate `463dd281` contains that head.
Its supplied Windows image is `20261030.294.1`. The earlier image claim above
belongs to its historical run and is not silently replaced. The 5246ms diagnostic
is cumulative smoke elapsed time, not an ACL measurement or pure runner cost.

Root-cause classification: test budgets undercut reachable production deadlines.
This establishes a harness defect, not whether production would succeed with a
valid budget. No five-second init performance promise is established. Production
code, public assertions and installed-byte equality must remain unchanged.

The audit permits these ceilings, clipped to an absolute remaining work deadline:

| Phase | Ceiling | Reachable dependency |
|---|---|---|
| init, owner-add, broker-ready | 45s each | Two sequential 20s ACL helpers plus 5s orchestration |
| status, status-after | 15s each | 10s HTTP inactivity deadline |
| prepare | 25s | Registration and preparation exchanges |
| unpaired-refusal | 15s | Public refusal exchange |
| Lightweight CLI / protocol | Existing 5s / 8s | No longer dependency |

Shared managed work is 120s, not the sum of all phase ceilings. A phase must not
start without remaining work budget. Reserve at least 13s for two resources:
2 x (3s tree termination + 3s absence verification) + 600ms filesystem retry
backoff. Proposed outer limits remain smoke test 140s, child 145s, package 150s,
local command 180s and workflow 5min. The package must refuse to start smoke
unless a full 145s remains after its own 5s cleanup reserve. This is feasible
only if preceding package work fits the remaining allowance. These ceilings are
not performance promises and do not allow every phase to consume its maximum.

Feasibility review stops before implementation for these concrete reasons:

- `tests/release-installed.test.mjs:111-118` uses transient `spawnSync` CLI
  children outside `context.resources`. Timeout can terminate their Node root
  while PowerShell/icacls descendants remain. The synchronous wait also prevents
  the managed JavaScript timer from interrupting it.
- `tests/support/managed-spike.mjs:43-50,75-96` can terminate a still-live tree
  with `taskkill /T` and check root plus explicitly reported descendant PIDs.
  `tests/fixtures/release-observer.mjs` reports readiness, not descendant PIDs.
  Once an unreported parent exits, these facilities cannot establish absence of
  its surviving descendants. Registering the CLI root alone does not close this
  gap. No orphan has been observed in this review. The issue is missing proof.
- Production `src/state/protection.js:73-84` runs a 20s `execFile` PowerShell
  helper whose script invokes icacls at line 29. Parent/helper timeout paths
  therefore have a real descendant risk, not only a hypothetical test fixture.
- Managed `totalMs` ends before cleanup. Its filesystem retry settings bound
  retry backoff, not every filesystem operation's duration. An unconditional
  hard cleanup guarantee cannot be inferred from the 600ms setting.

Verdict: BLOCKED within the authorized files and existing facilities. No timing
code is changed, no calibration or installed-smoke pass is claimed, and no CI
push/rerun is ready. Raising only constants would leave the exact failure path
unowned and would misrepresent the cleanup floor. General process containment,
observer changes and shared-harness changes remain outside this authorization.

Practical decision for project coordination: keep the gate blocked, or request
explicit user acceptance for one diagnostic run on a disposable Windows CI
runner with possible unverified descendants until runner disposal. The latter
is a scoped cleanup-risk exception, not successful cleanup or merge permission.
Recommend keeping the gate blocked unless that diagnostic risk is accepted.
Without an exception, stronger descendant ownership requires separate scope.

Before growth, this blocked evidence-only unit forecasts at most 100 gross lines,
below 600. Earlier EOL history remains 382 gross and diagnostic history remains
218 gross, separately recorded without resetting or relabeling either. No new
fixture, npm tooling, process, package or artifact is created by this review.

Review checks PASS on Windows Node 24.22.2: both release-runner syntax checks,
brief Prettier and whitespace. All 104 archive blobs match HEAD. Three recovery
note hashes, custody manifest and retained published tarball match their recorded
hashes. The index was empty at intake. Coordination status dirt and six excluded
originals remain unselected. No resource-owning validation was started, so there
is no new process-cleanup result. Actual Windows CI remains required and blocked.
