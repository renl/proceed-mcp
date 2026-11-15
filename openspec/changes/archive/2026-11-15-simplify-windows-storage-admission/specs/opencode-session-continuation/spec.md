# Delta for opencode-session-continuation

## MODIFIED Requirements

### Requirement: Credential provisioning and loading fail closed

Telegram token-file provisioning and loading MUST use ordinary OS file access without token-specific ACL, owner, inheritance, exact-mode or local-fixed-NTFS protection admission. These operations MUST NOT query or repair token-file or dedicated credential-parent permissions as a prerequisite, require a special protected parent, or refuse solely because other OS principals have access. They MUST NOT perform token-specific chmod repair. Ordinary OS permissions, I/O errors and native permission prompts still apply. This token-file policy MUST NOT weaken POSIX protection for approval state, journals, control/owner credentials, confidential-channel keys, operator keys or private request authority. Windows state and local keys instead follow the ordinary-access policy under `Windows state and credential admission verifies required protection`. Authentication and request-authority checks remain required on both platforms.

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

The product MUST document that the separate Telegram token file is ordinary plaintext. Any OS principal able to read the file can obtain and misuse the token. Proceed MUST NOT promise owner-only access, encryption, an OS credential store, historical confidentiality or resistance to local file mutation. It MUST disclose trusted runtime/package assumptions and exposure through administrators, other processes with OS access and backups. These token-file limitations MUST be distinguished from unchanged POSIX state/key protection and from operator-managed Windows state, journals, ownership records and local keys. Windows readers can obtain and misuse local key authority, and Windows writers can tamper with approval records. Proceed MUST NOT promise protection against that local access. Pairing, authenticated confidential channels and request/decision authority checks remain required, but MUST NOT be described as preventing misuse of stolen keys or tampered local records.

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

- **GIVEN** supported persisted setup with an unchanged usable plaintext credential and state paths satisfying the platform's storage policy
- **WHEN** the operator next launches a supported harness after login or reboot without a Telegram token in its actual environment or configuration
- **THEN** normal MCP startup can use the persisted credential without token re-entry or a separate broker terminal
- **AND** no automatic login/reboot service, harness integration or native permission bridge is required or installed.

#### Scenario: Disclose verification and storage limits honestly

- **GIVEN** documentation or evidence for the persisted route
- **WHEN** Windows or POSIX storage and setup success are described
- **THEN** plaintext token exposure and the absence of token-specific permission protection are explicit
- **AND** Windows state, journal and local-key security is explicitly the operator's responsibility, including key theft and record tampering by principals with OS access, while POSIX state/key protections remain required
- **AND** source review and controlled unit results are not presented as proof of terminal privacy, fresh-launch behavior, installed first use or Telegram delivery
- **AND** unrun outcomes and compatibility checks remain unverified rather than inheriting preview.3 acceptance.

### Requirement: Startup preserves local authority and truthful readiness

Automatic startup MUST preserve POSIX owner-only state protection, authenticated local access, transport-principal separation and private request authority. Windows storage MUST follow the ordinary-access policy under `Windows state and credential admission verifies required protection`, without owner-only permission admission. The product MUST distinguish local broker readiness from Telegram availability, completed pairing, human receipt and confirmed outcome delivery.

#### Scenario: Local listener works but Telegram cannot operate

- **GIVEN** a reachable local broker with missing or rejected Telegram credentials, unavailable Telegram transport or a competing Telegram consumer
- **WHEN** startup or approval operation status is reported
- **THEN** the product identifies the missing or failed prerequisite and an applicable operator action without exposing credentials
- **AND** local connectivity alone is not reported as working Telegram approval, human receipt, approval or confirmed delivery
- **AND** existing pending requests and recorded decisions retain their existing durable-state and expiry semantics.

#### Scenario: Required local authority or state protection is unavailable

- **GIVEN** missing or invalid local credentials, an unknown transport principal, an ordinary OS access failure, a storage correctness failure or POSIX state that does not satisfy required owner-only protection
- **WHEN** automatic startup or request access is attempted
- **THEN** the operation fails closed with an actionable diagnostic
- **AND** no unauthenticated fallback, cross-principal access, bypass of ordinary OS denial or weakening of POSIX state protection is used
- **AND** Windows permissions allowing additional OS principals are not themselves an admission failure.

### Requirement: First-use and restart preserve the approval workflow

