# senpi-desktop-backend-macos

**Generated:** 2026-11-17. **Score:** 10; distinct domain: native macOS capture, input, Accessibility, and stop-path enforcement.

## OVERVIEW

macOS-only Rust backend implements the desktop-core ports and integrates desktop-safety supervision with native APIs.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Find exported backend ports | `src/lib.rs` | Entire crate gated by `target_os = "macos"` |
| Coordinate platform behavior | `src/backend/` | `MacosBackend` implementation |
| Inspect Accessibility operations | `src/ax/` | Tree walking, menus, text input, element actions |
| Capture desktop images | `src/capture/` | Native capture paths and helper integration |
| Deliver keyboard/mouse input | `src/input/`, `src/skylight/` | Layout handling and background delivery |
| Check launcher trust | `src/launch_gate.rs`, `src/responsible.rs` | TCC responsible-process admission |
| Maintain global stop input | `src/stop_path/` | Listen-only event tap and prestarted stop worker |
| Build the capture helper | `build.rs`, `native/` | Objective-C ScreenCaptureKit helper |
| Inspect engine helper entry points | `src/release_helper/`, `src/overlay/` | Input release and cursor display |

## CONVENTIONS

- Native dependencies are under Cargo's macOS target table.
- `senpi-desktop-core` supplies backend traits; `senpi-desktop-safety` supplies the supervisor and stop-path interfaces.
- Sibling `tests.rs`, `*_tests.rs`, and `live_tests.rs` modules separate deterministic cases from desktop-dependent tests.
- The stop tap runs on `senpi-desktop-killswitch`; callback work signals atomics and unparks the worker.
- Stop-path recreation uses the bounded 250 ms, 500 ms, 1 s, 2 s, 4 s ladder, then parks until restart.
- Release builds stage the signed helper through `SENPI_DESKTOP_CAPTURE_HELPER_SIGNED`; local builds may use clang and an ad-hoc signature.
- An explicitly configured signed-helper directory without its helper is a broken release.

## ANTI-PATTERNS

- Never admit an engine whose responsible process is itself or cannot be resolved; launchd parentage grants no exception.
- Never substitute an ad-hoc helper when the release supplied a signed-helper directory.
- Never wait for configuration changes inside the event-tap callback.
- A deaf or unauthorized tap must not authorize input merely because the tap remains enabled.
- Stop-chord matching must not miss a stop because Shift was also held.

## COMMANDS

```bash
cargo test -p senpi-desktop-backend-macos
```

Run native behavior checks on macOS; this crate's target gate excludes the implementation on Linux.
