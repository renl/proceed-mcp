# Checkpoint 1 independent verification — 2026-10-31

Parent: [tasks](../tasks.md). Scope: [setup checkpoint](01-setup.md), accepted design sections 1–2. This records observations and prerequisites, not new acceptance criteria or authorization for checkpoint 2.

## Verdict and identity

**FAIL — correction needed; not slice-ready.** The existing checkpoint test passes, but additional assertions through the same public executable expose URL-validation violations of design section 2. Feature verification, first-use verification and release readiness remain unachieved. Nothing is waived.

- Candidate: `533ea27b67e6c32c89b9e26bccc8432f73d63f27`, branch `add-telegram-approval-opencode-v2`.
- Baseline: local `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`. No remote refresh or remote-state claim in this scoped run.
- Worktree: `.worktree/add-telegram-approval-opencode-v2`. Tracked diff and untracked path set were empty before testing and after execution, before writing this evidence.
- Dependency identity: candidate `package-lock.json`, lockfile version 3; sole development dependency `prettier@3.9.10`, integrity `sha512-skGHTH1Yb9QvaTC4hWnRTzEYtCpApF0UMBPz+t/0ZPzP8ihefo/btKd+QA7pUE0fEwA1SbS/NmhyEcstdXOIdA==`. No runtime dependency or lifecycle install script.
- Environment: Windows, Node `24.22.2` from npm's `node` distribution, downloaded into ignored root-project tooling cache. npm `10.9.8`; no claim of release-toolchain readiness or an approved support floor.
- Native Windows is representative for these offline file/ACL and public-CLI checks. No server, network application request, real session or real credential was used. Package-manager downloads are not external application-boundary proof.

## Execution and assertions

Commands ran from the change worktree with a 120-second outer bound, except structural/identity checks bounded at 10 seconds. `$Node24` below denotes the project-local Node 24 executable; `$NpmCli` denotes the installed npm CLI entry point. Existing test children have 5-second deadlines; additional CLI/ACL diagnostic children had 30-second deadlines and bounded output.

| Check / command | Assertion result | Cleanup result |
|---|---|---|
| `& $Node24 $NpmCli ci --no-audit --no-fund --cache <project-local-cache>` | PASS, exit 0; clean replacement of dependencies from the committed lockfile | Dependencies retained as development tooling, not a running resource |
| `npm run build`, with Node 24 first on PATH | PASS, exit 0; all 11 production modules parse, declared bin exists | No generated runtime artifact or process remains |
| `node --check tests/cli-setup.test.mjs`, Node 24 | PASS, exit 0 | No resources created |
| `node --test tests/cli-setup.test.mjs`, Node 24 and `PROCEED_TEST_COMMAND` JSON argv containing that same executable and `bin/proceed-mcp.js` | PASS, exit 0; 1 passed, 0 failed/cancelled/skipped | Run directory removed; artifact directory empty |
| `npm run format:check` | PASS, exit 0; formatter checks production-owned content, excluding tests/planning/generated integrations per committed ignore file | No files changed |
| One-time public-CLI persistence/security assertions, Node 24 | PASS, exit 0; details below | Run directory removed and absence asserted |
| One-time public-CLI URL-contract assertions, Node 24 | **FAIL, exit 1; 4 of 4 additional assertions failed** | Run directory removed and absence asserted |
| Root project-local CLI `openspec validate add-telegram-approval-opencode-v2 --strict` | PASS, exit 0, CLI 1.15.0; structural only | No files changed |
| Candidate identity / `git diff --exit-code` / `git diff --check` before evidence edits | PASS; unchanged candidate, clean tracked/untracked state | `tests/.artifacts` contained 0 entries |

The first attempted `npm ci` used the system PowerShell npm wrapper, which selected Node `22.23.1` despite Node 24 being first on PATH. It exited 0 with an engine warning and is diagnostic-only. The clean install was repeated once by explicitly invoking the npm CLI with `$Node24`; that run exited 0 without an engine warning. Subsequent Node 24 test processes were explicitly pinned. This is a tool-wrapper distinction, not an application failure or a passed cross-host release gate.

