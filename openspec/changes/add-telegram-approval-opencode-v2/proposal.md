# Proposal

Status: Active change with user-approved preview scope. First npm preview manually published before implementation merge. Integrated landing and distinct Registry delivery remain unresolved. Parent: [project direction](../../../../AGENTS.md). Read next: capability specs below.

## Why

Humans supervising parallel sessions need an installable npm/MCP preview of the implemented Telegram approval flow and truthful instructions for manual testing after installation. The portable baseline returns the actual human outcome through the waiting MCP tool call. Publication alone does not prove live first use, independent integrated acceptance or stable readiness.

## Direction Check

- Subject: the published portable preview and its users. Desired outcome: land requirements and documentation consistent with the manually published package and accurately bounded evidence.
- Problem: obsolete pre-merge publication, preview-only tag and mandatory automation terms obstruct finalization. This reconciliation addresses those conflicts without weakening waiting-call authority, safety or remaining verification and Registry obligations.

## What Changes

- Provide approval requests in a private Telegram chat controlled by a paired human, with Approve, Reject, and Respond actions.
- Keep typed responses as instructions, never implicit approval. Silence, timeout, expiry, cancellation, and errors never grant approval.
- Persist requests and decisions, distinguish parallel sessions, and prevent duplicate or conflicting decisions and wrong-session delivery.
- Return Approve, Reject, or Respond through the active standard MCP tool call, not merely an immediate creation receipt. This baseline requires neither MCP Events nor proprietary session metadata or a harness API/password; client execution and transport timeouts still apply.
- Use two ordinary MCP tool calls: prepare private request authority, then submit the question and wait for its actual outcome. Preparation alone creates no actionable question or Telegram message. Shared connections must keep concurrent results matched to their original calls; no proprietary wrapper or per-agent connection is required. Subsequent request access requires its private key and bound transport principal; sharing the key within that principal transfers authority, not an active call's response destination or an event route.
- Explicitly identify Events and automatic post-timeout continuation as unsupported in this preview. Retain authorized retrieval and truthful delivery status without promising that retrieval wakes an agent.
- Document the supported empty-state setup, pairing and first-decision path for manual testing after installation. Report supplied live first-use evidence separately from independent verification.
- Reconcile public npm preview distribution and retain a distinct MCP Registry listing obligation. Pull-request CI builds/tests without publishing. The user selected and completed manual first publication before implementation merge. Future collector, CLI and release-workflow publishing automation is deferred outside first-preview acceptance. Manual publication is not proof of CI publication.

## Capabilities

### New Capabilities

- `telegram-approval`: paired-human requests, explicit decisions, durable state, and race/expiry safety. [Delta](specs/telegram-approval/spec.md).
- `opencode-session-continuation`: portable waiting-call delivery, authorized retrieval and honest unsupported continuation. The existing capability path is retained for traceability, not as a harness restriction. [Delta](specs/opencode-session-continuation/spec.md).
- `npm-distribution`: clean installation, truthful first-use instructions, gated preview publication and distinct registry-delivery evidence. [Delta](specs/npm-distribution/spec.md).

### Modified Capabilities

None. There are no current capability specs.

## User Stories

- As a supervising human, I want to approve, reject, or respond in Telegram, so that I can direct work remotely without accidentally authorizing an action.
- As a human using an MCP harness, I want the waiting tool call to return my actual decision without proprietary host setup, so that remote supervision is portable.
- As a human running parallel sessions, I want waiting results correlated to their invoking contexts and later access restricted to request-key holders under the bound transport principal, so that unrelated work is not affected.
- As a new operator, I want to install a public npm package and complete documented setup, so that I can make my first useful decision without repository-only tooling or preloaded data.
- As an installing agent, I want accurate setup instructions and explicit preview limits, so that I can configure the product without mistaking unverified behavior for tested compatibility.
- As a maintainer, I want exact-artifact publication evidence and non-publishing pull-request checks, so that the published preview is identifiable and pull requests do not publish accidentally.

## Scope and Readiness

The linked scenarios define preview behavior, subject to the explicit evidence deferrals below. This change can land independently on `main` as an exposed installable preview, not an unexposed foundation or stable verified release. It has no dependency on a future continuation change or live broker deployment. OpenCode V2 is the first manual validation target, not a core dependency. No tested multi-harness compatibility or MCP execution-permission enforcement is claimed.

