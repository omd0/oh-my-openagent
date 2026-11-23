# omo-opencode - OpenCode Adapter Package

## OVERVIEW
Private workspace adapter for the Ultimate OpenCode plugin, with legacy server wiring and an OpenCode v2 setup entry.

**Score:** 12; distinct domain: adapter exports, build ownership, and compatibility boundaries.
Measured: 2,856 files, 97% code, package config and src/index.ts boundary, more than 30 functions and 10 exports; reference centrality unmeasured.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin build entry | src/index.ts | Default plugin module plus v2 setup |
| Source architecture and QA mandate | src/AGENTS.md | Hook/tool composition and isolated real-host proof |
| Legacy server bootstrap | src/testing/create-plugin-module.ts | Injectable initialization and disposal |
| OpenCode v2 setup | src/opencode-v2/server-entry.ts | Setup forwarded by default export |
| CLI and plugin source | src/ | Prior root src/ moved here |
| Public migration export | src/config-migration/index.ts | Dependency-clean discovery/transform boundary |
| Public service-auth export | src/cli/service-auth/index.ts | Shared CLI authentication contract |
| Public binary downloader export | src/shared/binary-downloader.ts | Exposed as ./binary-downloader |
| Catalog automation | scripts/ | OpenGateway model-catalog generation |
| Adapter package contract | package.json | Workspace dependencies and TS subpath exports |

## CONVENTIONS

- The package has no root export in package.json; its three declared subpaths are config-migration, service-auth, and binary-downloader.
- Root build automation bundles src/index.ts into the main distribution; this private workspace package is not an independent release surface.
- The adapter composes shared Core packages, but retains OpenCode-specific hooks, schemas, agent factories, CLI integration, and live-session state.
- omo-codex remains a transitional adapter dependency; senpi-task is a separate task engine with different tool/team contracts.
- Migration discovery is consumed by other editions through the declared subpath; keep that boundary dependency-clean.
- Source guidance owns the operational OpenCode QA procedure; read it before changing anything under src/.

## ANTI-PATTERNS

- Never assume the private workspace version is the public distribution version.
- Never add adapter behavior to a shared Core package to bypass its harness boundary.
- Never infer Senpi task/team tool parity from similarly named OpenCode modules.

## COMMANDS

- tsgo --noEmit -p packages/omo-opencode/tsconfig.json
- bun test packages/omo-opencode/src
- bun run build (repository root)
