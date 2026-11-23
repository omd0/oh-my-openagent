# git-bash-mcp - Windows Git Bash MCP

**Generated:** 2026-11-17. **Score:** 7; existing guidance retained for the Windows execution boundary.

## OVERVIEW

Private Codex-facing stdio MCP providing Git Bash discovery, diagnostics, and Windows shell execution.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Start the executable | `src/cli.ts` | `omo-git-bash mcp` entry |
| Dispatch MCP methods | `src/mcp.ts` | `handleGitBashMcpRequest`, `runMcpStdioServer` |
| Run shell commands | `src/runner.ts` | `bash.exe -lc`, captured output, timeout |
| Resolve bash | `src/git-bash-resolver.ts` | Shim over utils/runtime |
| Pin tool schemas and protocol | `src/mcp-{schema,protocol-pin}.test.ts` | Consumer-visible envelopes |
| Pin startup and deadlines | `src/mcp-{startup,timeout}.test.ts` | Server lifetime and inherited timeout |

## CONVENTIONS

- `which_bash` and `diagnose` can be dispatched cross-platform; `run` appears only with runnable Git Bash on Windows.
- The stdio entry returns immediately when Git Bash cannot run; direct request-handler tests exercise disabled-host diagnostics.
- Codex consumes this server; OpenCode uses its interactive terminal path instead.
- Build tooling and tests use Bun; the emitted CLI targets Node ESM.
- Shared framing comes from mcp-stdio-core; platform resolution comes from utils/runtime.
- Runner output uses temporary file descriptors to avoid Windows pipe-buffer deadlocks.
- Timeout precedence: `OMO_CODEX_GIT_BASH_TIMEOUT_MS`, `OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS`, `CODEX_EXEC_COMMAND_TIMEOUT_MS`, `EXEC_COMMAND_TIMEOUT_MS`.
- Default timeout is 120,000 ms; accepted values are integers from 1 to 1,800,000 ms.
- `workdir` and `timeout` are tool-schema fields; the dispatcher also accepts legacy `cwd` and `timeout_ms`.
- The stdio server enables the parent watchdog and disables idle timeout: Codex does not reconnect an idle-killed user server.
- Marketplace synchronization stages `dist/` into Codex's git-bash component and rewrites its MCP path.

## ANTI-PATTERNS

- Never expose `run` on a non-Windows or unresolved-bash host.
- Do not replace temp-file capture with pipes without preserving the Windows deadlock contract.
- Do not enable idle shutdown for this Codex server.

## CHECKS

- `bun run build:git-bash-mcp`
- `bun run --cwd packages/git-bash-mcp test`
- `bun run --cwd packages/git-bash-mcp typecheck`
