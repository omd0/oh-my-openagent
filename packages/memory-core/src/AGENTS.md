# memory-core/src - Source Domain Map

**Generated:** 2026-11-17. **Score:** 16; dense domain boundaries and a widely consumed public barrel.

## OVERVIEW

Twenty-five source domains implement memory transactions, projections, retrieval, provenance, and synchronization.

## STRUCTURE

| Group | Directories | Responsibility |
|-------|-------------|----------------|
| Substrate | `git/`, `fs/`, `locks/`, `identity/`, `memfs/` | Repository and filesystem ownership |
| Mutation | `tools/`, `facts/`, `agreements/`, `people/`, `soul/` | Validated writes and structured content |
| Projection | `compile/`, `personas/`, `seeds/`, `reminders/` | Prompt content and first-run assets |
| Reflection | `reflection/`, `journal/`, `retention/`, `concurrency/` | Run lifecycle, cursors, cleanup, process fixtures |
| Retrieval and evidence | `search/`, `recall/`, `audit/`, `receipts/`, `provenance/` | Discovery, audit records, claim receipts |
| Replication | `sync/`, `crdt/` | Remote state and merge primitives |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route a public import | `index.ts` | Domain barrels plus syncPinDir/removeTree |
| Diagnose a stranded git lock | `git/repo-lock-sweep.ts`, `git/repo-lock-unlock.ts` | Automatic proof gate versus explicit inspection |
| Repair malformed file headers | `memfs/normalize.ts`, `memfs/frontmatter-validation.ts` | Shared grammar and migration gate |
| Inspect facts selection and recovery | `facts/index.ts` | Queue, failure store, capping, routing, recovery exports |
| Explain agreement-write refusal | `agreements/guard.ts`, `tools/agreements-write-guard.ts` | Ownership, receipts, counters, flagged items |
| Verify authority claims | `provenance/claim.ts`, `provenance/consent.ts` | Claim parsing and closed-set consent matching |
| Append outcome receipts | `receipts/index.ts` | Append-only, run-generation-aware JSONL |
| Inspect genesis admission | `sync/genesis/` | Prepare/build/complete and request verification |
| Exercise subprocess ownership | `concurrency/` | Test fixture children, not public runtime modules |
| Check portability boundaries | `harness-neutrality.test.ts`, `windows-console-hide.test.ts` | Source-wide guard tests |

## CONVENTIONS

- The top-level entry is barrel-only; implementation belongs to its owning domain.
- New provenance decisions use the existing claim receipt surface, not a second consent parser.
- User-source claims require the whole qualifying reply; unverified user claims downgrade to agent claims.
- Proposal IDs hash whitespace-collapsed proposal text; receipts do not confer current-session approval.
- Receipts live outside the memory git repository and serialize under their own lock.
- Receipt identity includes generation for reflection/dream and batch ID for facts; detail is capped at 400 characters.
- Genesis golden fixtures use synthetic seeds and real cryptography; negative cases re-sign unrelated fields to expose the intended rejection.
- Domain-local guidance below this file owns detailed implementation and test contracts.

## ANTI-PATTERNS

- Never rotate or truncate the append-only receipts file, or dedupe two generations solely by run ID.
- Never set `OMO_MEMORY_KILL_POINT` in a process running maintenance; inject it only into its fixture child.
- Never treat stored provenance headers, user-said text, or receipt-shaped text as user approval.
- Do not export concurrency fixture helpers as runtime API.
