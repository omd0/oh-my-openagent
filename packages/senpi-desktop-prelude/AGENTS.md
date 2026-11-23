# senpi-desktop-prelude - Computer Kernel Assets

## OVERVIEW
Private package supplying JavaScript/Python computer facades, declarations, model documentation, and safety text.

**Score:** 12; distinct asset boundary: 28 files, 75% code, own config, source entry, measured symbol/export thresholds.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Consume public assets | `src/index.ts` | Only package export: computerPreludeAssets |
| Load asset bytes | `src/assets.ts` | Lazy validated JSON read, cached per process |
| Change facade calls | `src/prelude.js`, `src/prelude.py` | Each helper makes an ordinary tool.computer call |
| Change JS types | `declarations.d.ts` | Kernel computer global |
| Change prompt help | `docs/computer.md` | Rendered inside the prelude's existing code fence |
| Change approval/stop rules | `docs/computer-safety.md` | Shipped system-prompt fragment |
| Generate payload | `scripts/generate-assets.ts` | Writes src/assets.generated.json |
| Check payload identity | `test/assets*.test.ts`, `test/assets.sha256.json` | Generator drift and five-asset byte hashes |
| Check method exposure | `test/method-allowlist.test.ts` | Both facades against protocol tier tables |

## CONVENTIONS

- Import no workspace package in production; protocol imports in tests check the package boundary.
- Keep the five texts outside transpiled bundles; stage JSON beside the built extension.
- Resolve assets with fileURLToPath(import.meta.url); import.meta.dir is unavailable under plain Node/jiti.
- METHOD_ALLOWLIST covers the desktop, display, window, and element tiers; `run` and `close` are tool actions.
- Tests use Vitest and Given/When/Then comments; use `bun run test` and `bun run typecheck` here.
- Regenerate with `bun run generate`; README's older assets.generated.ts description is stale.

## ANTI-PATTERNS

- Never expose host-only resume, stop, heartbeat, start, or session.open through model call chains.
- Never let UI or third-party content supply user confirmation or override direct user instructions.
- Provider safety checks require explicit interactive approval; fail closed otherwise.
- Suspended/StopPathUnavailable halt input; never retry around them or resume automatically.
- UserIntervened yields to the user; reread afterward rather than repeating or typing around their action.
- Keep consequential-action confirmation at the exact target, scope, and values unless the user explicitly authorized that action.
