# omo-codex - Codex Light Edition

## OVERVIEW
Private Codex adapter combining a vendored plugin, TypeScript installer, and telemetry; public distribution uses `lazycodex-ai`.

Score: 10; distinct adapter domain with its own plugin lifecycle, install contract, and release integration.
`lazycodex` remains the repository/bin identity; marketplace `sisyphuslabs`, plugin `omo`, reference `omo@sisyphuslabs`.
The shipped `@sisyphuslabs/omo-codex-plugin` differs from private workspace `@oh-my-opencode/omo-codex`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change installation or cleanup | `src/` | Own source guide; bundled Node entries stay at stable published paths |
| Inspect lifecycle wiring | `plugin/.codex-plugin/plugin.json`, `plugin/hooks/` | Build assembles component hook definitions |
| Inspect component behavior | `plugin/components/*/AGENTS.md` | Local rules and runner choices |
| Assemble skill payload | `plugin/scripts/sync-skills.mjs` | Component skills first, remaining shared skills second |
| Change marketplace identity | `marketplace.json`, `MARKETPLACE.md` | One installable `omo` plugin |
| Change unified configuration | `plugin/shared/src/config-loader.ts` | Shared config core, codex view, warning diagnostics |
| Change startup migration | `plugin/scripts/auto-update.mjs`, `plugin/scripts/migrate-codex-config/` | Migration precedes update throttling |
| Change managed models | `plugin/model-catalog.json`, `plugin/scripts/migrate-codex-config/catalog.mjs`, `src/install/codex-model-catalog.ts` | Three mirrored default sources must agree |
| Sync marketplace release | `../../script/sync-lazycodex-marketplace.ts` | Copy plus validation; no git subtree |

## MANDATORY CODEX QA
Any Codex-connected code change requires a real locally installed isolated Codex: plugin/components, installer, migration, telemetry, or hook wiring. ALWAYS. EVERY TIME. NO EXCEPTIONS.
Typecheck and green unit tests are not QA. NO EVIDENCE == NO QA == NO COMMIT == NO PUSH.
1. Point `CODEX_HOME` at a throwaway directory and install this checkout's local build, never the published package.
2. Run `bun run test:codex`, the installer/migration/plugin compatibility gate used across CI platforms.
3. Drive real Codex under tmux in that isolated home; confirm plugin enablement and hook execution.
4. Confirm the real `~/.codex/config.toml` is untouched; record exact commands/output, isolated-install transcript, real-home before/after, and intended behavior under `.omo/evidence/<YYYYMMDD>-<short-slug>/`; include the evidence summary in the PR body.
Confirm all lifecycle hooks fire: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostCompact, Stop, SubagentStop.
`CODEX_HOME` and `OMO_CODEX_PROJECT` select isolated home/project scope; preserve the real config, plugins, and agents.
`bun run install:codex-dev` instead modifies the real home for dogfooding; it never replaces isolated QA.
Dev stamping uses `LAZYCODEX_DEV_VERSION` (default `dev`) for cache, manifest, and per-turn prefix; `lazycodex-version-stamp.ts` owns resolution.

