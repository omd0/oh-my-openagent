# Skill discovery and matching source

## OVERVIEW
Skill source resolution preserves provenance, containment, disable rules, and deterministic matching across discovery paths.

Score: 11; distinct domain: skill authorization and resolution internals.
Measured: 137 files, 92% code, 287 AST declarations, 202 exported declarations; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Follow synchronous discovery | `features/opencode-skill-loader/loader.ts` | `discoverSkills`, `discoverAllSkills` |
| Follow asynchronous discovery | `features/opencode-skill-loader/async-loader.ts` | Companion async implementation |
| Track source provenance | `features/opencode-skill-loader/skill-provenance.ts` | Project-auto path containment |
| Read authorized source | `features/opencode-skill-loader/checked-skill-read.ts` | Descriptor identity and link checks |
| Normalize disable settings | `features/opencode-skill-loader/skill-disable-config.ts` | Lowercase aliases and config variants |
| Deduplicate by name | `features/opencode-skill-loader/skill-deduplication.ts` | Keeps the first encountered name |
| Read configured skill sources | `features/opencode-skill-loader/config-source-discovery.ts` | Config-driven discovery |
| Merge loaded definitions | `features/opencode-skill-loader/merger/` | Specialized merge modules |
| Match names | `tools/skill/skill-matcher.ts` | Exact, unique short name, partial suggestions |
| Order command candidates | `tools/skill/scope-priority.ts` | Priority followed by code-unit name ordering |
| Inspect builtin/loader local rules | `features/{builtin-skills,opencode-skill-loader}/AGENTS.md` | Existing deeper guidance remains authoritative |

## CONVENTIONS
- Keep synchronous and asynchronous discovery behavior aligned.
- Name matching is case-insensitive; a short alias resolves only when exactly one namespaced skill matches.
- Command sorting copies its input and breaks scope-priority ties by code-unit name comparison.
- Skill disable forms normalize into one lowercase alias set.
- Project-auto reads validate containment and pin descriptor identity before consuming content.
- Non-project-auto provenance uses the ordinary file read path.
- Only containment violations use the skill-security warning; ordinary I/O errors retain their path and errno.
- A replaced authorized descriptor fails closed; the implementation does not claim to prevent ancestor-directory swaps.
- `features/opencode-skill-loader/changes.md` records loader behavior and vendored changes with issue provenance.

## ANTI-PATTERNS
- Disabled skill names must never load through either sync or async discovery.
- Never replace containment-checked project-auto reads with an unguarded read.
- Never turn every read failure into a misleading containment/security diagnosis.
- Never rely on discovery or locale order for deterministic command listings.

## CHECKS
Prioritize loader-deduplication, skill-containment, async-loader and matching tests for changes at these seams.