An empty installation MUST remain unpaired with no requests or decisions until supported setup and approval actions create them. The documented installed-product setup path MUST create required state under the platform's storage policy, a transport principal, either private launch-environment token supply or broker-only plaintext-file credential provisioning, and operator-authorized private pairing without manual stored-data editing. Windows initialization and subsequent state, journal, ownership-record and local-key operations MUST need only ordinary OS file access plus existing correctness and authority prerequisites, not special permission preparation. POSIX state/key protections remain required. Windows and POSIX persisted setup MUST include explicit private Proceed provisioning without token-specific permission preparation and subsequent normal MCP startup without harness token supply. After setup, normal MCP use with the selected source available MUST support the first useful approval interaction with no separate manual broker launch. Setup instructions MUST distinguish environment supply on each fresh launch from one-time file provisioning. Existing usable state, keys and pairing MUST remain usable without reinitialization, migration, rotation or re-pairing. Credential setup MUST NOT enable disabled integrations, create human decision authority or alter native harness permissions.

#### Scenario: Complete setup and first useful action from empty state

- **GIVEN** a clean installation with no product configuration, pairing, requests or decisions and operator access to the required external prerequisites
- **WHEN** the operator follows supported setup using either credential source, connects the normal MCP adapter, calls `prepare_approval`, calls `request_approval` with the returned private authority and the paired human selects Approve while the call remains active
- **THEN** the waiting call returns the matching explicit approval through the existing tool contract without a separate manual broker launch
- **AND** environment-mode setup and first use require no token file
- **AND** no proprietary host API, direct stored-data editing, `doctor` or delivery retry is required
- **AND** setup and startup alone never create a request or grant approval
- **AND** Windows initialization and all subsequent operations in this path impose no custom filesystem protection admission or repair.

#### Scenario: Setup or pairing is incomplete

- **GIVEN** missing initialized state, owner setup, a required selected credential source or operator-authorized private pairing
- **WHEN** the operator connects the MCP adapter or attempts an operation that needs that prerequisite
- **THEN** the product identifies the incomplete prerequisite and supported next step without claiming completed setup or a successful approval interaction
- **AND** it does not invent pairing, create substitute authority or return a fake human decision.

#### Scenario: First persisted approval follows a fresh token-free launch

- **GIVEN** an empty Windows or POSIX installation meeting platform storage and external prerequisites, with ordinary OS access to a separated token destination
- **WHEN** the operator uses supported setup for state, a transport principal, private Proceed plaintext credential provisioning and authorized private-chat pairing
- **AND** safely stops the broker and starts a fresh supported harness without a Telegram token in its environment or configuration
- **AND** normal MCP use prepares private authority and requests approval, and the paired human selects Approve while the call remains active
- **THEN** the same waiting call returns the matching explicit approval without token re-entry, token-specific permission preparation or a separate broker terminal
- **AND** local provisioning or readiness alone is not reported as human receipt or confirmed outcome delivery.

#### Scenario: Existing setup retains its authority boundary

- **GIVEN** usable existing state with keys, pairing, pending requests and recorded decisions
- **WHEN** the operator upgrades to the ordinary-access Windows storage policy, configures a new separate credential destination or later uses the persisted route
- **THEN** existing state remains usable without reinitialization, migration, key rotation or re-pairing, and durable work keeps its existing expiry and single-resolution semantics
- **AND** credential setup does not enable a disabled integration, enroll a human decision-maker, bypass native permissions or take over uncertain broker ownership.

### Requirement: Harness interaction preserves merged delivery safeguards

The existing delivery requirements in `openspec/specs/opencode-session-continuation/spec.md` for platform-specific storage policy, authenticated confidential admission on every connection, private capability and principal boundaries, truthful readiness and shared-broker lifecycle MUST remain effective. Windows storage uses ordinary OS file access under `Windows state and credential admission verifies required protection`. POSIX storage protection remains unchanged. This is a repository-relative path.

#### Scenario: Preserve safeguards with the harness channel enabled

- **GIVEN** the trusted harness channel is configured
- **WHEN** setup, connection, request handling, status reporting or shared-broker lifecycle operations occur
- **THEN** all merged delivery baseline safeguards remain effective under the Windows ordinary-access exception without weakening POSIX protection, authenticated confidential admission, authority boundaries, readiness reporting or lifecycle guarantees.

### Requirement: Windows environment startup and trusted TUI setup work

With documented prerequisites and ordinary OS file access, Windows setup MUST establish state, control and owner credentials, the confidential-channel key and the operator key required by the existing trusted TUI enrollment path. Normal MCP startup MUST support the privately supplied environment-token route without a Telegram token file or separate broker terminal. Refusing every Windows operation MUST NOT satisfy this requirement. Existing token-source precedence, transport confidentiality, environment-token non-persistence, helper environment filtering and trusted-human authority requirements MUST remain effective. Windows local file confidentiality is operator-managed, not a prerequisite enforced by Proceed.

#### Scenario: Complete Windows environment setup and first approval

