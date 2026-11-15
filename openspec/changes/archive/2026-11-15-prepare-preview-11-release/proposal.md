## Why

Prepare `@meshimize/proceed-mcp@0.1.0-preview.11` so the corrected README on merged `main` can reach npm and the matching MCP Registry listing. Published preview.10 is immutable and cannot be rewritten with the corrected guide. This is release identification only, not a new feature.

## Direction Check

Subject: operators reading the distributed installation guide. Desired outcome: the corrected source README reaches the new npm preview unchanged except for its current-version pins.
Problem: preview.10 cannot acquire later documentation corrections. A new version addresses that mismatch without changing runtime behavior.

## What Changes

- Align five coupled metadata fields to `0.1.0-preview.11`: the package version, both lockfile root versions, and the Registry manifest and npm package versions.
- Update the README's source-version statement and exact installation pin. Otherwise preserve the corrected source README exactly in the published package, without new copy or behavior claims.
- Align the three current-version expectations in `tests/release-metadata.test.mjs`, preserving assertions. Mechanically align the three current-version literals across `tests/release-pack.mjs` and `tests/release-installed.test.mjs` without executing those non-unit checks.
- Preserve package and Registry identities, public `preview` settings, the existing `latest` mapping, runtime behavior and security boundaries.

This is independently landable against `main`, based on `f9804abceb56ab9f6826382c5142d9ce46690116`. The corrected README is already in that base. The first useful increment is consistent release identification enabling its publication, not a runtime foundation or new capability. Completion means all listed current-version references agree on preview.11 and no unrelated content or behavior changes. Publication follows only from clean merged `main`.

Excluded: runtime code, dependencies, CI, skills, global configuration, installation, runtime or token/state actions, and older unrelated test-ownership conflict debt. Existing empty-state setup and first useful approval behavior remain unchanged under the current contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing [npm-distribution contract](../../../specs/npm-distribution/spec.md) already covers truthful current-version guidance and matching package/Registry identities. Historical version-specific references do not require reusing an immutable published version.

**No-capability-delta decision:** top-level `skip_specs: true` is justified for release-version and expectation alignment under existing contracts only. No capability or normative requirement changes. Preserve the scaffold's `schema` and `created` metadata. No spec delta or direct baseline edit is needed.

## Impact

- Scope is the listed release references and expectations plus necessary change-local planning artifacts. A minimal design records the release approach for the CLI tasks dependency, not new architecture.
- Existing runtime unit evidence is reusable only for unchanged inputs and assertion scope. Changed metadata expectations retain applicable unit checks and independent review. The unit-only execution restriction remains in force. Non-unit checks remain unrun and unverified.
- Preview.10 hashes do not qualify preview.11. The new artifact needs its own identity and evidence, including exact README source-copy comparison. Publication, public exact-version readback and Registry delivery remain separate evidence boundaries. No installation or runtime qualification is claimed.
- The user's "ok proceed" authorizes the documentation-only preview.11 publishing continuation to npm and the matching MCP Registry, with runtime and `latest` unchanged and no installation. It does not silently authorize merging the new PR or accepting a target-branch race. Apply the ready-PR approval policy when ready. No new product sign-off is needed for this unchanged behavior.
