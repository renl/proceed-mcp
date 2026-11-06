# Tasks

Parent: [proposal](proposal.md). Contracts: [guidance delta](specs/proceed-agent-guidance/spec.md) and [design](design.md). Delivery: one independent OpenSpec change and one PR targeting `main`.

Success: A human can install and explicitly load the supplied skill, then obtain a correctly acknowledged, harmless Telegram approval without repeating Proceed's workflow instructions.

Proof is real project-local installation/loading followed by the installed skill's public prepare/wait/Approve/acknowledge/receipt interaction. Structural checks, instructional review, simulated examples, and unchanged runtime evidence are supporting proxies, not that proof. No universal model-obedience claim is possible.

## 1. Execution prerequisites

- [ ] 1.1 Resolve implementation isolation through coordination before implementation. Preserve the root's uncommitted planning and status work. Record the authorized baseline, one change worktree/branch, owner, next action, and lifecycle status here, then verify all planning artifacts are readable there. Do not implement in the root while its use conflicts with mandatory isolation.
- [ ] 1.2 Obtain product scope confirmation and the combined architecture boundary/decomposition review below. Resolve the strict-validation warning with the delta's author, then require `openspec validate add-proceed-agent-skill --strict` to exit 0. Artifact presence alone is not owner approval.

## 2. Installable instructions and colocated checks

- [ ] 2.1 SDET authors `tests/proceed-agent-guidance.test.mjs` before the deliverables. Verify the native suite fails for the missing artifact, then covers path/frontmatter/advertising, self-containment, README local links and source revision guidance, five-tool coverage, and prohibited unsupported claims. Use table-driven cases where outcomes match. No dependency or package-script change.
- [ ] 2.2 General supplies `skills/proceed/SKILL.md` against design decisions 1, 3, and 4. Verify the native suite and the scenario review matrix below, including private authority, outcome handling, recovery, and no self-approval. Tests must not pin arbitrary prose or require a specific host prefix.
- [ ] 2.3 The README prose owner (growth marketing) adds artifact acquisition, project-local copying, discovery versus explicit loading, prerequisite links, troubleshooting, and the harmless first-use procedure. Verify the same native suite and matrix. Identify the public repository revision used, inspect any existing destination before replacement, and do not imply npm installs the skill or updates published bytes.

## 3. Installation and first-use boundary proof

- [ ] 3.1 SDET verifies the exact supplied file in a clean, authorized consuming fixture project using a real permitted OpenCode V2 agent. Record source revision and file hash, installed byte equality, actual OpenCode version, advertised `proceed` description, successful `@proceed` loading, and exact-ID `skill` loading with `id: proceed` where applicable. Require observed loaded instructions, not a parser or an agent's unsupported assertion. Record assertion and fixture-cleanup statuses separately.
- [ ] 3.2 In a separately authorized operator-controlled environment, verify the README path from empty skill and Proceed state through supported setup and the loaded skill's harmless request. Require the paired human's actual Telegram Approve while the wait is active, matching `request_id`, `resolution: approved`, matching returned `decision_id` acknowledgement, and a capability-free receipt. Perform no consequential action, shell command, or file modification as the proposed action. A timeout is not an active-wait pass. Record sanitized evidence and cleanup separately, or mark this task BLOCKED with the exact missing boundary/access.

## 4. Independent integrated-candidate verification

- [ ] 4.1 SDET pins the complete candidate revision and target baseline, checks changed and untracked paths, runs the ordered checks below, reviews every guidance scenario, and accepts only current boundary evidence for that exact skill/README. Record reused runtime evidence by revision, artifact, and assertion scope. Confirm no runtime, package, dependency, version, configuration, or generated-integration changes. Report pass/fail/BLOCKED per check and cleanup separately. Do not mark complete with required installation/loading or first-use proof missing.

## Ownership and implementation envelope

| Owner | Authorized implementation deliverable after setup authorization |
| --- | --- |
| General | `skills/proceed/SKILL.md` only |
| Growth marketing | README prose additions only |
| SDET | Native test suite, task mapping/evidence, independent verification and worktree lifecycle |
| Software engineering | Production integration only if a separately identified need is authorized. Otherwise Git/PR delivery as needed, not skill or README authorship |

No production integration is presently needed. Excluded: installers, new platforms, automatic startup, native or dual-channel integration, runtime changes, package bundling, version bumps, publication, dependency/build changes, global installation, credential-store access, protected-state inspection, or recovery-data changes. Tests are proportionate new guidance checks, not a duplicated runtime suite.

