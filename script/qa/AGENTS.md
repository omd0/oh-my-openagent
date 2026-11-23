# QA drivers

## OVERVIEW
Executable QA drivers validate packaged runtimes, telemetry privacy, dependency changes, and eval worker capability boundaries.

Score: 10; distinct evidence-producing domain with its own focused TypeScript configuration.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Packaged eval smoke | `omo-native-eval-smoke.mjs` | Temporarily hides the source checkout |
| Binary/npm parity | `omo-native-parity-smoke.mjs` | Same scripted tools, doctor, and setup |
| Telemetry scenario orchestration | `omo-native-telemetry-qa.mjs` | Enabled run plus two opt-out runs |
| Dependency audit receipts | `dependency-audit-capture.ts`, `dependency-audit/` | Per-case runtime and cleanup |
| Worker measurement validity | `omp-item2.ts` | Absolute JSON output path |
| Child scope and denials | `omp-item6.ts`, `omp-item6-scope-producer.ts` | Real producer path and refused calls |
| Typecheck boundary | `tsconfig.json`, `types/senpi-pi-tui.d.ts` | Dependency audit subset and public type shim |

## CONVENTIONS
- QA's tsconfig includes dependency-audit sources and fixtures, not every driver.
- Its stricter checks include exact optional properties and unchecked indexed access.
- `omp-item2` and `omp-item6` record the source SHA and timestamps with their verdict.
- Dependency captures create and dispose a runtime for each selected case.
- Binary parity copies the executable alone into a download directory before running.
- Eval smoke restores hidden source paths in `finally` and checks workers and sockets.
- Telemetry QA waits for settled agent events and records cleanup receipts.

## ANTI-PATTERNS
- Never let the denied nested producer call reach the bridge.
- Never count missing CLI binaries or missing built plugin payloads as a pass.
- Never let source hiding outlive the eval-smoke cleanup path.
- Never retain sandbox processes or sockets after a successful smoke verdict.
- Never publish captured telemetry identifiers or unredacted sandbox paths.

## COMMANDS
```bash
bun script/qa/omp-item2.ts --case measurement-invalid --out /tmp/omo-item2.json
bun script/qa/omp-item6.ts --case producer-scoped-narrowed-child --out /tmp/omo-item6.json
bun script/qa/omo-native-eval-smoke.mjs /absolute/path/to/omo
bun script/qa/omo-native-parity-smoke.mjs --binary /absolute/path/to/omo
```
