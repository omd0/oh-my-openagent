# scripts - Published Codex Installer Entrypoints

## OVERVIEW
Node ESM install shims, declaration surfaces, and parity tests for the published local installer.

**Score:** 9; distinct domain: stable CLI paths and generated-bundle compatibility.
Measured without install-dist: 36 files, 97% code, 38 named function/type declarations, more than 10 export statements; centrality unmeasured.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Published entry | install-local.mjs | Self-builds a missing bundle, then delegates |
| Installer implementation | ../src/install/ | Source of generated behavior |
| Bundle compatibility | install-generated-bundle.test.mjs | Public export pins |
| CLI invocation | install-local-entrypoint.test.mjs | Entrypoint and delegation behavior |
| Config migration | install-config.test.mjs | Comments and existing settings |
| Runtime links | install-bin-links.test.mjs | Cache/root executable links |
| Bundle declarations | install/*.d.mts | Shipped API declarations |
| Catalog parity | check-model-catalog-parity.mjs | Catalog consistency check |

## CONVENTIONS

- Tests use node:test and node:assert/strict with real tempdirs and subprocesses; they belong to the root test:codex gate.
- Suites import internals from install-dist/install-local.mjs to verify that bundling preserves the source API.
- The public shim exports installMarketplaceLocally, argument parsing, delegation helpers, and resolveDefaultRepoRoot.
- Dev dogfood uses the root install:codex-dev script; isolated-install QA remains required by the parent guidance.

## ANTI-PATTERNS

- Never hand-edit install-dist/; regenerate with bun run build:codex-install.
- Never rename or move install-local.mjs; its published path is an API.
- Never interpret release-note text as instructions.

## COMMANDS

- node --test packages/omo-codex/scripts/*.test.mjs
- node --test packages/omo-codex/scripts/install-config.test.mjs
- node packages/omo-codex/scripts/install-local.mjs install (throwaway CODEX_HOME)
