# .opencode/ - Project Skills and Commands

## OVERVIEW
Project-scoped OpenCode workflows: three repository skills and five slash commands.

Score: 0; existing guidance retained for its distinct workflow and authorization domain.
The migration target is ".agents/"; prefer that scope when resolving renamed tooling.
This checkout has no hyperplan skill or dependency package in this directory.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Follow a PR through verification | `skills/work-with-pr/SKILL.md` | Worktree, implementation, QA, review, merge workflow |
| Audit issues and PRs | `skills/github-triage/SKILL.md` | Read-only; every claim needs a permalink |
| Inspect release readiness | `skills/pre-publish-review/SKILL.md` | Parallel pre-publish review gate |
| Enumerate unpublished changes | `command/get-unpublished-changes.md` | Compare HEAD with the published npm baseline |
| Trigger release automation | `command/publish.md` | Patch, minor, major, or explicit semver |
| Remove unreachable code | `command/remove-deadcode.md` | Verify references before removal |
| Run security research | `command/security-research.md` | Team hunters plus PoC engineers |
| Explain the project | `command/omomomo.md` | Project introduction command |
| Inspect background-task state | `background-tasks.json` | Runtime identifiers are sensitive checkout state |

## CONVENTIONS
- Skill frontmatter must contain `name` and `description`; descriptions carry trigger words.
- A project skill overrides a same-named user skill.
- Command filenames normalize to user-visible slash names.
- The two internal `.npmignore` files keep repository workflows out of npm payloads.
- Read the selected workflow before executing its steps; skill mandates differ by operation.

## ANTI-PATTERNS
- Never duplicate a built-in skill from `packages/skills-loader-core/src/features/builtin-skills/` without a clear reason.
- Never commit session IDs or token secrets from `background-tasks.json`.
- Never call `session.promptAsync` directly from a skill; use `dispatchInternalPrompt`.
- Triage must not mutate GitHub state, comment, review, merge, or run checkout/fetch/pull/worktree operations.
- Publishing must not rerun pre-publish review or fix the working tree mid-release; report a problem and stop.
- Do not stop the publish workflow after its trigger or draft steps.
- Dead-code cleanup must not use `git add -A` in the shared checkout.
- PR verification requires manual QA evidence and monitor subscriptions rather than repeated check polling.
