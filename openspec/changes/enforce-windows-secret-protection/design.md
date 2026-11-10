# Design

## Context

See [proposal.md](proposal.md) for the authorized outcome and [the merged capability](../../specs/opencode-session-continuation/spec.md) for credential separation, startup authority and preservation requirements. This change targets merged `main` at `df2c8d0958676ba8465db8959d6299bd278125e0`. It is independently landable, with no unmerged parent. The product requirements owner authors the capability delta separately. Reconcile that delta with this design before tasks become ready.

The current Windows branches in `credential-file.js`, `path-trust.js` and `ownership.js` skip protection or ancestry checks. `protection.js` invokes a bare `powershell.exe`, changes ACLs through pathname-based `icacls`, and verifies pathname-based `Get-Acl` results. It accepts an empty grant list and cannot bind its result to the subsequently opened object. Some configuration and credential reads precede runtime protection checks. Initialization and rollback can modify existing directories or remove entries without preserving native object identity.

Node's documented Windows filesystem surface does not supply the required SID/DACL operations or a Windows no-follow directory walk. Node `dev`/`ino`, requested POSIX modes, `realpath` equality and repeated pathname ACL checks are not security evidence for this boundary. Existing portable CLI, MCP, journal formats and authority remain unchanged.

## Goals / Non-Goals

**Goals:**

- Deliver working Windows credential provision/load together with the state admission required to make them safe. This is one change and one PR, not a separately released helper foundation.
- Bind protection, identity and content access to native handles. Refuse uncertain results before private authority is consumed or written.
- Keep existing safe state usable without an ACL repair, journal reset or stored-data migration. Preserve the POSIX path.

**Non-Goals:**

- Encryption, an OS credential vault, protection against hostile same-account code, or protection against an administrator/kernel compromise.
- Elevation, privilege enablement, service installation, harness permission bridging, new approval authority, package signing infrastructure or a general-purpose filesystem service.
- Provisioning, activation, installation, publication, recovery or inspection of the operator's preserved runtime material during this work.

## Decisions

### 1. Reuse the Windows PowerShell prerequisite with a narrow native storage worker

Replace the existing ACL script on Windows with one package-owned PowerShell worker using `Add-Type` for the small Win32 interop surface below. It owns the native handles and performs protected storage I/O itself. The Node parent owns product parsing, credential grammar, journaling semantics and authority. No pathname-only approval certificate authorizes a later Node filesystem read or write.

The worker SHALL load a side-effect-free production PowerShell dispatcher separately from its bootstrap/native adapter. Both production and the pure-unit runner call that same dispatcher through the binding below. Loading the dispatcher defines functions only. It does not compile interop, start a process, access storage, open streams or resolve the account. This is internal decomposition of the selected worker, not a second security implementation or a new installed prerequisite.

This reuses the installed helper runtime and child-process isolation already present in the project. The existing TUI Node helper has bounded framing/lifecycle patterns, but has no Windows security capability. Its exchange vocabulary, authority and lifetime MUST NOT be reused as a filesystem API. Reuse pure framing validation where compatible, not its network operations or production dependencies on test artifacts.

Alternatives rejected:

- `icacls`/`Get-Acl` plus Node I/O cannot bind the checked ACL to the used object or safely create it before secret writes.
- A precompiled executable or Node addon could implement this boundary, but would add architecture-specific artifacts or a native build/distribution dependency. Neither is a vendor requirement. They are not necessary for this correction.
- Manual ACL changes or refusing every Windows operation do not deliver protected first use.

The selected route adds packaged interop source and runtime compilation, not an npm runtime dependency, postinstall script, compiler installation or new CI chain. Dynamic interop denied by local policy is an unavailable prerequisite, never a reason to bypass checks. If implementation discovers that this route requires a new installed toolchain or privilege, stop and return that concrete impact before changing route.

**Supported Windows envelope:** Windows 10/11 desktop, x64 Node 24.22.2 or newer Node 24 patch, inbox Windows PowerShell 5.1 with .NET Framework 4.8 and permitted `Add-Type`/P/Invoke, and local fixed NTFS storage with persistent ACLs and native file IDs. This is the correction's supported configuration, not a claim that every configuration is tested. Other Windows architectures, network/removable filesystems, ReFS/FAT/exFAT, emulation and constrained-language environments fail closed as unsupported prerequisites. Non-Windows runtime support remains as previously declared.

The worker's interop source and launcher ship under `src/`, covered by the existing package include rule. Distribution still installs with scripts disabled. Documentation must disclose runtime compilation and policy prerequisites. No source or installed binary is downloaded at runtime. Compiler intermediate files may contain only fixed nonsecret source. The worker accepts no private data until compilation and readiness succeed. The trusted runtime environment must provide a private compiler temporary directory. Do not claim that an in-memory assembly proves the compiler never uses disk.

### 2. Exact account and ACL policy

`account_sid` is the worker process's current Windows user SID, obtained from its process identity, not a path owner, display name, configuration value or caller-supplied SID. The worker and parent run as the same non-elevated account. There is no impersonation or enabled backup, restore or take-ownership privilege.

Dedicated credential/state directories and files SHALL have:

