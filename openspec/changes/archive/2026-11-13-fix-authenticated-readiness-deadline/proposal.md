## Why

Normal MCP use can reject an available broker because the complete authenticated readiness exchange is capped at one second, even while the original startup deadline still has time remaining. This conflicts with the existing bounded automatic-availability outcome. Source confirms the cap. Its contribution to the reported live MCP timeout is inferred, not proven.

### Direction Check

- Subject: callers using the configured normal MCP adapter. Desired outcome: reach verified broker readiness within the existing startup deadline without a separate broker terminal.
- Problem: a shorter internal readiness cap can prevent that outcome. This correction addresses that cap without weakening authentication or extending the overall deadline.

## What Changes

- Allow the complete authenticated readiness exchange to use the remaining original startup deadline instead of the one-second probe cap.
- Preserve the original 150-second total startup budget, deadline-expiry and cancellation gates, ownership and key validation, socket cleanup, and existing occupancy and TLS subcaps.
- Keep the correction independently landable against `main` baseline `837f360`, with no dependency on another active change. This is an exposed correctness fix for existing MCP startup, not unexposed foundation work.
- Exclude security changes, new retry machinery, cache rewrites, performance frameworks and mandatory phased diagnostics. No new setup, migration or public interaction is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None at the requirements level. The affected implementation serves `openspec/specs/opencode-session-continuation/spec.md`, specifically "Automatic broker availability for normal MCP use", whose existing contract already requires verified readiness within a finite startup deadline. Its scenarios cover safely stopped startup, healthy reuse and readiness never arriving. Existing ownership, confidential admission, first-use and durable-work requirements remain unchanged. This repository-root reference remains valid after archive.

**Delta applicability verdict:** accepted for pre-archive owner review. No capability delta or baseline spec update is needed. The proposal, design and tasks preserve the current contract without adding a guarantee, changing the deadline or relaxing admission. The existing approved `skip_specs: true` declaration is appropriate for this specification-unchanged correction. No manual spec sync is needed.

## Impact

- Scope: readiness deadline handling in `src/broker/availability.js` and focused deterministic regressions in `tests/authenticated-readiness-deadline.test.mjs`.
- Existing supported setup remains the path from an empty installation to the first approval interaction. Existing installations retain state, pairing, keys and pending work without reinitialization.
- Verification remains unit-only with independent review. Installed runtime operation and Telegram delivery remain unverified, and this correction does not establish the exact cause of the reported live timeout.
- Preview.6 patch metadata is delivery preparation, not runtime proof. Archive, final CI, fresh merge checks, preview publication and installation follow the separately recorded PR #14 authorization with `latest` unchanged. Terminal delivery evidence belongs on [PR #14](https://github.com/renl/proceed-mcp/pull/14) or in the live status log, not in this proposal after archive.
