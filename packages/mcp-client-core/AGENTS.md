# mcp-client-core

## OVERVIEW
Harness-neutral MCP client lifecycle and OAuth primitives support skill-embedded stdio and remote servers.

Score: 12; distinct domain: shared MCP client package and adapter-facing boundary.
Measured: 63 files, 92% code, local configuration, barrel boundary, 223 AST declarations, 127 exported declarations.
Reference centrality receives no score; scanner importer counts are textual proxies.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect package imports | `package.json`, `src/index.ts` | Root, OAuth and skill-manager raw-TS exports |
| Manage skill clients | `src/skill-mcp-manager/manager.ts` | Tools, resources, prompts and auth retry |
| Construct/reuse connections | `src/skill-mcp-manager/connection.ts` | Concurrent connection ownership |
| Change OAuth flow | `src/mcp-oauth/provider.ts` | Login, refresh and token storage |
| Change environment security | `src/skill-mcp-manager/{env-cleaner,env-policy,env-grant-store}.ts` | Ambient filtering, policy and grants |
| Change error privacy | `src/skill-mcp-manager/error-redaction.ts` | Token redaction |
| Change implementation contracts | `src/AGENTS.md` | Transport, cleanup and storage details |
| Find host consumers | `../omo-opencode/src/features/{skill-mcp-manager,mcp-oauth}/` | Stable adapter shims |
| Find OAuth CLI consumer | `../omo-opencode/src/cli/mcp-oauth/` | Host-facing login flow |

## CONVENTIONS
- Package identity is `@oh-my-opencode/mcp-client-core`; it is a private workspace.
- Client identity is `${sessionID}:${skillName}:${serverName}`; sessions do not share skill client state.
- HTTP defaults to Streamable HTTP; explicit `type: "sse"` selects the legacy SSE transport.
- OAuth combines PKCE, optional dynamic client registration, scope step-up and shared refresh coordination.
- Idle clients expire after five minutes; SIGINT/SIGTERM close transports.
- `disconnectAll()` remains safe across plugin reloads.

## ANTI-PATTERNS
- Never remove inherited npm/pnpm/yarn-variable and secret filtering from stdio construction.
- Explicit skill-configured env values are applied after ambient filtering; do not describe them as universally blocked.
- Never let manager errors expose credentials; preserve token redaction in connection and cleanup paths.
- Never copy these implementations into adapter compatibility paths.

## COMMANDS
From this package: `bun run typecheck` and `bun run test`.
From root: `bun test packages/mcp-client-core`.