| Property | Required value |
| --- | --- |
| Owner | Exactly `account_sid` |
| DACL | Present, non-null and nonempty |
| Access entries | Ordinary allow ACEs for `account_sid` only, granting `FILE_ALL_ACCESS` after generic-right expansion |
| Deny, conditional, object-specific or unknown ACEs | Refuse |
| Other SID entries | Refuse, including Administrators and SYSTEM on these dedicated targets |
| Directory inheritance | New directories: protected DACL with account allow ACE applying to self, files and subdirectories, without inherit-only or no-propagate flags |
| File inheritance | New files: protected DACL with account allow ACE applying to self only |

Existing inherited account-only grants may be admitted if every effective and inheritable grant meets the same account-only/full-access rule. Inherited status alone is not unsafe. Reject inherit-only grants that leave the object without the required self grant. Extra account-only ordinary full-access ACEs do not require a rewrite. Never convert or repair an existing ACL to achieve admission. In particular, a null or empty DACL is not an owner-only grant.

New objects receive their descriptor in the creation call. Verification occurs on the resulting handle before any content write. `SetSecurityInfo` is not a migration tool here. It MUST NOT change an existing directory or propagate inheritance into existing children. This avoids turning admission into a recursive ACL repair.

Owner-only means protection from other ordinary accounts. Windows administrators and SYSTEM can exercise OS privilege or change the installation outside this application's authority. This is an OS trust boundary, not an added exemption allowing their ACEs on dedicated secrets. Same-account processes can already read these credentials. Identity-bound access nevertheless prevents the application from using a replacement object under an earlier object's assessment.

### 3. Trust ancestry from the volume root, without following reparse points

Accept only drive-qualified absolute DOS paths on a local fixed NTFS volume. Reject drive-relative paths, UNC/device/extended namespace inputs, alternate streams, embedded NUL/CR/LF, `.`/`..` components, trailing-dot/space components and reserved DOS device basenames. Preserve existing credential-path separation rules. Unsupported spelling is not silently normalized into a different target. State selection may resolve its documented relative input once, before this validation. Native identity, not lowercased string prefix alone, determines containment.

Open the volume root and each existing directory component in order with `CreateFileW`, `OPEN_EXISTING`, `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS`, `READ_CONTROL` and attribute/list access. Keep the opened chain alive until dependent operations finish. Do not share delete access on ancestry handles. Refuse sharing conflicts rather than retry through a weaker open. Opening only the final component with `OPEN_REPARSE_POINT` is insufficient.

Every component, including the root and final object, must be non-reparse. Reject `FILE_ATTRIBUTE_REPARSE_POINT` regardless of tag: symbolic links, junctions, mount-point redirection and unknown/cloud tags are all refused. Ancestors must be directories. Files must be disk regular files with link count exactly one. Attribute inspection, owner/DACL inspection and identity inspection all use the opened handle. An unsupported query, unresolved owner or malformed descriptor refuses.

Ancestors need not be account-only. They must prevent an untrusted account from replacing or modifying the selected chain. The only trusted ancestor owners and mutation principals are `account_sid`, local SYSTEM (`S-1-5-18`), built-in Administrators (`S-1-5-32-544`) and the locally resolved `NT SERVICE\TrustedInstaller` service SID. Resolve that service identity locally and fail if it cannot be established when encountered. Do not trust arbitrary services, domain groups or a user merely because its name resembles one of these identities.

For each existing parent/child edge, verify both descriptors:

- A foreign owner or foreign grant of `WRITE_DAC` or `WRITE_OWNER` on either object is unsafe.
- A foreign effective `DELETE` grant on the child or `FILE_DELETE_CHILD` grant on the parent is unsafe. Directory write/append bits mean add-file/add-subdirectory, not delete-child. Creation rights alone do not authorize replacement of an existing child.
- Foreign grants allowing modification of a selected file's data are unsafe. On selected directories, reject foreign effective `FILE_WRITE_DATA`/`FILE_ADD_FILE`, `FILE_WRITE_EA` and `FILE_WRITE_ATTRIBUTES` grants as a conservative redirection/metadata-mutation rule. `FILE_APPEND_DATA` on a directory is `FILE_ADD_SUBDIRECTORY`, which alone does not authorize replacing an existing child. Every selected file additionally satisfies the stricter dedicated-object policy above.
- Expand generic access masks and respect self versus inherit-only flags. Conservatively refuse deny/conditional/object-specific/unknown ACE forms on ancestors rather than infer effective protection from unsupported forms. Ordinary foreign read/traverse/list rights are permitted.

Missing tail components are allowed only for an explicitly creating operation. Create each missing directory with its account-only descriptor, then open and verify it under the already pinned parent before descending. An already-existing entry returned by a creation race is not this attempt's object and must independently pass admission. No unsafe existing directory is re-permissioned. A system volume root is never changed.

Native identity is `{volume_serial, file_id}` from `FileIdInfo`, represented as fixed-width lowercase hex strings, 16 and 32 hex digits respectively. `GetFileInformationByHandle` supplies link count and other metadata, not Node inode emulation. An ID query unsupported by the volume refuses. Keep handles live so an ID is not compared across an unpinned deletion/reuse interval. Check the entire chain's identity/attributes/protection before content access and before a successful result. On a mismatch, discard read buffers and return failure. Do not retry with a newly observed object under the previous authorization.

The no-delete-share chain closes component replacement during ordinary Win32 name resolution. Final object I/O uses its retained native handle, not a subsequent pathname open. This is the prevention mechanism. Rechecks provide additional detection and are not presented as eliminating a race by themselves. Content/ACL mutation by hostile same-account code or privileged OS actors remains outside the declared isolation boundary.

