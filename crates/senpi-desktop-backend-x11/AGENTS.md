# senpi-desktop-backend-x11 - Linux X11 Backend

**Generated:** 2026-11-17. **Score:** 10; distinct domain: X11 capture, input, and physical stop detection.

## OVERVIEW

A Linux-only Rust backend uses x11rb for screen capture, window input, AT-SPI accessibility integration, and the global stop path.

## WHERE TO LOOK

| Task | Location | Boundary |
|------|----------|----------|
| Public backend surface | `src/lib.rs`, `src/backend.rs` | `X11Backend` and exported connections |
| Enumerate displays and windows | `src/capture/monitors.rs`, `src/capture/windows.rs` | RandR and EWMH |
| Capture and convert pixels | `src/capture/image.rs`, `src/capture/mod.rs` | Root-window `GetImage` |
| Route foreground or background input | `src/input/mod.rs`, `src/input/focus.rs` | XTEST versus `XSendEvent` |
| Track and release held input | `src/input/held.rs`, `src/input/holds.rs` | Per-route held state |
| Detect filtering toolkits | `src/input/toolkit_filter.rs` | Explicit background refusal |
| Recognize physical stop chords | `src/stop_path/{chord,source,xi2}.rs` | Dedicated XI2 connection |
| Exercise real X servers | `src/**/*live_tests.rs`, `src/backend_live_tests.rs` | Ignored live tests |

## CONVENTIONS

- `src/lib.rs` gates the entire crate to Linux; dependencies are also target-scoped in Cargo.
- Capture and input expose injectable server traits with fake implementations beside their tests.
- Stop detection owns a dedicated thread and connection; heartbeat round trips prove the path remains live.
- XI 2.1 or later is needed for raw events to survive another client's keyboard grab.
- A broken stop connection marks the path unavailable until the owner restarts it.
- From `crates/`, run `cargo test -p senpi-desktop-backend-x11 --locked --lib` for ordinary tests.
- Live tests need Xvfb and applicable window-manager fixtures; select them with `-- --ignored --exact <test>`.
- The no-display stop-path case deliberately runs with `DISPLAY` unset.

## ANTI-PATTERNS

- Never link libX11 or libxcb: this backend uses pure-Rust x11rb.
- Never retry refused background input in the foreground.
- Never latch the stop chord from XTEST or other synthetic events, or from a modifier alone.
- Do not use `XGrabKey` for the stop path; raw events must not steal the user's keys.
