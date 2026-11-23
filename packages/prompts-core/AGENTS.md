# prompts-core — Markdown Prompt Loading + Variant Routing (Core)

**Generated:** 2026-11-17. **Score:** 8; distinct domain: shared prompt assets and model-variant selection.

## OVERVIEW

Owns bundled mode/role markdown assets and harness-neutral variant selection; `loadPrompt` also supports an explicit asynchronous filesystem source.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Ultrawork directive bodies | `prompts/ultrawork/` | `default`, `gpt`, `gemini`, `glm`, `planner`, `codex` |
| Planning role | `prompts/prometheus/default.md` | Single variant |
| OpenCode orchestration role | `prompts/atlas/` | Nine bodies; ten table keys, including a shared-content alias |
| Mode overlays | `prompts/mode/` | `hyperplan`, `team` |
| Loader and routing mechanics | `src/` | Own AGENTS.md |
| Harness isolation | `test/opencode-coupling-audit.test.ts` | No SDK coupling; markdown imports stay package-relative |

## PUBLIC API (`src/index.ts`)

- **Constants:** `ULTRAWORK_{DEFAULT,GPT,GEMINI,GLM,PLANNER}_PROMPT`, `CODEX_ULTRAWORK_PROMPT`, `HYPERPLAN_MODE_PROMPT`, `TEAM_MODE_PROMPT`; `VariantTable`s `ultraworkPromptVariants`, `codexUltraworkPromptVariants`, `atlasPromptVariants`, `prometheusPromptVariants`.
- **Functions:** `resolveVariant(input)` (uses `model-core` matchers), `loadPrompt`/`loadPromptSync` (bundled sync or filesystem async).
- **Types/errors:** `ModelVariant` (10 literals), `PromptSource`, `LoadedPrompt`, `VariantTable`; `PromptFileNotFoundError`, `PromptPathTraversalError`.

## DEPENDENCIES & CONSUMERS

- **Peer deps:** `@oh-my-opencode/model-core` (`isGptModel`, `isGeminiModel`, `isKimiK2Model`, …), `@oh-my-opencode/utils` (`parseFrontmatter`).
- **Consumers:** `omo-opencode/src/hooks/keyword-detector/{ultrawork,hyperplan,team}/*.ts` (thin re-export shims), `agents/atlas/agent.ts`, `agents/prometheus/system-prompt.ts`; `omo-codex` resolves `prompts-core/prompts/ultrawork/codex.md` directly (secondary export path).

## CONVENTIONS

- **Edit prompt bodies in `prompts/*.md`, NOT the `.ts` loaders.** The `-prompts.ts` files just import + wrap the markdown.
- **No `@opencode-ai/*` imports** — enforced by `test/opencode-coupling-audit.test.ts`.
- **`codex.md` is exported via a secondary package path** (`./prompts/ultrawork/codex.md`) for the Light edition; prometheus stays single-variant (no per-model files).
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
- Package checks: `bun test packages/prompts-core`; `tsgo --noEmit -p packages/prompts-core/tsconfig.json`.

## ANTI-PATTERNS

- Do not add OpenCode SDK imports or markdown imports outside `../prompts/`.
- Do not move prompt bodies into TypeScript loaders or add model-specific Prometheus assets.

## Model cores

Per-model system prompts are not owned here. OpenCode imports Senpi's public
`./prompt-presets` builders through its native-model-prompt adapter. Atlas
markdown retains the existing OpenCode orchestration role and its variants.
`resolveVariant` keeps its original table-order behavior for roles and mode overlays.
