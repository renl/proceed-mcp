# Ordinary Telegram token storage

Remove Telegram-token-specific filesystem protection while preserving private setup, broker-only loading and every state/key authority boundary.

## Context and landing boundary

The [proposal](proposal.md) and [delivery](specs/opencode-session-continuation/spec.md) and [distribution](specs/npm-distribution/spec.md) deltas define the approved behavior change against the current merged capability contracts. Current `src/state/credential-file.js` couples token I/O to protected ancestry, exact POSIX modes and Windows protection/inheritance queries. Those token-specific prerequisites shall be removed, not relaxed to a different ACL allowlist.

This is one independently landable correction into `main`, with implementation, unit tests and matching README in one change PR. There is no stacked parent. The older `fix-credential-preinput-inheritance` work and regression drafts are superseded and shall remain preserved, not resumed. The separate current-release README correction can land independently and is not a dependency. Reconcile any overlapping README edits against merged `main` before landing.

The first useful outcome remains install once, privately configure once, then use normal MCP startup without a token in harness configuration or a separate broker terminal. This design does not claim that outcome has been runtime-verified.

## Decisions

### 1. Token storage is ordinary plaintext

Provisioning and loading shall use ordinary filesystem I/O. They shall not query or enforce token-file or credential-parent ownership, ACLs, inheritance, exact POSIX modes, ancestor write/sticky-bit protection, persistent ACL support, filesystem type or fixed-volume status. They shall not repair permissions, call token-specific chmod, invoke protection queries or require an ACL workaround. Missing credential directories and the exclusive new file shall use ordinary OS creation defaults, without token-specific mode overrides.

Anyone whose OS access permits reading the file can obtain and misuse the token. Proceed provides no encryption, owner-only access, historical confidentiality or protection against local mutation. Ordinary OS access denials, I/O failures and native permission prompts still apply. This exception covers only the Telegram token and its dedicated parents, not the product configuration file inside protected state.

### 2. Keep the existing interface and data

| Contract | Unchanged definition |
| --- | --- |
| Provisioning | `proceed-mcp telegram provision [--token-stdin] [--telegram-token-file <absolute-file>] [--state-dir <directory>]` |
| Default destination | `<home>/.proceed-mcp-credentials/<state-key>/telegram.token`, with the existing canonical-state-path SHA-256 derivation |
| File contents | One nonempty line of 1-4096 ASCII non-whitespace bytes, stored with one LF. Existing optional LF/CRLF input, 4098-byte input bound and 60000 ms input deadline remain |
| Selection | Explicit `--telegram-token-file`, otherwise nonempty configured token environment value, otherwise default file. Absent or exactly empty environment value allows the default file |
| Cold load | Only broker startup reads persisted token contents. Selected-source failure never tries another source |
| Healthy reuse | Reuse the matching healthy secure broker before token selection or token-file access |

Existing absolute local-path syntax remains, including rejection of UNC/device/alternate-data-stream spellings. Removing fixed-volume/NTFS admission does not introduce network-path syntax. Preserve exclusion from repositories, product state, package/install-prefix containers and harness configuration, including eventual destinations below missing parents. No `.env` loader, JSON config, chat-ID authority change, migration, automatic token capture, command rename, installation hook, helper, compiler, signing or configuration framework is introduced.

### 3. Retain only I/O integrity and preservation guards

`verifyCredentialProvisioning` shall still check initialized protected configuration, path syntax, ordinary directory/file types, storage separation and destination absence before token input. Private terminal input shall be established before consuming secret characters. The explicit nonterminal route retains its TTY refusal, bounds and EOF requirement. Neither route falls back to the other.

Existing ancestor traversal may retain nonredirection and directory-type checks to enforce destination separation. It shall not retain `ancestorProtects` or any equivalent owner/mode/ACL admission. Separation checks shall cover normalized paths and resolved existing ancestry, including missing tails. No new native reparse query or adversarial race framework is required.

Provisioning shall create only missing directories and open the destination exclusively. Existing destinations, including a create race, shall not be read for comparison, adopted, overwritten or rotated. Preserve existing handle/path identity comparisons, write/flush completion checks and conservative exact-created cleanup. These identify this attempt's object and prevent false success, not secret access by other principals. Preserve preexisting, replaced and uncertain entries. In particular, do not broaden uncertain Windows cleanup into deletion.

Loading shall retain bounded regular-file reads, required separation and existing handle/path identity comparisons. Observed replacement, loss of separation or incomplete access shall discard the loaded value and fail. Permission or ownership differences alone shall not cause refusal when ordinary I/O succeeds. Remove owner-only and single-link secrecy admission rather than relabeling it as integrity. No guarantee against unobserved hostile mutation is added.

