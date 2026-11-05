# Spec Delta

## Purpose

Make the Telegram approval preview installable from public npm with truthful setup instructions and a distinct MCP Registry listing. Parent: [proposal](../../proposal.md). The proposal's [approved preview boundary and scoped risk acceptance](../../proposal.md#approved-preview-boundary-and-scoped-risk-acceptance) govern deferred live proof and remaining publication gates.

## ADDED Requirements

### Requirement: Public package and explicit prerequisites
The product MUST be available as the public npm preview `@meshimize/proceed-mcp@0.1.0-preview.1` with requested dist-tag `preview` and the user-selected MIT license. Copyright attribution, licensing rights and publisher identity MUST be confirmed, not fabricated.

#### Scenario: Disclose the first-publication tag exception
- **GIVEN** for this first publication only, the observed `latest` mapping is an exception to the original preview-only plan
- **WHEN** publication and installation are documented
- **THEN** documentation MUST disclose that both tags point to this version and npm rejected removal of `latest` with HTTP 400.
- **AND** documentation MUST recommend exact-version installation and MUST NOT claim stable verified status or authorize future previews on `latest`.

#### Scenario: Confirm organization-scoped identity and affected evidence
- **GIVEN** the user selects npm organization `meshimize` and publisher account `davemeshimize`
- **WHEN** the scoped preview is prepared
- **THEN** the npm artifact MUST be `@meshimize/proceed-mcp@0.1.0-preview.1`, with public access and tag `preview`. Actual organization/package-write permissions MUST be confirmed rather than inferred from organization membership or login.
- **AND** MCP Registry identity MUST remain `io.github.renl/proceed-mcp`, repository MUST remain `https://github.com/renl/proceed-mcp`, and MIT copyright attribution MUST remain Ng Cheng Leong.
- **AND** package metadata, installation instructions and Registry package references MUST consistently identify the scoped npm artifact without renaming the MCP Registry identity.
- **AND** prior unscoped pack/install proof MUST NOT qualify the renamed artifact. Affected package and clean-install gates MUST be repeated against the scoped candidate with a new recorded artifact hash.
- **AND** native application evidence MAY be reused only for unchanged inputs and assertion scope, not as proof of scoped package delivery.

#### Scenario: Document preview prerequisites and evidence limits
- **GIVEN** the public npm preview
- **WHEN** its README and package contents are prepared
- **THEN** the README MUST state runtime and MCP prerequisites, actual tested versions/configurations and their evidence limits, Telegram configuration and authorization, persistent-state location, install/start instructions, MCP wiring, supported commands and known limitations.
- **AND** it MUST distinguish supplied manual Telegram/OpenCode first-use evidence from independently reproduced verification. Unexecuted checks MUST remain unverified. Automatic post-timeout continuation, Events, completed doctor diagnostics and delivery retry MUST remain identified as unsupported or incomplete.
- **AND** package availability, licensing metadata, registry listing, compatibility and publisher readiness MUST NOT be presented as verified until supported by evidence.
- **AND** example configuration and package contents MUST NOT include credentials or private runtime state.

#### Scenario: Install a released package
- **GIVEN** a clean environment meeting the documented prerequisites
- **WHEN** the operator follows the public npm installation and start instructions for a released version
- **THEN** the packaged product starts without a repository checkout, unpublished local files, or repository-only build steps.

### Requirement: Complete first useful action from empty state
The product MUST support a documented first-use path starting without product configuration, pairing, requests, or decisions.

#### Scenario: Create foundational configuration through supported setup
- **GIVEN** an installation without product configuration, pairing, requests, or decisions
- **WHEN** the operator follows the documented first-use path
- **THEN** operators MUST be able to create required MCP and Telegram configuration, the transport principal and request authority described in [delivery ownership](../opencode-session-continuation/spec.md), and private pairing through supported setup, not manual changes to stored request data.
- **AND** that requirement defines the approved request-key ownership boundary, not an unresolved approval gate.
- **AND** baseline first use MUST NOT require an OpenCode API/password, proprietary host metadata, MCP Events, a proprietary wrapper, or a dedicated connection for each agent session.