Planning baseline: `add-proceed-agent-skill` at `f3d60184f03963774ed6a5954bb75331d54918d4`. Root planning only. Proposed implementation path: `.worktree/add-proceed-agent-skill`, branch/change: `add-proceed-agent-skill`. Status: not created, blocked pending isolation reconciliation and safe transfer of the already-checked-out branch and uncommitted planning. Worktree owner: test engineering. Next action: coordination resolves isolation and authorizes setup. Cleanup evidence: none, no implementation worktree exists. Preserve unknown and retained files.

## Check mapping

The requirement names below refer to the guidance delta. The native suite checks machine-verifiable structure and instructional coverage. Human scenario review checks meaning and is supporting evidence, not runtime or loader proof.

| Requirement / design | Executable or public-interface check | Required assertion |
| --- | --- | --- |
| Installable and explicitly loadable guidance / 1 | Native suite, then task 3.1 | `skills/proceed/SKILL.md`, `name: proceed`, meaningful approval/instruction description, advertising enabled, no unpublished companions. Real project-local registration and loaded instructions match supplied bytes |
| Supported first use from empty state / 5 | README links in native suite, then task 3.2 | Supported setup links resolve. Empty-state setup leads to one harmless active-wait approval and matching acknowledgement/receipt |
| Current workflow instruction coverage / 3 | Native suite plus scenario review, then task 3.2 | Preparation precedes question/wait. Actual exposed definitions govern arguments. Acknowledgement uses matching identity/decision. Resolution is separate from delivery state |
| Human decisions do not widen permissions / 3-4 | Table-driven instructional review in the shared suite, with semantic review | Respond text `yes` or `approved` remains exact instructions only. Rejected, expired, cancelled, pending, silence and errors grant nothing. Approved never widens native permissions. No fabricated human outcome or native self-approval |
| Retained request recovery without duplicate questions / 4 | Shared suite plus bounded recovery-example review | Lost wait uses `get_approval` with retained identity/capability and same principal. Missing authority blocks. No duplicate question, ID-only recovery, alternate-session fallback, or automatic resumption. `NOT_FOUND` is not proof a duplicate is safe |
| Private authority stays out of public context / 4 | Shared suite, artifact review and sanitized task 3 evidence | No embedded real secret or instruction to echo authority into action/context, Telegram, receipts, logs or public evidence. Labels are not authentication. No credential-store lookup or secret-paste request |
| Actionable failures without unsupported promises / 1, 4 | Shared suite plus bounded missing-tool/setup/error examples | Safe path/ID/description/permission/conflict/MCP checks, no permission weakening. No invented `opencode skill add`, automatic startup, native answers, Events, post-timeout continuation, completed `doctor`, or delivery `retry` claim |

Use negative test controls for missing or unsafe instructional clauses, not invented runtime responses. Static presence checks cannot certify semantic safety or agent adherence. No test-only production API, schema, or application dependency is proposed.

## Boundary Verification

- **Real external boundary - OpenCode V2 skill discovery/loading:** Design decisions 1 and external boundary evidence govern `.opencode/skills/proceed/SKILL.md`, case-sensitive `proceed`, description advertising, user `@proceed`, and exact-ID tool loading. This is a file/loader boundary, not an HTTP endpoint. Selected-agent permission is required, never weakened. Task 3.1 supplies real proof. Record executable version because the dated V2 guide is not a pinned executable compatibility claim.
- **Normative public contract - existing Proceed MCP:** Design decision 3 and `src/mcp/server.js` agree on `prepare_approval`, `request_approval`, `get_approval`, `cancel_approval`, and `acknowledge_approval`. Retain `request_handle`, `request_id`, and private `request_capability`. Request requires handle/capability, `client_request_id`, exact `action`, and `context`, with optional `expires_in_seconds`. Retrieval/cancellation require request ID/capability, acknowledgement additionally requires matching `decision_id`. Same-principal authority and actual exposed argument constraints remain authoritative. No renamed fields, new endpoint, or host prefix is specified.
- **Real external boundary - Telegram first use:** Unchanged runtime uses `https://api.telegram.org` and the existing standard stdio MCP connection to the local broker. Use the existing supported setup and dedicated paired private chat. Bot credentials stay only in the operator-controlled broker environment, never in the adapter or evidence. This plan authorizes no bot/token/polling/protected-state access. Task 3.2 needs separate access to a safe fresh state namespace, broker, MCP connection, paired human, and permitted harness. No second poller, webhook changes, or use of retained recovery state. Mocks and old runtime evidence cannot prove this installed skill's first use.

