# Linux AT-SPI Accessibility Backend

## OVERVIEW
Shared Rust accessibility implementation used by the Linux X11 and Wayland desktop backends.

**Score:** 8; distinct domain: Linux accessibility transport, window ownership, and menu safety.
Measured: 23 files, 22 code files, Cargo config, and 236 AST function items; resolved reference centrality unavailable.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public backend and window-id modes | `src/lib.rs` | `AtSpiAx`, `WindowIds`, `AxBackend` implementation |
| Replace bus calls in tests | `src/bus.rs`, `src/fake.rs` | `AtSpiBus` round-trip seam and in-memory tree |
| Connection and call timeout | `src/connection.rs` | Current-thread runtime; five-second reply budget |
| D-Bus interface adapters | `src/live.rs` | Implements the bus trait over live proxies |
| Window discovery and hit testing | `src/apps.rs` | Registry traversal, frame lookup, element queries |
| Native window correlation | `src/owner.rs` | PID, title, geometry evidence |
| Bind menus to the requested window | `src/menu_target.rs` | Exactly one provable frame before dispatch |
| Menu traversal and actions | `src/menus.rs` | Revalidation, stop checks, declared actions |
| Properties, text, focus | `src/props.rs`, `src/text.rs`, `src/actions.rs` | Accessibility operations |
| Deterministic safety coverage | `src/*tests.rs` | Fake-bus ownership, action, and menu cases |
| Real toolkit fixture | `tests/fixtures/menu_fixture.py` | Live menu coverage requires a working accessibility bus |

## CONVENTIONS
- The library is Linux-only via the crate-level `cfg`; Cargo dependencies are target-gated.
- `AtSpiAx::with_bus` uses native window IDs; Wayland frame IDs are an explicit construction mode.
- Native handles wrap the bus node through core's `AxHandle::Native`; reject other handle types.
- `permission()` rereads registered applications so enabling accessibility later is observable.
- Menu selection receives a fresh window-list callback and a stop callback; check both before the action.
- Missing accessibility service makes the owning backend report `ax: false`.

## ANTI-PATTERNS
- Never introduce libatspi; the implementation uses Rust `atspi` and `zbus`.
- Never enable property caching on short-lived proxies; `CacheProperties::No` avoids extra round trips.
- Never dispatch from a title-only guess or an ambiguous native window match.
- Never treat an unreadable target-process frame as proof that a same-titled sibling is the target.

## COMMANDS
```bash
cargo test -p senpi-desktop-backend-atspi --locked
```
Fake-bus unit tests run headlessly; live tests need Linux desktop services and their fixture.
