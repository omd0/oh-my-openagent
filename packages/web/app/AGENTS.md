# web/app - Routes and Document Roots

## OVERVIEW
App Router routes separate localized home/site documents, API metrics, metadata, and an opt-in design showcase.

**Score:** 11; distinct routing domain: 41 files, six immediate directories, 85% code, measured AST thresholds.

## STRUCTURE

| Directory | Purpose |
|-----------|---------|
| `[locale]/` | Separate `(home)` and `(site)` root layouts |
| `_components/` | Document shells, localized shell, shared site metadata |
| `api/` | Download, npm-download, and general statistics endpoints |
| `design/` | Flag-gated primitive showcase and showcase modules |
| `fonts/` | Document font assets |
| `styles/` | Shared design-system stylesheet |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Change home document | `[locale]/(home)/layout.tsx` | HomeDocument and NextIntlClientProvider |
| Change site document | `[locale]/(site)/layout.tsx` | DocumentShell and LocalizedPageShell |
| Preserve localized 404 | `[locale]/(site)/[...rest]/page.tsx` | Unmatched path calls notFound inside its locale |
| Change documentation routes | `[locale]/(site)/docs/` | Generated content consumed through route pages |
| Change canonical/share metadata | `_components/site-metadata.ts` | generateSiteMetadata, jsonLd, siteViewport |
| Change discovery metadata | `robots.ts`, `sitemap.ts`, `manifest.ts` | Crawling and application metadata |
| Preview primitives | `design/page.tsx` | OMO_WEB_SHOWCASE=1, evaluated per request |

## CONVENTIONS

- Home and site are separate root layouts; crossing between them performs a full navigation.
- Both roots validate locale before setting the request locale and export one-hour revalidation.
- Async route params are promises; shared metadata supplies light/dark viewport colors.
- `/design` is dynamic and excluded from indexing, sitemap, and enabled-showcase crawling.
- There are no colocated tests here; package unit tests and Playwright cover the routes.

## ANTI-PATTERNS

- Never set dynamicParams=false on the localized site root: empty Cloudflare incremental caches would return 404 for valid routes.
- Never assume global-not-found handles URLs already captured by the locale segment.
- Never make the showcase indexable or replace its explicit runtime flag with NODE_ENV.
