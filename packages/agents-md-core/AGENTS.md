# agents-md-core - Directory Guidance Injection

**Generated:** 2026-11-17. **Score:** 3; existing guidance retained for the discovery/injection boundary.

## OVERVIEW

Harness-neutral path resolution, context formatting, and session injection caches over rules-engine discovery.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public exports | `src/index.ts` | Four functions plus injected-port types |
| Resolve input paths | `src/finder.ts` | Canonicalize root and candidate; refuse escape |
| Discover and inject | `src/injector.ts` | Resolve, discover, read, truncate, format, cache |
| Render context | `src/formatter.ts` | Directory-context block and truncation notice |
| Track injected directories | `src/injection-cache.ts` | Per-session set backed by caller storage |
| Supply adapter ports | `src/types.ts` | Truncator, mutable output, storage interfaces |
| Exercise injection | `src/injector.test.ts` | Package-local Bun tests |

## CONVENTIONS

- Discovery delegates to `findAgentsMdUp` and `AgentsMdCache` in rules-engine, the sole runtime dependency.
- Truncation strategy and persistence belong to injected ports, not this package.
- Keep existing semicolons; this package differs from the repository's usual formatting.
- OpenCode's directory-agents-injector shims and Hephaestus hook consume this surface.
- Path canonicalization uses realpath when available and lexical resolution when it fails.
- Injection caches directory paths, skips unreadable guidance, and saves storage only after additions.
- `package.json` exposes source through `index.d.ts`; it has package-local test and typecheck scripts.

## ANTI-PATTERNS

- Never bypass the root-containment check when accepting a file path.
- Do not duplicate rules-engine's walk-up discovery or add harness dependencies here.
- Do not implement an adapter's truncation or storage policy inside the core.

## CHECKS

- `bun test packages/agents-md-core/src/`
- `bun run --cwd packages/agents-md-core typecheck`
