# Scoped preview package correction

Parent: [tasks](../tasks.md). Authority: [proposal](../proposal.md), [npm delta](../specs/npm-distribution/spec.md#requirement-public-package-and-explicit-prerequisites), [design section 8](../design.md#identity-contents-and-installed-behavior), and approved release identity correction brief.

## Goal, baseline and scope

Can an operator install the selected `@meshimize/proceed-mcp@0.1.0-preview.1` artifact while retaining the `proceed-mcp` command and public MCP behavior?

This packet prepares that proof. Actual scoped tarball installation and installed public setup/stdio/tool results are direct local proof. Metadata controls, syntax, build and hashes alone are supporting proxies, not public npm delivery or live Telegram proof.

- Worktree path `.worktree/add-telegram-approval-opencode-v2`, branch/change `add-telegram-approval-opencode-v2`, owner test engineering, status active/retain.
- Corrective baseline `ae3c454d264e02b2b6c1bc9ddd82c90c4f8c14cc`, existing source `09ab9312`, original target `main` at `f385409792aff3d46d96b5c4f03358f10c8dc5ba`.
- Prerequisite: existing Packet A implementation and installed-runner repair are present on this one change branch. One OpenSpec PR, internal sequential commits only. No new worktree or independent landing.
- Preserve all pre-existing dirty owner docs and unknown untracked material listed in the original [delivery brief](04-preview-delivery.md). Do not commit them here. No concurrent Git writers during the owned commit.
- Forecast against the corrective baseline: tests/helpers <=220 gross, tasks/slice <=150, source <=80, verification/evidence reserve100 =550 gross across <=8 paths. Stop before600 rather than compress readability. Original Packet A535 remains historical, not retroactive scoped proof or a renewed source allocation. This packet does not resolve the whole-PR size gate.

## Exact source handoff

Only these three source paths are proposed, combined ceiling80 gross additions plus deletions:

| Path | Required correction |
| --- | --- |
| `package.json` | Name `@meshimize/proceed-mcp`, version unchanged `0.1.0-preview.1`. Canonical `publishConfig.access:public` and `publishConfig.tag:preview`. Accurate portable Telegram approval/MCP description, not an exact OpenCode-session continuation claim. |
| `package-lock.json` | Match top-level and `packages[""].name` to scoped identity. Preserve root version/license/engine/bin agreement and existing dependency resolution. No dependency churn. |
| `server.json` | npm package identifier `@meshimize/proceed-mcp`, same exact preview version. Accurate portable description without an OpenCode-only or automatic continuation claim. |

Preserve executable `bin.proceed-mcp = bin/proceed-mcp.js`, MCP display name `proceed-mcp`, protocol `2025-11-25`, tool names/schemas/authority, `mcpName` and Registry name `io.github.renl/proceed-mcp`, repository `https://github.com/renl/proceed-mcp`, MIT and Ng Cheng Leong attribution. No app code, license rewrite, README, CI or release-framework change. Return a gap if a fourth source path is actually necessary. Description assertions permit different accurate wording rather than enforcing exact copy.

Rights/2FA/organization-write permission for intended account `davemeshimize` are later publication gates. Unknown rights do not block this local name correction. No npmrc, ambient credentials, state, network publication, global install, Telegram, push, PR, merge or archive authority follows.

## Tests and affected validation sequence

Windows PowerShell, project-local Node24.22.2, native representative for Windows npm shim paths and protected local state. Ambient Node26 is not the qualified runtime. Set `$node` to the resolved `../../.tools/readiness-node24/node_modules/node-win-x64/bin/node.exe` from this worktree. Do not install a toolchain.

1. Run `& $node --check <file>` on `tests/release-metadata.test.mjs`, `tests/release-pack.mjs`, `tests/release-installed.test.mjs`. Format command: `& $node node_modules/prettier/bin/prettier.cjs --check <owned-paths>`. Existing policy excludes tests/OpenSpec, so this is policy compliance, not their formatting proof. Review readable formatting and run scoped `git diff --check`.
2. `& $node --test --test-reporter=tap tests/release-metadata.test.mjs`, bounded15s. PREVIEW-SCOPE binds both lock roots/manifest/Registry npm identifier. PREVIEW-PUBLIC requires canonical public/preview config. PREVIEW-DESCRIPTION checks meaning on both surfaces. PREVIEW-CONTROLS tests corrected excerpts and rejects identity/config/description mutations. Existing META/LICENSE/REGISTRY retain unchanged version/bin/engine/namespace/license proof. Corrected excerpts are assertion calibration only, never a successful pack fixture.
3. After actual metadata GREEN, `& $node scripts/build.mjs`, bounded30s. Reuse unchanged native app/CLI/bin/protocol evidence from [Packet A](04-preview-delivery.md#independent-packet-a-verdict---2026-11-05) within its exact source/assertion scope. No wholesale app-suite rerun for this name correction. Any unexpected app/config/dependency change returns for affected re-validation.
4. Bind `PROCEED_TEST_NPM_CLI` to the approved explicit npm-cli.js path, then `& $node tests/release-pack.mjs`, outer160s. If the approved path is unavailable, report it rather than discover external config. The maintained150s runner owns phase records, teardown reserve, empty isolated npm config, local cache/log/temp and offline pack/install with scripts disabled. No ambient auth reads or registry fetches. No new harness.
5. Actual npm pack must produce `meshimize-proceed-mcp-0.1.0-preview.1.tgz`, scoped name and preview version. Record fresh SHA-256/inventory, assert mandatory LICENSE/README/package inclusion and existing strict secret-safe runtime inventory. LICENSE need not be added to `files`: npm mandatory inclusion and actual packed evidence govern. Install the exact tarball into the fresh spaced prefix with `--omit=dev`, no global install or dev dependencies. Assert installed `node_modules/@meshimize/proceed-mcp` bytes match inputs. Inspect actual installed README scoped install/launch examples and persist its hash. Name and README changes invalidate the old tarball hash.
6. Runner invokes installed test with explicit prefix/bin bindings. Derive unchanged named npm shim from prefix `node_modules/.bin`, not the extra scoped parent. Retain Windows-safe literal cmd quoting and path-character guard. Preserve protected init/overwrite refusal, stopped owner add, tokenless serve/status, public stdio initialize/name/version/protocol/catalog/EOF, prepare authority, exact NOT_PAIRED, empty actionable inventory and privacy assertions. These remain UNEXECUTED against the scoped artifact until source migration and actual pack/install run. Never substitute repository-bin or fake identity results.
7. Record assertions and cleanup separately. Existing runner removes only its owned install/cache/stage and managed broker/adapter/state. Persist progress, artifact, README, installed TAP and cleanup records under `.scratch/preview-package`. Preserve old failed/successful runs. Check relevant local links and strict OpenSpec structure without treating structure as behavior. No scoped artifact readiness claim before independent affected verification.

## Boundary Verification and decomposition

Normative package boundary reuses approved design section8 and the npm delta's organization-identity scenario. Exact name mapping is npm artifact `proceed-mcp` -> `@meshimize/proceed-mcp` only. Executable/MCP/Registry identities are explicitly not renamed. Local proof is actual npm pack/install plus existing public stdio JSON-RPC, not a new wire or invented auth contract. External npm delivery and Registry schema/auth/listing remain separate later real-boundary gates. Unchanged Telegram boundary stays deferred/unverified under the approved preview decision.

Trigger checklist for genuinely changed cross-unit obligations: 1 NO, 2 NO, 3 NO, 4 NO, 5 NO. This is an approved identity alignment in the same existing runner, with unchanged clean setup/proof order and no new receiver, state contract, split unit or proof chain. Prior reviewed boundaries are reused, not redesigned. No further full architecture review is required absent a normative gap.

## Preparation evidence

- Candidate `ae3c454d`, known owner changes preserved. Project Node24.22.2 on Windows. Three changed JavaScript files pass syntax.
- Metadata command exit1:4 PASS/3 meaningful expected RED, zero skipped/cancelled/todo. RED is unscoped name, absent public publishConfig and host-coupled description. Corrected-excerpt positive controls and independent mutations PASS. Existing metadata/license/Registry consistency checks PASS only for their unchanged assertion scopes, not scoped artifact delivery.
- Installed admission command without explicit binding exits1,0/1 prerequisite RED. No service, package install, state or npm process started. Actual scoped tarball/installed behavior and new hashes remain pending implementation.
- Ignored evidence `.scratch/release-scope/metadata-red.tap`, `metadata-red.stderr`, `installed-admission.tap`, `installed-admission.stderr`. These are diagnostic logs, not shipped files. No owned runtime resources to tear down. Worktree retained, no removal due. Next action three-path source correction through coordination, then ordered affected checks above and independent verification.
- Scoped whitespace and local link/anchor checks PASS. Formatter policy exits0 but excludes these tests/OpenSpec, not their formatting proof. Readable formatting reviewed. Pinned CLI strict validation exits0, `Change 'add-telegram-approval-opencode-v2' is valid`, empty stderr, evidence `strict.stdout`/`strict.stderr` in the same scratch directory. Structural PASS only.
- Owned setup measures158 gross/5 paths against `ae3c454d`, including this new slice. Source80 plus untouched verification reserve100 yields338 forecast, within600. Setup is ready for the bounded source correction, not scoped artifact acceptance. Preserved owner/unknown files remain outside this commit.
