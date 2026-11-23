# senpi-desktop-engine

## OVERVIEW
Standalone desktop engine executable exposing JSON-RPC over stdio or local transports, with MCP and platform helpers.

Score: 10; distinct binary crate with its own Cargo configuration.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Binary and platform dependencies | `Cargo.toml` | One `[[bin]]`; no library target |
| CLI modes and helper dispatch | `src/main.rs`, `src/cli.rs` | Launch checks precede ordinary modes |
| Runtime implementation | `src/AGENTS.md` | Transport ordering, routing, stop durability |
| Process-level regression coverage | `tests/*.rs` | Spawns the built engine |
| Shared integration fixtures | `tests/common/`, `tests/fixtures/` | Harness and versioned consumer scenarios |
| Wire compatibility corpus | `tests/v1_consumers.rs` | Replays checked-in consumer fixtures |

## CONVENTIONS
- Consumers launch `senpi-desktop-engine`; there is no `lib.rs` API.
- The fake backend is unconditional; native backends are Cargo target dependencies.
- macOS uses its backend plus XPC; Linux selects Wayland/X11; Windows uses Win32.
- Default transport is newline-delimited JSON-RPC on stdio.
- `--schema` serializes the shared core engine schema.
- Daemon-related modes require the explicit CLI opt-in defined in `cli.rs`.
- Integration tests locate the executable through `CARGO_BIN_EXE_senpi-desktop-engine`.
- Fixture JSON is checked in for replay but excluded from `cargo package`.

## ANTI-PATTERNS
- Do not add an alternate native-input path for a transport or private helper.
- Do not silently succeed for platform helpers unavailable on the current target.
- Do not treat a test hang guard as a latency requirement.

## COMMANDS
```bash
cargo test -p senpi-desktop-engine --locked
cargo build -p senpi-desktop-engine --locked
```
