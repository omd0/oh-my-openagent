# isolation-core

## OVERVIEW
Harness-neutral filesystem isolation PAL with patch and branch merge-back; callers supply task-runner integration.

Score: 10; distinct domain: backend publication, ownership, retention, and merge safety.
Ported from oh-my-pi `crates/pi-iso` + `task/isolation-*` (MIT); candidate ordering,
unavailable-only fallback, and retention follow upstream. No Rust/napi or `.node` sidecar.

## WHERE TO LOOK
| Task | Location | Contract |
|------|----------|----------|
| Public API | `src/index.ts`, `package.json` | Source TS exports; no package build step |
| Backend lifecycle | `src/backend.ts`, `src/ensure.ts` | Probe, claim, publish, cleanup, retain |
| Device selection | `src/base-dir.ts` | Same-device selection and deterministic I/O seam |
| Owner recovery | `src/owner.ts`, `src/sweep.ts` | Identity and daemon-session probes |
| Merge facade | `src/merge/index.ts` | Patches, branch replay, artifact summary |
| Platform proof | `src/backends/fs-integration.test.ts` | Real filesystem gates |

## CONVENTIONS
- Backends write only inside context `baseDir`; `start` targets `m`, and `stop`
  must tolerate a partially failed start.
- `chooseBaseDir(repoRoot, homeDir, id)` probes volume roots with mkdir/remove;
  a home fallback on another device excludes tree-cloning backends.
- Publication claims `.creating-<pid>` exclusively, then calls optional backend
  `relocate(fromBase, toBase)` or rename; retention uses the same relocation hook.
- Ownership precedes age: creating/malformed markers receive ten minutes' grace;
  a live creating owner survives regardless of age.
- Process identity uses memory-core's lazy native functions without subprocess
  fallback; Node returns null and relies on PID liveness.
- Sweeps stop the recorded backend before removal; missing backend means skip,
  and absent daemon probes leave host-session children unknown.
- `retainIsolation(handle, reason)` changes paths and invalidates the old handle.
- Merge artifacts include root/nested patches and a summary before application;
  `apply: false` preserves artifacts without mutating the parent. Callers own teardown.
- Patch application is atomic per repository: root failure leaves nested repos
  untouched; nested failure after root success is partial, with separate nested commits.
- Branch replay preserves child commits on clean baselines and filters inherited WIP;
  `IsolationCommitReplayError` identifies the commit/retained branch; facade returns `branch-merge-failed`.
- Both merge modes use memory-core's identity-bearing lock in Git's common directory,
  including linked worktrees; branch mode restores stashed WIP with `--index`.
- `applyDeltaPatch` takes `{ id, artifactsDir }`; `commitToBranch` returns
  `{ branchName, baseSha, nestedPatches }` for `mergeTaskBranch`.
- Successful start records ISO `started_at`; old `{ backend }` markers remain readable.
  ZFS also records dataset/snapshot identity; overlay records its lower path.
- FFI walks and rcopy account bytes during traversal: 10% headroom, 2 GiB default,
  no separate prewalk. Node reflink uses argv-only `cp -a --reflink=always`.

## ANTI-PATTERNS
- Only `IsolationUnavailableError` allows fallback; propagate operational failures.
- Never recursively remove an active mount after failed teardown, overwrite published
  or in-flight directories, or automatically delete foreign/retained/live/unknown owners.
- Before manually removing retention, stop its recorded backend at `<retainedPath>/m`.
- On artifact-write failure retain the handle/tree; do not clean it up.
- Never automatically use `--3way`, commit overlapping user WIP as replay fallback,
  discard a failed-pop stash, or turn reflink fallback into silent plain copy.
- ProjFS stays excluded: driver callbacks require a native host, not clone-call FFI.

## COMMANDS
`bun test packages/isolation-core` (or a focused `src/<name>.test.ts`);
`tsgo --noEmit -p packages/isolation-core/tsconfig.json`.
Tests use real directories with fake native/CLI boundaries and injected device/liveness probes.
Required PR check: `Isolation Linux filesystems / linux-fs`; request it explicitly
for isolation-core/isolated-child changes. It covers loopback btrfs, available ZFS,
publication/COW/teardown, and ext4 EOPNOTSUPP mutation; absent local gates are explicit skips.
Hosted Windows runners provide native-contract tests, never live ReFS proof.
For live ReFS use a disposable, pre-provisioned volume: `fsutil fsinfo volumeinfo R:`;
set `$env:ISOLATION_TEST_REFS_ROOT = 'R:\isolation-tests'`, create that directory,
run `bun test packages/isolation-core/src/backends/fs-integration.test.ts -t ReFS`,
then `Remove-Item Env:ISOLATION_TEST_REFS_ROOT`. No volume is formatted.
The test checks publication, aligned extents, tails, tiny/empty files, immutability,
and teardown; save output, Windows build, and cluster size. Native calls use long-path
prefixes, cluster-rounded allocation, aligned-prefix clone plus tail copy, and original logical size.
