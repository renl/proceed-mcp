# Delta for opencode-session-continuation

Parent: [proposal](../../proposal.md). This delta changes Telegram token-file storage only.

## MODIFIED Requirements

### Requirement: Automatic startup preserves credential and readiness boundaries

Cold automatic startup MUST support either a privately supplied environment token or a separately provisioned ordinary plaintext token file on Windows and POSIX. For cold automatic startup, an explicitly selected token file MUST take precedence. Otherwise a nonempty token in the configured Telegram token environment variable, `PROCEED_TELEGRAM_BOT_TOKEN` by default, MUST take precedence over the default credential file. An absent or exactly empty environment value MUST leave the default-file route available. The selected source MUST be validated without silently switching to another source on failure. File provisioning MUST be an explicit operator action through installed Proceed, with private interactive input or the existing explicitly selected nonterminal stdin route. The file MUST remain outside repositories, product state, package installation/prefix directories and harness configuration. It MUST NOT require owner-only protection. Only broker startup MUST load persisted token contents. Environment mode MAY supply the token to the trusted host and MCP startup process solely for broker startup, without requiring token persistence. Reusing a matching healthy secure broker MUST NOT require a token source or credential-file read.

#### Scenario: Explicitly provision the automatic-startup token

- **GIVEN** a clean installation and an operator choosing file-mode automatic startup
- **WHEN** the operator supplies the token through the supported one-time provisioning path
- **THEN** it is saved only in the separate plaintext credential file outside repositories, product state, package installation/prefix directories and harness configuration
- **AND** provisioning does not echo the token or expose it through CLI arguments, outputs or logs
- **AND** subsequent file-mode cold startup loads the token only in broker startup, not in the MCP adapter
- **AND** setup instructions disclose that any OS principal able to read the file can obtain the token, without promising account-only access, encryption or an OS credential store.

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
- **AND** an unavailable, invalid or storage-separation-violating selected source fails without trying a lower-priority source.

#### Scenario: Fresh harness launch uses the configured credential

- **GIVEN** completed supported setup and an unchanged usable plaintext credential on Windows or POSIX, with the broker safely stopped
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

### Requirement: Credential provisioning and loading fail closed

Telegram token-file provisioning and loading MUST use ordinary OS file access without token-specific ACL, owner, inheritance, exact-mode or local-fixed-NTFS protection admission. These operations MUST NOT query or repair token-file or dedicated credential-parent permissions as a prerequisite, require a special protected parent, or refuse solely because other OS principals have access. They MUST NOT perform token-specific chmod repair. Ordinary OS permissions, I/O errors and native permission prompts still apply. This exception MUST NOT weaken protection for approval state, journals, control/owner credentials, confidential-channel keys, operator keys or private request authority.

Provisioning MUST verify command prerequisites, destination separation, destination absence and usable private input before consuming token input. Separation MUST cover the eventual destination even when parent directories do not yet exist and MUST NOT be bypassed by path resolution or redirection. Existing destinations MUST NOT be opened for content comparison, adopted as successful provisioning or overwritten. Creation MUST be exclusive. Ordinary file type, identity and write-completion checks MUST prevent reporting success for a different destination or an incomplete write. They MUST NOT become owner-only protection gates or a promise of resistance to hostile local mutation. Loading MUST establish required storage separation and load a valid selected file for broker startup without permission-protection snapshots. Observed file replacement or incomplete access MUST produce failure rather than successful loading. No native handle-pinning or adversarial race-protection framework is required.

Missing, empty, invalid or unreadable selected credentials and invalid selected environment tokens MUST produce actionable secret-free cold-start failure, not approval or a claim of working Telegram approval. Startup failure MUST NOT prompt for a secret, obtain one from agent arguments or silently change sources. Failure MUST preserve preexisting and uncertain objects, existing pairing, keys, durable work and uncertain broker ownership. Cleanup MUST be limited to objects still proven to belong to the attempt.

#### Scenario: Automatic-startup credential is missing or unsafe

- **GIVEN** the selected file credential is missing, empty, invalid, unreadable or violates required storage separation
- **WHEN** provisioning or automatic credential loading is attempted
- **THEN** the operation refuses or fails for that prerequisite with a supported operator next step and no token disclosure
- **AND** it does not bypass ordinary OS access denial, load a separation-violating token, claim working Telegram approval or return a human decision.

#### Scenario: No usable cold-start source is available

- **GIVEN** cold startup is needed and the environment token is absent or empty with no usable selected file, or a nonempty selected environment token is invalid
- **WHEN** normal MCP startup attempts to start the broker
- **THEN** startup fails with a supported next step to supply the token privately at launch or correct the selected file prerequisite through supported operator action
- **AND** it neither prompts for a secret nor obtains one from agent arguments, discloses token values, falls back after selected-source failure or returns a human decision.

#### Scenario: Supported Windows credentials can be provisioned and loaded

- **GIVEN** the documented Windows runtime, an absent separated token destination and ordinary OS access sufficient to create and later read the file
- **WHEN** the operator provisions a new credential and a later cold broker startup selects it
- **THEN** both operations can succeed without token-specific ownership, ACL, inheritance or NTFS admission
- **AND** refusing every Windows persisted-credential operation does not satisfy this requirement.

#### Scenario: Windows file protection is unsupported or unverifiable

