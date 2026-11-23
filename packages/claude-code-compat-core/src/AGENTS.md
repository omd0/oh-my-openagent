# Claude Code compatibility source

## OVERVIEW
Four feature loaders discover external definitions, apply source-scope rules, and produce adapter-ready configuration.

Score: 11; distinct domain: discovery and translation internals.
Measured: 78 TypeScript files, 179 AST declarations, 124 exported declarations; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Walk installed plugin trees | `features/claude-code-plugin-loader/discovery.ts` | Discovery tests cover the broadest input surface |
| Resolve plugin artifacts | `features/claude-code-plugin-loader/{plugin-path-resolver,install-path-resolver,plugin-manifest}.ts` | Install layout and manifest resolution |
| Assemble plugin components | `features/claude-code-plugin-loader/loader.ts` | `PluginComponentsResult` |
| Translate MCP configuration | `features/claude-code-mcp-loader/loader.ts` | User, project and local sources |
| Expand environment references | `features/claude-code-mcp-loader/env-expander.ts` | Trust flag and blocked-variable logging |
| Configure allowed variable names | `features/claude-code-mcp-loader/configure-allowed-env-vars.ts` | Builtin names plus additional user allowances |
| Filter sources by scope | `features/claude-code-{plugin,mcp}-loader/scope-filter.ts` | Scope-specific acceptance |
| Parse agent sources | `features/claude-code-agent-loader/agent-definitions-loader.ts` | Markdown definitions and discovery |
| Translate Claude model names | `features/claude-code-agent-loader/claude-model-mapper.ts` | Model-name normalization |
| Parse JSON agents | `features/claude-code-agent-loader/json-agent-loader.ts` | JSON definition path |
| Share low-level helpers | `shared/index.ts` | Path/config/frontmatter/model utilities |

## CONVENTIONS
- Plugin discovery, manifest resolution, and component loading remain separate operations.
- Each feature exposes its public surface through its own `index.ts`.
- Untrusted environment expansion consults the builtin-plus-configured allowlist.
- `ExpandEnvVarsOptions.trusted` explicitly carries trust into shared expansion helpers.
- Sensitive-name detection and allowed-name selection are separate checks.
- Additional allowed variable names are module state with an explicit reset function.

## ANTI-PATTERNS
- Never bypass the expansion policy with direct `${VAR}` substitution in a loader.
- Never leave additional allowed names installed between tests that require default policy.
- Never infer a plugin's installed path from its display name alone; use the path resolvers.

## CHECKS
Discovery changes need `features/claude-code-plugin-loader/discovery.test.ts`.
Environment or scope changes need their feature-local expansion, loader and filtering tests.
