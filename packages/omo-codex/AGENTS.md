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

<<<<<<< HEAD
## COMMANDS
`bun run build:codex-install` rebuilds installer bundles; package scripts expose typecheck/test/build:plugin/sync:skills.
`export CODEX_HOME="$(mktemp -d)/codex"`, then `node packages/omo-codex/scripts/install-local.mjs install`, then `bun run test:codex`.
Marketplace sync copies manifests/plugin payload, bundles MCP and root CLI runtimes, rewrites MCP paths, and validates before publication; stable release automation is gated by an empty dist_tag.
=======
**sync-skills pipeline** (`plugin/scripts/sync-skills.mjs`, run by the plugin build): wipes `plugin/skills/` → copies 10 COMPONENT skills first (`comment-checker`, `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor`, `lsp`, `rules`, `teammode`, `ulw-loop`, `ulw-plan`, `ultrawork` from `plugin/components/*/skills/*`; same-named shared skills are skipped) → copies remaining shared skills → `adaptSkillForCodex()` inserts Codex Harness Tool Compatibility guidance, applies overlays (`ulw-execute` / `review-work`), and writes `agents/openai.yaml` display metadata with the `(OmO) ` prefix.

**Ultrawork skill pointer:** the ultrawork `UserPromptSubmit` hook injects a compact `<ultrawork-mode>` pointer (<4096 bytes; Codex App truncates large hook output) directing the model to read the full directive from the bundled `ultrawork` skill; full-directive fallback when the skills tree is absent. Mirror copy in `ulw-loop/src/ultrawork-skill-pointer.ts`; byte-identity pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`.

## INSTALL (mechanics)

Source entry: `src/install/install-codex.ts` plus `src/install/install-local-cli.ts`; generated Node entrypoints live at `packages/omo-codex/scripts/install*.mjs` for stable published paths. Targets: plugin cache `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`; local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`; durable agent TOML copies under `~/.codex/agents/`; enables `omo@sisyphuslabs` in `~/.codex/config.toml`; component CLIs into the resolved bin dir: explicit `CODEX_LOCAL_BIN_DIR` / `binDir` option, else `<codexHome>/bin` when `CODEX_HOME` is non-default, else `~/.local/bin` (`codex-installer-bin-dir.ts`). The installer records that directory in `.installed-bin-dir.json` beside the plugin cache (`codex-installed-bin-dir.ts`), because `CODEX_LOCAL_BIN_DIR` is typically a one-shot override a later uninstall cannot recompute; `codex-cleanup.ts` reads the manifest BEFORE removing managed state, since the manifest lives inside the trees being deleted. Windows: Git Bash preflight discovers `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, then PATH; if missing, it prints manual install guidance and stops without running `winget`. Non-Windows keeps the `git_bash` MCP manifest bundled but writes `enabled = false`.

## UNIFIED CONFIG (omo.jsonc)

The Codex config loader (`plugin/shared/src/config-loader.ts`, `getCodexOmoConfig()`) reads the unified config surface through `@oh-my-opencode/omo-config-core` (imported by relative source path, keeping the plugin bundle dependency-clean): user layer `~/.omo/omo.jsonc` plus walked project `.omo/omo.json[c]` layers, resolved as the `[codex]` view (shared base -> `[codex]` -> `profiles.<P>` -> `profiles.<P>.[codex]`). Unsupported keys and all loader/migration diagnostics surface as `warnings` on the result. Before reading, the loader runs `runCodexStartupMigration()`, which invokes ONLY the `2026-07-codex-config-jsonc` migration group: `~/.omo/config.jsonc` (plus its sidecar) imports into `~/.omo/omo.jsonc` via the shared lock+journal engine, no-clobber with skipped-value diagnostics, sources moving to `~/.omo/migration-backup-<UTC-ts>-opencode-config/.omo/`. The `oh-my-*` group is owned by the opencode/senpi side; whichever harness runs first applies each group exactly once via `_migrations` markers. Full semantics: [`docs/reference/omo-json.md`](../../docs/reference/omo-json.md).

## CONFIG MIGRATION (SessionStart)

The plugin `SessionStart` hook (matcher `^startup$`) runs `plugin/scripts/auto-update.mjs` → `migrateCodexConfig()` over `~/.codex/config.toml` + any project `.codex/config.toml`, before the update throttle. Healthy marketplace-managed installs still skip npx self-update and point users at `codex plugin marketplace upgrade sisyphuslabs`; stale local marketplace cache/bin state is the exception, and starts the npx installer as a local repair when the cached marketplace manifest or managed component bins point at missing OMO payloads. Beyond syncing the managed reasoning profile from `plugin/model-catalog.json`, it runs a **model-aware** MultiAgentV2 guard via `forceDisableMultiAgentV2()` (`plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`):

- If the selected root `model` (or SessionStart hook `model`, which wins when present) resolves to `multi_agent_version: "v2"` in `CODEX_HOME/models_cache.json` (GPT-6 Astra and GPT-5.6 terra/sol families), or the catalog is unavailable but the effective session model is `gpt-6*` or `gpt-5.6*` (`prefersMultiAgentV2()`), the guard **clears** managed `enabled = false` / `#26753` comments **and** any `hide_spawn_agent_metadata = false` (written by OMO installers <= 4.15.x; it re-adds agent_type/model properties to spawn_agent and mismatches the reserved schema, 400 on codex-cli 0.144.1), leaving V2 unset so Codex can follow the reserved `collaboration.spawn_agent` schema (lazycodex#118 / oh-my-openagent#6002). On that same V2-preferred signal `ensureSubagentConcurrencyLimit()` also removes `agents.max_threads` (invalid while V2 is active). Thread caps are never inserted or raised: `max_concurrent_threads_per_session` is left alone unless it carries a value LazyCodex itself used to write (`1000` or `16`), in which case the key is removed so Codex stock defaults apply; any other user value is preserved.
- On the SessionStart hook CLI path, if the active session model cannot be read from stdin, the guard **skips** force-disable instead of assuming the config.toml default (so `codex -m gpt-5.6-terra` cannot be broken by a stale default model line).
- Otherwise it keeps the openai/codex#26753 force-disable path: write `[features.multi_agent_v2] enabled = false` and flip `enabled = true`.
- On **every** path (including the skip paths above) the guard first removes the `[features]` boolean shorthand `multi_agent_v2 = true|false`: a boolean key plus the same-name table that `ensureSubagentConcurrencyLimit()` appends would be invalid TOML.

