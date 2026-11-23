# tests/ - Repository Integration Tests

## OVERVIEW
Cross-package invariants and integration fixtures that do not belong to one package's co-located unit suite.

Score: 4; existing guidance retained for cross-package contracts and the isolated live Hashline fixture.
Package-specific tests remain beside package source.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Check category/schema parity | `omo-config-category-drift.test.ts`, `omo-schema-freshness.test.ts` | Source-derived contract and generated-artifact freshness |
| Check schema references | `omo-schema-unique-ids.test.ts` | Unique IDs and profile references, issue #6444 |
| Check defaulted schema fields | `schema-defaulted-fields-optional.test.ts` | Defaults must not become required, issue #6445 |
| Check reasoning vocabulary | `reasoning-vocabulary-parity.test.ts` | Model/config normalization agreement |
| Check shipped goal reference | `ulw-loop-define-goal-reference.test.ts` | Both editions ship the referenced file |
| Check review convergence | `ulw-plan-review-convergence-contract.test.ts` | Machine-consumed review contract JSON |
| Exercise live Hashline edits | `hashline/headless.ts`, `hashline/test-*.ts` | Separate Bun package; sandbox-only network/model drivers |
| Validate Hashline environment | `hashline/test-environment.ts`, `hashline/test-environment.test.ts` | HTTP/HTTPS URL and non-blank key |

## CONVENTIONS
- `bun test tests/*.test.ts` runs direct cross-package invariants and deliberately misses `hashline/`.
- Full root `bun test` includes this tree through the root Bun configuration.
- Hashline's heavy `test-edit-ops.ts`, `test-edge-cases.ts`, and `test-multi-model.ts` do not match Bun's `*.test.ts` discovery.
- Only its self-contained environment parser test enters normal discovery; preserve the separate lockfile and headless entry rather than adding it to root preload.
- Freshness tests compare source-derived output with generated artifacts; regenerate the artifact rather than editing expected values.
- Allowed instruction-adjacent assertions cover machine-consumed fields/sentinels/tool names, byte or shipped-copy equality, and observable runtime parsing/routing/dispatch/state/security/input propagation.

## HASHLINE ISOLATION
- The fixture imports adapter-internal `../../packages/...` paths, calls live models/network, and may write model-selected paths relative to cwd.
- Run only from a disposable full-repository copy inside a filesystem-isolated VM/container with no sensitive parent files, never the primary checkout or an active worktree.
- Set explicit short-lived, least-privilege test-only `HASHLINE_TEST_BASE_URL` and `HASHLINE_TEST_API_KEY`; the parser validates HTTP/HTTPS and a non-blank key, and headless execution has no hardcoded fallback.
- Use a non-production endpoint and never production or personal credentials.
- Keep generated files and raw stdout/stderr inside the disposable sandbox or local redacted evidence directory; redact before sharing and never publish raw logs.

## ANTI-PATTERNS
- Prompt/prose contract tests are forbidden: never pin authored prompt, skill, rule, AGENTS.md, or markdown-instruction wording or structure.
- Pure prose changes do not get phrase-pin tests; cover schemas, registration, or runtime behavior when relevant.
- Do not turn this directory into a second home for ordinary package unit tests.
- Never remove, skip, or isolate a failing cross-package invariant to make the root suite green.
- The synthetic AGENTS.md benchmark under `packages/omo-opencode/src/__tests__/perf/fixtures/` follows its own local guide; this guide only cross-references it.
