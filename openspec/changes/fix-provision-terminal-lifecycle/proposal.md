## Why

The operator reports that preview.7 Telegram provisioning prints success but remains running for more than a minute until interrupted. Existing requirements restore terminal mode and release listeners, but do not explicitly require standalone completion or preservation of unrelated caller input use.

## What Changes

- Complete the hidden-input lifecycle on success and failure so standalone provisioning returns without another keystroke or interruption.
- Preserve unrelated caller resources and input use rather than forcing process termination or closing shared input.
- Retain existing private-input, secret-free diagnostics, exclusive creation and no-overwrite requirements.

### Direction Check

Subject: the operator provisioning a Telegram credential. Desired outcome: finish setup and regain the shell.
Problem: provisioning can leave input activity keeping the command alive. This correction releases only the attempt's input activity, not unrelated caller resources.

### User Story

As an operator, I want provisioning to return after its result, so that I can continue setup without interrupting an apparently unfinished command.

### Boundary

One independently landable correctness fix against `main`, with no dependency on another active change. The first useful increment is the complete provisioning lifecycle correction, not an unexposed foundation.

Excluded: new setup modes, credential storage changes, broker lifecycle changes, frameworks, installation, publication and runtime operations. No private stream metadata becomes a product requirement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-session-continuation`: explicitly require provisioning completion and preservation of unrelated caller input use. See the [delta](specs/opencode-session-continuation/spec.md) and [current contract](../../specs/opencode-session-continuation/spec.md).

## Impact

Scope is hidden-input cleanup and focused portable JavaScript unit regressions. Existing clean-install setup prerequisites and supported initialization remain unchanged. From a clean installation, the operator initializes protected state through supported setup, then provisions an absent credential destination privately and regains the shell.

Acceptance outcomes are in the delta. Only unit testing is authorized. Real Windows natural process exit remains deferred to owner manual verification after deployment and is unverified, not established by unit results.
