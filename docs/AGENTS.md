# docs/ - User Documentation

## OVERVIEW
User guides, runtime contracts, examples, and legal material also feed the web documentation build.

Score: 5; retained existing guidance for documentation and evidence mandates.

## STRUCTURE
| Directory | Purpose |
|-----------|---------|
| guide/ | Installation and user workflows |
| reference/ | Configuration, protocols, security, and maintenance contracts |
| examples/ | Three commented configuration examples |
| legal/ | Privacy policy and terms of service |
| releases/ | Release-specific notes |
| templates/ | Copyable project guidance |
| troubleshooting/ | Provider-specific diagnosis |

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Product introduction and principles | `guide/overview.md`, `manifesto.md` |
| One-line installer and plugin setup | `guide/install.md`, `guide/installation.md` |
| Compiled binary and OpenCode migration | `guide/binary-install.md`, `guide/migrating-from-opencode.md` |
| Orchestration and model selection | `guide/orchestration.md`, `guide/agent-model-matching.md` |
| OpenCode teams and native delegation | `guide/team-mode.md`, `guide/senpi-task.md` |
| Desktop computer setup and side conversations | `guide/computer-use.md`, `guide/btw.md` |
| Workflow, agents panel, reserved keywords | `guide/{workflows,agents,keywords}.md` |
| Telemetry and desktop update tracks | `guide/telemetry.md`, `guide/desktop-updates.md` |
| Configuration fields and unified loader | `reference/configuration.md`, `reference/omo-json.md` |
| OpenCode config and prompt composition | `reference/{opencode-config,opencode-prompt-composition}.md` |
| Computer tools, sandbox, and stop authority | `reference/{computer,computer-run-sandbox-threat-model,computer-stop-authority}.md` |
| Features, commands, known issues | `reference/{features,cli,known-issues}.md` |
| Hosts, migration, rollback | `reference/omo-daemon.md` |
| Thread SDK and remote devices | `reference/omo-thread.md`, `reference/remote-sessions.md` |
| Trust and desktop attachment | `reference/{engine-trust-user-namespaces,desktop-attach-threat-model}.md` |
| Internal prompt dispatch | `reference/prompt-async-gate-rfc.md` |
| Shared-core extraction and shim inventory | `reference/{shared-core-multi-pr,re-export-shim-inventory}.md` |
| Release process and changelog fragments | `reference/{release-process,changelog-fragments}.md` |
| PR evidence and npm-name reservation | `reference/{github-attachment-upload,lazycodex-npm-reservation}.md` |
| Rules-injector comparison | `reference/rules-injection-cross-module-comparison.md` |
| Adapter telemetry internals | `reference/{codex-telemetry,senpi-telemetry}.md` |
| Native publishing and development binary | `reference/{omo-ai-publishing,omob-dev-binary}.md` |
| DAG protocol and monitor tool | `reference/{mass-ulw-protocol,monitor}.md` |
| Rendered-terminal QA | `reference/web-terminal-visual-qa.md` |
| Model-capabilities refresh | `model-capabilities-maintenance.md` |
| Provider diagnosis | `troubleshooting/ollama.md` |
| Sample configs, legal terms, project rules | `examples/`, `legal/`, `templates/AGENTS.md.example` |
| Translation terminology | `i18n-glossary.md` |

## CONVENTIONS
- Explain OmO internals in user-facing language throughout guide/ and reference/.
- Path links use absolute file:// URLs so OpenCode renders them in the TUI.
- Use Markdown without HTML, including details/summary elements.
- Fence code with a language; use jsonc for commented configuration.
- Add a WHERE TO LOOK entry whenever adding a guide or reference document.
- Source documentation feeds packages/web/scripts/generate-docs-content.mjs; edit these sources.
- Documentation changes can trigger web CI through web-ci.yml.
- Labels run-full-ci or ci:full-matrix launch optional full-matrix checks; keep the label
  and push a commit or reopen the PR to run the full matrix in required checks.

## ANTI-PATTERNS
- Never paste agent system prompts here; agent factories and builtin-skills own those.
- Never document changing config keys without updating packages/omo-opencode/src/config/schema/
  and running bun run build:schema; unified config keys also follow their schema's build command.
- Never use tmux capture-pane for color, layout, or CJK evidence; use the real-PTY
  xterm.js driver at script/qa/web-terminal-visual-qa.mjs. tmux is boot-smoke only.