- **GIVEN** ordinary file access and storage separation are usable but Windows token protection queries are unavailable or the storage is outside the former local-fixed-NTFS envelope
- **WHEN** provisioning or selected-file loading is attempted
- **THEN** protection-query availability and that former envelope do not block the operation
- **AND** actual selected-file failure does not fall back to the environment
- **AND** environment-mode startup without explicit file selection requires no token-file provisioning or loading.

#### Scenario: Windows parent inheritance is unsafe

- **GIVEN** an otherwise usable separated default or explicit token destination whose parent permits access by additional OS principals, including ordinary inherited Windows permissions or POSIX modes other than 0700/0600
- **WHEN** provisioning validates the destination or cold startup loads the selected file
- **THEN** those permissions and differing ownership do not cause refusal or permission repair
- **AND** no account-only inheritance preparation or exact-mode prerequisite is imposed.

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

- **GIVEN** initial ordinary path and I/O checks succeeded
- **WHEN** the operation observes destination replacement, loss of required separation or incomplete file access
- **THEN** it reports failure rather than success and does not release a loaded token to broker startup
- **AND** cleanup preserves objects whose ownership by the attempt cannot still be proven
- **AND** a permission change alone is not grounds for refusal when ordinary file access still succeeds and required separation is retained.

### Requirement: Credential limitations and foreground compatibility remain explicit

The product MUST document that the separate Telegram token file is ordinary plaintext. Any OS principal able to read the file can obtain and misuse the token. Proceed MUST NOT promise owner-only access, encryption, an OS credential store, historical confidentiality or resistance to local file mutation. It MUST disclose trusted runtime/package assumptions and exposure through administrators, other processes with OS access and backups. These token-file limitations MUST be distinguished from the unchanged protection of approval state, journals, control/owner credentials, channel/operator keys, pairing and request/decision authority.

Environment-mode instructions MUST disclose that the trusted host and MCP startup process may hold the token and that each fresh launch requires the trusted launch environment to supply it again. They MUST NOT require global or user-wide token persistence or promise one-time persistent, login or reboot setup for environment mode. Persisted-mode instructions MUST explain one-time private Proceed provisioning of the plaintext file, storage separation, consistent explicit-path selection and removal of higher-priority tokens from the actual launch environment to use the default file. Persisted credentials MUST remain available when the operator next starts the harness after login or reboot, without installing an automatic service. Existing foreground broker use with a token supplied only through its own process environment MUST remain supported without persistent token provisioning. Legacy HTTP foreground serving MUST remain available to legacy clients. Secure foreground serving MUST permit upgraded-client reuse without a token file. Changing a launch token or file selection MUST NOT be described as rotating an already running broker's token. Rotation requires supported broker stop and replacement without ownership takeover.

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

- **GIVEN** supported persisted setup with an unchanged usable plaintext credential and protected state paths
- **WHEN** the operator next launches a supported harness after login or reboot without a Telegram token in its actual environment or configuration
- **THEN** normal MCP startup can use the persisted credential without token re-entry or a separate broker terminal
- **AND** no automatic login/reboot service, harness integration or native permission bridge is required or installed.

#### Scenario: Disclose verification and storage limits honestly

- **GIVEN** documentation or evidence for the persisted route
- **WHEN** Windows or POSIX storage and setup success are described
- **THEN** plaintext exposure and the absence of token-specific permission protection are explicit, with protected state/key requirements separately retained
- **AND** source review and controlled unit results are not presented as proof of terminal privacy, fresh-launch behavior, installed first use or Telegram delivery
- **AND** unrun outcomes and compatibility checks remain unverified rather than inheriting preview.3 acceptance.

### Requirement: First-use and restart preserve the approval workflow

An empty installation MUST remain unpaired with no requests or decisions until supported setup and approval actions create them. The documented installed-product setup path MUST create required protected state, a transport principal, either private launch-environment token supply or broker-only plaintext-file credential provisioning, and operator-authorized private pairing without manual stored-data editing. Windows and POSIX persisted setup MUST include explicit private Proceed provisioning without token-specific permission preparation and subsequent normal MCP startup without harness token supply. After setup, normal MCP use with the selected source available MUST support the first useful approval interaction with no separate manual broker launch. Setup instructions MUST distinguish environment supply on each fresh launch from one-time file provisioning. Existing safe state, keys and pairing MUST remain usable without reinitialization. Credential setup MUST NOT enable disabled integrations, create human decision authority or alter native harness permissions.

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

- **GIVEN** an empty Windows or POSIX installation meeting protected-state and external prerequisites, with ordinary OS access to a separated token destination
- **WHEN** the operator uses supported setup for protected state, a transport principal, private Proceed plaintext credential provisioning and authorized private-chat pairing
- **AND** safely stops the broker and starts a fresh supported harness without a Telegram token in its environment or configuration
- **AND** normal MCP use prepares private authority and requests approval, and the paired human selects Approve while the call remains active
- **THEN** the same waiting call returns the matching explicit approval without token re-entry, token-specific permission preparation or a separate broker terminal
- **AND** local provisioning or readiness alone is not reported as human receipt or confirmed outcome delivery.

#### Scenario: Existing setup retains its authority boundary

- **GIVEN** safe existing state with keys, pairing, pending requests and recorded decisions
- **WHEN** the operator configures a new separate credential destination or later uses the persisted route
- **THEN** existing state remains usable without reinitialization or migration, and durable work keeps its existing expiry and single-resolution semantics
- **AND** credential setup does not enable a disabled integration, enroll a human decision-maker, bypass native permissions or take over uncertain broker ownership.
