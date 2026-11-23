# Native launcher entrypoints

## OVERVIEW
Source launcher modules coordinate runtime handoff, private descriptors, command dispatch, and installed-engine preparation.

Score: 9; distinct executable boundary with measured function and export density.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Earliest startup ordering | `omo.js` | Imports descriptor capture before other work |
| Command dispatch | `lib/launcher.js` | Product verbs versus raw engine commands |
| Trusted install preparation | `senpi-patch.mjs`, `lib/engine-prepare.js` | Shared install and launch preparation |
| Memory-sync boot claim | `lib/engine-boot.js`, `lib/memory-sync-boot.js` | Claim before importing the engine CLI |
| Descriptor transfer | `lib/private-fds.js`, `lib/private-fd-table.js` | Explicit inheritance hops |
| Remote attachment lifetime | `lib/remote-attach-launch.js` | Keeps endpoint alive until TUI exit |

## CONVENTIONS
- Capture and remove the private-descriptor environment table before helper spawning.
- Close unusable inherited sockets; pass valid descriptors through explicit handoffs.
- Strip the `engine-boot.js` argv layer before importing the engine CLI.
- Boot ordering is cwd validation, inherited filler release, claim gate, then claim.
- The CLI entry removes retired plaintext service credentials before early-return verbs.
- Product auth and account commands lazily import the generated service-auth bundle.
- Raw engine commands omit the plugin extension; normal interactive launches add it.
- Remote attach uses a signal-aware child because the launcher owns its endpoint.
- Recheck plugin launch-spec permissions independently of the engine-prepared stamp.

## ANTI-PATTERNS
- Never replace remote attach's supervising launcher with `execve`.
- Never skip its exit path after setup or TUI failure; it releases open endpoints.
- Never leak the private-descriptor table into unrelated helper children.
- Never hand-edit generated auth, reflection-lock, or brand-logo modules.

## GENERATED ARTIFACT OWNERS
| Artifact | Generator recorded in file header |
|----------|-----------------------------------|
| `lib/service-auth.generated.js` | `bun script/build-service-auth.ts` |
| `lib/reflection-lock.generated.js` | `bun script/build-reflection-lock.ts` |
| `lib/brand-logo.generated.js` | `bun script/build-brand-logo.ts` |
