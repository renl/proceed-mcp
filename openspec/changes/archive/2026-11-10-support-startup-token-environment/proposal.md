# Proposal

## Why

Normal MCP startup currently requires a protected token file even though the foreground broker already accepts a private environment token. Support that ordinary environment route for automatic startup without adding token-file machinery or another secret provider.

## Direction Check

Subject: ordinary broker-startup users. Desired outcome: automatic startup using a privately supplied environment token.
Problem: the file-only, adapter-token-free contract blocks this route. This change relaxes that boundary only for trusted startup inheritance, not token logging or persistence.

## What Changes

- Permit the trusted launch environment to supply the Telegram token to the host and MCP startup process for automatic cold broker startup, without provisioning a token file.
- Define cold-start source precedence, fail-closed missing-source behavior and replacement requirements for token rotation. Preserve the existing protected-file path and foreground modes.
- Keep tokens out of MCP configuration, product storage, outputs and logs. Filter unnecessary inheritance by product-launched helpers.
- Document that the launch environment must supply the token again after restart. This is not persistent secret setup or a reboot-startup service.

## User Story

As an operator, I want normal MCP startup to use my privately supplied environment token, so that I can start the broker automatically without saving a token file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: allow a private environment source for automatic broker startup while preserving file-mode protection and existing approval safeguards.

## Boundary and Acceptance

The first useful increment is one independently landable change from merged `main`: complete supported setup from empty state and obtain the first Telegram decision through normal MCP startup using a launch-supplied token, without a token file or manual broker terminal. Binary acceptance outcomes are in the [capability delta](specs/opencode-session-continuation/spec.md).

This change depends only on the merged capability at repository-relative `openspec/specs/opencode-session-continuation/spec.md`, not the separate Windows protection correction change `enforce-windows-secret-protection`. It neither fixes nor waives Windows state/key protection defects, activates Windows use, nor promises blanket platform compatibility. The existing Windows worktree remains separate and preserved.

Excluded: custom executables, signing systems, new secret providers or frameworks, global or user-wide token persistence, trusted-launcher construction, state/key protection redesign, authentication or decision-routing changes, deployment and publication.

## Impact

Automatic startup, credential-source selection, helper environment handling and setup/privacy guidance change. Broker authentication, transport principals, decision correlation, journal redaction, ownership and readiness safeguards remain unchanged. The trusted host may hold the token. The product controls only its own handling and launched helper environments, not unrelated parent processes.

Verification remains scoped to JavaScript/TypeScript Node unit tests compatible with Linux and independent review. Unit evidence is not native, installed or live-runtime verification. The assigned version is `0.1.0-preview.3`. Publishing requires separate authorization and does not inherit an earlier preview exception.

## Current Approval Boundary

The user explicitly approved the environment route and now directs "Finalize and merge" for PR #8 after owner review and green final unit CI. This current decision authorizes the narrow trusted-host/adapter environment exception described here. It does not establish that an earlier pre-implementation review occurred, and does not derive authority from an archived approval or the preview.2 publication exception.

The current acceptance covers merge only with startup, real-process privacy, installed first use, live Telegram and restart/rotation checks still unrun, plus the manually checked target-race risk. Those checks remain UNVERIFIED, not passed. Candidate-specific conditions and review triggers belong in repository-relative `docs/status_log.md` and PR #8. Publication of preview.3 and local Windows activation remain separately unauthorized.
