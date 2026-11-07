# Proceed agent usage skill

Status: Draft. Read next: [product acceptance](specs/proceed-agent-guidance/spec.md).

## Why

Humans currently have to repeat how an agent should use Proceed safely. A reusable, installable skill will give agents the current Telegram workflow and recovery guidance without asking the human to restate it for each task.

## Direction Check

Subject: The human using an agent harness. Desired outcome: Reliable Proceed use without repeated workflow instructions.
Problem: No installable usage skill. This change supplies reusable guidance for that human's agent, not new approval authority or runtime enforcement.

## What Changes

- Deliver a reusable Proceed usage skill, discoverable by its description and explicitly loadable as `proceed` in OpenCode V2.
- Add README guidance for copying the supplied skill into a consuming project's `.opencode/skills/proceed/SKILL.md` and explicitly loading it through the agent's `skill` tool with `id: proceed` or through `@proceed`. Either loading route satisfies acceptance. This is the minimum supported installation path, not a new installer or catalog.
- Cover when to request human approval or instructions, the existing prepare/wait/acknowledge interaction, truthful outcomes, private authority retention, and retrieval after a lost waiting call.
- Provide a harmless first-use procedure and actionable guidance for missing tools, setup, permissions, or retained authority.

## Capabilities

### New Capabilities

- `proceed-agent-guidance`: Installable, loadable instructional guidance for safe agent use of the existing Telegram approval workflow.

### Modified Capabilities

None. Existing approval, delivery, and distribution requirements remain authoritative and unchanged.

## User Stories

- As a human using an agent harness, I want to install and load Proceed guidance once, so that I do not need to repeat its usage rules for each task.
- As a human awaiting an agent's action, I want the guidance to distinguish approval from instructions and failures, so that my intent is not mistaken for permission.

## Scope and Landing

This change independently delivers a usable skill and installation guidance against the current Telegram workflow. It is not unexposed foundation work. It can land on `main` without any startup or dual-channel change.

Behavioral dependencies are the current [Telegram approval](../../specs/telegram-approval/spec.md), [portable delivery](../../specs/opencode-session-continuation/spec.md), and [existing package/setup](../../specs/npm-distribution/spec.md) contracts. There is no dependency on an unimplemented program outcome.

Excluded: Runtime or public tool changes, automatic broker startup, native-harness answer arbitration, dual-channel answers, native permission-prompt automation, permission bypass, automatic post-timeout resumption, Events, a new distribution service/catalog/installer, global configuration edits during development, package republishing, and public release. Startup and dual-channel behavior require separately scoped changes.

## Impact

The implementation deliverables are a reusable skill artifact and README installation/loading/first-use guidance. The skill's repository source location is left to implementation ownership. No application source, credential storage, public API, or existing capability contract changes are required.

Acceptance concerns the supplied instructions, documented installation path, loading, and bounded demonstrations. Discovery does not guarantee invocation, and a skill cannot guarantee universal model obedience or enforce permissions. Fresh-install guidance links the supported setup path rather than duplicating its contract.

## Review

The user authorized the skill and README outcome and changed the program's delivery order: develop and deploy the complete program before requesting hands-on user acceptance. Do not require interim user testing to begin automatic startup or dual-channel development. These remain separate bounded changes, not added implementation scope here.

## Delivery and Acceptance Order

- Engineering owns pre-merge structural, instructional, copy-integrity and independently executable host checks. Real OpenCode installation/loading remains required boundary proof, not a static-check claim. Exercise it without user participation only in an authorized environment. Missing access remains BLOCKED and does not authorize credential inspection or configuration changes.
- The paired human's harmless active-wait Telegram first use remains a required outcome. Schedule the operator demonstration and final hands-on acceptance after the full program preview is deployed from clean, merged `main`. Do not replace a pending human answer with an agent-authored approval or count simulations as this proof.
- This delivery-order correction does not waive an applicable pre-merge or pre-exposure check. If required real-host or first-use proof is still unavailable at archive, merge or deployment, that specific step needs eligible, explicit scoped preview-risk acceptance. Record the exact missing assertion, current evidence, residual risk, mitigation, accountable owner, authorized step and preview scope, and expiry or review trigger. Independent review remains required. Deferred or accepted checks remain unverified, never passed.
- The skill can land independently when its applicable gates are satisfied or explicitly covered by that scoped acceptance. Its landing does not mean the full program is deployed or user-accepted. Deployment and publishing remain separate authorized operations from clean, merged `main`, using an authorized release route.

## Related Artifacts

- [Product acceptance](specs/proceed-agent-guidance/spec.md)
- [Existing setup and tools](../../../README.md)
- [OpenCode V2 skills reference](https://opencode.ai/v2/docs/skills/)