#### Scenario: Explain private first-use authority
- **GIVEN** the documented first-use path
- **WHEN** request preparation and waiting are explained
- **THEN** instructions MUST cover preparation, private retention of request authority, and the subsequent question call that waits for the outcome.
- **AND** they MUST distinguish caller labels from authenticated identity.
- **AND** instructions MUST disclose that sharing the key with another context under the bound principal grants request access, that it does not grant access under another principal, and that possession or retrieval does not wake an agent.
- **AND** keys MUST NOT appear in Telegram, logs, assistant acknowledgements, or published evidence.

#### Scenario: Document manual testing without claiming deferred proof
- **GIVEN** the approved preview acceptance
- **WHEN** the README and prepublication evidence are prepared
- **THEN** the README MUST include a manual procedure for the first useful action and Approve, Reject and exact Respond testing after installation.
- **AND** it MUST distinguish expected behavior from observed proof and disclose client timeouts, lost-call retention, authorized retrieval, explicit receipt acknowledgement and the expected subsequent assistant acknowledgement.
- **AND** the live scenarios below were deferred from prepublication acceptance. Subsequent supplied results MUST be reported within their actual scope, not as independent reproduction or a full-release pass.
- **AND** clean packaged installation/startup, secret safety and independent applicable integrated-candidate verification MUST retain their acceptance obligations. The approved manual publication before implementation merge MUST NOT count as proof those obligations passed or authorize landing without integrated verification.
- **AND** no live bot, credential, polling or protected-state access is granted by this deferral.

#### Scenario: First remote decision after installation - prepublication live proof deferred
- **GIVEN** a clean installation and operator access to the documented external prerequisites
- **WHEN** the operator completes MCP and Telegram setup without a harness API/password or proprietary session metadata, pairs the private Telegram chat, connects the first validation harness, prepares request authority through `prepare_approval`, uses it in `request_approval`, and selects Approve while that question call remains active
- **THEN** that waiting call returns the explicit approval and matching request identity, and the human can distinguish recorded approval from confirmed delivery.

#### Scenario: Baseline setup without events - prepublication live proof deferred
- **GIVEN** a clean installation and an MCP harness without the enhanced event capability
- **WHEN** the operator follows baseline setup and completes a remote decision before the call times out
- **THEN** the first useful waiting-call result is available without enabling events, and automatic post-timeout resumption is clearly identified as unavailable rather than required for setup.

#### Scenario: Incomplete configuration
- **GIVEN** a clean installation missing required configuration or external authorization
- **WHEN** the operator starts setup or attempts the first request
- **THEN** the product identifies the missing prerequisite without granting approval, exposing credentials, or claiming successful setup.

#### Scenario: Read first-use instructions before live testing
- **GIVEN** a new operator or installing agent has no product state
- **WHEN** they follow the README
- **THEN** installation, supported empty-state setup and the manual first-decision procedure are documented without stored-data editing, deferred commands are not prerequisites, and unexecuted live checks are explicitly unverified rather than passed.

#### Scenario: Report supplied manual first-use results
- **GIVEN** the supplied setup transcript reports pinned public-preview installation, private pairing, five tools, Approve, Reject, exact Respond, two concurrent correctly correlated outcomes and five terminal acknowledgements, with no proposed action executed
- **WHEN** first-use acceptance evidence is reconciled
- **THEN** those results MUST be identified as user-supplied live evidence, not independent reproduction, general compatibility or proof of all release and failure-path checks.
- **AND** unexecuted checks and unconfirmed shutdown MUST retain those limits. Request capabilities MUST NOT be reproduced in evidence or public reports.

### Requirement: Non-publishing pull-request validation
Pull-request CI MUST build and test the proposed package without publishing a package or triggering a publishing path. Untrusted pull-request execution MUST NOT receive registry publishing credentials.

#### Scenario: Pull-request checks
- **GIVEN** a pull request, including one from an external contributor
- **WHEN** its CI checks run
- **THEN** build and test results are reported, no npm version is published, and publishing credentials are not exposed to that execution.

### Requirement: Validated version-tag publication
First-preview acceptance MUST permit the approved user-controlled manual publication before implementation merge, without requiring collector, CLI or release-workflow publishing automation.

#### Scenario: Preserve first-preview acceptance boundaries
- **GIVEN** the approved first-preview manual-publication exception
- **WHEN** landing obligations and publication authority are assessed
- **THEN** non-publishing PR validation and independent applicable integrated-candidate verification remain landing obligations.
- **AND** deferred automation, including protected trusted publishing and its qualification, MUST NOT be reported as delivered or passed.
- **AND** no subsequent publication, permanent manual route or token fallback is authorized by this exception.

