# Design

## Outcome and baseline

Parent: [proposal](proposal.md). Behavior: [delta](specs/opencode-session-continuation/spec.md). Baseline: [merged capability](../../specs/opencode-session-continuation/spec.md), including the environment-source requirements landed through PR #8.

This change delivers protected Windows environment-mode broker startup and trusted TUI setup together, in one independently landable PR targeting `main`. It has no unmerged parent. The supplied implementation baseline is `f726848ad60b3f4622065c1a2f4ff98ff321cc43`. The revised proposal and delta supersede the earlier unlanded native-worker design. No production dependency on that design remains required.

The first useful whole change is setup of protected state, a transport principal, existing operator-authorized pairing and trusted TUI enrollment, followed by normal on-demand MCP startup with a privately supplied environment token. Setup creates no approval. Request capabilities, transport principals, original-call correlation, authenticated confidential connections, durable-before-effect commits and single resolution remain unchanged.

## Chosen boundary

Use existing Windows OS metadata mechanisms and existing Node filesystem operations. The fixed PowerShell metadata query supplies observations. Production JavaScript validates those observations, applies protection policy and gates existing readers/writers. It is not a protected-I/O worker and never receives secret contents.

There is no native ABI, retained Windows handle chain, storage capability/session protocol, PowerShell dispatcher, script-file runner, custom executable, addon, runtime compilation, signing/build system or new test framework. In particular, do not load the former dispatcher body as inline or encoded text. Existing `-Command` metadata querying is a standalone established OS-query mechanism, not a way to evade a refused script.

The threat boundary is the trusted current local account versus ordinary other accounts. The installed package, Node runtime, Windows installation and launch host are trusted prerequisites. Same-account malicious code, administrators and privileged OS actors are not a new sandbox target. Protected ancestry prevents ordinary untrusted replacement under this boundary. Repeated metadata snapshots detect observed changes but do not pin native objects, revoke previously opened handles, prove past confidentiality or guarantee substitution resistance against actors outside this boundary. Do not describe Node `dev`/`ino` as a Windows security identity.

## Supported prerequisites and refusal

- Windows 10/11 desktop with the supported Node runtime, inbox Windows PowerShell 5.1 and its normal security/filesystem metadata facilities, plus inbox `icacls.exe` for protection of newly created empty directories only.
- Local fixed NTFS storage with persistent Windows ACLs. Network/removable storage, unsupported filesystems, unresolved metadata and policy-denied OS queries refuse. This is a supported prerequisite envelope, not runtime qualification of every version or architecture.
- Drive-qualified absolute local paths. Refuse UNC, device/extended namespaces, alternate streams, drive-relative spellings, NUL/CR/LF, dot traversal, trailing dots/spaces and reserved DOS device components. Existing documented relative state selection may resolve once before this check.
- All selected components, including the volume root, must be observed as non-reparse. Reject every `ReparsePoint` attribute, not just symlinks or known tags. Existing ancestors must be directories. Secret/state files must be regular single-link files under existing Node type/link checks as well as Windows metadata checks. Unsupported type evidence refuses.
- Preserve operator-key location exclusions, default state/key selection and filename rules. Operator keys remain outside state, repositories, the package and known client-configuration locations. Inspect repository markers only. Ambiguous exclusion checks refuse.

Windows Telegram token-file provisioning/loading is not required for this selected route. Until independently supportable, refuse it before reading stdin secret input or opening file contents, using existing secret-free prerequisite guidance. An explicitly selected file still wins and fails without environment fallback. A nonempty selected environment value is validated without consulting a default token file. Absence/empty environment retains deterministic default-file selection, whose unsupported Windows operation refuses. Secure foreground reuse needs no token source. POSIX file/environment behavior is unchanged.

## OS helper contract

### Launch, environment and limits

Maintain `src/state/protection.js`'s `execFile` mechanism. Resolve only absolute `<trusted-SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` and `<trusted-SystemRoot>\System32\icacls.exe`. Reject missing, relative, inconsistent case-insensitive `SystemRoot`/`WINDIR` settings or unsupported tool paths. No PATH/current-directory search, caller executable override, shell launch or `pwsh` fallback is permitted. Resolution relies on the trusted OS/launch environment, not self-attestation by an untrusted executable.

