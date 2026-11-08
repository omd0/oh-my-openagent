import { sanitizeTerminalText } from "./format/sanitize"
import { padVisible, truncateVisible, visibleWidth } from "./format/truncate"
import { duration } from "./format/units"
import type { DagGraphNode } from "./dag-graph"
import type { PanelColor } from "./types"

/** One coloured run of text. Node boxes carry a border colour and a content colour per line. */
export interface DagSegment {
  readonly text: string
  readonly color?: PanelColor
}

export type DagLine = readonly DagSegment[]

interface StateStyle {
  readonly label: string
  readonly glyph: string
  readonly color: PanelColor
}

const STATE_STYLE: Readonly<Record<string, StateStyle>> = {
  pending: { label: "pending", glyph: "○", color: "dim" },
  scheduled: { label: "scheduled", glyph: "◷", color: "muted" },
  blocked: { label: "blocked", glyph: "◌", color: "warning" },
  running: { label: "running", glyph: "●", color: "accent" },
  paused: { label: "paused", glyph: "‖", color: "warning" },
  completed: { label: "done", glyph: "✓", color: "success" },
  failed: { label: "failed", glyph: "✗", color: "error" },
  cancelled: { label: "cancelled", glyph: "-", color: "dim" },
  skipped: { label: "skipped", glyph: "·", color: "dim" },
}

const UNKNOWN_STYLE: StateStyle = { label: "unknown", glyph: "?", color: "muted" }
const SETTLED = new Set(["completed", "failed", "cancelled", "skipped"])

export function stateStyle(state: string): StateStyle {
  return STATE_STYLE[state] ?? UNKNOWN_STYLE
}

export interface DagNodeContext {
  readonly now: number
  /** Latest-wins live activity for a running node; sanitized here before it reaches a row. */
  readonly activity?: string
}

/** Elapsed time: a settled node freezes at its completion, a live one ticks against `now`. */
function elapsedText(node: DagGraphNode, now: number): string | undefined {
  const started = Date.parse(node.source.startedAt ?? "")
  if (!Number.isFinite(started)) return undefined
  const end = SETTLED.has(node.state) ? Date.parse(node.source.completedAt ?? "") : now
  if (!Number.isFinite(end)) return undefined
  return duration(Math.max(0, end - started))
}

/** `running · 1m02 · reading files`: state first, then whatever the node is doing. */
export function nodeStatusText(node: DagGraphNode, context: DagNodeContext): string {
  const parts = [stateStyle(node.state).label]
  if (node.source.attempt > 1) parts.push(`x${node.source.attempt}`)
  const elapsed = elapsedText(node, context.now)
  if (elapsed !== undefined) parts.push(elapsed)
  if (node.state === "running" && context.activity !== undefined) {
    const activity = sanitizeTerminalText(context.activity).trim()
    if (activity !== "") parts.push(activity)
  }
  return parts.join(" · ")
}

/** The dependencies a node waits on, by label. A node with none starts on its own. */
export function depsText(node: DagGraphNode, labelOf: (id: string) => string): string {
  if (node.deps.length === 0) return "starts first"
  return sanitizeTerminalText(`← ${node.deps.map(labelOf).join(", ")}`)
}

/** Cells before the title on a box's top edge: `╭─ ● `. */
export const TITLE_OFFSET = 5

/** The title as drawn on the top edge: cut to what fits between the glyph and the corner. */
export function nodeTitle(label: string, width: number): string {
  return truncateVisible(label, Math.max(0, width - TITLE_OFFSET - 2))
}

function framed(content: string, inner: number, border: PanelColor, text: PanelColor): DagLine {
  return [
    { text: "│ ", color: border },
    { text: padVisible(truncateVisible(content, inner), inner), color: text },
    { text: " │", color: border },
  ]
}

/**
 * A node as a four-line box: title with its glyph, status, dependencies. The box is exactly
 * `width` cells wide, so the caller can place boxes side by side or stack them.
 */
export function buildNodeBox(
  node: DagGraphNode,
  labelOf: (id: string) => string,
  context: DagNodeContext,
  width: number,
  options: { readonly selected: boolean },
): DagLine[] {
  const style = stateStyle(node.state)
  const border: PanelColor = options.selected ? "text" : style.color
  const inner = width - 4
  const head = `╭─ ${style.glyph} `
  // Top edge: head, title, one space, dashes, corner. The dashes take whatever the title leaves.
  const title = nodeTitle(node.label, width)
  const dashes = Math.max(0, width - TITLE_OFFSET - 2 - visibleWidth(title))
  const top = `${head}${title} ${"─".repeat(dashes)}╮`
  return [
    [{ text: top, color: border }],
    framed(nodeStatusText(node, context), inner, border, style.color),
    framed(depsText(node, labelOf), inner, border, "muted"),
    [{ text: `╰${"─".repeat(Math.max(0, width - 2))}╯`, color: border }],
  ]
}
