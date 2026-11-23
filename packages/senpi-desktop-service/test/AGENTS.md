# test/ - Desktop Service Process Contracts

**Generated:** 2026-11-17. **Score:** 9; distinct domain: fake-engine process evidence and run isolation.

## OVERVIEW

Vitest tests drive real Node child processes with controlled protocol behavior and exercise the VM facade without requiring a desktop session.

## WHERE TO LOOK

| Contract | Location |
|----------|----------|
| Child spawning and request observations | `harness.ts`, `fake-engine.mjs` |
| Fake desktop methods and results | `fake-desktop.mjs` |
| Service lifecycle and engine negotiation | `service.test.ts`, `engine.test.ts` |
| Run values, timeout, and isolation | `run.test.ts` |
| Control confirmations and grants | `control.test.ts`, `control-boundaries.test.ts`, `control-harness.ts` |
| Full-access decisions and global input | `full-access-consent.test.ts`, `global-input-grant.test.ts`, `global-input-harness.ts` |
| Acquire and launch refusal paths | `acquire-child.test.ts`, `launch-refusal*.test.ts`, `fixtures/refusing-engine` |
| Compatibility with capabilities | `forward-compat.test.ts`, `legacy-capabilities.test.ts` |
| Capture, observation, zoom, and holds | `display.test.ts`, `observe.test.ts`, `zoom.test.ts`, `holds.test.ts` |

## CONVENTIONS

- Use the package's Node-environment Vitest runner, configured in `../vitest.config.ts`.
- `fakeEngineFactory()` exposes the injectable `ChildFactory`, children, received requests, and kill count.
- `SpawnLog.nthRequest(method, n)` synchronizes assertions with the fake engine's actual wire echo.
- A wire request carries its child index so restart tests distinguish old and new engine traffic.
- Fake behavior is selected through the child environment rather than production service special cases.
- `control-harness.ts` owns service cleanup and a run timeout that leaves room for confirmation.
- Its default tool callback rejects unexpected tools; tests explicitly supply tool behavior when needed.
- Run from the repository root with `bun run --cwd packages/senpi-desktop-service test`.

## ANTI-PATTERNS

- Do not substitute Bun's test runner for the package's Vitest process suite.
- Do not infer request arrival or restart ordering from fixed delays; observe the wire request.
- Never leave opened services or spawned children alive after a test.
- Do not use the user's live desktop as this unit suite's fixture.