Credential location exclusion is checked against the pinned state/package/configuration root identities and ancestor chain, including ancestor `.git` marker existence. Inspect markers, not repository contents. The worker must not follow a marker link or read configuration directories to discover secrets. Preserve the default state-key algorithm and default filename. Explicit destinations obey the identical policy. An unresolvable exclusion boundary refuses rather than assuming separation.

### 4. Native ABI and handle ownership

This table defines the native boundary, not implementation bodies. Use the Unicode Windows SDK declarations. Interop uses Winapi calling convention, pointer-width `HANDLE`/pointer fields, 32-bit `DWORD` and `BOOL`, byte-sized `BOOLEAN` where the SDK declares it, and correct native alignment on the supported x64 process. A numeric `BOOL` return is not an HRESULT. Capture `GetLastError` immediately only for APIs that specify it. `GetSecurityInfo` returns its own error code. No native pointer or numeric OS handle crosses the pipe.

| Platform operation | Required native contract |
| --- | --- |
| Open/create file | `CreateFileW(path, access, share, security_attributes, disposition, flags, template)` returns handle or `INVALID_HANDLE_VALUE`. Existing objects use `OPEN_EXISTING`, new files use `CREATE_NEW`, never `CREATE_ALWAYS`. Security attributes carry the new descriptor and prohibit handle inheritance. |
| Create directory | `CreateDirectoryW(path, security_attributes)` creates only the final component with its initial descriptor. Already-exists is not ownership proof. |
| Inspect protection | `GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, ...)`. Handle requires `READ_CONTROL`. Validate descriptor/control flags and ACE bytes. Release the returned descriptor with its documented allocator, exactly once. |
| Inspect identity/type | `GetFileInformationByHandleEx(handle, FileIdInfo, ...)`, plus `GetFileInformationByHandle` and file type/attribute checks. Buffer sizes/layout follow the corresponding SDK structures. No `dev`/`ino` substitute. |
| Read/write | `ReadFile`/`WriteFile` on that handle, with actual byte counts checked. Short writes loop, zero progress fails. Read only the requested bounded chunk. |
| Durability | `FlushFileBuffers(handle)` must succeed before a durable acknowledgement. A successful write alone is insufficient. |
| Truncate/rename/delete | `SetFileInformationByHandle` with `FileEndOfFileInfo`, `FileRenameInfo` or `FileDispositionInfo` respectively. Request required rights, including `DELETE` for rename/disposal. Rename uses the verified pinned destination parent and SDK UTF-16 byte length. Never issue an unchecked pathname unlink as cleanup. |
| Release | Close every owned handle exactly once. Ancestors outlive dependent file operations. Failure to close/settle prevents a success result. |

File reads exclude write/delete sharing for the duration of the read. Long-lived journal access excludes other writers and deletion. Read sharing is permitted where required for existing product consumers. New files are exclusive during creation. Directory chains can share read/write access but not deletion. A sharing violation never causes weakening of these flags.

Atomic replacement is limited to existing product-authorized mutable state files, not credentials or ownership records. Write a fresh unpredictable sibling through `CREATE_NEW`, verify it, write/flush/reverify it, then perform the native same-volume rename while the parent chain remains pinned. Verify an existing destination before replacement. Coordinate the worker's own file handles for that replacement, and reopen/verify the published file before it becomes the continuing journal handle. Keep the old identity until publication succeeds. A lost rename acknowledgement is uncertain storage, not permission to repeat or claim a commit. Do not delete a preexisting `.upgrade`/temporary entry to make space.

### 5. Private worker protocol and process trust

The protocol is product-owned and named `windows-protected-storage-v1`. It is not a Windows vendor interface, public CLI or MCP extension. One parent owns one worker for a setup command or the broker's storage lifetime. Operations are serial, with one outstanding request. Setup and clients close after their operation. The broker keeps its journal session until graceful drain completes.

Launch only the absolute inbox `<trusted-SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` from the operator's trusted OS/runtime environment, with `-NoLogo -NoProfile -NonInteractive` and fixed package-owned bootstrap text. There is no PATH, current-directory, shell, registry-command, `pwsh`, user script or executable-override fallback. A trusted installed Node/package and OS installation are prerequisites, as for the existing process boundary. An attacker-controlled executable selection environment is not made safe by asking that executable to attest to itself.

Only validated `SystemRoot`/`WINDIR` and the trusted private compiler temporary-directory settings may enter the explicit child environment. Do not forward tokens, `PATH`, `PSModulePath`, user module hooks, proxies, debug/coverage/preload variables or arbitrary parent environment entries. Resolve framework/system dependencies from the trusted OS installation, not working-directory DLL/module search. Fixed interop imports target OS DLLs only. No elevation, execution-policy bypass, profile loading or network activity. Do not change OS execution policy to make the helper run.

The supported policy prerequisite includes permission to execute every packaged PowerShell script that is loaded, not only permission to compile interop. The bootstrap and dispatcher SHALL be invoked through normal policy-enforced script loading. A fixed bootstrap command may select those scripts, but MUST NOT read their contents and evaluate them as command text to evade a script refusal. The same rule applies to the standalone unit runner. Do not retry denied scripts through inline/encoded text, another runtime or a changed policy scope. Environment filtering MUST NOT silently remove an applicable inherited execution-policy restriction. If the permitted launch environment cannot preserve that restriction, refuse as `PROTECTION_UNAVAILABLE` before authority is sent.

