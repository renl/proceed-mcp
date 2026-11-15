## Context

Remove custom Windows permission admission throughout setup and subsequent storage operations, without removing storage correctness or application authority.

Parent: [proposal](proposal.md). Behavior: [delivery delta](specs/opencode-session-continuation/spec.md) and [distribution delta](specs/npm-distribution/spec.md). These deltas intentionally supersede the merged Windows protection requirement. The merged [delivery](../../specs/opencode-session-continuation/spec.md) and [distribution](../../specs/npm-distribution/spec.md) specs remain authoritative until this change merges.

The production caller inventory below is based on the current source, not historical designs. `protection.js` currently combines permission policy with object-kind and redirection checks inside its Windows metadata query. Removing its calls without retaining those correctness checks would remove more than the approved policy.

## Goals and boundary

- Deliver one independently landable outcome against `main`: Windows initialization, owner creation, normal startup/reuse, journal operations and local-key operations with ordinary OS access and no custom permission preparation.
- Preserve existing state, keys, pairing, pending work and outcomes. No migration, reinitialization, rotation or re-pairing is required.
- Keep POSIX state/key protection and ordinary Telegram-token policy unchanged.
- No stacked parent or dependency on the separate configuration session exists. This change lands as one PR with implementation, tests, matching README/metadata and the authorized CLI archive.

Non-goals: new storage framework, dependencies, helper, compiler, service, runtime probe, permission flag, bypass mode, authentication redesign, automatic stale-lock recovery, deployment or publication.

## Decisions

### 1. One shared storage boundary, two separate responsibilities

The existing shared storage modules SHALL separate ordinary I/O correctness from platform permission policy. Extend the existing boundary in `src/state/protection.js` and reuse `src/state/path-trust.js` rather than distributing new Windows conditionals among callers.

| Responsibility | Windows | POSIX state/key callers |
| --- | --- | --- |
| Filesystem permission privacy | No owner, ACL, mode, inheritance, owner-only ancestry, fixed-volume or NTFS query/admission/repair | Preserve existing caller-specific modes, ownership checks and ancestor policy |
| Ordinary object correctness | Non-following path inspection, expected object kind and identity observations | Preserve existing correctness checks |
| Directory/file creation | Ordinary OS defaults, no chmod or permission repair | Preserve existing creation modes and chmod behavior |
| Authority | Unchanged cryptographic validation, pairing, principal/capability rules and exclusive broker ownership | Unchanged |

The shared boundary SHALL support the following semantics, without requiring these as new public function names or a configurable policy object:

- Inspect an existing directory or regular file and its contiguous directory ancestry without following observed links/redirection. Expected kind comes from the operation, not a blanket assertion that every target is a file.
- Permit absence only where the operation already supports absence, creation or a missing tail. Only `ENOENT` means absent. Access denial and other inspection failures remain failures.
- For an opened file, validate its actual kind before content access. Compare path and handle identity, then re-observe the destination before returning bytes or publishing successful creation/replacement. Observed replacement, disappearance or identity uncertainty is not success.
- Preserve existing single-link checks on ownership records and operator keys. Do not add them to the separate Telegram-token policy.
- Keep POSIX permission checks at their existing call sites and strengths. A Windows-only permission check removed from a caller SHALL NOT become a new POSIX permission prerequisite.
- Directory creation SHALL preserve supported missing-parent creation while checking existing components as directories, not adopting an observed redirected object. Creation collisions do not authorize repair.

Use ordinary filesystem observations already available to the runtime. No ACL query may be retained to obtain file type, identity or ancestry. This is repeated-observation I/O correctness, not a guarantee against hostile local mutation or a new native handle-pinning requirement. Private helper names, factoring and dependency injection belong to implementation engineering.

### 2. Retire obsolete Windows protection production paths

Remove the Windows ACL/volume query, descriptor decoding/admission, protection-query budgets, trusted tool resolution and `icacls` directory repair from `protection.js` once their production callers have been replaced. The source inventory finds no production calls to `verifyWindowsInheritableDirectory` or `verifyWindowsProspectiveDirectory`. Remove these obsolete exports with that path rather than retaining a dormant protection subsystem.

`verifyWindowsProtection` SHALL NOT become a trivial successful stub. Its callers must first be classified as obsolete permission-only observations or necessary correctness observations using the table below. A surviving name or successful operation must not imply Windows protection was verified.

`verifyOwnerOnly` and `createProtectedDirectory` currently serve both runtimes and setup. Their shared Windows branch SHALL enforce ordinary object correctness/creation only. Their POSIX branch SHALL retain its current permission policy. Renaming these private seams for truthful meaning is allowed within the listed files, not a repository-wide cleanup.

