# senpi-desktop-backend-wayland

## OVERVIEW
Linux-only desktop backend combining libei input, portal capture, AT-SPI accessibility, and a GlobalShortcuts stop path.

**Why here:** score 8; distinct compositor integration with 54 Rust files, runtime FFI, and group-aware keyboard parsing.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public backend and stop exports | `src/lib.rs` | Entire crate is gated on `target_os = "linux"` |
| Backend implementation | `src/backend.rs`, `src/backend/` | Desktop backend behavior and focused tests |
| Capture and display geometry | `src/capture/` | Portal capture and PipeWire frame handling |
| Runtime PipeWire symbols | `src/capture/pipewire/lib.rs`, `ffi.rs`, `stream.rs` | Dynamic library ownership and unsafe FFI |
| Input transport | `src/input/` | `LIBEI_SOCKET` or RemoteDesktop portal session |
| Keyboard resolution | `src/input/xkb/` | Parse compositor keymaps without libxkbcommon |
| Stop shortcut | `src/stop_path/` | `GlobalShortcutsListener` and stop availability |
| Private test services | `src/test_support/` | Fake EIS server and portal on a private D-Bus bus |
| Keyboard fixtures | `testdata/fr.xkb`, `testdata/us-fr.xkb` | Embedded with `include_str!` by XKB tests |

## CONVENTIONS

- This crate builds an `rlib`; workspace metadata and dependency pins come from Cargo manifests.
- PipeWire loads through `libloading` using `libpipewire-0.3.so.0`; the backend starts without that library installed.
- Retain the loaded library while its function pointers remain usable.
- XKB resolution uses the compositor's active group and tracks depressed, latched, and locked modifiers.
- Separate `*_tests.rs` and `tests.rs` modules are wired behind `#[cfg(test)]`.
- Tests touching `LIBEI_SOCKET`, the session bus, or portal connections hold `test_support::env_lock()`.
- `LibeiSocketEnv` restores the process environment on drop.
- Fixture waits use `HANG_GUARD` as a hang bound rather than a latency assertion.

## ANTI-PATTERNS

- Do not introduce a build-time link to libxkbcommon or PipeWire.
- Never borrow a character mapping from another XKB group; libei cannot portably change the compositor's active group.
- Do not let fake portal tests race ashpd's process-cached session-bus connection.
- Keep unsafe capture operations tied to the documented FFI prototypes and resource lifetimes.

## COMMANDS

From the repository root on Linux:
`cargo test -p senpi-desktop-backend-wayland --locked`.
`cargo build -p senpi-desktop-backend-wayland --locked`.
