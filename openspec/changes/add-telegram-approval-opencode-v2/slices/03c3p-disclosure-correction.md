# C3-MCP-DISCLOSURE-001 - corrective disclosure packet

Parent: [tasks](../tasks.md). Remainder: [copy/privacy packet](03c3o-p3-copy-ledger.md#exact-remainder-after-stop).

## Outline before growth

- Goal: callers see truthful waiting limits and request-authority boundaries in MCP initialization and CLI help. Public output is proof of local disclosure, not proof of human receipt or automatic resumption.
- Baseline `8edc8669c063355de301f537df60ec76a74111fd`, tests `69ff8d7e42eb73784a690ce82adf45917af15e25`, production `dae0a47abf8077aa9b1e399f8899fa86fcee36f9`. Existing change worktree/branch `add-telegram-approval-opencode-v2`, path `.worktree/add-telegram-approval-opencode-v2`, test-engineering owner, active/retain. Prerequisite present on this branch. Target `main`, original base `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. One change PR, sequential checkpoint only.
- Authorized test files: new `tests/portable-disclosure.test.mjs` and `tests/support/disclosure-contract.mjs`. Existing omission discriminator stays unchanged. Documents: this slice, prior copy slice provenance/disposition, active tasks. No existing shared helper edits planned.
- Hard600 gross against this baseline. Forecast tests/helpers220, docs100, proposed source ceiling80 (MCP50, CLI30), later evidence60 =460. Remaining140 is contingency, not permission to broaden scope. Stop and re-outline before exceeding a component ceiling or hard600. Actuals recorded after authoring.
- Authority read directly: [proposal annex](../proposal.md#onboarding-cli-and-mcp-activation-copy), [design3/6](../design.md), [continuation delta](../specs/opencode-session-continuation/spec.md). Canonical review findings and both-surface authorization are supplied by the corrective task brief. No separate owner-review file was supplied. No new policy or Events implementation.

## Boundary and correction criteria

- Gap cycle0, source attempts0. Next owner implementation engineering through coordination. Restore approved meanings, not exact longer phrasing. This is the already reviewed normative public copy boundary, not a new contract. Faithful restoration needs no repeat unchanged Architecture review. New ambiguity returns to coordination.
- Future source edits ONLY `src/mcp/server.js` instruction content (50 gross maximum) and `src/cli/main.js` help/disclosure content (30 gross maximum). No tools, descriptions/schema, execution, authority, delivery, Events behavior, imports or refactor. Production/design/proposal remain read-only for test preparation.
- MCP criteria cover annex131, design3 and continuation Exact originating-session delivery / Portable waiting-call outcome delivery / Honest compatibility: preparation before wait without a question, private capability retention with handle/ID, no assistant/Telegram authority echo, same-principal transfer grants request authority but not original-call redirection or event routing, client timeout and lost call do not cancel durable requests, bounded client/transport waiting, authorized retained-outcome retrieval without agent wake or another decision, matching terminal acknowledgement, subsequent assistant request/outcome acknowledgement, stable pair deduplication before acting, unsupported Events and no late-resumption promise. Preserve explicit Approve/Reject/Respond meanings and new-request requirement for actions still needing approval.
- CLI criteria: approved availability/instructions-not-approval plus client/transport timeout limits, lost-call-not-business-cancellation and unsupported Events/no automatic post-timeout resumption. MCP-specific authority/ack instructions are not newly imposed on CLI.
- Tests use sentence-level relational assertions and aggregate missing meaning IDs, not mere subject presence. Positive paraphrase and omission/contradiction controls validate the oracle only. Public CLI help and serialized MCP initialization are the acceptance surfaces. Independent semantic review remains required because regex cannot interpret arbitrary prose.

## Run sequence and independent verification

Windows PowerShell, project Node24.22.2 `../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`. Native represents local public JS/CLI/MCP copy. No broker behavior or external boundary changed. No live Telegram, installs, secrets or ordinary runtime state.

1. `node --check` both new test files, scoped `git diff --check`. Formatter `node node_modules/prettier/bin/prettier.cjs --file-info <path>` confirms tests/OpenSpec exclusions, not formatter PASS.
2. `node --test --test-reporter=tap tests/portable-disclosure.test.mjs`, outer120s. Existing portable/managed runner owns setup, aggregate deadlines, processes, fixture/listener and teardown. Pairing disabled, no Telegram update producer needed. Preserve ignored TAP/progress on failure.
3. After source correction, independently run that full suite, retained omission discriminator and existing public catalog test. Review exact source-only diff, semantic fidelity, unchanged schema/behavior, owned cleanup and gross budget before closing the gap. Full copy/privacy suite follows separately and must finish branches previously blocked by omission.

No aggregate P3/C3, useful human/assistant acknowledgement, feature, live-boundary or release acceptance. Retain worktree and unknown/owner state. No push/PR/merge/archive/publication.

## Executed evidence - 2026-11-04

- Final unfiltered suite on unchanged production: exit1, 3 tests, 1PASS/2FAIL, 0cancelled/skipped/todo, 16173.4924ms. Oracle examples/paraphrases, individual omissions and false timeout/cancellation/Events claims PASS. Existing real-output controls PASS on both surfaces. MCP fails12 missing meaning IDs, CLI fails5. These are public-copy failures, not timeout or setup failures. `.scratch/c3-disclosure-final.tap`, blob `6ee55846eff2d80e63358e0388ac415a92a111bc`.
- Initial execution: exit1, 0PASS/3FAIL, 16692.5549ms. Oracle paraphrase incorrectly excluded `permits` for explicit approval. Corrected the test matcher, and separated overlapping terminal/exact-ack control examples. No production assertion was weakened. Both public tests already reached their semantic missing-meaning assertions. Initial `.scratch/c3-disclosure-red.tap`, blob `8013657f49510c542581cfdd262a9e312bc9150e`. Focused oracle rerun then1/1PASS, followed by the full final run above. Counts are overlapping, not extra workflows.
- New helper has24 MCP rules and7 CLI rules, sharing5 waiting/Events limits. These are executable meaning discriminators, not normative exact-vocabulary requirements. A faithful phrasing outside the accepted alternatives returns to test engineering through coordination for review, not forced production wording or new policy.
- Owned cleanup PASS separately in both full runs: `spike-2dg7L0`, `spike-uoEJki`, `spike-I0ZnF9`, `spike-Lxvdgf` each reached teardown/cleanup-pass in `.scratch/c3-activation/progress.log`. Runner asserts owned process trees/run directories absent and fixture listener released. Ignored TAP/progress retained as failure evidence. No existing shared helpers or runtime state changed.
- Decomposition checklist1-5 allNO for this corrective packet. No new cross-unit state/receiver/proof sequencing. Approved copy restoration only, independent post-source verification still mandatory. No repeat unchanged contract review requested.

## Exact affected-helper revalidation map (separate breadth obligation)

No existing shared helper changed in this corrective packet. Prior helper delta `69ff8d7e` still needs affected validation before broader P3 acceptance:

| Changed helper/seam | Required affected assertions and maintained tests |
|---|---|
| `spike-rpc.mjs` handshake returns initialize result | Handshake/catalog and shutdown regressions: `spike-rpc.test.mjs`, `spike-harness.test.mjs`. Current new public test exercises the returned initialization only, not those entire suites. |
| `portable-waiting.mjs` captures initialization and adds it to connection view | Full `portable-waiting.test.mjs` PORT-A/B and `portable-setup.test.mjs`, plus `portable-registration-http.test.mjs` for registration/strict-protocol path. Current public tests prove only non-strict startup/initialize/help and teardown. |
| Other direct `portable()` consumers of that changed connection setup | Before broader acceptance run `portable-activation.test.mjs`, `portable-privacy-p3.test.mjs`, `portable-races-p3.test.mjs` and `portable-faults-p3.test.mjs`. Earlier behavioral evidence may support review but is not an executed post-helper regression. |
| `lifecycle-p3.mjs` adds CLI observation and optional HTTP headers/deadline | Full `portable-copy-ledger-p3.test.mjs` after correction covers CLI and custom wait registration. Run `portable-lifecycle-p3.test.mjs` and `portable-raw-snapshot-p3.test.mjs` for unchanged default HTTP/cleanup behavior. |

Unchanged helper consumers importing only `success`, `until` or other unmodified exports do not need blanket replay solely because the file changed. Prior activation/privacy/races/faults evidence remains reusable only within its pinned, unchanged assertion scopes. Exact selection/privacy remainder stays in the prior packet, including authored branches after the failing discriminator, rejected/responded retained selection, nonapproval status, duplicate update selection, nonempty context/verbatim question and actor/public-surface privacy. Nothing here closes them.

## Final preparation accounting

- Actual against `8edc8669`: tests37 + helper67 + corrective slice55 + prior slice14 + tasks9 =182 gross across5 paths, production0. Source-only ceilings remain MCP50/CLI30, future evidence60, combined reserved322 under hard600 with278 unallocated. These reservations do not authorize more files or behavior. Prior packet303 is historical, not charged twice to this correction.
- Syntax2/2, scoped whitespace, new-file ASCII/links and independent absence of all4 owned run directories PASS. Tests/OpenSpec formatter-excluded, not formatter-PASS. Production diff against `dae0a47a` empty. After final execution only these owned document records changed. Ready for bounded source correction, not gap closure. Retain existing worktree/branch and owner state, cleanup not due.