PowerShell uses `-NoLogo -NoProfile -NonInteractive -Command` with fixed metadata-only text. Paths enter through `PROCEED_ACL_TARGETS` as LF-separated validated paths with no empty components, never script interpolation. The metadata query has no caller-selected operation or script. The former `PROCEED_ACL_MODE` protect branch is removed. `icacls` receives validated path and grant arguments through `execFile`, never a command shell. Use only system facilities from the trusted OS installation. No profiles, arbitrary modules, plugins, network operations, `Add-Type`, policy bypass or script-file evaluation.

Build an explicit secret-free child environment, not a copy with a few deletions. Allowed inputs are validated `SystemRoot`/`WINDIR`, the bounded `PROCEED_ACL_TARGETS` query input and an applicable inherited `PSExecutionPolicyPreference` process restriction. Preserve a process restriction without weakening it. Conflicting casing variants or an unrecognized policy value refuse. If preservation cannot be established, refuse. `icacls` needs only the validated OS environment, not query targets or policy settings. Do not forward PATH, PSModulePath, preload/debug/coverage variables, proxies, Telegram variables including configured names/casing variants, credentials, keys or arbitrary parent entries. The metadata text must not require a user TEMP or HOME dependency. Do not change the parent environment, OS policy, trust stores or file unblock state.

Each helper invocation uses the existing 20,000 ms timeout and 256 KiB `maxBuffer`, capped by the caller's remaining deadline. The entire admission attempt also shares that 20,000 ms budget, rather than restarting it per component. Reserve the last 1,000 ms for termination/settlement. Do not begin a query without active time left. Overflow, timeout, launch failure, nonzero exit, nonempty stderr or unsettled termination prevents success. No automatic retry with weaker options. Discard raw stdout/stderr on failure and never publish a child exception or cause.

There is one bounded JSON response per invocation and no persistent helper session. Maximum 64 requested targets and 32,768 UTF-8 bytes of target input per invocation. Larger chains may use bounded depth-ordered batches within the same deadline. Output exceeding the maintained buffer limit refuses, never truncates into accepted metadata. Existing product storage/journal bounds do not change.

### Exact observation schema

This is a project-owned normalized metadata boundary, not a vendor API or a required private JavaScript export. Replace the old `{path,ok,reason}` approval report. The helper must not decide that an object is safe.

Successful stdout contains exactly `{version,account_sid,trusted_installer_sid,entries}`:

| Field | Value |
| --- | --- |
| `version` | Integer `1`. |
| `account_sid` | Canonical current process user SID from Windows process identity. Never derive it from a path owner or caller configuration. |
| `trusted_installer_sid` | Locally resolved `NT SERVICE\TrustedInstaller` SID, or `null` if unavailable. Null cannot authorize an encountered service identity. |
| `entries` | Array exactly matching the requested target count and order. No duplicate, omitted, extra or unrelated targets. |

Each entry contains exactly `{path,status,volume,object}`. `path` echoes the validated requested absolute path. Use Windows case-insensitive comparison after the same syntax normalization, not a prefix match. `status` is `present`, `absent` or `unavailable`.

- `absent` and `unavailable` have `volume:null,object:null`. Only actual not-found under an already admitted parent establishes absence. Access denial, unresolved SID, unsupported query and malformed security metadata are `unavailable`, never absence.
- `present` has `volume:{root,drive_type,filesystem,persistent_acls}`. `root` is the corresponding drive root, `drive_type` is `fixed` or `unsupported`, `filesystem` is the observed filesystem name and `persistent_acls` is a boolean. Only fixed NTFS with persistent ACLs proceeds. Cache unchanged volume observations within the attempt only.
- `object` is exactly `{kind,attributes,owner_sid,control,dacl,aces}`. `kind` is `directory`, `file` or `unsupported`. `attributes` and descriptor `control` are unsigned 32-bit masks. `owner_sid` is a resolved canonical SID. `dacl` is `absent`, `null` or `present`.
- `aces` is the complete ordered DACL, including inherited and inherit-only entries, not just a filtered list of grants. Each ACE is exactly `{type,sid,mask,flags}`. `type` is `allow`, `deny`, `object`, `conditional` or `unknown`. Ordinary allow/deny entries have resolved SID, unsigned 32-bit access mask and byte-sized flags. Unsupported forms use null SID/mask and are refused. Do not silently flatten or omit them. Absent/null DACLs have an empty ACE array. A present empty DACL is reported as empty, not fabricated into owner access.

