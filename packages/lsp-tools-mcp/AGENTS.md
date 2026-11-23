# lsp-tools-mcp - LSP stdio Facade

## OVERVIEW
Node-targeted @code-yeongyu/lsp-tools-mcp wraps lsp-core with a standalone omo-lsp CLI and compatibility re-exports.

Score: 8; distinct domain: vendored CLI packaging and its independent Node test/tooling boundary.
Measured: 70 tracked non-guidance files, 52 code files, package config and 38 AST declarations; centrality unavailable.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI dispatch and shutdown | src/cli.ts | Default command is mcp; always disposes the manager |
| MCP request/server surface | src/mcp.ts | Re-exports lsp-core/mcp |
| Tool definitions and dispatch | src/tools.ts | Re-exports lsp-core/tools |
| Per-request workspace context | src/request-context.ts | Re-exports lsp-core/request-context |
| Compatibility manager entry | src/lsp/manager.ts | Re-exports lsp-core/lsp/manager |
| Prepare extracted-core links | scripts/ensure-core-links.mjs | Runs before the build |
| Package and CLI contract | test/package-smoke.test.ts | Pins npm identity, bin and shipped files |
| Runtime/security regressions | test/ | Vitest suites exercising facade imports |
| Standalone CI and release | .github/workflows/ | Vendored package workflows |

## CONVENTIONS
- OpenCode registers this package as tier-1 MCP lsp; lsp-daemon consumes its compatibility surface for Codex.
- Runtime behavior belongs in lsp-core. src has no index.ts; keep its path-level facade modules available.
- Existing aliases include diagnostics, goto_definition, find_references, symbols, prepare_rename, rename, status and install_decision with the lsp_ prefix; the core registry is authoritative.
- Source uses Node ESM .js import suffixes, tabs, double quotes, and semicolons.
- npm@11.16.0 owns package tooling; Node >=20 is required. The build uses Bun to bundle Node ESM after declaration emission.
- Vitest discovers test/**/*.test.ts under Node with the threads pool; root Bun tests do not replace that run.
- Project config is .codex/lsp-client.json; user config is ~/.codex/lsp-client.json, with LSP_TOOLS_MCP_PROJECT_CONFIG and LSP_TOOLS_MCP_USER_CONFIG overrides.
- ensure-core-links creates the missing mcp-stdio-core link beneath lsp-core and preserves an existing path.

## ANTI-PATTERNS
- Do not put an independent LSP engine in the re-export files; change the extracted core.
- Do not bypass the package build script when preparing dist: its linking and declaration steps are required.
- Do not report npm run check as test coverage; it runs typecheck, formatting, and build only.

## COMMANDS
Run from this package directory:
```bash
npm ci
npm run check
npm test
```
Root build entry: bun run build:lsp-tools-mcp.
