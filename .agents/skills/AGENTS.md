# skills/ - Repository Workflow Routers

**Generated:** 2026-11-17. **Score:** 9; distinct domain: maintainer workflows and harness QA.

## OVERVIEW

Each tracked workflow starts at its own `SKILL.md`; references and executable helpers carry its detailed contract.

## STRUCTURE

| Group | Directories | Purpose |
|-------|-------------|---------|
| Collaboration | `work-with-pr`, `github-triage`, `hyperplan` | PR lifecycle, read-only triage, adversarial planning |
| Release | `publish`, `pre-publish-review`, `get-unpublished-changes` | Shipping and explicitly requested review |
| Harness QA | `codex-qa`, `opencode-qa`, `senpi-qa` | Isolated real-harness evidence |
| Audits | `security-research`, `tech-debt-audit`, `remove-deadcode` | Security, debt, and dead-code investigations |
| Command form | `omomomo` | Command-compatible workflow |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Exercise Codex hooks and LSP | `codex-qa/SKILL.md` | App-server client, local mock, isolated `CODEX_HOME` |
| Inspect OpenCode events and tools | `opencode-qa/SKILL.md` | SSE and session inspection |
| Exercise Senpi task and team behavior | `senpi-qa/SKILL.md` | Real binary and sandboxed agent state |
| Resolve Senpi evidence destination | `senpi-qa/scripts/resolve-evidence-dir.mjs` | Canonical slug validation |
| Run explicit release review | `pre-publish-review/SKILL.md` | Twelve-agent gate |

## CONVENTIONS

- Read the selected router before its referenced procedures; script arguments live with the script.
- Codex helpers expose `--self-test`; shared dependency checks use `codex-qa/scripts/lib/common.sh --self-check`.
- Senpi evidence resolves beneath `.omo/evidence/omo-senpi-adapter/<slug>/`; keep artifacts local and summarize them in the PR.
- Live harness QA needs observed behavior and saved evidence, beyond typecheck or unit-test results.
- Preserve each workflow's isolation rules for the user's actual Codex, OpenCode, or Senpi state.

## ANTI-PATTERNS

- A plain publish request must not trigger `pre-publish-review`; `/publish` ships directly.
- Never hand-type a Senpi evidence path or force-add evidence with `git add -f`.
- A skipped QA driver is not a passing result; a directory digest alone is not proof.
- Never use `tmux capture-pane` frames as visual TUI QA; use the workflow's rendered-terminal driver.
- Pure skill-prose edits do not need new tests that pin their wording.