Decomposition triggers: 1 YES, 2 NO with isolated fixtures, 3 YES for active-wait ordering, 4 YES, 5 YES. Installation, loading, and first use form a new ordered proof chain. Request one combined Architect boundary/decomposition review through coordination before readiness. No new compilable contract prototype requires review.

## Ordered validation commands and evidence

Run in the authorized change worktree after prerequisite tasks. Native docs checks are representative on the host and require no service environment. Commands are proposals until the test file exists.

1. `git diff --check` and native `node --test tests/proceed-agent-guidance.test.mjs`, each bounded to 60 seconds. The suite performs local structure/link checks without network, server startup, credentials, or global writes.
2. `openspec validate add-proceed-agent-skill --strict`, bounded to 60 seconds. This is structural validation only.
3. When the existing pinned formatter is available, `node node_modules/prettier/bin/prettier.cjs --check README.md skills/proceed/SKILL.md tests/proceed-agent-guidance.test.mjs openspec/changes/add-proceed-agent-skill/tasks.md`, bounded to 60 seconds. Missing Prettier 3.9.10 is a known tooling gap, not permission to install or a passed check.
4. Task 3.1 through the actual OpenCode public interface. Record `opencode --version` with a 30-second command limit, exact source revision and byte-equality assertion, then discovery and loading outcomes. Bound the operator session to 10 minutes. Missing executable/access/environment is BLOCKED, not an invitation to alter configuration outside the fixture.
5. Task 3.2 in the separately authorized ready environment, after 3.1. Bound the operator demonstration to 10 minutes and respect the actual client wait limit. Record failure/timeout rather than extending it silently. Use only supported public setup/tools and the Telegram control. No foreground server launch by the verifier. If resource-owning automation is needed, require a maintained repository-owned runner with aggregate timeout, progress, whole-tree teardown and cleanup assertions before execution. Missing suitable environment/runner blocks this proof, not the native checks.
6. Task 4.1 independent judgment and evidence reconciliation. Reuse unchanged runtime/package/CI assertions from the existing main baseline only after confirming relevant inputs and assertion scope. Do not rerun the exhaustive runtime suite, build, package installation, or publication merely for this guidance change. Preserve required existing PR checks.

Persist concise safe evidence in this active task record before archive: candidate/source revision, command and exit status, assertion scope, harness version, observed request/decision correlation and outcome, and cleanup result. Do not retain raw tool arguments/results, bot credentials, capabilities, private transcripts, workstation paths, or screenshots containing secrets. Keep any needed disposable fixture under an authorized ignored project-local scratch root. Stop before external-state access if the setup path or location lacks authorization.

## Planning evidence and readiness gaps

- On 2026-11-06, installed OpenSpec reports `1.15.0`. `status --change add-proceed-agent-skill --json` reports proposal/specs/design done and tasks ready. `instructions tasks --change add-proceed-agent-skill --json` confirms dependency completion and numbered checkbox requirements. Design has no unresolved build-shaping Open Questions.
- Before this file, default `openspec validate add-proceed-agent-skill` exits 0 with a warning. Strict validation exits 1 because the delta's `## Related Artifacts` section is not carried into the main spec during archive. The delta's author must resolve this warning. No specification was edited by test engineering.
- After this file, CLI status reports all four planning artifacts done and `isPlanningComplete: true`. Default validation still exits 0 with the same warning. Strict validation still exits 1 for that warning. `git diff --check` exits 0 for tracked changes. These results establish artifact structure, not implementation completion or behavioral proof.
- Product review remains marked pending in the proposal. Combined architecture review, isolation reconciliation, formatter availability, real skill installation/loading, and separately authorized Telegram first-use evidence remain outstanding. No new test, installation, loading, first-use, runtime, or cleanup pass is claimed.

## Workflow follow-up

- After independent integrated-candidate verification passes, coordination routes the declared spec author's delta review, then authorizes one CLI archive and the single change PR. No archive or Git mutation is authorized by this planning task.
- Finish task evidence before archive. Confirm later finalization is docs-only or revalidate affected inputs. Never edit archived content. Record landing and worktree cleanup evidence outside the archive, preserving all unknown work.
