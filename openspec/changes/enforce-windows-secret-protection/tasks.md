# Tasks

Inputs: [proposal](proposal.md), [design](design.md), [capability delta](specs/opencode-session-continuation/spec.md). Task shape follows the pinned CLI instructions captured in `.scratch/enforce-windows-secret-protection/tasks-instructions.json`.

## Delivery and lifecycle

- Outcome: working protected Windows provision/load and necessary state admission, preserving POSIX behavior and existing authority. One independently landable change, one PR into `main`. No refusal-only release or separately shipped helper foundation.
- Baseline: `main@df2c8d0958676ba8465db8959d6299bd278125e0`. Prerequisite: none. Internal checkpoints share this branch and must not land separately.
- User-visible success: safe Windows setup and cold startup load protected credentials and support the original waiting call's explicit human outcome without exposing private authority.
- Proof: actual protected Windows provision/load and installed first approval. Both are UNRUN. Pure-unit decisions, requested native masks, fake pipe behavior and static wiring review are supporting proof of individual contracts, not OS enforcement or user-outcome proof.
- Mergeable outcome: the full correction plus preview.3 metadata and prerequisite guidance. Nearest landing blocker: combined boundary/decomposition/test-fidelity review, then implementation and independent candidate review. Candidate-specific acceptance of unrun native/installed checks and landing authority must be recorded by the delivery coordinator before archive/merge. No acceptance exists in this task record.
- Path: `.worktree/enforce-windows-secret-protection`. Branch/change: `enforce-windows-secret-protection`. Lifecycle owner: test engineering. Status: blocked, retained. Created and HEAD-verified at planning commit `9a75f8073df8b5ec8ef177dc58554129ff000b7a`. Root returned to `main@df2c8d0958676ba8465db8959d6299bd278125e0` with known overlays preserved. Next action: combined architecture review of the submitted artifacts, then resolve the unsigned-interpreter-runner and missing-formatter prerequisites through the delivery coordinator. Complete implementation-dependent Node assertions before independent candidate review. Cleanup evidence: no landing/abandonment authority, so removal is not eligible. Prior retained worktrees remain untouched.

## 1. Executable handoff and combined review

- [ ] 1.1 Create the assigned worktree and author production-dispatcher PowerShell units and Node transport/product-wiring units. Verify bounded commands below and record actual PASS/RED/UNRUN outcomes without production stubs.
- [ ] 1.2 Obtain one combined architecture review of Boundary Verification, decomposition and test-only fakes against design sections 1-6 and the unit binding. Completion evidence is an explicit review disposition before implementation dispatch.

## 2. Working protected Windows provision/load checkpoint

- [ ] 2.1 Implement the side-effect-free production dispatcher, bootstrap and native adapter from design sections 1-5 and Unit seam. Verify the same four callable functions are used by production and PowerShell units, with no duplicate admission model, default native binding or pathname I/O fallback.
- [ ] 2.2 Implement exact account/DACL, volume, component path/identity admission and protected exclusive creation. Verify PowerShell decision tables, root/ancestry flags, descriptor-at-create, collision preservation, read rechecks, partial writes and exact-handle settlement units.
- [ ] 2.3 Wire default/explicit credential provisioning and bounded broker-only loading, configuration-before-read and local credential/ownership admission. Verify Node memory-injected caller order, stable errors, no token before ready, no adapter token, no existing-record repair/deletion and successful provision/load assertions. Preserve current token grammar/default path algorithm.

## 3. Complete affected state and preservation checkpoint

- [ ] 3.1 Route all affected Windows state operations through the admitted backend, including journal read/append/flush/truncate/replacement, ownership release, setup rollback and operator-key paths. Verify dispatcher lifetime/flush/publication/cleanup units and Node durable-before-effect and ownership-preservation units. Keep formats 2/3, stored authority and schemas unchanged.
- [ ] 3.2 Implement bounded worker framing, trusted launcher/environment, startup/request deadlines, loss fencing and stream settlement. Verify Node transport units with in-memory process bindings only. No actual worker process may run during this scope.
- [ ] 3.3 Preserve foreground secure reuse without persisted Telegram load and POSIX safeguards. Verify focused pure units with memory bindings, not filesystem fixtures or host runtime startup.
- [ ] 3.4 Prepare preview.3 version/lock/release metadata and supported Windows guidance, including runtime compilation, private compiler temporary directory, supported storage/policy and honest proof limits. Verify scoped formatting and static metadata/source review only. No build, package or installed check is authorized now.