### 3. Caller coverage and appropriate code paths

Paths in this table are repository-relative. All rows belong to the same vertical outcome, not an initialization-only first slice.

| Caller family | Required treatment |
| --- | --- |
| `src/state/store.js` | Cover config reads, `init`, `owner add`, legacy origin setup and broker-record inspection. Replace pre/post Windows permission snapshots with ordinary directory/file and identity checks. Preserve empty-state refusal, config parsing, immutable principals and existing-record blocking before owner mutation. Shared final admission must not skip correctness or add POSIX gates. |
| `src/state/files.js` | Remove Windows protection queries around parent, temporary sibling and destination. Retain real-directory parent, exclusive sibling creation, handle/path identity, write completion, flush, close and atomic rename. Validate the published destination against the created sibling. Expected replacement of an existing config is allowed only through the existing atomic-write operation, not through create-only key operations. |
| `src/state/credentials.js` | Control, legacy origin and owner reads retain missing/invalid classification and token syntax. Replace Windows pre/post permission snapshots with ordinary regular-file, handle/path identity and post-read checks. Do not add POSIX permission checks that this reader did not previously impose. |
| `src/state/owner-credentials.js` | Retain `wx`, no-overwrite, secret-free result and flush. Validate the created object and destination identity, not ACLs. Owner config commit/rollback preserves uncertain or replaced credentials. Reads continue through `readLocalCredential`. |
| `src/state/ownership.js` | Acquisition, secure record reads and release retain type, single-link, identity, bounded record parsing and exact-instance/byte semantics. Remove only Windows permission observations and protection-specific refusal wording. Preserve POSIX mode/UID checks. Secure reads still compare opened file identity and discard observed replacement. Release still follows journal drain and removes only the invocation's proven record, never a same-byte replacement or uncertain entry. |
| `src/harness/operator-key.js` | Key generation and TUI loading retain path syntax, location separation, regular-file/single-link checks, directory kind, opened identity, bounded key syntax, fingerprint and conservative cleanup. Its existing POSIX-only mode/UID/chmod checks remain. Windows metadata-only protection calls are obsolete, but existing handle/path checks and post-create identity checks are not. Key generation neither enrolls a human nor approves work. |
| `src/journal/journal.js` | Cover open, recovery/header creation, append, incomplete-tail truncation, format upgrade, temporary replacement and reopen. Replace permission observations with checks that the path/handle still name the expected regular file at each affected mutation/publication boundary. Preserve framing, sequence, corruption refusal, write-progress/length checks, flush-before-acknowledgement and existing directory-flush policy. Do not add POSIX permission gates at removed Windows-only snapshots. |
| `src/broker/portable-runtime.js`, `src/broker/runtime.js` | Initial and final shared admission use ordinary Windows object checks, unchanged POSIX admission. Keep each runtime's ownership/recovery/readiness ordering, deadlines, authenticated listener and drain behavior. No new network or process behavior is needed. |
| `src/state/path-trust.js` | Reuse contiguous ancestry, non-redirection and conservative removal semantics. `ancestorProtects` is already POSIX-only policy. Do not remove its POSIX branch or weaken Windows uncertainty handling in `removeExactCreated`. |
| `src/state/credential-file.js` | Independent ordinary token path, not a consumer of the protection query. No behavior change is required. Preserve both-platform ordinary access, separation, private-input lifecycle, exclusive creation, identity checks, source selection and conservative cleanup. At most correct its now-obsolete comment claiming Windows state/key admission remains protected. |

Retain syntax-only device, alternate-stream and network-share restrictions and existing storage-separation rules. Removing local-fixed-NTFS admission does not promise every filesystem supports the required atomicity, flush or identity operations.

### 4. Privacy removal is not integrity removal

Windows operators accept that principals with OS read access can steal local key authority and principals with OS write access can tamper with approval records. Authentication and TLS cannot prevent misuse of stolen endpoint keys or hostile edits to local authority data. This is the approved tradeoff, not an unresolved security decision.

The following remain mandatory:

- OS access denial is not bypassed. Incomplete reads/writes, failed flush, malformed credentials, invalid journal frames and observed type/identity changes fail without secret disclosure.
- Exclusive creates still refuse collisions. Permission-policy removal does not authorize overwriting an existing owner/operator key or adopting an existing lock.
- Locks, liveness checks, exact broker instance matching and supported operator recovery remain unchanged. No automatic stale-lock deletion, takeover or automatic human approval is introduced.
- Pairing, local cryptography, authenticated TLS on every applicable connection, loopback scope, principal binding and private request capabilities remain unchanged.
- Cleanup removes only objects still proven to belong to the attempt. Existing conservative Windows preservation remains. Do not replace it with optimistic unlink based solely on prior exclusive creation.