Obtain owner, descriptor control and complete ACEs through the normal OS ACL/security-descriptor facilities underlying `Get-Acl`. Preserve SID identities and raw access/inheritance information. Obtain attributes/type through ordinary filesystem metadata. Do not infer reparse safety from `realpath`, successful file access or a display name. If the installed metadata facilities cannot supply any required field unambiguously, report unavailable.

JavaScript validates exact field sets, enums, integer ranges, canonical SID syntax, target correlation and descriptor consistency before policy evaluation. Reject unknown versions, missing/null fields where values are required, malformed JSON, trailing non-whitespace output, duplicate object member names, non-array entries/ACEs, unresolved identities, contradictory DACL/control bits and any partial observation. If the existing JSON parser cannot detect duplicate keys, add bounded duplicate-member rejection to this query decoder, not a general parser framework. Empty stdout and empty results for nonempty requests refuse. An empty requested target list remains a local no-op, not evidence for another target.

## JavaScript admission policy

### Dedicated state and credentials

For state root, credentials directory, configuration, control/owner credentials, journal, lock/channel publication and operator key/directory:

1. Owner is exactly `account_sid`.
2. DACL is present, non-null and nonempty. Every ACE is an ordinary allow ACE for that same SID. SYSTEM and Administrators are not exceptions on these dedicated objects.
3. Expand generic rights using Windows file/directory mappings. Applicable self grants must provide full file access (`FILE_ALL_ACCESS`, `0x001f01ff`). An inherit-only grant cannot establish access to the object. Reject deny, conditional, object-specific, unresolved or unknown forms and unknown applicability flags. A current-account-only but insufficient self grant refuses.
4. Existing inherited current-account-only grants may pass without rewriting. Admission does not require stripping inherited status. New dedicated directories must have protected account-only self and file/subdirectory inheritance, without inherit-only/no-propagate gaps. Before creating secret children, verify that effective inheritance produces account-only full-access children and cannot introduce another SID or unsupported ACE.
5. Refuse reparse attributes, wrong types and the existing file single-link/type failures before content use. Mode `0600`/`0700` is not Windows ACL evidence.

### Top-down ancestry

Inspect and admit the volume root first, then each selected existing component before querying or using its descendant. Shared ancestors are not required to be account-only. Their allowed owner/mutation principals are current account, SYSTEM (`S-1-5-18`), built-in Administrators (`S-1-5-32-544`) and the locally resolved TrustedInstaller SID. Do not trust arbitrary services, domain groups or a similarly named account.

Require a present, non-null, nonempty, completely understood ancestor DACL and sufficient current-process traversal/metadata access. Refuse unsupported ACE forms or deny entries rather than guess effective access. Self versus inherit-only applicability must be evaluated explicitly. Expand generic masks before testing mutation rights.

For each parent/child edge, reject an untrusted owner or applicable untrusted `WRITE_DAC` (`0x00040000`) / `WRITE_OWNER` (`0x00080000`) rights on either object. Reject applicable untrusted child `DELETE` (`0x00010000`) or parent `FILE_DELETE_CHILD` (`0x40`). Reject untrusted modification of selected file data or selected component redirection/security metadata, including applicable write-EA/write-attributes (`0x10`/`0x100`). Generic write/all grants include these mutations and refuse.

