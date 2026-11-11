# Delta for opencode-session-continuation

Proceed owns private credential setup and subsequent broker loading independently of the harness. Parent: [proposal](../../proposal.md). Technical contracts: [design](../../design.md).

## Direction Check

Subject: Proceed credentials and installation. Outcome: one-time setup followed by token-free harness launches.
Problem: harness-dependent token supply. These changes provide protected Windows and POSIX persistence without changing pairing or decision authority.

## MODIFIED Requirements

### Requirement: Automatic startup preserves credential and readiness boundaries

Cold automatic startup MUST support either a privately supplied environment token or a separately provisioned protected token file on supported Windows and POSIX storage. For cold automatic startup, an explicitly selected token file MUST take precedence. Otherwise a nonempty token in the configured Telegram token environment variable, `PROCEED_TELEGRAM_BOT_TOKEN` by default, MUST take precedence over the default credential file. An absent or exactly empty environment value MUST leave the default-file route available. The selected source MUST be validated without silently switching to another source on failure. File provisioning MUST be an explicit operator action through installed Proceed, with private interactive input or the existing explicitly selected nonterminal stdin route. It MUST remain owner-only, outside repositories, product state, package installation/prefix directories and harness configuration. Only broker startup MUST load persisted token contents. Environment mode MAY supply the token to the trusted host and MCP startup process solely for broker startup, without requiring token persistence. Reusing a matching healthy secure broker MUST NOT require a token source or credential-file read.

#### Scenario: Explicitly provision the automatic-startup token

- **GIVEN** a clean installation and an operator choosing protected-file automatic startup
- **WHEN** the operator supplies the token through the supported one-time provisioning path
- **THEN** it is saved only in the separate owner-only credential file outside repositories, product state, package installation/prefix directories and harness configuration
- **AND** provisioning does not echo the token or expose it through CLI arguments, outputs or logs
- **AND** subsequent file-mode cold startup loads the token only in broker startup, not in the MCP adapter
- **AND** setup instructions disclose the same-account access limitation without promising encryption or an OS credential store.

#### Scenario: Private interactive input belongs to Proceed

- **GIVEN** initialized protected state, an absent admissible credential destination and a trusted unrecorded interactive terminal
- **WHEN** the operator explicitly invokes installed Proceed's interactive provisioning path
- **THEN** Proceed establishes private input before consuming secret characters and accepts submission without displaying the token, masking characters or token length
- **AND** it restores the original terminal mode and releases its input listeners on success or any failure
- **AND** successful setup reports only the credential path and storage/trust guidance, not Telegram validity, pairing or approval
- **AND** package installation, ordinary MCP startup, pairing and foreground startup never automatically prompt for a token.

#### Scenario: Preserve explicit nonterminal input

- **GIVEN** an operator explicitly chooses the existing nonterminal stdin provisioning route
- **WHEN** provisioning runs
- **THEN** its terminal refusal, bounded validated input and EOF requirement remain effective
- **AND** Proceed does not silently switch between interactive and stdin modes.

#### Scenario: Cold startup uses a private environment token without a token file

- **GIVEN** otherwise complete supported setup, safely stopped state, no token file and a valid token privately supplied by the trusted launch environment
- **WHEN** normal MCP startup needs to start the broker
- **THEN** the broker uses that token without requiring file provisioning or a manual broker terminal
- **AND** the product does not persist the environment token.

#### Scenario: Select one cold-start source deterministically

- **GIVEN** more than one token source is available for cold automatic startup
- **WHEN** startup selects its source
- **THEN** an explicit token-file selection wins over the environment and default file, otherwise a nonempty environment token wins over the default file
- **AND** an unavailable, unsafe or invalid selected source fails without trying a lower-priority source.

#### Scenario: Fresh harness launch uses the configured credential

- **GIVEN** completed supported setup and unchanged protected credentials on Windows or POSIX, with the broker safely stopped
- **AND** a fresh supported harness process has no Telegram token in its actual launch environment or configuration
- **WHEN** normal MCP startup selects the default credential or the same explicit credential path used during setup
- **THEN** broker startup loads that credential without token re-entry, harness-specific secret handling or a separate broker terminal
- **AND** the adapter, TUI, readiness probes and metadata helpers do not load persisted token contents
- **AND** the same configured state and credential selection remain usable through normal MCP startup by another supported harness without provisioning its token again.

#### Scenario: Healthy reuse needs no credential access

