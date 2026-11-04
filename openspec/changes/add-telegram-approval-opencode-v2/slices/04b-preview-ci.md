# Packet B: nonpublishing CI and fail-closed release preparation

Parent: [preview delivery](04-preview-delivery.md). Authority: [npm delta](../specs/npm-distribution/spec.md), [design](../design.md) section 8, [proposal](../proposal.md). Status: partial test preparation, ready for combined review of the brief, NOT implementation-ready until the missing interfaces below are returned through coordination.

## Outcome, baseline and scope

Can a fork PR validate the installable preview without publishing or receiving publishing authority, while incomplete release prerequisites prevent publication?

PR-run build/package/install results are direct CI proof only after execution on GitHub. Local text checks and policy fixtures are supporting guards, not GitHub execution, npm authentication or publication proof. Exact public npm installation and MCP listing remain later external proof.

- Existing worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, active/retain. One change, one PR to `main`, no extra worktree or PR.
- Packet baseline `68bca7936839f59cbee3a202f99293f514a60ec2`. Accepted source `09ab93123794a28d9d8e5c6eeff9145d9829cf38`, installed test repair `202b97443000f825d4501e141227e04136bab30f`. Original whole-change base `f385409792aff3d46d96b5c4f03358f10c8dc5ba`.
- Reuse Packet A's Windows Node24.22.2 installed assertions and artifact SHA-256 `2de5452368980e1dd94704de5ab14f4a8602311816a5c211585599ff8a4bd5be` within their recorded source/input scope. That hash binds the then-dirty README, not future changed package inputs. Do not replay long application suites just for a CI label.
- This preparation edits only `tests/release-ci.test.mjs`, this linked slice, the parent slice and active tasks. Workflows, package, source, README, specs and operations remain read-only. Known eight dirty owner documents and unknown containment/research paths remain excluded and preserved as recorded in the parent.
- Source proposal after review: `.github/workflows/ci.yml`, `.github/workflows/release.yml`. No package/dependency/runtime change presumed. An optional private helper is permitted for proposal only if implementation identifies a maintained need and exact interface. No arbitrary general release framework.

## Missing implementation interfaces - consolidate before binding tests

No workflow or release-validation entry exists at the baseline. Do not manufacture a production CLI, input schema, exported policy function or YAML parser API in test fixtures. Coordination must obtain one implementation feasibility response for these four items, then route any normative additions to architecture:

1. **Workflow parse/graph check.** Select an existing available parser/linter or an explicitly reviewed narrow workflow representation and command. No YAML dependency is installed or added here. Text guards below do not resolve YAML aliases, expressions, job dependencies, dynamic commands or reusable actions. Parsed structure and reviewed invoked commands must establish the actual publishing reachability boundary.
2. **Release decision seam.** Identify how deterministic offline tests supply event/ref, package/tag/channel, checked-out commit, approved-main membership, validation outcomes and missing independent evidence/authorization. Return actual invocation/input and bounded exit/output behavior. No boolean supplied by an untrusted PR or arbitrary dispatch input may substitute for trusted candidate evidence or authorization. Whether this is a workflow expression plus scoped validation script or existing command is implementation-owned.
3. **Evidence binding.** Select a trusted record location and verification mechanism binding independent acceptance, documentation/rights and exact candidate/artifact. Define missing, malformed, stale and mismatched behavior as blocking. A checked-in `verified:true`, a user dispatch flag or a passing package test alone is insufficient. No invented evidence schema or approval authority here.
4. **Artifact handoff.** Existing `tests/release-pack.mjs` writes filename/hash/inventory then removes its entire run, including the checked tarball, in `finally`. Therefore it cannot yet supply a retained publication artifact. Return a minimal proposed test-runner export/retention contract before test engineering changes that runner. The test-owned runner stays maintained and must retain teardown, isolated config and hash/content assertions. Publishing must consume the same successfully installed bytes, never repack or publish a directory. A later Linux publish job cannot claim the Windows-tested artifact by rebuilding it.

These are missing implementation/verification interfaces, not new product identity questions. Intended npm account `davemeshimize`, MIT attribution, namespace, version and channel are settled inputs. Coordination assigns any gap IDs and routing. No correction agent is dispatched by this preparation.

## Minimal implementation constraints for combined review

### PR validation

