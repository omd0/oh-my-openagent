# senpi-desktop-engine - Binary Acquisition and ABI Boundary

**Generated:** 2026-11-17. **Score:** 10; distinct domain: locating and safely launching the Rust desktop engine.

## OVERVIEW

Private TypeScript package locating, acquiring, and handshaking with the desktop engine binary without implementing desktop behavior.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public API | `src/index.ts` | Locator, acquisition, handshake, typed refusals |
| Search installed candidates | `src/locator.ts` | Runtime payload, executable sidecar, package prebuild, dev build |
| Acquire a release | `src/acquire.ts` | Host/version checks, SHA-256, cache generations, launch |
| Validate checksum text | `src/checksums.ts` | Strict release-asset checksum parsing |
| Verify release identity | `src/release-signature.ts` | Signed permission-bearing release predicate |
| Preserve launch pathname | `src/stable-launch.ts` | SQLite lock, verified staging, atomic replacement, synchronous spawn |
| Check ABI/protocol | `src/handshake.ts` | engine.hello over --stdio and typed mismatch errors |
| Classify launch refusals | `src/launch-refusal.ts` | User-facing message/action and protocol-safe refusal parsing |
| Map release hosts | `src/release-assets.ts` | Known asset names and checksum asset |
| Expose sidecar metadata | `bunshin/` | Descriptor, declaration, desktop capability manifest |
| Test binary behavior | `test/`, `test/support/engine.ts` | Vitest, production locator, conformance replay |
| Review packaging proof | `README.md` | Embedded signed capture helper and macOS acceptance requirements |

## CONVENTIONS

- Runtime workspace imports may reach only desktop-protocol; no Pi/Senpi harness or shared utility dependency.
- Locator order includes OMO_PACKAGE_DIR first when set, then compiled sidecar, package prebuild, and target/release dev candidate.
- Quarantined candidates are refused except a contained compiled sidecar matching the install's shipped checksum; never clear the attribute.
- Explicit host libc controls acquisition; do not re-decide it from the running process.
- Doctor inspects installed/cache candidates with downloads disabled.
- Acquire anew for each spawn; stable pathname alone does not identify a release generation.
- macOS stable launch verifies release identity and digest while holding its cross-process SQLite lock through synchronous spawn.
- Local/ad-hoc builds must never replace the permission-bearing release executable.
- Handshake requires both ENGINE_ABI and PROTOCOL_VERSION from desktop-protocol.
- Tests use Vitest rather than Bun's test runner; source uses tabs and semicolons.
- Signed embedded capture-helper proof checks signature/Team ID, TCC attribution, modern capture fields, and legacy fallbacks; embedding alone proves none of these.

## ANTI-PATTERNS

- Never download a missing engine during doctor, silently clear quarantine, or promote an unverified local build to stable release state.
- Never show stack traces as user-facing launch errors; hosts render message and action.
- Never classify malformed multibyte refusal records as legacy refusals.
- Never skip engine-location failures in conformance tests or substitute a stub for the real located binary.

## CHECKS

- `bun run --cwd packages/senpi-desktop-engine test`
- `bun run --cwd packages/senpi-desktop-engine typecheck`
- Conformance replay uses desktop-core's fixture corpus and the production-located engine.
