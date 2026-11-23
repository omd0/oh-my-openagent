# device-service-core

## OVERVIEW

Typed SDK for the OmO device service's authenticated local API and pinned-service bootstrap.

**Score:** 10; distinct domain: local device control, signed acquisition, and lifecycle contracts.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public SDK boundary | `src/index.ts` | Source exports; no package dist build |
| Client internals | `src/` | Own AGENTS.md for handshake, transport, and validation |
| Wire specification | `docs/local-api.md` | Local API v1 and delegated command contracts |
| Startup and account state | `src/bootstrap.ts`, `src/account-state.ts` | Sign-in classification precedes installation and connection |
| Pinned service release | `src/pin.ts`, `src/release/` | Pin, asset selection, signature checks, version comparison |
| SDK regressions | `test/*.test.ts` | Bootstrap, install, account skew, acquisition, registrant lifecycle |
| Protocol conformance | `test/local-api/conformance/` | Fake owner and per-method JSON fixtures |
| Security corpus | `test/strict-ed25519/` | Native/reference verification path |
| Test preloads | `bunfig.toml` | Shared telemetry guard and deadline preload |

## CONVENTIONS

- Private ESM workspace package; its sole package export points to `src/index.ts`.
- The current startup pin is `DEVICE_SERVICE_VERSION = "0.1.3"`; `pin.ts` records why.
- Package commands: `bun test test`; `bun check --no-script --all -p tsconfig.json`.
- From the repository root, run the suite with `bun test packages/device-service-core`.
- Refusal states such as `not_published` are part of the SDK contract, not generic thrown failures.

## ANTI-PATTERNS

- Startup must not read credentials or adopt a device; key handoff uses credentials already held for another operation.
- Bootstrap must not re-enable remote control.
- A release missing from every acquisition origin must return `not_published` without writing an installation.
- Registrant watches must not poll or keep the engine process alive.
- Cryptographic consumers must pass the complete native/reference corpus on their runtime.
