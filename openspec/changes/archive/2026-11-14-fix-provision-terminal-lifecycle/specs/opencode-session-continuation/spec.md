## ADDED Requirements

### Requirement: Provisioning releases its input lifecycle without disrupting callers

Interactive credential provisioning MUST release input activity acquired by its attempt on success and every failure, including cancellation. Cleanup MUST preserve unrelated caller resources, listeners and preexisting input use.

#### Scenario: Standalone completion requires no further input

- **GIVEN** a standalone provisioning command with no unrelated outstanding work
- **WHEN** its result and cleanup are complete
- **THEN** it MUST return control to the shell without further input, interruption or waiting for an input timeout
- **AND** cleanup MUST NOT force termination of an embedding caller or close shared input to make the standalone command exit.

#### Scenario: Existing credential protections remain effective

- **GIVEN** interactive credential provisioning
- **WHEN** provisioning succeeds or fails, including cancellation
- **THEN** existing private-input, terminal-mode restoration, token nondisclosure, exclusive creation and preservation of preexisting or uncertain objects requirements remain unchanged.

#### Scenario: First provisioning completes from a clean installation

- **GIVEN** a clean installation whose operator has initialized protected state through supported setup, an absent admissible credential destination and a trusted unrecorded interactive terminal
- **WHEN** the operator submits a valid token through supported interactive provisioning and creation succeeds
- **THEN** provisioning reports success without disclosing the token
- **AND** its terminal and input cleanup completes
- **AND** the standalone command returns control to the shell without another keystroke, interruption or input-timeout wait.

#### Scenario: Failed provisioning does not retain input activity

- **GIVEN** standalone interactive provisioning with no unrelated outstanding work
- **WHEN** it fails before or after acquiring private input, including cancellation, invalid input, input timeout, premature EOF or credential creation failure
- **THEN** it reports the applicable secret-free failure and releases any input activity acquired by the attempt
- **AND** it returns control to the shell without additional input, interruption or another input-timeout wait
- **AND** existing no-write and ownership-limited cleanup rules remain effective.

#### Scenario: Cleanup preserves unrelated caller input use

- **GIVEN** provisioning is invoked by a caller that already uses the input resource or has unrelated listeners or outstanding work
- **WHEN** provisioning succeeds or fails
- **THEN** its own input activity is released without removing unrelated listeners, closing shared input, interrupting the caller's preexisting input use or terminating unrelated work.
