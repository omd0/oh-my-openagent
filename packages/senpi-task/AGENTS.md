# senpi-task - Durable Task Engine

## OVERVIEW
Senpi-coupled task records, child runners, lifecycle, completion, steering, teams, DAGs, and tool factories consumed by the native adapter.

**Score:** 12; distinct domain: durable child execution and recovery invariants.
Measured: 1,278 files, 99% code, package config and src/index.ts boundary, more than 30 functions and 10 exports; graph centrality unavailable.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public API and deep exports | src/index.ts, package.json | Source-only barrel and ./dag/category/runner subpaths |
| Task/residency transitions | src/state/ | TaskRecord, epochs, terminal idempotence |
| Records, logs and paths | src/store/ | JSONL cache, bounded fd pool, redaction |
| Admission and runner wiring | src/manager/ | Concurrency, execution mode, respawn, transcripts |
| In-process and RPC children | src/runners/ | Shared closures, child-process RPC, host-session runner |
| Destruction and recovery | src/lifecycle/ | Suspension, ownership CAS, leases, TTL tombstones |
| Parent notification | src/completion/ | Epoch dedupe, routing, queued-delivery failure receipts |
| Send/cancel/revive | src/steering/ | Port-based control and outcome unions |
| Checkout isolation | src/isolation/ | Prepare, settle, salvage and baseline artifacts |
| Category/model selection | src/category/, src/model-chains/ | Registry gates and ordered runtime chains |
| Personas and invocation gates | src/agents/ | Builtins, overlays, tool policy and plan gates |
| Named teams | src/team/ | Durable mailbox reservations and member extension |
| Dependency-frontier DAG | src/dag/AGENTS.md | Scheduler, WAL/checkpoints, fingerprints, amend/retry |
| Tool definitions | src/tools/ | Spawn, control, output, lead team, workpool |
| Adversarial tests | src/__adversarial__/ | Seeded lifecycle and notification invariant bench |

## CONVENTIONS

