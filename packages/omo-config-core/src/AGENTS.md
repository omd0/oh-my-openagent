# omo-config-core/src - Configuration Internals

## OVERVIEW
Schema composition, validation diagnostics, surgical JSONC edits, and migration transaction implementation.

Score: 13; distinct implementation domain with 120 TypeScript files, six subdirectories,
index.ts, 519 top-level source declarations and 318 distinct explicit exports.

## STRUCTURE
| Directory | Responsibility |
|-----------|----------------|
| schema/ | Domain schemas and merged/layer configuration contracts |
| loader/ | Parsed layers, validation, view resolution, and diagnostic lines |
| models/ | Catalog lookup and tuning resolution |
| writer/ | JSONC edits, backup creation, and filesystem write ports |
| migration/ | Predicates, leases, journals, commit/recovery, and target merges |
| internal/ | Shared JSONC parser seam |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public surface | index.ts | Five subsystem re-export barrels |
| Validation gate ordering | loader/layer-validation.ts | Unsafe keys, unknown keys, invalid leaves |
| Invalid-leaf pruning | loader/prune-invalid-leaves.ts | Smallest condemned subtree, bounded passes |
| Printed notices | loader/diagnostic-lines.ts | Stable diagnostic-to-line boundary |
| Harness view projection | loader/resolution.ts | Resolve a view before final defaults |
| Shared parser | internal/jsonc-parse.ts | Parsed data plus error list |
| Layout-preserving edits | writer/surgical-edit.ts | Compare hand edit with parser-generated data |
| Write errors and ports | writer/types.ts | OmoConfigWriteError operations and injected filesystem |
| Transaction admission | migration/{predicate,lock}.ts | Migration applicability and ownership |
| Durable recovery | migration/{journal,recovery,commit}.ts | Crash-state repair and commit sequence |
| Merge and move operations | migration/{merge,backup-move}.ts | Target-preserving changes |

## CONVENTIONS
- Pruning resolves an issue to its deepest existing path; a missing required key condemns
  the containing object. Outermost targets subsume child issues and arrays remove indices descending.
- Remove ancestors emptied by pruning; revalidate each pass with MAX_PRUNE_PASSES = 32.
- Reject a layer when an issue names the document root, no valid content remains,
  no progress occurs, or the prune bound is exhausted.
- Retired top-level sections are recognized by SHA-256 digest and dropped silently
  at supported config containers, including harness and profile blocks.
- Surgical inserts/removals operate on full member lines only when the remaining line is trivia.
- Preserve CRLF only for consistently CRLF documents; mixed endings use parser formatting.
- Keep a surgical edit only when parsed data equals jsonc-parser's edit result;
  the sole-member trailing-comma case separately requires the surgical result to parse.

## ANTI-PATTERNS
- Never remove array entries in ascending order while later issue paths still refer to indices.
- Never remove a whole line that also holds another JSONC member.
- Never keep a formatting-preserving edit that changes the parser-produced data.
- Never broaden retired-key digest matching into free-text configuration rewriting.
