## Why

Prepare `@meshimize/proceed-mcp@0.1.0-preview.10` for the already authorized publishing continuation. Preview.9 is already public and cannot be overwritten to include the concurrency correction merged in [PR #21](https://github.com/renl/proceed-mcp/pull/21) and README changes merged in [PR #20](https://github.com/renl/proceed-mcp/pull/20).

This change aligns release identity only. It does not introduce another feature or change the behavior already merged on `main`.

## Direction Check

Subject: operators obtaining the corrected preview. Desired outcome: an exact new release identity matching the merged source and installation guide.
Problem: immutable preview.9 cannot represent later merged changes. Preparing preview.10 addresses that mismatch without changing approval behavior.

## What Changes

- Align the coupled source versions in `package.json`, both root entries in `package-lock.json`, `server.json` and README installation guidance to `0.1.0-preview.10`.
- Align current-version unit expectations in `tests/release-metadata.test.mjs` without changing their asserted behavior.
- Include only explicitly routed version-literal maintenance in `tests/release-pack.mjs` and `tests/release-installed.test.mjs`. Their preview.9 expectations are stale for preview.10. Editing those literals is not execution or verification of package or installed behavior.
- Preserve package identity, public `preview` publication settings, Registry identity, dependencies, runtime behavior and all existing security boundaries.

### Boundary and landing

This is one independently landable release-preparation change against `main`, based on `a26897ae6b4b764988b4494b8992c4f1b25dd6ee`. Its PR #20 and PR #21 dependencies are already merged. It is not an unexposed runtime foundation. Its useful contribution is consistent source release identification for subsequent publication, not delivery of a new capability.

Completion means the coupled current-version references agree on preview.10, historical evidence remains historical, and no behavior or contract changes accompany the alignment. Publication follows from clean merged `main`, not this unfinished worktree.

Excluded: package-content changes, skill bundling, production behavior changes, dependency updates, security-policy changes, global settings, runtime or credential/state actions, and older unrelated non-unit test ownership conflicts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing [npm-distribution contract](../../specs/npm-distribution/spec.md) already requires truthful current-version guidance and consistent package/Registry identity. Its preview.9 change-specific references are historical context, not a requirement to reuse an immutable published version.

**No-capability-delta decision:** `skip_specs: true` is justified because this change updates release versions and pinned expectations only. It adds no runtime behavior, contract, dependency, security posture or global setting. Do not invent a capability delta or edit current specs to satisfy structural validation.

## Impact

- Affected files are limited to the release references and expectations listed above, plus the necessary change-local planning artifacts.
- The existing independent review and CI/unit evidence may be reused only for unchanged inputs and assertion scope. Changed metadata expectations require applicable unit review/checks, not a new runtime qualification program.
- The unit-only execution restriction remains in force. Do not run the pack or installed tests, integration, renderer, e2e, calibration or preflight checks as part of this preparation.
- Real-wire, multi-directory and first-use behavior remain unverified where previously unverified. The accepted PR #21 landing limitations are not new passes or proof of preview.10 delivery.
- Preview.9 hashes do not qualify the changed preview.10 artifact. Publication, exact-version public readback, Registry delivery and installation retain their separate evidence boundaries. Installation and confirmed runtime operation are distinct.
- The user's publishing continuation covers npm and the matching Registry update. This proposal neither expands installation authority nor introduces a new product approval gate. Existing publication safeguards and the unchanged `latest` boundary remain applicable.
