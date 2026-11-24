# packages/ - Monorepo Packages

**Generated:** 2026-11-17. **Score:** 9; distinct domain: workspace boundaries, packaging, and cross-package ownership.

## OVERVIEW

51 sibling directories contain adapters, shared engines, desktop components, distribution metadata, skills, and hosted applications; each package owns its publication and install contract.

## STRUCTURE

| Role | Count | Packages |
|------|-------|----------|
| **Platform launcher packages** | 12 | One per OS/architecture/variant. Package metadata selects a generated `bin/` payload at install time. |
| **MCP packages** | 4 | `lsp-tools-mcp`, `git-bash-mcp`, `lsp-daemon`, `ast-grep-mcp` |
<<<<<<< HEAD
| **Core packages** | 22 | `utils`, `model-core`, `prompts-core`, `rules-engine`, `agents-md-core`, `comment-checker-core`, `hashline-core`, `boulder-state`, `telemetry-core`, `lsp-core`, `mcp-stdio-core`, `tmux-core`, `claude-code-compat-core`, `skills-loader-core`, `mcp-client-core`, `openclaw-core`, `team-core`, `delegate-core`, `omo-config-core`, `memory-core`, `isolation-core`, `device-service-core` |
=======
| **Core packages** | 21 | `utils`, `model-core`, `prompts-core`, `rules-engine` (was `rules-core`), `agents-md-core`, `comment-checker-core`, `hashline-core`, `boulder-state`, `telemetry-core`, `lsp-core`, `mcp-stdio-core`, `tmux-core`, `claude-code-compat-core`, `skills-loader-core`, `mcp-client-core`, `openclaw-core`, `team-core`, `delegate-core`, `omo-config-core`, `memory-core`, `thread-address-core` |
>>>>>>> origin/dev
| **Adapters** | 3 (+2 adapter-support) | `omo-opencode` (OpenCode Ultimate edition; the former root `src/`, build entry for the main npm dist) + `omo-codex` (Codex CLI Light edition; live npm alias `lazycodex-ai`, repository/bin identity `lazycodex`; Codex marketplace `sisyphuslabs` / plugin `omo`) + `omo-senpi` (Senpi native TypeScript extension adapter; local-path Pi package under `packages/omo-senpi/plugin`). Adapter-support: `senpi-task` (Senpi-coupled task engine consumed only by `omo-senpi`; not harness-neutral, so not a `*-core` package) + `omo-native` (npm `omo-ai` distribution launcher staging the `omo-senpi` plugin payload). See [`packages/omo-opencode/src/AGENTS.md`](omo-opencode/src/AGENTS.md), [`packages/omo-codex/AGENTS.md`](omo-codex/AGENTS.md), [`packages/omo-senpi/AGENTS.md`](omo-senpi/AGENTS.md), [`packages/senpi-task/AGENTS.md`](senpi-task/AGENTS.md) |
| **Skills** | 1 | [`shared-skills`](shared-skills/AGENTS.md) (cross-harness SKILL.md bundle shared between OMO and Codex; shipped via root `files` array) |
| **Web** | 1 | `web` |
| **Desktop** | 5 | `senpi-desktop-{engine,prelude,protocol,service,tool}`: binary location, model assets, wire types, process client, and tool registration. |
| **Hosted worker** | 1 | `get-worker` |

## PLATFORM LAUNCHER PACKAGES (12)
`oh-my-opencode-darwin-arm64`, `oh-my-opencode-darwin-x64`, `oh-my-opencode-darwin-x64-baseline`, `oh-my-opencode-linux-arm64`, `oh-my-opencode-linux-arm64-musl`, `oh-my-opencode-linux-x64`, `oh-my-opencode-linux-x64-baseline`, `oh-my-opencode-linux-x64-musl`, `oh-my-opencode-linux-x64-musl-baseline`, `oh-my-opencode-windows-x64`, `oh-my-opencode-windows-x64-baseline`, `oh-my-opencode-windows-arm64`.

The checkout can contain only `package.json`; `files: ["bin"]` describes the generated publication payload. [`script/build-binaries.ts`](../script/build-binaries.ts) generates the launcher; never infer native compilation from a platform package name. `-baseline` and `-musl` remain compatibility-selection metadata. Runtime selection lives in root `bin/` and `postinstall.mjs`; publishing uses `publish-platform.yml`.

## MCP PACKAGES

