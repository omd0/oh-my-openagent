# assets/ - Generated Schemas

**Score:** 0; retained existing guidance for the generated-artifact contract.

## OVERVIEW

Checked-in JSON artifacts consumed by editors, CLIs, installers, and published packages. This directory is output, not the source of configuration or help contracts.

## WHERE TO LOOK

| Artifact | Generator / source |
|----------|--------------------|
| `oh-my-opencode.schema.json` | `script/build-schema.ts` + OpenCode Zod schemas under `packages/omo-opencode/src/config/schema/` |
| `omo.schema.json` | `script/build-omo-schema.ts` + `packages/omo-config-core/` |
| `help/*.schema.json` | `script/build-help-schemas.ts` + CLI help definitions |

`help/` contains the `acp`, `doctor`, `sandbox`, and `status` machine contracts.
Some schema generators publish multiple copies; review every output they change.

## COMMANDS

```bash
bun run build:schema
bun run build:omo-schema
bun run script/build-help-schemas.ts
bun test tests/omo-schema-freshness.test.ts
```

## CONVENTIONS

- Regenerate after changing the corresponding source schema or help definition.
- Commit generated output with the source change that requires it.
- Review diffs for accidental field removal, default changes, or stale descriptions.

## ANTI-PATTERNS

- Never hand-edit generated JSON.
- Never fix a freshness test by weakening or deleting the assertion.
- Never update only one schema copy when a shared source feeds multiple artifacts.