- Use unprivileged `pull_request`, read-only `contents`, GitHub-hosted Windows and pinned action revisions. No `pull_request_target`, publishing job/path, registry auth secrets, `id-token:write`, protected environment or token persistence in checkout. Do not invoke the release workflow or inherit secrets. Fork PRs must use the same nonpublishing checks.
- Select Node24 and verify the runtime. Dependency bootstrap is a clean lockfile-based development install without publishing auth. Build with `node scripts/build.mjs`. Run focused CI policy/metadata checks before pack/install, then the existing `node tests/release-pack.mjs` using explicit `PROCEED_TEST_NPM_CLI` resolved from the selected CI runtime, not a workstation path.
- Invoke the maintained runner directly, not `npm test`, which includes historical live prerequisites and unknown containment tests. Preserve bounded job/step deadlines, phase/failure records and separate cleanup evidence. No new live harness, OS matrix or global install. Real CI bootstrap is a future authorized GitHub run, not executed in this offline preparation.

### Release validation and hard-disabled authority

- Separate `release.yml` handles only protected `v<package-version>` tag pushes. Confirm exact repository/package/MCP identity, `0.1.0-preview.1`, `v0.1.0-preview.1`, `preview`, approved main ancestry and all required validation/evidence before any publishing step. Missing/ambiguous inputs fail closed. No branch/PR/dispatch override.
- Validation needs source read only. Future publishing uses a clean GitHub-hosted Node24 job with npm >=11.5.1, no release-build cache and pinned dependencies/actions. Only that future authorized job may receive `contents:read` and `id-token:write`. Publish only the checked tarball with explicit `--access public --tag preview`, never `latest`, a directory or a repacked artifact.
- Current repository has no configured workflows/environments, per supplied operations evidence. `npm-preview` is a proposed environment name, not configured protection or authorization. No protected-environment configuration or npm trust setup is authorized here. A named environment alone is not proof of protection. With trust/protection/bootstrap unresolved, publishing must remain unreachable or explicitly blocked. No token fallback, secret input, pretend OIDC success or merely configurable `publish=true` escape.
- First publication is expected to be user-operated interactive npm login/2FA after a verified merge. The current npm delta still requires CI publication. The specification owner must explicitly align this first-bootstrap exception before any live publish. This brief does not amend that requirement or authorize a manual workaround. Browser login progress does not establish package rights or configured trust.

## Runnable mapping and release decision matrix

`tests/release-ci.test.mjs` provides one shared conservative PR text guard and its table-driven positive/hazard calibration. The real-file test requires `ci.yml`, read-only contents, Windows and maintained build/pack invocations. It intentionally rejects suspicious constructs even in comments. These are necessary lexical checks only. String presence does not establish valid YAML, step execution, complete permission scope or absence of indirect publishing. Do not label them YAML structural validation.

Bind the following cases to the returned real release decision seam in one shared table-driven suite. Expected result for each negative is nonzero/blocked before a publish invocation, with no auth/config/network operation. Until that seam is selected these cases are BLOCKED, not executable or passed:

| Case | Mutation from a complete eligible preview | Required observation |
| --- | --- | --- |
| Identity | Wrong package/repository/MCP namespace, or inconsistent package metadata | Block |
| Event | PR, fork PR, branch push or arbitrary dispatch instead of protected tag push | Block |
| Version/tag | Missing, malformed or mismatched tag/version, stable or other prerelease version | Block |
| Channel | Missing channel, `latest`, or other channel | Block |
| Main | Tag commit outside approved main history, missing main ref or failed ancestry check | Block |
| Checks | Failed/missing build, metadata, contents, installed smoke or cleanup | Block |
| Evidence | Absent, malformed, stale or candidate/artifact-mismatched independent acceptance | Block |
| Authority | Missing rights/docs approval, protected authorization, bootstrap or npm trust | Block |
| Artifact | Missing retained tarball, hash mismatch or changed bytes after smoke | Block |
| Offline control | All selected non-auth inputs valid, publication still disabled | Validation may succeed, zero publish calls |

Real configured trust/2FA/protected approval and actual publishing success cannot be positively calibrated offline. Do not assert mock token/OIDC success as authentication proof. A future approved actual PR run must report build, package, installed smoke and cleanup by revision. A future publishing run requires separate authorization and real external proof. No network publish sink or live service is introduced for these tests.

## Ordered checks, budgets and boundary review

