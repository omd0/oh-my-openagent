# ast-grep MCP execution

## OVERVIEW
Request dispatch validates structural patterns and runs bounded previews before any requested filesystem mutation.

Score: 11; distinct domain: request validation, subprocess limits, and apply semantics.
Measured: 22 source files, 189 AST declarations, 76 exported declarations; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change dispatch or tool definitions | `mcp.ts` | Argument coercion, error codes, idle server |
| Change process collection | `sg-runner.ts` | JSON records, stderr, payload and match caps |
| Change pattern diagnostics | `pattern-hints.ts` | Metavariables and warn/reject/always-reject |
| Normalize matches and diagnostics | `normalize.ts` | Common tool result shape |
| Change search | `tools/search.ts` | Search schema and argument building |
| Change replacement | `tools/rewrite.ts` | Preview and separate apply arguments |
| Change rule execution | `tools/scan.ts` | Explicit rule-file or inline-rules input |
| Check gateway schema constraints | `mcp-schema.test.ts` | Model-facing schema compatibility |
| Check startup and idle exit | `mcp-startup.test.ts`, `mcp-idle-timeout.test.ts` | Process lifecycle contracts |

## CONVENTIONS
- Rewrite and scan first collect bounded JSON previews, then use a separate `--update-all` invocation.
- A truncated preview must not reach the apply pass.
- Pattern size is limited to 16 KiB; replacement and inline rules to 64 KiB, measured as UTF-8 bytes.
- Runner bounds: 1 MiB per JSON record, 64 KiB stderr, 4 MiB MCP payload.
- `maxMatches` defaults to 50 and accepts 1-500; timeout defaults to and cannot exceed 300000 ms.
- Warning hints never reject; `force` bypasses ordinary rejection, never `always-reject`.
- Replacement metavariables must be captured by the pattern with matching cardinality.
- Empty replacement deletes a match.

## ANTI-PATTERNS
- Never combine JSON output and mutation in one ast-grep invocation.
- Never discover ambient `sgconfig.yml` for scan; require exactly one of `ruleFile` or `inlineRules`.
- Never make `force` bypass empty patterns, unsupported languages, invalid bounds, or unbound replacements.

## CHECKS
Run the adjacent tool tests for changes to argument construction or preview/apply behavior.
Protocol changes also need the package's schema, timeout, and startup tests.
