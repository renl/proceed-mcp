## Context and boundary

[Proposal](proposal.md): prepare `@meshimize/proceed-mcp@0.1.0-preview.10` without changing behavior. Base is merged `main` at `a26897ae6b4b764988b4494b8992c4f1b25dd6ee`. Dependencies PR #20 and PR #21 are already merged. This change can land independently in one release-preparation PR.

The existing [npm-distribution contract](../../specs/npm-distribution/spec.md) remains unchanged. Use top-level `skip_specs: true`, no capability delta and no manual baseline spec edits. Archive through the authorized CLI operation inside the same PR.

## Decisions and exact edit allowlist

All current-release pins below shall move from `0.1.0-preview.9` to `0.1.0-preview.10` together.

| File | Allowed edit | Editing role |
| --- | --- | --- |
| `package.json` | Top-level `version` only | Software engineering |
| `package-lock.json` | Top-level `version` and `packages[""].version` only | Software engineering |
| `server.json` | Listing `version` and the npm package entry's `version` only | Software engineering |
| `README.md` | Source-version statement and exact npm installation pin, currently lines 23 and 30 | Documentation maintenance |
| `tests/release-metadata.test.mjs` | Three current-version literals, currently lines 17, 56 and 106 | Test engineering |
| `tests/release-pack.mjs` | Exact version and tarball filename expectations, currently lines 113-114. Filename becomes `meshimize-proceed-mcp-0.1.0-preview.10.tgz` | Test engineering |
| `tests/release-installed.test.mjs` | Exact manifest-version expectation, currently line 159 | Test engineering |

The non-unit pins were confirmed against source. Their maintenance changes literals only, not assertions, criteria or execution permissions. Preserve negative-control versions, historical records, package and Registry identities, public access, `preview` tag and unchanged `latest` policy.

No runtime behavior, dependencies, package contents, frameworks, skill packaging, global configuration, security policy, credentials or state shall change. Older owner-conflict probes remain deferred test debt outside this change.

## Minimal check mapping

| Check | What it establishes |
| --- | --- |
| Independent metadata unit review and `tests/release-metadata.test.mjs` | Current release identity, lock roots, listing consistency and unchanged controls |
| Existing permitted CI and scoped diff review | Consistent pins and no changes beyond the allowlist and necessary change-local artifacts |
| Read-only review of non-unit literal edits | Expectations remain aligned without weakening assertions. Not pack or installed proof |

Only unit tests may execute. No pack, installed, integration, renderer, e2e, calibration or preflight execution is authorized here. Reuse prior production proof only for unchanged inputs and assertion scope. Real-wire, multi-directory and first-use gaps remain unverified, not newly passed. No interface changes require a new boundary-wire gate or validation harness.

Publication availability, artifact admission, exact-version public readback, Registry delivery and any installation remain separate operational work from clean merged `main`. Preview.9 artifact hashes do not qualify preview.10. Preparation does not claim preview.10 is available or that installation proves runtime operation.