- Private TypeScript-source package, sideEffects:false, optional Senpi/TypeBox peers; isolate host imports from pure state/store/schema modules. Do not import omo-opencode here.
- task is spawn-only, taking one prompt or nonempty tasks batch; task_send handles steering/revival/team/shutdown traffic and task_output reads status/transcripts.
- buildLeadTeamTools returns team_create, team_delete, task_create, task_get, task_list, task_update in order; child/member sessions never receive lead lifecycle/tasklist tools, only scoped task_send for members.
- In-process children share filtered parent tool closures, remove task/team and UI-only tools, expose x_search directly, and persist conversations under the same children/<task>/sessions layout as process mode. Completion defaults to final-text; turn supports tool-only children.
- Team members always use process mode. Host sessions belong to the parent session tree; descendants reuse its shard, revived children use the recorded socket, and OMO_RPC_SOCKET* route operator/thread traffic only. daemon-launch-spec.json is the only host argv source.
- Resolve auto once from a capable reachable host; unresolved auto means in-process. Explicit user and per-agent modes win; host fallback is limited to documented mismatch/platform/runtime conditions.
- Store state defaults under the canonical agent project directory while preserving an existing project .omo/senpi-task; task.state_dir overrides. list prunes vanished cache entries; append handles use a capped pool.
- Agent overlays apply markdown, programmatic definitions, then omo.json fields. Curated readonly agents stay in-process, use a validated read-only shell broker, and are rejected as team members; an empty allowlist means no tools.
- Agent model resolution applies an explicit override, agent model/models, ordered categories (model selection only), then curated builtin chains. Disabled agents stay unavailable even with an explicit model. The three native reviewer identities keep category chains and report-write access, separate from curated readonly names.
- Plan-consultant/reviewer require USER-requested ulw-plan, a touched .omo/plans artifact at any root, and no ulw-execute invocation; absent tracking fails closed. Check forbidden skills first; never let a model unlock the gate itself or send to a one-shot plan reviewer.
- Categories require both their listed-model gate and a viable chain; explicit category config bypasses builtin activation gates. Gateway republishes never satisfy provider-bound rungs. Never resolve outside the category's chain; models[] outranks legacy fields, subscription providers rank first, and mirrored chains retain parity tests.
- Category descriptions cannot consult the registry at registration: annotate gated names, then enforce gates at spawn. Provider prompt appends dispatch by model family; retain the deep-low escalation contract without inventing routing targets.
- Team send first persists unread mail, reserves .delivering-<id>, and commits processed/<id> only after recipient-session observation. The incremental session-marker index is authoritative; member pollers run in-child, and owned-lead polling pauses during compaction/switch/shutdown.
- Completion dedupes by (task_id,run_epoch): only externally caused completed/error/lost push; caller cancel/interrupt returns synchronously. Idle wakes and streaming delivery are unconditional; compaction/switch/shutdown buffers. Adapter batching must not suppress, delay, or split notifications.
- enqueue means queued, not delivered. Failed or dropped batches must call recordDeliveryFailure to roll back optimistic notified_epoch, stamp failure, and retry; notification bookkeeping mutates only epochs under the conditional record mutation.
- Recovery order is buffered completion flush/drop, scoped reconciliation, member liveness, reservation reclaim, unnotified redelivery, awaited TTL, owned-lead poll, then status. Dead members resume persisted sessions without replaying their original prompt.
- Shutdown suspends all owned handles AND pending records on every reason. Forget registry ownership before abort/terminate/dispose so late outcomes cannot overwrite suspended state. Preserve status/epochs/stats, clear in-process pids, retain process pids for orphan proof; resume_children:false retains dispose-all behavior.
- Killed/cancelled/lost children use destruction and never revive. Suspended children cannot be woken by task_send; resume the owning session. SpawnSpecV1 contains plain launch facts only, never executable tools/auth/registries; discard untrusted legacy extensions/member_env.
- Reconcile revives only the resumed session's children; undefined session id runs the legacy crash sweep. Check foreign-live ownership before every mutation. Reclaim orphan residents through owner CAS without consuming a new slot; admit parked records under a per-session lease, nonterminal first, then updated_at descending/task_id ascending. Overflow stays suspended with deferred/capacity.
- Admission lease is token-owned and renewable: one-second refresh, stale takeover after three intervals under CAS, isOwner before mutation, own-token release only. Acquisition is bounded to five seconds and defers on contention; never hold the lease across respawn IO.
- Suspension never increments run_epoch; nonterminal reattach increments once, terminal reattach never does. Retryable respawn restores prior residency; unrecoverable terminal records dispose with results retained. Require exact persisted provider/model for in-process resume, never substitute a model.
- Never relaunch a terminal without transcript. A nonterminal with no session file may launch its v1 prompt once, then drain durable steering; no file/spec becomes lost. Prove an orphan RPC pid dead before replacing it. Only an actually interrupted nonterminal tail gets a continuation nudge, reading beyond an oversized final JSONL line when necessary.
- TTL first revalidates retention and tombstones under the record lock, then destroys/deletes outside it. Resume phase two for crash leftovers; tombstones never resurrect. Retain live handles/claims, nonterminals, owed notifications, and lost process records until pid death is proven.
- Lifecycle is the sole destruction writer. Steering uses manager-owned ports and outcome unions, fences internal epochs inside mutations, emits steer_dropped for queue clearing, and never replays admitted workpool assignments as individual sends.
- DAG admission follows completed dependency frontiers and free slots; compiled waves are informational. Amend settled-node changes through the DAG manager rather than retrying a completed node.
- Isolation preparation refuses an uncloneable checkout; missing isolation wiring refuses isolated spawn. Crash salvage retains artifacts and never auto-merges unreviewed deltas.

## ANTI-PATTERNS

- Never dispose/terminate/SIGTERM directly from steering, revive an accepted cancellation, or automatically resend delivery_uncertain transport outcomes.
- Never replace a live owner's state, replay an original prompt on session reattach, or persist executable launch inputs.
- Never test concurrency with sleeps or timing luck; co-located tests use given/when/then, injected clocks and event subscriptions.

## COMMANDS

- tsgo --noEmit -p packages/senpi-task/tsconfig.json
- bun test packages/senpi-task
- SEED=<label> bun test packages/senpi-task/src/__adversarial__/chaos-bench.test.ts
- bun packages/senpi-task/scripts/manual-qa.ts <evidence-dir>
- bun packages/senpi-task/scripts/manual-category-qa.ts
- bun packages/senpi-task/scripts/manual-agents-qa.ts <evidence-dir> (disposable fixture directory)
- bun packages/senpi-task/scripts/manual-output-qa.ts
- Real single/batch task and team injection/reclaim/restart proof uses ../omo-senpi/scripts/qa/task-e2e.mjs and team-e2e.mjs; unit tests alone are not live harness evidence.

The 200-iteration chaos bench checks exactly-once epoch notifications, terminal idempotence, no concurrency-slot leaks, and no unhandled rejection.