Where effective policy requires signatures, the actual loaded scripts must satisfy that policy's signature and existing trust requirements. Without that prerequisite, worker startup is unavailable and runner assertions are blocked, not behavioral failures. This design does not authorize certificate/trust installation, unblocking files, a signing service or changed operator policy. An unsigned-script refusal alone does not establish which policy scope caused it or require new signing infrastructure. Determine the applicable policy/trust constraint through read-only diagnostics before proposing a material distribution or trust change.

Use parent-created redirected stdin/stdout byte pipes for protocol only, and captured stderr as a zero-output tripwire. PowerShell opens the underlying streams directly, not its formatting/output pipeline. Only those intentional pipe handles are inherited. Storage handles are noninheritable and never handed to later children. The worker starts no child after accepting authority. Framework compilation may start a compiler before readiness, with no secret request available. No transcript/debug/error stream may serialize request objects or raw exceptions.

Framing is a 4-byte unsigned big-endian length followed by strict UTF-8 JSON, without BOM, duplicate keys or trailing bytes. Maximum JSON frame is 81,920 bytes. Payload byte chunks are canonical base64 of at most 49,152 decoded bytes. Check length before allocation. Unknown fields, invalid base64, invalid UTF-8, unexpected IDs/types, unsolicited frames, duplicate replies, partial EOF and nonempty stderr terminate the session. Capture at most 4096 stderr bytes solely to detect the tripwire, then discard them. Never log rejected bytes. Bounded chunks do not impose a new total journal/history quota.

The exact common request is `{v,id,op,args}`, where `v` is integer 1 and `id` is a positive safe integer increasing by one. Replies are exactly `{v,id,ok,result}` on success or `{v,id,ok,error}` on refusal. `ok` is boolean. Errors are exactly `{code}`. No raw native messages, paths, SIDs, descriptors, bytes or exception stacks enter errors.

Before requests, the worker emits exactly `{v:1,type:"ready",protocol:"windows-protected-storage-v1",account_sid:<SID string>}`. The SID must equal the launch account identity established by the worker, never an expected SID from state. No token is sent before ready. The following operation table defines `args` and `result` exact field sets. IDs below are opaque session-local strings, not OS handles. `identity` uses the two fields in section 3. All byte offsets/lengths are nonnegative safe integers.

| `op` | `args` | `result` and semantics |
| --- | --- | --- |
| `directory` | `{path,create}` | `{directory,identity,created}`. Pin/verify chain. `create` boolean permits only missing protected tail directories. |
| `list` | `{directory}` | `{names}`. Metadata-only immediate entry names. Paginate internally if needed, never read contents to enumerate. Protocol frame overflow refuses, not truncates. |
| `open` | `{directory,name,mode}` | `{file,identity,created,size}`. `name` is one validated component. Modes are `read`, `journal`, `create`. `journal` is read/write existing-or-exclusive-create for the journal only. `create` is create-only and initially empty/protected. The parent constrains destinations to the selected state or credential operation. |
| `read` | `{file,offset,length}` | `{bytes,eof}`. At most one chunk. Validate handle and chain before read and after it. No bytes returned on failed verification. |
| `write` | `{file,offset,bytes}` | `{written}`. Admitted writable handle only. Credential writes fit the existing credential bound. Journal serialization remains in Node. |
| `flush` | `{file}` | `{identity,size}` after successful flush and verification. This is the durable acknowledgement, not `write`. |
| `truncate` | `{file,length}` | `{size}`. Journal only, after exclusive product ownership and existing replay's incomplete-tail decision. Requires subsequent flush. |
| `publish` | `{file,directory,name,replace}` | `{identity}`. Same-volume rename of this session's newly created sibling, already flushed. `replace` is false for credentials and ownership. True only for an authorized mutable state replacement. |
| `remove-created` | `{object}` | `{removed}`. Delete through the still-owned file/directory handle only if this session created it and its identity remains established. A directory must be empty with no live dependents. Never recurse or delete a replacement or an uncertain existing object. |
| `close` | `{object}` | `{}`. Close a file/directory capability with no live dependents. |
| `finish` | `{}` | `{}` after all handles settle. Then exit 0 and EOF. |

`directory`, `file` and `object` IDs are decimal strings from a worker-local monotonically increasing counter, never reused in a session. `names` is an array of strings. `created`, `removed` and `eof` are booleans. `size` and `written` are nonnegative safe integers. A stale, wrong-type, foreign-session or closed ID refuses. A directory listing that exceeds a frame is a safe refusal, not evidence of empty state. The selected credential/state names are validated by the Node product caller and again by the worker. There is no arbitrary command, script, descriptor-setting or privilege operation.

The closed native refusal codes are `UNAVAILABLE`, `UNSAFE`, `IDENTITY_CHANGED`, `NOT_FOUND`, `EXISTS`, `IO_FAILURE`, `PROTOCOL_INVALID`, `LIMIT_EXCEEDED`. A failure after a mutation was submitted can have uncertain effects. Do not automatically retry a write, publish, truncate or cleanup after pipe loss or timeout. Preserve uncertain ownership records and durable state.

