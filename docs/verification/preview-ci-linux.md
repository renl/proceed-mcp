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
