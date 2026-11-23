# omo-git-job-helper - Windows Git Floor Jobs

**Generated:** 2026-11-17. **Score:** 10; distinct domain: native Windows process and job ownership.

## OVERVIEW

The memory-core Git floor-job binary implements `run`, `probe`, and `selftest` with Windows job, pipe, and process-handle contracts.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Dispatch commands and platform gates | `src/main.rs` | Non-Windows execution exits 2 |
| Parse arguments and exit codes | `src/cli.rs` | Usage and failure taxonomy |
| Read operation frames | `src/frames.rs`, `src/control.rs` | Pipe protocol and cancellation |
| Establish and execute a floor job | `src/run.rs`, `src/job.rs` | Create, limit, join, verify, then spawn |
| Enforce token and handle rules | `src/security.rs`, `src/spawn.rs`, `src/win.rs` | Windows ownership |
| Prove native behavior | `tests/AGENTS.md` | Contract rows and support harness |
| Build child fixtures | `examples/testkit_*.rs`, `testkit/` | Test-only images and shared helpers |

## CONVENTIONS

- Portable CLI, frame, and probe-line modules remain compilable for unit tests on other operating systems.
- Windows system modules are conditionally compiled; do not infer runtime portability from a successful Linux build.
- `run.rs` documents design v4.2: the helper joins and verifies its job before creating a root process.
- `AWAIT_GO` waits without a timer; frame ordering determines whether execution may start.
- Root exit reporting distinguishes an empty job from lingering members.
- Exit codes and `LINGER_KILL_CODE` are wire-visible contracts, not incidental implementation details.
- From `crates/`, use `cargo build -p omo-git-job-helper --examples --locked` before native contract rows.
- `cargo test -p omo-git-job-helper --locked` exercises the package; Windows is required for native rows.

## ANTI-PATTERNS

- Never ship `examples/testkit_*.rs` images as production payloads.
- Do not start the operation before the floor job has been joined and verified.
- Do not describe a non-Windows invocation as supported execution: it deliberately returns usage status.
