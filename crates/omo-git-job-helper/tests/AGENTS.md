# tests/ - Native Windows Contract Rows

**Generated:** 2026-11-17. **Score:** 9; distinct domain: observable process lifetime and kernel ordering.

## OVERVIEW

Windows integration binaries play the writer side of the helper protocol and prove job lifetime through handles, frames, and receipts.

## WHERE TO LOOK

| Contract | Location |
|----------|----------|
| Root exit, done, linger, failed spawn | `run_mode.rs` |
| Control-pipe boundaries | `control_pipe.rs`, `n1_control.rs` |
| Kill-on-close and creation races | `n2_kill_on_close.rs`, `n2b_in_flight_creation.rs` |
| Helper death versus job disappearance | `n3_ordering.rs`, `kernel_exit_ordering.rs` |
| Fresh jobs, limits, handle hygiene | `n4_fresh_creation.rs`, `n5_limits.rs`, `n6_handle_hygiene.rs` |
| Classification and token variants | `n7_classification.rs`, `n8_n9_tokens.rs` |
| Untimed pre-execution state | `n10_await_go.rs` |
| Shared operation driver | `support/op.rs`, `support/pipe.rs` |
| Debugger barriers and evidence | `support/debugger.rs`, `support/receipt.rs` |

## CONVENTIONS

- Each integration binary imports `mod support`; helpers are shared without a production library dependency.
- `support/mod.rs` imports token and Windows primitives from `../testkit/` via explicit path attributes.
- `Receipt` prints observed facts and includes them in assertion failures for CI diagnosis.
- `support::example()` resolves images beside the current Cargo test profile and asserts they were built.
- Build fixtures from `crates/`: `cargo build -p omo-git-job-helper --examples --locked`.
- Run rows there with `cargo test -p omo-git-job-helper --locked --tests`.
- Use fresh operation IDs from `support::unique()` so parallel rows do not share job names.
- Kernel-ordering rows observe signaled process handles and named-job state, with explicit bounded waits.

## ANTI-PATTERNS

- Never hold an F job handle across a kill: the observer would alter the lifetime under test.
- Do not replace kernel or protocol evidence with an elapsed-time assumption.
- Do not treat platform-gated rows on Linux as proof of the Windows contract.
