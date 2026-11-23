# Isolation implementation

## OVERVIEW
Backend adapters, Git snapshot plumbing, and merge internals implement the package's isolation contract.

Score: 11; distinct domain: filesystem implementation and merge internals behind the source barrel.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Candidate order | `backend.ts` | Darwin APFS/ZFS; Linux btrfs/ZFS/reflink/overlay; Windows block-clone |
| Native test seams | `backends/runtime.ts` | Injectable platform, command, and filesystem runtime |
| Bounded copy | `backends/copy-tree.ts` | Walk accounting, destination exclusion, mode/time preservation |
| Windows extent handling | `backends/block-clone.ts` | Cluster sizing and unaligned-tail copy |
| Clone publication tests | `ensure.test.ts`, `backends/platform.test.ts` | Relocation and partial-start cases |
| Git detachment | `git/detach-git-dir.ts` | Rewrite root and nested Git directories |
| Parent baseline | `git/baseline.ts`, `git/synthetic-tree.ts` | Captured state and tree construction |
| Merge synchronization | `merge/shared.ts` | Common-dir queue/lock and artifact containment |
| Branch preservation | `merge/branch-mode.ts` | Replay, stash restoration, retained branch |
| Real test repositories | `test-fixture.ts`, `backends/git-fixture.ts`, `merge/merge-fixture.ts` | Temporary Git fixtures |

## CONVENTIONS
- The barrel combines lifecycle, seven backends, Git helpers, and the merge facade.
- `copyTree` skips its own output when the chosen destination lies beneath source.
- Symlinks preserve their link text; sockets, FIFOs, and devices are not copyable state.
- Windows native access loads `kernel32.dll` lazily through `bun:ffi`.
- `nestedPath` validates the deepest existing canonical ancestor as well as lexical containment.
- Artifact writes reject symlink components at or below the caller's artifact directory;
  system prefixes such as macOS `/var` are outside that owned-path check.
- In-process merge callers queue on a promise before acquiring the cross-process lock.
- Repository fixtures disable `maintenance.auto` to prevent detached Git maintenance
  from recreating object directories during cleanup.

## ANTI-PATTERNS
- Never replace canonical containment with lexical prefix checking.
- Never descend into the destination while copying a parent tree.
- Never add a separate per-file subprocess walk to the copy traversal.
- Do not move native platform calls into module initialization.
