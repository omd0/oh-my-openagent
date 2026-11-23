# senpi-desktop-safety

## OVERVIEW
Synchronous supervisor, stop-path registry, user-resume proofs, and ordered desktop-input gate.

Score: 10; distinct safety domain with 30 files, 223 AST declarations, and more than ten public exports.
The library has no async runtime dependency; Tokio is confined to development tests.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect the public contract | `src/lib.rs` | Re-exports supervisor, gate, clock, and proof types |
| Change action classification | `src/action.rs`, `src/action/` | Coordinate versus other mutating input |
| Trace refusal ordering | `src/gate.rs`, `src/gate/` | Gate errors map to desktop-core error codes |
| Change stop sequencing | `src/supervisor/stop.rs` | Immediate refusal, release, durable commit, publication |
| Change authority activation | `src/authority_reset.rs`, `src/supervisor/authority.rs` | Single-use proof bound to one supervisor and stopped word |
| Inspect emergency handling | `src/supervisor/emergency.rs`, `src/hold_signal.rs` | Release worker and active input scopes |
| Change listener health | `src/stop_path/`, `src/supervisor/deafness.rs` | Listener, relay, and heartbeat behavior |
| Test time-dependent state | `src/clock.rs` | Injected `Arc<dyn Clock>` and fake clock |

## CONVENTIONS
- Gate order is suspension, policy-eligible fresh stop path, lock screen, input permission, then coordinate-frame freshness.
- First failure wins; the gate reads supplied state and performs no I/O.
- `LockState::Unknown` is reported and gated as unlocked; only a positive lock probe is locked.
- Accessibility denial surfaces as a permission error, including failures discovered through stop-path health.
- Stop-path reasons use stable kebab-case wire tokens.
- Heartbeat interval is 500 ms; freshness bound is 2,000 ms.
- Input gates use `status` or `is_suspended`; `published_status` describes committed wire-facing state.
- Unit tests live in sibling modules under `src/`; the `test-support` feature enables privileged test seams.

## ANTI-PATTERNS
- Never enable `test-support` from a production dependency.
- `suspend_input` must not lock, allocate, persist, or notify; complete the stop off the event callback.
- Never acknowledge an uncommitted stop or let a stuck input scope prevent durable latch persistence before exit.
- Never promote a generation number or legacy token into `AuthorityReset`; downstream construction and cloning are deliberately unavailable.
- Authority activation uses the exact captured stopped word; rejected activation must not retry against a newer stop.
- Never let a legacy or test reset bypass authority activation, or carry the resume secret through a model-facing call chain.

## COMMANDS
`cargo test -p senpi-desktop-safety --locked`
`cargo clippy --workspace --all-targets --locked -- -D warnings`
