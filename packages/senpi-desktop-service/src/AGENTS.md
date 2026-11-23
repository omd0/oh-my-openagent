# src/ - Desktop RPC and Run Runtime

**Generated:** 2026-11-17. **Score:** 11; distinct domain: service lifetime, permissions, and per-run execution.

## OVERVIEW

`service/` owns child lifetime and host grants; `run/` binds each model-written JavaScript execution to its own facade and abort scope.

## WHERE TO LOOK

| Task | Location | Invariant |
|------|----------|-----------|
| Open, close, replay desired state | `service/service.ts` | Lifecycle serialized; calls concurrent |
| Match replies and cancel requests | `service/rpc-client.ts` | Request IDs and cancellation grace |
| Launch or acquire a child | `service/child.ts` | Engine availability and launch errors |
| Validate engine responses | `service/parse.ts` | Untrusted wire payloads |
| Consent and host grants | `service/global-input.ts`, `service/control-grants.ts` | Host authority |
| Change timeout bounds | `service/timeouts.ts` | Close and hold-release ordering |
| Run the VM and host tools | `run/runtime.ts` | Injected `executeTool` pipeline |
| Bind window and element methods | `run/facade.ts`, `run/handles.ts` | Identity snapshots and tier guards |
| Capture, observe, hold, and wait | `run/{screenshot,observe,input-target,hold-call,wait}.ts` | Run-bound cancellation |

## CONVENTIONS

- Startup performs `engine.hello` and ABI validation before opening the session.
- Restarts replay session parameters, the armed stop chord, and the host's stop latch.
- A resume token stays host-side; only the resume path returns it to the engine.
- Preserve `CLOSE_TIMEOUT_MS = 3000` above `HOLD_RELEASE_GRACE_MS = 2500`; ordinary cancel grace is 750 ms.
- Subscribe to `onError` for unawaited notification, heartbeat, and best-effort revoke failures.
- VM continuations re-enter under the remaining CPU budget; ended runs never resume.
- Leaked async work retains its original aborted run context instead of borrowing another run.
- Missing method-tier entries count as execution; read-only guards run before sending requests.

## ANTI-PATTERNS

- Never expose host-only `control.grant` or `control.revoke` through the run facade.
- An absent human confirmation callback must never grant interactive control.
- Never clear the user's stop latch except after a successful resume.
- Do not bypass host tool validation, permissions, or lazy activation from `tool.<name>`.
