# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-17
**Source snapshot:** `2af9e135278946c4add23151fae9da432b730d78`
**Branch:** `dev`

## OVERVIEW
OmO is a multi-harness agent workspace: OpenCode and Codex adapters, a native Senpi runtime, shared TypeScript engines, and Rust desktop services. Bun drives repository automation; independent web, Worker, MCP, and desktop packages retain their own runners.

## STRUCTURE
```text
oh-my-openagent/
|-- packages/
|   |-- omo-{opencode,codex,senpi}/  # Harness adapters
|   |-- omo-native/                # omo-ai launcher and runtime distribution
|   |-- senpi-task/                # Durable tasks, child hosts, DAG execution
|   |-- *-core/                    # Shared domain engines and injected policy
|   |-- senpi-desktop-*/           # Protocol, service, tools and lazy assets
|   |-- {lsp-tools,git-bash,ast-grep}-mcp/
|   |-- lsp-daemon/                # Authenticated per-user LSP transport
|   |-- shared-skills/             # Shared authored skills and synchronization
|   `-- {web,get-worker}/          # Independent Cloudflare applications
|-- crates/                        # Desktop engine/backends and isolated OS helpers
|-- bin/                           # Published platform-selecting Node shims
|-- script/                        # Bun build, QA, installer and release automation
|-- scripts/                       # Node packaging and third-party notices
|-- docs/                          # User documentation; also web build input
`-- .agents/                       # New workflow and command authoring surface
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| OpenCode composition | `packages/omo-opencode/src/index.ts` | Both `createPluginModule().server` and `opencodeV2Server.setup` |
| Native extension | `packages/omo-senpi/` | Synchronous registration, lazy sidecars, local-path install |
| Native launcher | `packages/omo-native/` | Pinned Senpi, staged plugin, daemon/thread contracts |
| Codex integration | `packages/omo-codex/` | Installer sources and aggregate plugin; lazycodex distribution |
| Tasks and teams | `packages/senpi-task/`, `packages/team-core/` | Child execution and shared team persistence are separate domains |
| Config and model policy | `packages/omo-config-core/`, `packages/model-core/`, `packages/delegate-core/` | Layer resolution, capabilities and injected selection |
| Prompts and skills | `packages/prompts-core/`, `packages/shared-skills/`, `packages/skills-loader-core/` | Prompt assets, authored editions and discovery |
| Guidance and memory | `packages/rules-engine/`, `packages/agents-md-core/`, `packages/memory-core/` | Discovery, injection and committed-state memory |
| LSP and MCP | `packages/lsp-core/`, `packages/lsp-daemon/`, `packages/mcp-stdio-core/`, `packages/mcp-client-core/` | Engine, authenticated transport, framing and session clients |
| Desktop wire and safety | `crates/`, `packages/senpi-desktop-protocol/` | Rust schema authority; TypeScript mirror |
| Computer use | `packages/senpi-desktop-service/`, `packages/senpi-desktop-tool/` | Engine process, host permissions and tool activation |
| Local device service | `packages/device-service-core/` | Typed authenticated SDK and account-state bootstrap |
| Site and downloads | `packages/web/`, `packages/get-worker/` | Localized website and R2/D1 download Worker |
| Build and release | `script/`, `.github/workflows/`, `changes/unreleased/` | `ci.yml` and `publish.yml` are integration hubs |

## CODE MAP
Declarations and roles below come from writer source/AST checks. Semantic reference centrality is unmeasured: the relationship graph returned an empty index; text and importer counts are not reference counts.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `runLauncher` | function | `packages/omo-native/bin/lib/launcher.js` | unmeasured | Product and engine command routing |
| `OmoConfigSchema` | schema | `packages/omo-config-core/src/schema/config.ts` | unmeasured | Unified configuration contract |
| `resolveModelForDelegateTask` | function | `packages/delegate-core/src/model-selection.ts` | unmeasured | Shared delegate model selection |
| `createSteeringEngine` | factory | `packages/senpi-task/src/steering/engine.ts` | unmeasured | Task send, cancel and revive control |
| `withLspClient` | function | `packages/lsp-core/src/lsp/client-wrapper.ts` | unmeasured | Contextual language-server acquisition/release |
| `runJsonRpcStdioServer` | function | `packages/mcp-stdio-core/src/server.ts` | unmeasured | Shared MCP stdio loop |
| `Session` | struct | `crates/senpi-desktop-session/src/session.rs` | unmeasured | Ordered desktop request owner |
| `Supervisor` | struct | `crates/senpi-desktop-safety/src/supervisor.rs` | unmeasured | Desktop input safety and stop policy |
| `engine_schema` | function | `crates/senpi-desktop-core/src/protocol_schema.rs` | unmeasured | Desktop wire-schema authority |

## CONVENTIONS
- Shared cores generally expose TypeScript source; adapters supply harness identity and lifecycle. Memory core remains independent of harness imports.
- Canonical config blocks are `opencode`, `native`, `codex`; legacy `senpi` folds before `native`. User config lives under `~/.omo/`.
- Config layers apply user then farthest-to-nearest project; harness/profile views precede defaults. Generic arrays replace, while `disabled_skills` and `exclude_models` union.
- `script/` and `scripts/` are separate automation boundaries; package-local guidance determines runner and module conventions.
- New workflow prose belongs under `.agents/`; synchronized shared skill copies and native/Codex-owned overrides retain distinct authoring ownership.

## ANTI-PATTERNS (THIS PROJECT)
- Do not assert harness behavior from unit/type checks alone: connected adapter changes require the isolated real-host evidence specified by their guides.
- Do not add tests pinning documentation wording or section structure; test the underlying behavior or artifact contract.
- Do not hand-edit generated launchers, schemas, documentation bundles or extension sidecars; change their source and run the owning generator.
- Do not edit signed skill bundles or move pinned submodules as part of ordinary skill authoring.
- Do not bypass desktop permission/stop gates, treat `node:vm` as a security boundary, or convert refused background input into foreground input.
- Do not add unlisted providers to built-in fallback rungs or automatically replay task sends whose delivery is uncertain.
- PR changelogs use `changes/unreleased/<pr-number>.md`; merged fragments are immutable. Do not edit `CHANGELOG.md` or `changes.md` directly in PRs.

## UNIQUE STYLES
- Native registration stays synchronous while heavy implementations load through generated plugin sidecars; freshness, aliases and staged artifacts must agree.
- MCP clients are scoped by `sessionID:skillName:serverName`; transport framing is shared through the dependency-free stdio core.
- Desktop Rust core owns the wire contract; the session thread owns backend/AX/frame state, and mutations cross safety and audit boundaries.
- Platform npm directories hold release-populated launcher payloads; native implementation lives in `crates/` and runtime packages.

## COMMANDS
Commands are supported by writer checks or retained root command documentation; they were not executed during this guidance update.
```bash
bun run build
bun run build:omo-native
bun run build:codex-install
bun run build:lsp-tools-mcp
bun run build:lsp-daemon
bun run typecheck
bun run typecheck:packages
bun run typecheck:script
bun run test:fast
bun run test:codex
bun run test:senpi
bun run test:desktop
bun test packages/senpi-task
bun test packages/omo-native/test
(cd crates && cargo test -p senpi-desktop-session --locked)
(cd crates && cargo clippy --workspace --all-targets --locked -- -D warnings)
```

## NOTES
<<<<<<< HEAD
- Root Bun discovery excludes web, get-worker, desktop TypeScript packages and Codex plugin suites. Run their own gates; desktop packages commonly use Vitest, while the LSP facade and daemon use npm runners.
- Web uses Next.js 16, React 19 and OpenNext/Cloudflare. Edit `docs/` or React docs components; `packages/web/lib/docs-content.generated.ts` is generated. Production deploys use GitHub Actions.
- Native state defaults to `~/.omo/agent`; the launcher owns explicit and legacy directory overrides. Child task hosts use per-session-tree shards, distinct from operator/thread RPC endpoints.
- Team runtime defaults to `~/.omo/runtime/<teamRunId>`; Senpi supplies a teams base. Decimal team task IDs and `st_*` task-record IDs are different namespaces.
- Rust desktop tests run from `crates/`. Fake backend scenarios are OS-free; native capture/input/identity proofs require their target OS and desktop services.
- Desktop schema changes regenerate Rust schema/docs before the TypeScript protocol mirror. Download Worker migrations are gated by its deployment ledger.
- Package-local AGENTS.md files carry implementation contracts, live QA procedures and generated-artifact ownership; consult them before editing those subtrees.
=======

- **Logger:** writes `oh-my-opencode.log` to the OS temp dir (`/tmp` on Linux, `/var/folders/.../T/` on macOS, `%TEMP%` on Windows — i.e. Node's `os.tmpdir()`). Rotated at 50 MB; previous segments live at `.1` and `.2` (oldest dropped).
- **Background tasks:** 5 concurrent per `${providerID}/${modelID}` key by default (configurable via `background_task.modelConcurrency` / `providerConcurrency`); FIFO queue when slots full.
- **Plugin load timeout:** 10s for Claude Code plugin discovery.
- **Model fallback:** per-agent chains in `packages/omo-opencode/src/shared/model-requirements.ts`. **There is no single global priority.**
- **Two fallback systems:** `model-fallback` (proactive, chat.params, hardcoded chains) vs `runtime-fallback` (reactive, session.error, configurable per-category/agent).
- **Config migration:** idempotent via `_migrations` tracking, atomic writes with timestamped backups.
- **Goal feature (replaces ralph-loop):** `packages/omo-opencode/src/hooks/goal/` session-tier hook + `create_goal`/`update_goal`/`get_goal` tools, gated on `goal.enabled` (default off). Legacy `ralph_loop` config migrates to `goal` in `packages/omo-opencode/src/config/validate.ts` (deprecated schema shim); `ralph-loop` hook dir retained but no longer wired.
- **Build:** `bun build` (ESM, entry `packages/omo-opencode/src/index.ts`) + `tsc --emitDeclarationOnly`, external: `zod`.
- **CI tests:** root tests run through plain `bun test`; `packages/web/**` has its own package-level CI workflow.
- **Barrel `index.ts` files** establish module boundaries within `packages/omo-opencode/src/`.
- **Architecture rules** enforced via the `rules-injector` hook reading `.omo/rules/*.md` (e.g. `test-discipline.md`, `file-size-architectural-smell.md`, `typescript-programmer.md`).
- **Windows builds:** run on `windows-latest` (not cross-compiled) to avoid Bun segfaults.
- **Platform launchers:** detect AVX2 + libc family at runtime, fallback to baseline if needed.
- **IntentGate (`keyword-detector`):** classifies user intent (`ultrawork`/`ulw`, `search`, `analyze`, `team`) and injects mode-specific prompts.
- **Hashline edit:** every `Read` output tagged with `LINE#ID` content hashes (chars from `ZPMQVRWSNKTXJBYH`); edits reject on hash mismatch.
- **zauc-mocks pattern:** directories named `zauc-mocks-*` (under `packages/omo-opencode/src/hooks/`, `tools/`, `mcp/`, `shared/`) hold `mock.module()` setup that must load alphabetically before the tests that consume those mocked modules. The `zauc-` prefix is purely a sort-order hack for `bun:test` discovery; these are NOT hooks/tools.
- **Test discipline meta-audits:** repo-wide tests that parse source and FAIL the suite on invariant violations: `packages/omo-opencode/src/shared/mock-module-lifecycle-audit.test.ts` (`mock.module()` without restore) and `prompt-async-route-audit.test.ts` (raw `session.promptAsync` outside the gate) via the TS compiler API; `script/package-registration-audit.test.ts` (workspace/devDep registration + ROADMAP reverse-dependency edges stay zero); `script/shared-core-extraction-guard.test.ts` (`packages/*-core` stay harness-neutral); `packages/omo-opencode/src/shared/markdown-link-audit.test.ts` (no machine-local absolute paths in committed `.md`); `opencode-coupling-audit.test.ts` (×2 pkgs — non-adapter packages must not import `@opencode-ai/*`). Root-level cross-package invariants live in `tests/` (category drift, schema freshness, reasoning-vocabulary parity, ulw-loop/ulw-plan contracts).
- **Docs:** see [`docs/guide/`](docs/guide) for user-facing guides (overview, installation, orchestration, agent-model-matching, team-mode), [`docs/reference/`](docs/reference) for CLI/configuration/features reference. See also [`CHANGELOG.md`](CHANGELOG.md), [`docs/reference/prompt-async-gate-rfc.md`](docs/reference/prompt-async-gate-rfc.md), and [`docs/reference/release-process.md`](docs/reference/release-process.md).
- **Rules files** (auto-injected by `rules-injector` hook): scans `.omo/rules/`, `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, plus `.github/copilot-instructions.md` and `.mdc` files.
- **Process cleanup:** Background-agent error handlers are now log-only — no force-exit on transient errors. Opt out entirely via `OMO_DISABLE_PROCESS_CLEANUP=1` env var.
- **models.dev has two distinct consumers:** `bun run build:model-capabilities` (shared model-capabilities cache) and `packages/omo-opencode/scripts/` (OpenGateway catalog generator → tracked `opengateway-models.json`, shape-pinned by test). Do not conflate.
- **The scheduled model-capabilities refresh overwrites hand-scoped entries today:** feature PRs add single entries to `packages/omo-opencode/src/generated/model-capabilities.generated.json` for models `models.dev` does not carry yet, but `bun run build:model-capabilities` rewrites the whole file, so a refresh PR drops them. Changing the refresh to merge is tracked in #10665; until then, check a refresh PR's removed entries before merging. See [`docs/model-capabilities-maintenance.md`](docs/model-capabilities-maintenance.md).
- **shared-skills sub-projects:** 19 skills; `ultimate-browsing/engine` and `coding-agent-sessions` are Python sub-projects with own tests; `visual-qa` ships a zero-dep bundled CLI (`scripts/visual-qa.mjs`) - regenerate the bundle after TS fixes.
- **First-prompt watchdog:** `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts` detects subagent sessions producing no progress within `runtime_fallback.first_prompt_timeout_seconds` (300s default, 0 disables) and triggers fallback / abort.
- **ParentWakeNotifier:** Background-agent parent-wake state in `packages/omo-opencode/src/features/background-agent/parent-wake-notifier.ts` with dependency-injected client and enqueue callback.
- **Agent state directory:** ONE canonical location, `~/.omo/agent`, resolved through `canonicalAgentDir()` in [`packages/omo-native/bin/lib/agent-dir.js`](packages/omo-native/bin/lib/agent-dir.js) (and its adapter-side twin `resolveAgentHome()` in `packages/omo-senpi/src/components/agent-home/`). EVERY omo entry point - the spawned engine, `omo doctor`, `omo setup`, the local launcher, the local installer - MUST resolve the directory through that helper instead of composing its own default; an explicit `OMO_CODING_AGENT_DIR` (or the legacy `SENPI_CODING_AGENT_DIR` / `PI_CODING_AGENT_DIR`) still wins. Composing a private default is what made settings look erased on update.
- **Workspace migration:** Runtime state migrated from `.sisyphus/` → `.omo/`. Legacy `.sisyphus/` still exists during transition; `packages/omo-opencode/src/shared/legacy-workspace-migration.ts` copies it forward on first load.
- **CI nuance:** PRs targeting `master` are hard-blocked — they MUST target `dev`. CI auto-commits schema changes on master push and creates a draft "next" release on dev push.

## Review claim labels (merge-gating)

Three PR labels drive the review workflow; per-PR automation runs in `.github/workflows/pr-automation.yml`, and the stale sweep and merge-group gate live in `.github/workflows/review-claims.yml`:

- `will-review` — a reviewer claims the PR ("I will review this"). Applying it auto-requests the labeler as reviewer and BLOCKS merge via the required `Review claim gate` check.
- `in-review` — the claimer is actively reviewing. Same merge-blocking + auto-reviewer-request effects.
- `stale-review` — a claim sat 3+ days without the claimer's review; the sweep removes the claim labels and applies this one. A fresh claim clears it.

Rules:
- Apply `will-review` when you plan to review a PR; switch to `in-review` when you start.
- NEVER merge a PR carrying `will-review` or `in-review`; the gate check enforces this.
- Claim labels are removed automatically ONLY when the claimer (the person who applied the label) submits an approve or request-changes review. Do not remove someone else's claim label by hand.
- If a PR shows `stale-review`, it needs a (new) reviewer: claim it.
>>>>>>> origin/dev
