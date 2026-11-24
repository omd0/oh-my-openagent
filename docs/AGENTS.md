# docs/ - User Documentation

## OVERVIEW
User guides, runtime contracts, examples, and legal material also feed the web documentation build.

<<<<<<< HEAD
Score: 5; retained existing guidance for documentation and evidence mandates.
=======
30 tracked Markdown files across 6 subdirectories (guide 7, reference 18, examples 3 JSONC, legal 2, templates 1, troubleshooting 1) + root files. Categorized by audience: user-facing guides + reference, troubleshooting, legal. The web site at [packages/web/](../packages/web) consumes some of these (via `web-deploy.yml` triggers).

## WHERE TO LOOK

| Audience / Task | Location |
|------|----------|
| New users — what is this? | [docs/guide/overview.md](guide/overview.md) |
| Installing OmO with the one-line installer (omo.dev/docs/install) | [docs/guide/install.md](guide/install.md) |
| Installing the plugin | [docs/guide/installation.md](guide/installation.md) |
| Installing the compiled binary | [docs/guide/binary-install.md](guide/binary-install.md) |
| How agents collaborate | [docs/guide/orchestration.md](guide/orchestration.md) |
| Picking the right model per agent | [docs/guide/agent-model-matching.md](guide/agent-model-matching.md) |
| Team Mode (opt-in multi-agent) | [docs/guide/team-mode.md](guide/team-mode.md) |
| Senpi task delegation and teams | [docs/guide/senpi-task.md](guide/senpi-task.md) |
| Desktop computer use setup and safety | [docs/guide/computer-use.md](guide/computer-use.md) |
| Temporary BTW side conversations | [docs/guide/btw.md](guide/btw.md) |
| Workflows (mass ulw) for users, omo.dev/docs/workflows | [docs/guide/workflows.md](guide/workflows.md) |
| Delegated agents and the Desktop Agents panel, omo.dev/docs/agents | [docs/guide/agents.md](guide/agents.md) |
| Reserved keywords (ulw, ulw loop, ulw plan, ulw research, mass ulw), omo.dev/docs/keywords | [docs/guide/keywords.md](guide/keywords.md) |
| Telemetry in plain words and how to opt out, omo.dev/docs/telemetry | [docs/guide/telemetry.md](guide/telemetry.md) |
| OmO Desktop updates, release notes and tracks, omo.dev/docs/desktop-updates | [docs/guide/desktop-updates.md](guide/desktop-updates.md) |
| Configuration field reference | [docs/reference/configuration.md](reference/configuration.md) |
| Harness-neutral `omo.json` config reference | [docs/reference/omo-json.md](reference/omo-json.md) |
| Native `computer` tool contract | [docs/reference/computer.md](reference/computer.md) |
| `computer.run` QuickJS sandbox threat model and compatibility matrix | [docs/reference/computer-run-sandbox-threat-model.md](reference/computer-run-sandbox-threat-model.md) |
| Computer-use eval (7 tasks, 3 arms) and latency bench baselines | [docs/reference/computer-use-eval.md](reference/computer-use-eval.md) |
| Feature-by-feature reference | [docs/reference/features.md](reference/features.md) |
| CLI command reference | [docs/reference/cli.md](reference/cli.md) |
| Engine hosts per session, `omo daemon`, migration and rollback | [docs/reference/omo-daemon.md](reference/omo-daemon.md) |
| `omo thread` CLI and thread SDK for scripts and connectors (JSON shapes, exit codes) | [docs/reference/omo-thread.md](reference/omo-thread.md) |
| `omo remote`: sessions on your other devices (verbs, states, command outcomes, device service install) | [docs/reference/remote-sessions.md](reference/remote-sessions.md) |
| Engine trust under a user namespace (bwrap sandbox, inode attestation) | [docs/reference/engine-trust-user-namespaces.md](reference/engine-trust-user-namespaces.md) |
| Desktop engine attach and `--serve` multi-connection threat model | [docs/reference/desktop-attach-threat-model.md](reference/desktop-attach-threat-model.md) |
| macOS keychain helper custody threat model (where the helper runs, what the item's ACL trusts) | [docs/reference/keychain-helper-custody-threat-model.md](reference/keychain-helper-custody-threat-model.md) |
| Known issues & workarounds | [docs/reference/known-issues.md](reference/known-issues.md) |
| `prompt_async_gate` deep-dive | [docs/reference/prompt-async-gate-rfc.md](reference/prompt-async-gate-rfc.md) |
| Shared core multi-PR extraction QA | [docs/reference/shared-core-multi-pr.md](reference/shared-core-multi-pr.md) |
| Re-export shim inventory | [docs/reference/re-export-shim-inventory.md](reference/re-export-shim-inventory.md) |
| Release process | [docs/reference/release-process.md](reference/release-process.md) |
| Operator-built darwin release artifacts (replacing the hosted macOS legs, verification, provenance) | [docs/reference/operator-built-darwin-release.md](reference/operator-built-darwin-release.md) |
| Changelog fragments (per-PR `changes/unreleased/<n>.md`, migration, batches) | [docs/reference/changelog-fragments.md](reference/changelog-fragments.md) |
| GitHub PR evidence attachments | [docs/reference/github-attachment-upload.md](reference/github-attachment-upload.md) |
| Claiming the lazycodex npm name | [docs/reference/lazycodex-npm-reservation.md](reference/lazycodex-npm-reservation.md) |
| Rules-injector cross-module comparison | [docs/reference/rules-injection-cross-module-comparison.md](reference/rules-injection-cross-module-comparison.md) |
| Codex telemetry internals | [docs/reference/codex-telemetry.md](reference/codex-telemetry.md) |
| Senpi telemetry internals | [docs/reference/senpi-telemetry.md](reference/senpi-telemetry.md) |
| `omo-ai` npm publishing playbook | [docs/reference/omo-ai-publishing.md](reference/omo-ai-publishing.md) |
| mass-ULW dag protocol (events, catch-up, overflow) | [docs/reference/mass-ulw-protocol.md](reference/mass-ulw-protocol.md) |
| Monitor tool reference | [docs/reference/monitor.md](reference/monitor.md) |
| Web-terminal visual QA helper | [docs/reference/web-terminal-visual-qa.md](reference/web-terminal-visual-qa.md) |
| Sample configs | [docs/examples/](examples) (default, coding-focused, planning-focused) |
| Privacy & ToS | [docs/legal/](legal) |
| Manifesto | [docs/manifesto.md](manifesto.md) |
| Refreshing the model-capabilities cache | [docs/model-capabilities-maintenance.md](model-capabilities-maintenance.md) |
| Ollama troubleshooting | [docs/troubleshooting/ollama.md](troubleshooting/ollama.md) |
| Copyable project rules template | [docs/templates/AGENTS.md.example](templates/AGENTS.md.example) |
>>>>>>> origin/dev

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
