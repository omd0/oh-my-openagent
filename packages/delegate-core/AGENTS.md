# delegate-core - Delegate Selection and Retry Guidance

## OVERVIEW
Harness-neutral model selection and task-invocation repair hints, with injected dependencies and no I/O.

Score: 5; existing guidance retained for a distinct shared selection-policy domain.
The six source files expose their public API through `src/index.ts`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Resolve a delegation model | `src/model-selection.ts` | Input, result, dependency types and fallback policy |
| Detect invocation errors | `src/retry-patterns.ts` | Nine ordered patterns, gated by error markers |
| Build a corrective hint | `src/retry-guidance.ts` | Options and an example invocation |
| Check resolution behavior | `src/model-selection.test.ts` | Provider, cache, user choice, and variant cases |
| Check error recognition | `src/retry-patterns.test.ts` | Task error signatures |
| Change the public boundary | `src/index.ts`, `package.json` | Source ESM exports; private workspace package |

## CONVENTIONS
- Resolution order: user override, cold-cache skip, category default, user fallbacks, built-in chain, system default, undefined.
- An unreachable user override may promote the first reachable user fallback.
- Cold caches defer with `{ skipped: true }`; an explicit user override precedes that check.
- User-configured category defaults bypass built-in availability validation.
- Explicit `-high` choices must retain their identity rather than fuzzy-downgrade.
- A matched fallback carries its variant and fallback-entry metadata into the result.
- Provider-specific model transformation runs before exact fallback matching.
- `detectDelegateTaskError` requires `[ERROR]` or `Invalid arguments` before matching a pattern.
- Model parsing and matching come from `@oh-my-opencode/model-core`.
- OpenCode delegate/retry adapters and the Senpi task engine consume this policy; the Codex installer does not.

## ANTI-PATTERNS
- Never route a built-in fallback rung through a provider it does not list, including a gateway republishing the model.
- `allowUnlistedProviders` is an opt-in for user-selected rungs, not a built-in default.
- Cross-provider matching must skip providers reserved by a later dedicated rung for the same model.
- Never turn an uninitialized provider cache into an arbitrary model choice.
- Keep host caches, transport calls, and mutable session state outside these primitives.

## COMMANDS
Run inside this package:
`bun test src/*.test.ts`
`tsgo --noEmit -p tsconfig.json`
