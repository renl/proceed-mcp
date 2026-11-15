## Context

[Proposal](proposal.md): prepare documentation-only `0.1.0-preview.11` for npm and the matching MCP Registry listing. The corrected README already exists in base `main` at `f9804abceb56ab9f6826382c5142d9ce46690116`. This change is independently landable against that base with no stacked parent.

## Goals and Non-Goals

Align current release references so the corrected guide can ship under a new immutable version. Preserve the README's existing-skill, global/user and project-local choices without rewriting them.

No runtime, public interface, capability, security, dependency, CI, skill or global configuration changes. No installation, runtime activation, provisioning or token/state operations.

## Decisions

- Use top-level `skip_specs: true` in change metadata, as approved in the proposal. No capability delta or baseline spec edit is needed under the existing [distribution contract](../../../specs/npm-distribution/spec.md).
- Change only these release references to `0.1.0-preview.11`, besides necessary change-local planning artifacts:

  | File | Allowed edits |
  | --- | --- |
  | `package.json` | `version` |
  | `package-lock.json` | Top-level `version` and `packages[""].version` |
  | `server.json` | Top-level `version` and npm package entry `version` |
  | `README.md` | Source-version statement and exact installation pin only |
  | `tests/release-metadata.test.mjs` | Three current-version expectations only |
  | `tests/release-pack.mjs` | Two current-version literals only |
  | `tests/release-installed.test.mjs` | One current-version literal only |

- Preserve all other fields and assertions, including historical negative-control versions. Do not regenerate dependency content. Package identity remains `@meshimize/proceed-mcp`, Registry identity remains `io.github.renl/proceed-mcp`, and public `preview` settings remain unchanged.
- Preserve the existing `latest` mapping to preview.1 and all user data. Preview.10 remains immutable. Publication follows clean merged `main`, not this worktree.

## Verification and Delivery

Use the existing nine metadata unit records, static JSON coupling review and existing CI. Reuse production evidence only where inputs and assertion scope are unchanged. The non-unit files receive mechanical literal maintenance only and shall not be executed. No new framework, gate or interface-boundary review is introduced.

Independent review remains required. Later artifact qualification must identify preview.11 separately, including exact README source-copy comparison. Preview.10 hashes cannot qualify the new artifact. Package qualification, public exact-version readback and matching Registry delivery remain separate evidence boundaries. Unrun non-unit and runtime checks remain unverified.

The change lands through one PR with the authorized CLI archive inside it. Ready-PR merge authorization remains separate from the approved publishing continuation. This design neither performs nor authorizes installation or runtime activation.
