# ast-grep-mcp

## OVERVIEW
Private stdio MCP package exposes structural search, rewrite, and scan through the ast-grep CLI.

Score: 12; distinct domain: MCP packaging and CLI boundary.
Measured: 26 files, 85% code, local configuration, barrel boundary, 189 AST declarations, 76 exported declarations.
Reference centrality is unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change package entry or executable | `package.json` | Raw TypeScript export; `omo-ast-grep` bin |
| Start the stdio process | `src/cli.ts` | Bundled Node ESM entry |
| Find public API | `src/index.ts` | Server name and request/server exports |
| Change execution behavior | `src/AGENTS.md` | Tool schemas, runner bounds, mutation rules |
| Check package tests | `src/*.test.ts`, `src/tools/*.test.ts` | Protocol, startup, schema, tool behavior |
| Stage for native plugin | `../omo-senpi/plugin/scripts/stage-ast-grep-mcp-runtime.mjs` | Copies `dist/cli.js` into runtime payload |

## CONVENTIONS
- Package name is `@oh-my-opencode/ast-grep-mcp`; MCP registration name is `ast_grep`.
- The three MCP tools are `search`, `rewrite`, and `scan`.
- Bun builds `src/cli.ts` for Node; Bun is also the package test runner.
- Shared JSON-RPC framing comes from `mcp-stdio-core`; common helpers come from `utils`.
- Root import resolves to source TypeScript; the executable resolves to the built bundle.

## ANTI-PATTERNS
- Never rename the runner binary merely because `sg` is deprecated in favor of `ast-grep`.
- Never reword model-facing tool descriptions; the search description is an explicit verbatim contract.
- Never add JSON-Schema composition keywords that the Cursor gateway cannot convert to protobuf.

## COMMANDS
From this package: `bun run build`, `bun run typecheck`, `bun run test`.
From the repository root: `bun run build:ast-grep-mcp`.
