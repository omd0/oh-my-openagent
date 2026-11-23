# omo-senpi - Native Extension Adapter

## OVERVIEW
Senpi runtime boundary composing shared engines into the local-path plugin; source shells register synchronously and heavy bodies load as sidecars.

**Score:** 12; distinct domain: extension composition, generated payloads, and real-host evidence.
Measured: 3,154 files, 84% code, package config and src/index.ts boundary, more than 30 functions and 10 exports; graph centrality unavailable.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Registration order and host ports | src/extension/{component-list,types}.ts | Factory registration and structural API boundary |
| Source audits | src/AGENTS.md | Bundle purity, size, Node loading, Windows process flags |
| Task integration | src/components/task/ | senpi-task wiring, host shards, skill invocation gates |
| Memory and telemetry | src/components/{memory,telemetry}/ | Shared engines, consent, lazy transports |
| Threads and gateway | src/components/thread/ | Cross-session tools and durable relay receipts |
| Onboarding | src/components/onboarding/ | Claim, scan, understand, apply, and history RPC |
| Desktop and remote service | src/components/{computer-use,desktop-toolkit,device-service}/ | Registration shells and lazy runtimes |
| Skills and workflows | skills/, src/components/{bundled-skills,skill-commands,skill-pointers}/ | Native overrides and command aliases |
| Runtime build and staging | plugin/scripts/, plugin/AGENTS.md | Artifact map, skills overlay, peer externals |
| Local install | src/install/ | resolveAgentHome and absolute package-path registration |
| Live harness QA | scripts/qa/AGENTS.md | Driver router, isolation and evidence contracts |
| Vendor pins | vendor/PIN.json, scripts/sync-bunshin-ts.ts | Provenance and per-file hashes |

## CONVENTIONS

- Keep the package adapter-only; harness-neutral entrypoints must not import Senpi/Pi or this adapter. senpi-task is intentionally Senpi-coupled, not a Core package.
- Component factories register in component-list.ts order: config startup before consumers; bundled skill availability before startup UI; skill-commands before other input hooks; task before thread/memory; config-watch after memory.
- Exports and package imports map source TS to packaged sidecars. For every lazy runtime keep build freshness, required artifacts, installer fixtures, and bundle audits aligned; synchronous tools/commands/RPC names must stay registered before loading their bodies.
- Telemetry uses telemetry-core/injected; the PostHog transport imports #omo-telemetry-posthog-runtime only at first capture. Runtime failures must not block the host.
- /memfs, /palace, /people, onboarding-history RPC/tools, and the thread facade retain synchronous shells; their heavy bodies load only on first use. Share pending imports at the existing scope; do not cache failed palace/history/thread loads. Thread captures the operator socket before loading and reports host_unavailable:<socket> on failure.
- Config startup runs shared lock/journal migrations before reading the unified view and surfaces diagnostics once; the canonical config block is [native], accepting legacy [senpi]. Rules remain built into Senpi; do not add a rules component to mirror another edition.
- Native skills ship verbatim; native init-deep/ulw-plan overrides shadow shared copies. Shared skills receive Senpi compatibility overlays; ulw-execute gets its session-prefix overlay. Keep ultrawork source native and reject foreign harness tokens during directive embedding.
- Bare skill aliases rewrite to /skill: while preserving input source, defer to existing commands/templates, and warn for disabled/unloaded skills. Keyword pointers ignore quoted/relayed/extension input, dedupe structurally per skill, and append atomically to queued prompts; keep binding-form rules and companion skills in the component's table.
- Ultrawork idle input remains untouched with hidden custom context; streaming input appends its directive inside the same queued message so it does not consume a separate turn or break skill expansion. Fallback-architect reminders always stay hidden; its visible notice has the stable structured customType/details.
- Continuations decide on agent_settled, not agent_end. Retry ownership, required compaction, user abort, refusal, sensitive stops, or aborted tool results block continuation without consuming dedupe/slots; boulder work precedes ulw-loop. Reconcile stale work before reads and retain the eight-continuation cap reset by user input.
- Question gates force required:true for the pinned approval/authorization headers or approved label prefixes; never inspect question text, clear the flag, or log the question. Claim receipts remain shadow-default; enable nudges only through the existing opt-in and precision gate.
- Git attribution loads config lazily per matching event and appends one guarded directive to skill reads and child skill loads; preserve include_co_authored_by and commit_footer controls.
- Onboarding claims on the first real interactive prompt (explicit --onboard starts in TUI), never at session_start. Its migration inventory loads only after claim; claim completion and held progress remain separate; never steal a live or unprovable owner.
- Onboarding scans retain at most eight process-scoped scans with in-memory digests until consent. Apply checks ten-minute expiry and fresh target hashes, then writes under the engine credential store lock; stale data or a missing store refuses. Understand returns candidates; facts apply writes only user-selected entries and preserves batch receipts/crash-recovery envelopes.
- Desktop toolkit discovery starts after first paint; preview passes do nothing, turn retries stay bounded, grants belong to calling session, bearer files are re-read, and malformed/duplicate native tools are skipped. Host-tool routes belong to the granting session; lost grants re-confirm and cancelled/timed-out calls never fall back silently.
- Device-service bootstrap runs once only for launcher-started top-level TUI, outside CI and task children; defer beyond paint and keep its child/deadline outside the engine loop. Never write the user's attach opt-out. The engine registrant also serves RPC engines and runs in the module-captured AsyncResource, outside per-session handle ownership; no unregister on engine exit.
- Side-panel handlers start reads and return immediately; drop late results after shutdown and restore the layout then, not on cancellable before-switch. Pure section builders never touch the host; usage reads engine records without its own network polling; keep memory/recall reads non-consuming and never guess sidecar liveness.
- Conditional x-search skills stay in plugin/skills-conditional, outside pi.skills. Computer-use keeps registration light, prelude assets outside bundles, starts engines only on activation, yields to existing skills, and reserves stop/resume for user commands.
- Memory identity and enablement latch at session start; resume conflicts fail closed. Compose compiled committed-HEAD context, exclude parent memory tools from task children, advance reflection cursors only on merged/no_changes, and keep registered memory commands and filesystem guards intact.
- Task exposes task/task_send/task_cancel/task_output and six lead-only team tools. Curated agents stay in-process and cannot become team members; plan-agent unlock requires a user request, touched plan artifact, and no ulw-execute invocation. Never count a model-manufactured request as user authorization.
- Session shutdown suspends scoped children for every reason, unless resume_children:false; missing session identity fails closed. Preserve ordered recovery: buffered completions, reconcile, member liveness, reservation reclaim, redelivery, awaited TTL, owned-lead polling, status. Member inbox polling lives in the member extension.
- Process children use the session-tree p-<key>.sock host; descendants stay there and OMO_RPC_SOCKET* never route children. rpc.sock remains operator/thread traffic. plugin/daemon-launch-spec.json is the sole host argv source; rebuild it. Resolve auto once from actual host capability; explicit modes win. Never introduce arbitrary host/child/memory caps.
- Thread tools register unconditionally and report missing host as data; configuration watchers filter protected agent paths, report reload_required when creation is unwatched, and defer rejected registration retries with a three-retry fingerprint cap.

