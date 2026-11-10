# Spec Delta

Parent: [approved proposal](../../proposal.md). Baseline: [current capability](../../../../specs/opencode-session-continuation/spec.md).

## Direction Check

Subject: Windows users' credentials and approval state. Desired outcome: working protected provisioning and loading.
Threat/problem: skipped protection checks and unsafe path assumptions. Successful setup and fail-closed refusal address that threat without weakening protection.

## ADDED Requirements

### Requirement: Windows protected setup and credential loading work

On Windows with documented prerequisites and safe storage, supported setup MUST establish protected state and provision the separate owner-only Telegram credential. Subsequent cold broker startup MUST load that credential after verifying protection. Both default and explicitly selected supported credential locations MUST work. Refusing every Windows operation MUST NOT satisfy this requirement.

#### Scenario: Complete Windows setup and first approval from empty state

- **GIVEN** a clean Windows installation with documented external prerequisites and safe storage
- **AND** no pairing, requests or decisions exist
- **WHEN** the operator uses supported setup to create protected state, a transport principal, the separate broker-only token file and operator-authorized private pairing
- **AND** normal MCP startup is followed by `prepare_approval` and `request_approval` using the returned private authority
- **AND** the paired human explicitly approves while the waiting call remains active
- **THEN** the matching explicit approval returns on that original call without a separate broker terminal or manual stored-data editing
- **AND** setup and startup alone create no approval.

#### Scenario: Load a safely provisioned Windows credential

- **GIVEN** supported provisioning succeeded at either the default or an explicitly selected supported Windows credential location
- **AND** configured state is safely stopped and its protection remains valid
- **WHEN** normal MCP startup requires cold broker startup
- **THEN** verified owner-only protection permits broker startup to load the credential and become ready
- **AND** the adapter neither loads nor receives the Telegram token
- **AND** local readiness alone does not claim Telegram availability, pairing, human receipt or confirmed outcome delivery.

### Requirement: Windows path admission binds protection to the object used

Windows credential operations and necessary affected state admission MUST verify safe path ancestry and object identity. Protection verified for one object MUST NOT authorize a substituted object. Redirected paths, including reparse points, MUST NOT bypass owner-only protection or storage separation. If safety or identity cannot be established through use, the operation MUST refuse before reading or writing secrets or disclosing private authority.

#### Scenario: Unsafe ancestry or redirection prevents admission

- **GIVEN** a Windows credential or affected state has unsafe ancestry or a redirected path that could bypass required protection or separation
- **WHEN** provisioning, loading or affected state admission is attempted
- **THEN** the operation refuses before reading or writing secrets or disclosing private authority through that unsafe storage
- **AND** it reports an actionable secret-free next step without claiming owner-only success.

#### Scenario: A checked object is replaced before use

- **GIVEN** a Windows credential or affected state passed a protection assessment
- **WHEN** an ancestor, path or object is replaced before use
- **THEN** the earlier assessment does not authorize reading a substituted credential, writing secrets to substituted storage or admitting substituted state
- **AND** uncertain identity produces an actionable secret-free refusal without a permissive fallback.

### Requirement: Windows protection admission preserves existing storage

Windows provisioning MUST be create-only for credential files. Protection admission MUST NOT automatically repair unsafe storage, rewrite or migrate existing credentials, journal or pairing, or remove uncertain broker ownership records to succeed. Safe existing Windows state MUST remain usable without reinitialization or manual stored-data migration.

#### Scenario: An existing credential destination is selected

- **GIVEN** a Windows credential destination already exists, whether safely protected or not
- **WHEN** provisioning targets it
- **THEN** provisioning refuses without overwriting or repairing the existing file
- **AND** guidance offers a supported safe next step without disclosing its contents.

#### Scenario: Existing Windows state satisfies protection

- **GIVEN** safely stopped Windows state with valid protection, pairing, pending requests and recorded decisions
- **WHEN** the upgraded product admits that state and starts the broker
- **THEN** existing state is usable without reinitialization or migration
- **AND** pairing, request identities, pending work and unchanged recorded outcomes retain their existing authority, expiry and single-resolution semantics.

#### Scenario: Existing Windows storage cannot be admitted safely

- **GIVEN** existing Windows credentials or affected state cannot satisfy protection admission
- **WHEN** provisioning or startup attempts to use that storage
- **THEN** it refuses with an actionable secret-free next step
- **AND** it does not rewrite credentials, journal or pairing, repair permissions automatically or delete uncertain ownership records to make admission succeed.

## MODIFIED Requirements

### Requirement: Credential provisioning and loading fail closed

Provisioning and automatic credential loading MUST refuse unsafe ownership, permissions or paths,
including symlinks or redirected paths that could bypass owner-only protection or the required storage
separation. Missing, empty or unreadable credentials and unverifiable protection MUST produce an
actionable failure for automatic startup, not approval or a claim of working Telegram approval.

Windows ownership and permission checks MUST NOT be skipped or treated as successful when unavailable or unverifiable. Unsafe or unverifiable protection MUST cause refusal before secret reads, secret writes or private-authority disclosure through the affected storage. Diagnostics MUST NOT claim owner-only protection unless it was verified.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the automatic-startup credential is missing, empty or unreadable, or its ownership,
  permissions or path cannot be verified as safe, including unsafe symlink or redirected-path cases
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses the unsafe storage or fails for the missing prerequisite with a
  supported operator next step and no token disclosure
- **AND** it does not weaken protection, load an unsafe token, claim working Telegram approval or
  return a human decision.

#### Scenario: Windows ownership or permission verification fails

- **GIVEN** Windows ownership or permissions are unsafe, or their required verification is unavailable or inconclusive
- **WHEN** credential provisioning or loading is attempted
- **THEN** it refuses before reading or writing secrets or disclosing private authority through the affected storage
- **AND** its actionable secret-free diagnostic does not claim successful protection, Telegram operation, human approval or confirmed delivery.
