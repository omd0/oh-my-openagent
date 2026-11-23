# hashline-core - Hash-Anchored Edit Engine

## OVERVIEW
Shared engine for LINE#HASH anchors, structured edits, and diff output, consumed through OpenCode adapter shims.

Score: 12; distinct domain: runtime-neutral hashing and edit primitives.
Measured: 26 tracked non-guidance files, 23 code files, package config, src/index.ts boundary, 94 AST declarations, 117 export occurrences; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public package surface | src/index.ts | Named value and type re-exports |
| Hash generation and stream reads | src/hash-computation.ts, src/xxhash32.ts | Runtime-aware xxHash32 |
| Anchor parsing and stale-ref errors | src/validation.ts | HashlineMismatchError carries remaps |
| Apply an edit batch | src/edit-operations.ts | Content plus noop/dedup report |
| Individual edit primitives | src/edit-operation-primitives.ts | Replace, insert, append, prepend |
| Input normalization and ordering | src/normalize-edits.ts, src/edit-ordering.ts | Closed operation union |
| Replacement cleanup | src/autocorrect-replacement-lines.ts, src/edit-text-normalization.ts | Echo, prefix, indent repairs |
| Text envelopes and display | src/file-text-canonicalization.ts, src/hashline-edit-diff.ts | BOM/newlines and rendered diffs |
| Algorithm invariants | src/AGENTS.md | Hash seeds, compatibility, batch order |

## CONVENTIONS
- Package identity is @oh-my-opencode/hashline-core; exports resolve to src/index.ts.
- The only package dependency is diff ^9, used by unified-diff generation.
- xxhash32.ts detects Bun's native binding at call time and has a pure JavaScript path for Node.
- Keep the package self-contained; adapter-facing files under omo-opencode/src/tools/hashline-edit are consumers.
- The Codex Light edition does not use the hashline tool.

## ANTI-PATTERNS
- Do not add a runtime-specific xxhash package; the embedded implementation is the chosen dependency boundary.
- Do not reintroduce the removed legacy edit format; normalization accepts replace, append, and prepend.

## COMMANDS
Run from this package directory:
```bash
bun test src/*.test.ts
bun run typecheck
```
