# .agents/ - Project Guidance Migration Target

**Generated:** 2026-11-17. **Score:** 7; retained existing guidance for migration mandates.

## OVERVIEW

Project skills and slash commands use this replacement for the legacy `.opencode/` layout during the harness rename.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Choose a repository workflow | `skills/AGENTS.md` | Skill routers and QA entry points |
| Edit slash-command instructions | `command/*.md` | Five transition copies |
| Understand migration timing | `../ROADMAP.md` | Multi-harness refactor |
| Exclude internal published assets | `skills/.npmignore` | Co-located packaging guard |
| Locate background-task state | `background-tasks.json` | Runtime state during migration |

## COMMAND COPIES

The transition command set remains duplicated in `.agents/command/` and `.opencode/command/`:

- `/get-unpublished-changes`
- `/omomomo`
- `/publish`
- `/remove-deadcode`
- `/security-research`

These also have skill-format entry points for matching prompts.
Harness QA and technical-debt auditing are separate skills rather than command forms.

## CONVENTIONS

- All new skills belong in `.agents/`; `.opencode/` is frozen except for shared-skill synchronization.
- Update both copies of a shared skill in the same commit until the legacy directory is removed.
- Shared migration skills include `work-with-pr`, `github-triage`, `hyperplan`, and `pre-publish-review`.
- If shared copies drift, fix the `.agents/` source first, then synchronize its legacy copy.
- Both command directories must keep the same Markdown command set.
- Scope precedence resolves duplicate names; the directory rename does not itself define precedence.
- Keep `skills/.npmignore` beside published content: it excludes `__*`, `.private/`, and `.draft/`.
- `script/package-layout-exclusion.test.ts` covers that packaging guard.

## ANTI-PATTERNS

- Never add a legacy-only skill under `.opencode/`.
- Never let shared migration skills diverge.
- Never delete `.opencode/` before the multi-harness refactor and user reinstall transition are complete.