- **GIVEN** a matching healthy secure broker already serves the configured state
- **WHEN** another configured adapter starts without a token source
- **THEN** it reuses the broker without a credential-file read, another broker or another Telegram poller
- **AND** it preserves authenticated confidential admission, existing work and human authority.

### Requirement: Provisioning and startup prevent token disclosure

Provisioning and startup MUST NOT echo the token or expose it through CLI arguments, MCP client configuration including JSON environment entries, tool or environment outputs, diagnostics, logs, package contents or published evidence. The token MUST NOT enter repositories, product state, state journals or request history. The product MUST NOT read `.env` files for this provisioning or startup path. Private environment inheritance by the trusted host and MCP startup process is permitted only for the supported environment route. Product-launched helpers that do not need the Telegram token MUST NOT inherit it. File mode MUST NOT supply file contents to the adapter environment. Provisioning MUST NOT automatically capture an environment token or expose an agent-facing MCP provisioning tool. Invalid arguments and private-input failures MUST use value-free diagnostics without reproducing supplied values, token fragments or raw input. These obligations govern product handling, not unrelated parent processes.

#### Scenario: Startup does not disclose private authority

- **GIVEN** either supported credential source and subsequent automatic startup
- **WHEN** MCP client configuration, tool results, environment outputs and startup diagnostics are inspected
- **THEN** none discloses Telegram, local control or owner credential values
- **AND** request capabilities remain confined to their existing authorized tool-result boundary and are not added to startup diagnostics or environment outputs
- **AND** the MCP adapter is not supplied file-sourced Telegram token contents through its environment
- **AND** neither the state journal nor request history gains the Telegram token, and persistent request capabilities remain stored only as verifiers rather than plaintext.

#### Scenario: Helpers do not inherit unnecessary token authority

- **GIVEN** the trusted launch environment supplied the Telegram token for automatic startup
- **WHEN** the product launches a helper that does not require that token
- **THEN** that helper's environment excludes it without changing unrelated parent-process environments.

#### Scenario: Reject secret-bearing arguments without reproducing them

- **GIVEN** unsupported provisioning arguments, positional token data or invalid private input
- **WHEN** Proceed rejects the invocation or input
- **THEN** diagnostics do not repeat supplied values, token fragments, raw terminal events or secret-bearing parser errors
- **AND** an environment token or `.env` file does not become a substitute provisioning input.

### Requirement: Credential provisioning and loading fail closed

File provisioning and automatic file loading MUST refuse unsafe ownership, permissions or paths, including symlinks or redirected paths that could bypass owner-only protection or required storage separation. Provisioning MUST verify command prerequisites, destination separation, safe ancestry, destination absence and usable private input before consuming token input. Separation MUST cover the eventual destination even when parent directories do not yet exist. Existing destinations MUST NOT be opened for content comparison, adopted as successful provisioning or overwritten. Creation MUST be exclusive, with protection verified before secret writes and revalidated before reporting success. Loading MUST verify protection before content access and revalidate protection, identity and ancestry before releasing the token to broker startup. Changed or uncertain observations MUST cause refusal. Missing, empty or unreadable selected credentials, invalid selected environment tokens and unverifiable file protection MUST produce an actionable failure for cold automatic startup, not approval or a claim of working Telegram approval. Startup failure MUST NOT prompt for a secret, obtain one from agent arguments or silently change sources.

Windows provisioning and loading MUST support the design's local fixed NTFS safe-storage envelope with verifiable current-account ownership, account-only credential access and account-only full-access inheritance to child files and directories in dedicated credential parents. Ordinary Windows home defaults MUST NOT be assumed to meet this prerequisite. Unsafe or unverifiable Windows protection, unsupported path/storage forms or unavailable protection queries MUST refuse before token input, secret reads or writes as applicable. Supported POSIX ownership, exact 0700 credential-directory and 0600 file modes, ancestry and nonredirection checks MUST remain effective. On either platform, Proceed MUST NOT automatically repair storage or weaken protection. Failure MUST preserve preexisting and uncertain objects, existing pairing, keys, durable work and uncertain broker ownership. Cleanup MUST be limited to objects still proven to belong to the attempt.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the selected file credential is missing, empty or unreadable, or its ownership, permissions or path cannot be verified as safe, including unsafe symlink or redirected-path cases
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses the unsafe storage or fails for the missing prerequisite with a supported operator next step and no token disclosure
- **AND** it does not weaken protection, load an unsafe token, claim working Telegram approval or return a human decision.

#### Scenario: No usable cold-start source is available