## 4. Independent integrated candidate gate

- [ ] 4.1 Independently review the immutable completed candidate and run only affected pure-unit/static commands. Record revision, assertions, cleanup separately and residual native/installed risks. Confirm any later finalization delta is docs-only or revalidate affected inputs.

## Implementation file handoff

Production allowlist for the implementation owner: `src/state/credential-file.js`, `src/state/path-trust.js`, `src/state/protection.js`, `src/state/paths.js`, `src/state/store.js`, `src/state/files.js`, `src/state/credentials.js`, `src/state/owner-credentials.js`, `src/state/ownership.js`, `src/journal/journal.js`, `src/config/portable-config.js`, `src/broker/portable-runtime.js`, `src/broker/runtime.js`, `src/broker/availability.js`, `src/broker/startup-failure.js`, `src/cli/main.js`, `src/harness/operator-key.js`, new Windows storage modules/scripts under `src/state/`, and necessary direct callers within `src/` identified in the design runtime inventory. Review any additional caller delta for necessity, do not expand product scope. `package.json`, `package-lock.json`, `server.json` and `README.md` may change only for approved preview.3 metadata, unit command registration and Windows prerequisite guidance. Implementation owns every production dispatcher, worker, native adapter and test-injection seam. Tests never become production dependencies.

Exact input files are the three linked planning artifacts, this tasks file, and the test files listed below. Filenames/private JS exports/native classes remain implementation-owned. Select the production dispatcher path as an explicit runner argument, not a test-imposed production filename. New transport exports must not create a second public API. If transport/caller injection cannot use existing bindings, return the concrete binding to test engineering through the delivery coordinator for remaining executable assertions. Do not change tests or contract semantics to obtain GREEN.

Excluded: permission bridging, other-platform redesign, new framework, policy bypass/elevation, runtime or recovery access, actual token/key/state operations, archive edits, installation/publication and real native compilation/execution. Root source remains untouched. Preserve root status/operations/untracked overlays.

## Boundary Verification

Real native boundary: design sections 2-4 and the cited Windows SDK declarations. `CreateFileW`, `CreateDirectoryW`, `GetSecurityInfo`, `GetFileInformationByHandleEx(FileIdInfo)`, `GetFileInformationByHandle`, `ReadFile`, `WriteFile`, `FlushFileBuffers`, `SetFileInformationByHandle` and release allocations/handles require actual ABI/OS evidence later. Pure units observe requested operations and copied observations, not Win32 marshalling, ACL enforcement, sharing exclusion, rename atomicity, compiler trust or crash durability. Real-boundary proof is UNRUN by policy, not waived.

Normative production/test boundary: design Unit seam `New-ProceedStorageSession -NativeCall -NowMs`, `Initialize-ProceedStorageSession -Session -DeadlineMs`, `Invoke-ProceedStorageRequest -Session -Request -DeadlineMs`, `Stop-ProceedStorageSession -Session -DeadlineMs`. No wire URL or authentication applies to this in-process binding. NativeCall's exact operation/argument/value/error contracts and descriptor observations are those in the design tables, with no injected safe boolean or JS policy replica. Test fakes are non-production and report only synthetic identities, descriptors, bytes and virtual handles. Raw observation errors refuse before further private access.

Native handle ownership: all ancestors remain pinned without delete sharing, inspection and I/O use retained handles, created objects alone are eligible for identity-proven disposal, ancestors outlive dependents, close occurs once, uncertain release cannot become successful finish. Native adapter owns descriptor allocations. No OS pointer/handle crosses the protocol.

