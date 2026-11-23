# omo-native - Native Distribution and Launcher

## OVERVIEW
Distribution adapter publishing npm omo-ai (bins omo and pi), running exact-pinned @code-yeongyu/senpi with the staged omo-senpi extension.

**Score:** 10; distinct launcher/distribution domain: 321 authored/checked-in files, 94% code, own config, measured AST declaration/export thresholds.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Dispatch/version/brand | `bin/omo.js`, `bin/lib/launcher.js` | runLauncher; SENPI_BRAND carries name, agent home, OMO_* prefix, wire identity, running-version update channel |
| Resolve/adopt state | `bin/lib/agent-dir.js` | canonicalAgentDir and adoptLegacyFlatState |
| Detect/import setup | `bin/lib/setup-{detect,import,models,report}.js` | Read-only SQLite inputs; plan/classify/consent/write |
| Cache setup suggestions | `bin/lib/setup-detect-{cache,refresh}.js` | Fingerprint every detected input by path/mtime/size plus TTL; detached unref'd refresh child is sole writer |
| Select runtime | `bin/lib/bun-runtime.js` | maybeReexecUnderBun, findBunBinary, probeBunVersion, resolveBunGuard |
| Preserve child lifecycle | `bin/lib/child-process.js` | spawnNode/runChild; POSIX execve handoff, async fallback |
| Prepare Bun entry | `bin/lib/bun-bin-shim.js` | ensureBunBinShim; package-owned shell/JS prelude for POSIX Bun-global installs |
| Diagnose stale engines | `bin/lib/doctor.js` | classifyEngineProcesses and reapStaleEngines |
| Prepare installed engine | `bin/lib/engine-prepare.js`, `bin/senpi-patch.mjs` | Compile-safe css-tree data and RPC stream guard; .omo-engine-prepared version stamp |
| Protect launch-spec modes | `bin/lib/launch-spec-mode.js` | normalizeLaunchSpecMode; launchSpecDoctorLines |
| Guard RPC serialization | `bin/lib/rpc-stream-errors.js` | invalid_stream_event fails prompt and exits 1; also applied after omob engine swaps |
| Explain task coverage | `bin/lib/category-coverage.js`, `category-coverage-entry.ts` | Offline ModelRuntime via plugin/runtime/category-coverage/index.js; read-only auth/models/env, no writes |
| Explain ignored config | `bin/lib/config-doctor.js`, `config-doctor-runtime.ts` | One WARN per ignored key/unloaded file; compiled entry imports runtime directly |
| Update npm/Bun install | `bin/lib/self-update.js`, `bin/lib/update-lock.js` | Windows held-file diagnosis and guarded rollback |
| Find package metadata | `bin/lib/package-paths.js`, `provider-map.json`, `legacy-bun-global-migration.js` | Paths, providers, legacy install migration |
| Reach daemon/thread CLI | `bin/lib/{daemon,thread,host-status}.js` | Contract details below; reference docs under docs/reference/ |
| Prove launcher behavior | `test/AGENTS.md` | Contract suites and real PTY signal proof |

## CONVENTIONS

