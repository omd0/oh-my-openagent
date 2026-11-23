# Native Rust Crates

## OVERVIEW
Native desktop engine, platform backends, safety/session contracts, and isolated operating-system helpers.

Score: 11; distinct native domain: file/subdirectory volume, code ratio, measured function density, and public exports.

## STRUCTURE
```text
crates/
  desktop/                       # Historical desktop architecture notes
  senpi-desktop-core/             # Shared wire types and backend traits
  senpi-desktop-safety/           # Supervisor, stop paths, ordered input gate
  senpi-desktop-session/          # Request thread, mutation gate, frame cache
  senpi-desktop-backend-*/        # Fake and operating-system implementations
  senpi-desktop-engine/           # Standalone engine executable
  senpi-desktop-xpc/              # macOS peer identity and native transport
  omo-engine-trust-helper/        # Certificate-store facts, policy decided in TS
  omo-git-job-helper/             # Windows Git process/job helper
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change shared desktop interfaces | `senpi-desktop-core/src/lib.rs` | Backend/AxBackend, frames, protocol, schema |
| Trace ordered request execution | `senpi-desktop-session/src/lib.rs` | Session owns backend, AX registry, capture cache |
| Inspect stop and permission gates | `senpi-desktop-safety/src/lib.rs` | Supervisor, PermissionGate, StopPathId |
| Select native dependencies | `senpi-desktop-engine/Cargo.toml` | Target-specific backends; fake always available |
| Add deterministic desktop fixtures | `senpi-desktop-backend-fake/` | JSON scenarios, recorded effects, fake clock |
| Change macOS capture framing | `senpi-desktop-backend-macos/native/` | Objective-C persistent ScreenCaptureKit worker |
| Guard synthetic input tagging | `senpi-desktop-backend-macos/tests/tagged_events/` | Source guard runs across platforms |
| Change trust-helper stdout | `omo-engine-trust-helper/src/document.rs` | Bounded schema consumed by native TS decoders |
| Change trust-helper platform logic | `omo-engine-trust-helper/src/{macos,windows}.rs` | Read-only OS store collection |
| Trace Windows Git helper modes | `omo-git-job-helper/src/main.rs` | run/probe/selftest; non-Windows returns usage |

## CONVENTIONS
- Cargo packages inherit workspace version, edition, license, and dependency declarations.
- Desktop core defines backend contracts; the session thread owns backend state and serializes requests.
- Session mutations pass through the safety gate, focus/cursor transaction, and audit event.
- The fake backend records effects without calling OS desktop APIs.
- Rust unit-test modules often live in sibling `*_tests.rs` files; integration targets live under `tests/`.
- macOS capture replies combine a JSON header with tightly packed premultiplied BGRA bytes.
- Trust helpers emit facts only; `packages/omo-native/engine-trust-policy.ts` makes the trust decision.
- Trust-helper stdin/stdout limits are 8 MiB; its independent watchdog expires after 20 seconds.
- A Linux trust-helper invocation deliberately returns unsupported status 64.
- `desktop/README.md` contains historical scaffold status; inspect current code before relying on it.

## ANTI-PATTERNS
- Never prompt for Screen Recording permission from capture code; use non-prompting TCC preflight.
- Never fall back to unfiltered pixels when a live helper window cannot be excluded.
- Never create production macOS input events outside the tagged constructors in `src/input/cgevent.rs`.
- Never write keychain/trust settings or fetch network chains while collecting certificate-store facts.
- Never infer native OS coverage from a passing portable build; platform modules are conditionally compiled.

## COMMANDS
```bash
cargo test -p senpi-desktop-session --locked
cargo test -p omo-engine-trust-helper --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```
