# boulder-state - Work Tracking Core

## OVERVIEW
Dependency-free work-plan state machine shared across harnesses, persisted at <worktree-root>/.omo/boulder.json.

Score: 12; distinct domain: durable work selection and cross-harness continuation state.
Measured: 27 files, 23 TypeScript files, own package config, src/index.ts boundary;
132 top-level source declarations and 78 distinct explicit exports; centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public package API | src/index.ts, index.d.ts | Read, write, plans, sessions, review artifacts |
| Schema and work statuses | src/types.ts | BoulderState and BoulderWorkState |
| State loading and work lookup | src/storage/read-state.ts | Legacy-state projection and resume options |
| Work selection and completion | src/storage/write-state.ts | Mirror synchronization and completion transition |
| Session and task registration | src/storage/{session,task}.ts | Work-scoped variants and elapsed timers |
| Stale-session demotion | src/storage/stale-work.ts | Activity evidence and paused-work restoration |
| Plan checklists and progress | src/plan-checklist.ts, src/storage/plan-progress.ts | Structured/simple modes |
| Current plan task | src/top-level-task.ts | TopLevelTaskRef |
| Plan paths and review artifacts | src/storage/{path,review-artifacts}.ts | Containment and content hashes |
| Session normalization tests | test/normalize-session-id.test.ts | Separate from src test globs |

## CONVENTIONS
- Schema version 2 carries works plus active_work_id; root fields mirror the active work.
- selectMirrorWork prefers active_work_id, then newest update; projectWorkToMirror copies it.
- writeBoulderState synchronizes root fields back into the selected work before serialization.
- Mirror-only legacy states gain a work through getBoulderWorks.
- normalizeSessionId preserves opencode:/codex:/senpi: prefixes; bare ids default to opencode.
- Senpi callers must pass senpi:<id> to read APIs such as getWorkForSession.
- OpenCode features/boulder-state re-exports this package for hooks and the boulder CLI.
- Codex ulw-execute-continuation and Senpi boulder-eligibility consume the same state.
- OpenCode and Senpi continuation reads reconcile stale works first; callers supply the
  sessions directory through resolveAgentSessionsDirectory. This package resolves no agent home.
- completeBoulder is the only completion transition; abnormal session death demotes work.
- Staleness uses the newest transcript mtime, updated_at, or started_at; absent evidence is stale.
- OMO_BOULDER_STALE_WORK_THRESHOLD_MS overrides the six-hour default with a positive number.
- Reconciliation pauses active works with stale_since; no stale work means no disk write.
- Reconciliation swallows failures and leaves completed, abandoned, and status-less work alone.
- Transcript scans inspect only directories shaped like the work cwd/worktree, plus flat legacy logs.
- selectActiveWork and appendSessionIdForWork restore stale-stamped pauses and remove the stamp;
  explicitly paused work stays paused. Resume readers exclude completed/abandoned only.
- First creation writes .omo/.gitignore with rules/ exclusions preserved.
- Structured parsing recognizes TODOs and Final Verification Wave sections; task labels are
  N/T<n>[.<n>[a]] for TODOs and F<n>/H<n> for final checks, with supported separators.
- A structured parse with no counted rows falls back when other top-level checkboxes exist.
- Otherwise simple mode counts top-level dash/star checkboxes; fences and indented rows are ignored.
- [x] completes, [ ] remains actionable, and [~] contributes only to total, never continuation.
- isStructuredTaskRow serves OpenCode validation; Codex Stop keeps its own plan-checklist copy.

## ANTI-PATTERNS
- Never accept __proto__, prototype, or constructor as task keys.
- Never treat empty {}, arrays, or non-object state as valid BoulderState.
- Never replace completion with stale-work demotion or reactivate an explicit pause.

## COMMANDS
- bun run --cwd packages/boulder-state typecheck
- bun run --cwd packages/boulder-state test
- bun test packages/boulder-state/test/normalize-session-id.test.ts
