# Proceed-owned Telegram setup

Provide private one-time credential setup through the installed Proceed command, then cold broker startup without harness token handling.

## Context and feasibility

This is a proposed design for [the proposal](proposal.md), not implementation or exposure authorization. Product confirmation and the product-owned capability deltas remain pending. The authoritative baselines are [delivery and startup](../../specs/opencode-session-continuation/spec.md) and [npm distribution](../../specs/npm-distribution/spec.md).

The minimal route is technically feasible within the existing same-account protection boundary: extend the protected credential-file route with Proceed-owned interactive input and reuse the existing Windows storage admission. No additional native interface or distribution mechanism is required. This is source-grounded feasibility, not evidence that Windows runtime operation works.

| Source | Finding and consequence |
| --- | --- |
| `src/state/credential-file.js:106-119,349-503` | Windows token-file refusal is unconditional. POSIX provisioning/loading already provides separate storage, create-only writes, file identity checks and token parsing. Removing the refusal alone is unsafe because its file/directory permission checks return without Windows admission. |
| `src/state/protection.js:468-505,577-674,779-833,857-898` | Existing bounded metadata query and admission cover account ownership, complete DACLs, local fixed NTFS, ancestry and reparse refusal. Dedicated directory creation checks inherited protection before changing a newly created empty directory. These mechanisms can admit Telegram credentials without a new helper. |
| `src/harness/operator-key.js:226-309,345-413` | Existing protected key creation/loading demonstrates pre-write and pre/post-read Windows admission. Reuse the policy, not its incidental private decomposition. |
| `src/cli/main.js:466-500,567-592,644-653` | Provisioning currently requires nonterminal stdin. Automatic startup already passes a credential path, not file contents, to the broker. The adapter need not gain a token reader. |
| `src/state/path-trust.js:122-144` | Uncertain Windows created objects are preserved rather than deleted. This remains mandatory. |

Important storage limit: the current directory creator does not turn an ordinary inherited multi-principal Windows ACL into safe storage. It admits the newly created directory before applying protection, so a foreign grant can cause refusal before that step. Supported setup therefore requires an already safe dedicated Windows parent with current-account-only full-access inheritance for files and directories. Documentation MUST explain this prerequisite and the explicit credential-path alternative. Do not promise that the default home path works on every Windows profile. Unsafe parents MUST NOT be repaired by setup. This is the same safe-storage prerequisite as existing Windows state/key setup, not a POSIX-only substitute.

The earlier Windows volume-root query failure remains unclassified. If the shared query refuses on an otherwise intended installation, report a blocked runtime outcome. Do not respond by starting a native-handle, compiler, signing or diagnostic-harness project.

## Goals and bounded outcome

- Ordinary npm installation remains secret-free and noninteractive with respect to credentials. Setup is a separate explicit operator action after installation, never an npm lifecycle hook.
- Windows and POSIX both have a persisted route under their documented safe-storage prerequisites. Refusing every Windows credential operation does not implement this design.
- After supported state, owner, credential and pairing setup, a fresh token-free harness launch uses normal MCP startup and receives a paired Telegram approval on its active waiting call.
- The change can land independently in one PR targeting `main`. It has no stacked parent. Recheck the latest merged affected specs before implementation and archive, and serialize any overlapping contract edits.

Non-goals: a setup wizard replacing all existing commands, `.env` loading, credential-store encryption, installation hooks, login services, automatic migration, overwrite/rotation, storage repair, new native helpers or platform frameworks, native permission bridging, new harness integrations, publication or activation.

Credential persistence alone is enabling work. The first useful outcome includes private pairing and a real active-call Telegram decision after a fresh launch. Unit results cannot establish that outcome.

## Decisions

### 1. Extend the existing provisioning command

The public command SHALL be `proceed-mcp telegram provision [--token-stdin] [--telegram-token-file <absolute-file>] [--state-dir <directory>]`.

- Without `--token-stdin`, require a trusted interactive terminal and use private input owned by Proceed. No automatic prompt is added to `mcp`, `pair`, `serve` or package installation.
- With `--token-stdin`, preserve the existing nonterminal input contract, including terminal refusal and EOF requirement. Do not silently switch input modes.
- No positional token, token option, environment capture or MCP provisioning tool is added. Unsupported options and positional data MUST be rejected without reproducing their values in diagnostics.
- Validate command syntax, initialized state, destination separation, safe ancestry, destination absence and usable private-input mode before consuming token input. A destination collision MUST NOT open or compare its contents. Revalidate at exclusive creation and before any secret write.
- Interactive input SHALL disable echo before consuming secret characters and write only a fixed prompt to the operator terminal, not protocol stdout. It SHALL restore the original terminal mode and detach owned listeners on success, invalid input, EOF, cancellation, timeout or error. If private input cannot be established, refuse without reading input or falling back to echoed input.
- Enter submits one token. Backspace removes the previous entered byte without displaying it. Ctrl+C cancels with no credential write. EOF before submission is failure, not submission. Input admits only the existing non-whitespace ASCII range and 1-4096 token bytes, without trimming or truncation. The interactive deadline is 60 seconds from prompt readiness. The stdin route retains 4098 input bytes maximum, optional LF/CRLF and its 60-second EOF deadline.
- No masking characters, token length, token fragment, raw input event or parser exception containing input SHALL be emitted. Operators must use an unrecorded trusted terminal. Proceed cannot defeat terminal recording or compromised same-account software.

