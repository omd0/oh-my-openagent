# rules-engine - Discovery and Matching Core

## OVERVIEW
Harness-neutral rule discovery and matching shared by OpenCode, Codex, and AGENTS.md injection.

Score: 12; distinct domain: two production rule APIs and their source precedence contracts.
Measured: 53 files, 49 TypeScript files, own package config, src/index.ts boundary;
254 top-level source declarations and 135 distinct explicit exports; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Simple API | src/index.ts | findRuleFiles, shouldApplyRule, findAgentsMdUp |
| Stateful API | src/engine/index.ts | Package subpath ./engine |
| Project and user discovery | src/finder.ts | Scope boundaries and observable legacy warnings |
| AGENTS.md walk-up | src/agents-md.ts | Injection itself belongs to agents-md-core |
| Simple matching | src/matcher.ts | Picomatch, realpath/content dedupe, cache |
| Engine lifecycle | src/engine/engine.ts | Static/dynamic loads and session reset |
| Source selection | src/engine/{finder,sources}.ts | Platform-gated bundled candidates |
| Recursive scans | src/scanner.ts, src/engine/scanner.ts | Separate discovery caches |
| YAML frontmatter | src/parser.ts, src/engine/parser-yaml.ts | Rule metadata |
| Formatted budgets | src/engine/{formatter,truncator}.ts | Per-rule and aggregate limits |
| Source order and markers | src/constants.ts, src/engine/constants.ts | Numeric priority and distance |

## CONVENTIONS
- Package identity is @oh-my-opencode/rules-engine, formerly rules-core.
- Both src/ and src/engine/ are live production APIs; maintain their existing boundaries.
- Simple imports are extensionless; engine relative imports retain explicit .js suffixes.
- Runtime dependencies remain picomatch and @oh-my-opencode/utils only.
- Discovery walks from the target toward the project root, then collects user-home sources.
- Project directories include .omo/rules, .claude/rules, .cursor/rules, and .github/instructions.
- Single-file sources include .github/copilot-instructions.md and CONTEXT.md.
- Rule extensions are .md/.mdc; plugin-bundled sources are platform gated.
- Legacy .sisyphus/rules remains matched with an injected deprecation logger;
  the rules-sisyphus-deprecated event makes migration to .omo/rules observable.
- Matching recognizes globs, paths, applyTo, and alwaysApply metadata.
- Negative patterns exclude paths; alwaysApply bypasses path matching.
- Lower SOURCE_PRIORITY values come first; closest distance wins within precedence.
- Engine default static budgets are 12K per rule / 40K total;
  dynamic budgets are 4K / 10K and post-compact budgets are 3.5K / 4K characters.
- OpenCode rules-injector and Codex rules consume discovery/matching;
  agents-md-core consumes AGENTS.md discovery and owns injection behavior.

## ANTI-PATTERNS
- Do not normalize the different import styles or collapse the two API trees.
- Do not silently remove legacy-source warnings while keeping legacy discovery.
- Do not move adapter-specific injection behavior into this shared package.

## COMMANDS
- bun run --cwd packages/rules-engine typecheck
- bun run --cwd packages/rules-engine test