The production pipe loop SHALL pass decoded requests to `Invoke-ProceedStorageRequest` defined under "Unit seam and proof limits". That dispatcher owns admission, capability lifetime, sequencing and storage decisions. Its native adapter only performs requested operations and reports observations. Neither the adapter nor Node may substitute a pathname-based approval or independently decide that protection is safe. Replies retain the exact protocol above. Injected operations are an in-process production boundary, not additional pipe operations or caller-controlled worker configuration.

Worker startup and each request have a maximum 20,000 ms elapsed budget including cleanup, further capped by an existing caller's remaining startup/stop deadline. Reserve the last 1,000 ms for termination/pipe settlement. There is no lifetime timeout on a healthy idle broker storage session and no renewal of the caller's original startup budget. On timeout, pipe failure or unexpected exit, fence new storage work, fail pending work, kill the worker if needed, and settle streams within that same remaining budget. Worker EOF closes native handles and exits without deleting uncertain objects. If termination cannot be confirmed, report unverified cleanup and do not claim successful teardown.

Private stdout can carry secrets only to the owning parent. It is not CLI stdout. Token provision input travels only through the owning command's non-TTY stdin and private pipe. Token load output travels only to broker startup, never the adapter. Do not pass token values in argv, environment or script text. Parent and worker discard secret buffers promptly without claiming guaranteed managed-memory erasure.

### 6. Runtime inventory and admission order

The Windows backend applies to every credential/state access used by setup, automatic startup, secure foreground reuse and the existing affected commands. It is not sufficient to patch Telegram token loading while the adapter reads an unverified channel key or a configuration selects unverified credentials.

| Consumer/object | Required admission |
| --- | --- |
| `config.json` | Verify state chain and opened file before reading/parsing. Derive owner credential names only from the validated configuration. No pre-verification `loadPortableConfiguration` read. |
| `credentials/`, `control.token`, `owner.<owner_id>.token` and retained applicable origin credentials | Dedicated policy, native handle reads and protected create-only writes. Preserve existing parsing and role separation. |
| `broker.lock` including its channel PSK | Protected create-only publication and native protected reads. Existence alone still blocks ownership acquisition without reading its bytes. Existing, malformed, stale or uncertain records are never deleted or taken over. |
| `journal.log` and an authorized replacement | Verify before opening/replay. Use one native journal handle for read, append, flush and incomplete-tail truncation. Preserve formats 2/3, sequence/digest rules and durable-before-effect semantics. |
| Telegram credential | Separate admitted directory, native bounded file read, unchanged 1-4096 ASCII token grammar and at most 4098 input bytes. Check opened-handle size before reading. Never allocate/read the whole file without that bound, and refuse growth/size mismatch rather than truncate it into a valid token. Only broker startup loads it. |
| Operator key path through the shared credential/path helpers | Apply the same Windows target/ancestry checks without changing enrollment or key format. Preserve the key, not regenerate it during correction. |

Order for startup is: validate syntax and runtime prerequisites -> admit/pin state chain -> protected configuration read/parse -> metadata admission of required existing objects -> acquire exclusive product ownership where starting a broker -> protected local credential and broker-only Telegram credential reads -> journal replay/recovery -> existing authenticated listener/readiness -> Telegram workers. No readiness or outbound Telegram work precedes the applicable admission. A matching healthy secure foreground broker may still be reused without opening a persisted Telegram credential.

All Windows state I/O in `store`, `credentials`, `owner-credentials`, `ownership`, `files`, `Journal` and their setup/runtime/CLI callers must go through the admitted backend for the affected objects. Preserve existing public function results and product schemas. The backend is not a second authority store. Missing metadata is not equivalent to a safe object, and an `ENOENT`-style result is accepted only when the native result actually establishes absence under the pinned parent.

Initialization first checks admitted state-directory metadata and emptiness, without parsing unverified configuration. Existing nonempty state refuses unchanged. An existing empty state directory must already satisfy protection. Create missing dedicated directories with descriptors at creation, then create protected credentials/config/journal before writing their contents. Never recursively repair or recursively delete an existing tree. Rollback removes only this attempt's still-owned files and proven-created empty directories. Preserve unknown entries and report incomplete cleanup.

For ownership release, compare this instance's record bytes on the retained admitted object before deleting that exact created object. Product ownership is separate from worker storage handles: native access never authorizes takeover of a `broker.lock`. On worker failure the broker withdraws readiness and stops effects, preserving the lock if safe release cannot be established. A disk flush or response loss remains uncertain durability, not success.

### 7. Stable errors and safe next actions

Keep the existing CLI exit contract and public startup/MCP error mapping. Add no public success status, approval result or token-bearing error. The mapping below applies after syntax validation:

| Condition | CLI classification | Fixed next action |
| --- | --- | --- |
| Missing runtime, unsupported Windows/filesystem, denied interop, worker unavailable | Exit 4, `PROTECTION_UNAVAILABLE` | Use the documented supported Windows runtime/storage and policy. Do not bypass policy or disable verification. |
| Unsafe owner/DACL/ancestry, reparse/link/type, identity change, malformed protocol or unverifiable result | Exit 4, `PROTECTION_UNVERIFIED` | Stop startup. Choose a new dedicated safe location or have the operator assess storage offline. No automatic repair. |
| Missing/empty/malformed/unreadable Telegram credential after otherwise safe admission | Exit 3, `TELEGRAM_CREDENTIAL_UNAVAILABLE` | Provision from a trusted source to a new safe destination. Unreadability that prevents protection assessment remains `PROTECTION_UNVERIFIED`. |
| Credential destination exists | Exit 2, `TELEGRAM_CREDENTIAL_EXISTS` | Choose another destination. Never overwrite the existing file. |
| Existing ownership record | Existing `STATE_NOT_OWNED` or existing secure-reuse conflict mapping | Preserve the record and use the existing documented operator action. |
| Admitted ordinary I/O/flush failure | Exit 4, `STORAGE_FAILURE` | Stop the operation and preserve uncertain durable work. No approval or delivery claim. |