Successful provisioning returns CLI exit 0 and only the credential path plus storage/trust guidance. It asserts local provisioning, not Telegram validity, connectivity, pairing, delivery or approval. It neither starts the broker nor changes existing state or pairing.

| Failure | CLI result |
| --- | --- |
| Invalid syntax/input, cancellation, EOF, input deadline or wrong input mode | `INVALID_ARGUMENT`, exit 2, fixed secret-free guidance |
| Existing destination | `TELEGRAM_CREDENTIAL_EXISTS`, exit 2, no overwrite or comparison |
| Private terminal facility unavailable | `PREREQUISITE_UNAVAILABLE`, exit 3, use a trusted terminal or the explicit stdin route |
| Missing initialized state | Existing `STATE_NOT_INITIALIZED`, exit 3 |
| Protection query unavailable | `PROTECTION_UNAVAILABLE`, exit 4 |
| Unsafe or unverifiable storage/identity | `PROTECTION_UNVERIFIED`, exit 4 |
| Storage operation failure | `STORAGE_FAILURE`, exit 4, unless the existing more specific protection classification applies |

No failure includes raw child output, secret-bearing arguments, terminal contents or environment dumps. Existing MCP startup failure mapping remains unchanged and never becomes a human decision.

### 2. Keep the existing separate credential format and discovery

Default storage remains `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`. Preserve the existing SHA-256 state-path key derivation, including Windows separator/case normalization. Moving state or changing OS account is not credential migration. No new state schema, journal event, database field, key registry or harness setting is required.

The file contains one validated token followed by LF. An explicit absolute `--telegram-token-file` selects a dedicated alternative and must be repeated consistently for provisioning and subsequent cold-start commands. Paths, not secret values, may appear in command arguments and harness configuration. Credentials SHALL remain outside repositories, product state, harness configuration and package installation/prefix directories, including paths that do not exist yet when setup starts. Separation checks must cover the eventual destination, not only an already-existing immediate parent. No search of arbitrary host configuration or secret locations is authorized.

Package upgrades replace code only. They SHALL neither move nor delete the external credential, state, keys, pairing, journal or uncertain artifacts. The operator must keep those paths outside every installation being replaced. Setup SHALL not automatically capture an environment token, adopt an existing credential as a successful create, or rotate a running broker.

### 3. Admit Windows credentials with the shared storage policy

Use the existing metadata-only system query and protection policy for credential directories/files. Preserve its trusted system-tool resolution, restricted child environment, execution-policy preservation, complete observation decoding, depth-ordered ancestry checks, 20-second admission budget and output bounds. Helpers SHALL receive no token. No new platform API semantics are needed for this route.

Supported Windows envelope: Windows 10/11 desktop, trusted standard runtime and inbox query tools, drive-qualified absolute local fixed NTFS paths with persistent ACLs and verifiable metadata. Dedicated credential directories and files SHALL be current-account-owned and grant that account only. Credential directories SHALL pass account-only full access to child files and directories. Ancestor ownership and replacement/security-modification rights retain the shared trusted-principal rules. Ordinary ancestor read/list/traverse/create-only grants do not alone authorize replacement and do not alone require refusal. Unknown or unsupported ACL forms still refuse.

Supported POSIX envelope retains current-account ownership, exact credential directory mode 0700, file mode 0600, protected ancestry and nonredirected local paths. Do not weaken POSIX behavior when sharing Windows logic.

For both platforms:

1. Inspect paths without following redirection. Refuse symlinks/reparse points, unsafe ancestry, invalid path forms, nonregular files and multiple hard links. Windows also refuses network/removable/device paths, alternate data streams and unverifiable ACLs.
2. Create missing dedicated directories one component at a time under admitted parents. Admit each before descending. Do not repermission an existing directory. Require safe inheritance before creating a file, so no secret is written to an initially broadly accessible object.
3. Create the destination exclusively. Validate the opened regular single-link file and admit its protection before writing token bytes. Flush and revalidate protection, identity and ancestry before reporting success.
4. For loading, admit ancestry, directory and file before content access. Compare opened-file identity with the inspected file, validate the opened regular single-link object, and bound the content read to 4098 bytes. Revalidate identity, protection and ancestry before releasing the token to broker startup. Any changed or uncertain observation discards the result.
5. On failure, preserve preexisting or uncertain files/directories. Cleanup may remove only an object still proven to belong to the attempt. In particular, retain uncertain Windows objects and report incomplete provisioning without claiming success. Never replace them on retry.

