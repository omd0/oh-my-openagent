# boulder-state/src - Plan and Artifact Implementation

## OVERVIEW
Plan grammar, task timers, path relocation, and review-artifact persistence behind the package API.

Score: 11; distinct implementation domain with 21 source files, index.ts,
132 top-level declarations and 78 distinct explicit exports.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Publicly reachable exports | index.ts, storage/index.ts | Keep implementation exports intentional |
| Checklist grammar | plan-checklist.ts, plan-checklist.test.ts | Row labels and next-task extraction |
| Fence handling | markdown-fence.ts | Opening/closing fence recognition |
| Worktree plan relocation | storage/path.ts | Existing alternate path only |
| Task timer continuity | storage/task.ts | Upsert retains prior timing and status |
| Review evidence | storage/review-artifacts.ts | Session dedupe and exclusive sequence allocation |
| Artifact containment tests | storage/review-artifacts.test.ts | Missing tails and symlink escapes |
| State compatibility tests | read-state.test.ts | Legacy shapes and invalid payloads |
| Progress regression tests | plan-progress.test.ts | Filesystem-backed plan progress |
| Stale activity regression tests | stale-work.test.ts | Timestamp evidence and revival |

## CONVENTIONS
- Relocation preserves the plan's relative path beneath the recorded worktree only when
  that alternate file exists; an external or missing alternate keeps the original plan path.
- Task upserts preserve started_at, ended_at, elapsed_ms, and status from the previous record.
- startTaskTimer reuses an existing start time; endTaskTimer updates both task and work timestamps.
- Review directories sit beside the plan as <plan-without-md>.reviews.
- Review identity is the reviewer session line; repeated sessions reuse their existing artifact.
- Artifact numbering starts after the largest numeric prefix and allocates with O_EXCL;
  O_NOFOLLOW is added where supported, and collisions advance the sequence up to 1,000 attempts.
- Containment resolves existing ancestors even when the plan's final path does not yet exist.
- Plans-root .gitignore creation is best effort and must not block a valid artifact write.

## ANTI-PATTERNS
- Never write a review outside .omo/plans or through an escaped plans/reviews symlink.
- Never overwrite an existing numbered review to resolve a sequence collision.
- Never reset a task's recorded timer while refreshing its session metadata.
