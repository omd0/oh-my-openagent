# get-worker - Download Edge

## OVERVIEW
Private Worker serving installers, release channels/assets, and download metrics at get.omo.dev.

**Score:** 12; distinct hosted application: 28 files, 79% code, own config, source entry, measured symbol/export thresholds.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route requests and cron | `src/index.ts` | `route`, fetch adapter, scheduled rollup |
| Review storage bindings | `wrangler.jsonc` | R2 RELEASES, D1 DB, Analytics DOWNLOADS |
| Change install behavior | `scripts/install.sh`, `scripts/install.ps1` | Served verbatim through Text rules |
| Check migration readiness | `scripts/check-migrations-applied.sh` | Committed `migrations/applied.txt` ledger |
| Change counters/schema | `migrations/0001_downloads.sql` | Daily aggregates and uncounted totals |
| Test HTTP/storage behavior | `test/routes.test.ts`, `test/downloads.test.ts` | Local fakes in `test/fakes.ts` |
| Test installer safety | `test/install-sh-*.test.ts` | Asset detection, aliases, other installs, preamble |

## CONVENTIONS

- Custom-domain binding matters: the web Worker calls this Worker on the same zone; a zone route is not interchangeable.
- Hourly rollup runs at minute 17 and requires the ANALYTICS_TOKEN secret.
- Wrangler imports `.sh` and `.ps1` as Text; edits to installer payloads change served bytes.
- A migration enters the committed applied ledger only after application; the gate checks every migration.
- Run package commands here: `bun run type-check`, `bun test`, `bun run lint:scripts`.
- `bun run dev`, `bun run deploy`, and `bun run cf-typegen` are package-local Wrangler scripts.

## ANTI-PATTERNS

- Never execute a truncated installer; its body is invoked only from the final line.
- Never delete other installs non-interactively without the explicit flag, or remove an unverified look-alike `omo`.
- `OMO_NO_MODIFY_PATH=1` must leave PATH and shell profiles untouched.
- Never treat root `bun test` as coverage for this excluded package.
