# hashline-core/src - Edit Algorithm Contracts

## OVERVIEW
Hash calculation, anchor validation, batch mutation, and text-preserving output live together here.

Score: 11; distinct domain: the algorithm invariants beneath the package API.
Measured: 23 TypeScript files, index.ts boundary, 94 AST declarations and 117 named export occurrences; graph references unavailable.

## WHERE TO LOOK
| Behavior | Implementation | Regression coverage |
|----------|----------------|---------------------|
| Current and legacy hash equivalence | hash-computation.ts | hash-computation.test.ts |
| Stale refs, normalization, remap hints | validation.ts | validation.test.ts |
| Batch ordering and dedup reports | edit-operations.ts, edit-deduplication.ts | edit-operations.test.ts |
| Closed tool input shape | normalize-edits.ts, types.ts | normalize-edits.test.ts |
| Newline envelope and diff accounting | file-text-canonicalization.ts, diff-utils.ts | diff-utils.test.ts |
| Remaining small primitives | hashline-chunk-formatter.ts, edit-ordering.ts | smoke-untested-modules.test.ts |

## CONVENTIONS
- Current hashes remove carriage returns and trim trailing whitespace; legacy validation also accepts hashes with all whitespace removed.
- Lines containing a Unicode letter or number use seed zero; every other line uses its line number, including punctuation-only lines.
- Formatted reads use the one-based line number and the dictionary hash before the pipe separator.
- Deduplicate before sorting; apply higher line numbers first so earlier anchors retain their positions.
- At one anchor, replacement precedes append, then prepend.
- Validate every collected reference against the original lines before any mutation, then reject overlapping ranges.
- Primitive calls skip repeated validation only after that batch-wide validation succeeds.
- Empty file content starts as zero lines; the report separately counts noop and deduplicated edits.
- null replacement lines normalize to an empty list; absent lines remain an error.
- Canonicalization records BOM and newline style so restoration can preserve the file envelope.
- Streaming defaults are 200 lines and 64 KiB per chunk; a single oversized formatted line is emitted intact.

## ANTI-PATTERNS
- Do not change anchor seeds based only on whitespace: the significant-content test also covers punctuation-only lines.
- Do not validate later edits against already-mutated content or silently accept stale anchors.
- Do not discard HashlineMismatchError remaps or its marked context: consumers use them to refresh references.
- Do not split a formatted line to force the byte target; chunk flushing preserves complete records.