The installer (`src/install/codex-multi-agent-v2-config.ts`) mirrors the migration's model awareness via `resolveCodexMultiAgentVersion()` (root `model` against `models_cache.json` next to config.toml; `gpt-6*` and `gpt-5.6*` count as V2 when the catalog is missing): it never enables V2 and never writes a thread cap. Neither `agents.max_threads` nor `features.multi_agent_v2.max_concurrent_threads_per_session` is inserted; an existing key holding a value LazyCodex previously wrote (`1000` for `agents.max_threads`; `1000` or `16` for `max_concurrent_threads_per_session`) is removed so Codex stock defaults apply, and any other user-set value is left untouched, never raised. On V1/unknown models it converts a `multi_agent_v2 = false` shorthand into table-form `enabled = false`; on V2-preferred models it removes `agents.max_threads` and does NOT materialize the disable (a config-level disable 400s the reserved collaboration.spawn_agent schema, #6008). The migration's `ensureSubagentConcurrencyLimit()` mirrors the same no-insert / remove-own-value / preserve-user-value rules.

## DEFAULT MODEL CATALOG

Three mirrored sources define the managed model defaults and must agree: `plugin/model-catalog.json`, `plugin/scripts/migrate-codex-config/catalog.mjs` (`FALLBACK_CATALOG`), and `src/install/codex-model-catalog.ts`. The current catalog version is `2026-11-20.gpt-6.2-astra-600k-high`: root `model = "gpt-6.2-astra"`, `model_context_window = 600000`, `model_reasoning_effort = "high"`, `plan_mode_reasoning_effort = "xhigh"`; the `worker` and `verifier` roles are `gpt-6.2-astra` at `high`. The 600k window matches GPT-6 Astra's: openai/codex `models.json` gives `gpt-6-astra` and `gpt-6.2-astra` the same `context_window` 272000 and `max_context_window` 872000. Managed legacy profiles (the three gpt-5.5 entries, `legacy.gpt-5.6-sol-650k-high` matching `gpt-5.6-sol` / 650000 / high / xhigh, and `legacy.gpt-6-astra-600k-high` matching the previous `gpt-6-astra` / 600000 / high / xhigh default) are upgraded in place to the current values; a root model matching neither the current catalog nor a managed profile is preserved as the user's choice. Ten bundled agent TOMLs under `plugin/components/ultrawork/agents/` run on `gpt-6.2-astra` and the recon pair (`explorer`, `librarian`) on `gpt-6-luna`, each with its per-role `model_reasoning_effort`; `src/install/managed-agent-reasoning-defaults.ts` carries the per-agent upgrade chain from the older gpt-5.6 and `gpt-6-astra` models, and a user-customized effort survives the model move. The Hephaestus bundled rule ships a `gpt-6.md` variant (selected by `packages/rules-engine/src/engine/finder.ts` for any model slug containing `gpt-6`) alongside `gpt-5.5.md` / `gpt-5.6.md`, and the rules `post-compact-budget.ts` table registers `gpt-6.2-astra` / `gpt-6.2-astra-fast` and `gpt-6-astra` / `gpt-6-astra-fast` at 600k. Entry guards for all plugin CLI scripts go through `scripts/entry-guard.mjs` `isCliEntry()`, the plain `pathToFileURL(process.argv[1])` comparison silently no-ops the whole hook when the plugin cache is reached through a symlink. Opt-out: `LAZYCODEX_CONFIG_MIGRATION_DISABLED=1` / `OMO_CODEX_CONFIG_MIGRATION_DISABLED=1`. The hook also emits restart notifications: when an update starts it persists `pendingNotice` ({fromVersion, toVersion, startedAt}) in the auto-update state, and once a later startup runs at >= toVersion it emits an update-completed notice (checked before the throttle, so throttled startups still notify). Non-empty notices are printed as a single stdout JSON line (`hookSpecificOutput.additionalContext`, SessionStart) and audited as `notified` events in the update log; pinned by `plugin/test/auto-update-restart-notice.test.mjs`. Pinned by `plugin/test/migrate-codex-config.test.mjs` (part of `bun run test:codex`).

