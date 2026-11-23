# Task Engine Source Routing

## OVERVIEW
Source modules and contract tests behind the package's durable task, DAG, workpool, and child-tool APIs.

**Score:** 13; distinct domain: implementation seams below the package-level lifecycle contract.
Measured: 1,263 files, 22 immediate subdirectories, over 99% code, `index.ts`, 3,308 TypeScript function declarations and 3,113 export statements; graph centrality unavailable.

## STRUCTURE
| Group | Directories | Implementation concern |
|-------|-------------|------------------------|
| Execution | `manager/`, `runners/`, `pause/` | Child handles, host sessions, held-run admission |
| Durability | `state/`, `store/`, `lifecycle/` | Records, epochs, persistence, recovery |
| Composition | `dag/`, `workpool/`, `completion/` | Dependency scheduling, assignments, terminal delivery |
| Model policy | `agents/`, `category/`, `model-chains/`, `config/` | Invocation and route selection |
| Host/tool seams | `tools/`, `kernel-tools/`, `eval-handles/`, `senpi/`, `lazy/` | Typed tools, eval capabilities, runtime loading |
| Coordination | `team/`, `steering/`, `isolation/` | Mailboxes, control outcomes, checkout artifacts |
| Stress coverage | `__adversarial__/` | Seeded state and notification interleavings |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Trace re-exported public names | `index.ts` | Maintained source API; lazy pi-tui load is explicit |
| Hold/resume a run | `manager/run-pause.ts`, `pause/ports.ts` | Owner receipts, cutoff, resume identity, capacity |
| Diagnose admission test failures | `manager/__fixtures__/` | Fake runners, race harnesses, model-chain worlds |
| Understand typed send results | `tools/control/{send,send-results,types}.ts` | Immediate report window and late notification |
| Read-only output snapshots | `tools/output/` | Bounded transcript readers and terminal presentation |
| Epoch-specific completion delivery | `completion/notifier.ts`, `completion/routing.ts` | Conditional bookkeeping and exhaustive routing |
| Deterministic graph rejection | `dag/graph.ts` | Caller-supplied time; fatal compile errors |
| Terminal DAG result retention | `dag/results.ts` | Persisted artifacts survive record eviction |
| Host session RPC semantics | `runners/rpc-host/` | Generation facts, reconciliation, transport outcomes |
| Validate runtime API assumptions | `senpi-api-tripwire.test.ts` | Type-only probes against the pinned host |
| Validate static import boundaries | `senpi-static-import-guard.test.ts` | Runtime loading discipline |
| Verify turn/token accounting | `run-stats*.test.ts` | Failed/aborted turns and usage coverage |

## CONVENTIONS
- Public name discovery starts at `index.ts`; local module barrels resolve implementation ownership.
- Tool manager dependencies use narrow `Pick<TaskManager, ...>` ports; results carry discriminated `details` and short human text.
- `runTaskSend` reports `delivering` after one second only when a late-outcome destination exists; delivery keeps running.
- Pause registration precedes the child call because its abort may settle synchronously.
- A failed pause RPC does not prove no hold: the child engine's observed hold view decides.
- A resumed child turn is tracked by the returned turn identity; its promise is not a new whole-session outcome.
- DAG result persistence occurs inside the terminal journal mutation; artifact bytes and hashes are durable before residency cleanup.
- `compileDag` takes caller time and performs no filesystem work or random generation.

## ANTI-PATTERNS
- Never mutate the store directly from control tools or omit the production caller-session resolver.
- Never return prose alone where the tool contract defines structured outcome details.
- Never resend a send merely because its caller stopped waiting; the original delivery can still complete.
- Never call `waitForOutcome` on the resumed-turn path in `manager/run-pause.ts`.
- Never let terminal output inherit an old awaiting-input flag or replace a transcript with the plan.
- Never put executable auth, registries, or tools in a persisted spawn specification.

## COMMANDS
```bash
bun test packages/senpi-task/src/completion
bun test packages/senpi-task/src/tools/control
bun test packages/senpi-task/src/dag
```