### Approved preview boundary and scoped risk acceptance

The user explicitly accepted shipping the implemented approval flow for manual Telegram/OpenCode testing AFTER installation. The preview excludes automatic post-timeout continuation, MCP Events support, completed `doctor` diagnostics and delivery `retry`. Additional harness integrations, exited-process recovery, browser inboxes and floating widgets remain excluded. Existing safe unavailable responses are not completed doctor/retry features. Supported status/error reporting, active-call reconnect and Telegram transport recovery remain in scope. This deferral does not remove their safety or durability rules.

The user accepted publication before live Telegram/OpenCode first-use proof. Subsequent user-supplied setup evidence reports pinned public-preview installation, private pairing, five discovered tools, Approve, Reject, exact Respond, two concurrent correctly correlated outcomes and all five terminal acknowledgements, with no proposed action executed. Treat this as supplied manual live evidence, not independently reproduced full-release acceptance, proof of every failure path or confirmed shutdown. Unexecuted checks remain unverified. The original scoped risk acceptance is not a blanket waiver, credential permission or security change.

Preview verification and delivery obligations (publication has occurred, not proof these all passed):
- Clean build, applicable tests and clean packaged installation/startup without repository-only files or steps.
- Secret-safe package contents, logs, examples and documentation, with unchanged authorization, privacy and fail-closed behavior.
- Independent applicable integrated-candidate verification against the reduced preview scope, with evidence limits and deferred live checks recorded separately.
- Complete, accurate README covering installation, empty-state setup, MCP wiring, private pairing, manual first-decision testing, timeouts, private authority retention, supported status and known limitations. It must distinguish supplied live evidence from independent verification and identify Events/doctor/delivery retry as unsupported or incomplete. Published package README bytes remain immutable even when repository documentation is corrected.
- Confirmed package identity, MIT licensing and truthful copyright/publisher metadata. Selected identity/version is `@meshimize/proceed-mcp@0.1.0-preview.1` in npm organization `meshimize`, published with requested tag `preview`. Both `preview` and `latest` now point to it, and npm rejected removal of `latest` with HTTP 400. This observed first-publication exception is not stable-release status or permission to assign `latest` to future previews. Pin the exact version. The user selected MIT, copyright holder Ng Cheng Leong and npm publisher account `davemeshimize`. Publication establishes that attempt's result, not future publishing rights or independent licensing-authority proof.
- Authorized publication with separate npm delivery and MCP Registry listing evidence under the distribution delta. Registry listing is not proof of package delivery or live behavior.

### One-time first npm publication bootstrap

The user selected manual first preview publication and moved future collector, CLI and release-workflow publishing automation off the first-preview path. The first publication occurred before implementation merge. This supersedes the earlier post-merge bootstrap sequence, not the need for independent integrated verification before landing. Login alone never proved permission or publication. The observed publication proves only the actual attempt, not future publishing rights.

- The selected npm artifact is `@meshimize/proceed-mcp@0.1.0-preview.1`. MCP Registry identity remains `io.github.renl/proceed-mcp`, and the repository remains `https://github.com/renl/proceed-mcp`. Organization scope does not change MIT attribution or prove permission to publish in `meshimize`.
- The published preview is the retained reviewed tarball, SHA-256 `43866cb0c8eaa3feb3d90c598d6ecbfdea8b7886f3af7e584a4e6b32b4fb9adc`, 140852 bytes. Independent public download comparison matches those exact bytes. All 45 shipped runtime/package/license files match the reconciled checkout, with README the sole intentional difference among 46 files. This is artifact evidence, not a merged-candidate verdict. A newly packed README would produce a different artifact. Do not republish or alter the immutable version to reconcile documentation.
- Prior unscoped package/installation evidence does not qualify the renamed artifact. Reconcile affected package identity, documentation and Registry package references, then repeat affected package and clean-install checks against the scoped artifact. Native application evidence remains reusable only for unchanged inputs and assertion scope. No wholesale verification reset or inherited package-delivery pass is implied.
- The user controls publisher authentication and any required interactive 2FA. Agents must not read npm credential files or tokens. Record the actual `preview`/`latest` mapping and rejected removal honestly. Do not retry removal, unpublish or republish as a workaround.
- This exception applies only to the first npm preview publication. It adds no permanent manual-only release route or token fallback. Pull-request CI remains non-publishing. No subsequent version or publishing route is authorized here.
- Protected trusted-publisher automation, its collector/CLI/release-workflow work and its blocked qualification are deferred follow-up obligations, not first-preview completion gates. Preserve prepared work and failed/unreached evidence without marking it passed. Future automation must retain fail-closed validation and separate authorization. Manual publication proves neither trusted-publisher operation nor provenance.
- Exact-version public npm installation/startup and dist-tag readback remain delivery obligations. Supplied installation/live results and independent byte equality have their distinct evidence limits above. MCP Registry schema validation, authentication, namespace rights and listing readback remain separate pending requirements for `io.github.renl/proceed-mcp`, not canceled or passed.