- **GIVEN** a clean Windows installation with documented prerequisites and no configuration, pairing, requests or decisions
- **WHEN** supported setup creates state, a transport principal and operator-authorized private pairing without manual stored-data edits or custom filesystem protection preparation
- **AND** the trusted launch environment privately supplies a valid token, with no explicit token-file selection and no token file
- **AND** normal MCP use calls `prepare_approval`, then `request_approval` with its returned private authority, and the paired human approves while the call remains active
- **THEN** the waiting call returns the matching explicit approval without a separate broker terminal
- **AND** the product neither persists the token nor requires `doctor`, delivery retry, a proprietary host API or manual stored-data editing
- **AND** setup and startup alone create no request or approval.

#### Scenario: Protected operator setup supports trusted TUI use

- **GIVEN** ordinary Windows file access and an operator configuring the existing trusted TUI interaction
- **WHEN** supported enrollment creates the operator key and the configured TUI connects
- **THEN** key creation and subsequent access need no custom Windows protection admission or repair, and the local channel still satisfies authenticated confidential admission requirements
- **AND** existing request-bound human decisions work without changing pairing, principal boundaries or decision authority.

### Requirement: Windows state and credential admission verifies required protection

Windows initialization and all subsequent operations involving state, journals, broker ownership records, control/owner credentials, confidential-channel keys and operator keys MUST use ordinary OS file access. Proceed MUST NOT query, verify, require or repair ACLs, ownership, modes, inheritance, owner-only ancestry or local-fixed-NTFS protection as an admission prerequisite. Unavailable protection queries or access by additional OS principals MUST NOT cause refusal. No permission gate under a different name, bypass flag, native helper, service, compiler or new protection framework is required or authorized.

File type, path identity, required storage separation, no-overwrite and exclusive creation, atomicity, flush and journal integrity MUST remain correctness requirements. They MUST NOT become secret-permission gates. Ordinary OS access denials and I/O errors MUST still fail with actionable secret-free diagnostics. Broker locking, exclusive ownership, liveness and supported stale-ownership recovery MUST remain unchanged, without automatic lock deletion or uncertain ownership takeover. Authentication, capability/principal checks, TLS, network scope and pairing authority MUST remain unchanged.

References to protected state, protected local credentials or safe storage elsewhere in this capability MUST mean this ordinary-access and correctness policy on Windows, not owner-only filesystem admission. POSIX state/key protections and the separate ordinary Telegram-token file policy MUST remain unchanged. Windows file security is the operator's responsibility. Proceed MUST NOT claim verified owner-only protection, encryption or resistance to local key theft or record tampering.

#### Scenario: Safe Windows storage is admitted

- **GIVEN** ordinary Windows OS file access is sufficient and storage satisfies the existing correctness and authority prerequisites
- **WHEN** supported initialization, startup or normal state/journal/ownership-record/control/owner/operator/channel-key operations use that storage
- **THEN** operations can proceed without custom ACL, owner, mode, inheritance, protection-query or local-fixed-NTFS admission or permission repair
- **AND** authenticated local access remains required
- **AND** local readiness alone does not claim Telegram availability, pairing, human receipt or confirmed delivery.

#### Scenario: Unsafe or unverifiable Windows storage is refused

- **GIVEN** Windows permissions allow additional principals or protection cannot be queried, while ordinary OS access, storage correctness and authority prerequisites remain usable
- **WHEN** setup, startup or trusted TUI access attempts to use that storage
- **THEN** those permission conditions alone do not cause refusal, permission repair or a protection query
- **AND** an actual OS access denial, file identity/type failure, integrity failure or other retained correctness or authority failure still refuses without bypass or false success
- **AND** diagnostics do not claim owner-only protection was verified.

### Requirement: Windows protection correction preserves existing storage

The Windows ordinary-access policy MUST NOT automatically repair permissions, overwrite existing credential or key destinations, rewrite or migrate existing journal or pairing, rotate keys, require re-pairing or remove uncertain broker ownership records to succeed. Existing Windows state usable under ordinary OS access and retained correctness requirements MUST remain usable without reinitialization or manual stored-data migration. Existing durable work, create-only credential/key behavior and POSIX file/environment safeguards MUST remain effective.

#### Scenario: Existing state or credential destination is encountered

- **GIVEN** existing Windows state, keys, credentials or an uncertain ownership record
- **WHEN** setup or admission encounters them
- **THEN** create-only operations refuse existing destinations without overwrite or automatic permission repair
- **AND** existing state satisfying ordinary access and retained correctness requirements keeps its keys, pairing, pending work and recorded outcomes under existing expiry and single-resolution rules without reinitialization, migration, rotation or re-pairing
- **AND** additional-principal permissions or unverifiable protection alone do not cause refusal
- **AND** actual access, correctness or authority failures refuse without rewriting durable work, automatically deleting locks or taking over uncertain ownership.
