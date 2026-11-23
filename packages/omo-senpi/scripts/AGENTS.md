# Senpi adapter scripts

## OVERVIEW
Adapter maintenance scripts verify vendor pins, regenerate telemetry artifacts, and route live runtime QA.

Score: 9; distinct domain: adapter maintenance and executable QA orchestration.
Measured: 317 files recursively, 94% code, 606 TypeScript AST declarations, 66 exported declarations.
Reference centrality is unmeasured; JavaScript exports are not included in those AST totals.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Verify or refresh vendored SDKs | `sync-bunshin-ts.ts` | Local source checkouts and pinned build digests |
| Regenerate telemetry schemas/docs | `telemetry-schema-artifact.ts` | Source artifacts, packaged mirrors and generated doc block |
| Assert a subprocess exit code | `expect-exit.mjs` | `<expected> -- <command...>` |
| Select a live QA driver | `qa/AGENTS.md` | Detailed harness routing and isolation requirements |
| Observe task-host transitions | `qa/task-host-e2e-events.mjs` | Subscribe-before-trigger filesystem observation |
| Exercise thread transport | `qa/thread-tools/run-all.mjs` | Gateway/legacy scenario suites |
| Exercise task recovery | `qa/task-14/run-all.mjs` | Kill-mid-turn and version capability scenarios |

## CONVENTIONS
- Vendor sync exports pinned commits with git archive into scratch trees; source checkouts stay untouched.
- Default vendor sync compares built output to PIN digests; `--write` replaces vendored copies and pins.
- `--commit <package>=<sha>` explicitly changes a vendor pin.
- Vendored dependency imports are rewritten through `#bunshin-ts-dep/`; bare imports can resolve the host registry's wrong copy.
- Top-level publish manifests become PIN metadata rather than nested workspace package manifests.
- Telemetry artifact generation writes both source and plugin mirrors and replaces only the marked documentation block.
- Telemetry `--check` reports drift and exits nonzero without writing.
- `observeState` subscribes before its trigger and resolves on the product transition; its timer is a failure deadline.
- Thread QA selects an explicit engine with `THREAD_QA_SENPI_VERSION`.

## ANTI-PATTERNS
- Never replace pinned SDK bytes by copying arbitrary checkout output.
- Never use a fixed delay as evidence that a task transition completed.
- Never treat telemetry source artifacts and packaged mirrors as independently editable files.
- Never report macOS/Windows desktop coverage from a Linux-only harness run.

## COMMANDS
`bun packages/omo-senpi/scripts/telemetry-schema-artifact.ts --check`
`node packages/omo-senpi/scripts/expect-exit.mjs 0 -- <command...>`
Vendor sync usage and required local-checkout flags are documented at the top of `sync-bunshin-ts.ts`.
