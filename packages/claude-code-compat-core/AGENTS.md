# claude-code-compat-core

## OVERVIEW
Harness-neutral compatibility loaders translate Claude Code plugins, commands, agents, and MCP configuration for adapter consumption.

Score: 12; distinct domain: compatibility package and four loader boundaries.
Measured: 83 files, 94% code, local configuration, barrel boundary, 179 AST declarations, 124 exported declarations.
Reference centrality is unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect package export contract | `package.json` | Root and four loader subpaths, including wildcard files |
| Find root import surface | `src/index.ts` | Re-exports the four feature barrels |
| Load installed plugin components | `src/features/claude-code-plugin-loader/` | Commands, skills, agents, MCP servers, hooks |
| Load user/project/local MCP config | `src/features/claude-code-mcp-loader/` | Translation and environment expansion |
| Load slash commands | `src/features/claude-code-command-loader/` | Markdown command sources |
| Load agent definitions | `src/features/claude-code-agent-loader/` | Markdown and JSON definitions |
| Find shared parsing/path helpers | `src/shared/index.ts` | Config dirs, frontmatter, models, paths, Bun shims |
| Change source rules | `src/AGENTS.md` | Discovery, scope and trust boundaries |

## CONVENTIONS
- Package identity is `@oh-my-opencode/claude-code-compat-core`; it is a private raw-TypeScript workspace.
- OpenCode compatibility paths remain thin shim re-exports of this package.
- Dependencies are `model-core` and `utils`; host-specific wiring belongs to consumers.
- Tests sit beside each feature's implementation as `*.test.ts`.

## ANTI-PATTERNS
- Never duplicate loader implementations in adapter shims.
- Never let project configuration override user-only `mcp_env_allowlist` or `playwright_mcp_args`.
- Never remove plugin/MCP scope filtering when consolidating loader entrypoints.

## COMMANDS
From this package: `bun run typecheck` uses tsgo; `bun run test` runs its co-located Bun tests.
