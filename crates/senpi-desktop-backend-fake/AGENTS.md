# senpi-desktop-backend-fake - Scripted Desktop Backend

**Generated:** 2026-11-17. **Score:** 8; distinct domain: deterministic, OS-free desktop conformance fixtures.

## OVERVIEW

Rust rlib implementing desktop backend traits from JSON scenarios, recorded effects, injected faults, and a fake clock.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public fake surface | `src/lib.rs` | FakeBackend, FakeClock, Faults, scenario and sink types |
| Construct backend state | `src/fake.rs` | Scenario-owned fake state |
| Load or validate scenarios | `src/scenario.rs`, `src/scenario_nodes.rs` | JSON schema and validation errors |
| Inject method faults | `src/faults.rs`, `src/method.rs` | Per-method scripted failures and AX writes |
| Record input effects | `src/sink.rs` | RecordingSink, SinkOp, RecordedPointer |
| Model AX and menus | `src/ax_tree.rs`, `src/ax_impl.rs`, `src/menus_impl.rs` | Accessibility and menu operations |
| Model remote or user input | `src/remote_impl.rs`, `src/user_input_impl.rs` | Remote screen and scripted press behavior |
| Add timeline scenarios | `src/scripting.rs`, `src/scripting_impl.rs` | Identity, epoch, focus, display changes |
| Check scripted behavior | `src/scripting_tests.rs` | Inline scenario suite |
| Check trait conformance | `tests/`, `tests/common/mod.rs` | AX/input/menu/capture/scenario integrations |
| Extend replay inputs | `fixtures/*.json` | Twelve scenarios paired with core conformance names |

## CONVENTIONS

- Depend on desktop-core; this fake supplies test hardware to engine, safety, session, and XPC crates.
- All visible side effects go through the recording sink, allowing assertions without real desktop input.
- Fault occurrence indices are one-based; scenario validation rejects zero.
- Given/When/Then comment blocks document Rust integration cases.
- Keep fixture names aligned with desktop-core's conformance corpus.
- Clock changes use explicit compare-exchange logic where the implementation requires it.

## ANTI-PATTERNS

- Never introduce OS desktop APIs into the fake backend.
- Do not consume a RefuseFocus fault through a method path that marks it unreachable.
- Do not replace recorded effects with real input or make fake-clock tests depend on wall-clock timing.

## CHECKS

- `cargo test -p senpi-desktop-backend-fake`
- Run the affected desktop-core conformance replay when changing shared fixture semantics.
