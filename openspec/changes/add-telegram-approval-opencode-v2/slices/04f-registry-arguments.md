# Registry argument metadata correction

Parent: [tasks](../tasks.md). Authority: [design section 8](../design.md#public-delivery-and-separate-registry-obligation), [Distinct MCP Registry publication](../specs/npm-distribution/spec.md#requirement-distinct-mcp-registry-publication). This is metadata compatibility preparation, not a new CLI contract.

## Outcome and file-bound handoff

Can the Registry descriptor express the already published adapter launch without unsupported equals syntax or breaking a state directory containing spaces? Exact descriptor-to-argv assertions into the actual parser prove the local contract mapping. Schema validity supports compatibility but does not prove a consuming client's prompting or rendering.

- Existing worktree `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, target `main`. Preparation baseline `02adab9cdca2b888015980029f8359ade8c7c557`. Prerequisite existing launch/parser and approved positional clarification are present. One OpenSpec change/PR, internal correction checkpoint only.
- Preparation edits only `tests/release-metadata.test.mjs`, `tasks.md` and this brief. No new fixture/helper, dependency, harness or application code. Preserve unstaged proposal repair, retained/public artifacts, private binding and all nine excluded paths. Never stage all.
- Implementation edits ONLY `server.json`, specifically the npm `packageArguments` array. Source ceiling120 gross additions plus deletions, expected comfortably below that. Preserve every field outside this array, including schema/name/descriptions/repository/npm identity and versions. No runtime or package change, republish or modification of immutable public tarball. `server.json` is not shipped in that tarball.
- Replace three entries with the five ordered positional entries below. No named arguments, shell strings, literal quotes, defaults, fixed owner/path, variables, repetition or choices. Constants are fixed `value` entries with `isRequired: true`. Each entry has a clear description. No environment, remote or bot-token metadata.

| Slot | Fixed value or configurable input | Required fields |
| --- | --- | --- |
| 1 | `mcp` | `type: positional`, `value: mcp`, `isRequired: true` |
| 2 | `--owner` | `type: positional`, `value: --owner`, `isRequired: true` |
| 3 | Operator's locally added owner identifier | `type: positional`, `valueHint: operator-owner-id`, `placeholder: operator-owner-id`, `format: string`, `isRequired: true`, `isSecret: false`, no `value` |
| 4 | `--state-dir` | `type: positional`, `value: --state-dir`, `isRequired: true` |
| 5 | Operator's absolute protected state directory created by init | `type: positional`, `valueHint: operator-state-dir`, `placeholder: operator-state-dir`, `format: string`, `isRequired: true`, `isSecret: false`, no `value` |

The resulting vector is exactly `['mcp', '--owner', ownerInput, '--state-dir', stateDirectoryInput]`. Hints/placeholders are display labels, never argv text. A directory containing spaces is one value without inserted quotes. Do not change parser behavior, which already permits options in different orders. Only descriptor slot order is pinned.

## Boundary Verification and review status

Normative public metadata and existing CLI boundary: design launch command above, actual `src/cli/args.js` `parseArguments` and `requireOptions`. The pinned official schema defines `PositionalArgument` as verbatim input and `valueHint` as an identifier not part of the command line. `Input.value` marks fixed values, absent value permits input, and `placeholder` is guidance. No speculative renderer/framework, shell interpolation or new syntax is introduced.

Official schema local path `.scratch/registry-validation/server.schema.json`, version2025-12-11, SHA256 `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0`. Full draft07 validation uses existing PowerShell7.6.9 `Test-Json`/JsonSchema.Net7, not these focused assertions as a partial schema validator. Its prior success qualifies the old descriptor only. Revalidate the corrected descriptor with that same complete validator.

Reuse unchanged Architect read-only interface approval supplied in this task and canonical status history2026-11-05. Names/payload/launch meaning are unchanged. Decomposition triggers1NO,2NO,3NO,4NO,5NO for changed cross-unit obligations: one existing metadata array and native contract suite, no new state or split proof chain. The inline positive specimen is test-only calibration of that approved five-slot contract, not a new schema/interface. No additional review is triggered unless implementation needs a real contract delta.

Registry is a real external publication boundary. Authentication/namespace rights, publisher qualification, authorized actual wire acceptance/listing and readback remain required separately and are not run here. No intended Registry-consuming client is identified. Listing acceptance cannot certify every client's prompts/rendering. Prior manual OpenCode launch used explicit configuration, not Registry-generated configuration. No consuming-client integration gate is invented or claimed passed. This packet is enabling compatibility proof, not completed Registry/public delivery or full-release proof.

## Maintained tests and ordered run sequence

Windows PowerShell, project Node24.22.2 at repository-root `.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe`. From the implementation worktree use that existing absolute executable path. Native finite metadata/parser checks are representative, own no processes/state/credentials and require no managed environment. Ignored scratch `.scratch/registry-argv-prep/` holds failure logs only.

1. `node --check tests/release-metadata.test.mjs`, scoped `git diff --check` (10s). Existing local Prettier `--check` for the three owned paths and, after correction, `server.json` (20s). Tests/OpenSpec are formatter-excluded, so readability review is separate from format-policy execution.
2. `node --test tests/release-metadata.test.mjs` (20s). Before correction expect one real metadata RED. After correction require9/9 GREEN including the unchanged real-file assertion. No synthetic fixture substitutes for the descriptor.
3. After correction, `Test-Json -Path server.json -SchemaFile .scratch/registry-validation/server.schema.json -ErrorAction Stop` (20s), require true and zero errors, with the pinned hash confirmed. No network, install or partial validator. Record corrected metadata hash and source gross.
4. Check local Markdown targets in tasks/brief, syntax, scoped whitespace and exact changed-path boundary. Independently verify the immutable correction candidate and separate cleanup status. Reuse runtime/native/pack evidence rather than replaying app/build/pack.

`PREVIEW-REGISTRY-ARGV` verifies exact five slots, required constants, two value-absent nonsecret inputs, labels and no defaults, then maps synthetic operator inputs and invokes the actual parser. It asserts one `mcp` positional and exact owner/path options, preserving a synthetic spaced Windows absolute path as one argv element. It also checks absence of remote/environment/runtime argument metadata.

`PREVIEW-REGISTRY-ARGV-CONTROLS` accepts the approved inline positional specimen. Table-driven mutations reject missing/reordered slots, equals/combined tokens, named encoding, fixed/default inputs, optional/secret inputs and quote insertion. Actual parser negatives reject equals/combined/missing-value tokens and requireOptions rejects absent state-dir. Reordered metadata rejection does not imply the parser forbids reordered options.

## Preparation evidence - 2026-11-05

- Project Windows Node24.22.2: syntax and scoped whitespace PASS. Schema hash matches pinned bytes. Maintained unfiltered metadata suite9 tests:8 PASS/1 expected RED, exit1,77.6594ms, zero cancelled/skipped/todo. Log `.scratch/registry-argv-prep/red.tap` contains Node's text reporter output, not TAP protocol. Stderr retained alongside it.
- Real-file test reaches no-remote/environment checks and array length, then stops at3 versus5. Its later slot/argv/parser assertions are UNREACHED on current metadata. Calibration reaches and passes exact five-slot mapping, spaced path through actual parser, all11 metadata mutations and four parser/required-option negative cases. Original identity/license/description assertions remain PASS. No semantic fix is claimed.
- Cleanup: no runtime, broker, socket, auth or external client was invoked. Tests allocate only in-memory specimens and read local files. Owned ignored failure evidence retained for handoff, no fixture files to remove. Existing worktree remains active/retain, not cleanup-ready.
- Reuse integrated portable gate `02adab9c` for unchanged production `91c79d27`, as scoped in [integrated verdict](04e-final-candidate-selection.md#independent-applicability-verdict---2026-11-05). No app/build/pack replay, public bytes/hash replay, or expansion of supplied manual first-use evidence.
- Complete packet ceiling600 gross. Forecast preparation220 + source ceiling120 + later evidence60 =400, with200 reserve. Count owned additions plus deletions against preparation baseline, including this brief and tasks. This is not a whole-PR exception or a new landing approval.
- Final preparation147 gross/3 paths: test86 additions/3 deletions, tasks2 additions, brief56 additions. Source ceiling120 plus later evidence60 gives327/600. Syntax/scoped whitespace/format-policy PASS, four brief local link targets PASS and tasks-to-brief target exists. Tests/OpenSpec are formatter-excluded, not claimed reformatted. No source or metadata edit occurred.

Next action: coordination routes the single-file correction to implementation, then independent affected verification. Registry publisher/auth/listing/readback, owner review, actual PR CI, finalization/archive/landing remain separate unmet obligations.