Foreign `FILE_ADD_FILE` (`0x2`) and `FILE_ADD_SUBDIRECTORY` (`0x4`) on a directory alone are creation rights, not proof that its existing selected child can be deleted or replaced. Do not reject a normal OS ancestor solely for these rights or ordinary read/list/traverse grants. Conversely, creation rights cannot excuse parent delete-child, child delete, security-descriptor mutation or redirection rights. Unsupported combinations whose safety cannot be established refuse.

For a missing component, admit the parent and evaluate the prospective child's inherited descriptor before creation. Ordinary foreign inheritable mutation/replacement grants refuse before creating it. This prevents an initially writable empty object from being treated as safe merely because later snapshots look restricted. Trusted OS principals remain outside the ordinary-account attacker model. No claim of revoking preexisting handles follows from admission of an old object.

Missing tails are allowed only for explicit creation. Create one component at a time, nonrecursively. A directory creation collision is not proof of creation: observe and independently admit the existing directory, never protect it as this attempt's object. A file/key/lock collision refuses create-only publication without reading or overwriting the destination. Unknown entries are preserved, not repaired to satisfy setup.

### Creation, reads, writes and cleanup

`createProtectedDirectory` may protect only an exclusively created, still empty directory in an admitted parent. Reuse the existing fixed `icacls` account-only grant mechanism, removing inheritance for that new directory and then verifying the actual complete resulting descriptor. Retained foreign explicit entries cause refusal. Do not use it to repair an existing directory, recursively propagate permissions or change an OS ancestor. Existing safe empty directories are admitted unchanged. Recheck ancestry and type before protection and verify directory inheritance before child creation.

New secret-bearing files use existing exclusive Node create operations under an admitted account-only inheriting parent. Inspect the newly created empty file before writing any secret bytes. An inherited descriptor that does not satisfy the dedicated policy refuses without secret writes. This includes temporary siblings, ownership records and newly created journals, not just files named as credentials. Files are flushed and reverified before reporting durable success/publication. Mutable state replacements preserve existing flush/rename sequencing, verify an existing destination and the fresh sibling, and recheck the published target before use. Credentials/operator keys remain create-only and never use a replace-existing path.

Protected reads admit ancestry and target before opening or reading contents, retain existing Node opened-file type/link/size/change checks, and reobserve required metadata before returning private authority. Failed rechecks discard read results. These are checks under protected ancestry, not a native-handle ACL query. Do not use a post-read check to excuse missing pre-read admission. Rechecks surround lock release and authorized state replacements as well. No long-lived observation acts as a transferable permission certificate or replaces connection authentication.

Preserve existing bounded ownership/operator-key reads and credential grammars. Before journal replay, append, truncation or replacement, admit the journal and its parent. Preserve formats, digests, incomplete-tail rules, serialized commits, flush requirements and recovery behavior. No ACL correction migrates or resets journal/pairing.

Cleanup is limited to entries proven created by this operation within still-admitted ancestry, with no observed replacement and existing product ownership checks. Windows inode equality alone is not proof. If provenance, metadata or ownership is uncertain, preserve the entry and report incomplete cleanup. No recursive rollback of a directory containing unknown entries. An existing lock blocks acquisition without content reads. Release only the current instance's admitted record after exact-byte comparison and stopped journal activity. Any mismatch, unverifiable protection or uncertain failure preserves the lock. Never recover a stale lock, use a PID probe as takeover authority or delete a collision.

## Production integration inventory

Use shared entry guards in the existing protection/path helpers and existing readers/writers. Do not add a guard framework or duplicate checks in every CLI/TUI function. Private helper names, module boundaries and binding injection remain implementation-owned. This allowlist is the affected production scope, not authority for a repository-wide audit.