## TELEMETRY

Event `omo_codex_daily_active`, at most once per UTC day per machine. Two sources: install (`install_completed`) + plugin `SessionStart` (`session_start`). Id `sha256` of the random `install-id` file beside the dedup state `~/.local/share/omo-codex/posthog-activity.json`; PostHog person profiles disabled. Opt-out: `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global `OMO_*` flags also disable). Parity with the main plugin pinned by `src/telemetry/cross-package-equivalence.test.ts`.

## DEPLOY (sync script)

`script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>` copies `marketplace.json` to `.agents/plugins/marketplace.json` and `plugin/` to `plugins/omo/`, bundles LSP/Git Bash MCP runtime dists into `plugins/omo/components/*/dist/`, bundles root CLI runtimes into `plugins/omo/dist/cli` and `plugins/omo/dist/cli-node`, rewrites `.mcp.json` paths, then validates via `script/lazycodex-marketplace-validation.ts`. Mechanism = file copy + commit push, NOT a git subtree. The triggering `publish.yml` behavior (`publish_lazycodex` input + automatic stable-release Codex marketplace sync gated on empty `dist_tag`) is documented in the root `AGENTS.md`.

## NOTES

- `@sisyphuslabs/omo-codex-plugin` (the shipped Codex plugin bundle) is distinct from `@oh-my-opencode/omo-codex` (this adapter package).
- Codex marketplace name is `sisyphuslabs`, never `lazycodex`.
- `@oh-my-opencode/omo-codex` is private (not published to npm on its own); its assets ship via the root `package.json` `files` array.
- `bunfig.toml` excludes `packages/omo-codex/plugin/**` from the root `bun test`; the plugin carries its own `node --test` suite. Full Codex suite: `bun run test:codex`.
- Per-component detail lives in `plugin/components/*/AGENTS.md`; do not duplicate it here.
>>>>>>> origin/dev
