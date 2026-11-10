# Proposal

## Why

Windows protection checks currently skip ownership and permission verification or assume safe ancestry. Correct those defects so private launch-environment startup and trusted TUI setup can work without weakening the merged security contract. The existing metadata implementation is not yet a working correction.

### Direction Check

Subject: Windows environment-mode users' approval state and operator credentials. Desired outcome: usable on-demand broker startup and trusted TUI setup with required protection.
Threat/problem: skipped ownership/ACL checks and assumed safe ancestry. Successful protected setup and fail-closed admission address ordinary other-account access under the existing trusted-local-account boundary.

## What Changes

- Deliver working Windows environment-token startup with protected state, control and owner credentials, confidential-channel key and operator key. Verify required owner, access-control list (ACL), ancestry and redirected-path protection before secret use or readiness.
- Keep the token private to the trusted launch host and Proceed startup processes that need it. Do not persist it or pass it to helpers that do not need it. Each fresh launch requires private supply again.
- Refuse unsafe or unverifiable protection with actionable secret-free guidance. Preserve existing state, pairing, journal, create-only keys and uncertain ownership records. Do not repair unsafe storage automatically.
- Supersede the prior unlanded promise of complete Windows Telegram token-file provisioning/loading with the user-selected environment route. Windows token-file operations may remain unsupported and must refuse if protection cannot be verified. They must never fall through to unsafe provisioning or loading.
- Preserve merged POSIX file/environment behavior, credential-source precedence, secure foreground reuse, authenticated confidential admission and all approval authority boundaries.
- Deliver one independently landable correction from current merged `main`. The first useful increment is protected Windows environment startup and trusted TUI setup, not a separately shipped foundation or refusal-only release.

### User Stories

- As a Windows operator, I want to launch with a private environment token and protected local credentials, so that normal MCP use starts the broker on demand without storing the Telegram token.
- As a Windows operator, I want supported trusted TUI setup and unsafe-storage refusal, so that local human decisions do not depend on exposed operator authority.

### Acceptance Outcomes

1. **First useful action:** Given a clean Windows installation and documented prerequisites, supported setup creates protected state, a transport principal and operator-authorized private pairing without manual stored-data edits. Initially there are no pairing, requests or decisions. With a privately supplied launch token and no token file, normal MCP startup supports `prepare_approval` and `request_approval`, returning the paired human's matching explicit approval on the active call without a separate broker terminal. Setup alone creates no request or approval.
2. **Trusted TUI:** Supported setup creates a protected operator key through the existing enrollment path. The configured trusted TUI can use it and the protected local channel for existing request-bound human decisions without changing enrollment, authority or decision semantics.
3. **Protection before use:** Safe Windows storage permits setup and startup. Unsafe or unverifiable owners, ACLs, ancestry or redirected paths for affected state and credentials cause refusal before secret reads, writes, private-authority disclosure or readiness. Empty or missing permission evidence is not successful owner-only verification.
4. **Privacy and source rules:** The product does not persist the environment token, read `.env` files, disclose secrets through arguments, configuration, outputs, logs or history, or leak the token to unnecessary helpers. Selected-source failure never silently changes sources. Windows token-file refusal does not block environment mode when no file was explicitly selected.
5. **Preservation:** Safe existing state remains usable without reinitialization or manual migration. Pairing, journal, pending requests and recorded decisions retain existing semantics. Existing credentials and keys are not overwritten, unsafe storage is not repaired automatically, and uncertain locks are not removed to obtain startup.
6. **Compatibility and truthful limits:** POSIX file/environment routes and secure foreground reuse remain supported. Local readiness does not imply Telegram availability, completed pairing, human receipt or confirmed delivery. Instructions disclose trusted-host token possession, fresh-launch supply and the existing same-account/admin limitation without claiming encryption, a credential vault or a new sandbox.

### Boundary and Exclusions

The correction includes the state/control/owner/channel/operator-key admission necessary for the chosen environment route. It does not require a working Windows Telegram token-file mode, retained native handles, pinned ancestry, native storage I/O, exact native object identity or an unconditional check/use substitution guarantee. Those stronger unlanded draft outcomes are superseded, not merged security obligations. Prior planning remains in git history.

No custom executable, runtime compilation, signing/build system, new storage engine, test framework, global policy/trust change or native permission bridge is authorized. Malicious same-account code and administrators remain outside the existing ordinary-other-account threat boundary. No merged security MUST is relaxed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: working Windows environment startup and trusted TUI setup, with verified protected-state/credential admission and fail-closed Windows file handling. The retained capability name does not make OpenCode a core dependency.

## Impact

- Dependencies: the [merged capability contract](../../specs/opencode-session-continuation/spec.md), particularly credential-source, privacy, fail-closed, protected-state and first-use requirements. No unmerged parent is required.
- Next: reconcile [design](design.md) to this bounded outcome and its technical limits, then reconcile test/tasks criteria. Current code still needs owner, empty-ACL, ancestry, reparse and admission-order corrections.
- Verification: only JavaScript/TypeScript unit tests runnable on Linux without PowerShell, Windows APIs, a native helper or compiler are authorized. Independent review remains required. User-skipped PowerShell test execution is SKIPPED, not passed. Native Windows, installed-package and live first-use proof remain UNRUN. Candidate-specific landing/exposure decisions must state residual risks.
- Release: decide the new release version before the PR. Do not reuse published preview.2 bytes or inherit its publication authority. Publication, installation and activation remain separately gated. Local MCP/TUI remain disabled and the token absent. Proposal authoring changes no runtime or recovery material.
