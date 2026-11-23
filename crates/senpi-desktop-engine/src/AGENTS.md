# Desktop engine runtime

## OVERVIEW
Transport dispatch, session admission, and durable stop state connect the executable to the shared desktop session machinery.

Score: 11; distinct runtime domain with six immediate subsystem directories.

## STRUCTURE
```text
src/
  connection/ Admission permits and request dispatch
  mcp/        Tool catalog, protocol negotiation, and calls
  sessions/   Shared-agent session ownership and release
  stop_latch/ Account-owned persistent stop files
  stop_path/  Listener transitions and stop announcements
  xpc/        Authenticated macOS transport
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Request ordering and cancellation | `connection.rs`, `connection/dispatch.rs` | Four read permits, one exec permit |
| Immediate versus session work | `route.rs` | Maps typed core methods to session operations |
| Error and delivery reports | `rpc.rs` | Preserves worker-reported disposition |
| MCP compatibility | `mcp/mod.rs`, `mcp/call.rs` | Legacy negotiation and modern request metadata |
| Persistent user stop | `stop_latch.rs`, `stop_latch/account.rs` | Real account home; durable before acknowledgement |
| Session shutdown ordering | `sessions/`, `settle.rs` | Release and drain boundaries |

## CONVENTIONS
- Enqueue session work in arrival order; replies may complete out of order.
- Cancel native holds before connection drain or session close.
- Pending stops refuse widening input without waiting for a stuck session worker.
- Modern protocol metadata is validated per request; legacy MCP remains supported.

## ANTI-PATTERNS
- Never add a production clear operation or path override to the persistent stop latch.
- Never acknowledge a stop after its durable write failed.
- Never infer safe retry from cancellation or timeout without a worker report.
- Never let a connection resume the shared agent's global stop latch.
- Never compile `xpc_test_harness.rs` into production.
