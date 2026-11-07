---
name: proceed
description: Request Telegram human approval or request-specific instructions for one concrete action with Proceed, then acknowledge and report the recorded outcome.
---

# Proceed approval guidance

Proceed asks the paired human, over Telegram, to approve, reject, or respond to one
stated action, and returns the recorded outcome to the waiting tool call. Use this
skill for the current Telegram workflow only. It explains the exposed tools. Proceed
records decisions. It does not execute the proposed action, add approval authority,
replace native permission controls, or bypass permissions.

## When to use Proceed

- Before an action that needs the paired human's explicit approval under the user's
  task and existing permission rules.
- When the user asks for request-specific instructions rather than a plain approval.
- Do not use it as a substitute for native permission prompts, for actions the user
  already authorized without approval, or as a way to execute the action itself.

## Check the exposed contract first

- Inspect the tools actually exposed to you and their definitions or schema,
  including namespace, prefix, or access mode. Hosts differ.
- The logical names below are the contract. Argument constraints, required fields,
  defaults, and returned structures come from the exposed schema, not from this text.
- If any of the five tools is absent, stop and report the missing tool. Do not
  simulate approval, guess a result, or invent an answer.

## Normal flow

1. `prepare_approval` (optional `session_label`) reserves durable request identity
   and returns `request_handle`, `request_id`, and a private `request_capability`.
   It sends no Telegram question.
2. Retain `request_handle`, `request_id`, and `request_capability` together in
   permitted private state. Keep the capability private.
3. Call `request_approval` with `request_handle`, `request_capability`,
   `client_request_id`, an exact `action`, and distinguishing `context`. The
   optional `expires_in_seconds` is 60 to 86400 and defaults to 3600.
4. That single call creates or reuses one request and keeps waiting. Its returned
   representation is the recorded outcome, not a creation receipt. Client or
   transport timeouts limit the wait, but a timeout does not cancel the request.
5. Read `resolution` separately from `delivery_state`. Delivery state records
   delivery bookkeeping for the request. It is not the human decision.
6. After a terminal decision, call `acknowledge_approval` with `request_id`,
   `request_capability`, and the matching `decision_id`. Then give the human a
   receipt with the matching `request_id` and outcome.
7. Acknowledging the same `decision_id` again returns the same confirmed
   representation. A pending request or a different `decision_id` is
   `DECISION_MISMATCH`. If acknowledgement fails, do not claim confirmation.

## Outcome handling

- Only the paired human's explicit Approve produces `approved`. Proceed never
  approves its own request or manufactures a human decision.
- `approved`: the identified action is permitted only within existing permissions.
  Approval never widens them.
- `responded`: request-specific instructions only. Preserve the text exactly.
  Approval-like words such as yes or approved in Respond remain instructions and
  authorize nothing. If the action still needs approval, make a separate explicit
  request.
- `rejected`: forbids the requested action.
- `expired`, `cancelled`, `pending`: grant nothing. Silence or no response is not
  approval.
- Any error, timeout, or missing decision is not approval.
- Deduplicate by `request_id` and `decision_id` before acting. Retrieval or replay
  never authorizes a repeated action or a second effect.
- Acknowledgement records receipt of the decision. It does not prove execution of
  the action or universal delivery success.

## Private authority

- Only authorized tool arguments and permitted private retention may hold
  `request_capability`. Never paste, print, or echo the capability, or a bot token,
  into assistant messages, Telegram fields, logs, public evidence files, or receipts.
- Display labels such as `session_label` are caller-supplied context, not
  authenticated identity.
- Do not inspect a credential store or ask the human to paste secrets into the
  conversation.

## Lost waiting call or uncertain creation

- A lost wait or timeout does not close the request. Do not ask a duplicate
  question or prepare a replacement merely because the call was lost.
- In a later authorized turn, retrieve the same request with `get_approval` using
  the retained `request_id` and `request_capability` under the same transport
  principal. It applies expiry before the read and reports an expired request as
  expired. Retrieval is observation only. It does not wake, resume, or continue an
  agent.
- Missing capability or a different principal blocks retrieval. Report the blocked
  prerequisite and stop. Do not try ID-only recovery, switch sessions, inspect
  protected state, or claim the earlier request was recovered.
- `NOT_FOUND` cannot distinguish an unused reservation, an unknown request, and
  denied authority. It is not proof that re-submitting a duplicate is safe, so do
  not blind-resubmit.
- `cancel_approval` is only for authorized explicit closure of that request. Do not
  cancel solely because a wait was lost. An already terminal outcome is returned
  unchanged.

## Failures and setup

- Skill not discovered or loaded: check the project path, the case-sensitive ID
  `proceed`, the description, selected-agent permission, and any duplicate-ID
  conflict. Do not weaken permissions.
- Tools absent or broker error: check the MCP connection and the supported setup for
  the local broker, owner, pairing, and MCP client. Report the safe diagnostic. Do
  not claim approval, delivery, or connection before confirmation.
- Incomplete pairing or denied access: direct the operator to supported setup. Never
  disclose secrets or manufacture a human answer.
- Current limits: no automatic broker startup, no native-channel answers or
  automated native permission replies, no Events delivery, no automatic
  post-timeout continuation, no completed doctor guarantee, and no delivery retry.
  Do not promise them.

## First harmless use

- To demonstrate, propose a clearly labeled test that performs no consequential
  action, no shell command, and no file modification.
- Ask the paired human to select Approve in Telegram while the waiting call is
  active, check that the matching request is approved, acknowledge the returned
  `decision_id`, and give a capability-free receipt.
- A timeout is not a successful active-wait demonstration. Follow the recovery
  guidance above instead of repeating the question.

## Truthful reporting

- Report what the tool actually returned. Never fabricate a human decision,
  self-approve a request, or automate an answer to a native permission prompt.
- State uncertainty as blocked or unverified, and name the missing prerequisite.
