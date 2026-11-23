# memory-core - Harness-Neutral Memory Engine

**Generated:** 2026-11-17. **Score:** 13; distinct domain: transactional memory shared by harness adapters.

## OVERVIEW

Git-backed Markdown MemFS, memory tools, committed-state compilation, reflection, search, synchronization, and seeds.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Navigate source domains | `src/AGENTS.md`, `src/index.ts` | Source map and public barrel |
| Git transaction and recovery | `src/git/` | Clean checks, commits, merges, remotes, typed failures |
| Identity and layout | `src/identity/` | `OMO_MEMORY_HOME`, auto identity, linked worktrees |
| Lock ownership and capacity | `src/locks/` | Write/scheduler/transcript locks and recall-wake leases |
| File grammar and hooks | `src/memfs/` | Validation, canonical rendering, staged-blob checks |
| Atomic tool writes | `src/tools/` | `runMemoryTool`, `runMemoryApplyPatch`, leaked-argument repair |
| Facts and journal state | `src/facts/`, `src/journal/` | Durable queue, cursors, snapshots, mutation planning |
| People and soul | `src/people/`, `src/soul/` | Card grammar and identity-scoped notice watermarks |
| Working agreements | `src/agreements/` | Ledger parsing, human ownership, counters, projection |
| Reflection lifecycle | `src/reflection/` | Reservations, worktrees, validation, unowned branch/worktree sweep; repeated-failure park with one half-open probe per interval |
| Prompt projection | `src/compile/` | `compileMemoryBlock`, revision-targeted compilation, template-hash caching |
| Retrieval and upkeep | `src/search/`, `src/reminders/`, `src/seeds/` | Search, reminders, first-run content |
| Remote mirror | `src/sync/` | Synchronization and secret redaction |

## CONVENTIONS

- Adapters supply identity, events, registration, and sync orchestration; Senpi wiring stays in `omo-senpi/src/components/memory/`.
- Production imports and dependencies stay harness-neutral; `src/harness-neutrality.test.ts` enforces the boundary.
- Writes acquire `memory-write`, require a clean repository, validate paths, apply one operation, and commit only affected paths through `GitMemoryRepo`.
- Compilation reads HEAD or an explicit revision; dirty worktree content is not authoritative memory.
- Files require non-empty YAML `description`, UTF-8, normalized repository-relative paths, and LF output; `read_only: "true"` blocks mutation.
- `renderMemoryFile` is the only writer: quote ambiguous scalars, reparse headers, preserve extra keys, and retain legacy reading only for pre-existing files.
- `describeFrontmatterViolation` is shared by hooks, completion, and one-time normalization; normalization's marker lives in the common git directory.
- Reflection priority is manual, compaction, then step-count; allow one active run and one merged pending reservation.
- Preserve typed lock domains: memory-write, reflection-scheduler, and transcript-specific locks; never collapse them into a global lock.
- Recall-wake uses `recall-wake.slot-<n>.lock` (default two slots), FIFO `recall-wake.tickets/`, proof-based recovery of slots/tickets, bounded waits, and `RecallWakeBusyError`.
- Reclaim stranded git locks only with proven-dead ownership and fresh holder checks; keep uncertain locks as `StrandedGitLockError` and use inspect/unlock APIs for explicit recovery.
- `resolveAutoIdentity(cwd, env, mode, probe?)` owns auto identity; opt-in git mode maps to the main worktree through `.git`, `commondir`, admin `gitdir`, and `core.worktree`/`core.bare` without spawning git, retaining path identity for unreadable, forged, or ambiguous layouts.
- Redact all external mirrors before synchronization; never commit secret-bearing raw logs or configuration.
- Facts queue/cursor/consumed records publish atomically with mode 0600 under identity locks; malformed JSON becomes empty state and never blocks.
- Facts enqueue/consumed watermarks never regress; order uses canonical journal position/snapshot boundaries, never lexical message IDs.
- Agreement lines carry id/by/n/since/last/status metadata; IDs are the first ten hex digits of normalized-text SHA-256.
- Repeat corrections increment counts and flag needs-human; at capacity evict only the oldest never-reaffirmed, unflagged agent item, recording an `AgreementEvent` and `Omo-Agreement-Evicted` commit trailer, or refuse admission; never merge distinct rules. The notice watermark announces newly flagged items once per identity.
- Only `/agreements` via `commitMemoryWrite` with `writer: "human-command"` may create, reword, acknowledge, or drop human items.
- Memory tools refuse human-ledger changes; reflection/dream reject every ledger change, including move/delete via a no-renames diff; facts only count human items.
- Automation cannot remove counted agent items or lower counts; delete-and-re-add cannot reset history. Disabling agreements still projects the existing ledger.
- People-card lines allow only IDENTITY/ATTRIBUTE/RELATIONSHIP/INSTRUCTION with bounded metadata; never store behavioral patterns there.
- `evaluateTransitions`, `reserveTransition`, and `completeTransition` form the pure reflection state machine.
- `FactsQueue`, `applyFactsBatch`, `planFactsMutation`, and `consumeSoulNoticeDelta` drive the facts/soul lifecycle.

## ANTI-PATTERNS

- Never import a harness package, bypass GitMemoryRepo/tool validation/typed locks, or compile dirty worktree content.
- Never hand-emit an unquoted `description:`, mutate read-only blocks, or accept non-UTF-8 files.
- Never swallow git, lock, merge, or reflection failures.
- Never use fixed sleeps or retry loops to test cross-process behavior; await exact state/process events with bounded timeouts.

## CHECKS

- Run nearest co-located tests first, then `bun test --timeout 20000 packages/memory-core/src/`.
- `bun run --cwd packages/memory-core typecheck`
