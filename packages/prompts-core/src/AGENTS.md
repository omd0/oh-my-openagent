# prompts-core source

## OVERVIEW

Loads bundled or filesystem prompt sources and resolves model variants in table order.

**Score:** 8; distinct domain: typed prompt loading, injection, and routing mechanics.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public surface | `index.ts` | Re-exports loaders, errors, tables, constants, and types |
| Source discrimination | `types.ts` | `kind: "bundled"` versus optional `"filesystem"` |
| Frontmatter and injection | `loader.ts` | Bundled sync path; filesystem async path |
| Model matching | `variant-resolver.ts` | Matchers imported from `model-core` |
| Ordered role variants | `atlas-prompts.ts` | Specific Kimi variants precede broad Kimi |
| Planner compatibility | `prometheus-prompts.ts` | One default source |
| Mode text imports | `mode-prompts.ts` | Explicit text-loader import attributes |
| Async and sync failures | `loader.test.ts` | Missing files, traversal, frontmatter, injections |
| Routing behavior | `variant-resolver.test.ts` | Table order, planner precedence, fallback |
| Markdown typings | `markdown*.d.ts` | Arbitrary-extension module declarations |
| Loader fixtures | `__test_fixtures__/` | Small filesystem sources for loader tests |

## CONVENTIONS

- `resolveVariant` returns a table key; keys are broader than the `ModelVariant` union.
- Planner selection wins only when the requested agent is Prometheus and the table has `planner`.
- Model matches use insertion order, then `default`, then the first key; an empty table throws.
- Atlas `swe-2` intentionally points to the `kimi-k3.md` source.
- `loadPrompt` overloads preserve the synchronous return for bundled input.
- Placeholder injections run in their supplied order; asynchronous resolvers belong to filesystem input.

## ANTI-PATTERNS

- Do not sort variant keys alphabetically; order participates in model selection.
- Do not cast every variant key to `ModelVariant`; routing also recognizes specific Kimi keys.
- Do not weaken the relative-path escape guard before filesystem reads.
- Do not make the synchronous bundled loader await filesystem access or asynchronous injections.
