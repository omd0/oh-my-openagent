# Web contracts and deployment helpers

## OVERVIEW
Leaf modules provide browser/edge data contracts, Node deployment checks, docs inputs, and social-image rendering.

Score: 12; distinct domain: shared contracts and asset publication; `cn` has 24 measured AST importers.

## WHERE TO LOOK
| Task | Location | Detail |
|------|----------|--------|
| Class composition | `utils.ts` | `cn` combines clsx and tailwind-merge |
| Public desktop data | `desktop-download.ts`, `desktop-download.test.ts` | Channels, installer selection, trusted download URLs |
| Install snippets | `install-targets.ts` | Commands and client/platform detection |
| Live counters | `stats.ts`, `github.ts`, `npm-downloads.ts`, `native-downloads.ts` | Metrics and display formatting |
| Docs navigation inputs | `docs-sections-data.mjs`, `docs-sections.ts`, `docs-page.ts` | Shared section/page mapping for generator and routes |
| Deployment identity | `build-id.mjs`, `build-id.test.mjs` | CI SHA validation and static build directory |
| Retained assets | `asset-retention.ts`, `live-asset-inventory.mjs` | History schema, byte hashes, deployment overlap |
| Social artwork | `og/social-image.tsx`, `og/artwork.ts`, `og/graph-glyph.tsx` | Image composition |
| Social metrics | `og/shared-count-store.ts`, `og/live-count.ts` | Shared count state |
| Font generation | `og/fonts.ts` | Output of `scripts/generate-og-fonts.mjs` |

## CONVENTIONS
- Modules are imported directly; this directory has no common barrel.
- `.mjs` deployment helpers may import sibling `.ts` implementations explicitly.
- Unit suites colocate with implementations and run through package `bun run test`.
- `docs-sections-data.mjs` is shared by the build generator and typed route wrappers.
- `OMO_WEB_DESKTOP_DOWNLOAD=1` is a build-time gate; Worker runtime variables cannot enable it.
- Installer types distinguish ready, coming, and unavailable channel states.
- `resolveBuildId` requires a full 40-character lowercase SHA in CI;
  local builds without a SHA return null for Next's local random identity.
- Asset history records active state, SHA-256, retention deadline, and HTML lifetime.

## ANTI-PATTERNS
- Do not hand-edit generated `og/fonts.ts`.
- Never replace commit-based build identity with Next's deploymentId.
- Never silently bootstrap missing asset history for an identified live deployment;
  the documented workflow-dispatch override requires an operator reason.
- Never accept arbitrary hosts or malformed paths as release download links.

## COMMANDS
From `packages/web`: `bun run test` or `bun test lib/<name>.test.ts`;
`bun run type-check` also prepares generated documentation before checking types.
