## Why

Operators need to install Proceed, configure Telegram once and use normal MCP startup without managing token-file security prerequisites. The current owner-only storage contract makes credential setup depend on platform-specific protection checks, including Windows inheritance checks that have blocked first use. The user explicitly accepts an ordinary plaintext token file with no special file protection.

### Direction Check

Subject: the operator installing and configuring Proceed. Desired outcome: one-time Telegram setup usable across supported harnesses without recurring token entry or a separate broker terminal.
Problem: token-specific permission admission blocks that setup. Removing those checks addresses the operator's problem, not approval-state security or human decision authority.

## What Changes

- Keep the existing separate token file, explicit installed-Proceed provisioning and broker-only loading. Treat that file as ordinary plaintext on Windows and POSIX, not as protected credential storage.
- Remove token-specific ACL, owner, inheritance, exact-mode and local-fixed-NTFS admission requirements. Do not inspect or repair permissions, run chmod repair or require a special credential parent for the token file. Ordinary OS access controls, I/O errors and native permission prompts still apply.
- Preserve private terminal input, explicit bounded nonterminal stdin input, value-free errors, exclusive creation without overwrite, storage separation, source precedence, no `.env` loading and healthy-broker reuse without credential access.
- Keep protected approval state, journals, control/owner credentials, channel and operator keys, private request authority, pairing and human decision rules unchanged. Ordinary file identity and destination checks remain for correct I/O and nonreplacement, not as a substitute protection gate.
- Ship a matching README with the implemented install/configure/start flow and exact source version. Require checking that version's npm availability before installation, without claiming publication or attributing new behavior to an older release. Keep historical release evidence in its existing records rather than making the README a release history. State plainly that anyone whose OS access permits reading the file can obtain the Telegram token. Do not imply encryption, account-only access or a credential store.

### User Stories

- As an operator, I want to install Proceed and privately provision Telegram once, so that later supported harness launches use the same credential without token re-entry.
- As an operator, I want setup instructions that match the shipped behavior and explain plaintext exposure, so that I can configure Proceed without unnecessary permission preparation or misleading security claims.

### Acceptance Outcomes

- From an empty installation, supported setup creates protected state, a transport principal, the separate plaintext token file and authorized private pairing. A fresh token-free harness launch can complete the first waiting-call approval without a manual broker terminal.
- An otherwise usable token file or parent is not refused because other OS principals have access, ownership differs, inheritance is enabled, exact POSIX modes differ or NTFS-specific protection evidence is unavailable.
- Existing destinations are never overwritten or adopted by provisioning. Missing, empty, invalid or unreadable selected sources fail with secret-free guidance and no fallback or invented human outcome.
- Existing configured state, keys, pairing and durable work remain usable without reinitialization. Token-file simplification does not weaken their protection or change decision authority.
- README instructions and risk disclosures match the implemented flow. Unit evidence and independent review do not become claims of installed first use, native terminal privacy, cross-harness qualification or Telegram delivery.

### Boundary and Landing

This is one user-visible setup correction, independently landable into `main` with its implementation and README in one change PR. It is not unexposed foundation work and has no dependency on the older credential-inheritance fix or separate README PR. The earlier `fix-credential-preinput-inheritance` approach is superseded for this outcome. Its proposal and regression records remain untouched.

Excluded: new configuration schemas, command renames, `.env` loaders, chat-ID authority changes, migration frameworks, installation hooks, native helpers, compilers, signing or configuration frameworks. No publication, deployment, automatic service, permission bridge or broader compatibility claim is authorized by this proposal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: ordinary plaintext token-file provisioning/loading, retained source and authority boundaries, truthful risk guidance and empty-state first use.
- `npm-distribution`: installed first-use and packaged README instructions consistent with ordinary token storage and current-release installation guidance.

## Impact

The accepted security change is limited to the Telegram token file and its dedicated credential parents. Any OS principal able to read that file can obtain and misuse the token. Proceed does not prevent that access or promise protection against file mutation. This does not make the token a Proceed pairing, request capability or human decision credential.

Implementation must separate token-file handling from protected state/key handling wherever they currently share protection machinery. No stored-data migration or credential rotation is required. Existing files remain usable when ordinary access, format and separation checks succeed. Verification remains subject to the project's unit-only restriction, with runtime outcomes unverified until permitted evidence exists.

### Related Artifacts

- Current contracts on merged main: [delivery and setup](https://github.com/renl/proceed-mcp/blob/main/openspec/specs/opencode-session-continuation/spec.md), [distribution](https://github.com/renl/proceed-mcp/blob/main/openspec/specs/npm-distribution/spec.md).
- Proposed deltas: [delivery and setup](specs/opencode-session-continuation/spec.md), [distribution](specs/npm-distribution/spec.md).

### Primary-author finalization review

Both capability deltas are accepted against the merged-baseline contracts at `831b714158e9759be012e2826c75140bbd26e757`. All six modified requirements retain every baseline scenario name. Token-specific protection is intentionally removed, while protected state/key admission, private input, source precedence, no overwrite, broker-only loading, pairing and human authority remain unchanged. No conflicting requirement was identified. The accepted source-version README presentation supersedes the earlier released-version-first wording, without authorizing publication or claiming availability.

The two reported strict-validation introductory-prose warnings are advisory and retained. Ordinary validation was reported valid. Strict validation was not passed. This content review runs no commands and does not substitute for final CLI validation or fresh-head CI. Installed first use, native state/key enforcement, terminal privacy, login/reboot, Telegram delivery and multi-harness outcomes remain unverified. Final archive, CI, merge and release evidence belongs in the live status record or change PR, not in the archived folder.
