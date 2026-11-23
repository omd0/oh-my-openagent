# senpi-desktop-core

**Generated:** 2026-11-17. **Score:** 8; distinct domain: shared desktop types and the Rust engine wire contract.

## OVERVIEW

Rust library owns desktop backend traits, capture/frame types, AX references, and the schema consumed by the engine and TypeScript protocol package.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Find backend ports | `src/backend.rs`, `src/ax/` | Platform-neutral backend and AX contracts |
| Change wire methods | `src/methods.rs` | Method effect, exposure, params, results, notifications |
| Change protocol envelopes | `src/protocol.rs` | Version, ABI, JSON-RPC constants and errors |
| Change typed wire data | `src/protocol_params.rs`, `src/protocol_results.rs`, `src/types/` | Serde and schema types |
| Generate machine schema | `src/protocol_schema.rs` | `engine_schema()` closes object schemas |
| Check generated artifacts | `src/protocol_test.rs` | Schema/doc freshness and frozen error ordinals |
| Validate conformance fixtures | `src/protocol_conformance_test.rs` | Structural checks against committed schema |
| Review replay inputs | `fixtures/conformance/` | Cases refer to fake-backend scenarios |
| Adjust frame processing | `src/frame/` | Geometry, capture caps, encoding |
| Inspect generated contract | `schema/engine.schema.json`, `docs/engine-protocol.md` | Derived artifacts |

## CONVENTIONS

- `lib.rs` exposes typed modules and re-exports `engine_schema`.
- `system-clipboard` alone enables the optional native clipboard dependency; the fake backend and protocol do not need it.
- Method rows bind wire names to effect and exposure; `read` may narrow authority, while `exec` may widen it.
- Host-only controls and test-only methods remain separate from public methods.
- Error additions append to the frozen ordinal table; previous numeric codes stay fixed.
- Core tests validate fixture structure; replaying cases against a running engine belongs to the engine crate.
- Fixture environment keys use `SENPI_DESKTOP_`; scenario paths point into the fake-backend fixture tree.

## ANTI-PATTERNS

- Never hand-edit the generated schema or protocol document instead of changing their typed source and regenerating.
- Never reorder existing error codes to insert an amendment.
- Never expose host-only resume/grant controls as public bridge methods.
- Never treat structural fixture validation as proof that engine replay passed.

## COMMANDS

```bash
cargo test -p senpi-desktop-core
SENPI_DESKTOP_UPDATE_SCHEMA=1 cargo test -p senpi-desktop-core
```

After Rust schema regeneration, regenerate the TypeScript mirror with `bun run --cwd packages/senpi-desktop-protocol generate` from the repository root.
