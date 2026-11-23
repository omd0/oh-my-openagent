# mcp-stdio-core - Shared JSON-RPC Stdio

**Generated:** 2026-11-17. **Score:** 10; distinct domain: dependency-free MCP framing and lifetime control.

## OVERVIEW

Leaf core for JSON-RPC response construction, dual stdio framing, request dispatch, and bounded server lifetimes.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public source exports | `src/index.ts`, `package.json` | Barrel plus record/responses/server/transport/types subpaths |
| Construct responses | `src/responses.ts` | Success/error builders and JSON-RPC ID parsing |
| Check record shape | `src/record.ts` | `isPlainRecord` guard |
| Read or write framing | `src/transport.ts` | Line mode and Content-Length mode |
| Dispatch and close | `src/server.ts` | `runJsonRpcStdioServer`, idle timer, parent watchdog |
| Pin lifetime and errors | `src/server.test.ts` | Idle, liveness, closed output, handler failures |
| Pin framing | `src/transport.test.ts` | Async reads and writes |

## CONVENTIONS

- Zero runtime/peer dependencies and no workspace imports; preserve this layering floor.
- Relative ESM imports use explicit `.js` suffixes; export maps point directly to `.ts` sources.
- LSP core, ast-grep-mcp, git-bash-mcp, and the LSP daemon proxy consume these primitives.
- Incoming buffer prefixes select newline or case-insensitive `content-length:` framing.
- A handler returning `undefined` emits no response; `onHandlerError` opts into handling exceptions.
- Output writes are awaited; EPIPE, destroyed-stream, and write-after-end close the read loop.
- Non-terminal write errors propagate; one-shot output error listeners are removed after settlement.
- Timers are unref'd. Idle expiry destroys input so an abandoned open pipe cannot retain the loop.
- Parent liveness is opt-in; detached servers must omit the watchdog option.
- `process.kill(pid, 0)` treats ESRCH as absent and other errors as uncertain/alive.

## ANTI-PATTERNS

- Never add workspace dependencies or harness-specific dispatch here.
- Never substitute `ppid === 1` for cross-platform parent liveness.
- Never let a liveness probe throw from its interval or swallow non-terminal output failures.
- Do not remove idle input destruction while leaving the reader blocked.

## CHECKS

- `bun run --cwd packages/mcp-stdio-core test`
- `bun run --cwd packages/mcp-stdio-core typecheck`
