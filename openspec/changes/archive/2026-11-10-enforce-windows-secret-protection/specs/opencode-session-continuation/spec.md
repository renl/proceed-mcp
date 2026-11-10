# Spec Delta

Parent: [proposal](../../proposal.md). Baseline: repository-relative path `openspec/specs/opencode-session-continuation/spec.md`. Read next: [design](../../design.md).

## Direction Check

Subject: Windows environment-mode users' approval state and operator credentials. Desired outcome: working on-demand startup and trusted TUI setup with required protection.
Threat/problem: skipped owner/ACL checks and assumed safe ancestry. Protected success and fail-closed refusal preserve the existing trusted-local-account boundary against ordinary other-account access.

## ADDED Requirements

### Requirement: Windows environment startup and trusted TUI setup work

With documented prerequisites and safe storage, Windows setup MUST establish protected state, control and owner credentials, the confidential-channel key and the operator key required by the existing trusted TUI enrollment path. Normal MCP startup MUST support the privately supplied environment-token route without a Telegram token file or separate broker terminal. Refusing every Windows operation MUST NOT satisfy this requirement. Existing token-source precedence, confidentiality, non-persistence, helper environment filtering and trusted-human authority requirements MUST remain effective.

#### Scenario: Complete Windows environment setup and first approval

- **GIVEN** a clean Windows installation with documented prerequisites and no configuration, pairing, requests or decisions
- **WHEN** supported setup creates protected state, a transport principal and operator-authorized private pairing without manual stored-data edits
- **AND** the trusted launch environment privately supplies a valid token, with no explicit token-file selection and no token file
- **AND** normal MCP use calls `prepare_approval`, then `request_approval` with its returned private authority, and the paired human approves while the call remains active
- **THEN** the waiting call returns the matching explicit approval without a separate broker terminal
- **AND** the product neither persists the token nor requires `doctor`, delivery retry, a proprietary host API or manual stored-data editing
- **AND** setup and startup alone create no request or approval.

#### Scenario: Protected operator setup supports trusted TUI use

- **GIVEN** safe Windows storage and an operator configuring the existing trusted TUI interaction
- **WHEN** supported enrollment creates the operator key and the configured TUI connects
- **THEN** the key and local channel satisfy existing protection and authenticated confidential admission requirements
- **AND** existing request-bound human decisions work without changing pairing, principal boundaries or decision authority.

### Requirement: Windows state and credential admission verifies required protection

Windows setup and admission MUST verify required ownership, ACLs, safe ancestry and redirected-path protection for affected state, control/owner credentials, channel keys and operator keys. Unsafe or unverifiable protection MUST cause refusal before secret reads, secret writes, private-authority disclosure or readiness through affected storage. Missing, null, empty or unreadable ACL evidence MUST NOT count as verified owner-only protection. Diagnostics MUST be actionable and secret-free and MUST NOT claim protection that was not verified.

#### Scenario: Safe Windows storage is admitted

- **GIVEN** Windows state and required local credentials satisfy the applicable owner-only and ancestry protection requirements
- **WHEN** supported setup or startup verifies that protection
- **THEN** the operation can proceed without skipping Windows checks or weakening authenticated local access
- **AND** local readiness alone does not claim Telegram availability, pairing, human receipt or confirmed delivery.

#### Scenario: Unsafe or unverifiable Windows storage is refused

- **GIVEN** affected Windows storage has an unsafe owner, ACL, ancestry or redirection, or required protection cannot be verified
- **WHEN** setup, startup or trusted TUI access attempts to use it
- **THEN** admission refuses before secret reads, secret writes, private-authority disclosure or readiness through that storage
- **AND** no assumed-safe ancestor, empty permission result or unsupported check authorizes access.

### Requirement: Windows protection correction preserves existing storage

Protection correction MUST NOT automatically repair unsafe storage, overwrite existing credential or key destinations, rewrite or migrate existing journal or pairing, or remove uncertain broker ownership records to succeed. Safe existing Windows state MUST remain usable without reinitialization or manual stored-data migration. Existing durable work, create-only credential/key behavior and POSIX file/environment safeguards MUST remain effective.

#### Scenario: Existing state or credential destination is encountered

- **GIVEN** existing Windows state, keys, credentials or an uncertain ownership record
- **WHEN** setup or admission encounters them
- **THEN** create-only operations refuse existing destinations without overwrite or automatic repair
- **AND** admissible existing state retains pairing, pending work and recorded outcomes under existing expiry and single-resolution rules
- **AND** unsafe or unverifiable storage is refused without rewriting durable work or deleting uncertain ownership records.

## MODIFIED Requirements

### Requirement: Credential provisioning and loading fail closed

File provisioning and automatic file loading MUST refuse unsafe ownership, permissions or paths, including symlinks or redirected paths that could bypass owner-only protection or required storage separation. Missing, empty or unreadable selected credentials, invalid selected environment tokens and unverifiable file protection MUST produce an actionable failure for cold automatic startup, not approval or a claim of working Telegram approval. Failure MUST NOT prompt for a secret, obtain one from agent arguments or silently change sources.

Windows file protection checks MUST NOT be skipped. Windows Telegram token-file provisioning/loading MAY remain unsupported in this change and MUST refuse before secret reads or writes if required protection cannot be verified. Such refusal MUST NOT prevent the supported environment route when no file was explicitly selected, or weaken existing POSIX file behavior.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the selected file credential is missing, empty or unreadable, or its ownership, permissions or path cannot be verified as safe, including unsafe symlink or redirected-path cases
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses the unsafe storage or fails for the missing prerequisite with a supported operator next step and no token disclosure
- **AND** it does not weaken protection, load an unsafe token, claim working Telegram approval or return a human decision.

#### Scenario: No usable cold-start source is available

- **GIVEN** cold startup is needed and the environment token is absent or empty with no usable selected file, or a nonempty selected environment token is invalid
- **WHEN** normal MCP startup attempts to start the broker
- **THEN** startup fails with a supported next step to supply the token privately at launch or repair the selected file source
- **AND** it neither prompts for a secret nor obtains one from agent arguments, discloses token values, falls back after selected-source failure or returns a human decision.

#### Scenario: Windows file protection is unsupported or unverifiable

- **GIVEN** Windows Telegram token-file protection is unsupported or cannot be verified
- **WHEN** provisioning or selected-file loading is attempted
- **THEN** it refuses before secret reads or writes with actionable secret-free guidance
- **AND** an explicitly selected file does not fall back to the environment
- **AND** environment-mode startup without explicit file selection requires no token-file provisioning or loading.
