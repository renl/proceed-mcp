# Provisioning terminal lifecycle

Release the private reader's input activity so provisioning completes naturally without disrupting an embedding caller.

## Context

The [proposal](proposal.md) and [capability delta](specs/opencode-session-continuation/spec.md) define the outcome. The current contract is `openspec/specs/opencode-session-continuation/spec.md`.

Source inspection identifies a bounded cleanup gap:

- `src/cli/terminal-input.js` restores raw mode, removes owned listeners and clears its timer, but has no release of input activity started by reading. Listener removal alone is not a sufficient lifecycle contract.
- Reader setup changes raw mode before listener installation and prompt output. Exceptions during partial setup must also enter cleanup.
- `src/cli/main.js` awaits the reader before credential creation and returns the existing exit code after reporting the result. Input cleanup therefore belongs in the reader, not a command-level forced exit.
- `tests/proceed-setup-cli-unit.test.mjs` checks raw-mode restoration and listener counts, but does not prove release of reader-started activity or preservation of already active input.

This explains the source-level gap consistent with the reported preview.7 hang. It is not proof of the installed Windows root cause or corrected natural exit.

## Goals and non-goals

One independently landable correction against `main`, with no stacked parent or dependency on another active change. Deliver the reader correction and focused regressions in one change and one PR.

Do not change command signatures, exit-code meanings, token validation, the explicit nonterminal route, credential storage, preflight ordering, create-only behavior or broker lifecycle. Ordinary-exchange deadlines and the initialization ACL issue are excluded. No new framework, platform adapter, schema or migration is needed.

## Decisions

### 1. The reader owns acquisition and release

The private reader SHALL finish cleanup before resolving or rejecting. Cleanup SHALL remove only its listeners, cancel its timer, restore the prior raw mode while the terminal remains usable, and release activity it started. It SHALL tolerate repeated terminal events without repeated settlement or renewed activity.

| Input use before acquisition                           | Required outcome after cleanup                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Inactive, including never started or explicitly paused | Reading started for this attempt SHALL stop. Input SHALL remain open and reusable, with no reader-owned activity retaining the command. |
| Already flowing for the caller                         | Existing input use SHALL continue. Cleanup SHALL NOT pause, destroy, close or otherwise disable that caller's input.                    |
| Unrelated listeners present                            | Those listeners SHALL remain installed. Their presence alone does not transfer ownership of reader-started activity to the caller.      |

Capture prior input use before acquisition changes it. Restore behavior, not an exact private metadata representation. Never write internal stream fields to recreate a previous state. The implementation may use the existing stream's ordinary lifecycle controls, but the choice of private bookkeeping remains an implementation concern.

The reader SHALL NOT destroy shared input, remove all listeners, force process termination, or disable unrelated work to produce apparent completion. Natural standalone completion assumes no unrelated outstanding work. An embedding caller remains free to keep running.

### 2. Every acquired resource has a failure path

The same ownership-limited cleanup SHALL cover successful submission, parser rejection, oversized input, Ctrl+C cancellation, premature end/close, read error and the existing input timeout. It SHALL also cover partial setup failures, including listener installation or prompt output failure after raw mode changes. Attempt each applicable cleanup action even if another restoration action fails. A terminal that is already unavailable cannot be guaranteed physically restored, but owned listeners and timers must still be released.

Preflight refusal before acquisition SHALL leave caller input untouched. If raw-mode acquisition fails after a partial change, attempt restoration without consuming input or falling back to echoed input. Setup failures SHALL reject with a secret-free failure, never expose raw exception content containing supplied input.

Credential creation happens after reader settlement. Therefore both persistence success and persistence failure SHALL encounter already released reader resources. Do not retain input until persistence finishes or add a second cleanup owner in command dispatch.

### 3. Preserve existing safety boundaries

Private mode SHALL precede secret consumption. Preserve fixed prompt behavior, no echo/masking/length disclosure, bounded validation, and secret-free diagnostics. Existing and uncertain credential destinations remain untouched under the current create-only contract. No operational verification may read, replace or reprovision the user's existing token.

## Verification obligations

Extend the existing portable unit coverage rather than introducing a harness:

- Exercise initially inactive input and explicitly paused input through submission and failure. Assert that reader-started activity stops, owned listeners/timers are released and raw mode is restored. A resolved promise or zero owned listeners alone is insufficient.
- Exercise already flowing caller input through success and failure. After cleanup, deliver a separate synthetic input event and verify the retained caller consumer still receives it without a caller restart. Verify the stream remains open and unrelated listeners survive.
- Cover cancellation, invalid/oversized input, premature end/close, read error, timeout and partial setup errors with the same cleanup assertions. Preserve existing exit classifications for established paths and secret-free failure output.
- Retain the command-level success and create-only refusal checks. Include credential creation failure after accepted input to prove reader release does not depend on persistence success.
- Use public observable stream behavior or a faithful activity-aware unit double. Do not require exact internal metadata values, arbitrary pause-call counts, a new production test API, real credentials or a child-process exit harness.

Only Linux-portable JavaScript unit tests are authorized. Unit results establish cleanup behavior, not installed Windows terminal enforcement or natural process exit. Those checks remain deferred and unverified for later owner manual verification after deployment. No tests or runtime checks were executed during design authoring.
