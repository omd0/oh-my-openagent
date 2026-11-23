# Daemon transport source

## OVERVIEW
Node ESM modules join stdio MCP sessions to the authenticated shared LSP server.

Score: 8; distinct domain: wire routing and transport lifetime behind the daemon package.

## WHERE TO LOOK
| Task | Location | Detail |
|------|----------|--------|
| Published types | `client.ts` | Stable typed package client, including format results |
| Internal barrel | `index.ts` | Proxy, paths, diagnostics, manager disposal |
| Endpoint ownership | `ownership.ts` | Owner identity carried in ping responses |
| Wire framing | `socket-jsonrpc.ts` | Newline-delimited JSON decoder/encoder |
| Protocol acceptance | `ipc-protocol.ts` | Token validation and authenticated envelope |
| Route extraction | `request-routing.ts` | Remove reserved context before core tool arguments |
| Failure projection | `daemon-failure-result.ts` | Convert transport failure to tool result |
| Retry classification | `daemon-request-error.ts` | Cancellation, timeout, auth, request-written state |
| Old-version retirement | `version-reap.ts` | Background owner-aware runtime cleanup |
| Startup injection | `ensure-daemon.ts` | Probe/spawn/sleep/now dependencies |

## CONVENTIONS
- Internal relative imports use `.js` extensions in TypeScript.
- Formatting follows the vendored package: tabs and semicolons.
- `client.ts` exposes package-local types rather than requiring consumers to import core internals.
- `_context` is mandatory for tool calls; malformed context produces JSON-RPC invalid-params.
- `omo/ping` returns protocol version plus owner identity.
- Active requests use request-id keyed abort controllers; a cancellation frame has no normal reply.
- Context validation occurs before acquiring daemon paths or initiating startup.
- Ensure uses a five-second readiness budget and a five-second failed-spawn cooldown.
- Transport startup uses backoffs of 0, 100, and 300 milliseconds.

## ANTI-PATTERNS
- Do not pass reserved `_context` through to the LSP tool's own argument object.
- Do not use ambient process cwd as a substitute for validated request context.
- Do not expose raw socket/authentication internals through the stable client types.
- Never let old-version cleanup block or crash daemon startup.
