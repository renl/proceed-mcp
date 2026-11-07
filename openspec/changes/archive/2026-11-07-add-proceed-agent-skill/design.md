# Proceed agent skill design

Deliver reusable instructions for the existing Telegram-only runtime, without changing its authority or delivery behavior. Product scope and acceptance remain in the [proposal](proposal.md) and [guidance delta](specs/proceed-agent-guidance/spec.md).

## Context and feasibility

The proposal and delta are feasible against the current `telegram-approval`, `opencode-session-continuation`, and `npm-distribution` specs. No conflicting product requirement was found. The five exposed tool definitions and server instructions in `src/mcp/server.js` supply the concrete workflow. The skill shall explain those interfaces, not introduce another tool contract.

This change can land independently on `main`. It has no stacked parent or dependency on startup, native permission integration, or dual-channel answers. Existing broker setup, pairing, MCP connection, and permitted private request-authority retention remain prerequisites for use, not new implementation scope.

The approved delivery order is full-program development and deployment before operator hands-on acceptance. Interim operator testing shall not block development of the separately bounded startup and dual-channel changes. This order does not establish missing boundary proof or authorize an unmet archive, merge, or deployment gate. The [proposal's delivery and acceptance order](proposal.md#delivery-and-acceptance-order) governs those steps.

## Decisions

### 1. Distribute one self-contained repository artifact

The implementation shall supply `skills/proceed/SKILL.md`. This is the distributable source, not an automatically installed skill in this repository. It shall contain the complete agent workflow without scripts, companion references, or links that require this repository to exist in the consuming project.

`README.md` shall identify this artifact and explain copying its complete contents into the consuming project's `.opencode/skills/proceed/SKILL.md`. The source shall be obtainable from the public repository at an identified revision. Installation evidence shall record the revision used. No installer, HTTP catalog, package distribution platform, or global configuration change is needed.

The path-derived ID shall be `proceed`. Frontmatter shall include `name: proceed` and a description advertising Telegram human approval and request-specific instructions. It shall not disable model advertising. README guidance shall distinguish advertising from loading, document explicit `@proceed` loading, and describe the exact-ID `skill` tool invocation as `id: proceed` where needed. Loading still requires the selected agent's permission.

Do not place the distributable under upstream-generated `.opencode/skills/openspec-*`, alter those files, or install into a developer's global skill directory. An operator shall inspect an existing destination before replacing it. Duplicate-ID troubleshooting shall not instruct permission weakening.

### 2. Keep runtime and npm delivery unchanged

The implementation deliverables are only `skills/proceed/SKILL.md`, README additions, and proportionate test/evidence artifacts defined during test planning. No application source, public schema, state format, dependency, MCP configuration, or runtime version changes are required.

The `package.json` files allowlist currently includes `bin`, `src`, and `README.md`, not `skills`. Keep that allowlist and version `0.1.0-preview.1` unchanged. Deliver the skill from the repository, separately from the existing npm runtime. Neither an npm install nor the existing published tarball installs this skill. A changed repository README is not an update to immutable published package bytes. Publication and the separately requested README-refresh release are outside this change.

### 3. Teach the exposed five-tool workflow

The installed skill shall instruct the agent to inspect its actual exposed tools, including their namespace or access mode. Use the logical names below without assuming one host prefix. Exposed definitions govern argument constraints and returned structures.

| Tool                   | Guidance responsibility                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare_approval`     | Obtain and privately retain `request_handle`, `request_id`, and `request_capability`. Preparation sends no actionable Telegram question.                                                                            |
| `request_approval`     | Use the prepared handle and capability with `client_request_id`, exact `action`, distinguishing `context`, and optional `expires_in_seconds`. This creates or replays one request and waits for the actual outcome. |
| `get_approval`         | Retrieve the same request using retained `request_id` and `request_capability` under the same transport principal. Retrieval is observation, not agent resumption.                                                  |
| `cancel_approval`      | Use only for authorized explicit closure of that request. Do not cancel merely because a wait was lost. A terminal outcome remains unchanged.                                                                       |
| `acknowledge_approval` | Acknowledge the returned matching `decision_id` with the retained request identity and capability. Do not claim confirmation if this call fails.                                                                    |

The skill shall explain outcome handling by reference to the existing approval and delivery contracts. Read `resolution` separately from `delivery_state`. Only `approved` permits the identified action within existing permissions. `responded` preserves the exact instructions and never supplies approval. Rejection, expiry, cancellation, pending status, silence, and errors authorize nothing. Deduplicate by `(request_id, decision_id)` before any action. Receipt or replay never authorizes a second effect.

The assistant's human-facing receipt shall contain the matching request identity and outcome, not the capability. Acknowledgement records receipt, not execution of the proposed action or universal delivery success.

### 4. Retain authority privately and fail closed

Private request authority shall be used only in authorized tool arguments and permitted private retention. The skill shall not prescribe a new persistence mechanism, public transcript, ordinary evidence file, or credential-store lookup. Display labels remain caller-supplied context, not authenticated identity.

Lost waits and uncertain creation shall lead to explicit authorized retrieval using retained identity, not blind replacement questions. `NOT_FOUND` cannot distinguish an unused reservation, an unknown request, and denied authority. It shall not be treated as proof that submitting a duplicate is safe. Missing capability or matching principal blocks retrieval. Do not switch sessions or inspect protected state to recover it.

Missing tools or broker/pairing prerequisites shall lead to safe diagnostics and operator-directed supported setup. The skill does not start the broker, handle credentials, manufacture human answers, automate native permission replies, or bypass permissions. Events, automatic post-timeout continuation, completed `doctor`, and delivery `retry` remain unavailable.

### 5. Connect installation to a harmless first use

README additions shall link the existing install, broker, owner, pairing, and MCP setup sections rather than reproduce setup commands or invent a second setup path. The first-use procedure shall explicitly load the installed skill, then request approval of a clearly labeled test that performs no consequential action, shell command, or file modification.

The procedure shall ask the paired human to select Approve in Telegram while the waiting call remains active. It shall check the matching request and `approved` resolution, acknowledge the returned decision, and issue a capability-free receipt. A timeout follows the documented retained-request recovery path and is not a successful active-wait demonstration.

## External boundary evidence

Source: [official OpenCode V2 skills guide](https://opencode.ai/v2/docs/skills/), read in full on 2026-11-06. The documented V2 interface supports project-local `.opencode/skills/<id>/SKILL.md`, description-based advertising, path-derived case-sensitive IDs, exact-ID tool loading, and user `@skill-id` loading. It also documents permissions and later-source duplicate-ID precedence. No skill installer CLI is documented or required here.

This source is a dated V2 documentation baseline, not a pinned executable release. Verification shall record the actual OpenCode version used. No compatibility claim extends beyond observed evidence. A larger integration spike is unnecessary for file placement. The smallest boundary proof is real installation and loading before the harmless first-use demonstration.

## Verification and handoff implications

### Agent-owned pre-merge verification

- Engineering shall review the artifact and README against each guidance-delta requirement, current tool definitions, secret safety, and excluded behavior. Check frontmatter, exact path/ID, self-containment, links, installed-copy equality, and bounded instructional examples for Respond-as-instructions, lost-wait retrieval, missing authority, and repeated decisions.
- Independently executable host checks remain engineering-owned. In an authorized isolated consuming fixture, install the exact supplied file and use a real permitted OpenCode V2 agent to demonstrate discovery and explicit `proceed` loading. Record source revision, installed-content equality, harness version, and safe load evidence. A parser, copy test, or mock loader alone does not prove this boundary. Missing executable, access, or environment leaves real-host proof BLOCKED, without requiring interim user testing or authorizing configuration changes.
- Existing independent evidence `340d0a77` for implementation candidate `f6230cca` records 9/9 native checks, eleven instructional scenarios, and exact-byte installation-copy/cleanup passing. [Task 3.1 and its evidence](tasks.md) now record actual OpenCode v2.2.5 installation, discovery, and native exact-ID `proceed` loading PASS, with fixture cleanup separately PASS. The unchanged source and installed copies are each 7,051 bytes with SHA-256 `30dfc4b8720d622f4484561d26546f6e326cb6fcf13fe7e8d13c4df030d4e47c`. The alternate `@proceed` route is unexercised and not required under the clarified product scenario. Only task 3.2 live Telegram first use remains deferred and UNPROVEN until full-program operator acceptance. The explicit scoped acceptance recorded in tasks permits archive and PR merge with that check deferred, not feature verification or release readiness. Reuse existing runtime evidence only for unchanged assertions, not as proof of the newly installed skill.

### Post-full-program operator acceptance

- Schedule the paired human's harmless prepare/wait/Approve/acknowledge/receipt demonstration and final hands-on acceptance after the complete program preview is deployed from clean, merged `main`. Preserve decision 5's active-wait, matching request and decision, acknowledgement, and capability-free receipt assertions. Static review, simulated outcomes, or agent-authored approval cannot supply actual paired-human Telegram proof.
- External prerequisites still require separately authorized operator-controlled access. This design grants no bot, credential, polling, protected-state, or global-configuration access. Unavailable proof remains BLOCKED and unverified until observed. Demonstrations establish bounded behavior, not universal model adherence or permission enforcement.

### Landing and exposure gates

- SDET shall reconcile task timing and evidence with this order, separating completed agent checks, unavailable required real-boundary proof, and post-deployment operator acceptance. Preserve historical verdicts and record later proof outside the change folder if it has been archived. No new prototype, harness, runtime API, or security surface is required by this correction.
- Independent integrated-candidate review and the primary spec author's final delta review remain required before the authorized CLI archive and single change PR. At an actual archive, merge, or deployment gate, unresolved required checks need eligible, explicit scoped preview-risk acceptance for that specific step. Record the missing assertion, evidence, residual risk, mitigation, accountable owner, authorized step and preview scope, and expiry or review trigger. The approved delivery order is not that acceptance, and an accepted or deferred check is never passed.
- Do not add another signoff on the approved product delivery order. Skill landing does not establish full-program deployment or operator acceptance. Deployment and publishing remain separate authorized operations from clean, merged `main` through an authorized release route. No package publication or new runtime qualification is implied.
