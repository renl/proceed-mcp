# Automatic broker startup

Make normal MCP startup start or safely reuse one shared broker after explicit operator setup, without passing the Telegram token through the adapter.

## Context and boundary

Parent: [proposal](proposal.md). Product outcomes: [startup delta](specs/opencode-session-continuation/spec.md). Baselines: [portable MCP](../../specs/opencode-session-continuation/spec.md), [Telegram approval](../../specs/telegram-approval/spec.md), and [first use](../../specs/npm-distribution/spec.md#requirement-complete-first-useful-action-from-empty-state).

This change lands independently on `main`, against `f3d60184f03963774ed6a5954bb75331d54918d4`. It has no stacked parent or dependency on the separate agent-skill change. The delivered outcome includes provisioning, cold startup, shared lifetime, readiness, clean stop and instructions. It does not include native approval, another human channel, services/login startup, lock recovery, automatic respawn, credential-store integration, publishing or a new dependency/framework.

The approved storage authority is one explicitly provisioned owner-only file outside repositories, product state and MCP configuration. This is not encryption or isolation from same-account processes, administrators, debuggers or backups. No existing live credential access or provisioning operation is authorized by this document.

### Existing structure and gaps

- `src/cli/main.js` currently starts `serve` in the foreground and makes `mcp` connect only. The five-tool catalog and JSON-RPC contracts remain unchanged.
- `src/state/ownership.js` already creates `broker.lock` exclusively with schema 1 fields `pid`, `port`, `started_at`, `instance`. Acquisition precedes journal open. Release requires the exact acquired bytes. Keep these invariants. Reading a protected record for identity comparison is new, not authority to acquire or repair it.
- `src/broker/portable-runtime.js` verifies protection, acquires ownership, recovers the journal, sweeps expiry and binds before starting one poller. Reuse this assembly. Do not build a second broker or poller implementation.
- `src/broker/portable-server.js` has no authenticated instance-readiness or clean-stop route. Its listener-ready flag alone does not reflect expiry-scheduler failure. Add the narrow lifecycle boundaries below.
- `src/state/protection.js` uses following `stat` checks on POSIX and bounded PowerShell/`icacls` on Windows. POSIX currently checks mode bits, not current-account ownership. These checks alone do not establish the new credential-file/no-redirection contract.

## Decisions

### 1. Operator interfaces and credential selection

The CLI SHALL add the following interfaces. Options contain paths or flags only, never token values.

| Interface | Contract |
| --- | --- |
| `telegram provision --token-stdin [--state-dir <dir>] [--telegram-token-file <absolute-file>]` | Explicit, create-only provisioning. Reads one token from non-TTY stdin. Refuses terminal input rather than allowing terminal echo. Does not start a broker, contact Telegram or pair a human. |
| `mcp --owner <id> [--state-dir <dir>] [--telegram-token-file <absolute-file>]` | Starts availability discovery at adapter launch. Only the broker child reads the selected token file. |
| `pair [--state-dir <dir>] [--telegram-token-file <absolute-file>]` | Ensures the same broker availability before the existing control-authenticated pairing challenge. Allows initial pairing without a manual broker terminal. |
| `serve [--state-dir <dir>] [--telegram-token-file <absolute-file>]` | Existing foreground environment mode when the file option is absent. Explicit file mode when present. Supplying both a nonempty environment token and a file option is invalid, not implicit precedence. |
| `stop [--state-dir <dir>]` | Explicit operator control operation. Authenticates and matches the instance before requesting graceful stop. Never signals a PID from a record. |

`--state-dir`, `PROCEED_STATE_DIR` and the existing home default retain their precedence. File selection is exactly the explicit `--telegram-token-file`, otherwise `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`. `<home>` is the runtime's OS-account home resolution. There is no credential-path environment override, search path, `.env` loading or automatic import from a foreground environment.

`state-key` is the lowercase hexadecimal SHA-256 of the UTF-8 canonical absolute state-directory path. Canonicalization uses the existing directory's real path, removes a trailing separator except at a filesystem root, and on Windows converts separators to `/` and lowercases the path. Other systems preserve case. State must already exist. The key distinguishes state directories, not OS principals or human identity. Moving state changes the default credential location and requires explicit operator provisioning or selection of the prior safe file.

The path override is nonsecret and MAY appear in MCP arguments. It SHALL be repeated consistently for provisioning, pairing and MCP use. No token or credential-path reference is added to `config.json`, the journal or request history. Configuration schema 2 and journal format remain unchanged.

Provisioned content is one nonempty UTF-8 line of 1-4096 ASCII non-whitespace bytes, optionally terminated by one LF or CRLF on input. No BOM, embedded newline, NUL or whitespace is accepted. Store the token plus one LF. This is bounded local input validation, not a claim that Telegram accepts the token. Read at most 4098 input bytes and reject excess. Provisioning input must reach EOF within 60 seconds, with no write on incomplete/invalid input. Instructions SHALL describe a trusted operator-controlled secret source piped to stdin, not a command containing the token, an `echo` example containing a real token, or agent retrieval from existing secrets.

### 2. Protected file lifecycle

Provisioning and broker loading SHALL enforce these conditions before secret content is written or read:

- A local absolute ordinary filesystem path, with no URL, UNC/network share, device namespace or Windows alternate data stream. The Windows drive colon is the only permitted colon there.
- No symbolic link in any path component. On Windows, reject every reparse-point component, including junctions and mounted/redirection paths, not merely links recognized by the runtime. Check existing ancestors before creating children. An unresolved or uninspectable component is a refusal.
- The selected file is outside the canonical state directory and any repository worktree. Inspect ancestors for repository markers without reading repository contents. Reject containment in the running package directory or a known MCP configuration directory, and reject a destination used as an MCP configuration file. The supported default is separate from all of these. An override is an operator assertion that the location is dedicated credential storage, not an MCP settings location. Never search for MCP configurations or secrets to establish this.
- The credential parent is a dedicated current-account-owned directory. POSIX requires directory mode `0700` and regular-file mode `0600`, current effective UID ownership, and a single file link. Windows requires current-account ownership and an owner-only DACL with no foreign or inherited grants. An empty/unverifiable ACL is not proof of usable owner-only access.
- Ancestors above that protected directory must not permit untrusted accounts to replace it. System-owned ancestors are allowed when their permissions protect the path. Do not require system roots to belong to the operator or alter their permissions. Refuse unverifiable protection or redirection.

Create only missing dedicated credential directories and the new credential file. Do not recursively chmod, re-ACL or repair existing directories. Establish and verify the empty directory/file protection before writing token bytes, then flush, close and reverify before reporting provisioning complete. Creation must be exclusive/no-clobber even under concurrent provisioning. An existing destination, including an empty or unsafe one, is never overwritten, truncated, deleted, read for comparison or silently declared provisioned. No `--force`, rotation, deletion or migration interface is added.

On failure, remove only newly created artifacts still proven to be this attempt's exact objects. Preserve replacements, pre-existing entries and uncertain objects. Report incomplete cleanup without printing contents. Do not use the existing replace-by-rename state writer for this create-only secret. A failed write is not successful setup.

Loading SHALL verify path/protection, open and validate the actual regular file identity before content read, and recheck identity/protection before use. Use non-following opens where available, plus ancestor and handle-identity checks. Windows requires the reparse attribute check in addition to runtime link checks. No validation-then-following-read shortcut is acceptable. These checks prevent unsafe configured paths and detectable substitutions, not a promise against a hostile same-account process changing its own files. Platforms/filesystems on which the checks cannot be established fail closed.

Only the explicit provisioning command handles the supplied token for writing. Only the broker process reads the stored token for use. The adapter may compute/pass the nonsecret path but SHALL NOT open the token file or receive its contents by IPC. Automatic startup ignores an inherited Telegram token as a credential source and excludes it from broker-child launch environment construction. It never writes the file itself. Operators must not supply the token to the adapter environment.

The broker keeps a loaded token in memory, not a newly assigned environment variable. ACL helpers and other child processes SHALL receive only required nonsecret environment inputs, including in foreground environment mode. No token, local control credential, owner credential, registration secret or request capability may enter process arguments, startup messages, logs or diagnostics. Do not forward raw child stderr, exception text, helper output, environment dumps or Telegram URLs. Request capabilities retain their existing private tool-result exception only.

### 3. One shared availability attempt per adapter

MCP initialization and catalog operations SHALL remain responsive while discovery runs. Start a single availability attempt at launch after local configuration/principal validation. Valid broker-dependent calls await that shared result before registration or business mutation. Invalid tool arguments still fail before business effects. Concurrent calls do not spawn separate brokers. Failure remains a non-approval tool error, not a fabricated request outcome. A new adapter or explicit `pair` invocation can try again after operator repair. Do not create a periodic supervisor or automatically replay a possibly committed business operation.

Discovery sequence:

1. Verify initialized state, protected configuration and the selected local authority. MCP uses its owner credential, never the control credential. Pairing uses the control credential. Unknown owner or unsafe local state fails before launch.
2. Inspect the protected ownership record and probe the configured `http://127.0.0.1:<port>/v1/ready`. No redirects, proxy or alternative port is permitted. A positive reuse requires the authenticated matching response in section 4 and a stable matching lock read before and after that exchange.
3. A record with an unavailable listener may represent startup in progress. Wait within the same deadline. A malformed, unreadable, mismatched or changing record never authorizes launch/takeover. A listener without a matching protected ownership record is a conflict, not reusable readiness.
4. Only a definite absent record and no responding listener permit launching one broker candidate for this invocation. Races after this observation remain possible. The child SHALL acquire the existing exclusive `broker.lock` before journal recovery or Telegram workers. No second launcher lock is needed. Concurrent automatic and manual candidates may exist briefly, but only the ownership winner opens the journal and starts a poller.
5. An ownership-losing child exits without touching that record or journal. Its adapter resumes matching discovery, rather than treating that child's exit as proof that the winning broker failed. Other definitive child errors are returned redacted. Never continually respawn losing children.

Launch the installed broker entry point from the same package using the current runtime executable, not a shell, `npx`, package download, PATH-selected shim or repository-only file. The automatic child uses explicit file mode, detached lifetime, no inherited terminal/MCP descriptors, and no parent reference/IPC channel that keeps either process alive after startup. Private bounded startup communication, if used, contains only allowlisted classifications and must close. The exact private launch protocol and source-module layout belong to implementation.

Publication of ready service is the ownership handoff: the broker is thereafter shared, even if no caller has registered yet. Adapter close, timeout or loss must never kill it. It survives the last adapter, but is not promised to survive logout, reboot or an external host process-container shutdown. It has no idle-stop timer. After its first availability attempt an adapter does not auto-restart an explicitly stopped broker. A newly launched adapter may start it again.

Broker sharing does not change registration admission. Existing `OWNER_IN_USE` and registration leases still apply, including competing adapters configured for the same owner. Distinct owners can share the broker without sharing request authority. Adapter EOF fences its calls immediately and must not wait for the whole startup deadline merely to close. A detached pre-ready child retains its own finite startup/cleanup responsibility.

### 4. Authenticated readiness contract

Add `GET /v1/ready` on the existing loopback-only listener. Browser-origin rejection and Bearer authentication remain mandatory. Both control and owner credentials may use this read-only route. No request capability or registration is required. An owner sees no other owner's data, request list, pairing identity, state path or secret.

Successful `200` JSON contains exactly:

| Field | Type and meaning |
| --- | --- |
| `schema_version` | Integer `1` |
| `service` | Literal `proceed-mcp` |
| `lifecycle_version` | Integer `1` |
| `instance` | The current acquired lock's 32 lowercase hexadecimal `instance` |
| `pid` | Positive integer, diagnostic only |
| `port` | Configured integer port |
| `local_ready` | Boolean `true` |
| `paired` | Boolean, committed pairing exists |
| `telegram` | Object with exactly `state` and `code`, as below |

`telegram.state` is `disabled` (no client), `starting` (no completed poll observation), `active` (last poll succeeded and processing is enabled), `retrying` (transient poll failure/backoff), or `stopped` (terminal transport fence). `code` is null except for a currently observed failure. Allowed failure codes are `TOKEN_MISSING`, `TOKEN_REJECTED`, `POLLER_CONFLICT`, `TELEGRAM_UNAVAILABLE`, `TELEGRAM_TIMEOUT`, `TELEGRAM_RATE_LIMITED`, `TELEGRAM_REJECTED`, `STORAGE_FAILURE`, `UNKNOWN`. No exception message or platform payload is returned. This is observed local transport state, not evidence of human receipt or future connectivity.

Identity validation requires supported schema/service/lifecycle, exact instance/port and diagnostic PID matching the stable protected lock, plus `local_ready: true`. A PID's existence, TCP accept, unauthenticated `503`, successful spawn or arbitrary `200` is insufficient. Missing lifecycle support in an older foreground broker produces upgrade/restart guidance, not a weaker identity fallback. Matching foreground brokers from this implementation are reusable without any provisioned file.

`local_ready` is published only after protection checks, exclusive ownership, journal recovery, startup expiry flush, bind and final state checks complete, and is withdrawn on stopping or failed expiry scheduling. An authenticated not-ready request returns `503` with the existing schema-1 error envelope and `BROKER_NOT_READY`, `retryable: true`. Failed storage health returns `503`/`STORAGE_FAILURE`, `retryable: false`. Authenticate this route before either response. Missing/invalid credentials return `401`/`AUTH_REQUIRED`. Unknown routes remain `404`, and browser origins remain `403`.

Local readiness deliberately does not wait for Telegram network success or pairing. Pairing must be possible before `paired` is true. Existing authorized retrieval/cancellation/acknowledgement must remain possible during Telegram outages. Report disabled/stopped/retrying Telegram state and incomplete pairing with the applicable setup/repair action. Do not describe local readiness or token syntax acceptance as working Telegram approval. Preserve the existing request route's `NOT_PAIRED` refusal and existing transport failure/delivery semantics. No new Telegram wire operation or second consumer is introduced to test readiness.

### 5. Bounded timing and failure results

One availability attempt has a monotonic 150000 ms readiness budget from the beginning of local prerequisite checks, including all protection checks, probing, child creation and lock-contention waiting. It is not reset per call, child or probe. Startup-dependent calls return by that deadline, or earlier on definitive failure. MCP host timeouts may be shorter and must be documented. Existing 10000 ms local-operation and 32000 ms wait-exchange limits remain separate after availability.

Readiness probes use an absolute maximum of 1000 ms each, bounded response size of 16 KiB, and at most one new probe per 100 ms after the preceding settlement. Abort the actual request/socket at its remaining deadline, including a trickling response. The existing socket inactivity timeout alone does not establish this absolute budget. Check remaining time before starting each helper or phase.

The automatic child receives the remaining startup budget and SHALL not publish readiness after its deadline. Pre-ready failure/deadline initiates only its own runtime shutdown. Reserve a separate 30000 ms cleanup observation budget, so an attempt's resource lifecycle has a 180000 ms maximum observation window. Returning the startup failure does not wait past the readiness deadline. A broker already published ready is shared and is not cleanup-owned by an adapter. An adapter disappearing before readiness does not authorize PID termination or lock deletion. The child either completes within its own deadline or drains its own failed startup.

No timeout is proof of cleanup. If an OS operation or accepted flush cannot finish within the cleanup window, report cleanup unverified and retain uncertain ownership. Never remove the lock while journal work can continue or claim that an arbitrary kernel/filesystem stall is cancellable. No force-kill fallback is part of normal startup. Representative tests must establish finite owned cleanup for successful and injected failure cases.

| Condition | CLI code / diagnostic | MCP mapping and safe action |
| --- | --- | --- |
| Missing initialized state or local authority | Existing prerequisite codes, exit `3` | `BROKER_UNAVAILABLE`, nonretryable until operator runs `init`/`owner add` as applicable |
| Invalid owner/options/path syntax | Exit `2`, `INVALID_ARGUMENT` | Invalid CLI fails before MCP starts |
| Missing/unreadable/empty/invalid token in file mode | Exit `3`, `TELEGRAM_CREDENTIAL_UNAVAILABLE` | `BROKER_UNAVAILABLE`, nonretryable. Run explicit provisioning or select the correct safe path. Do not recommend putting a token in MCP environment. |
| Unsafe/unverifiable path, ownership or protection | Exit `4`, `PROTECTION_UNVERIFIED` | `STORAGE_FAILURE`, nonretryable. Select dedicated protected storage or repair it explicitly outside startup. |
| Existing provision destination | Exit `2`, `TELEGRAM_CREDENTIAL_EXISTS` | No write. Choose another dedicated destination. No automatic overwrite/rotation. |
| Unrelated listener or mismatching readiness | Exit `3`, `BROKER_INSTANCE_CONFLICT` | `BROKER_UNAVAILABLE`, nonretryable. Verify state/port and stop the unrelated service through its own operator interface. |
| Uncertain/existing ownership without verified reuse by deadline | Exit `3`, `STATE_NOT_OWNED` | `BROKER_UNAVAILABLE`, nonretryable. Preserve state/lock and investigate ownership. No deletion advice. |
| Deadline without another more specific classification | Exit `3`, `BROKER_STARTUP_TIMEOUT` | `BROKER_UNAVAILABLE`, retryable. Inspect safe status/startup guidance before a new adapter attempt. |
| Journal integrity or runtime storage failure | Existing exit `4` storage codes | `STORAGE_FAILURE`, nonretryable. Preserve state. |

MCP mappings use the existing `{schema_version: 1, error: {code, message, retryable}}` tool-error shape with `isError: true`. Add no startup error codes to the five-tool vocabulary. Messages contain the fixed failure classification and actionable command templates, not raw paths from remote replies, child output, secret values or a human resolution. Operator CLI diagnostics may name validated nonsecret paths. Reuse discovery happens before file credential loading, so a healthy foreground broker needs no persistent token prerequisite.

### 6. Explicit clean stop and durability

Add control-only `POST /v1/shutdown`, body exactly `{instance: <32-lowercase-hex>}`. Owner credentials return `403`/`FORBIDDEN`, invalid credentials `401`/`AUTH_REQUIRED`, malformed body `400`/`INVALID_ARGUMENT`, and wrong instance `409`/`BROKER_INSTANCE_CONFLICT`. Matching requests return `202` with exactly `{schema_version: 1, instance: <matched-instance>, stopping: true}`. Fence new admission before acknowledging. Repeated requests for that same stopping instance are idempotent while the endpoint can still answer. The lifecycle route remains available to authenticated control during drain. No PID signaling or request capability authorizes shutdown.

`stop` first validates matching readiness/ownership, then sends that exact instance. A `202` means stop accepted, not complete. Within a 30000 ms total command budget it waits for the exact ownership record to disappear and the matching listener to cease. Success exits `0`. Definitely absent ownership and listener are an idempotent already-stopped success. A replacement record or listener, uncertain ownership, inaccessible state or remaining service returns a refusal/timeout, never a force kill. A running stopping instance may be matched through its authenticated shutdown response and stable record even after local readiness is withdrawn. Refusals preserve all state.

Both foreground Ctrl+C and authenticated stop use the existing runtime drain: fence Telegram workers and new business admission, abort poll/wait transports, settle admitted presentation receipts and accepted commits, stop expiry scheduling, close listener, drain/flush/close journal, and release only the exact owned record last. Pending requests are not cancelled by stop. Accepted decisions, exact Respond text, request identities, verifiers and delivery states survive restart under existing expiry/single-resolution rules. No startup, close or stop action acknowledges a human outcome or creates substitute authority.

The command deadline does not permit abandoning a live flush and releasing its lock. If drain remains unresolved, return exit `3`/`BROKER_STOP_TIMEOUT`, preserve ownership and report stop unconfirmed. Closing an adapter only closes its existing registration/wait transports under their existing budget. It does not call shutdown, decrement a broker lifetime counter, cancel durable requests or clear the ownership record.

## Platform grounding and risks

Sources consulted for this design, not runtime proof:

- [Node 24.22.2 child processes](https://nodejs.org/docs/v24.22.2/api/child_process.html#optionsdetached): detached execution also needs independent stdio and unreferencing. Windows and POSIX differ. Process termination is not a portable process-tree cleanup guarantee. Direct runtime execution avoids Windows `.cmd` shell semantics.
- [Node 24.22.2 filesystem interfaces](https://nodejs.org/docs/v24.22.2/api/fs.html): exclusive creation, non-following metadata checks, handle statistics and flush are available. Windows mode bits do not establish POSIX owner-only protection. Use stable interfaces compatible with the existing Node >=24 admission, not newly added experimental APIs.
- [Windows reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points), documentation source commit `804c358a9c4bce679f7de9c1ef714669cb168959`: redirected paths include more than symbolic links.
- [.NET FileAttributes](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileattributes?view=netframework-4.8.1), documentation source commit `b0e445eb311c94a27954d8478b4a6732e1e3b352`: `ReparsePoint` is a file/directory attribute available to the existing Windows helper environment. Do not equate runtime `isSymbolicLink()` alone with the full Windows policy.

The existing Windows helper allows 20000 ms per invocation and can invoke `icacls` below PowerShell. Prior five-second smoke deadlines were shorter than sequential ACL phases. The new readiness budget is a contract choice, not measured Windows performance and not evidence that those failures are fixed. Each helper must fit remaining time, with finite output and tracked resource ownership. Do not launch a helper when no cleanup time remains. Existing helpers copying the whole broker environment must not be reused unchanged for secret-bearing foreground startup.

The known inability to prove absence of transient Windows helper descendants after their parent exits remains unresolved. Before relying on Windows protected provisioning/detached startup, prove the minimal helper's completion and owned cleanup using representative existing facilities. If impossible, report the exact Windows checks BLOCKED and route the gap. Do not infer Windows qualification from Linux success, silently waive cleanup, install containment infrastructure, or enlarge this change into a process-management framework. Missing OS protection mechanisms fail closed without weakening ACL checks. Node >=24 admission remains unchanged, without an all-platform compatibility claim.

## Verification and delivery

Use the existing maintained Node test mechanism and process fixtures. The actual new failures are duplicate pollers, accepting another service as this broker, leaked credentials, premature parent-dependent exit, and unsafe/unfinished file/process cleanup. Mocks alone cannot prove these. First perform a minimal synthetic spike for protected create/load, detached cold startup, concurrent manual/automatic lock contention and authenticated clean stop before broader implementation slices. It needs no new framework, dependency or production-only test endpoint. SDET owns executable criteria and fixture design.

| Product boundary | Required proof |
| --- | --- |
| Provisioning and file authority | Real isolated files: create-only concurrency, current-account/mode or ACL checks, pre-write protection, invalid/empty/oversize input, no-follow ancestor/final symlink and Windows reparse cases, hard-link refusal, separation/default/override selection, identity substitution, read/write failure and exact-owned rollback. Synthetic known-fake tokens only. |
| Cold/shared startup | Actual installed CLI/runtime children: stopped state becomes usable, multiple adapters plus racing manual start converge to one instance/poller, loser never opens journal, catalog stays responsive, and broker-dependent calls respect the shared absolute deadline. |
| Matching reuse | Real authenticated loopback: foreground and automatic reuse, different state/port/instance, same-shaped fake listener, missing/invalid authority, unsupported lifecycle, changing/malformed/stale lock, trickling HTTP and occupied port. Refusal preserves original lock/journal bytes. |
| Lifetime and stop | Real process exit/EOF: last and nonlast adapters close without stopping broker, pending work remains, control stop drains, owner stop denied, stale shutdown target cannot stop replacement, timeout has truthful owned cleanup and no unknown termination. |
| Restart and approval invariants | Existing journal/approval suites plus startup-integrated restart: pending and terminal identities, exact text, expiry, capability/principal isolation and delivery ledger survive. Existing waiting-result correlation and lost-call behavior remain. |
| Secret confinement | Inspect synthetic process inputs/outputs, MCP frames, environment propagation, state files and failure evidence. Adapter never reads the token. Child/helper output and tool errors cannot expose any private authority. |
| First-use instructions/package | Clean installed package: init, owner add, explicit provisioning, automatic `pair`, adapter cold start, protected state, truthful incomplete-pairing/Telegram status, and stop. README/help must replace recurring manual-serve instructions without removing foreground mode. |

No Telegram protocol change is designed. Unchanged poller/wire evidence may be reused by unchanged inputs and assertion scope. New process, concurrency, file protection and lifecycle proof cannot be replaced by that evidence. Test-only synthetic integration seams must not become configurable production Telegram endpoints or auth bypasses. Live Telegram/host checks remain subject to separate access authority and retain BLOCKED status if unavailable. Operator hands-on acceptance follows full program delivery, not an interim development prerequisite or substitute for agent-owned checks. Historical preview exceptions do not waive this change.

Expected implementation areas are CLI parsing/help/dispatch, local-client absolute cancellation, protected credential handling, ownership identity inspection, runtime lifecycle/health assembly, narrow local lifecycle routes, focused tests and README setup/lifetime guidance. Private module decomposition belongs to implementation. No source, tests, README, proposal, capability spec or task file is changed by this design authoring step. Product specs remain PM-owned. Before the single PR's authorized CLI archive, reconcile the delta against current merged specs and finish live change links. Publication/deployment is separately authorized and not implied by landing this change.
