# Linux primary preview CI

## Outcome, authority and baseline

The preview must build, install with identical package bytes and exercise its
public command and MCP tools on a clean Ubuntu CI runner without publishing.
This preparation enables that proof. Local policy calibration is only a proxy.

The user approved Linux as primary CI after disclosure that Linux does not prove
Windows. This supersedes the proposed, unapproved Windows diagnostic, not its
failure history. No Windows risk acceptance or new compatibility claim exists.
The existing preview PR needs this CI correctness correction, not a new capability,
OpenSpec change or archive operation. [Earlier evidence](preview-ci-eol.md) stays intact.

- Worktree: `.worktree/add-telegram-approval-opencode-v2` from the project root.
- Branch: `add-telegram-approval-opencode-v2`. Prerequisite: existing local HEAD
  `a23798c8e3c54a977ae124b2a2025bb0a14dd9a9`.
- Remote tracking head: `cf512ea9873688c4c6ca249aa76c711025889ce8` at intake.
- Main and origin/main: `de1c58021f4df25b03551faeb1b26958852275a7` at intake.
- Delivery: same [PR 2](https://github.com/renl/proceed-mcp/pull/2), no new worktree.
- Lifecycle: retained, active, test-engineering ownership. Next: workflow-only
  implementation, actual Ubuntu CI, independent affected-risk verification.
  Cleanup remains blocked by the open PR and retained user material.
  The final verification below supersedes this preparation-stage next action.

[Current requirement](../../openspec/specs/npm-distribution/spec.md#requirement-non-publishing-pull-request-validation)
requires non-publishing PR build/test, not a Windows-only gate. Historical design
section 8, paragraphs beginning "Validation shall name its OS" and "PR CI shall
build/test", permits prospective Linux evidence only when executed. Section 2
retains owner-only POSIX permissions and Windows ACLs as distinct obligations.
The project index's Windows validation instruction describes existing local
qualification. This user-approved primary-CI change supersedes that gate selection
only, without changing admission, security or baseline specs.

## File-bound implementation brief

Only `.github/workflows/ci.yml` is authorized for the later implementation edit,
with a ceiling of 40 gross changed lines. Set `runs-on: ubuntu-24.04`. Add explicit
`shell: bash` to each of the six existing run steps. Replace the final PowerShell
body with exactly this Bash body, preserving its five-minute step timeout:

```bash
npmCli="$(readlink -f "$(command -v npm)")"
test "$npmCli" = "$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")/lib/node_modules/npm/bin/npm-cli.js"
test -f "$npmCli"
PROCEED_TEST_NPM_CLI="$npmCli" node tests/release-pack.mjs
```

Preserve Node 24.22.2, both existing action commit pins, `pull_request`, contents
read, `persist-credentials: false`, job timeout 15 minutes, no environment/auth
scope changes, and the exact ordered version/install/preview-tests/formatter/
build/pack commands. No privileged event, token, publication or extra job.
The maintained pack command already isolates npm user/global config, cache, logs,
home and temp, disables scripts, and installs the tarball offline. Keep it.
No production, dependency, metadata, README, baseline-spec or archive edit.
Do not raise deadlines or adapt assertions to conceal a Linux failure.

Grounding checked during preparation:

- [Official runner inventory](https://github.com/actions/runner-images#available-images)
  lists supported x64 `ubuntu-24.04`. This fixes the OS label, not the rolling
  image build. Record the actual image in the CI result.
- [Pinned setup-node source](https://github.com/actions/setup-node/blob/48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/src/distributions/base-distribution.ts)
  appends `bin` to the selected tool path on non-Windows and adds it to PATH.
- [Node v24.22.2 installer](https://github.com/nodejs/node/blob/v24.22.2/tools/install.py)
  defines `bin/npm` as a symlink to `../lib/node_modules/npm/bin/npm-cli.js`.
  Resolve the selected npm and verify it belongs to the selected Node prefix.
  The Windows sibling `node_modules` path is not the Linux layout.

## Risk and executable mapping

| Risk | Maintained proof and disposition |
|---|---|
| Wrong runner, shell, gates or privilege | `release-preview-ci.test.mjs` actual-file policy plus positive/negative calibration. `workflow-model.mjs` narrowly accepts Bash and PowerShell, not arbitrary shells. |
| Windows-only npm resolution | Linux policy pins resolved toolchain CLI. Actual CI must resolve it and run pack, not merely parse text. |
| POSIX executable shim and protected files | `release-installed.test.mjs` uses real POSIX shim, asserts its executable target, checks setup and post-smoke state directories/files are 0700/0600 and owned by the running account. Windows DACL behavior remains separate. |
| Packaging, privacy and approval behavior | Unchanged metadata/artifact suites, exact installed-byte comparisons, scoped README examples, public help/init/owner/stdio/five-tool discovery, private preparation, NOT_PAIRED refusal, empty actionable state, capability redaction and EOF/shutdown assertions remain required. |
| Cleanup | Existing pack runner owns offline install/removal. Existing managed helper kills POSIX process groups and verifies tracked process absence. Record assertion and cleanup separately. No new containment claim or harness. |

Actual path inspection: metadata's synthetic Windows path is a parser string, not
a filesystem prerequisite. Git checkout fixtures explicitly model autocrlf on
either OS. Artifact fixtures use platform-native paths. Pack has no Windows-only
launch. Installed smoke already selects `.cmd`/cmd on Windows and an executable
shim on POSIX. Its preload changes PATHEXT only on Windows. POSIX production
protection uses filesystem operations, not PowerShell/icacls children. The
Windows five-second-versus-ACL mismatch therefore requires no Linux timing fix.
POSIX filesystem, executable, signal and process-group behavior are genuine
application/environment risks until Ubuntu executes them, not mocked local proof.

Boundary verification: unchanged GitHub PR boundary, existing pinned actions and
Node distribution, no new public names, payloads or external product wire.
Actual clean hosted Ubuntu job is mandatory real-platform proof. No Telegram or
public-registry access is added. All five decomposition triggers are NO for new
cross-unit obligations. The single existing ordered runner chain is unchanged.

## Checks and acceptance

Local preparation uses qualified project-owned Windows Node 24.22.2, PowerShell,
and 120-second bounded commands. No install or managed smoke is permitted locally.

1. Syntax-check the changed tests/helper with `node --check`.
2. `node --test tests/release-metadata.test.mjs tests/release-preview-ci.test.mjs tests/release-artifact.test.mjs`.
   Before implementation, only actual workflow policy must be RED for Windows.
   The bounded-correction specimen must pass without changing the real workflow.
3. `node --test --test-name-pattern="PREVIEW diagnostic" tests/release-installed.test.mjs`.
   This runs safe diagnostic calibration only, not managed setup or ACL children.
4. `node node_modules/prettier/bin/prettier.cjs --check .github/workflows/ci.yml docs/verification/preview-ci-eol.md docs/verification/preview-ci-linux.md`.
   Run `git diff --check`, inspect selected paths and preserve custody.
5. After workflow-only implementation, repeat affected syntax/policy/format checks.
   Only the implementation owner may perform the subsequently authorized push/CI
   execution. Actual clean Ubuntu CI must pass npm ci, preview tests, formatter,
   build, pack, byte equality, install and public smoke at the immutable candidate.
6. Independent verification must map actual run/revision/image/Node/npm/artifact
   and phase results, including cleanup. Linux failure stays failed. Stop and
   return scope if runtime changes or a larger platform capability are needed.

Windows is separately pending, not passed, waived or optional-by-failure. All four
historical CI failures remain failures. The transient PowerShell/icacls cleanup
proof gap and timing audit remain unresolved. No Windows run, containment driver,
risk acceptance, universal compatibility, live Telegram or release pass follows.

Forecast before substantial writing: at most 400 gross lines across tests,
existing helpers, live docs, workflow source (40 maximum) and final evidence,
below 600. Earlier EOL 382, diagnostic 218 and blocked audit 76 remain separate
history, not hidden resets or charges erased by this unit. Archive is read-only.

## Preparation evidence

Windows Node 24.22.2 syntax checks PASS for both changed tests and the workflow
helper. Required preview selection: 18 PASS / 1 expected RED, exit 1. The actual
workflow still selects `windows-2025` instead of `ubuntu-24.04`. The bounded Linux
workflow correction specimen, Bash parser and negative privilege/platform/shell/
toolchain controls PASS. Additional controls were added after the first run and
the final selection was rerun with the same sole RED. Neither run is Linux proof.
Safe diagnostic calibration: 2/2 PASS, exit 0, no managed setup or ACL invocation.
Workflow/live-doc formatter and whitespace checks PASS. POSIX mode/owner/shim and
real installed public behavior are NOT locally executed and await actual Ubuntu.

At intake the index was empty. Only coordination's tracked status-log dirt and
the exact six excluded originals were present, all left unselected. All 104
archive files match unfiltered Git blob hashes. The three recovery notes match
their recorded hashes, custody manifest remains `d57deddf...`, and public tarball
remains SHA-256 `43866cb0c8eaa3feb3d90c598d6ecbfdea8b7886f3af7e584a4e6b32b4fb9adc`.
The retained artifact manifest remains unchanged. No source, workflow, baseline
spec, archive, publication or credential-state operation occurred. No push or CI
execution occurred. Disposable fixture cleanup assertions PASS separately from
the expected policy failure. Whole-worktree cleanup is still blocked, not passed.

## Final independent affected-candidate verification

Verdict: PASS for Linux-primary preview merge readiness, with no hotfix needed.
This completes the assigned verification package, not merge or whole-worktree
cleanup. Slice-ready and feature-verified apply within the approved preview
boundary. Full all-platform release readiness and independent live first-use
qualification are NOT claimed. Deployed artifact: not applicable, no deployment.

### Pinned candidate and actual execution

- Verified code and local/remote/PR head:
  `7c38071a14eca17237facf99d3c331c56f6f57c4`.
- Parent: `8e489cd8b2a4398ef7f3280287db9b020ebc398d`.
- Local main, origin/main, live remote main and PR base:
  `de1c58021f4df25b03551faeb1b26958852275a7`.
- Live PR 2: OPEN, MERGEABLE, CLEAN. Its reported `ci / validate` check is
  SUCCESS, completed `2026-11-05T16:16:17Z`. No review decision was reported.
- [Actual run 42062573579](https://github.com/renl/proceed-mcp/actions/runs/42062573579),
  job `127367993946`, reports that head. Checkout actually tested synthetic merge
  `1dea29be0d98397239ace9390fffb9d13ac68655`, merging the exact head into the
  exact target above. This is integrated-candidate proof, not only head metadata.
- Ubuntu 24.04 image `20261101.360.1`, Node `24.22.2`, npm `11.19.1`, Bash.
  The OS label is fixed but the image rolls. The two action references resolved
  to the committed checkout `de0fac2e4500dabe0009e67214ff5f5447ce83dd` and
  setup-node `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` in this actual run.
  This establishes executed reference resolution, not an independent supply-chain
  audit or qualification of later images/toolchains. The pack step's successful
  realpath equality and file checks bind npm's CLI to the selected Node prefix.

Independent review inspected workflow, policy controls, installed assertions,
pack runner and managed cleanup, then accepted current CI execution by revision
and assertion scope instead of replaying runtime, install or live operations.

| Check | Executed evidence accepted and assertion scope |
|---|---|
| Bootstrap and policy | Actual checkout/setup and `npm ci --ignore-scripts` PASS. All 19 selected tests PASS, including real autocrlf checkout/byte controls, privilege/event/shell/toolchain negatives and actual workflow policy, not only a specimen. |
| Format and build | Actual workflow Prettier PASS. Build PASS checks all 43 bin/src JavaScript inputs. |
| Pack and installed bytes | Existing offline runner PASS requires scoped identity/version, shipped-path/credential guards, exact staged-to-installed bytes for every packed input and scoped installed README examples before smoke. |
| Public installed behavior | Actual named POSIX executable targets this package and runs help. Supported init, repeat-init refusal, owner creation, broker/status, MCP stdio initialize/five-tool discovery, private preparation, NOT_PAIRED refusal, empty actionable state, capability redaction, EOF and shutdown assertions all execute before complete. |
| POSIX protection | Actual POSIX branches check running-account ownership and 0700 directories/0600 files recursively after setup and after public smoke. These assertions are not Windows ACL proof. |
| Owned cleanup | Safe report is `phase: complete`, `elapsedMs: 926`, `assertion: pass`, `cleanup: pass`. Separate package cleanup PASS. Managed helper terminates POSIX process groups, verifies tracked process absence and fixture removal. No universal timeout-path or Windows descendant-containment claim follows. |

### Reuse, preservation and remaining gates

Source diff confirms this platform correction changes no production, dependency,
package/Registry metadata, public wire contract or deadlines. Workflow source is
29 gross lines, within 40. Preparation is 214 gross lines. Earlier 76-line timing
audit remains separate historical evidence. No unrelated correction is hidden.
All 104 archive files match unfiltered HEAD blob hashes, and archive/current specs
have no changes since archive commit `a63052fe`. No archive edit was made.

Combined evidence `7581e1845360a09f713c7e14e02d7151a76cb9b9` and runtime
`91c79d277c2f1c477707b9bd787bebfbae0cfec8` remain usable only for their accepted
unchanged assertions. No bin/src, package/lock or build-script drift invalidates
runtime reuse. Previously accepted Registry metadata reconciliation remains
separate from runtime. Public tarball SHA-256
`43866cb0c8eaa3feb3d90c598d6ecbfdea8b7886f3af7e584a4e6b32b4fb9adc`, manifest
`748f70ab342993117c0b994d83c36a71697295ce6da462f1acf3b859f3cd696b` and accepted
public readback retain their original scope. Current README/package smoke is
separate from immutable published bytes. The CI tarball was disposable, its hash
is not exposed by the safe log and is not claimed equal to that public artifact.

No required affected executable gate remains failed or unexecuted for the approved
Linux-primary landing. Windows failures remain unresolved, not passed or waived.
The npm-distribution PR-validation requirement and archived design lines 884/894
do not require Windows CI. The explicit primary-CI decision replaces that gate
selection, not Windows security obligations or evidence. No new Windows diagnostic,
containment work, Telegram access, publication or all-platform claim is authorized.

Before authorized merge, preserve or commit coordination's status dirt as
appropriate and deliver the owned evidence. Recheck live head/base and applicable
required checks/protection/reviews at landing. Do not infer merge authority or a
target-race exception from this verdict. Docs-only evidence/status finalization
does not change code/check inputs, but it is not actual CI on the later head.
Any code/test/dependency/configuration/target drift requires affected revalidation.

At intake the index was empty. Coordination status dirt, all six excluded originals,
three recovery notes and retained artifacts were left untouched. Prior custody
hash evidence is reused, not newly asserted as rehashed. No resource-owning local
run occurred. Worktree remains active awaiting merge. Whole cleanup is BLOCKED by
open PR and retained user material, independently of passing CI-owned cleanup and
source/Registry evidence. Retention is not a new merge waiver or product failure.

Final local documentation checks PASS using retained project Node 24.22.2:
Prettier for both live evidence files and `git diff --check`. Owned evidence adds
109 gross lines, making this Linux unit 352 gross including preparation and
workflow source, within the 400-line forecast. A concurrent project-index edit
appeared during verification and is preserved unselected with coordination dirt.
Only these two live evidence files belong to the evidence commit. Its delta is
docs-only and does not change the verified implementation or CI inputs.
