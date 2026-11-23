# senpi-desktop-session

## OVERVIEW
Desktop session ownership, ordered request execution, safety admission, input restoration, and audit reporting.

**Why here:** score 10; distinct cross-platform session boundary with a single mutation transaction and public engine-facing API.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public session API | `src/lib.rs` | Re-exports session, selection, safety, operation, and timeout types |
| Ordered worker lifecycle | `src/session.rs`, `src/worker.rs` | One thread owns backend, AX refs, and frame cache |
| Backend choice | `src/selection.rs`, `Cargo.toml` | Platform-gated backends plus the fake backend |
| Mutation admission | `src/mutate.rs`, `src/restore/` | Gate, process-wide transaction, release, restore, one audit event |
| Foreground grant | `src/grant.rs` | Shared `ControlSlot` and latched stop semantics |
| User intervention | `src/intervention/`, `src/user_input_watch/` | Read/input history controls admission |
| AX actions | `src/worker_ax/` | Live ref lookup and confirmed typing |
| Audit records and artifacts | `src/audit/` | Redacted text metadata, optional JSONL, artifact GC |
| Cancellation and deadlines | `src/pending.rs`, `src/timeouts.rs` | Abandoned queued requests and injected time bounds |
| Failure-path fixtures | `src/test_support.rs`, `src/test_support/` | Fake backends, including panic paths |
| External API tests | `tests/` | Session integration contracts |

## CONVENTIONS

- Requests run in submission order under `catch_unwind`; waiter deadlines use injected `SessionTimeouts`.
- Every mutating request enters `mutate`; read-only requests bypass it.
- `INPUT_TRANSACTION` serializes capture through restore across sessions in the process.
- Mutation failures or suspension release held input before restoring focus/cursor state.
- Audit receives exactly one event for each mutating request, including refusal or failure.
- Text audit records carry length and a SHA-256 prefix; control refusal reasons use the same treatment.
- Audit and artifact I/O failures go to stderr without failing the user's action.
- Test layouts include sibling test modules, `tests.rs`, and `_test.rs`; timeout tests inject deadlines.

## ANTI-PATTERNS

- Never send input after a stop or cancellation observed at admission; suspension wins over cancellation.
- Never steal a held foreground grant or let `stopPath.resume` restore a latched stop.
- AX handles are `Rc` values and must remain on the session thread.
- Never choose AX click targets from window geometry or enumeration order; resolve live refs.
- Never log or audit raw typed text or control-refusal reasons.
- Never execute queued work after its waiter has given up, or issue a frame ID twice.
- Unknown/dropped presses do not clear intervention state; unread presses block admission to that app.
- `capabilities` and `stopPath.*` requests must not reach the session thread.

## COMMANDS

From the repository root: `cargo test -p senpi-desktop-session --locked`.
Workspace checks: `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo test --workspace --locked`.
