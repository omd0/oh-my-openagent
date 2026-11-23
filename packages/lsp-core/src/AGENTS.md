# lsp-core source

## OVERVIEW

Implements client residency, wire transport, safe mutations, and direct/MCP tool execution.

**Score:** 11; distinct domain: LSP runtime internals and executable contract tests.

## WHERE TO LOOK

| Task | Location | Evidence |
|------|----------|----------|
| Client lifecycle regressions | `lsp/manager*.test.ts` | Ref counts, aborts, residency, and respawn budgets |
| Transport and spawn security | `lsp/transport*.ts`, `lsp/process.ts` | Spawn environment and protocol boundaries |
| Workspace selection | `lsp/client-wrapper.ts`, `lsp/workspace-markers.ts` | Git root wins over nearer package markers |
| Read access outside cwd | `lsp/outside-context-workspace.ts` | Separate from mutation containment |
| Transactional edits | `lsp/workspace-edit-*.ts` | Parsing, snapshots, fingerprints, simulation, commit |
| Mutation coordination | `lsp/workspace-mutation-controller.ts` | Lease validation and concurrent writer protection |
| Bun directory diagnostics | `lsp/directory-diagnostics.ts` | Project checker route and cancellation |
| Formatting writes | `tools/format.ts`, `lsp/format-document.ts` | Server edits applied through shared workspace machinery |
| Tool compatibility | `tool-surface.test.ts` | Direct dispatch and MCP surface agree |
| Protocol version | `mcp-protocol-pin.test.ts` | Machine-consumed MCP contract |
| Post-edit diagnostics | `post-edit/` | Concurrency caps and not-configured caching |

## CONVENTIONS

- Keep the tab-indented, semicolon-terminated Node ESM style used by adjacent modules.
- Most behavior tests sit beside implementation; `lsp/fixtures/` contains executable probe servers.
- Line arguments exposed by navigation tools are 1-based; character arguments are 0-based.
- `findWorkspaceRoot` remembers the nearest package marker but prefers a `.git` ancestor within the request cwd.
- Tool installation decisions are persisted independently of server detection.

## ANTI-PATTERNS

- Do not turn readable external-file support into permission to mutate external paths.
- Do not let formatting bypass the same edit transaction used by rename.
- Do not leave a cancelled cold acquisition resident or retain its pending waiter.
