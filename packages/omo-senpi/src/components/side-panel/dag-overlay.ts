import type { DagBridgeRunSnapshot } from "../task/dag-snapshot-payload"
import type { DagBinding } from "./dag-binding"
import type { DagLine } from "./dag-box"
import { layoutDagRun } from "./dag-graph"
import { buildOverlayContent, navigationOrder, type OverlayContent } from "./dag-overlay-rows"
import { sanitizeTerminalText } from "./format/sanitize"
import { padVisible, truncateVisible } from "./format/truncate"
import type { PopupComponent } from "./popups/text-popup"
import { clampScroll, popupBudget } from "./popups/viewport"
import type { PanelOverlayMouseEvent, PanelOverlayMouseResult, PanelTheme, PopupTui } from "./types"

const ESCAPE_KEYS = new Set(["\x1b", "q"])
// With the Kitty keyboard protocol Escape arrives as CSI 27 u, optionally with modifiers.
const KITTY_ESCAPE = /^\x1b\[27(;[\d;]*)?u$/
const NEXT_NODE = new Set(["\t", "n"])
const PREVIOUS_NODE = new Set(["\x1b[Z", "p"])
const NEXT_RUN = "r"
const SCROLL_STEPS: Readonly<Record<string, number>> = {
  "\x1b[B": 1,
  j: 1,
  "\x1b[A": -1,
  k: -1,
  "\x1b[6~": 10,
  "\x1b[5~": -10,
}
const HINT = "tab/n node · shift-tab/p back · r run · ↑↓ scroll · esc close"

export interface DagOverlayOptions {
  readonly binding: DagBinding
  readonly now: () => number
  readonly close: () => void
  readonly runId?: string
  readonly nodeId?: string
}

interface Current {
  readonly run: DagBridgeRunSnapshot
  readonly runCount: number
  readonly runIndex: number
  readonly order: readonly string[]
  readonly selectedId?: string
}

/**
 * The DAG overlay: the full graph with a selectable node, its details under the graph, and the
 * same frame and close keys as the other viewers. Every paint reads the live feed, so the open
 * overlay follows the run as it progresses. Selection is kept by node id, so a repaint never
 * moves the cursor onto a different node.
 */
export function createDagOverlay(tui: PopupTui, theme: PanelTheme | undefined, options: DagOverlayOptions): PopupComponent {
  let runId = options.runId
  let nodeId = options.nodeId
  let scroll = 0
  // Scroll to the selection on the next paint: on open, and whenever the selection moves.
  let reveal = true

  const current = (): Current | undefined => {
    const runs = options.binding.runs()
    const runIndex = Math.max(0, runs.findIndex((run) => run.runId === runId))
    const run = runs[runIndex]
    if (run === undefined) return undefined
    runId = run.runId
    const result = layoutDagRun(run)
    const order = navigationOrder(result, run)
    const running = order.find((id) => run.nodes.some((node) => node.id === id && node.state === "running"))
    const selectedId = nodeId !== undefined && order.includes(nodeId) ? nodeId : (running ?? order[0])
    nodeId = selectedId
    return { run, runCount: runs.length, runIndex, order, selectedId }
  }

  const contentFor = (view: Current, width: number): OverlayContent => {
    const result = layoutDagRun(view.run)
    return buildOverlayContent(
      {
        run: view.run,
        result,
        ...(view.selectedId === undefined ? {} : { selectedId: view.selectedId }),
        activity: (id) => options.binding.activity(view.run.runId, id),
        now: options.now(),
      },
      width,
    )
  }

  const move = (delta: number): void => {
    const view = current()
    if (view === undefined || view.order.length === 0) return
    const index = Math.max(0, view.order.indexOf(view.selectedId ?? ""))
    nodeId = view.order[(index + delta + view.order.length) % view.order.length]
    reveal = true
  }

  const nextRun = (): void => {
    const view = current()
    if (view === undefined) return
    const runs = options.binding.runs()
    const next = runs[(view.runIndex + 1) % runs.length]
    if (next === undefined) return
    runId = next.runId
    nodeId = undefined
    scroll = 0
    reveal = true
  }

  const scrollBy = (rows: number): void => {
    if (rows === 0) return
    // The upper bound needs the body length and the row budget, which only the paint knows.
    scroll = Math.max(0, scroll + rows)
    reveal = false
    tui.requestRender()
  }

  return {
    render(width: number): string[] {
      const budget = popupBudget(tui.terminal?.rows ?? 24, 0.9)
      const inner = Math.max(10, width - 4)
      const view = current()
      const content: OverlayContent = view === undefined ? { lines: [[{ text: "No DAG runs in this session.", color: "muted" }]] } : contentFor(view, inner)
      if (reveal && content.selected !== undefined) {
        scroll = content.selected.start
        reveal = false
      }
      scroll = clampScroll(scroll, content.lines.length, budget.body)
      const border = "─".repeat(Math.max(0, width - 2))
      const title = view === undefined ? "DAG" : `DAG · ${sanitizeTerminalText(view.run.name)}`
      const hint = view === undefined ? "esc close" : `${view.runIndex + 1}/${view.runCount} runs · ${HINT}`
      const lines: string[] = [paint(theme, "dim", `┌${border}┐`), frame(theme, inner, [{ text: truncateVisible(title, inner), color: "accent" }])]
      for (const line of content.lines.slice(scroll, scroll + budget.body)) lines.push(frame(theme, inner, line))
      lines.push(frame(theme, inner, [{ text: truncateVisible(hint, inner), color: "dim" }]))
      lines.push(paint(theme, "dim", `└${border}┘`))
      // Exactly the budget: one row more and the host would slice the closing border off.
      return lines.slice(0, budget.total)
    },

    handleInput(data: string): void {
      if (ESCAPE_KEYS.has(data) || KITTY_ESCAPE.test(data)) {
        options.close()
        return
      }
      if (NEXT_NODE.has(data)) move(1)
      else if (PREVIOUS_NODE.has(data)) move(-1)
      else if (data === NEXT_RUN) nextRun()
      else {
        const step = SCROLL_STEPS[data]
        if (step !== undefined) scrollBy(step)
        return
      }
      tui.requestRender()
    },

    scrollBy,

    // The host's native overlay path: a claimed wheel moves this overlay and never the layout behind it.
    handleMouse(event: PanelOverlayMouseEvent): PanelOverlayMouseResult | undefined {
      if (event.type !== "wheel" || event.wheelDelta === undefined || !Number.isFinite(event.wheelDelta)) return undefined
      scrollBy(Math.trunc(event.wheelDelta))
      return { handled: true }
    },

    invalidate(): void {
      // Every paint reads the feed again.
    },
  }
}

/** One framed row: `│ content │`, with each segment painted in its own colour. */
function frame(theme: PanelTheme | undefined, inner: number, line: DagLine): string {
  const painted = line.map((segment) => paint(theme, segment.color, segment.text)).join("")
  const fitted = padVisible(truncateVisible(painted, inner), inner)
  return `${paint(theme, "dim", "│")} ${fitted} ${paint(theme, "dim", "│")}`
}

function paint(theme: PanelTheme | undefined, color: string | undefined, text: string): string {
  return theme !== undefined && color !== undefined ? theme.fg(color, text) : text
}