- ESM uses explicit .js imports and node: builtins; runtime requires Node >=24, tests use Bun. Paths derive from import.meta.url and agent-dir helpers.
- Publish prereleases on beta and stable versions on latest. Launcher answers --version and every self-update spelling; docs/reference/omo-ai-publishing.md owns release mechanics.
- Build stages plugin/ with --extension <pkgRoot>/plugin; generated payload is gitignored and never committed.
- All launchers, doctor, setup, and the local-install launcher resolve state through canonicalAgentDir: ~/.omo/agent. OMO_CODING_AGENT_DIR, then legacy SENPI_CODING_AGENT_DIR/PI_CODING_AGENT_DIR override; adoptLegacyFlatState carries pre-unification flat ~/.omo state forward once without overwriting canonical files.
- Interactive suggestions use a synchronous fail-open harness-detect-cache.json read; stale/missing cache never blocks spawn. Only the refresh child writes it. Explicit setup/doctor always perform live detection.
- Discovered Bun runs omo when >=BUN_MIN_VERSION 1.4.0 (node:sqlite and worker_threads). User-chosen old Bun (Bun-global/OMO_RUNTIME=bun) fails with the upgrade message; old discovered Bun on npm/project-local/bunx stays on Node. Unchosen already-running old Bun hands off to real Node with OMO_RUNTIME=node or fails; explicit OMO_RUNTIME=node always stays Node.
- POSIX execve preserves PID, argv[0], args, environment. Windows/missing/thrown execve uses async runChild: forward SIGTERM/SIGHUP, allow OMO_SIGNAL_GRACE_MS (10s default), then re-raise ignored signal; await SIGINT without double-forwarding.
- Bun shim preparation is fail-open on trusted postinstall and launch. Both global bin paths stay Bun-owned symlinks; restore only marked legacy wrappers for this install. Windows/npm retain Node shebang; first manual upgrade from old shim can fail before migration, then one new-version launch prepares the next update.
- Engine preparation runs in postinstall and before every engine start, including ignored/blocked install scripts. Launch-time failure warns with reinstall command without blocking launch; the old Claude Code UA-floor rewrite is gone (senpi#5131).
- Launch-spec preparation strips group/world write bits only from this user's regular, lstat-checked plugin/daemon-launch-spec.json, never symlinks; no-op on Windows. Run fail-open before doctor and on each preparedSenpi launch/postinstall; npm and compiled doctor report FAIL plus fix when still unsafe.
- RPC preparation is idempotent; missing target/bindings (including shutdown) or unsupported serializer shape fails installation. Recheck required bindings even when already prepared.
- Coverage diagnostics fail open with no line/row on error. Config diagnostics warn once per dropped key or unread file; unloadable runtime prints WARN config: diagnostics unavailable: <reason>.
- Windows update retries only held-file EPERM/EBUSY/NtSetInformationFile with backoff; bare EPERM qualifies only for rename/unlink/rmdir. EACCES is never retried. Persistent holds name file, one action, and CIM holders filtered to omo-ai/@code-yeongyu/*/held global package. Reinstall the previous version once only after failure leaves the install unreadable; preserve every readable version.

## DAEMON AND THREAD CONTRACTS

- Daemon syntax: run|adopt|status|stop [--drain] [--all [--wait [--timeout <s>]]]|handoff|gc [--prune-store-index]|rollback-prepare. run maps to engine host ensure on rpc.sock; no attach command, and a terminal never joins a host. Status/gc/handoff/stop --all/rollback cover operator rpc.sock, p-* task, and i-* desktop endpoints through daemon-{operations,status,rollback}.js.
- Daemon --foreground exits 2 before invoking engine, after unknown-command and win32 refusal (exit 4); --persistent is accepted/ignored. daemon-args.js owns flags and exit codes 2/3/4/5; daemon-doctor-report.js owns doctor lines. Compiled entry re-runs ITSELF with host args because process.execPath is omo. See docs/reference/omo-daemon.md.
- TUI endpoint rows render tui <name> pid <n> cwd <path>, count in aggregate.terminals, never live hosts. operable() excludes them from lifecycle operations and handoff reports skips. gc remains plain host gc, whose evidence reaps dead terminals; no --kinds engine CLI option exists.
- adopt <session> [--interrupt] [--force] [--json] locates live rpc_host sessions via thread SDK, calls release_session, then launches --session <path> in that session's cwd with nonblank dropped user messages after --. Refusal (turn_active/attached/session_busy/already-terminal) exits 4; not-found/not-served/unknown_session exits 3; release_failed twice exits 5; release_failed followed by unknown_session counts released.
- All adopted text after -- is message text. compile-args.ts launchOptions, buildSenpiArgs, banner gate, and isInternalSupervisorLaunch inspect options only before -- so replayed --no-extensions cannot strip the plugin.
- Thread syntax: list|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack [--json]. thread-args.js/THREAD_EXIT own parsing and codes; thread-output.js owns human output. SDK at plugin/runtime/thread-sdk/sdk.js runs as cli:<uid>, never starts a host, and enumerates endpoints through daemon status's engine inventory.
- loadThreadSdk supplies createCliRemoteSurface; alias sign-in loads extensions/omo-device-account.js on first use. Reads resolve aliases/other-device threads through the sidecar when available, keeping local-only behavior otherwise. Probe node:sqlite lazily before loading SDK; unavailable exits 4 (sqlite-import-discipline.test.ts).
- Absent thread flags become undefined SDK fields. Invalid --mode/--direction or empty send are usage errors. --json prints one error JSON value even for CLI-side usage/win32/no-sqlite failures. answer requires explicit --binding. send --binding is connector inbound: --mode auto|follow_up is binding-capped; --author-id/--author-name/--author-user-id require binding on send and answer.
- Thread exits: 0 ok, 1 data refusal, 2 usage, 3 host_unavailable, 4 win32/no node:sqlite, 5 internal_error. JSON shapes are contracts in docs/reference/omo-thread.md.
- host status --all enriches each tui row with readSessionFacts(owner.session.path).updated_at as last_activity_at, else null. Compiled self re-run sets OMO_HOST_STATUS_RAW=1 to prevent duplicate enrichment.

## ANTI-PATTERNS

- Never recompose agent-home defaults outside agent-dir.js, use spawnSync for long-lived handoffs, or pattern-kill engines.
- Doctor may terminate only explicitly named PIDs still classified stale at request time (interactive PPID 1); attached/managed --mode engines are distinct.
- Never write source SQLite stores during setup or treat missing setup cache as a startup failure.
- Never run daemon lifecycle commands on terminal endpoints, infer an answer binding, or parse adopted user messages as CLI options.

## COMMANDS

- Repository root: bun run build:omo-native; bun test packages/omo-native/test; bunx tsc -p packages/omo-native/tsconfig.json --noEmit.
- Entry smoke: node packages/omo-native/bin/omo.js --version.
- Signal QA: python3 packages/omo-native/test/pty-signal-qa.py packages/omo-native/bin/omo.js /tmp/qa.txt; installed Bun exercises that chain, OMO_RUNTIME=node exercises Node.
