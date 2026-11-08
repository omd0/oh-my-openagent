# Provenance: pi-subagent-manager UI (vendored)

- Upstream: `pi-subagent-manager` 1.7.0, MIT License, `Copyright (c) 2026 pi-subagent contributors`.
- Repository: https://github.com/championswimmer/pi-subagent-manager
- npm tarball `pi-subagent-manager-1.7.0.tgz`, sha256 `d74e6152807ae1c8d10dc6dca476ff80bed5b7c9af2c85076f70ee7eafa11283`.
- `LICENSE` here is byte-identical to upstream `LICENSE` (sha256 `bd5e387c5e35aea68e23b642ff914193b1266c64652da1ab04c6dc94e581ecc4`).

## Vendored files and their upstream source (`package/src/...`)

| Here | Upstream | Change |
| --- | --- | --- |
| `thread-tree.ts` | `ui/thread-tree.ts` | `ThreadView` imported from `./types`. Otherwise verbatim. |
| `dialog.ts` | `ui/dialog.ts` | Host package specifier `@earendil-works/pi-coding-agent` becomes `@code-yeongyu/senpi` (the build loader alias of the same runtime). Otherwise verbatim. |
| `agent-loader.ts` | `ui/agent-loader.ts` | Imports point to `./types`. Otherwise verbatim. |
| `transcript-tool.ts` | `ui/transcript-tool.ts` | Host package specifier as in `dialog.ts`. The PowerShell renderer is dropped: the host exports no `createPowerShellToolDefinition`, so PowerShell tool rows fall back to the generic bounded renderer. Otherwise verbatim. |
| `live-agent-view.ts` | `ui/live-agent-view.ts` | `AgentMessage` and the service types come from `./types`; `pi-agent-core` import removed; helper imports point to `./ui-helpers`. Markdown styling is adapted from the host `Theme` passed to the view instead of importing the Senpi runtime entry. |
| `ui-helpers.ts` | `ui/ui.ts` lines 54 to 157 and `prefs/config.ts` `AGENT_COLORS` | Extracted helpers and palette. The inline renderer is imported separately as `widget.ts`; engine-dependent pickers, editors and spawn code are not vendored. |
| `widget.ts` | `ui/ui.ts` (`renderAgentTree` and its row helpers) | Imports point to local modules. The additive row-decoration hook and exported visible-row projection are documented below; the upstream presentation is reused for both inline task and DAG widgets. |
| `status-ui.ts` | `ui/status-ui.ts` lines 1 to 383 | Only the `StatusDialog` tree class and its pure helpers are kept. Changes: imports reduced to what the tree uses; the tree footer drops "Ctrl+C stop all"; the Ctrl+C branch and its `stopAll` method are removed (DAG nodes have no stop action). The navigation-only footer string on the old `navigation` branch is kept verbatim in a branch this adapter never reaches. The Actions menu, `AgentNavigationController`, `showAgentDialog`, `showAgentStatus` and `showAgentTree` are not vendored (they need the agent engine). |
| `types.ts` | `types.ts` | Subset: view, transcript and service shapes. `AgentMessage` is a structural type because the host does not export it. Engine types (drivers, managers, spawn options) are not vendored. |

## Host substitutions (no new dependency)

- `@earendil-works/pi-coding-agent` to `@code-yeongyu/senpi`. Build loader aliases map both names to the host (`plugin/scripts/build-extension-core.mjs`, `SENPI_LOADER_ALIASES`). `Theme` remains a type-only import; the view adapts the runtime `Theme` instance supplied by the host into the `MarkdownTheme` expected by pi-tui, avoiding a runtime import from Senpi's main entry. Verified runtime exports: `ToolExecutionComponent`, `initTheme`, `create{Read,Bash,Edit,Write,Grep,Find,Ls}ToolDefinition (PowerShell is NOT exported by the host and is not verified; its renderer is dropped)`, `ExtensionContext`, `KeybindingsManager`.
- `@earendil-works/pi-tui` is used unchanged; it is an existing omo-senpi dependency and the build alias.
- `@earendil-works/pi-agent-core`: type-only use in upstream; replaced by the structural `AgentMessage` in `./types`.

## Additive changes to vendored widget code

- `widget.ts` (from `ui/ui.ts`): `AgentWidgetRenderOptions.decorate` (an optional per-row hook, applied after the row's width is fitted; task and DAG widgets use it for the selection marker and worker link) and `export visibleAgentPaths` (the same takeWidgetRows budget, so keyboard and click targets match the painted rows).
- `ui-helpers.ts`: `agentPath` is exported (one keyword), because `widget.ts` uses it.
- `ui-helpers.ts`: `threadMetrics` omits the ↑/↓ token segment when both counters are unknown (undefined), so an unmeasured row never reads as a measured zero. The duration and cost segments are unchanged.

## Mechanical text adaptation (copied UI strings)

Seven em-dash characters in authored UI copy (`live-agent-view.ts` 5, `status-ui.ts` 1, `transcript-tool.ts` 1) are replaced with an ASCII hyphen and the surrounding spacing is kept. This follows the repository copy rule. No layout, key or behaviour changes. The upstream wording is otherwise unchanged.

## Not used

Upstream agent engine (drivers, manager, spawn, model and tool editors, settings, cost footer, import picker) is not vendored and not started.