#### Scenario: Retain separately authorized subsequent-version policy
- **GIVEN** the subsequent-version automation scenarios below retain deferred follow-up policy, not first-preview completion criteria or authority to implement or publish
- **WHEN** that follow-up is considered or resumed
- **THEN** this follow-up MUST receive its own scope and authorization before work resumes.
- **AND** in that future scope, an authorized preview-version tag MUST use protected trusted-publisher CI with tag/version agreement, build, tests, clean packaged installation/startup, secret-safe contents and independent applicable candidate verification.
- **AND** missing or ambiguous prerequisites MUST block publication without a manual or token fallback.

#### Scenario: Establish publication prerequisites
- **GIVEN** a preview candidate for publication
- **WHEN** publication prerequisites are assessed
- **THEN** documentation MUST accurately describe the candidate and deferred live checks before publication.
- **AND** confirmed package rights, approved MIT licensing and truthful publisher/copyright metadata are required.
- **AND** protected trusted publishing for subsequent versions MUST remain deferred follow-up, not a prerequisite for first-preview completion. Only the first-publication exception below permits the selected interactive route in this change.
- **AND** credentials MUST NOT be committed or included in the package or logs.
- **AND** observed manual publication MUST NOT be treated as proof that all gates passed. No future publication or deferred live-proof pass is authorized here.

#### Scenario: One-time interactive first preview publication
- **GIVEN** the user selects manual first publication of `@meshimize/proceed-mcp@0.1.0-preview.1` before implementation merge
- **WHEN** the user publishes the first preview interactively
- **THEN** the delivered artifact MUST be identified by exact package/version and cryptographic hash, separately from the later integrated landing candidate. The earlier merged-candidate prerequisite is superseded for this first publication only, not satisfied retroactively.
- **AND** actual package-write permission, licensing rights and publisher authentication MUST be confirmed before publication. Reported login and `whoami` as `davemeshimize` alone MUST NOT count as those confirmations or 2FA proof.
- **AND** the user MUST control authentication and any required interactive 2FA. Agents MUST NOT read npm credential files or tokens.
- **AND** the requested publication channel MUST be public `preview`. The observed first-publication `latest` exception MUST be disclosed as specified above, not generalized to future releases.
- **AND** changed packed inputs MUST NOT be called identical to the published artifact. Applicable candidate revalidation MUST distinguish repository documentation changes from immutable published bytes. This reconciliation MUST NOT republish, alter the version or retry tag removal.
- **AND** failed or unexecuted checks MUST retain their actual results, not become passes because publication occurred. The exception MUST NOT create a permanent manual publishing path or token fallback.

#### Scenario: Distinguish bootstrap delivery from CI qualification
- **GIVEN** first interactive publication is selected or completed
- **WHEN** release readiness and evidence are reported
- **THEN** protected trusted-publisher CI configuration, collector/CLI/release-workflow work and qualification MUST remain deferred follow-up obligations, with pull-request CI non-publishing. Their completion MUST NOT gate this first preview.
- **AND** interactive publication MUST NOT count as successful CI publication or verified trusted-publisher operation or provenance.
- **AND** actual CI publishing qualification MUST remain unverified until a subsequent authorized preview version passes the required gates and is published through protected trusted-publisher CI.
- **AND** pending CI qualification MUST be reported separately from first-preview delivery, without requiring that first preview to have been CI-published.

#### Scenario: Successful release
- **GIVEN** separately authorized deferred publishing automation, an authorized subsequent preview tag matching the package version, confirmed publishing rights and MIT licensing, and completed independent applicable candidate verification
- **WHEN** build, tests, clean packaged installation/startup, secret-safety and documentation gates pass
- **THEN** CI publishes the matching public npm preview under `preview`, not `latest`, and records the identity, version and publication result without claiming deferred live proof or stable verification.

#### Scenario: Failed release validation
- **GIVEN** separately authorized deferred publishing automation and a release tag whose package version does not match or whose required validation fails
- **WHEN** release CI runs
- **THEN** publication is blocked and the failing check is reported.

