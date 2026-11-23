# Telemetry Implementation and Contract Tests

## OVERVIEW
Transport implementation and focused regression suites for capture, lazy loading, spool races, and tracing.

**Score:** 11; distinct domain: transport implementation and process-level fault tests.
Measured: 110 files, 107 code files, `index.ts`, 260 TypeScript function declarations and 352 export statements; graph centrality unavailable.

## WHERE TO LOOK
| Symptom or change | Contract tests | Implementation seam |
|-------------------|----------------|---------------------|
| Duplicate daily capture | `activity-state.{dedupe,concurrency}.test.ts` | `activity-state.ts`, `day-claim.ts` |
| Eager runtime loading | `otlp-entry.test.ts`, `root-types-entry.test.ts` | Public entry imports and declaration files |
| Disabled transport writes | `otlp-opt-out-purge*.test.ts`, `otlp-capture-guard.test.ts` | `otlp-gate.ts`, `otlp-spool-purge.ts` |
| Broken collector payload | `otlp-fixture.test.ts`, `otlp-wire-keys.test.ts` | `otlp-encode.ts`, `otlp-config.ts` |
| Claim contention or lost ownership | `otlp-spool-lock*.test.ts`, `otlp-spool-processes.test.ts` | `otlp-spool-lock.ts`, `otlp-spool-dir.ts` |
| Crash/torn-spool recovery | `otlp-kill.test.ts`, `otlp-spool-recovery.test.ts` | `otlp-wal.ts`, `otlp-spool-file.ts` |
| Failed filesystem moves | `otlp-spool-claim-errors.test.ts` | Rollback and token-owned unlock |
| Shared process throttling | `otlp-shared-not-before.test.ts` | `otlp-spool-not-before.ts`, `otlp-http.ts` |
| Hung server or retry cancellation | `otlp-timeout.test.ts`, `otlp-retry-sleep.test.ts` | Request deadline and abortable sleep |
| Unbounded corrupt files | `otlp-quarantine-bound.test.ts` | Quarantine expiry and cap accounting |
| Traceparent leakage | `otel-traceparent-fetch.test.ts` | Exact destination-host matching |
| Duplicate bundle state | `turn-trace-bridge.test.ts` | Process-wide symbol registry |
| Immediate capture acknowledgement | `posthog-immediate-send.test.ts` | Deferred sender loading and delivery errors |

## CONVENTIONS
- Entry startup is two gates: `otlp-entry.ts` checks consent before import, then `otlp-sender.ts` checks again before loading `otlp-sender-core.ts`.
- `safeConsent` converts a throwing callback into a diagnosed refusal; it is reused during transport operation.
- The sender's startup sweep settles before an early flush pumps its newly sealed batch.
- Shutdown arms its deadline before synchronous seal/claim work and reserves time to release claims and close writers.
- A per-install not-before value coordinates throttling between processes.
- Claim filesystem renames run asynchronously so a stalled filesystem cannot block request and shutdown timers.
- Owner-only publication prefers hard links; unsupported hard-link filesystems use rename.
- Corrupt quarantine files count toward the spool cap, are evicted first, and expire by their last write.
- Test helper children and servers are dedicated `.ts` entry files beside their suites.
- Package-local Bun configuration preloads the PostHog network guard and test deadline support.

## ANTI-PATTERNS
- Never infer consent from transport construction; it may change while a process is running.
- Never start a flush pump before the startup recovery pass settles.
- Never let a synchronous claim rename hold every timer in the event loop.
- Never treat unknown filesystem failures as absent files; only `ENOENT` means missing.
- Never let a lock owner's cleanup remove another mover's replacement token.
- Never let a broken fetch that ignores its abort signal hold the sender beyond its request deadline.

## COMMANDS
```bash
bun test packages/telemetry-core/src/otlp-entry.test.ts
bun test packages/telemetry-core/src/otlp-spool-processes.test.ts
bun test packages/telemetry-core/src/otlp-timeout.test.ts
```
