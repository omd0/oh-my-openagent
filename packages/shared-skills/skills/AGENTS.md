# shared-skills/skills - Skill Domain Index

## OVERVIEW
Nineteen skill directories combine instruction routers, deeper references, and domain-owned executable helpers.

Score: 9; distinct domain: routing work to the correct skill implementation and executable contract.
Measured: 877 tracked non-guidance files, 19 immediate skill directories, 1,504 AST declarations and 1,183 export occurrences; code ratio 65%, centrality unmeasured.

## STRUCTURE
| Group | Directories | Distinct responsibility |
|-------|-------------|-------------------------|
| Work execution | ulw-plan, ulw-execute, init-deep | Plans, implementation, hierarchical guidance |
| Evidence and review | debugging, eval-integrity, review-work, visual-qa | Diagnosis, verdict discipline, visible-use checks |
| Code and repository operations | programming, refactor, remove-ai-slops, git-master, ast-grep, lsp-setup | Language references and structural tooling |
| Browser and UI | browser, frontend | Browser loader and frontend detection SDK |
| Investigation | ulw-research, data-scientist, ultimate-browsing, coding-agent-sessions | Claim gates, analysis, search runtime, session retrieval |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect frontend detector public API | frontend/scripts/detect/index.ts | Public-marked exports for callers outside the repo |
| Trace detector color/config/rule behavior | frontend/scripts/detect/ | Source and rendered-page rule modules |
| Run research report gates | ulw-research/scripts/report-tools.mjs | Zero-dependency Node entry |
| Trace numerical claim parsing | ulw-research/scripts/numerals.mjs | Shared grammar for sibling fidelity scripts |
| Diagnose Rust undefined behavior | programming/references/rust-ub/ | Taxonomy, Miri, sanitizers and Loom sequence |
| Inspect browser runtime loading | browser/scripts/omowright.mjs | Loader for staged runtime |
| Change search engine behavior | ultimate-browsing/engine/ | Read its deeper upstream/version policy first |
| Update a skill's routing or triggers | <skill>/SKILL.md | Keep detailed procedures in its reference files |

## CONVENTIONS
- frontend/scripts/detect/index.ts is the SDK entry for external users; preserve its public-marked exports when moving internals.
- Research helpers share sibling modules such as numerals.mjs and markdown-closers.mjs; use the owning implementation when a gate needs their grammar.
- Rust UB instructions progress through the documented checking levels and require a minimal reproducer before a fix.
- For authored-source versus staged-output policy, use ../AGENTS.md before editing assets inside a skill directory.

## ANTI-PATTERNS
- Do not count synchronized Codex/native copies as independent implementations or separate evidence of a source change.
- Do not treat materialized browser/frontend runtime directories as new authoring roots.
- Do not replace a domain's pinned reference policy with a follow-HEAD refresh; ultimate-browsing owns that decision locally.
