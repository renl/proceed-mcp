# Preview CI checkout determinism

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
