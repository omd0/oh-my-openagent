# senpi-desktop-backend-win32

## OVERVIEW
Windows desktop backend crate; portable policy tests surround Windows-only capture, input, accessibility, and stop listeners.

Score: 10; distinct OS backend with its own Cargo configuration.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Dependency or target split | `Cargo.toml` | Library only; native dependencies are target-gated |
| Public crate surface | `src/lib.rs` | Conditional backend/listener re-exports |
| Backend trait implementation | `src/backend.rs` | Capture remains available when input initialization fails |
| Portable delivery policy | `src/delivery.rs` | Rejects toolkit-specific silent input drops |
| Implementation details | `src/AGENTS.md` | Native routing and safety invariants |

## CONVENTIONS
- This package produces an `rlib`, never the desktop engine executable.
- Version, edition, and license inherit the Cargo workspace.
- `senpi-desktop-core` and `senpi-desktop-safety` are unconditional dependencies.
- Windows enables the core `system-clipboard` feature alongside native libraries.
- The delivery matrix, key vocabulary, and stop-chord rules compile on every host.
- Test-only modules also exercise portable input and menu policy without Windows.
- `Win32Backend` and `HotkeyListener` are exported only on Windows.
- Keep the unconditional `BACKEND_NAME` and stop-chord constant usable elsewhere.

## ANTI-PATTERNS
- Do not move Windows imports into modules intended for host-independent tests.
- Do not make successful input initialization a prerequisite for capture.
- Do not present portable test success as proof that native Windows probes ran.

## COMMANDS
```bash
cargo test -p senpi-desktop-backend-win32 --locked
cargo check -p senpi-desktop-backend-win32 --locked
```