Do not publish child stderr, raw Win32/.NET/PowerShell errors or error causes. Existing context-specific credential/configuration integrity codes remain where their validated parsers already define them. A secure ownership read whose protection fails retains the existing `BROKER_INSTANCE_CONFLICT` public mapping rather than downgrading to an ordinary transport failure. Do not make a protection refusal retryable by changing a public error mapping.

## Risks / Trade-offs

- Native interop and runtime compilation are not proved by JavaScript mocks. Mitigation: source-grounded ABI review, pure-unit boundary assertions now, explicit real-boundary UNRUN records and candidate-specific landing/exposure decisions. No signing or new harness chain is imposed.
- A conservative ACL subset can reject enterprise/custom storage that Windows itself could access safely. Mitigation: document the exact supported policy and choose new dedicated storage. Never auto-repair old data or relax checks to obtain availability.
- PowerShell startup adds latency to cold admission. Mitigation: one worker per command/runtime, chunked I/O and the original startup deadline. No unbounded retry or deadline extension.
- Worker failure can leave a protected partial file, an uncertain commit or an ownership record. Mitigation: handle-bound cleanup only when provable, closed error mapping and preservation. Availability never authorizes deletion or recovery.
- Native rename and flush behavior, DLL loading, compiler policy, real ACL inheritance and cancellation remain unverified until exercised on Windows. The design does not turn official API availability into implementation or package qualification.

## Migration Plan

1. Implement the smallest useful vertical route: supported worker startup, the shared production dispatcher exercised with fake native operations, protected directory/file creation and token provision/load, plus configuration/local-credential/ownership admission needed to reach cold startup safely. This internal unit is not a refusal-only release or an independently shipped helper layer.
2. Complete the same Windows backend wiring for journal and existing mutable-state operations before this change lands. Preserve current journal bytes and schemas. Retain all non-Windows safeguards and foreground environment-token behavior. Internal ordered units are checkpoints in this one PR.
3. Unit-test the actual PowerShell production dispatcher with the in-memory native binding below. Node backend/transport units use a fake worker exchange separately, not a JavaScript model of Windows admission. Independent review covers the combined native boundary and decomposition before implementation readiness, and reviews the integrated candidate afterward.
4. Prepare fresh `0.1.0-preview.3` release metadata/guidance in the authorized implementation scope. Never replace preview.2 bytes. The requirements owner reviews the delta against the latest merged capability before the authorized CLI archive inside this change's single PR.
5. Installation, provisioning, activation, publication, real Windows API execution and compilation are not authorized by this design. Keep the existing disabled local integrations, absent token, backups, quarantined lock and preserved key/skill unchanged. No rollback to the unsafe preview.2 Windows path is supported. A rollback keeps Windows use disabled and preserves state, rather than rewriting journal history or weakening admission.

### Unit seam and proof limits

#### Callable production binding (WIN-UNIT-SEAM-01)

Select one route: a maintained standalone PowerShell pure-unit runner loads the production dispatcher and injects in-memory operations. No duplicated JavaScript admission model is permitted. The following callable names and value contracts are normative for the test/production binding. Source filenames, private helpers, state representation and native interop classes remain implementation-owned.

| Callable | Contract |
| --- | --- |
| `New-ProceedStorageSession -NativeCall <scriptblock> -NowMs <scriptblock>` | Returns one opaque session value. `NativeCall` accepts positional `(operation, arguments)` as defined below. `NowMs` takes no arguments and returns monotonic nonnegative integer milliseconds. Construction stores bindings only and performs no native calls. |
| `Initialize-ProceedStorageSession -Session <session> -DeadlineMs <integer>` | Calls `account` once, establishes the account identity and returns the section 5 ready object, or a local refusal `{code}` with no ready object. No private request is accepted before success. `DeadlineMs` is the absolute end of this attempt in the injected clock domain. |
| `Invoke-ProceedStorageRequest -Session <session> -Request <decoded request> -DeadlineMs <integer>` | Executes exactly one section 5 request synchronously and returns exactly its success/refusal reply. Request IDs, capability validity, admission and mutation order are enforced here. All storage effects go through `NativeCall`. No output other than this return value is emitted. |
| `Stop-ProceedStorageSession -Session <session> -DeadlineMs <integer>` | Settles retained capabilities through `close`, without deletion or mutation retry. Returns `{settled:<boolean>}`. False prevents successful finish/teardown. Also used on worker EOF/failure. Repeated stop must not double-close. |

Only the production bootstrap supplies the real native adapter and real monotonic clock. The dispatcher must not acquire a default native binding, dynamically compile code or fall back to filesystem cmdlets. The production pipe loop and unit runner both initialize and invoke these exact functions, not wrappers with separate admission logic. Request deadlines include cleanup and preserve section 5's reserved settlement budget. Node retains process termination, stream settlement and worker-loss fencing responsibility. Clock injection proves deadline decisions, not native-call cancellation.

