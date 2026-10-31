# Spec Delta

## Purpose

Make the Telegram approval product installable from public npm and release validated versions without publishing from pull requests. Parent: [proposal](../../proposal.md). Status: Draft for product approval.

## ADDED Requirements

### Requirement: Public package and explicit prerequisites
The product MUST be available as an installable public npm package under an owner-approved identity with confirmed publishing rights and a selected license. User documentation MUST state its runtime and OpenCode V2 support floors, configuration and authorization prerequisites, Telegram setup, persistent-state location, and install/start instructions. Package identity, compatibility, licensing, and publisher readiness MUST NOT be presented as verified until supported by evidence.

#### Scenario: Install a released package
- **GIVEN** a clean environment meeting the documented prerequisites
- **WHEN** the operator follows the public npm installation and start instructions for a released version
- **THEN** the packaged product starts without a repository checkout, unpublished local files, or repository-only build steps.

### Requirement: Complete first useful action from empty state
The product MUST support a documented first-use path starting without product configuration, pairing, requests, or decisions. Operators MUST be able to create required Telegram and OpenCode configuration and pairing through supported setup, not manual changes to stored request data.

#### Scenario: First remote decision
- **GIVEN** a clean installation and operator access to the documented external prerequisites
- **WHEN** the operator completes configuration, pairs the private Telegram chat, connects a supported running OpenCode V2 session, creates a request through the supported MCP interaction, and selects Approve
- **THEN** that session receives the explicit approval and the human can distinguish recorded approval from confirmed delivery.

#### Scenario: Incomplete configuration
- **GIVEN** a clean installation missing required configuration or external authorization
- **WHEN** the operator starts setup or attempts the first request
- **THEN** the product identifies the missing prerequisite without granting approval, exposing credentials, or claiming successful setup.

### Requirement: Non-publishing pull-request validation
Pull-request CI MUST build and test the proposed package without publishing a package or triggering a publishing path. Untrusted pull-request execution MUST NOT receive registry publishing credentials.

#### Scenario: Pull-request checks
- **GIVEN** a pull request, including one from an external contributor
- **WHEN** its CI checks run
- **THEN** build and test results are reported, no npm version is published, and publishing credentials are not exposed to that execution.

### Requirement: Validated version-tag publication
An authorized release-version tag MUST trigger CI that validates the tag against the package version, builds and tests the release, checks the installable package, and publishes that version publicly only after those checks pass. Trusted publishing SHOULD be used where supported. Credentials MUST NOT be committed or included in the package or logs.

#### Scenario: Successful release
- **GIVEN** an authorized version tag matching the package version and configured publishing rights
- **WHEN** release build, tests, and packaged-install validation pass
- **THEN** CI publishes the matching public npm version and records the package identity, version, and publication result.

#### Scenario: Failed release validation
- **GIVEN** a release tag whose package version does not match or whose required validation fails
- **WHEN** release CI runs
- **THEN** publication is blocked and the failing check is reported.

#### Scenario: Publisher setup is unavailable
- **GIVEN** package ownership or registry authorization is unavailable
- **WHEN** release CI attempts the publishing stage
- **THEN** it reports the release as blocked or failed without claiming publication or exposing credentials.

### Requirement: Verify registry delivery
Release readiness MUST include installation and startup of the published version from public npm in a clean supported environment. A successful build, locally packed artifact, or archive operation alone MUST NOT count as evidence of public release.

#### Scenario: Confirm published artifact
- **GIVEN** CI reports successful publication
- **WHEN** the exact reported package version is installed from public npm in a clean supported environment
- **THEN** it installs and starts using the documented instructions, or the release is reported as not verified.

## Related Artifacts

- [Pairing and decision acceptance](../telegram-approval/spec.md)
- [Supported session delivery](../opencode-session-continuation/spec.md)
