# omo-opencode src - Plugin Source

## OVERVIEW
OpenCode-facing composition of agent factories, tools, hooks, configuration, CLI, integrations, and shared-Core shims.

**Score:** 13; distinct domain: plugin initialization and the host-facing source boundary.
Measured: 2,849 files, 20 immediate subdirectories, 97% code, index.ts boundary, more than 30 functions and 10 exports; reference centrality unmeasured.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin entry | index.ts | createPluginModule server plus opencode-v2 setup |
| Full startup and disposal | testing/create-plugin-module.ts | Config, migration, auth, telemetry, runtime, managers/tools/hooks |
| OpenCode hook interface | plugin-interface.ts | Host hook contract; extra compaction handlers wired at startup |
| Factory composition | create-{managers,tools,hooks}.ts | Managers, registry, hook tiers |
| Model cache | plugin-state.ts | Cache shared by handlers |
| Configuration | plugin-config.ts, plugin-config/, config/ | Walked config chain, validation, protected user view |
| Handler config phases | plugin-handlers/ | Agent/provider/tool configuration pipeline |
| Hook tiers | plugin/hooks/ | Session, tool guard, transform, continuation, skill composition |
| Core-backed adapter helpers | shared/ | Existing utilities and stable shims |
| Lifecycle and background work | hooks/, features/background-agent/ | Fallback, recovery, parent wake, concurrency |
| Agents and tools | agents/, tools/ | Persona factories and native registry surfaces |
| CLI and migration | cli/, config-migration/ | Install/run/doctor and reusable migration plans |
| MCP and external integrations | mcp/, openclaw/ | Built-in MCPs and bidirectional service bridge |
| OpenCode v2 | opencode-v2/ | Separate setup/server adaptation |

## STRUCTURE

- Primary adapter domains: agents, hooks, tools, features, shared, cli, config, plugin, plugin-handlers, plugin-config, config-migration, opencode-v2, openclaw, mcp, testing.
- Supporting directories: __tests__, generated, help, locales, types. Consult deeper guidance before editing their domain.

## CONVENTIONS

- Plugin API wiring is concentrated in plugin-interface.ts and startup, with separate v2 adaptation; do not treat the older seven-step startup sketch as exhaustive.
- createHooks composes session/tool-guard/transform tiers plus continuation and skill tiers; enabled slots depend on team and monitor configuration, so inspect composers instead of copying totals.
- Within a module use relative imports; across modules use barrels. Path aliases are forbidden.
- Reach for shared/ before adding helper logic elsewhere; duplicate utilities are review defects.
- Config merges deep agent/category/claude_code records and unions disabled lists; mcp_env_allowlist and playwright_mcp_args remain user-only security controls.
- Model fallback applies armed fallback state through chat.message; runtime-fallback is a separate reactive hook surface. Do not describe model-fallback as a chat.params-only handler.

## REQUIRED REAL-OPENCODE QA

- Every edit here to hooks, tools, agents, features, schemas, MCPs, CLI, handlers, or other host-connected behavior requires real OpenCode QA. ALWAYS. EVERY TIME. NO EXCEPTIONS.
- Typecheck and green bun test are not QA. Drive real OpenCode and record evidence; no evidence means no QA, no commit, no push.
- Always use the opencode-qa skill at .agents/skills/opencode-qa/ to map expected impact and the full change scope before and after the edit.
- Route proof through CLI, server/SSE, TUI smoke, or DB inspection as the skill requires; use structured events to assert tool behavior and prove the matching lifecycle hook/event fired.
- Every OpenCode spawn uses isolated XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, and XDG_CACHE_HOME temp directories.
- Never pollute the real ~/.local/share/opencode/opencode.db; prove its SELECT count(*) FROM session is unchanged before and after QA.
- Preserve the skill's tmux TUI-smoke and interactive-driving procedure; assert real behavior through opencode run or server API plus SSE rather than pane text.
- Evidence belongs under .omo/evidence/<YYYYMMDD>-<short-slug>/, one gitignored folder per change; record before/after, exact commands/output, isolation proof, no regression, and the intended behavior observed. PR bodies carry the summary.

## ANTI-PATTERNS

- Never bypass protected user-only config settings with project overrides.
- Never duplicate extracted Core implementations inside an adapter shim.
- Never certify a lifecycle change from unit assertions without the real event-wire proof above.

## COMMANDS

- bun test packages/omo-opencode/src
- tsgo --noEmit -p packages/omo-opencode/tsconfig.json
- bun run build (root); use the opencode-qa router for live proof.