| Package | Layout | Purpose |
|---------|--------|---------|
| `lsp-tools-mcp/` | Vendored standalone project (`.github/`, `CHANGELOG.md`, `LICENSE`, `src/`, `test/`, `biome.json`, `vitest.config.ts`) | Serves the 8 aliases `lsp_status`, `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_install_decision` via stdio MCP. Registered as tier-1 MCP `lsp` in [`packages/omo-opencode/src/mcp/`](omo-opencode/src/mcp/AGENTS.md). Node-targeted, built with `npm` + vitest, and consumes `lsp-core` + `mcp-stdio-core`. |
| [`git-bash-mcp/`](git-bash-mcp/AGENTS.md) | Internal package (`src/`, `dist/`, `tsconfig.json`) | stdio MCP serving the Windows-only `git_bash` tool for the Codex edition (Bun-targeted, unlike the other two). Tier-1 MCP. |
| `lsp-daemon/` | Vendored standalone project (`src/`, `test/`, `scripts/`, `biome.json`, `package-lock.json`) | Shared per-user LSP **daemon** over a unix socket (Windows named pipe) + a stdio MCP **proxy** + a tool client, consuming `lsp-core` + `mcp-stdio-core`. Lets multiple Codex sessions share one warm LSP process. Bin `omo-lsp-daemon`. Node-targeted (`npm` + vitest). See [`packages/lsp-daemon/AGENTS.md`](lsp-daemon/AGENTS.md). |
| [`ast-grep-mcp/`](ast-grep-mcp/AGENTS.md) | Internal package (`src/`, `tsconfig.json`) | stdio MCP `ast_grep` (tools `search`/`rewrite`/`scan`) wrapping the `sg` CLI. Bin `omo-ast-grep`. Bun-targeted, consumes `mcp-stdio-core` + `utils`. Built by `build:ast-grep-mcp` and staged into the Senpi plugin runtime by `build:senpi-plugin`. |

## WHERE TO LOOK

