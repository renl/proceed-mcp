# Proposal

## Why

Windows credential provisioning and loading currently skip required ownership and permission checks and assume safe path ancestry, leaving credentials and approval state without the protection already required by the product contract. Complete Windows support must make safe provisioning and loading work while refusing unsafe or unverifiable conditions, rather than treating refusal-only containment as completion.

### Direction Check

Subject: Windows users' credentials and approval state. Desired outcome: working, protected Windows provisioning and loading.
Threat/problem: skipped protection checks and assumed path safety. This correction enforces those checks on successful and refused operations without weakening the approved security boundary.

## What Changes

- Complete Windows owner-only credential provisioning and broker-only loading, including the affected protected-state and path admission needed for those operations to be safe.
- Require verified ownership, permissions, safe path ancestry and object identity for admitted credentials and affected state. A checked path must not authorize use of a different or substituted object.
- Refuse unsafe or unverifiable protection with an actionable, secret-free next step. Do not bypass checks, relax protection, overwrite existing credentials or repair unsafe storage automatically.
- Preserve credential separation, token confidentiality, existing durable work and all non-Windows safeguards. Keep secure foreground operation available without persistent token provisioning.
- Deliver the complete correction in one independently landable PR from merged `main`. The first useful increment is working protected Windows setup and loading, not a refusal-only release or a separate helper foundation.
- Prepare new release bytes as `0.1.0-preview.3`. Publication and installation remain separately authorized actions, not outcomes granted by this proposal. Never overwrite or reuse public preview.2.

### User Stories

- As a Windows operator, I want supported setup to create protected credentials and approval state, so that I can use automatic broker startup without exposing private authority.
- As a Windows operator, I want unsafe or unverifiable storage refused with a safe next step, so that startup cannot silently trade credential protection for availability.

### Acceptance Outcomes

1. **Clean first use:** Given an empty Windows installation with documented external prerequisites, supported setup creates protected state, a transport principal, a separate protected broker token file and operator-authorized pairing without manual stored-data edits. The initial state has no pairing, requests or decisions. After setup, normal MCP startup supports the first prepared approval request and returns its matching explicit human outcome on the active waiting call without a separate broker terminal. Setup alone creates no approval.
2. **Working protected provisioning and loading:** Given safe Windows storage, the supported provisioning path succeeds and subsequent cold broker startup loads the credential only after required protection is verified. The token remains outside repositories, product state and MCP configuration, and only broker startup loads it. Both default and explicitly selected supported credential locations obey the same requirements.
3. **Unsafe storage refusal:** Given unsafe ownership, permissions, ancestry, redirected paths or unverifiable object identity for the credential or affected state, provisioning or loading refuses before using unsafe private authority. Missing, empty or unreadable credentials also fail with a supported next step. Refusal neither discloses the token nor claims approval, successful Telegram operation or confirmed delivery.
4. **No check/use substitution:** Given a path or object changes between protection assessment and use, the operation does not consume a substituted credential or admit substituted state under the earlier assessment. Uncertain identity fails closed, without a permissive fallback.
5. **Privacy and preservation:** Provisioning and startup do not expose tokens in arguments, adapter environment, MCP configuration, outputs, diagnostics, logs, journals or request history. They do not read `.env` files, overwrite existing credential files, repair unsafe storage automatically, delete uncertain ownership records or alter existing pairing, pending requests or recorded decisions to make admission succeed.
6. **Compatibility retained:** Safe existing Windows state can be used without reinitialization or manual stored-data migration. Existing non-Windows protection, authenticated confidential local admission, transport-principal separation and request authority remain effective. Secure foreground broker reuse still works without a persisted token or supplying that token to the adapter.
7. **Honest limits:** Instructions describe the supported Windows prerequisites and safe setup path, including failures requiring operator action. Owner-only protection is not described as encryption, an OS credential store or isolation from same-account processes. Unit evidence is not represented as Windows boundary, installed-package or live first-use verification.

### Boundary and Exclusions

Necessary affected state/path admission is included because credential protection cannot be valid when state selection, ancestry or object substitution bypasses it. Native permission bridging, unrelated platform redesign, new test frameworks, live harness testing and archive edits are excluded. Technical helper and native API choices belong in design, not this proposal. No privilege expansion or relaxed protection policy is authorized.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: Make the existing credential provisioning/loading, protected-state admission and first-use requirements explicit for Windows, including safe ancestry, object identity and fail-closed verification. Preserve existing credential privacy, foreground compatibility, durable work and non-Windows safeguards. The retained capability name does not make OpenCode a core dependency.

## Impact

- Affected behavior: Windows credential creation and broker loading, necessary protected-state/path admission, setup diagnostics and Windows setup guidance. Existing approval tool contracts and native harness permissions are unchanged.
- Dependencies: the merged [current capability contract](../../specs/opencode-session-continuation/spec.md), particularly credential protection, startup admission and first-use requirements. This corrects the approved behavior established in the [historical startup design](../archive/2026-11-05-add-telegram-approval-opencode-v2/design.md). No unmerged parent change is required.
- Downstream artifacts: a capability delta and design must translate these outcomes into an exact protection contract. The declared primary capability spec author is the product requirements owner, as recorded in the [project index](../../../AGENTS.md). Technical boundary and dependency choices remain with the architecture owner.
- Nearest landing blocker: an exact Windows protection contract and runnable unit proof for successful protected provisioning/loading, unsafe and unverifiable admission, ancestry and object-substitution refusal, and retained safeguards. Existing official platform research is sufficient input and is not a new discovery prerequisite.
- Verification constraint: only unit tests are authorized until deployment to the user's installation and public distribution. Independent review remains required. Windows boundary and live first-use proof remain unverified unless later performed under authorization. Candidate-specific merge and exposure decisions must state that residual risk rather than count unrun checks as passed.
- Distribution: preview.2 is already public in npm and MCP Registry. Its Windows warning attempt is blocked pending owner authentication, not live. The correction targets fresh preview.3 bytes, with publication separately gated. Local disabled integrations and preserved runtime/recovery material are not changed by proposal authoring.
