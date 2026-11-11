# Delta for npm-distribution

Install without secrets, explicitly configure Proceed once, and preserve credentials across package replacement. Parent: [proposal](../../proposal.md). Technical contracts: [design](../../design.md).

## Direction Check

Subject: npm-installed Proceed and its operator. Outcome: private setup followed by useful approval from a fresh token-free harness launch.
Problem: secrets coupled to harness launch or package lifetime. Installation stays secret-free and credentials stay outside both.

## MODIFIED Requirements

### Requirement: Public package and explicit prerequisites
The product MUST be available as the public npm preview `@meshimize/proceed-mcp@0.1.0-preview.1` with requested dist-tag `preview` and the user-selected MIT license. Copyright attribution, licensing rights and publisher identity MUST be confirmed, not fabricated. Ordinary npm installation MUST require no Telegram secret or credential interaction. Proceed-owned credential provisioning MUST be an explicit operator action after installation, not an npm lifecycle hook or custom installer. Packaged instructions MUST cover supported Windows and POSIX storage prerequisites and one-time private provisioning independently of any harness. Credentials, state and keys MUST remain outside package installation/prefix directories. Package replacement or upgrade MUST preserve that external credential, state, keys, pairing, journal and uncertain artifacts without automatic migration, overwrite or rotation. This extension does not change historical publication policy or authorize another publication.

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

#### Scenario: Install without credential side effects
- **GIVEN** a clean supported environment with no Proceed credentials or state
- **WHEN** the operator installs the npm package normally
- **THEN** installation neither requests nor captures a Telegram token and runs no credential-setup hook
- **AND** it creates no pairing, request, decision or standing approval
- **AND** subsequent private setup uses the installed Proceed command without a custom installer, native helper or harness-specific secret mechanism.

#### Scenario: Explain supported Windows credential prerequisites
- **GIVEN** an operator follows packaged persisted-credential instructions on Windows
- **WHEN** choosing the default or an explicit credential location
- **THEN** instructions identify the supported local fixed NTFS envelope, verifiable protection and dedicated account-only safe inheritance required for child files and directories
- **AND** they do not guarantee ordinary home defaults meet those prerequisites
- **AND** they explain the consistent explicit credential-path alternative, refusal without storage repair, and removal of a higher-priority token from the actual harness launch environment to select the default persisted route
- **AND** supported POSIX prerequisites and the existing private environment/foreground routes remain documented.

#### Scenario: Package replacement preserves configured use
- **GIVEN** completed supported setup with protected credentials, state, keys, pairing and journal outside installation/prefix directories
- **WHEN** the operator replaces or upgrades the npm package
- **THEN** those external artifacts and uncertain ownership records are neither deleted, moved, overwritten nor migrated by package replacement
- **AND** subsequent normal MCP startup can use the unchanged configured credential without reprovisioning or token re-entry
- **AND** package replacement alone does not enable a disabled integration or prove runtime operation.

### Requirement: Complete first useful action from empty state
The product MUST support a documented first-use path starting without product configuration, credentials, pairing, requests, or decisions. After ordinary secret-free npm installation, supported setup MUST establish protected state, a transport principal, separately protected credentials and authorized private pairing through installed Proceed. The persisted route MUST support the first useful approval after a fresh token-free harness launch on supported Windows and POSIX storage. Credential persistence alone MUST NOT count as completion. Existing private environment-token first use remains supported without persistent token provisioning.

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

#### Scenario: Complete installed persisted setup and fresh-launch approval
- **GIVEN** an ordinary npm installation with no credentials, state, owner, pairing, requests or decisions, and documented Windows or POSIX prerequisites
- **WHEN** the operator follows installed Proceed instructions to initialize protected state, add a transport principal, privately provision the separate credential and authorize private-chat pairing
- **AND** safely stops the broker and starts a fresh supported harness with no Telegram token in its environment or configuration
- **AND** normal MCP use calls `prepare_approval`, then `request_approval` with the returned authority, and the paired human selects Approve while the call remains active
- **THEN** the same waiting call returns the matching explicit approval without token re-entry, a harness secret entry or a separate broker terminal
- **AND** setup alone neither enables a disabled integration nor grants standing approval or native permission bypass.

#### Scenario: New credential outcomes retain their own evidence limits
- **GIVEN** this credential-setup increment is assessed under the project's unit-only JavaScript/TypeScript verification restriction
- **WHEN** setup, package or first-use readiness is reported
- **THEN** automated tests use normal unit tooling runnable on Linux without PowerShell or Windows dependencies, and independent review remains required
- **AND** native protection, terminal privacy, installed first use, login/reboot startup, actual Telegram delivery and multi-harness behavior remain unverified until permitted evidence exists
- **AND** neither source review, unit results nor preview.3 risk acceptance substitutes for candidate-specific landing or exposure decisions.
