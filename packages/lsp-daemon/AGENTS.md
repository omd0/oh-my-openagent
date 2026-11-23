# lsp-daemon -- Shared Per-User LSP Daemon

## OVERVIEW
Authenticated per-user LSP daemon with a stdio MCP proxy and tool client, shared across harness sessions.

Score: 10; distinct domain: daemon/proxy transport, runtime identity, and packaged client.
Vendored `@code-yeongyu/lsp-daemon`; Node >=20, npm, vitest, biome.
The LSP manager/MCP handlers come from `lsp-core`; framing helpers come from `mcp-stdio-core`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI dispatch | `src/cli.ts`, `src/run-daemon.ts` | `mcp` default or `daemon` |
| Stdio lifetime | `src/proxy.ts` | Watchdog and stdin-close cancellation |
| Listener lifecycle | `src/daemon-server.ts` | Manager, pid/endpoint files, idle shutdown, signals |
| Request transport | `src/daemon-client.ts` | Auth, startup retries, cancellation, diagnostics/format |
| Startup | `src/ensure-daemon.ts` | Probe, detached spawn, bounded readiness, failure cooldown |
| Request isolation | `src/request-routing.ts` | Authentication and `_context` extraction |
| Runtime identity | `src/runtime-contract.ts`, `src/paths.ts` | Override validation and versioned paths |
| Ownership | `src/ownership.ts`, `src/ipc-protocol.ts` | Owner ping, token envelope, protocol version |
| Public package surface | `src/client.ts`, `package.json` | `./client`, `./cli`, bin `omo-lsp-daemon` |
| QA | `scripts/qa/`, `test/` | Socket smoke, commit barrier, client and portability contracts |

## CONVENTIONS
- Proxy forwards `tools/call` to the daemon; other MCP requests remain local.
- Each call carries validated `_context`; `runWithRequestContext` isolates its cwd,
  config paths, install decisions, and capabilities before the LSP core handler.
- Startup watchdog defaults to 10 seconds; first handler invocation clears it.
  Expiry destroys stdin, logs `[lsp-daemon]` to stderr, and handles premature-close errors.
- Stdin end/close aborts the proxy controller; cancellation reaches startup and
  sends authenticated `$/cancelRequest` with the original request id.
- Startup transport retries are bounded; authentication refresh is allowed once.
  Cancelled calls, already-written request errors, and non-retryable rename errors stop retrying.
- Idle exit requires 30 minutes, no live connections, and zero managed LSP clients.
- Default state is `~/.omo/lsp-daemon/v<version>`; `OMO_LSP_DAEMON_DIR` must be absolute.
- `OMO_LSP_DAEMON_CLI`/`OMO_LSP_DAEMON_VERSION` are a pair; reject singletons
  before path creation/spawn. CLI must be an existing absolute regular file;
  version must match `[A-Za-z0-9][A-Za-z0-9._+-]{0,127}`.
- Unix sockets use `daemon.sock`, with hashed tmp fallback at 100 path characters;
  Windows pipes hash canonical version directory plus user discriminator. Authentication stays mandatory.
- Daemon children detach with ignored stdin, log-redirected output, and `unref()`.
  Windows background spawns use `windowsHide: true`; spawn errors go to the log.
- Executable selection preserves existing `process.execPath`, then existing absolute
  `process.argv0`, then PATH `node`.
- Build stages fresh TypeScript declarations and Bun Node-target ESM bundles,
  stamps runtime versions, then replaces dist with rollback protection.
- OpenCode bootstrap resolves the package `./cli` export. Source mode runs `src/cli.ts`
  with Bun and pairs that CLI override with the package version.
- Adapter request translators use the three `LSP_TOOLS_MCP_*` inputs for project
  config paths (`.opencode/lsp.json`, `.omo/lsp.json`, `.omo/lsp-client.json`),
  OpenCode user configuration, and install-decision paths.

## ANTI-PATTERNS
- Never derive frozen `test/fixtures/legacy-path-vectors.json` from the new resolver;
  those pre-migration Unix, hashed Unix, and Windows vectors are cleanup input.
- Never replay a mutation after an uncertain already-written request.
- Never let old deleted dist artifacts survive a successful replacement build.
- Do not confuse the Node runtime target with the Bun bundler used during build.

## COMMANDS
From root: `bun run build:lsp-daemon` (`npm ci` + `npm run build`) before using dist.
Package-local: `npm test`, `npm run typecheck`, `npm run lint`, `npm run check`,
and `npm run smoke:client-package`; root publication carries package.json and dist.
`node packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs <repo-root>` proves cancellation;
`commit-barrier-smoke.mjs` proves rename cancellation precedes edits, while mid-apply
abort commits one edit and reports late abort. Both feed codex-qa/opencode-qa LSP drivers.