Additional security assertions verified persisted state, not merely command exit:

- Repeated `init` exits 2 and leaves configuration/control-credential hashes unchanged.
- Duplicate origin exits 2 and leaves binding/credential bytes unchanged.
- Control and per-origin credentials are distinct 64-hex values (256-bit shape); configuration contains environment names, not synthetic password/token values or credential contents. No credential value appeared in captured CLI output. Randomness itself is grounded in the production `randomBytes(32)` call, not certified statistically by this check.
- Independent `Get-Acl` checks cover state directory, credentials directory, config, control credential and origin credential: current account owns each, with exactly one Allow FullControl ACE for that account (5/5).
- A lock containing the verification process's own live PID prevents `origin add` with exit 3 and no configuration change. No real broker ownership was manipulated.
- Invalid JSON and unsupported schema exit 4; a manually widened remote origin exits 2. The rejected configuration bytes stay unchanged.
- Removing helper lookup from the child environment makes `init` exit 4 and removes its newly created state directory. Protection fails closed; no credential remains there.

## Blocking finding: literal URL validation

Gap ID: pending coordination assignment. Correction attempts: **0**. Next proposed owners: test engineering for authorized persistent regression tests, implementation engineering for the production correction, then independent affected verification. No correction dispatched or performed in this review.

Authority: design section 2 requires a literal `127.0.0.1` host, an explicit port, and rejection of automatic URL substitution. `src/config/origin-url.js:15–39` validates the already-normalized WHATWG URL. That parser expands IPv4 aliases and removes the default port before validation.

After initializing an isolated run-owned state directory, invoke each case through:

```console
node bin/proceed-mcp.js origin add <unique_id> --url <case> --password-env PROCEED_TEST_HOST_PASSWORD --state-dir <isolated_state>
```

| Case | Required exit | Observed exit |
|---|---:|---:|
| `http://127.1:4096` | 2 | 0 |
| `http://2130706433:4096` | 2 | 0 |
| `http://0x7f000001:4096` | 2 | 0 |
| `http://127.0.0.1:80` | 0 | 2 |

The first three are stored as substituted canonical bindings rather than rejected. They still resolve to loopback; this evidence does **not** claim remote-host access or credential exfiltration. The fourth is an explicit valid port rejected because the parser removes `:80`.

Exploratory diagnostics also accepted `/a/..`, an empty `?` delimiter and an empty `#` delimiter, all normalized away. These are recorded observations, not additional invented acceptance rules; clarify any disputed raw-syntax interpretation with the contract owner. The four assertions above independently establish failure without relying on these observations.

Revalidation after correction should cover literal-host/default-port regressions, the existing setup test, persisted immutability, build and formatter for affected files. No unrelated live-boundary suite was executed or needs replay for this isolated correction alone.

## Checkpoint 2 secure prerequisite brief

Checkpoint 2 is **not execution-ready**. The following restates tasks 2.1–2.4 and the existing Boundary Verification block; it does not broaden authority.

