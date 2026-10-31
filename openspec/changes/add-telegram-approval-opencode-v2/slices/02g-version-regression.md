# 02G — Ordinary unknown-host admission correction

Parent: [tasks](../tasks.md). Authority: [design sections 6/7](../design.md), [continuation delta: Honest compatibility and enforcement boundary](../specs/opencode-session-continuation/spec.md), [02E R4/R5/R8](02e-review-plan.md). Shared harness/lifecycle: [02F](02f-ownership-regression.md).

## Goal, baseline and delivery

Founder-visible success is exact-session, unchanged human-decision continuation after tool timeout. This checkpoint supplies a prerequisite safety guard: a schema-compatible but unverified host must not become a supported product session. Its offline assertions are proxies, not actual host proof or Telegram first use.

- Worktree/branch/change: `.worktree/add-telegram-approval-opencode-v2`, `add-telegram-approval-opencode-v2`; active, retained; test engineering owns lifecycle.
- Project baseline: `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`; authoring/production HEAD `2e1190b0981ff336848c18c399802c41ca7b3e55`.
- Prerequisite: 02F's shared test files available on this same branch; current production setup already present. Production ownership correction is independently gated, not assumed passed by this test.
- One OpenSpec PR for the entire change; these are sequential internal checkpoints. No per-slice branch, PR, archive or merge.
- Status: ready for bounded implementation following Architect approval confirmed by coordination's verification brief. VERSION-EMPTY remains RED at ownership candidate `88754b63b79a43602b83fd23240c5ed586f89508`; next action is this separate production correction, then affected independent verification. No landing/abandonment, so no worktree cleanup authorization.

## Implementation scope and constraints

Likely production paths: `src/opencode/client.js`, `src/broker/broker.js`, `src/broker/delivery.js`, implementation-selected production support-data location and matching operator documentation. Do not combine with broad replay/durability rework. Budget new correction separately under approximately 20 files / 600 gross changed lines; split forward-only checkpoints if forecast exceeds that.

Ordinary production execution must obtain the actual authenticated `ServerInfo.version` and reject an unreviewed version as `UNSUPPORTED_HOST` before creating a request or admitting/retrying a decision prompt. An empty reviewed support set is valid and admits nothing. Preserve the fixed-origin/authentication and intent/identity guards. No SDK-derived version, guessed compatible version/range, wildcard, runtime config/environment override, calibration API or production bypass. A well-shaped unknown response is insufficient support evidence.

Initial host proof is an external test-owned driver under design section 6, followed by reviewed exact-version support-data promotion. This slice neither implements that driver nor seeds support data; no host version has passed. Host proof must precede the real product-boundary spike without bypassing ordinary admission. The latter still requires real public MCP/Telegram continuation and durability evidence.

Test owned here: `tests/host-version-admission.test.mjs`. It uses the implementation-selected journal framing functions only to seed a pairing prerequisite in disposable state. It does not seed the request whose rejection is being asserted or invent a public human-decision endpoint. The fixture is not a supported host and production must not import it. Keep tests unchanged during production implementation; test engineering owns later evidence binding if a private artifact changes.

## Boundary Verification

| Surface | Contract and executable expectation |
|---|---|
| Product entry | Public CLI `init`, `origin add fixture --url http://127.0.0.1:<assigned-port> --password-env PROCEED_TEST_HOST_PASSWORD`, `serve`; authenticated public `POST /v1/requests` with origin credential |
| Request body | `session_id`, `client_request_id`, `action`, `context`; valid pending request input, no version field or bypass flag |
| Host diagnostic | Direct `GET http://127.0.0.1:<assigned-port>/api/info`, `Authorization: Basic base64("opencode:" + fabricated password)`; unwrapped `{version:"unreviewed-fixture-build",pid:12345}` |
| Session fixture | `GET /api/session/ses_fixture` returns `{data:{id:"ses_fixture",title:"Fixture",time:{created:1}}}` if requested; rejecting before this read is permitted |
| Negative outcome | HTTP 503 and `error.code === "UNSUPPORTED_HOST"`; paired journal bytes unchanged, no request transaction or prompt POST; all observed origin calls authenticated |
| Telegram | Every HTTPS request refused by test preload before socket creation; no token, real chat, approval or poller traffic |