#### Native call and observation contract

These are project-owned normalized operations, NOT new Win32 APIs or substitutes for section 4's SDK declarations. `NativeCall` returns exactly `{ok:true,value:<operation value>}` or `{ok:false,error:{kind:<kind>}}`. The closed `kind` set is `unavailable`, `unsafe`, `identity_changed`, `not_found`, `exists`, `io_failure`, `invalid_observation`. Their dispatcher codes are respectively `UNAVAILABLE`, `UNSAFE`, `IDENTITY_CHANGED`, `NOT_FOUND`, `EXISTS`, `IO_FAILURE`, `UNSAFE`. Binding exceptions map to `IO_FAILURE`. Malformed values and missing required observations map to `UNSAFE`. Both refuse without raw error output or subsequent content access. Request/framing errors remain `PROTOCOL_INVALID`, bounds errors `LIMIT_EXCEEDED`, and elapsed-deadline refusal is `IO_FAILURE`. Success never implies policy admission.

Arguments and values below are exact field sets. Integers are nonnegative and exactly representable. Masks/flags are unsigned 32-bit integers. SIDs are canonical SID strings, not display names. Bytes are in-memory byte arrays, not text or PowerShell formatted output. `handle` is an opaque adapter-owned token, not a pathname or pipe capability. Production maps it privately to a live native handle. Fakes use virtual tokens. Handles must not be silently reopened or rebound. Empty operation values are `{}`.

| Operation | Arguments | Success value / native binding |
| --- | --- | --- |
| `account` | `{}` | `{account_sid,trusted_installer_sid}`. Current process identity and locally resolved service SID. The latter is a SID or null, which cannot authorize an encountered service owner/grant. No caller-provided account identity. |
| `volume` | `{root}` | `{drive_type,filesystem,persistent_acls}`. `drive_type` is `fixed` or `unsupported`, `filesystem` is the observed name, `persistent_acls` boolean. Only fixed NTFS with persistent ACLs proceeds. |
| `open` | `{path,access,share,disposition,flags,security}` | `{handle}` from `CreateFileW`. `access`, `share`, `flags` are exact requested masks. `disposition` is `OPEN_EXISTING` or `CREATE_NEW`. `security` is null for existing objects or the descriptor intent below for exclusive creation. No returned success may conceal an already-existing create collision. |
| `create-directory` | `{path,security}` | `{}` from `CreateDirectoryW`. Existing entry is `exists`, never successful creation. The dispatcher then opens/verifies the child under its pinned parent. |
| `inspect` | `{handle}` | `{identity,kind,attributes,link_count,size,security}`. Uses the handle queries in section 4, including `GetSecurityInfo`. `kind` is `directory`, `regular` or `unsupported`. `attributes` is the raw attribute mask. `identity` has section 3's fixed-width hex fields. `security` is the descriptor observation below. All queries must succeed for a success value. |
| `list` | `{handle}` | `{names}`. Metadata-only immediate names from the retained directory, no content reads or link traversal. A queried absent entry is not synthesized from an empty/error result. |
| `read` | `{handle,offset,length}` | `{bytes,eof}` from handle-bound `ReadFile`. Byte count is the array length, at most `length`. `eof` is boolean. |
| `write` | `{handle,offset,bytes}` | `{written}` from handle-bound `WriteFile`, at most the supplied byte length. Short/zero progress decisions belong to the dispatcher. |
| `flush` | `{handle}` | `{}` only after `FlushFileBuffers` succeeds. |
| `truncate` | `{handle,length}` | `{}` using `FileEndOfFileInfo`. |
| `rename` | `{handle,parent,name,replace}` | `{}` using `FileRenameInfo` and the retained destination-parent handle. `replace` is boolean. Success is not a continuing published-handle verification. |
| `dispose` | `{handle}` | `{}` using `FileDispositionInfo` on the retained object. The dispatcher first proves session creation, identity and dependency/emptiness conditions. |
| `close` | `{handle}` | `{}` only after native release succeeds. No second native close attempt on an uncertain release. Uncertain settlement cannot report success. |

Descriptor creation intent is exactly `{owner_sid,protected,entries}`, with `protected:true` and `entries` an array of `{sid,mask,flags}` ordinary allow ACEs. The dispatcher derives it from the established account and section 2, never from request fields. The adapter marshals that intent into noninheritable security attributes for creation, without editing an existing descriptor.

Descriptor observation is exactly `{owner_sid,control,dacl,aces}`. `owner_sid` is a resolved SID. `control` is the raw descriptor control mask. `dacl` is `absent`, `null` or `present`. `aces` is an ordered array of `{type,sid,mask,flags}`, empty for absent/null DACLs. `type` is `allow`, `deny`, `conditional`, `object` or `unknown`. Only ordinary allow/deny ACEs carry a resolved `sid` and integer `mask`. Other types carry null for both and are refused, not flattened into ordinary allows. Malformed bytes or unresolved ordinary ACE SIDs are `invalid_observation`. Empty present DACLs remain observable as `present` plus an empty array. Generic mask expansion, self/inheritance applicability, ancestor mutation rights and dedicated-object admission are dispatcher decisions, never injected `safe` booleans. Raw native descriptor allocations are released inside the adapter before returning copied observations.

