## Why

Windows operators need usable initialization and subsequent approval operations without Proceed-specific filesystem permission preparation. Custom protection admission currently blocks that outcome. The user explicitly accepts leaving Windows file security to the operator, including the risk that OS-readable keys can be stolen and OS-writable approval records can be tampered with.

## Direction Check

Subject: Windows operators using Proceed. Desired outcome: initialize and use existing approval workflows with ordinary OS file access.
Problem: custom permission checks and protection-query prerequisites obstruct setup and normal use. This change removes those barriers, not broker ownership, authentication or human decision authority.

## What Changes

- Windows initialization and normal operations use ordinary OS access for state, journals, broker ownership records, control/owner credentials, operator keys and confidential-channel keys. No custom ACL, owner, mode, inheritance, local-fixed-NTFS or protection-query admission or permission repair remains for those objects.
- Existing Windows data remains usable without reinitialization, migration, key rotation or pairing changes. This is not an init-only bypass that leaves later operations blocked.
- Retain file type/path identity, no-overwrite and exclusive creation, atomicity, flush, journal integrity and required storage separation as correctness safeguards, not secret-permission gates.
- Retain exclusive broker ownership, locking, liveness and supported stale-ownership recovery. Do not automatically delete locks or take over uncertain ownership.
- Keep authentication, capability and principal boundaries, TLS, network scope, pairing authority, ordinary OS access failures, POSIX state/key protection and the existing ordinary Telegram-token file policy unchanged.
- Ship a concise current-version README explaining operator-managed Windows storage and plaintext key/record exposure. Describe proposed `0.1.0-preview.9`, not a publication claim or release history.

## User Stories

- As a Windows operator, I want supported initialization and normal approval use without special filesystem permission preparation, so that installation leads to a usable approval workflow.
- As an existing operator, I want my state, keys and pairing preserved, so that upgrading does not require rebuilding authority or losing pending work.

## Boundary and Dependencies

The first useful independently landable outcome is the complete Windows setup-to-approval path plus continued operation over existing state under ordinary OS access. This is a user-visible change, not an unexposed foundation.

It can land independently against `main` and relies on the current [delivery capability](../../specs/opencode-session-continuation/spec.md) and [distribution capability](../../specs/npm-distribution/spec.md). It has no dependency on another configuration session or its unknown cleanup state.

This supersedes the Windows filesystem admission policy recorded in [enforce-windows-secret-protection](../archive/2026-11-10-enforce-windows-secret-protection/proposal.md). The separate token policy recorded in [simplify-telegram-credential-storage](../archive/2026-11-12-simplify-telegram-credential-storage/proposal.md) remains unchanged. Those records remain historical.

Excluded: POSIX security changes, token-policy changes, automatic stale-lock deletion, authentication or network changes, pairing redesign, storage migration, permission bypass flags, native helpers, services, compilers and new protection frameworks. Publication, installation and runtime mutation require separate authority.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: Windows storage admission, preserved authority and existing-data behavior, first-use and operator security disclosures.
- `npm-distribution`: matching packaged prerequisites, current-version guidance and empty-state setup without Windows protection preparation.

## Impact

Windows storage confidentiality and resistance to local record tampering become operator responsibilities. Any OS principal able to read local keys can obtain their authority, and any principal able to write approval data can tamper with it. TLS and application authentication do not protect against stolen endpoint keys or writable local records.

Implementation and unit regressions must cover both initialization and subsequent state/journal/key operations. Only portable JavaScript/TypeScript unit tests are currently authorized. Independent review remains required. Native/runtime, installed first-use and Telegram outcomes remain unverified until separately permitted evidence exists. Prior preview acceptances do not authorize this candidate's landing or exposure.

Read next: [delivery delta](specs/opencode-session-continuation/spec.md), [distribution delta](specs/npm-distribution/spec.md), then the focused architecture design.