This offline listener substitutes for an external host only in these controlled negative assertions. It is not calibration, a forwarding listener, or evidence of any OpenCode version's compatibility. No live endpoint was exercised. Real affected-boundary/first-use proof remains BLOCKED outside this task, not waived. Exact live wire/auth constraints remain in design sections 6/7; no new protocol or field mapping is introduced.

## Run order and acceptance

Use 02F's finite Windows-native harness/cleanup and bounds. From the active worktree, PowerShell, with a 120-second outer bound: first `node --test tests/broker-ownership.test.mjs` for that correction, then `node --test tests/host-version-admission.test.mjs`, then `npm run format:check` and `git diff --check`. Only affected failures need replay. Native Node 22 is authoring/diagnostic evidence, not provisional Node 24 compatibility. No dependency/build change warrants replaying accepted setup suites.

`VERSION-EMPTY` maps the unsupported-host scenario and design section 6's empty-set rule to the public HTTP error, retained authentication, unchanged journal and absence of prompt effects. Success means this negative admission case passes, not that retry/reconciliation or supported-version cases passed; delivery/retry gates must still receive affected executable binding before integrated acceptance. Decomposition/test-artifact review trigger and ownership shared-harness applicability are recorded in 02F. Interface-fidelity review is required through coordination before implementation readiness.

## Gap and RED evidence — 2026-10-31

`SPIKE-VERSION-001`: OPEN; correction attempts **0**; next owner **implementation engineering via coordination**. At production HEAD above, final combined affected command recorded in 02F exited **1**; `VERSION-EMPTY` is **RED**: public request returned **201** with no error instead of **503 / UNSUPPORTED_HOST**. Actual authenticated `/api/info` was observed at the immutable fixture origin. No supported data or successful calibration is claimed.

Cleanup **PASS**: fixture listener closed, managed PID/namespace teardown succeeded; `tests/.artifacts` empty. Local raw log: `.scratch/startup-regressions/red.tap`. No real host/Telegram/session, real credential or environment-file read, production edit, new production test API, PR/archive/push/publish. Only disposable fixture-generated local authentication tokens were read. The worktree remains active/retained; integrated verification is not yet available.

Internal 02G preparation packet against authoring HEAD: **2 new paths / 117 gross added lines** including this evidence; shared support/index assigned to 02F without double-counting. Combined preparation size/check results are in 02F. Subsequent production correction must be measured independently. New sources/specs and task additions remain readable in the assigned worktree without a commit; no parallel owner files were staged.

## Ready implementation handoff after 02F attempt 1

Production baseline for this checkpoint: `88754b63b79a43602b83fd23240c5ed586f89508` in the same retained worktree/branch. The independent rerun of VERSION-EMPTY on Windows Node 22.23.1 exited 1 (1 fail, 5426.1862 ms): authenticated fixture version read succeeded, public request was admitted as 201 rather than rejected as 503 / UNSUPPORTED_HOST. Assertions after that mismatch did not execute. Fixture listener and managed namespace/PID cleanup passed. See [02F attempt 1](02f-ownership-regression.md#attempt-1--independent-affected-verdict-2026-10-31) for candidate identity, runtime limits and separate ownership verdict.

Implement only the ordinary admission correction in this spec and approved design section 6: reviewed support set initially empty; authenticated actual-version admission before creation and decision admission/retry; no seeded support, runtime override or calibration bypass. Keep all test/support files unchanged. Run ownership regression first, then VERSION-EMPTY, formatter and diff checks as specified above, using an already available representative Node 24 runtime if supplied; otherwise label Node 22 results diagnostic. Report exact production revision/diff size, commands/results and unbound delivery/retry cases. The single VERSION-EMPTY case is not sufficient integrated delivery/retry proof. Independent affected verification follows through coordination. No new worktree, PR, live host/Telegram use, support-data promotion or recovery authority is included.
