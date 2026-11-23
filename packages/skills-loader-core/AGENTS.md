# skills-loader-core

## OVERVIEW
Harness-neutral skill discovery, builtin/runtime skill sources, matching, and slash-command primitives feed adapter integrations.

Score: 12; distinct domain: shared skill package and export boundaries.
Measured: 141 files, 89% code, local configuration, barrel boundary, 287 AST declarations, 202 exported declarations.
Reference centrality is unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect public entrypoints | `package.json`, `src/index.ts` | Raw-TS root and feature/tool/hook subpaths |
| Discover and merge SKILL.md sources | `src/features/opencode-skill-loader/` | Existing deeper guide owns loader details |
| Change builtin catalog | `src/features/builtin-skills/` | Existing deeper guide owns builtin content |
| Serve runtime security skills | `src/features/opencode-runtime-skills/` | Selection and local source server |
| Match skill or command names | `src/tools/skill/` | Exact/short-name matching and scope sorting |
| Detect slash commands | `src/hooks/auto-slash-command/` | Detection and processed-command state |
| Resolve paths and shell context | `src/shared/` | Config directories, plugin identity, path helpers |
| Change skill configuration | `src/config/` | Source schema and Git environment prefix |
| Change source policy | `src/AGENTS.md` | Containment, matching and disabled names |

## CONVENTIONS
- Package identity is `@oh-my-opencode/skills-loader-core`; it is a private workspace.
- Subpaths expose loader, builtin/runtime skills, skill matching, auto-slash-command, shared and config modules.
- OpenCode's corresponding skill feature paths remain consumers of this extracted implementation.
- `selectRuntimeSecuritySkills()` and `createRuntimeSkillSourceServer()` provide security-research/security-review sources.
- The source server supports Bun.serve and Node HTTP, binds loopback, sends `cache-control: no-store`, and returns 404 for unknown paths.

## ANTI-PATTERNS
- Never introduce adapter imports into this harness-neutral package.
- Never turn an ambiguous short-name match into an arbitrary selected skill.
- Never bypass disabled skill configuration when adding a new discovery source.

## COMMANDS
From this package: `bun run typecheck`, `bun run test`.
From root: `bun test packages/skills-loader-core`.
