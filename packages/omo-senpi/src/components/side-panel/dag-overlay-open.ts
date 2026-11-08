import type { DagBinding } from "./dag-binding"
import type { PanelCommandContext } from "./commands"
import { createDagOverlay } from "./dag-overlay"
import { layoutDagRun } from "./dag-graph"
import { sanitizeTerminalText } from "./format/sanitize"
import { OVERLAY_OPTIONS } from "./popups/open"
import type { PanelOverlayUi } from "./types"

export interface DagOpenTarget {
  readonly runId?: string
  readonly nodeId?: string
}

/**
 * Opens the DAG overlay focused on a run, or on one of its nodes. A host without the overlay seam
 * gets the same graph as plain text in a notification, so the content is never lost.
 *
 * The overlay is tied to its binding's session: when that session is disposed (switch, shutdown),
 * the overlay closes and its wheel capture is released at once, rather than when the host gets
 * around to resolving `ui.custom`.
 */
export async function openDagOverlay(
  ui: PanelOverlayUi,
  binding: DagBinding,
  now: () => number,
  target: DagOpenTarget,
): Promise<void> {
  if (binding.isDisposed()) return
  if (ui.custom === undefined) {
    ui.notify(plainGraph(binding), "info")
    return
  }
  let closed = false
  let closeOverlay: (() => void) | undefined
  const releaseDispose = binding.onDispose(() => {
    closeOverlay?.()
  })
  try {
    await ui.custom((tui, theme, _keybindings, done) => {
      closeOverlay = () => {
        if (closed) return
        closed = true
        done(undefined)
      }
      const popup = createDagOverlay(tui, theme, {
        binding,
        now,
        close: () => closeOverlay?.(),
        ...(target.runId === undefined ? {} : { runId: target.runId }),
        ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
      })
      // The session may have ended between the open and this factory call; close on the next tick.
      if (binding.isDisposed()) queueMicrotask(() => closeOverlay?.())
      return popup
    }, OVERLAY_OPTIONS)
  } finally {
    closed = true
    releaseDispose()
  }
}

/** `/side-panel-dag`: the first live run, or the most recent one when none is live. */
export async function runDagCommand(
  deps: { readonly binding: () => DagBinding | undefined; readonly now: () => number; readonly mounted: () => boolean },
  ctx: PanelCommandContext,
): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  const binding = deps.binding()
  if (!deps.mounted() || binding === undefined) {
    ui.notify("The side panel is off in this session.", "info")
    return
  }
  if (binding.runs().length === 0) {
    ui.notify("No DAG runs in this session.", "info")
    return
  }
  await openDagOverlay(ui, binding, deps.now, {})
}

/**
 * The text fallback. Every piece is untrusted run data (names, states, labels, ids), so each line
 * is cleaned as a whole before it reaches the notification.
 */
function plainGraph(binding: DagBinding): string {
  const runs = binding.runs()
  if (runs.length === 0) return "No DAG runs in this session."
  return runs
    .map((run) => {
      const result = layoutDagRun(run)
      const header = sanitizeTerminalText(`${run.name} (${run.status})`)
      if (!result.ok) return [header, sanitizeTerminalText(result.error)].join("\n")
      const lines = result.graph.nodes.map((node) => {
        const after =
          node.deps.length === 0
            ? "starts first"
            : `after ${node.deps.map((id) => sanitizeTerminalText(result.graph.byId.get(id)?.label ?? id)).join(", ")}`
        return sanitizeTerminalText(`  ${node.label}: ${node.state} (${after})`)
      })
      return [header, ...lines].join("\n")
    })
    .join("\n\n")
}
