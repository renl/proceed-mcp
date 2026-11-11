# Proposal

Give npm-installed Proceed a private, one-time Telegram credential setup that is independent of the MCP harness.

Status: Product scope confirmed. Primary spec-author review accepts both capability deltas for CLI archive. Runtime outcomes remain unverified. Delivery authority and candidate-specific risk decisions are recorded separately, not granted by this proposal.

## Why

Published preview.3 requires Windows operators to supply the Telegram token to the trusted launch environment for each fresh broker start. That couples Proceed's secret handling to how a harness or its background service starts. The existing protected-file route is POSIX-only, so it does not meet the Windows operator's one-time setup goal.

Proceed should own credential setup and later broker loading. Operators should install the ordinary npm package without secrets, explicitly configure Proceed once, then use normal MCP startup without teaching each harness how to supply the Telegram token.

### Direction Check

Subject: Proceed's credentials and installation. Desired outcome: one-time Proceed-owned setup reusable by supported harnesses.
Problem: launch-environment token handling ties the secret to the harness. This change moves setup and durable credential use into Proceed, not into another harness-specific launcher.

## What Changes

- Add an explicitly operator-invoked private setup path after ordinary, secret-free npm installation. Secret entry belongs to the operator, not an agent-facing MCP tool or automatic startup prompt.
- Persist the token in separately protected, owner-only credential storage outside the npm package, repositories, product state and harness configuration, including JSON environment entries. Package replacement must not remove that credential.
- Make that configured credential available on subsequent cold broker starts, including a fresh launch after login or reboot, without token re-entry, a token in the harness environment, or a separate broker terminal. Only broker startup loads the persisted token. This does not add automatic login or reboot services.
- Deliver a practical Windows setup and fresh-launch outcome as well as preserving supported POSIX behavior. Refusing every Windows persisted-credential operation does not satisfy this change.
- Preserve explicit-file > nonempty environment > default-file precedence, no fallback after selected-source failure, healthy-broker reuse without a token source, and the existing environment and foreground routes. Document how an operator selects the persisted route without a higher-priority environment token. Do not automatically capture or migrate an environment token.
- Preserve the `.env` loading prohibition, token nondisclosure, helper environment filtering, same-account trust disclosures, storage protection, authenticated local admission and broker ownership safeguards. Unsafe or unverifiable storage must refuse before secret reads or writes, with secret-free guidance, not automatic repair.

### User Stories

- As an operator installing Proceed from npm, I want to enter my Telegram token privately into Proceed once, so that I can later launch my MCP harness without supplying that secret again.
- As a Windows operator, I want the same supported setup outcome without weakening credential protection, so that the feature is useful on my installation rather than POSIX-only.

### First Useful Outcome and Acceptance

The first useful outcome is an npm-installed Proceed completing a Telegram approval after one-time setup and a fresh, token-free harness launch. Credential storage alone is enabling work, not delivered user value.

- Given an empty installation with no credentials, state, owner, pairing, requests or decisions, ordinary npm installation requires no secret and creates no pairing, request or approval.
- Given the documented external prerequisites, the operator can use supported Proceed setup to create required protected state, a transport principal, separate credentials and authorized private-chat pairing without editing stored data or harness secrets.
- Given completed setup on supported Windows storage, a safely stopped broker, and a fresh harness process with no Telegram token in its environment or configuration, normal MCP startup makes the broker available. Preparing authority and requesting approval returns the paired human's explicit Approve on the active waiting call. The equivalent persisted route remains usable on supported POSIX storage.
- Given completed setup and unchanged supported credential storage, another supported MCP harness can use the same Proceed configuration without token provisioning or host-specific secret handling. This is a portability outcome, not a claim of already-tested multi-harness compatibility.
- Given an existing credential destination, unsafe storage, an unavailable selected credential, or uncertain broker ownership, setup or startup refuses the affected operation with a safe next step. It does not overwrite, rotate, migrate, weaken protections, select a fallback source or infer approval.
- Given setup or startup outputs, arguments, MCP results, logs, package contents and harness configuration, none contains the token. Setup success alone is not proof of Telegram availability, pairing, human receipt or outcome delivery.

### Boundary, Landing and Exclusions

This is one coherent credential-setup and cold-start outcome. It can land independently in one change PR targeting `main`, with no change dependencies. It relies on the current [delivery and startup contract](../../../specs/opencode-session-continuation/spec.md) and [npm first-use contract](../../../specs/npm-distribution/spec.md). These links use the final archive location. Windows credential admission and npm first-use guidance belong together because either alone leaves the agreed operator outcome incomplete.

Excluded: npm installation hooks, a custom installer, `.env` loading, a new framework, native helper executable, compiler or signing requirement, permission bridging, additional harness integrations, publication automation, automatic migration, credential rotation or overwrite, storage repair, and automatic service startup. Existing pairing, pending requests, decisions, keys and uncertain ownership records must be preserved. Configuring credentials neither enables a disabled integration nor grants new human decision authority.

## Capabilities

### New Capabilities

None. This extends existing credential provisioning, startup and packaged first-use behavior rather than introducing another capability or duplicate requirements set.

### Modified Capabilities

- `opencode-session-continuation` - Extend Proceed-owned private credential provisioning and broker-only durable loading to the practical Windows outcome. Update the current Windows persisted-file unsupported allowance while retaining source precedence, fail-closed behavior and existing authority boundaries. The retained capability path is portable, not an OpenCode dependency.
- `npm-distribution` - Define ordinary secret-free installation followed by explicit private Proceed setup, durable credentials outside package replacement, and first use and fresh launch without harness token supply. Publication policy and historical delivery records are unchanged.

Telegram decision semantics and pairing authority are unchanged, so `telegram-approval` needs no delta for this scope.

## Impact

- Affects operator setup, credential admission and broker startup, plus packaged first-use instructions. Exact commands, storage contracts and platform mechanisms belong in the architecture contract, not this proposal.
- Architecture feasibility question: can npm-installed Proceed privately provision and verify durable Windows credentials, then load them only during broker startup, under the existing protection requirements and without the excluded helper, build or installation mechanisms? The architecture owner must establish that contract before any support claim. Current preview.3 refuses Windows token-file operations and does not establish this feasibility.
- If feasibility requires weaker protection, broader access, another distribution mechanism or a narrower Windows outcome, return that concrete scope/security tradeoff for a user decision. None is authorized here.
- The project's unit-only restriction continues. Automated tests must use normal JavaScript/TypeScript unit tooling and run on Linux without PowerShell or Windows dependencies. Independent review remains required. Windows runtime, installed first-use and fresh-launch outcomes stay unverified until permitted evidence exists. Preview.3 publication, installed-byte checks and its candidate-specific risk acceptance do not prove or authorize this feature's landing or exposure.
- Product scope and both product-behavior deltas were confirmed for implementation. Publication, installation, activation and any candidate-specific acceptance of unrun checks require their own authorization. Spec acceptance is not proof that unrun outcomes passed.

### Related Artifacts

- [Project index](../../../../AGENTS.md)
- [Current README](../../../../README.md) - instructions, not runtime proof.
- [Preview.3 delivery record](../../../../docs/operations/preview-3-delivery.md) - published/installed identity and disabled configuration, not confirmed runtime operation.