Initial checks use Windows PowerShell with project-local Node24.22.2 at `../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` from the worktree. Commands are finite, offline, with shell outer deadlines. No service or npm install is needed for this preparation.

1. Syntax: `& $node --check tests/release-ci.test.mjs` (10s). Scoped whitespace: `git diff --check -- <four-owned-paths>` (10s). Prettier policy: `& $node node_modules/prettier/bin/prettier.cjs --check <four-owned-paths>` (20s). Existing ignores mean this is not their formatting proof.
2. Calibration only: `& $node --test --test-name-pattern='calibration' tests/release-ci.test.mjs` (10s). Full test: `& $node --test tests/release-ci.test.mjs` (10s). Baseline should fail missing `ci.yml`. Later full GREEN establishes only the stated text guard. No full application or pack rerun at this preparation stage.
3. Check relative document links. Reuse unchanged strict-validation evidence at `68bca793` within delta-spec scope. Any new syntax/links or changed normative artifacts require affected structural validation. No claim that prose task mapping executes policy.
4. After interface selection and combined approval, test engineering binds real negative cases before source implementation. Then cheap syntax/format/parsed checks, release policy suite, focused metadata/build and maintained installed runner as affected. Preserve Packet A evidence for unchanged inputs. Actual CI and publication stay later authorized gates.

Packet B source ceiling180 gross, test/fixture allocation180, docs/evidence allocation180 and reserve60 totals600 across the exact selected scope. Earlier460 was provisional, not a promise. Stop for a concrete split/revised scope if the selected interfaces cannot fit. Count all additions plus deletions from baseline, including sequential corrections. Do not compress code or exclude evidence to meet the cap. The oversized whole PR still needs its separate concrete scope decision before landing. This packet neither grants that exception nor authorizes archive/merge/publication.

Boundary Verification: normative CI/release contract is design section8 and the npm delta, using their exact package/tag/channel identities. No new public schema or function is selected. GitHub Actions execution, protected authorization and npm trusted publishing are real external boundaries. This preparation proves none of their actual execution/authentication. Reuse pinned design research, do not retry the previously denied MCP Registry schema fetch. Registry auth/namespace/schema remain separately gated. Combined architecture review must cover boundary, test fidelity and decomposition: triggers1YES (artifact/evidence consumers),2YES (clean retained artifact),3NO,4YES (Windows smoke to release),5YES (setup/validation/publication split). No implementation-ready signal before missing interfaces and triggered review are resolved.

Lifecycle: retain the existing worktree, branch, owner and all owner/unknown material. No runtime resources start in these text tests. Preserve ignored calibration evidence. No cleanup of unknown files or worktree is due. Return the exact owned commit and scoped gross count through coordination, with RED, blocked and external proof statuses separate.

## Preparation evidence - 2026-11-05

- Live baseline confirmed once at `68bca793`, branch and retained worktree as above, empty staging area. Known owner dirt and unknown paths matched the parent inventory and were left untouched. This is the assigned serial Git window, not permission for concurrent writers.
- Windows project Node24.22.2: syntax PASS. Calibration command exit0, 1/1 PASS covering a safe excerpt and15 hazardous excerpts. Full command exit1, 1PASS/1 expected RED, zero cancelled/skipped/todo. Failure is `ENOENT` for missing `.github/workflows/ci.yml`. Subsequent real-file assertions are UNREACHED, not passed. No YAML parse or release-policy negative execution is claimed.
- Scoped whitespace and formatter-policy commands exit0. Formatter ignores tests/OpenSpec, so readable owner review applies, not formatter coverage. Evidence `.scratch/packet-b/{calibration,red}.tap`, matching `.stderr`, and `exits.json`. These are ignored and retained, not shipped package inputs.
- No install/build/pack/application/live/network/auth operation ran. Packet A proof is reused only as stated above. Assertion calibration PASS and expected workflow RED are separate from cleanup: no runtime resources started, no cleanup needed, worktree retained. Release-policy binding and all configured publishing/authentication checks remain BLOCKED on the listed interfaces and authority.
- Local document target checks PASS201 references across the three owned documents, not anchor or remote checks. Final preparation132gross/4paths against `68bca793`: tests41, docs91, source0. Remaining allocations are tests139, docs89, source180 and reserve60, total packet600. No whole-PR inventory rerun or scope exception is implied. This is partial preparation, not a completed fail-closed executable release-policy gate.