| Prerequisite | Evidence available / missing | Next responsibility |
|---|---|---|
| Verified setup checkpoint present on this branch | Candidate exists; Node 24 Windows checks available, URL correction still needed | Test and implementation engineering, routed through coordination |
| Finite repository-owned out-of-process harness | Absent; only `tests/cli-setup.test.mjs` exists. Need isolated state/ports/process tree, bounded readiness/total/HTTP deadlines, redacted output and resource manifest, teardown on failure/timeout and verified absence. Prove teardown before live use | Test engineering; operations only if actual environment/access preparation is required |
| Reviewed fault and observation sequence | Existing checkpoint 1 acceptance does not cover the transport-fault sequence. Need observation before request creation, durable creation before receipt suppression, actual host-side MCP execution timeout, and the host kept alive | Contract review through coordination before live execution |
| Isolated authenticated OpenCode V2 host | `opencode --version` returns `v2.2.5`; this proves installed CLI presence only. No isolated running authenticated endpoint, reserved port, scoped password-variable injection or two disposable sessions has been demonstrated | Operations/operator supplies approved nonproduction environment and access; no shared user sessions |
| Host identity and source grounding | Research OpenAPI exists in root project tooling; SHA-256 `92cc33ef9a107c8af6295e6fcbdf6d339d4374955910924456bd91a76844a5db`. This is a research snapshot, not a running-host source hash or compatibility result. Need live `/api/info`, actual host version/PID, matching captured source contract, exact session IDs/creation times, and preserved running host across broker restart | Test engineering captures only in approved environment |
| Secure origin registration | Need immutable explicit loopback origin, Basic username `opencode`, nonempty password injected via a named environment variable, and separate protected MCP-origin credential. Never paste secrets into chat/argv/artifacts, discover registrations globally, expose a public listener, or use anonymous fallback | Operator/operations provides scoped environment; public CLI setup only |
| Dedicated Telegram bot/private human | No dedicated nonproduction bot identity, securely injected `PROCEED_TELEGRAM_BOT_TOKEN`, private chat/operator participation or exclusive polling ownership demonstrated. Need approved pairing interaction; token identity verified by `getMe` during authorized execution; no competing poller/webhook or automatic webhook deletion | Operator/operations provides secure access and agreed interaction window |
| Minimal executable spike path and assertions | Broker, MCP adapter, pairing, request/prompt/outbox path and live assertions are unimplemented. Need real MCP 2025-11-25 handshake/tools/call, trusted session metadata and both direct/Code Mode paths; no internal-handler or human-decision endpoint substitute | Test engineering supplies tests/harness; implementation engineering supplies minimum path after scoped authorization |
| Complete live case matrix | Need Approve/Reject/Respond; active/idle/busy; before completion and after forced MCP timeout; two-session isolation; lost POST response; stable ID replay after broker restart and inbox departure. Require exact-session subsequent assistant acknowledgement, exact intent and bounded duplicate observation. Admission/history alone is not proof | Test engineering executes only after the above prerequisites |

Root project status and local research/tool files do not demonstrate credential readiness, dedicated bot ownership or isolated host health. No home/global configuration, credential store or real session was inspected; no environment-variable value was enumerated. Tool installation is not secure environment readiness. Missing readiness remains BLOCKED, not waived. Release identity/license, npm publisher/bootstrap and publication are separate later gates, not prerequisites for an authorized private spike.

## Proof boundary and retained state

Founder-visible success remains a real human decision reaching only its requesting running session with a useful subsequent turn after MCP timeout. This run proves only the passing offline setup/security assertions listed above. It supplies no Telegram/OpenCode continuation proof, no CI execution, no packed all-OS first use and no publication proof.

Windows ACL behavior is exercised. POSIX/macOS/Linux branches are **implemented but unexecuted**, and current-owner checks there are not independently certified. The README's Windows/POSIX wording is an implementation description, not an all-OS tested-support claim. The Node 24 result does not establish a final support floor; npm 10.9.8 does not satisfy the future npm >=11.5.1 publishing target.

Assertion status: FAIL overall. Test-resource cleanup: PASS, owned run directories absent, artifact directory empty. Worktree lifecycle: **active / retained**, not cleanup-ready; feature pending. Root dirty bootstrap was preserved. The ignored project-local Node/npm verification cache and normal worktree development dependencies remain intentionally retained; neither is a running service or a temporary credential store.

Only this evidence file and evidence/status fields in `tasks.md` / `slices/01-setup.md` are finalized after the tested candidate. Code, tests, dependency declarations/lockfile, configuration and baseline are unchanged. This docs-only delta does not repair or supersede the failed candidate verdict. No PR, archive, push, worktree removal or publication was performed.