Actual wire: redirected parent-created stdin/stdout, `windows-protected-storage-v1`, exact design section 5 requests/replies/ready object, four-byte unsigned big-endian length, strict UTF-8 JSON, 81920-byte frame, 49152-byte decoded chunks, serial increasing IDs. Nonempty stderr is a zero-output tripwire capped at 4096 bytes, never diagnostic content. No network endpoint, URL or additional authentication flow. Trusted absolute inbox PowerShell only, fixed package bootstrap, explicit minimal environment, no PATH/user override/fallback. No secrets until ready. Node owns loss fencing and termination within the original deadline, including the 1000 ms settlement reserve.

Source cross-check: baseline `credential-file.js` and `path-trust.js` skip Windows ownership/ancestry, while `protection.js` uses pathname Get-Acl/icacls and bare executable selection. These are the defects being replaced, not reusable proof or a contract discrepancy to preserve. Existing helper JSON parsing may be reused only for compatible pure framing, never its exchange vocabulary or authority.

Decomposition trigger results: 1 YES (new backend/caller contract), 2 YES (creation/rollback preservation), 3 YES (ready-before-authority), 4 YES (dispatcher/transport/product proof chain), 5 NO (all current fixture operations are memory-only and isolated per test). Combined review required. Checkpoint 2 precedes 3 on the same branch. Neither checkpoint alone is mergeable. Unit tests are independent memory sessions, not consumers of persistent fixture output.

## Unit test mapping and maintained commands

Target shell: PowerShell on supported Windows. Use explicit test paths, no suite wildcard or `npm test`. Pure runner launch is interpreter-only, never the production worker. Resolve the trusted inbox executable using the trusted runtime environment as design section 5 requires. Native permission denial is binding with no alternate executable route.

| Contract/scenario | Runnable location | Deterministic assertion |
| --- | --- | --- |
| Protected setup/load, unsafe storage, substitution, preservation | `tests/windows-storage-dispatcher.unit.ps1` | Actual production callable replies and virtual native operation ledger, account-only admission, bounded read/write/flush, identity checks and lifetime |
| Credential grammar/default location, malformed protocol primitive, launcher, configuration-before-read and ownership protection | `tests/windows-storage-node-unit.test.mjs` | Actual existing production exports and memory-injected process/fs dependencies, no real spawn or storage |

Run order after production dispatcher exists (missing source is expected RED before implementation):

1. Cheap static: `git diff --check` and `node node_modules/prettier/bin/prettier.cjs --check openspec/changes/enforce-windows-secret-protection/tasks.md tests/windows-storage-node-unit.test.mjs` (reuse root dependency executable by explicit absolute path if worktree dependencies are absent). Prettier does not support `.ps1`. PowerShell syntax is checked by its parser before running units.
2. Interpreter units: `& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File tests/windows-storage-dispatcher.unit.ps1 -DispatcherPath <repo-relative-production-dispatcher.ps1>`. Outer timeout 60000 ms. Dispatcher path remains implementation-owned. The initial attempted path `./src/state/windows-storage-dispatcher.ps1` is a candidate location only, not a required production filename or new ABI. No production dispatcher exists yet. No native process may be launched by the runner/dispatcher/fakes.
3. Node units: `node --experimental-test-module-mocks --test tests/windows-storage-node-unit.test.mjs`. Outer timeout 60000 ms. Every process and storage operation is replaced in memory. Unit coverage of not-yet-selected private transport bindings is completed by test engineering once those bindings are readable, before independent candidate review.
4. Repeat only affected assertions after changes. No install, build, pack, harness, preflight, calibration, renderer, integration or e2e command.

## Checks and evidence

| Phase | Check and present state | Failure / owner / trigger |
| --- | --- | --- |
| Pre-merge | Combined architecture review, implementation, pure units, static wiring/format and independent candidate review: pending | Unimplemented Windows protection / implementation and test engineering / next implementation candidate |
| Pre-merge | Candidate-specific native/installed residual-risk decision: absent | Native enforcement unproved / delivery coordinator and operator / before archive or merge |
| Pre-exposure | Real Win32 ABI/protection, supported worker compilation/launch and packaged startup: UNRUN | Windows boundary unverified / test engineering and operator / separately authorized policy change and supported disposable environment |
| Post-deploy | Installed public setup/provision/load and first human approval: UNRUN | User outcome unproved / operator and test engineering / separately authorized installed verification |
| Deferred | Other Windows architectures/filesystems unsupported by design, no redesign promised | Unsupported prerequisite / architecture owner / proposed supported-envelope change |

