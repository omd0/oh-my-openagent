# senpi-desktop-protocol

**Generated:** 2026-11-17. **Score:** 9; distinct domain: TypeScript desktop wire types and direct-call approval classification.

## OVERVIEW

Source-exported TypeScript package defines engine JSON-RPC data, session snapshots, audit records, and the computer helper method allowlists.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Find public exports | `src/index.ts` | Typed package entry |
| Classify direct helper chains | `src/call.ts` | Desktop/display/window/element policies |
| Change JSON-RPC data | `src/json-rpc.ts` | Requests, responses, errors, rejections |
| Change session/display results | `src/session.ts` | Screenshots and session snapshots |
| Change capability/notification data | `src/wire.ts`, `src/audit.ts` | Engine observations and audit types |
| Inspect mirrored engine vocabulary | `src/engine-schema.generated.ts` | Version, ABI, methods, notifications, error names |
| Regenerate the mirror | `scripts/generate-engine-schema.ts` | Reads committed Rust core schema |
| Check policy semantics | `test/call.test.ts`, `test/method-allowlist.test.ts` | Allowed calls and method tiers |
| Check Rust/TypeScript agreement | `test/schema-drift.test.ts` | Compares exported values with the schema |

## CONVENTIONS

- Package exports point directly at `src/index.ts`; no separate compiled API surface.
- This layer contains no workspace-package imports.
- The schema source is `crates/senpi-desktop-core/schema/engine.schema.json`.
- Direct calls permit one root invocation and at most one display/window/element handle hop.
- `ComputerCallError.reason` distinguishes empty, excessive, unknown, and unchainable calls.
- Policy lookup checks own properties so inherited object members cannot become allowed methods.
- Tests use Vitest under `test/`; the package's test script is the collection entry.

## ANTI-PATTERNS

- Never hand-edit `engine-schema.generated.ts`; regenerate after changing the Rust schema.
- Never classify unknown methods or malformed chains as inspection reads.
- Never extend a direct chain beyond one handle hop; longer sequences belong in the run facade.
- Never add host adapter or desktop-service imports to this wire-contract layer.

## COMMANDS

```bash
bun run --cwd packages/senpi-desktop-protocol test
bun run --cwd packages/senpi-desktop-protocol typecheck
bun run --cwd packages/senpi-desktop-protocol generate
```
