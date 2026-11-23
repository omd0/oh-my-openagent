# omo-native/test - Launcher and Distribution Proof

## OVERVIEW
Separate Bun test tree for published launcher behavior, compiled entry contracts, trust boundaries, and process handoffs.

**Score:** 9; distinct executable-test domain: 170 files, 98% code, measured declaration/export thresholds.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Check compiled entry | `compile-entry.test.ts` | Large dispatch and bundled-entry contract suite |
| Check trust selection | `trust-stage.test.ts`, `trust-diagnostics.test.ts` | Trust usage and diagnostic cases |
| Check runtime choice | `bun-runtime.test.ts` | Bun probing, runtime guards, executable paths |
| Check graceful handoffs | `child-process-signal.test.ts` | Real parent/child processes and signal exit status |
| Run real terminal proof | `pty-signal-qa.py` | PTY session leader outlives the launcher |
| Check state adoption | `agent-dir.test.ts` | Canonical directory and legacy carry-forward |
| Check account paths | `account-*.test.ts` | Login/logout, revocation, keychain, recovery |
| Check OS trust helper | `windows-trust-helper.windows.test.ts` | Windows-only CI proof |
| Reuse subprocess data | `fixtures/`, `*.fixture.ts` | Executable test inputs, not runtime exports |

## CONVENTIONS

- Run the suite from the repository root with `bun test packages/omo-native/test`.
- Spawn real processes for signal contracts; JavaScript mocks cannot prove OS exit status.
- Signal fixtures distinguish a draining child, an ignored signal, and default signal death.
- Keep fixture PIDs and temporary roots test-owned and clean them during teardown.
- PTY QA proves graceful engine shutdown and absence of surviving children.
- Use the runtime-chain commands in the package guidance for Bun and OMO_RUNTIME=node coverage.

## ANTI-PATTERNS

- Never call portable test success proof that Windows trust collection ran.
- Never classify a process as gone from missing output alone; inspect the process outcome.
- Never replace the real terminal QA result with unit-test success for a launcher signal change.
- Never export subprocess fixtures as part of the published launcher API.
