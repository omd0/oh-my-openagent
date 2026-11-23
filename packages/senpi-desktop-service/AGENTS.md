# senpi-desktop-service - Desktop Process Client

**Generated:** 2026-11-17. **Score:** 10; distinct domain: desktop engine process integration and host execution.

## OVERVIEW

This private TypeScript package owns the engine's stdio JSON-RPC client and the host-side `computer.run` runtime.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public source exports | `src/index.ts` | Package exports point directly to TypeScript |
| Runtime and RPC implementation | `src/AGENTS.md` | VM, facade, service lifecycle |
| Process-level regression tests | `test/AGENTS.md` | Vitest with fake engine children |
| Package commands and dependencies | `package.json` | Engine and protocol workspace dependencies |
| Architecture narrative | `README.md` | Check constants against source when values disagree |

## CONVENTIONS

- There is no package-local dist build; consumers bundle the exported source.
- One lazy engine child belongs to each agent session; engine location comes from `senpi-desktop-engine`.
- Spawn the engine as an asset with `--stdio` and piped standard streams.
- Linux child launch preserves the relevant display, Wayland, D-Bus, and runtime-directory environment.
- Workspace dependencies and source imports obey the desktop package boundary gate.
- The service layer may depend on protocol, engine, and prelude; desktop-tool consumes this layer.
- The adapter's computer-use component is the integration point; desktop packages do not import the agent engine or UI.
- Engine-side policy owns capture budgets, coordinate frames, and persisted audits.
- Source fixes should preserve that ownership while the service forwards requests and results.

## COMMANDS

- `bun run --cwd packages/senpi-desktop-service test` runs `vitest --run test`.
- `bun run --cwd packages/senpi-desktop-service typecheck` runs the package tsgo check.
- Root `bun run test:desktop` is the broader desktop stack gate.

## ANTI-PATTERNS

- Do not describe `node:vm` as a security boundary.
- Do not add a new compile entry or argv discriminator for the engine asset.
- Do not import `pi-agent-core`, `pi-ai`, or `pi-tui` into this desktop package.
