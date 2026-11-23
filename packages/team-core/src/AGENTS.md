# team-core implementation

## OVERVIEW
Concurrency and delivery implementation behind the package's persisted team contracts.

**Why here:** score 16; six subsystem directories with measured export density and cross-adapter references.

## STRUCTURE

| Subdirectory | Implementation responsibility |
|--------------|-------------------------------|
| `team-registry/` | Spec normalization, eligibility checks, and contained paths |
| `team-mailbox/` | Inbox consumer leases, reservations, and delivery recovery |
| `team-tasklist/` | Atomic claims, dependency checks, and owner-aware transitions |
| `team-state-store/` | Runtime transitions, process locks, worker lifetime, and resume |
| `team-worktree/` | Worktree creation, validation, and orphan cleanup |
| `team-layout-tmux/` | Focus-preserving layout and owned-resource cleanup |

## WHERE TO LOOK

| Task | Location | Detail |
|------|----------|--------|
| Lock handover/restore | `team-state-store/lock-lease.ts` | Compare-and-restore under the reclaim guard |
| Worker identity | `team-state-store/lock-worker-lifetime.ts` | Exact Worker incarnation and observed exit evidence |
| Atomic record publication | `team-state-store/locks.ts`, `lock-publish.ts` | Lock and temp-file lifecycle |
| Delivery commit boundary | `team-mailbox/reservation.ts`, `pending-delivery-recovery.ts` | Reserve, inject, commit/release, recover |
| Inbox acknowledgement | `team-mailbox/ack.ts`, `poll.ts` | Move consumed messages after context delivery |
| Path containment | `team-registry/paths.ts` | Reject path segments before resolving runtime paths |
| Shared ports | `logger.ts`, `session-client.ts` | Silent default logger and structural session client |
| Filesystem portability | `tolerant-fsync.ts` | Narrow tolerated fsync error set |

## CONVENTIONS

- Lock handover and restore replace records by rename over the lock path.
- A changed lease raises `LockLeaseLostError`; the critical section must stop writing.
- Crash-window tests use dedicated `*.fixture.ts` workers and real filesystem/process races.
- `tolerant-fsync.ts` tolerates only EPERM, EACCES, ENOTSUP, and EINVAL.
- Layout dependencies are injectable; live tmux smoke is enabled explicitly with `OMO_LIVE_TMUX=1`.

## ANTI-PATTERNS

- Never unlink-and-create a lease record during handover or restore.
- A live PID is never stale because of age; elapsed time never certifies worker death.
- Never identify a Worker only by reusable routing IDs or match sibling lock temp names by loose prefix.
- Never acknowledge a message that did not actually enter the recipient's context.
- Every tmux `split-window` carries `-d`; layout teardown must not call `kill-session`.
