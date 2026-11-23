# rules-engine/src - Rule Selection Algorithms

## OVERVIEW
Candidate scanning, metadata parsing, cache keys, and security boundaries for simple and engine rule selection.

Score: 11; distinct implementation domain with 47 TypeScript files, index.ts,
254 top-level declarations and 135 distinct explicit exports.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Simple discovery cache | finder.ts | Project root, effective root, start directory, Claude-user flag |
| Directory scan cache | cache.ts, scanner.ts | Directory entries and canonical paths |
| Root detection | project-root.ts | Clearable project-root cache |
| Simple ordering | ordering.ts, distance.ts | Dedicated distance tests |
| Metadata regression corpus | frontmatter-corpus.test.ts | Shared frontmatter behavior |
| Escape boundary regressions | security-boundary.test.ts | Project rule/instruction symlink rejection |
| Simple integration cases | index.test.ts | Public barrel behavior |
| Stateful dependency contract | engine/engine-types.ts | EngineDeps and per-session state |
| Static vs dynamic selection | engine/engine-{static,dynamic}-loader.ts | Separate loader paths |
| Loaded-rule conversion | engine/engine-loader.ts | Candidate loading and static match reason |
| Source inclusion policy | engine/sources.ts | disabledSourcesFromConfig |
| Engine reset | engine/engine.ts | Session state and dynamic-match cache |

## CONVENTIONS
- Simple discovery chooses workspaceDirectory only when no projectRoot is supplied
  and the target starts inside that workspace; otherwise the start directory bounds the walk.
- Project candidates must resolve within the canonical project root before they enter results.
- seenRealPaths deduplicates across discovery sources; directory cache and query cache are separate.
- Cached query results return a copied array, preventing callers from mutating the cached list.
- Legacy-warning dedupe is keyed by rule directory; tests reset its module state after each case.
- loadStaticRules returns empty for off/dynamic-only modes; loadDynamicRules returns empty
  for off/static-only modes and empty target lists. Each load updates last rules/diagnostics.
- resetSession clears both injected-rule state and dynamic-match cache, then applies an optional cwd.

## ANTI-PATTERNS
- Never accept a project rule or instruction directory whose realpath escapes the workspace.
- Never reuse discovery results across different workspace or skipClaudeUserRules cache keys.
- Never clear only injection state while retaining dynamic cache across an engine session reset.