The dispatcher retains handle/identity relationships across calls, opens every component with the section 3 flags, and obtains fresh `inspect` results at required admission/recheck points. A fake may change observations between calls to prove substitution refusal. Native errors only establish absence/collision when the corresponding real operation establishes it under the pinned parent. Adapter error translation must not infer absence from access denial or an inspection failure. Before successful read disclosure, flush acknowledgement, publication or removal, the dispatcher enforces the applicable identity/protection checks and lifetime rules. Mutating errors never imply no effect or authorize retry. Directory creation followed by an unprovable open/identity remains uncertain cleanup, not a pathname deletion opportunity.

#### Runner limits and canonical coverage

The maintained pure-unit entry loads only side-effect-free production policy/dispatcher definitions and test-owned fakes/assertions. Starting the standalone PowerShell unit runner is allowed. It MUST NOT launch the application worker/helper or another native process, invoke Win32, `Get-Acl` or `icacls`, compile `Add-Type`/native code, access runtime state, perform filesystem lifecycle operations or network I/O, or run integration/harness checks. Loading source/test files and reporting assertions are runner mechanics, not permission to create native test objects. Use synthetic bytes, an in-memory clock and a call ledger containing virtual handles. Tests assert replies, requested native arguments, forbidden calls, ordering and settlement, not private session fields.

PowerShell dispatcher units are the canonical proof of Windows admission and storage sequencing. Node units exercise actual production framing, launcher selection/environment construction through fake process bindings, worker transport/loss handling, product admission order and error mapping. They do not duplicate ACL policy as a second implementation. Test-only types/fakes are never production dependencies. Static production wiring review confirms that the worker invokes the same dispatcher and binds every listed native operation to section 4's implementation. Unit ledgers prove requested masks/observations and observable decisions, not real native marshalling or enforcement.

Required unit assertions cover successful protected creation/load, no private I/O before handle protection, non-null/nonempty target DACLs, owner mismatch, foreign/unknown ACEs, inheritance flags, ancestor replacement rights, all reparse tags, hard links, root handling, component identity changes, exclusive-create collisions, partial writes, flush failure, exact-handle cleanup, secret-free errors, protocol limits, deadlines and worker-loss fencing. Exercise the affected configuration-before-read order, ownership preservation, journal durable-before-effect order, foreground reuse without token load and unchanged POSIX behavior. Use synthetic bytes and virtual native handles only.

The smallest real-boundary spike, when separately authorized, is a throwaway account-private directory: create a protected synthetic file, inspect its actual SID/DACL/ID, read the same handle, demonstrate a reparse/foreign-grant refusal, then remove only the proven-created objects. It is not a new framework or a reason to run a compiler now. This spike and real Windows provisioning/loading, actual substitution/sharing behavior, crash/flush durability, worker cleanup, packaged startup and first human approval are **UNRUN** under the current unit-only policy. Unit tests prove decisions against modeled observations, not the observations, ABI marshalling, OS enforcement or installed behavior. Any landing/exposure acceptance must identify these candidate-specific residual risks through the existing status record. No feature-ready or release-ready claim follows from this artifact.

## Source Grounding

Official documentation defines native behavior. The research supplied for this change is reused. The selected product policy, worker protocol and supported envelope are design decisions, not vendor guarantees. API minimum versions below are availability floors, not the supported product OS floor. Windows SDK declarations are the ABI authority.

| Source | Grounded fact / version |
| --- | --- |
| [Node filesystem, 24.22.2](https://nodejs.org/download/release/v24.22.2/docs/api/fs.html) | Windows flag limitations and lack of the required DACL/SID surface. Do not infer native security identity from undocumented Windows inode behavior. |
| [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo) / [SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo) | Handle security, `READ_CONTROL`, returned descriptor ownership and inheritance side effects. API client minimum XP, server 2003. |
| [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) / [CreateDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw) | Dispositions, sharing, initial descriptors, final-component reparse flag and directory handles. Client XP, server 2003. |
| [GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle) / [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex) / [information classes](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ne-minwinbase-file_info_by_handle_class) | Native handle metadata/identity. First API client XP/server 2003. Ex API client Vista/server 2008. The information-class documentation places `FileIdInfo` support at Windows 8/server 2012, below this design's OS floor. |
| [Attributes](https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants), [hard links/junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions), [reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points) | A symbolic-link-only test does not reject every redirected object. |
| [File rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights), [DACL access](https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object), [inheritance](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules) | Null DACL behavior, parent delete-child rights and ACE applicability. |
| [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw) | Executable search and handle inheritance risks. Client XP/server 2003 API floor. Node remains the launcher, not a new direct process-creation ABI. |
| [Add-Type, PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type?view=powershell-5.1) | Explicitly supports P/Invoke and compilation of interop into an in-memory assembly. Documentation source revision `5b129a73fbe761fc12516c5f9776700daa0aa8a4`. This does not promise zero compiler disk intermediates. |
| [ReadFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-readfile), [WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile), [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) | Handle I/O and explicit durability. Client XP/server 2003 floors. |
| [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle), [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) | Handle-bound mutation and rename layout/rights. Client Vista/server 2008 floors. Use SDK layout, not a copied rendering of the documentation's conditional structure members. |

Sources establish interface semantics, not successful execution. No Windows API, compilation, build, runtime or test was executed to author this design.
