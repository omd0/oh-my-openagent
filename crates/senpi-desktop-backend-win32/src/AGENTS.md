# Win32 backend implementation

## OVERVIEW
Native Windows routing and portable policy modules implement capture, UIA, guarded input, and the global stop path.

Score: 11; distinct implementation domain with six immediate subsystems.

## STRUCTURE
```text
src/
  ax/         UI Automation and accessibility menus
  capture/    DPI, monitor geometry, and image composition
  delivery/   Portable toolkit-policy tests
  input/      Held input, focus, and delivery routes
  menus/      Portable menu rules and tests
  stop_path/  Physical chord detection and listener liveness
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Construction and capabilities | `backend.rs` | Sets DPI awareness before native geometry |
| Background refusals | `delivery.rs` | Toolkit matrix and UIPI checks |
| Foreground/background routing | `input/mod.rs`, `input/dispatch.rs` | System queue versus posted messages |
| Key-release recovery | `input/held.rs`, `input/recovery.rs` | Held-state accounting |
| Kill switch | `stop_path/mod.rs`, `stop_path/listener.rs` | Physical hook plus hotkey backup |

## CONVENTIONS
- Display/window coordinates are global logical units; capture pixels are physical.
- Capture composition uses the highest participating monitor scale.
- `WH_KEYBOARD_LL` detects physical chords; injected key events do not trigger stops.
- `RegisterHotKey` backs up the hook when elevated foreground windows hide events.
- The listener beats while its hook remains installed, not merely while its thread exists.

## ANTI-PATTERNS
- Never bypass the foreground focus guard or background compatibility matrix.
- Never report accepted `PostMessageW` calls as proof a toolkit delivered input.
- Never send input to a known elevated target past the UIPI refusal.
- Never remove held-input recovery when changing native event delivery.