#### Scenario: Publisher setup is unavailable
- **GIVEN** separately authorized deferred publishing automation and unavailable package ownership or registry authorization
- **WHEN** release CI attempts the publishing stage
- **THEN** it reports the release as blocked or failed without claiming publication or exposing credentials.

### Requirement: Verify registry delivery
Verified npm preview delivery MUST include installation and startup of the exact published version from public npm in a clean supported environment. A successful build, locally packed artifact or archive operation alone MUST NOT count as public delivery evidence.

#### Scenario: Preserve public-install evidence boundaries
- **GIVEN** the npm preview delivery check
- **WHEN** delivery evidence or readiness is reported
- **THEN** this postpublication check is distinct from prepublication package validation and MUST NOT be claimed before it runs.
- **AND** supplied manual public-install evidence MUST be distinguished from independent reproduction.
- **AND** successful npm installation MUST NOT imply verified live Telegram/OpenCode behavior or stable release readiness.

#### Scenario: Confirm published artifact
- **GIVEN** the authorized one-time user bootstrap or subsequent protected CI reports successful publication
- **WHEN** the exact reported package version is installed from public npm in a clean supported environment
- **THEN** it installs and starts using the documented instructions, or the release is reported as not verified.
- **AND** public readback MUST confirm the exact identity/version and actual dist-tag mappings. For `0.1.0-preview.1`, both `preview` and `latest` point to that version. This narrow observed exception MUST NOT be reported as a preview-only mapping or authorization for future `latest` publication.

#### Scenario: Preserve independently matched published bytes
- **GIVEN** independent public download comparison matches the retained 140852-byte artifact with SHA-256 `43866cb0c8eaa3feb3d90c598d6ecbfdea8b7886f3af7e584a4e6b32b4fb9adc`, and 45 of 46 packaged files match the reconciled checkout with README the sole intentional difference
- **WHEN** artifact and candidate evidence are reused
- **THEN** public-byte equality MUST be recorded as passed within that scope, separately from installed live behavior and integrated-candidate acceptance.
- **AND** the changed repository README MUST NOT be described as identical to the immutable package README or require republishing that version. Runtime/package/license evidence MAY be reused only for unchanged inputs and assertion scope.

### Requirement: Distinct MCP Registry publication
The intended MCP Registry listing MUST be tracked separately from npm package publication. Its package identity, preview version, installation metadata and limitations MUST match the actual npm preview and README.

The listing is a distinct delivery obligation, not deferred publishing-automation work. The qualified official publisher validated the accepted manifest, and the user reported successful publication.

#### Scenario: Assess listing rights and claims
- **GIVEN** an intended MCP Registry listing
- **WHEN** listing publication or its status is considered
- **THEN** registry publishing rights MUST be confirmed before listing publication.
- **AND** the selected listing name `io.github.renl/proceed-mcp` MUST NOT count as proof of Registry authentication or namespace rights. Schema validation and compatible publisher authentication MUST be confirmed separately from npm login or publication.
- **AND** a listing MUST NOT imply a hosted broker, verified live integration or stable release. Live broker deployment is not required.
- **AND** failed or pending registry publication MUST be reported independently without hiding a successful npm publication or claiming both succeeded.

#### Scenario: Confirm registry listing separately
- **GIVEN** the exact npm preview version is published and registry publication is authorized with confirmed rights
- **WHEN** the listing is published and checked
- **THEN** the listing points to that installable preview with accurate metadata, and registry success is recorded separately from npm delivery and deferred live testing.
- **AND** public exact-version readback at `2026-11-05T13:45:07.2167022Z` returned HTTP 200 with active `io.github.renl/proceed-mcp` version `0.1.0-preview.1`, matching npm identity/version, repository, stdio transport and five ordered arguments. This evidences the actual publication attempt, not future namespace rights or runtime behavior.
- **AND** readback omits two optional `isSecret:false` properties. Architecture review accepts that serialization omission as non-blocking under the schema's false default and publisher serialization, not exact JSON equality or proof of Registry-consuming client behavior.
- **AND** final independent evidence reconciliation remains required. The acceptance scenarios are unchanged.

#### Scenario: Registry listing is unavailable
- **GIVEN** npm publication succeeded but registry rights, prerequisites or publication are unavailable
- **WHEN** publication results are reported
- **THEN** npm publication retains its actual result, registry publication is explicitly blocked or unverified, and no combined npm-and-MCP publication success is claimed.