After these applicable pre-archive gates and owned design/task reconciliation, this bounded change may be completed and archived through the authorized lifecycle without implementing deferred features or falsely ticking old Events/live requirements. Publication and postpublication registry delivery retain their separate evidence gates. This correction grants no merge, archive, publication, live-credential access, new harness development or Ctrl+Break implementation authority.

### Follow-up boundary

Automatic continuation/Events, completed doctor/delivery retry, further compatibility qualification and deferred publishing automation belong to separately scoped future changes when work begins. Existing automation policy and prepared evidence remain follow-up context, not delivered preview outcomes. Manual live validation records actual results in the live status/evidence records. Any defect or added capability returns through the normal scoped correction/change decision. No future follow-up is a dependency of this preview.

The approved project direction authorizes work within that scope, including the empty-state setup checkpoint; the deltas' active-change status does not require renewed blanket approval. The scenarios elaborate that direction, not a claim that the user separately approved every authored detail. Material changes to scope or security and explicitly reserved owner decisions require targeted confirmation.

Selected activation wording and its selection rules are retained in the [C3 product-copy annex](#c3-product-copy-annex). This is copy guidance for the approved behavior, not a second behavior spec or an availability claim.

### Shared-connection security decision - approved request-key ownership

The user explicitly approved request-specific bearer authority after disclosure of same-principal key transfer, as recorded in the [project direction](../../../../AGENTS.md#approved-direction-and-scope) and [latest milestone](../../../../docs/status_log.md#2026-10-31--portable-waiting-call-direction-and-request-key-approval). A request key (called a request capability in the [design, decisions 2–3](design.md)) plus its protected transport principal authorizes that request. The trusted harness routes each original result to its invoking context and keeps capabilities private. Labels and request IDs grant no authority. Capabilities must not appear in Telegram, logs, assistant acknowledgements, or published evidence. Preparation before waiting lets a caller retain authority for cancellation or retrieval if the waiting result is lost; it is not a replacement for the actual human outcome.

A valid capability shared with another context on the same principal grants that context request access, including retrieval or cancellation. This is approved behavior, not an isolation defect. The capability does not authorize a different transport principal. Ordinary shared-principal MCP does not authenticate a nontransferable agent-session identity. Original-call correlation, including reverse-order results, is a separate routing obligation, not proof of that stronger identity. `Exact originating-session delivery` retains its name for traceability and states this approved boundary. The ownership-approval blocker is resolved. Verification must retain its recorded scope and limits. Neither possession of a key nor retrieval wakes an agent. Enhanced exact-session event routing is deferred outside this preview and is not established by a request capability.

External contracts for included behavior retain source-grounded MCP and Telegram requirements. Waiting-call proof must not depend on an OpenCode API support allowlist. Event-wire research and enhanced-path proof are future work, not preview gates. Generic notifications, retained history or explicit retrieval must never be described as automatic agent resumption.

MIT, copyright attribution Ng Cheng Leong, npm artifact `@meshimize/proceed-mcp`, publisher account `davemeshimize`, and Registry identity `io.github.renl/proceed-mcp` are selected. Public npm publication is observed. Licensing authority, future publishing rights, broader support qualification, deferred publisher setup and Registry authorization retain their separate evidence limits. Never commit credentials. Direct OpenCode API/password setup is paused. This correction authorizes neither an unauthenticated replacement nor weaker ownership/privacy controls. No event compatibility, independent full live-integration verdict or Registry listing success is claimed here.

## Correction Traceability

The earlier correction replaced OpenCode-only integration with portable waiting-call delivery and retained a required enhanced continuation path. The user-approved preview correction now supersedes that enhanced-path completion promise and prepublication live first-use proof to enable installation before manual testing. Requirement names remain where possible for traceability. Neither the superseded scope nor historical failures become completed preview work. Existing design, tasks and tests require owner reconciliation, preserving historical evidence and explicitly deferring obsolete obligations rather than marking them passed.

The subsequent manual-publication decision supersedes the pre-merge publication restriction and first-preview automation dependency. The observed first-publication `latest` mapping is a narrow exception to the original preview-only plan, not a future tag policy. Public-byte equality and supplied manual live evidence do not close integrated verification or distinct Registry delivery. Reconcile downstream gates to these distinctions without converting failed automation checks to passes.

The approved request-key reconciliation supersedes the prior unresolved nontransferable-session criterion under `Exact originating-session delivery`. It separates original-call correlation from capability-and-principal authorization, accepts same-principal key transfer, and preserves cross-principal denial, confidentiality and paired-human decisions. It does not establish an event route. See the approved decision above and the [topology preflight](slices/03-portable-waiting-preflight.md). Its dedicated-connection finding predates the revised design. Existing tests must follow this boundary rather than treating authorized same-principal transfer as a defect.

## Impact

This introduces an installable portable MCP preview, Telegram approval interaction, persistent decisions, operator documentation, non-publishing PR validation and a distinct MCP Registry listing obligation. First npm publication was manual. Request-key ownership remains approved as described above. Application stack, binding mechanisms, interfaces, storage and CI implementation belong to design. Event continuation, doctor, delivery retry and future publishing automation are deferred, not delivered by this change.

## C3 Product-Copy Annex

Persist the selected human-facing copy for complete paired-human decision activation. This annex adds no scope, behavior, delivery evidence or implementation authority.

### Authority and activation gate

- Canonical product behavior: [explicit approval and rejection](specs/telegram-approval/spec.md#requirement-explicit-approval-and-rejection), [responses are instructions only](specs/telegram-approval/spec.md#requirement-responses-are-instructions-only), [expiry and cancellation](specs/telegram-approval/spec.md#requirement-expiry-and-cancellation-are-non-approval-outcomes), and [portable waiting-call outcomes](specs/opencode-session-continuation/spec.md#requirement-portable-waiting-call-outcome-delivery).
- Exact contract clauses: [design section 5, C3](design.md#c3-response-opening-prompt-mapping-and-exact-human-resolution), especially "Typed text parser and correlation", "Single-winner writer and durable consequences" and "Acknowledgements, UI and partial failures". Delivery selection follows [section 6, Source-grounded baseline](design.md#source-grounded-baseline) and [A2b ledger transition clarification](design.md#a2b-ledger-transition-clarification). MCP privacy, retention, acknowledgement and timeout instructions remain governed by [section 3](design.md#3-mcp-and-local-cross-component-contracts).
- Switch all active Telegram onboarding, MCP instructions/catalog, CLI availability and status wording together with complete Approve/Reject/Respond opening, prompt correlation and text-resolution activation. Do not activate these claims at callback-core-only or another partial checkpoint. Do not defer truthful wording until after activation. Until then retain the applicable incomplete-stage disclosures.
- This annex makes no live C3 claim. Controlled evidence is not live Telegram, human first-use or release proof. Events remain unsupported and the enhanced path is deferred outside preview acceptance. The earlier [experimental design](design.md#experimental-enhancement-intent-specified-wirecode-blocked) requires owner reconciliation to this boundary.

### Recorded human outcomes

After durable commit/install and matching-wait wake, compose exactly `prefix + " " + suffix`. Select the prefix from the committed human resolution and the suffix from the current delivery ledger, never from Telegram UI success or an assumed receipt. Do not echo response text, request authority or private actor details.

| Resolution | Exact prefix |
|---|---|
| `approved` | Approval recorded. |
| `rejected` | Rejection recorded. This does not authorize the action. |
| `responded` | Instructions recorded, not approval. |

| Delivery | Exact suffix |
|---|---|
| `pending` | Delivery is pending, not confirmed. |
| `returned` | The adapter reported writing the result to the original call. Receipt is not confirmed. |
| `confirmed` | Receipt acknowledged by a request-capability holder. |
| `unavailable` | Automatic delivery is unavailable. Authorized retrieval requires the retained request capability. |
| `blocked` | Delivery is blocked. Ask the operator to check proceed-mcp status. |

### Callback and text selection

| Admitted situation | Exact copy or selection |
|---|---|
| Respond first opened or already open, still pending | Neutral callback dismissal with no text. Opening is not a recorded instruction or decision. |
| Authorized expired target | This request expired. No new choice was recorded. A new request is needed if approval is still required. |
| Authorized cancelled target | This request was cancelled. No new choice was recorded. A new request is needed if approval is still required. |
| Authorized retained other terminal target | This request is already resolved. The recorded outcome is unchanged. |
| Refused callback | This request is not available. |
| Duplicate update | Neutral acknowledgement only, not a second recorded-choice claim. |
| Paired sender with uncorrelated or malformed response | No response was recorded. Select Respond on the intended request, then reply to its prompt or send /respond <request_id> <text>. Text is instructions, not approval. |
| Unauthorized text | Silent. |

Foreign callbacks never disclose a private outcome. Admission, cursor durability and no-effect/refusal selection follow the cited C3 clauses. Neutral spinner dismissal may precede processing. No recorded-choice message precedes durable installation/wake, and failed UI acknowledgement never reverses the outcome.

Preserve `renderPortableReplyPrompt` in [portable-render.js](../../../../src/telegram/portable-render.js) exactly, including its full request ID and line breaks. Preserve the accepted question layout, identity fields and 4096-character bound. This annex changes neither rendering nor length rules.

### Onboarding, CLI and MCP activation copy

| Surface | Selected copy |
|---|---|
| Successful pairing | Paired. Approval questions can be sent to this chat. Select Approve, Reject or Respond on a request. Respond text is instructions, not approval. |
| Matching paired `/start` | You are paired with this local broker. Select Approve, Reject or Respond on an approval request. Respond text is instructions, not approval. |
| CLI availability | Local waiting, Telegram question display and paired-human Approve, Reject and Respond are available. Respond text is instructions, not approval. |

Nonmatching onboarding and existing refusal copy remain unchanged. Pairing success still requires the durable pairing/cursor commit. CLI availability retains client-timeout, lost-call-not-cancellation and unsupported-Events disclosures.

Selected compact MCP outcome wording: "Only an explicit Approve grants approval. Reject records rejection. Respond records request-specific instructions only after valid correlated text. Approval-like words in Respond text never grant approval."

Retain the existing instructions to keep and privately retain the request capability with its handle/ID, never echo authority in assistant acknowledgements, and distinguish same-principal capability transfer from original-call response ownership or event routing. Retain matching terminal acknowledgement, subsequent assistant outcome acknowledgement and `(request_id,decision_id)` deduplication before acting. Client timeout or a lost call does not cancel the durable request. Retrieval does not wake an agent, and neither retrieval nor acknowledgement creates another decision. Exact longer MCP phrasing may follow these existing approved meanings without adding policy.

### Status selection

For a pending resolution, select by recorded presentation state, not by token presence, scheduled work or presumed receipt:

| Presentation | Exact note |
|---|---|
| `pending` | Presentation is still pending: not yet sent, and no decision was recorded. |
| `sent` | Telegram accepted a question message. Human receipt is not confirmed, and no decision was recorded. |
| `failed` | A Telegram presentation attempt failed. No successful message mapping is recorded, and no decision was recorded. |

For sent pending work, the selected next action is "wait for the paired human to select Approve, Reject or Respond". For unsent/failed work, use the actual redacted diagnostics and applicable configuration repair/restart action, never a recorded-decision claim. Presentation interpretation remains governed by design section 5, "Send ordering and truthful state".

For terminal human outcomes, use the recorded-outcome prefixes above with actual ledger evidence. Expiry and cancellation remain non-approval closures requiring a new request if approval is still needed. Respond never implies approval. Preserve existing status layout and `owner_id`/display-only `session_label` identity fields under design section 2, "A1b diagnostic and observation scope". Do not add public fields or treat presentation, callback acknowledgement or a read as returned/confirmed delivery.

## Related Artifacts

- [Project status](../../../../docs/status_log.md)
- Product acceptance: the three capability deltas linked above.
