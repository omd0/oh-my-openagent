# senpi-desktop-tool

**Generated:** 2026-11-17. **Score:** 12; distinct domain: computer tool registration, approval tiers, and session activation.

## OVERVIEW

Structural TypeScript integration exposes `computer`, `computer_actions`, settings, and the user-facing `/computer` command over desktop-service.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Choose an import entry | `src/index.ts`, `src/registration.ts` | Full runtime versus lightweight registration surface |
| Execute computer calls/runs | `src/tool.ts` | Argument narrowing, activation, service invocation |
| Publish the model-facing tool | `src/tool-definition.ts`, `src/params.ts` | Flat root schema and search exposure |
| Evaluate approval tier | `src/permission.ts` | `computerTier`, `computerPermissionParser` |
| Maintain activation state | `src/activation.ts`, `src/session.ts` | Shared `ComputerHandle` and run snapshots |
| Handle user commands | `src/command.ts` | Enable, status, stop/resume, cursor display |
| Parse current settings | `src/settings.ts` | Closed keys and platform defaults |
| Translate CUA actions/errors | `src/cua-actions.ts`, `src/cua-adapter.ts`, `src/cua-errors.ts` | Batched actions and recovery codes |
| Exercise tool/permission behavior | `test/execute.test.ts`, `test/permission.test.ts`, `test/control.test.ts` | Vitest suites |

## CONVENTIONS

- Imports use desktop-protocol, desktop-prelude, desktop-service, and TypeBox; host APIs are supplied structurally.
- The published parameter schema is one flat object; execution narrows it to the exact action branch before starting an engine.
- Settings are read through a function on every use; session overrides remain in memory.
- `call` and `run` share `runComputerCode`; calls classify their chain before activation.
- Tool execution returns structured `COMPUTER_*` failures for the covered permission and launch-context cases.
- `tool_call` is the permission evaluation point; execution does not evaluate rules or display a second approval prompt.
- An always approval covers only its own read/exec tier.
- The run facade receives host tool execution through the injected `executeTool` port.
- Tests run with Vitest from `test/`, outside the root Bun collection.

## ANTI-PATTERNS

- Never add a model-callable resume action; stop/resume remains the user command surface.
- Never start an engine for status, or let cursor display changes activate/rearm input or alter a control grant.
- Never persist session enable/cursor overrides.
- Never let malformed input or an unknown helper chain earn read approval.
- Never steal a control grant or repeat an action unchanged after `UserIntervened`.
- Never claim availability before querying capabilities, or work around a missing OS permission.
- Do not rely on the README's absent `test/coding-agent-contract.ts` or desktop-boundary script as an existing verification gate.

## COMMANDS

```bash
bun run --cwd packages/senpi-desktop-tool test
bun run --cwd packages/senpi-desktop-tool typecheck
```