- **GIVEN** cold startup is needed and the environment token is absent or empty with no usable selected file, or a nonempty selected environment token is invalid
- **WHEN** normal MCP startup attempts to start the broker
- **THEN** startup fails with a supported next step to supply the token privately at launch or correct the selected file prerequisite through supported operator action
- **AND** it neither prompts for a secret nor obtains one from agent arguments, discloses token values, falls back after selected-source failure or returns a human decision.

#### Scenario: Supported Windows credentials can be provisioned and loaded

- **GIVEN** the documented Windows runtime and local fixed NTFS prerequisites, verifiable safe ancestry and a dedicated current-account-only parent with account-only full-access inheritance for files and directories
- **WHEN** the operator provisions a new credential and a later cold broker startup selects it
- **THEN** both operations can succeed with Windows protection checks enforced before secret access and revalidated afterward
- **AND** refusing every Windows persisted-credential operation does not satisfy this requirement.

#### Scenario: Windows file protection is unsupported or unverifiable

- **GIVEN** Windows Telegram token-file protection cannot be verified, the protection query is unavailable or the selected storage is outside the supported envelope
- **WHEN** provisioning or selected-file loading is attempted
- **THEN** it refuses before token input, secret reads or writes as applicable with actionable secret-free guidance
- **AND** an explicitly selected file does not fall back to the environment
- **AND** environment-mode startup without explicit file selection requires no token-file provisioning or loading.

#### Scenario: Windows parent inheritance is unsafe

- **GIVEN** a default home location or explicit credential parent lacks the required account-only safe inheritance
- **WHEN** provisioning validates the destination
- **THEN** it refuses before token input or secret writes without repairing permissions
- **AND** guidance describes the safe-parent prerequisite and supported explicit credential-path alternative without promising ordinary home defaults are safe.

#### Scenario: Existing destination or create race prevents replacement

- **GIVEN** a credential destination already exists or appears before exclusive creation
- **WHEN** the operator attempts provisioning
- **THEN** Proceed refuses without opening its contents for comparison, overwriting it, rotating credentials or claiming successful provisioning
- **AND** a destination found during initial validation is refused before token input
- **AND** preexisting or uncertain artifacts are preserved.

#### Scenario: Private input is cancelled or unavailable

- **GIVEN** the operator invokes interactive provisioning
- **WHEN** private terminal input cannot be established, or input is cancelled, invalid, times out or reaches EOF before submission
- **THEN** no credential is written and no echoed-input fallback is used
- **AND** private-input unavailability refuses before consuming secret characters
- **AND** any acquired terminal mode and input listeners are restored or released with secret-free guidance.

#### Scenario: Protection changes during credential access

- **GIVEN** initial storage admission succeeded
- **WHEN** file identity, ancestry or protection changes or becomes uncertain during provisioning or loading
- **THEN** the operation reports failure rather than success and does not release a loaded token to broker startup
- **AND** cleanup preserves objects whose ownership by the attempt cannot still be proven.

### Requirement: Credential limitations and foreground compatibility remain explicit

The product MUST document that owner-only file protection does not isolate the token from same-account processes and MUST NOT imply encryption or an OS credential-store guarantee. It MUST disclose trusted-account, runtime, package and OS assumptions and the lack of protection against administrators, hostile same-account mutation, earlier-opened handles or compromised backups. Repeated protection snapshots and identity checks MUST NOT be presented as native handle-pinning or historical confidentiality. Environment-mode instructions MUST disclose that the trusted host and MCP startup process may hold the token and that each fresh launch requires the trusted launch environment to supply it again. They MUST NOT require global or user-wide token persistence or promise one-time persistent, login or reboot setup for environment mode. Persisted-mode instructions MUST explain one-time Proceed provisioning, storage prerequisites, consistent explicit-path selection and removal of higher-priority tokens from the actual launch environment to use the default file. Persisted credentials MUST remain available when the operator next starts the harness after login or reboot, without installing an automatic service. Existing foreground broker use with a token supplied only through its own process environment MUST remain supported without persistent token provisioning. Legacy HTTP foreground serving MUST remain available to legacy clients. Secure foreground serving MUST permit upgraded-client reuse without a token file. Changing a launch token or file selection MUST NOT be described as rotating an already running broker's token. Rotation requires supported broker stop and replacement without ownership takeover.

#### Scenario: Foreground environment mode remains available

- **GIVEN** an operator supplies the token only to the foreground broker's process environment without provisioning a persistent token file
- **WHEN** the operator starts the broker through the supported secure foreground path
- **THEN** that mode remains supported without requiring token persistence
- **AND** a configured adapter can reuse the matching healthy broker without receiving or loading the token.