WIN-UNIT-SEAM-01: clarification attempt 1, recheck cycle 1 resolved for setup. Updated design now specifies exact production callable binding, native operations and observation/ownership contracts. No implementation/test evidence is implied. Combined architecture test-fidelity review is still pending.

### Setup evidence and remaining proof (2026-11-10)

- Planning commit `9a75f8073df8b5ec8ef177dc58554129ff000b7a` contains exactly the five active change planning files. Index was empty beforehand. Local planning/main HEAD and remote `main` all matched the declared baseline before committing. Root status/operations and existing untracked worktrees were not selected or edited.
- `git diff --check`: PASS, exit 0. `node --check tests/windows-storage-node-unit.test.mjs`: PASS, exit 0. Maintained host PowerShell parser: PASS, zero syntax errors for `tests/windows-storage-dispatcher.unit.ps1`. Parsing is static evidence only, not execution of the runner or dispatcher.
- Scoped Prettier command: BLOCKED, exit 1 (`MODULE_NOT_FOUND`). Root `node_modules/` is absent. No install, other-worktree dependency probe, metadata workaround or external scratch was attempted. Owner: delivery coordinator to route an authorized dependency prerequisite. Trigger: before claiming formatting passed or implementation handoff complete.
- Inbox PowerShell 5.1 interpreter command: BLOCKED/UNRUN, exit 1. The OS refused the unsigned test script with `UnauthorizedAccess` because it is not digitally signed. This occurred before source loading or assertions, so it is not an expected missing-production RED. No execution-policy change, bypass switch, alternate interpreter or command-text retry was attempted. Owner: delivery coordinator/operator to supply a policy-compliant authorized runner route. No security-policy weakening is proposed. Until resolved, PowerShell behavioral assertions remain UNRUN even after source exists.
- Final Node command above, Node v26.13.0 on Windows: 9 tests, 4 PASS, 5 expected RED, exit 1. RED: bare `powershell.exe`, excess child environment, incomplete Windows path syntax, configuration read before protection, and ownership key read without Windows protection. All process/filesystem dependencies used by these tests are in-memory bindings. One earlier execution reported 4 PASS/3 RED before synthetic launch-environment injection and caller assertions were added. Only the final assertion scope applies to this handoff.
- Current PowerShell unit file covers the four exact production callables with virtual native observations. Its cases cover protected create/read, owner/DACL/ancestor policy, reparse/root/hardlink/path refusal, changed identity, exclusive collisions, partial/zero-progress writes, failed flush, owned cleanup, close settlement, deadlines, chunk validation, missing observations, journal truncate/flush, new-directory descriptor and publication sequencing. These are submitted assertions, not executed proof. Production source is intentionally absent, with no test stub or duplicated JS admission model.
- Still to author against readable implementation-owned bindings: actual storage frame stream/worker-loss/deadline settlement units, successful product provision/load across backend wiring, foreground reuse without credential load, product journal durable-before-effect and remaining caller inventory assertions. The strict JSON primitive test is supporting coverage only and does not close transport wiring. Test engineering owns these follow-up tests. Implementation must expose a memory-injectable private process/exchange binding consistent with the design, without inventing new wire fields or letting production depend on tests. Task 1.1 remains unchecked until this coverage and its permitted execution are complete.
- Boundary and installed first-use tests remain UNRUN by user policy. No check was waived. No feature-verified, release-ready, landing, archive, deployment or publication claim is made.

## Workflow follow-up

- After independent candidate review and explicit landing/risk authority, obtain primary spec-author delta review. Implementation then runs the single authorized CLI archive inside this change PR, with no manual spec merge.
- Merge, deployment and publication are not authorized here. After proven authorized landing, test engineering returns to synced `main` and safely removes only this change worktree/branch, or records an authorized recovery-ref disposition. Never edit archived content for cleanup evidence.
