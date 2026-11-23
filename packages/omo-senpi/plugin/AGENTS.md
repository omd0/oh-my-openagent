# omo-senpi/plugin - Local Pi Payload

## OVERVIEW
Local-path @code-yeongyu/omo-senpi package combining generated bundles and skills, tracked runtime SDKs, and build/install scripts.

Score: 10; distinct domain: generated payload boundaries, lazy runtime aliases, and local package installation.
Measured: 51 tracked non-guidance files, 40 code files, own manifest, 1,692 AST declarations and 150 export occurrences; centrality unavailable.

## WHERE TO LOOK
| Task | Location | Contract |
|------|----------|----------|
| Pi loading and publication allowlist | package.json | One system extension; no pi.skills |
| Bundle freshness and staging | scripts/AGENTS.md, scripts/build-extension.mjs | Source/input fingerprints, portable build paths |
| Local installer and generated launcher | scripts/install.mjs, scripts/build-install.mjs | Source installer in ../src/install/ |
| Native/shared skill composition | scripts/sync-skills.mjs | Native overrides and shared-asset transfer |
| Conditional x-search | scripts/stage-x-search-skill.mjs | Stages outside ordinary skills discovery |
| Skill roster and LSP migration | README.md | Project .pi/lsp-client.json command/env entries are ignored for safety |
| DAG eval API | runtime/dag/sdk.js | Import-free wrapper around globalThis.tool.workflow |
| Named DAG definitions | runtime/dag/library.js | Validates library names before loading |
| Thread client SDK | runtime/thread-sdk/sdk.js | Generated, tracked createThreadSdk entry |
| Authoritative host argv | daemon-launch-spec.json | Rebuild through scripts/build-daemon-launch-spec.mjs |

## CONVENTIONS
- Install this directory by absolute local path; generated extensions and skills make git:/npm: adapter installs unsupported.
- Pi loads only extensions/omo.js; bundled-skills contributes resources at runtime so disabled_skills can filter them.
- extensions also carries generated member, worker, persona and computer-prelude artifacts; the gateway worker must remain a separate file beside the bundle.
- Track authored runtime/dag separately from staged runtime/agent-toolkit, runtime/ast-grep-mcp and other generated runtimes; generated tracked SDKs still rebuild from their sources.
- DAG wire fields are snake_case (run_id, node_id); SDK fields are camelCase (runId, nodeIds).
- sdk.js exports define/start/attach/snapshot/wait/cancel/retry/send/amend and must remain import-free for eval workers without node_modules resolution.
- library.js accepts names matching ^[A-Za-z0-9][A-Za-z0-9._-]*$.
- Freshness uses // omo:<fingerprint> markers and source digests; do not pin the number or byte size of bundles.
- Tracked init-deep/onboarding local overrides are exceptions to the generated skills tree; identify the authored source before editing.

## LAZY RUNTIME MAP
Every alias below maps through package.json to an extensions sidecar; keep freshness, install fixtures, required artifacts, and bundle audits aligned.

| Alias suffix after #omo- | Sidecar | Activation / load contract |
|--------------------------|---------|----------------------------|
| task-runtime | omo-task.js | Task component split |
| computer-use-runtime | omo-computer-use.js | First computer-use activation |
| desktop-toolkit-runtime | omo-desktop-toolkit.js | Toolkit discovery/runtime |
| telemetry-posthog-runtime | omo-telemetry-posthog.js | First capture; newest 256 events replay in order; oldest drops reported once at flush/shutdown; failed imports back off 60 seconds |
| telemetry-otlp-runtime | omo-telemetry-otlp.js | Lazy OTLP transport |
| telemetry-recovery-runtime | omo-telemetry-recovery.js | Only when summary recovery has work; also #telemetry-immediate-send |
| memory-doctor-runtime | omo-memory-doctor.js | First doctor invocation |
| memory-memfs-runtime | omo-memory-memfs.js | First memfs invocation; synchronous registrar |
| memory-palace-runtime | omo-memory-palace.js | Synchronous palace/people registration with stable metadata; first call shares one process import; failed loads not cached |
| memory-commands-runtime | omo-memory-commands.js | Eleven synchronous command registrations; first use shares one process import; also dream selection and due retention/host sweeps; failed loads not cached |
| device-account-runtime | omo-device-account.js | Synchronous source shell; first sync resolve loads shared source, desktop claim and Worker proxy; failed loads not cached |
| session-history-runtime | omo-session-history.js | Synchronous tool/RPC registration; first history tool or projects/sessions RPC shares one process import; failed loads not cached |
| thread-client-runtime | omo-thread-client.js | Synchronous tool/store/lifecycle registration and socket capture; first async operation shares a facade promise/client, including failures |
| recall-store-runtime | omo-recall-store.js | First corpus load shares one process import; entry retains index accessors; failed imports uncached, recall tokenizes instead |
| device-service-runtime | omo-device-service.js | After first TUI paint; entry carries only registration hook |

- memory-commands also provides #memory-completion-links at dream/reflection finalization; recall-store provides #memory-external-projection only for compiles with non-system files. Other memory-core consumers use source mappings.
- Dream selection loads only for idle/shutdown/manual dreams, never pressure dreams; failures warn. Due retention/host-sweep load failures log the failed step.
- Palace/people, memory commands and session-history failures return actionable reinstall/restart errors rather than unhandled rejections.
- PostHog factories share imports, report failures once with source, and preserve consent/fetch gates; lifecycle awaits pending captures without loading an unused SDK.

## ANTI-PATTERNS
- Never edit generated extensions, synced skills, conditional skills, staged runtimes or SDK outputs by hand; regenerate through scripts.
- Never add credential-gated x-search to pi.skills; files and native/binary payload allowlists must still ship skills-conditional.
- Conditional staging honors OMO_SENPI_PLUGIN_OUTPUT; do not leave the skill behind when building a staging payload.
- Never widen manifest surfaces without package-shape and plugin-manifest coverage; use opaque bundles only as build artifacts.
- Keep live host evidence under the adapter QA contract in ../AGENTS.md; a green package gate alone is insufficient.

## COMMANDS
From repo root: node packages/omo-senpi/plugin/scripts/build-extension.mjs --check.
Build and exercise the adapter with bun run test:senpi; script-local checks are listed in scripts/AGENTS.md.