#### Scenario: Restart and rotation require fresh supply and broker replacement

- **GIVEN** an operator uses environment mode or changes the token in a new launch environment
- **WHEN** restart or rotation guidance is followed
- **THEN** instructions require private supply again for a fresh environment-mode launch and supported stop and replacement of an existing broker to use a changed token
- **AND** merely changing an adapter environment does not mutate the running broker, start a second poller or grant permission to take over uncertain ownership.

#### Scenario: Persisted setup survives a later login or reboot

- **GIVEN** supported persisted setup with unchanged protected credential and state paths
- **WHEN** the operator next launches a supported harness after login or reboot without a Telegram token in its actual environment or configuration
- **THEN** normal MCP startup can use the persisted credential without token re-entry or a separate broker terminal
- **AND** no automatic login/reboot service, harness integration or native permission bridge is required or installed.

#### Scenario: Disclose verification and storage limits honestly

- **GIVEN** documentation or evidence for the persisted route
- **WHEN** supported Windows storage and setup success are described
- **THEN** the safe inheritable-parent prerequisite and same-account trust boundary are explicit
- **AND** source review and controlled unit results are not presented as proof of native ACL enforcement, terminal privacy, fresh-launch behavior, installed first use or Telegram delivery
- **AND** unrun outcomes and compatibility checks remain unverified rather than inheriting preview.3 acceptance.

### Requirement: First-use and restart preserve the approval workflow

An empty installation MUST remain unpaired with no requests or decisions until supported setup and approval actions create them. The documented installed-product setup path MUST create required protected state, a transport principal, either private launch-environment token supply or broker-only file credential provisioning, and operator-authorized private pairing without manual stored-data editing. Supported Windows and POSIX persisted setup MUST include explicit private Proceed provisioning and subsequent normal MCP startup without harness token supply. After setup, normal MCP use with the selected source available MUST support the first useful approval interaction with no separate manual broker launch. Setup instructions MUST distinguish environment supply on each fresh launch from one-time file provisioning. Existing safe state, keys and pairing MUST remain usable without reinitialization. Credential setup MUST NOT enable disabled integrations, create human decision authority or alter native harness permissions.

#### Scenario: Complete setup and first useful action from empty state

- **GIVEN** a clean installation with no product configuration, pairing, requests or decisions and operator access to the required external prerequisites
- **WHEN** the operator follows supported setup using either credential source, connects the normal MCP adapter, calls `prepare_approval`, calls `request_approval` with the returned private authority and the paired human selects Approve while the call remains active
- **THEN** the waiting call returns the matching explicit approval through the existing tool contract without a separate manual broker launch
- **AND** environment-mode setup and first use require no token file
- **AND** no proprietary host API, direct stored-data editing, `doctor` or delivery retry is required
- **AND** setup and startup alone never create a request or grant approval.

#### Scenario: Setup or pairing is incomplete

- **GIVEN** missing initialized state, owner setup, a required selected credential source or operator-authorized private pairing
- **WHEN** the operator connects the MCP adapter or attempts an operation that needs that prerequisite
- **THEN** the product identifies the incomplete prerequisite and supported next step without claiming completed setup or a successful approval interaction
- **AND** it does not invent pairing, create substitute authority or return a fake human decision.

#### Scenario: First persisted approval follows a fresh token-free launch

- **GIVEN** an empty Windows or POSIX installation meeting documented safe-storage and external prerequisites
- **WHEN** the operator uses supported setup for protected state, a transport principal, private Proceed credential provisioning and authorized private-chat pairing
- **AND** safely stops the broker and starts a fresh supported harness without a Telegram token in its environment or configuration
- **AND** normal MCP use prepares private authority and requests approval, and the paired human selects Approve while the call remains active
- **THEN** the same waiting call returns the matching explicit approval without token re-entry or a separate broker terminal
- **AND** local provisioning or readiness alone is not reported as human receipt or confirmed outcome delivery.

#### Scenario: Existing setup retains its authority boundary

- **GIVEN** safe existing state with keys, pairing, pending requests and recorded decisions
- **WHEN** the operator configures a new separate credential destination or later uses the persisted route
- **THEN** existing state remains usable without reinitialization or migration, and durable work keeps its existing expiry and single-resolution semantics
- **AND** credential setup does not enable a disabled integration, enroll a human decision-maker, bypass native permissions or take over uncertain broker ownership.
