# Delta for opencode-session-continuation

Enable concurrent same-owner adapters with independent lifetimes. Parent: [proposal](../../proposal.md). Unchanged authority, waiting-call and recovery requirements remain defined in the [current capability](../../../../specs/opencode-session-continuation/spec.md) and [Telegram approval contract](../../../../specs/telegram-approval/spec.md).

## ADDED Requirements

### Requirement: Concurrent adapters share an owner without registration conflict

The product MUST permit multiple authenticated adapters using the same configured owner to register and use the matching broker concurrently. Existing occupancy by that owner alone MUST NOT produce `OWNER_IN_USE` or require another owner. Each adapter MUST receive distinct registration authority limited to its own registration under that owner. Registration authority MUST NOT grant authority broader than the existing owner or substitute for private request capabilities, their bound transport principal or human decision authority.

#### Scenario: Same-owner adapters complete independent approval interactions

- **GIVEN** two authenticated adapters in different OpenCode directories using the same configured owner and broker
- **WHEN** each registers, prepares its own request authority and makes a create-and-wait call
- **THEN** both interactions can proceed concurrently without an owner-occupancy conflict or global queue
- **AND** when the human resolves them in reverse order, each actual outcome returns only on its original invocation with its matching JSON-RPC request ID
- **AND** each authorized caller can acknowledge its matching decision independently under the existing idempotent acknowledgement contract.

#### Scenario: Registration authority does not grant sibling request access

- **GIVEN** concurrent same-owner adapters with distinct registration authority
- **WHEN** one presents only its registration authority or knows another request's identity or label
- **THEN** it cannot retrieve, cancel or acknowledge that request without the matching request capability and bound transport principal
- **AND** deliberate sharing of a valid request capability within its bound principal remains authorized under `Exact originating-session delivery`, without redirecting an existing waiting response.

#### Scenario: Admission and owner isolation remain effective

- **GIVEN** concurrent registration is available
- **WHEN** a client lacks valid owner authentication or tries to use registration authority across owners
- **THEN** access is denied without disclosing or changing another owner's registrations or requests
- **AND** every connection, including reconnects, retains the existing authenticated confidential admission requirements.

#### Scenario: Supported first use enables two adapters without extra owner setup

- **GIVEN** an empty installation with no configuration, pairing, requests or decisions
- **WHEN** the operator completes existing supported initialization, owner setup, credential supply and authorized private pairing, then connects two normal MCP adapters for that owner
- **THEN** both can register and complete their first useful approval interaction through the existing prepare, wait and acknowledge path without an additional owner solely to avoid conflict
- **AND** no manual stored-data editing or separate manual broker terminal is required
- **AND** setup and registration alone create no request or approval, and registration does not establish pairing or human decision authority.

### Requirement: Registration renewal and retirement are independent

Each registration MUST have independently scoped renewal, release and expiry. A heartbeat or release authorized for one registration MUST NOT renew, release or otherwise change a sibling's registration. An unrenewed registration MUST become unusable at its expiry deadline. Expired or retired registration authority MUST NOT reactivate that registration or renew, release or replace a current registration, including a later registration for the same adapter or owner. An expired registration MUST require a new authenticated registration rather than renewal of expired authority.

#### Scenario: One registration renews while a sibling retires

- **GIVEN** two active registrations for the same owner
- **WHEN** one sends a heartbeat and the other is released
- **THEN** the heartbeat renews only its own registration and the release retires only its own registration
- **AND** the remaining adapter's broker access and active approval interaction continue.

#### Scenario: Unrenewed registration expires without affecting a sibling

- **GIVEN** two same-owner registrations and only one continues to renew
- **WHEN** the unrenewed registration reaches its expiry deadline
- **THEN** it is unusable even if no release succeeded
- **AND** the renewed sibling remains usable without interruption or deadline changes caused by that expiry.

#### Scenario: Stale authority cannot affect a current registration

- **GIVEN** a registration expired or was retired and a current registration exists for the same owner
- **WHEN** a delayed heartbeat or release presents the old registration authority
- **THEN** it cannot revive the old registration or renew, retire or replace the current registration
- **AND** this remains true when the current registration belongs to a reconnected adapter.

### Requirement: Adapter reconnect and closure preserve durable request recovery

Reconnect MUST establish usable authenticated registration without evicting siblings, automatically reattaching a lost waiting call or duplicating pending requests. Once adapter shutdown is observed, the adapter MUST stop initiating ordinary activity and renewals, make only bounded best-effort release of its own known registration authority and prevent late asynchronous completions from restoring closed activity. An unknown registration-creation or release result MUST NOT be reported as confirmed cleanup or justify guessed authority. Any registration left unrenewed MUST become unusable at its expiry deadline.