| Sources/callers | Necessary correction |
| --- | --- |
| `src/state/protection.js`, `path-trust.js` | Bounded helper observations, production JS admission, top-down ancestry and new-directory-only protection. Remove Windows assumed-safe branches. |
| `src/state/store.js` shared configuration readers and setup | Admit before configuration bytes. Init checks admitted directory existence/emptiness before parsing any existing config. Nonempty state refuses unchanged. Owner setup preserves lock absence and create-only credentials. No recursive repair/rollback. |
| `src/state/credentials.js`, `owner-credentials.js`, `files.js` | Guard shared credential reads, inherited protection before initial writes and atomic state siblings. Preserve schemas and public return values. |
| `src/state/ownership.js` | Protect channel PSK before lock write/read and verify release. Replace Windows protection skips. Preserve create-only lock, 4096-byte record bound, instance/byte checks and conflict mapping. |
| `src/journal/journal.js`, `src/broker/portable-runtime.js`, applicable `runtime.js` | Admit journal/state before recovery or private effects. Verify new secret children and readiness ordering. Existing ownership/durability remain authoritative. |
| `src/state/credential-file.js`, `src/broker/availability.js`, broker assembly in `src/cli/main.js` | Refuse unsupported Windows token-file I/O, preserve source selection/environment mode and child token minimization. Do not broaden into startup redesign. |
| `src/harness/operator-key.js` | Same pre-read/pre-write target/ancestor policy, existing location exclusions, 4096-byte bound, grammar, create-only key and enrollment semantics. |
| `src/http/local-client.js`, `src/broker/availability.js`, CLI consumers of shared readers | Consume guarded configuration/credentials/ownership. Preserve authenticated TLS-PSK admission on every connection/reconnect before disclosure. No new public route. |
| `src/harness/tui-plugin.js`, `node-helper.js`, `operator-helper.js` | Guarded config/operator-key/lock readers must work through their existing call paths. Node exchange helper has no storage authority or Telegram-token need. Change callers only if shared guard propagation/deadline/environment filtering requires it. No new TUI protocol. |

Startup order: validate syntax/prerequisites -> admit state chain -> guarded config read/parse -> admit required existing local objects -> reuse an authenticated matching broker, or acquire new exclusive ownership -> protected local credential reads and broker-only selected token handling -> journal recovery/expiry commits -> bind and verify final required protection -> local readiness -> Telegram workers. Existing broker-only token loading can occur before runtime assembly, but never initiates Telegram effects before protected admission. Original finite startup deadlines are not renewed.

TUI setup/load uses guarded configuration, admitted operator key and existing enrollment, then the protected ownership record and authenticated channel before private authority is sent. Failure grants no human authority. Matching secure foreground reuse does not require token loading. Shared readers cover MCP, pairing, status, stop and TUI consumers without separate policies.

## Error contract

Keep existing public CLI exit/MCP/startup mappings and non-approval behavior. No new public success state or protocol is introduced.

| Condition | Classification and action |
| --- | --- |
| Missing/denied helper, unsupported prerequisite, timeout or output overflow | Exit 4 `PROTECTION_UNAVAILABLE`. Use supported local storage/runtime, without policy bypass or disabled verification. |
| Unsafe owner/ACL/ancestry/type/reparse, malformed/mismatched/incomplete observations or uncertain cleanup | Exit 4 `PROTECTION_UNVERIFIED`. Stop and choose a new dedicated safe location or assess existing storage offline. No automatic repair. |
| Secure ownership protection failure | Retain `BROKER_INSTANCE_CONFLICT`, not an ordinary retryable reachability failure. Preserve the record. |
| Existing ownership/key/credential destination | Existing ownership/conflict or create-only destination code. Preserve bytes and select a genuinely new destination where appropriate. |
| Validly admitted ordinary I/O/flush failure | Existing `STORAGE_FAILURE`. Preserve uncertain durable work and make no commit/delivery claim. |
| Selected Windows Telegram file route unsupported | Existing actionable credential/prerequisite failure, before token read/write and without source fallback. Environment supply is the supported alternative for a subsequent explicitly chosen launch. |

Diagnostics use fixed secret-free summaries and supported next steps. Do not echo metadata payloads, child output, SIDs, raw exceptions or secret buffers. Existing validated credential/config parser codes remain where applicable. Local readiness does not imply Telegram availability, pairing, receipt or delivery.

## Unit handoff and proof limits