## CONVENTIONS
- Ten component workspaces: comment-checker, git-bash, lazycodex-executor-verify, lsp, rules, ulw-execute-continuation, teammode, telemetry, ultrawork, ulw-loop.
- Bootstrap builds standalone outside workspaces; test-support is a helper directory; lcx is a skills-only carrier. Removed workflow-selector is not a live component.
- Skill assembly wipes aggregate `plugin/skills/`, prefers component names, adapts shared content/tools and ulw-execute/review-work overlays, then writes `agents/openai.yaml` metadata with `(OmO) ` display prefixes.
- Ultrawork uses a pointer below 4,096 bytes plus full-skill read; fallback embeds the directive only when the skill tree is missing. Its ulw-loop mirror must remain byte-identical.
- Cache: `<CODEX_HOME>/plugins/cache/sisyphuslabs/omo/<version>/`; marketplace snapshot: `.tmp/marketplaces/sisyphuslabs/plugins/omo/`; durable agent TOMLs: `agents/`.
- The installer enables `omo@sisyphuslabs` in config.toml; installed bin location is recorded beside cache state for later cleanup.
- Windows Git Bash discovery uses `OMO_CODEX_GIT_BASH_PATH`, standard install locations, then PATH; absence prints guidance and stops without winget. Other platforms retain the manifest with git_bash disabled.
- Unified config resolves shared base, codex view, profile, then profile codex view from `~/.omo/omo.jsonc` and walked project layers; unsupported keys/diagnostics become warnings.
- Startup migration owns only `2026-07-codex-config-jsonc`: legacy config plus sidecar import through the shared no-clobber lock/journal engine, backup, skipped-value diagnostics, and once-only migration markers. OpenCode/Senpi owns the oh-my migration group.
- Startup hook matcher is `^startup$`; selected session model overrides config defaults. Missing stdin model skips force-disable rather than guessing the config model.
- V2 catalog preference, or GPT-5.6/GPT-6 without catalog evidence, clears managed disable/#26753 and obsolete `hide_spawn_agent_metadata = false`; it leaves V2 unset and removes incompatible `agents.max_threads`.
- V1/unknown keeps the force-disable workaround. Always remove boolean multi_agent_v2 shorthand before a same-named table. Never insert/raise thread caps: remove own historical 1000/16 values, preserve other user values except V2-incompatible agents.max_threads.
- Current managed catalog: `2026-09-08.gpt-6-astra-600k-high`; root GPT-6 Astra, 600000 context, high reasoning/xhigh planning; worker/verifier high. Upgrade managed legacy profiles and 12 bundled agent models while retaining custom root models and per-agent effort.
- Hephaestus rules select the gpt-6 variant; post-compact budget includes Astra/Astra-fast at 600k. Keep matching catalog and rule sources synchronized.
- All plugin CLI guards use `plugin/scripts/entry-guard.mjs` `isCliEntry()`; naive argv URL equality fails through symlinked plugin caches.
- Migration opt-outs: `LAZYCODEX_CONFIG_MIGRATION_DISABLED=1` or `OMO_CODEX_CONFIG_MIGRATION_DISABLED=1`.
- Healthy marketplace installs skip npx updates and direct upgrades to `codex plugin marketplace upgrade sisyphuslabs`; missing managed payload/bin state permits local repair.
- pendingNotice survives the update throttle; a later sufficiently new startup emits one stdout JSON context line and audits the notification.
- Activity event `omo_codex_daily_active` fires at most once per UTC day/machine for install or startup; install-id is hashed and person profiles are disabled.
- Telemetry opt-outs: `OMO_CODEX_DISABLE_POSTHOG=1`, `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0`, or global OMO flags; equivalence is checked in `src/telemetry/`.

## ANTI-PATTERNS
- Never QA against the published package or the real `~/.codex`.
- Never hand-edit generated installer bundles, hook stamps, or aggregate skills; change their sources and rebuild.
- Never rewrite config.toml wholesale or remove paths lacking managed ownership evidence.
- Never force MultiAgentV2 enabled or silently raise user thread limits.
- Never register a component MCP outside aggregate `.mcp.json`.
- Marketplace is named sisyphuslabs, never lazycodex; this private workspace does not publish independently.
- Do not infer plugin coverage from root `bun test`; root excludes `plugin/**`, whose Node tests and component suites have separate runners.

## COMMANDS
`bun run build:codex-install` rebuilds installer bundles; package scripts expose typecheck/test/build:plugin/sync:skills.
`export CODEX_HOME="$(mktemp -d)/codex"`, then `node packages/omo-codex/scripts/install-local.mjs install`, then `bun run test:codex`.
Marketplace sync copies manifests/plugin payload, bundles MCP and root CLI runtimes, rewrites MCP paths, and validates before publication; stable release automation is gated by an empty dist_tag.