Registration loss, release, expiry, reconnect and adapter closure MUST NOT themselves cancel durable requests, erase accepted outcomes or transfer response routing. Retained request capabilities under the same transport principal MUST continue to permit explicit retrieval and idempotent acknowledgement under `Exact originating-session delivery` and `Safe pending delivery and replay`, without requiring the lost registration to remain active. Existing request expiry and explicit cancellation rules remain unchanged.

#### Scenario: Reconnect preserves siblings and existing pending work

- **GIVEN** one adapter loses its connection while a sibling remains active and a durable request remains pending
- **WHEN** the disconnected adapter reconnects
- **THEN** it can establish usable registration without evicting the sibling or interrupting the sibling's active wait
- **AND** reconnect alone neither creates a replacement request nor reattaches the lost waiting call, retargets its response or claims automatic resumption.

#### Scenario: Observed shutdown stops activity despite late completions

- **GIVEN** an adapter has outstanding registration or renewal work
- **WHEN** shutdown is observed before that work completes
- **THEN** no new ordinary operations or renewals are initiated after shutdown observation
- **AND** late completions cannot make the closed adapter active again or restart its renewal activity
- **AND** cleanup attempts are bounded and restricted to its own known registration authority, leaving sibling activity unchanged.

#### Scenario: Creation or release outcome is unknown

- **GIVEN** shutdown overlaps registration creation or release and its result is unknown
- **WHEN** bounded best-effort cleanup ends
- **THEN** the adapter does not claim confirmed release or complete cleanup, guess registration authority or release registrations by owner-wide inference
- **AND** any registration left without renewal becomes unusable at its deadline
- **AND** uncertainty does not justify stopping a shared broker, killing an unrelated process or taking over uncertain ownership.

#### Scenario: Registration loss leaves requests and accepted decisions recoverable

- **GIVEN** retained request identity and capability under the bound transport principal, and adapter registration that is lost, released or expired
- **WHEN** the original waiting call is unavailable and an authenticated caller explicitly retrieves the request through a usable connection
- **THEN** pending work and accepted outcomes remain available under existing durable-state, expiry and single-resolution rules
- **AND** repeated acknowledgement of the matching terminal decision preserves that decision without duplicate effects
- **AND** no successful original-call delivery, late delivery, automatic agent activity or human approval is inferred from retrieval or registration recovery.

## MODIFIED Requirements

### Requirement: Shared startup preserves exclusive ownership and client independence

Automatic startup MUST preserve at most one broker and one Telegram update poller per configured state,
including concurrent adapter starts and races with manual startup. Closing one adapter MUST NOT stop a
broker needed by another adapter or stop a manually started broker. The product MUST document the
automatic broker's lifetime and supported clean-stop path. It MUST NOT kill an unrelated process or
replace, delete or take over uncertain ownership to make startup succeed.

This exclusivity applies to broker and poller ownership, not adapter occupancy for a configured owner.
Multiple authenticated adapters for that owner MUST be able to share the matching ready broker with
independent registration lifetimes.

#### Scenario: Concurrent clients start against stopped state

- **GIVEN** safely unowned configured state and multiple authorized MCP adapters
- **WHEN** the adapters start concurrently, including a concurrent manual broker start
- **THEN** at most one broker acquires ownership and at most one Telegram update poller runs for that
  state
- **AND** successful adapters use the same matching ready broker
- **AND** adapters that cannot establish readiness within the startup deadline report failure without
  bypassing ownership or corrupting state.

#### Scenario: One client closes while another remains

- **GIVEN** two active adapters share the broker and one has a pending approval interaction
- **WHEN** the other adapter closes
- **THEN** the remaining adapter's broker access and pending interaction are not interrupted by that
  closure
- **AND** the closed adapter's requests and decisions retain the existing lost-call and durable-state
  semantics.

#### Scenario: A client closes after reusing a manual broker

- **GIVEN** an adapter reused a manually started broker
- **WHEN** that adapter closes, including when no other adapters remain
- **THEN** the adapter does not stop the manual broker or remove its ownership record.

#### Scenario: Occupied port or uncertain ownership

- **GIVEN** an unrelated listener, a mismatched broker, or an ownership record whose safe reuse cannot
  be established
- **WHEN** the adapter attempts automatic startup or reuse
- **THEN** it reports the applicable conflict or uncertain ownership with a safe next action
- **AND** it does not treat an open port as proof of a matching healthy instance
- **AND** it does not kill the listener, remove or replace the ownership record, recover stale
  ownership, or modify the protected journal to bypass the conflict.