| Package | Layout | Purpose |
|---------|--------|---------|
| [`utils/`](utils/AGENTS.md) | `src/`, `tsconfig.json` | Shared utilities: deep-merge, snake-case, frontmatter, file-utils, etc. |
| `device-service-core/`, `isolation-core/` | `src/`, package-local tests | Authenticated local device-service SDK; harness-neutral filesystem isolation lifecycle. |
| [`model-core/`](model-core/AGENTS.md) | `src/`, `tsconfig.json` | Model resolution pipeline with ProviderCache dependency injection. |
| [`prompts-core/`](prompts-core/AGENTS.md) | `src/`, `prompts/`, `test/`, `tsconfig.json` | Harness-neutral markdown prompt loading, model-variant routing, and bundled mode prompts for search/analyze/team/hyperplan. |
| [`rules-engine/`](rules-engine/AGENTS.md) | `src/`, `tsconfig.json` | Rule discovery + matching engine (renamed from `rules-core`). |
| [`agents-md-core/`](agents-md-core/AGENTS.md) | `src/`, `tsconfig.json` | AGENTS.md walk-up discovery and injection logic. |
| [`comment-checker-core/`](comment-checker-core/AGENTS.md) | `src/`, `tsconfig.json` | apply-patch parser and binary runner with injectable spawn. |
| [`hashline-core/`](hashline-core/AGENTS.md) | `src/`, `tsconfig.json` | Hashline edit primitives and diff helpers shared by adapter shims. |
| [`boulder-state/`](boulder-state/AGENTS.md) | `src/`, `tsconfig.json` | Work tracking state machine with split storage. |
| [`memory-core/`](memory-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral Letta-Code-parity memory engine: git MemFS substrate, memory tools, committed-HEAD compiler, reflection state machine, FTS-lite search, locks. |
| [`telemetry-core/`](telemetry-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral telemetry primitives and PostHog wrappers. |
| [`lsp-core/`](lsp-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral LSP engine, request context, tool definitions, and MCP entry helpers. |
| [`mcp-stdio-core/`](mcp-stdio-core/AGENTS.md) | `src/`, `tsconfig.json` | Shared JSON-RPC stdio framing and dispatch primitives for MCP servers. |
| [`tmux-core/`](tmux-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral tmux session, pane, layout, and runner primitives. |
| [`claude-code-compat-core/`](claude-code-compat-core/AGENTS.md) | `src/`, `tsconfig.json` | Claude Code compatibility loaders for plugins, MCPs, commands, and agents. |
| [`skills-loader-core/`](skills-loader-core/AGENTS.md) | `src/`, `tsconfig.json` | Skill loading, builtin skill, runtime skill, and skill matching primitives. |
| [`mcp-client-core/`](mcp-client-core/AGENTS.md) | `src/`, `tsconfig.json` | MCP client lifecycle, skill-embedded MCP manager, and OAuth primitives. |
| [`openclaw-core/`](openclaw-core/AGENTS.md) | `src/`, `tsconfig.json` | OpenClaw gateway, reply-listener daemon, session registry, and tmux injection primitives. |
| [`team-core/`](team-core/AGENTS.md) | `src/`, `tsconfig.json` | Team-mode registry, mailbox, tasklist, state, worktree, and tmux layout domain primitives. |
| [`delegate-core/`](delegate-core/AGENTS.md) | `src/`, `tsconfig.json` | Delegate task selection and retry primitives. |
| [`omo-config-core/`](omo-config-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral `omo.json` schema, walked loader, and comment-preserving atomic writer. |
| [`thread-address-core/`](thread-address-core/AGENTS.md) | `src/`, `tsconfig.json` | Dependency-free thread and device address rules (grammar, device resolver, row identity, refusals as data) shared by omo-senpi and the desktop app. |

## ADAPTERS

- **`omo-opencode`** is the OpenCode Ultimate edition and main plugin build entry (`packages/omo-opencode/src/index.ts` -> root `dist/`). Its factories, hooks, tools, features, and built-in MCPs live under [`src/`](omo-opencode/src/AGENTS.md).
- **`omo-codex`** is the Codex CLI Light edition (vendored Codex plugin namespace `omo` + TS installer + telemetry); its live npm alias is `lazycodex-ai`, while `lazycodex` is the repository/bin identity and `code-yeongyu/lazycodex` is the marketplace repo; full layout in [`packages/omo-codex/AGENTS.md`](omo-codex/AGENTS.md) and the publish/deploy pipeline in the root [`AGENTS.md`](../AGENTS.md).
- **`omo-senpi`** builds the local-path Pi package at `packages/omo-senpi/plugin`; component composition lives in `src/extension/`. Rules remain Senpi-built-in. V1 is local-path install only; do not describe npm, git, or marketplace distribution unless implementation changes. See [`omo-senpi/AGENTS.md`](omo-senpi/AGENTS.md).
- **`senpi-task`** is the Senpi-coupled task engine consumed only by `omo-senpi`: the task state machine, record store, in-process + RPC runners, residency/TTL/reconcile lifecycle, completion notifier, steering engine, named-team runtime, and the 7 task + 12 team `ToolDefinition`s. Full breakdown in [`packages/senpi-task/AGENTS.md`](senpi-task/AGENTS.md).
- **`omo-native`** is the npm `omo-ai` distribution package (BETA channel only): `bin/` launcher that spawns the exact-pinned `@code-yeongyu/senpi` CLI with the staged omo-senpi plugin payload, owns `canonicalAgentDir()` (`~/.omo/agent`), and answers `--version`/self-update under the omo brand. Full breakdown in [`packages/omo-native/AGENTS.md`](omo-native/AGENTS.md).

## CONVENTIONS
- **No new package without explicit need.** Adding a sibling package complicates publish + CI. Justify the boundary first.
- **Platform launcher packages** are generated. Do NOT edit their launcher payloads by hand. Modify [`script/build-binaries.ts`](../script/build-binaries.ts).
- **`lsp-tools-mcp` + `lsp-daemon` are vendored Node-targeted source.** Build them with `bun run build:lsp-tools-mcp` / `bun run build:lsp-daemon` (each runs `npm ci` + `npm run build`) before workflows or package tasks that need their `dist/`.
- **`packages/web/` is excluded from root `bun test`** (own [`web-ci.yml`](../.github/workflows/web-ci.yml)); non-platform packages build in root `ci.yml`, platform launchers only via `publish-platform.yml` (triggered by `publish.yml`).

## ANTI-PATTERNS

- Never publish a sibling package manually. Use the GitHub Actions workflows.
- Never copy code between packages by hand. Either share via a core package or accept the duplication and document it.
- Never modify `bin/oh-my-opencode.js` inside a platform launcher package - regenerate it through `script/build-binaries.ts`.
