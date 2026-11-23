# packages/web/ -- Marketing Site

## OVERVIEW
Independent Next.js 16.3.5 App Router site for omo.dev, deployed to Cloudflare Workers through OpenNext.

Score: 15; distinct application domain with its own dependencies, tests, design system, and deployment.
Stack: React 19, Tailwind v4/shadcn, next-intl, ESLint 10/Prettier, Playwright;
Cloudflare uses `nodejs_compat`. This package is outside npm plugin publication.

## STRUCTURE
| Directory | Purpose |
|-----------|---------|
| `app/[locale]/` | Localized home and site routes |
| `components/` | Home, docs shell, downloads, graph scenes, shared primitives |
| `lib/` | Download contracts, metrics, docs compilation inputs, deployment safeguards |
| `i18n/`, `messages/` | Locale routing and translated copy |
| `public/` | Static assets |
| `e2e/` | Playwright suites |
| `scripts/` | Build preparation, content/font generation, deployment asset checks |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Canonical routing | `proxy.ts`, `i18n/routing.ts` | Locale prefix as needed, detection enabled |
| Locale list | `i18n/config.ts` | en, ko, ja, zh, es, fr, de, pt-BR, it |
| Visual source of truth | `app/styles/design-system.css`, `components/home/styles/` | Night/Day palettes, Timeless Sans + JetBrains Mono |
| Worker target | `open-next.config.ts`, `wrangler.toml` | `.open-next/worker.js`; pinned account and zone routes |
| Docs generation | `scripts/generate-docs-content.mjs` | Source docs become `lib/docs-content.generated.ts` |
| Asset identity | `lib/build-id.mjs`, `lib/asset-retention.ts` | Commit-named static directories and byte invariants |
| Component generator | `components.json` | Existing shadcn primitives |
| Browser testing | `playwright*.config.ts` | Flag-off suite followed by regular suite |

## CONVENTIONS
- Keep `@/*` imports confined to this package; install dependencies with `bun install`.
- All user-facing component copy goes through `messages/{locale}.json`.
- Use existing `components/ui/` primitives rather than installing another UI library.
- Stylesheets override the older dark-only Geist guidance in `DESIGN.md` (#12658);
  preserve IntersectionObserver reveals and transform/opacity-only animation.
- Prettier formatting is enforced by web CI. Root Bun tests exclude this application.
- Generated docs live in `lib/docs-content.generated.ts`; edit root `docs/` sources.
- `wrangler.toml` targets the Sisyphus Labs account (moved 2026-10-09), pins account id
  and omo.dev `zone_id` routes; deployment uses GitHub's `omo-production` environment.
- Its `CLOUDFLARE_API_TOKEN` is limited to Worker scripts and omo.dev zone routes
  (infra reference: `sisyphuslabs/common-infra/docs/cutover-workers.md`).
- Build id is the commit SHA, so `/_next/static/<sha>/` identifies one set of bytes.

## ANTI-PATTERNS
- Never run `npm install`, commit `.next/`, `.open-next/`, `.wrangler/`, or `node_modules/`.
- Never deploy production locally with `bun run deploy`; use the GitHub Actions workflow.
- Do not bypass `Content-addressed asset changed bytes` on a same-SHA rebuild;
  deploy a new commit if rebuilt manifests differ.
- No framer-motion, serif typography, or width/height/top/left/margin/padding animation.
  CSS keyframes/Tailwind remain the rule; DESIGN.md has only a narrow `motion/react layoutId` exception.
- Never edit generated docs output or replace the source documentation with its compiled HTML.
- Accepted debt: docs overflow at 390x844; do not worsen it outside docs-shell design work.

## COMMANDS
Run inside `packages/web`: `bun install`, `bun run dev`, `bun run lint`,
`bun run lint:fix`, `bun run format`, `bun run format:check`, `bun run type-check`,
`bun run test`, `bun run test:e2e`, `bun run build`, `bun run preview`, `bun run cf-typegen`.
Type checking regenerates docs before tsgo; prebuild clears stale fetch cache.
`web-ci.yml` checks format/lint/types/Next/OpenNext builds for master/dev changes;
`web-deploy.yml` deploys master changes or manual dispatch with workflow-held credentials.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