Keep current CLI exit/error compatibility: existing-destination refusal remains `TELEGRAM_CREDENTIAL_EXISTS` (exit 2), missing/malformed selected credentials remain `TELEGRAM_CREDENTIAL_UNAVAILABLE`, and ordinary I/O failures remain storage failures. Existing `PROTECTION_UNVERIFIED` classifications retained for path/type/identity failures do not authorize permission checks. Errors and success guidance shall be value-free and actionable. They shall not direct the operator to prepare account-only inheritance or exact modes. No token enters arguments, harness JSON/environment outputs, diagnostics, logs, journals, request history, helpers or package contents.

### 4. Separate the token caller from shared protection

The minimal production boundary is token I/O in `src/state/credential-file.js` plus token-related help/success text in `src/cli/main.js`. Keep `src/cli/terminal-input.js` private-input behavior and existing broker launch/reuse orchestration unchanged. Private implementation structure remains an implementation decision.

The following inventory identifies the shared callers that must not inherit this exception:

| Shared helper | Token caller to disconnect | Protected callers to preserve |
| --- | --- | --- |
| `path-trust.js`: `assertProtectedAncestors` | `credential-file.js` | `harness/operator-key.js`, `state/ownership.js` |
| `path-trust.js`: `effectiveUid` | `credential-file.js` | `harness/operator-key.js`, and `ancestorProtects` used by protected ancestry |
| `path-trust.js`: `removeExactCreated` | Keep conservative token cleanup if used | `harness/operator-key.js`, `state/ownership.js` |
| `protection.js`: `createProtectedDirectory` | `credential-file.js` | `state/store.js`, including protected credential-directory creation |
| `protection.js`: Windows inheritance/prospective-directory admission | Remove token calls | Preserve shared policy used internally by protected directory creation |
| `protection.js`: `verifyWindowsProtection` | `credential-file.js` | `harness/operator-key.js`, `journal/journal.js`, `state/credentials.js`, `state/files.js`, `state/owner-credentials.js`, `state/ownership.js`, `state/store.js` |
| `protection.js`: `verifyOwnerOnly` | No token-specific bypass | `broker/runtime.js`, `broker/portable-runtime.js`, `state/store.js` |

Paths in the table are relative to `src/`. Shared syntax/platform/path-splitting helpers may remain shared. Do not weaken shared protection functions, add a global protection-disable switch or route control/owner/operator keys through ordinary token I/O. Protected state, configuration, journals, locks/channel keys, local credentials, pairing, private request authority, expiry and single-resolution behavior remain unchanged. Token provisioning creates no human decision authority.

## README and release contract

Ship the README correction with this behavior. Keep ordinary installation secret-free. Explain protected state initialization, transport-principal setup, explicit private token provisioning, authorized private-chat pairing and subsequent normal MCP startup as distinct steps. Provisioning success proves only local persistence, not Telegram validity, human receipt, pairing or approval. Existing safe setup shall not require reinitialization or reprovisioning.

Token guidance shall state ordinary plaintext exposure, no permission preparation/repair, external storage separation and consistent explicit-path selection on later startup. To select the default file, remove higher-priority tokens from the actual launch environment. Preserve private environment/foreground alternatives, secure broker reuse and supported stop/replacement for rotation. A later login/reboot needs no service installation and does not establish verified startup.

Use `0.1.0-preview.5` as the next unpublished candidate version, consistently across existing release metadata. Do not relabel published preview.4 as implementing this change. Primary installation guidance shall identify the current actually released version, with historical preview.1 subordinate. Until preview.5 publication is confirmed, label its behavior as unreleased candidate behavior and distinguish it from the current released flow. Version preparation is not permission to publish, install, activate or merge.

## Verification boundary and risks

Only normal JavaScript/TypeScript unit tests runnable on Linux are permitted. Use controlled I/O and subprocess substitutes, not PowerShell, Windows APIs, native queries, real provisioning, runtime startup, live state or secret reads. Test planning shall cover:

- Token provisioning/loading succeeds with otherwise usable differing owners/modes, inherited/additional-principal access and absent Windows protection evidence. Token paths make no protection-query or chmod calls.
- Missing parents, storage separation, existing destinations/create races, exclusive creation, incomplete writes, observed replacement and conservative cleanup retain their observable outcomes.
- Private-input ordering/restoration, input bounds, secret-free failures, deterministic source precedence, no fallback, broker-only loading and credential-free healthy reuse remain intact.
- Existing protected state/key admission assertions remain enforced. Review the shared-caller inventory above rather than weakening those tests to fit token simplification.
- README/help/success messages disclose plaintext exposure and distinguish candidate behavior, released installation and unverified first use.

Native state/key enforcement, actual terminal privacy, installed first use, login/reboot startup, Telegram outcomes and multi-harness behavior remain deferred and unverified. Unit success and independent review do not substitute for those outcomes or for candidate-specific landing/exposure decisions. The accepted plaintext risk is not an unresolved design decision. No new external platform interface is designed by this change.

There is no data migration or rollback transformation. Existing token files remain readable when ordinary I/O, format and separation permit. Returning to older binaries may restore their permission refusals. Independent review and primary spec-author delta review against the latest merged baseline precede the authorized single CLI archive and change PR merge.