## BUILD AND QA

- Build plugin bundles with node packages/omo-senpi/plugin/scripts/build-extension.mjs [--check]; sync skills with node packages/omo-senpi/plugin/scripts/sync-skills.mjs; stage conditional search via stage-x-search-skill.mjs [--check].
- Externalize Senpi/Pi peers, TypeBox loader aliases, and Node builtins; keep SENPI_LOADER_ALIASES aligned with src/bundle-purity.test.ts. Vendor bunshin-ts only through its sync script; preserve LICENSE/PIN hashes and #bunshin-ts-dep remapping, never bare package imports.
- For adapter code, run relevant unit tests, tsgo --noEmit -p packages/omo-senpi/tsconfig.json, and bun run test:senpi, then real task/team or routed harness drivers. Unit tests and the package gate alone do not prove live QA.
- Use .agents/skills/senpi-qa/ to route drivers and resolve evidence ONLY through its resolve-evidence-dir.mjs into .omo/evidence/omo-senpi-adapter/<slug>/; evidence stays local and PR bodies carry summaries.
- Record commands/actions, intended behavior, observed results/final JSON, isolation proof and untouched real agent state, plus omissions/redactions. Live drivers create their own isolated agent directories and ignore caller overrides; absent binary or payload yields SKIP/FAIL, never a pass.

## ANTI-PATTERNS

- Never hand-edit generated plugin/extensions or synced skills; edit authored component/native/shared sources. The tracked runtime SDK and explicit local overrides follow plugin guidance.
- Never describe this adapter's v1 install as npm/git/marketplace distribution; install packages/omo-senpi/plugin by local absolute path.
- Never loosen audit gates or grow the package barrel; new surfaces use extension/component boundaries. New runtime dependencies must pass symlinked-install resolution and runtime-package audits; production child-process calls need windowsHide:true or a call-site rationale.
- Never infer task/team parity with the separate OpenCode build, expose literal bearer tokens in MCP headers, or turn Senpi's builtin websearch/LSP into duplicate MCP registrations.
