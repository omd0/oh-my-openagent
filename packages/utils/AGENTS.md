# utils - Shared Runtime and Utility Core

**Generated:** 2026-11-17. **Score:** 10; distinct domain: shared runtime portability and internal prompt coordination.

## OVERVIEW

Harness-neutral TypeScript utilities, config helpers, process ownership, logging, and Bun/Node compatibility surfaces.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Merge data safely | `src/deep-merge.ts` | Prototype-key filtering; depth limit 50 |
| Parse frontmatter | `src/frontmatter.ts` | js-yaml JSON_SCHEMA plus rule-mode globs |
| Read and publish files | `src/file-utils.ts`, `src/atomic-write.ts`, `src/xdg-data-dir.ts` | Symlinks, tolerant fsync, XDG fallback |
| Spawn portably | `src/runtime/` | Bun-first spawn/which/file with Node fallback |
| Coordinate internal prompts | `src/prompt-async-gate.ts`, `src/prompt-async-gate/` | Reservation, queue, semantic dedupe, live-route fallback |
| Parse worktree output | `src/git-worktree/` | Porcelain status, diff stats, formatted changes |
| Migrate config | `src/migration.ts`, `src/migration/` | Agent, hook, model, category migrations |
| Execute hook commands | `src/command-executor/execute-command.ts`, `src/command-executor/execute-hook-command.ts` | Child-process command execution and stderr |
| Provision structural search | `src/ast-grep/` | Pinned sg manifest, resolver/cache, installer |
| Reclaim owned processes | `src/process-sweep/` | Family predicates and ownership attestation |
| Handle process trees | `src/process-tree*.ts`, `src/process-stream-reader.ts` | Enumeration, termination, streams |
| Buffer logs | `src/logging/`, `src/logger.ts` | Rotation, identity, injectable logger |
| Inspect archives | `src/zip-entry-listing/` | tar/zipinfo/Python/PowerShell adapters |
| Resolve ports or config | `src/port-utils.ts`, `src/jsonc-parser.ts` | Port selection and JSONC parsing |

## CONVENTIONS

- Public subpath exports in `package.json` avoid forcing all consumers through the main barrel.
- Runtime shims retain the `globalThis.Bun` probe and Node child-process fallback for Electron-hosted consumers.
- `sideEffects` explicitly preserves `src/prompt-async-gate/queue.ts` during tree-shaking.
- Every internal session prompt must route through `dispatchInternalPrompt()` to preserve reservation and deduplication.
- Relative imports, strict ESNext, and bundler module resolution; no path aliases.
- Runtime dependencies include model-core, omo-config-core, js-yaml, and jsonc-parser.
- Process-sweep mirrors LSP daemon paths/auth/ownership layout; change those contracts in lockstep.
- Shared logger consumers may retain adapter re-export shims; keep behavior in this core.

## ANTI-PATTERNS

- Never classify `cli.js daemon` without `mcp` as a proxy sweep candidate.
- Generic argv matching cannot authorize stale-version termination; keep ownership attestation.
- Never import the vendored LSP daemon into utils to recover its private layout.
- Never bypass the internal prompt gate or drop its queue's side-effect declaration.
- Never widen frontmatter parsing beyond JSON_SCHEMA to enable executable YAML tags.

## CHECKS

- `bun run --cwd packages/utils test`
- `bun run --cwd packages/utils typecheck`
