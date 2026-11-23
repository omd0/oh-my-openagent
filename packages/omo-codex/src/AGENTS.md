# omo-codex/src - Installer and Telemetry Sources

## OVERVIEW
TypeScript implementation of managed Codex installation, cleanup, routing, and anonymous-activity integration.

Score: 11; distinct source domain: 146 TypeScript files, a package barrel, 3,126 AST declarations, and 307 export statements.
The sibling plugin tree owns hook runtime behavior; this tree owns installer mechanics.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Trace installation | `install/install-codex.ts`, `install/install-local-cli.ts` | Orchestration and local CLI entry |
| Change cache layout | `install/codex-cache-*.ts` | Versioned payload, manifest, and bundled MCP handling |
| Change executable placement | `install/codex-installer-bin-dir.ts`, `install/codex-installed-bin-dir.ts` | Resolve then persist installed bin location |
| Inspect uninstall safety | `install/codex-cleanup*.ts` | Managed-state boundaries and recorded agents/bins |
| Change TOML mutation | `install/toml-section-editor.ts` | Section-aware editing rather than wholesale replacement |
| Change model-aware V2 policy | `install/codex-multi-agent-v2-config.ts` | Catalog selection, legacy shorthand, managed cap removal |
| Change managed model defaults | `install/codex-model-catalog.ts`, `install/managed-agent-reasoning-defaults.ts` | User customizations survive managed upgrades |
| Change development stamping | `install/lazycodex-version-stamp.ts` | Installer version override |
| Check activity parity | `telemetry/cross-package-equivalence.test.ts` | Shared telemetry contract |

## CONVENTIONS
- Publish stable `scripts/install*.mjs` paths by rebuilding from these sources with `bun run build:codex-install`.
- Explicit `binDir` or `CODEX_LOCAL_BIN_DIR` wins; non-default `CODEX_HOME` defaults to its own `bin`; the default home uses `~/.local/bin`.
- Cleanup reads `.installed-bin-dir.json` before removing the cache that stores it.
- Catalog `multi_agent_version` wins; absent catalog entries for GPT-5.6/GPT-6 families prefer V2.
- Remove the legacy boolean `multi_agent_v2` key before materializing its same-named TOML table.
- V2-preferred models remove incompatible `agents.max_threads` and managed disable settings.
- Remove only historical managed cap values on other paths; preserve other user-set values.
- Cleanup returns structured skipped-path reasons instead of treating unsafe targets as owned.

## ANTI-PATTERNS
- Never insert or raise either concurrency cap or force V2 enabled.
- Never remove the whole `runtime/` tree recursively; only `runtime/ast-grep` and `runtime/node` are managed runtime subtrees.
- Never follow symlinks into another plugin's bootstrap data or clean a filesystem-root Codex home.
- Do not discard the installed-bin record and recompute a one-shot installation override during uninstall.
- Do not hand-edit the generated installer bundles instead of their TypeScript source.