Repeated snapshots and file identity checks are not a native handle-pinning guarantee. The trusted account, runtime, installed package and OS remain trusted. This design protects against ordinary other accounts under the admitted ancestry, not hostile same-account mutation, administrators, earlier-opened handles or compromised backups. It does not establish encryption, an OS credential store or historical confidentiality. The same disclosures apply to the existing state and operator-key routes. No stronger isolation is assumed to make this change feasible.

### 4. Preserve broker-only loading and startup semantics

Cold automatic startup SHALL retain explicit file > nonempty configured environment token > default file precedence. Absent or exactly empty environment values leave the default file available. A selected-source failure never tries another source. To choose the default persisted route, remove the token from the actual harness launch environment, not merely its JSON configuration. To select a dedicated credential path, supply the same explicit file option. Environment and foreground routes remain supported and are not automatically migrated.

The MCP adapter SHALL pass only the selected file path to the broker. File contents SHALL be opened only in broker startup, never in the adapter, TUI, local readiness probe or metadata helper. A matching healthy secure broker remains reusable without a token source or credential-file read. Changing a file selection or environment value does not change a running broker's token.

The shared 150-second startup budget, authenticated confidential admission on every connection, exclusive broker/poller ownership and supported clean-stop path remain unchanged. A new launch after login or reboot discovers the persisted credential when the operator next starts the harness. No background login/reboot service is installed. Uncertain ownership, conflicting listeners and legacy brokers retain their existing refusal/explicit-stop semantics. Credential setup does not enable disabled integrations or grant decision authority.

### 5. Compose supported first use, do not rewrite authority

The installed first-use path SHALL document ordinary npm installation, protected `init`, `owner add`, private `telegram provision`, `pair` and normal `mcp` startup. Existing safe state uses its existing owner/pairing instead of reinitialization. Windows instructions SHALL include the safe inheritable-parent prerequisite and a consistent explicit-path example when the default location is not admissible. No secret-bearing shell assignment is necessary for the persisted route.

Pairing remains the existing operator-authorized private-chat exchange. Setup itself creates no request, decision or standing approval. Telegram semantics, principal/request capabilities, journal retention, expiry, pending work, keys and native harness permissions are unchanged. Additional harnesses may use the same state and credential selection through normal MCP startup without token provisioning. This does not claim tested multi-harness compatibility or nontransferable agent identity.

## Verification and risk limits

Automated verification SHALL use normal JavaScript/TypeScript unit tooling runnable on Linux. Use controlled terminal events, filesystem observations, clocks and query results to cover private-input transitions/restoration, parser limits, pre-input refusal, create-only races, safe/unsafe Windows admission, protection-before-content ordering, bounded reads, snapshot failure, incomplete cleanup, separation with missing parents, source precedence/no fallback and broker-only path forwarding. Preserve existing durable-work and healthy-reuse assertions. No new ad hoc PowerShell test harness is permitted.

Do not execute native, integration, renderer, e2e, calibration, preflight or live-runtime checks under the current project restriction. Independent review remains required. Units do not prove native ACL enforcement, terminal echo suppression, filesystem race resistance, installed-package behavior, restart/login/reboot discovery, actual Telegram delivery or multi-harness compatibility. Those checks remain deferred and unverified. Candidate-specific landing/exposure risk decisions belong in the status log before their authorized actions, not in an inherited preview.3 acceptance. Owner manual checks after authorized deployment must distinguish provisioning, local readiness, private pairing and actual human outcome delivery.

## Required product-owned deltas and handoff

The product owner SHALL reconcile the complete affected requirements and scenarios against the merged baseline, retaining unaffected scenarios:

- `opencode-session-continuation`: modify `Credential provisioning and loading fail closed` to replace the blanket Windows unsupported allowance with supported safe-storage admission and refusal scenarios. Extend `Automatic startup preserves credential and readiness boundaries` with the operator-invoked private interactive route, cross-platform persistence and token-free fresh launch. Reconcile `First-use and restart preserve the approval workflow` and `Credential limitations and foreground compatibility remain explicit` so persisted setup survives subsequent launches while environment mode still requires fresh supply. Extend `Provisioning and startup prevent token disclosure` to cover private terminal input, value-free argument errors and no automatic capture. Include Windows persisted first-approval, existing-destination, unsafe inheritance, query-unavailable, cancellation and upgrade-preservation scenarios. Preserve the existing Windows environment/TUI requirements rather than replacing them with persisted-only behavior.
- `npm-distribution`: extend `Public package and explicit prerequisites` and `Complete first useful action from empty state` with secret-free installation, explicit installed Proceed provisioning, Windows/POSIX prerequisites, external credential lifetime across replacement and first approval after a fresh token-free harness launch. No lifecycle secret interaction or publication-policy change.

No `telegram-approval` delta is needed. Exact private module structure and terminal event plumbing remain implementation-owned within these contracts. After product confirmation and coherent deltas, test planning can proceed. No implementation or publication authority is conveyed here.
