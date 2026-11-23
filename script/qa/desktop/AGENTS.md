# Desktop live QA

## OVERVIEW
Platform drivers verify real desktop effects through independent operating-system observers and explicit cleanup receipts.

Score: 9; distinct domain: live desktop evidence and operating-system fixture ownership.
Measured: 52 files excluding lockfiles, 96% code, 364 TypeScript AST declarations, 185 exported declarations.
Reference centrality is unmeasured; generic names such as Engine are not counted as centrality.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Drive Linux desktop | `linux.ts` | X11/Xvfb and headless sway families |
| Provision Linux tools | `linux/provision.ts` | User-level tool environment |
| Manage Linux processes | `linux/procs.ts` | Owned process lifecycle and teardown |
| Exercise Wayland EIS | `linux/fake-eis/`, `linux/wayland.ts` | Separate scratch-built fake EIS crate |
| Drive real macOS agent | `macos.ts`, `macos/agent.ts` | Isolated Senpi RPC and packaged extension |
| Check macOS permissions | `macos/tcc.ts` | Accessibility/Screen Recording diagnosis |
| Test macOS input/safety | `macos/scenarios-{input,safety}.ts` | Focus restoration, stop, canary and captures |
| Drive Windows scenarios | `windows.ts` | Interactive Windows desktop; optional JSONL file |
| Observe Windows effects | `windows/observer.ts`, `windows/*.ps1` | Independent PowerShell/Win32/UIA state |
| Own Windows fixtures | `windows/fixtures.ts` | Process identity and workspace cleanup |
| Validate negative controls | `linux/expect-sabotage.test.ts`, `windows/expect-sabotage.ts` | Sabotage must change the verdict |

## CONVENTIONS
- Linux checks `engine.hello` ABI/protocol compatibility before starting scenarios.
- Linux and Windows emit scenario JSON plus final process/directory teardown receipts.
- Successful Linux/Windows exit requires passing scenarios and no owned process or run-directory leftovers.
- macOS live runs require an unlocked Aqua session and permissions granted to the responsible launcher.
- macOS `--self-test` proves isolation/launch wiring only; console and TCC are explicitly untested.
- The macOS driver owns TextEdit fixture lifecycle; it quits TextEdit and removes its scratch directory.
- Synchronize on observed conditions with deadlines; deadlines/PID checks guard hangs rather than assert latency.
- Linux fake-EIS output belongs under the QA workdir, outside published engine payloads.

## ANTI-PATTERNS
- Never derive a claimed desktop effect solely from the engine's own success reply.
- Never replace OS-state conditions with fixed sleeps.
- Never count the macOS nonlive self-test as a live permission or input pass.
- Never terminate unrelated processes by name patterns; use owned process identities.

## COMMANDS
`bun script/qa/desktop/linux.ts --all --json [--provision] [--engine BIN]`
`SENPI_BIN=/absolute/senpi bun script/qa/desktop/macos.ts --all --json`
`bun script/qa/desktop/windows.ts --all --json [--engine EXE] [--out FILE]`
