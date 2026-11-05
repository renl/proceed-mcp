# Preview CI checkout determinism

## Goal and authority

The preview PR must reach its build and installed-package smoke checks without
host checkout line endings causing a false formatting failure.

This is necessary correctness work for the existing single preview PR, not a new
capability or publication. Gap `PREVIEW-CI-EOL-001`, attempt 1, remains open until
the corrected candidate passes independent affected-risk verification and actual CI.
Next owner: implementation engineer, routed by project coordination.

- Checkout: `.worktree/add-telegram-approval-opencode-v2` from the project root.
- Branch: `add-telegram-approval-opencode-v2`, retained and active.
- Preparation baseline: `a63052fef877c94b39c058cb1a10a92b959960de`.
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

Only production change authorized for the implementation handoff:

```gitattributes
.github/workflows/*.yml text eol=lf
```

Create root `.gitattributes`, with a source ceiling of 10 gross changed lines.
This deliberately covers only workflow `.yml` files, not all repository text.
Do not change workflow commands, formatter settings, package inputs or application
behavior. Do not renormalize tracked files or change global Git configuration.
If a different rule is necessary, return its evidence before expanding scope.

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
6. After the authorized push, actual PR CI must pass the unchanged workflow,
   including build and `tests/release-pack.mjs` installed smoke. A local policy
   pass does not substitute for GitHub execution. Bound local checks to 120 seconds.

Before implementation, the expected RED result is only the actual-attributes
regression. Missing attributes, explicit CRLF and a wrong `.yaml` pattern must
produce CRLF and fail formatting. The proposed `.yml` rule must produce LF and
pass formatting inside calibration. Do not replace the actual-file assertion
with the calibrated specimen.

## Preparation results and revalidation

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

This config change ends blanket docs-only evidence reuse. Revalidate checkout,
formatter and preview CI on the immutable corrected candidate. Reuse accepted
application, metadata, supplied live and package evidence only for unchanged
inputs/assertion scope. `.gitattributes`, tests and this brief are outside package
files, so this narrow correction does not change packaged input bytes. No new
tarball equality, live Telegram or publication claim is made.

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

Forecast: fewer than 300 gross changed lines for tests, source, this brief and
final evidence, within the 600-line packet. No new worktree, archive operation,
main commit, push, PR management, merge or publication is authorized here.