All automated tests for this change are normal JavaScript/TypeScript Node unit tests runnable on Linux. Exercise actual production query decoding, ACL/ancestor decisions, environment/tool selection, creation/read/write ordering and caller wiring through mocked child-process, metadata and filesystem bindings. Existing module mocks or VM interfaces are sufficient. No forced private exports, custom testing framework, PowerShell runner, native helper execution or second JavaScript model of admission is required or permitted as the canonical proof.

Required observable unit coverage:

- Accepted current-account targets, complete root-to-target chain, protected new children, successful environment startup wiring and trusted operator setup wiring.
- Missing/null/empty/malformed ACLs, unresolved/mismatched owner, insufficient current-account self access, inherit-only/no-propagate gaps, foreign grants, unsupported ACEs and descriptor contradictions.
- Root admission, every reparse attribute regardless of tag, parent delete-child versus child delete, security mutation, allowed ancestor creation-only rights and unsafe prospective inheritance.
- Missing tails, directory/file collisions, preservation of unknown entries, no repair of old directories, create-only keys/locks and no secret write before child admission.
- Pre-read configuration/credential/channel/operator-key guards, bounded reads, failed rechecks, no private disclosure/readiness after refusal and actual shared-reader propagation into affected clients.
- Exact target correlation, duplicate/missing/extra entries/members, malformed output, bounded sizes/deadlines, secret-free errors, fixed absolute tool selection, explicit helper environment and no script/policy bypass.
- Durable ordering, ownership preservation/release refusal, uncertain cleanup, secure foreground reuse without token load, selected-source failure without fallback and unchanged POSIX behavior.

These assertions prove JavaScript decisions and requested calls, not that Windows returns the modeled observations or enforces inheritance/ACLs as expected. Native metadata execution, real inheritance and reparse enforcement, real directory protection, crash/flush behavior, installed startup and genuine first approval remain **UNRUN**. The smallest later native proof, only after separate authorization, is a private synthetic directory with actual metadata query, protected empty-directory creation, inherited child verification and safe/unsafe admission. It is not a new harness or a prerequisite to author Linux units. Unit success is insufficient for native runtime qualification.

SDET reconciles existing tasks to this design before implementation readiness and performs independent candidate review. Candidate-specific landing/exposure decisions must record unrun Windows/package/first-use risks through the existing status process. The unit-only restriction remains unchanged. Decide a new release version before the PR, without reusing published preview.2 bytes. Publication, installation and activation are separately gated.

No operational action is part of this design. Keep local MCP/TUI disabled, the token absent, and backups, quarantined ownership record, preserved operator key and skill unchanged.

## Source grounding and residual risk

Reuse the completed official-platform research supplied for this change. The established `protection.js` fixed PowerShell query is the mechanism being corrected, not evidence that its old result was safe. The normalized schema and JS policy above are project contracts, not invented Windows API signatures.

| Existing official grounding | Decision it supports |
| --- | --- |
| [Node 24.22.2 filesystem](https://nodejs.org/download/release/v24.22.2/docs/api/fs.html) | Node Windows modes/flags do not prove SID/DACL protection. Existing Node I/O is retained under admitted ancestry, without native pinning claims. |
| [Windows file rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights), [DACL access](https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object), [ACE inheritance](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules) | Empty/null ACL distinction, generic/applicable rights, inheritance and parent/child deletion rules. |
| [File attributes](https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants), [reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points) | Reject every observed reparse attribute, not symlinks alone. |
| [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo), [SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo) | Complete owner/DACL evidence matters. Propagating protection into existing trees is not harmless admission. No new direct ABI is selected. |
| [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew), [CreateDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw) | Creation collision is not ownership, and pathname rechecks do not equal retained native handles. |

Conservative ACL interpretation can refuse customized/enterprise storage. Query latency can exhaust the finite startup budget. Existing metadata cannot establish historical confidentiality or revoke foreign handles obtained before protection. Mitigation is truthful limits, safe-location prerequisites, bounded fail-closed admission and preservation, not a stronger worker or relaxed security. If the selected metadata facilities cannot supply the exact observations, return that concrete missing observation/failure case through the normal owner workflow. Do not invent a compiled fallback or expand cost/security scope.
