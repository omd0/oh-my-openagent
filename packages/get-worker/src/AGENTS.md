# get-worker/src - Request and Metrics Contracts

## OVERVIEW
Worker-internal handlers connect release validation, edge cache/R2 delivery, and Analytics-to-D1 aggregation.

**Score:** 8; distinct request/storage domain: 10 code files, index boundary, 121 AST declarations and 44 export statements.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a route | `index.ts` | GET/HEAD only; health, scripts, channels, versioned assets, stats |
| Validate names and versions | `release-names.ts` | Asset kinds, release object keys, completion markers |
| Read channel metadata | `channels.ts` | Channel handler |
| Change script negotiation | `scripts.ts` | PowerShell/curl agents get scripts; browsers get docs |
| Change asset delivery | `serve-release.ts` | Cache first, completed R2 mirror, GitHub redirect |
| Record an event | `datapoint.ts` | Country, QA marker, counted source |
| Change rollup window | `downloads-rollup.ts` | Query, row validation, floor filter, D1 upsert |
| Read public statistics | `download-stats.ts` | Stats response contract |
| Adjust injected ports | `env.ts` | Env and RequestContext |

## CONVENTIONS

- Handlers take RequestContext so cache and waitUntil remain injectable.
- Count downloads on GET only; HEAD returns headers without a body.
- Release cache keys use the canonical version/asset URL; ranged requests retain Range semantics.
- Publish cached R2 responses through waitUntil; require the version completion marker before serving its objects.
- Rollups restore sampled counts with SUM(_sample_interval * double1), validate dataset identifiers, and omit QA events.
- Validate ROLLUP_FIRST_DAY before calling Analytics Engine or D1; the account-cutover floor protects backfilled days.

## ANTI-PATTERNS

- Never replace a complete cross-account day with this account's partial data.
- Never add GitHub fallback redirects to the uncounted total.
- Never read R2 again for a cached repeat download.
- Never cache an incomplete mirror or a GitHub fallback as an immutable successful object.
