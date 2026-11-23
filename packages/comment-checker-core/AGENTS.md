# comment-checker-core — apply-patch Parser + Checker Runner (Core)

**Generated:** 2026-11-17. **Score:** 9; distinct domain: apply-patch parsing and the injected checker process protocol.

## OVERVIEW

Two responsibilities: (1) parse LLM apply-patch edits into structured `CheckerEdit[]`, and (2) run the external `@code-yeongyu/comment-checker` binary to detect AI-slop comments in changed code. Spawn is dependency-injected (not `child_process.spawn`) so host adapters can drive the same core. Package: `@oh-my-opencode/comment-checker-core`.

## WHERE TO LOOK

| Export | Source | Role |
|--------|--------|------|
| `parseApplyPatchRequests(patch)` | `apply-patch-edits.ts` | parse `*** Add/Update/Delete File:` + `*** Move to:` protocol with `@@` context + `+`/`-` markers |
| `extractApplyPatchEdits(details, args?)` | `apply-patch-edits.ts` | high-level extractor (patch text OR metadata files) |
| `getApplyPatchMetadataFiles(details)` | `apply-patch-edits.ts` | read files from nested `details.files` / `result.files` / `metadata.files` |
| `resolveCommentCheckerBinary(input)` | `runner.ts` | locate binary via `createRequire(@code-yeongyu/comment-checker)` |
| `runCommentChecker(input, options)` | `runner.ts` | pipe `HookInput` JSON to stdin, read stdout/stderr, return `CheckResult` |
| `COMMENT_CHECKER_VERSION_MARKER`, `isCachedCommentCheckerCurrent(cacheDir)`, `recordCachedCommentCheckerRelease(cacheDir)` | `cached-release.ts` | version marker beside the binary in the shared cache slot; a missing or different marker means the cached checker is stale and must be re-downloaded (#8850) |
| release/package binary helpers | `release.ts`, `package-binary.ts` | select the release asset and resolve installed package payloads |
| types | `types.ts` | `CheckerEdit`, `HookInput`, `CheckResult`, `SpawnFn`/`SpawnProcess`/`SpawnSignal`, `ApplyPatchFileMetadata`, … |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`isRecord` from `utils/record-type-guard`).
- **Consumers:** OpenCode hooks, Codex component, Senpi component, and the native distribution share this runner/parser rather than implementing another checker protocol.

## NOTES

- **Exit-code contract:** `0` = clean, `2` = has comments. Any other exit code, a synchronous `spawn` throw, or a rejected `exited` (a spawn error such as EACCES / ENOEXEC) returns `{hasComments: false, message: "", failure: { exitCode, stderr }}` (`exitCode: null` when the checker never started; `stderr` trimmed to 500 chars, or the spawn error message). Callers that ignore `failure` keep the old "no comments" behavior; OmO Native uses it to warn once and go inert (#8850). A timeout still returns the plain empty result: a slow checker is not a broken one.
- **Spawn timeouts:** default 30s, 1s kill grace, SIGTERM→SIGKILL escalation.
- **`SpawnProcess` is an injected interface** — `stdin.send(input): Promise<void>` (write + close, settles once; the adapter owns every stdin `error` event so a checker that exits without reading cannot crash the host, #6396), `ReadableStream<Uint8Array>` stdout/stderr, `exited: Promise<number>` — never the Node `ChildProcess` type directly. A failed `send` kills the child and returns the empty result.
- **Spawn and stdin failures are contained:** nothing escapes as an unhandled error. A rejected `send` alone never reports comments (an undelivered exit `2` is empty); a spawn failure is reported through `failure` as above. An output stream that cannot be read never hides the exit outcome.
- **`HookInput` mirrors OpenCode's `tool.execute.before` input schema** exactly, so the same parser serves the Codex `PreToolUse`/`PostToolUse` adapters.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).

## ANTI-PATTERNS

- Never replace injected `SpawnProcess` with Node `ChildProcess`.
- Never remove the adapter's stdin error listener before the stream lifetime ends.
- Never report comments from a failed stdin send, even if the process exits with code `2`.

## COMMANDS

`bun run --cwd packages/comment-checker-core test` and `bun run --cwd packages/comment-checker-core typecheck`.