Current `store.js` rollback uses path-based file deletion and recursive removal of a newly created state directory. When adapting this path, it SHALL NOT delete a replacement, preexisting file or an uncertain subtree. Preserve uncertain artifacts and report incomplete setup instead. The same constraint applies to owner-credential rollback. This is bounded correctness work required for the changed ordinary-access path, not a general storage refactor.

### 5. Diagnostics and compatibility

No CLI option, tool schema, route, credential format, journal format or stored configuration schema changes.

Keep established failure categories: `STATE_NOT_INITIALIZED`, `STATE_ALREADY_INITIALIZED`, `OWNER_ALREADY_CONFIGURED`, `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `STATE_NOT_OWNED`, `BROKER_INSTANCE_CONFLICT`, operator-key classifications and existing journal codes. Ordinary new I/O failures use `STORAGE_FAILURE`. Existing `PROTECTION_UNVERIFIED`/`PROTECTION_UNAVAILABLE` codes may remain where required for compatibility with existing path/integrity errors, but their Windows messages SHALL name the actual I/O, kind, identity or separation failure, not prescribe ACL repair or claim permission verification. Do not create a new error taxonomy.

Diagnostics SHALL be actionable and secret-free. Do not expose file contents, credentials, keys, records or raw exception payloads. Local success means the particular operation completed, never that Windows owner-only protection, Telegram delivery or human approval was verified.

## Minimal implementation allowlist

Production changes are limited to the caller-table files and `src/state/protection.js`. `src/state/credential-file.js` is comment-only if touched. Use existing test directories for affected portable unit regressions. Matching README and existing coupled version metadata may change for proposed `0.1.0-preview.9`. No dependency, harness, CI-platform expansion, global configuration or runtime-state work is needed.

README changes SHALL keep the current concise install/setup/use flow, identify source preview.9, require checking exact-version availability and avoid asserting publication. Replace Windows protected-state/NTFS preparation and permission-repair guidance with ordinary OS access and explicit operator responsibility for key theft and record tampering. Keep POSIX protections, token separation and first-use limitations clear. Remove PowerShell/`icacls`/NTFS protection prerequisites for this scope when no longer used by production. Do not turn removal of storage-query prerequisites into a claim that every Windows feature, private-input mechanism or platform has been verified.

## Verification and handoff

Only normal JavaScript/TypeScript unit tests runnable on Linux are authorized. Use in-memory filesystem/handle observations and controlled platform selection at private seams. No PowerShell scripts, native compiler, live processes, network, installed-state access, provisioning rerun or secret read is part of verification.

Unit assertions SHALL cover:

- Windows init followed by owner creation, configuration/local-credential access, ownership acquisition/read/release and journal recover/append/truncate/upgrade paths without custom protection query, ACL repair or chmod. Exercise shared callers rather than only proving a helper returns.
- Windows operator-key creation and loading, plus subsequent storage use of existing state, without permission metadata admission. Supplied mode/owner metadata does not decide Windows admission. A query/repair/chmod observer fails the test if invoked.
- Actual access denial, create collision, wrong kind, redirection, path/handle replacement, malformed key/record, journal corruption and flush failure remain non-success. A replaced or uncertain cleanup target is preserved.
- POSIX shared admission still rejects forbidden modes. Existing operator/ownership exact-mode, UID and ancestor checks and required chmod behavior remain. Token operations remain independent and permission-policy-free on both platforms.
- Existing authentication, pairing, capability/principal and ownership regressions retain their assertion scope. No new protocol or network proof is implied.

Boundary Verification is triggered by the changed shared storage-admission contract, platform policy split and filesystem/handle observations. Review test doubles against actual production caller wiring, operation order and failure mapping. Any SDET-authored compilable seam is test-only and cannot define the production contract. Combine any triggered decomposition/test-interface review into one focused architecture pass. Unchanged TLS/Telegram/MCP interfaces need no newly invented interface or integration harness.

Unit results establish controlled behavior, not native filesystem enforcement, Windows first-run success, installed startup, actual POSIX enforcement, terminal privacy, reboot recovery or Telegram delivery. Those outcomes remain deferred and unverified for owner proof under separately authorized deployment/runtime activity. Independent candidate review remains required. Candidate-specific landing/exposure authorization is separate from this design and does not inherit earlier preview acceptance.

Ready for test planning and portable unit specification. Before archive, the declared spec author reviews both deltas against the latest merged baseline. The authorized CLI archive applies them inside this change's single PR. No manual baseline spec merge or archived-history edit is permitted.
