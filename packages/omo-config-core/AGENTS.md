# omo-config-core - Unified Configuration Engine

## OVERVIEW
Harness-neutral schemas, layered JSONC loading, model catalog resolution, atomic edits, and journaled legacy migration.

**Score:** 12; distinct domain: shared configuration authority and its filesystem contracts.
Measured: 124 files, 97% code, own config and src/index.ts boundary, 252 function declarations and 371 export statements; graph centrality unavailable.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public surface | src/index.ts | Schema, loader, models, writer, migration barrels |
| Config shape | src/schema/config.ts | Strict merged schema and permissive layer variant |
| Harness vocabulary | src/schema/harness.ts | native is canonical; senpi is a legacy alias |
| Agent/category settings | src/schema/{agent,category}.ts | Adapter-compatible field names |
| Task/team settings | src/schema/{task,team}.ts | Defaults and partial layer schemas |
| Model/side-panel/memory settings | src/schema/ | Domain schemas and resolvers |
| Layer loading | src/loader/loader.ts | Diagnostics, canonicalization, final defaults |
| Paths and precedence | src/loader/paths.ts | User first, walked project layers farthest first |
| Harness/profile selection | src/loader/resolution.ts | Base, harness, profile, profile harness |
| Unioned denylists | src/loader/disabled-skills.ts | disabled_skills and exclude_models helpers |
| Safe object merge | src/loader/merge.ts | Prototype key stripping at every depth |
| Model aliases and cycles | src/models/ | Site tuning wins over catalog tuning |
| Comment-preserving edits | src/writer/{writer,surgical-edit}.ts | Backup and atomic rename |
| Migration transactions | src/migration/ | Lease, journal recovery, no-clobber merge |

## CONVENTIONS

- Package exports TypeScript source and is sideEffects: false; IO crosses injected filesystem ports.
- User configuration lives only under ~/.omo on every platform; prefer omo.jsonc and fall back to omo.json.
- Project discovery walks toward the environment and OS-account home boundaries without counting a home as another project layer; nearest project wins over ancestors and user.
- Resolve shared base -> harness block -> selected profile -> profile harness; strip control keys and apply defaults once after merging.
- Canonical harness ids are opencode/native/codex. Legacy [senpi] folds first so [native] wins conflicting keys; legacy category names normalize without rewriting free text.
- Profile precedence is explicit option, OMO_PROFILE, OCX_PROFILE, then OPENCODE_CONFIG_DIR ending in profiles/<name>.
- Objects merge recursively; scalars and arrays replace. Dedicated collectors union disabled_skills and exclude_models across loaded scopes.
- Invalid leaves are pruned with invalid-value diagnostics; unknown keys are stripped with dotted-path diagnostics. Unrecoverable layers are skipped; an unrecoverable merged document returns defaults and diagnostics.
- Writers preserve comments, indentation, and trailing commas; existing files receive exclusive-create timestamped backups, then a unique temp file is renamed atomically.
- OmoConfigWriteError carries read/parse/backup/write operation and cause; migration recovers journals before evaluating predicates and records per-target/id markers.

## ANTI-PATTERNS

- Never import OpenCode, Codex, Senpi/Pi, or adapter modules through this harness-neutral package.
- Never restore XDG, APPDATA, or ~/.config/omo user-config lookup; legacy-user-config-purge.test.ts guards it.
- Never load symlinked project .omo/config paths or write through symlinked config targets.
- Never let __proto__, prototype, or constructor survive recursive merge sanitization.
- Never overwrite invalid JSONC, clobber migration targets, or discard user comments and unrelated edits.
- Never hand-edit assets/omo.schema.json; regenerate through the root build:omo-schema script.
- Category schema changes must preserve parity with ../omo-opencode/src/config/schema/categories.ts, checked by tests/omo-config-category-drift.test.ts.

## COMMANDS

- tsgo --noEmit -p packages/omo-config-core/tsconfig.json
- bun test packages/omo-config-core
- bun run build:omo-schema

Loader, merge, writer-security, and schema tests are colocated; shared-core-extraction-guard.test.ts enforces the adapter boundary.
