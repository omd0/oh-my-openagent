import type { DagBridgeRunSnapshot } from "../../task/dag-snapshot-payload"
import { DAG_COLUMN_RUN_LIMIT, DAG_MIN_BOX_COLUMNS, DAG_SECTION_ROW_CAP, DAG_SECTION_ROW_FLOOR } from "../constants"
import { buildNodeBox, nodeStatusText, nodeTitle, stateStyle, TITLE_OFFSET } from "../dag-box"
import { layoutDagRun, type DagGraphNode } from "../dag-graph"
import { sanitizeTerminalText } from "../format/sanitize"
import { truncateVisible, visibleWidth } from "../format/truncate"
import type { PanelRow } from "../types"

export interface DagColumnInput {
  /** Live runs first; the builder draws the first few and counts the rest. */
  readonly runs: readonly DagBridgeRunSnapshot[]
  readonly activity: (runId: string, nodeId: string) => string | undefined
  readonly now: number
  /** Rows the section may take in total, including its own run headers. Anything below 0 takes none. */
  readonly rowCap: number
}

/**
 * The row budget for the graph, from the terminal height. A short terminal gets a floor that keeps
 * the graph useful without taking the column; a tall one gets the full cap. An unknown height keeps
 * the full cap, which is what the column had before it adapted.
 */
export function dagRowCap(terminalRows: number | undefined): number {
  if (terminalRows === undefined || !Number.isFinite(terminalRows) || terminalRows <= 0) return DAG_SECTION_ROW_CAP
  return Math.min(DAG_SECTION_ROW_CAP, Math.max(DAG_SECTION_ROW_FLOOR, Math.floor(terminalRows * 0.4)))
}

/**
 * The column's graph: each run's nodes as boxes stacked in dependency order. Every box lists its
 * true dependencies, and a node is indented by depth so the stack reads as a tree. One node per
 * row, so each row can carry its own click target. Connectors between boxes are not drawn here;
 * the overlay draws them. Output never exceeds the row cap, and the overflow line stays in it.
 */
export function buildDagRows(input: DagColumnInput, width: number): readonly PanelRow[] {
  const cap = Math.max(0, Math.floor(input.rowCap))
  if (width <= 0 || cap === 0 || input.runs.length === 0) return []
  const shown = input.runs.slice(0, DAG_COLUMN_RUN_LIMIT)
  const hidden = input.runs.length - shown.length
  // One row is held back for the "+N more runs" line whenever some runs are not drawn.
  const limit = hidden > 0 ? cap - 1 : cap
  const rows: PanelRow[] = []
  for (const [index, run] of shown.entries()) {
    const room = limit - rows.length
    // A separator is only worth its row when the run's header still fits behind it.
    const separator = index > 0 ? 1 : 0
    if (room < separator + 1) break
    if (separator === 1) rows.push({ text: "" })
    rows.push(...runRows(run, input, width, limit - rows.length))
  }
  if (hidden > 0 && rows.length < cap) {
    const next = input.runs[shown.length]
    rows.push({
      text: truncateVisible(`+${hidden} more runs · open graph`, width),
      color: "muted",
      action: { kind: "dag-run", runId: next?.runId ?? "" },
    })
  }
  return rows
}

/** Rows for one run, at most `budget`. A header is only emitted when there is room for it. */
function runRows(run: DagBridgeRunSnapshot, input: DagColumnInput, width: number, budget: number): PanelRow[] {
  if (budget <= 0) return []
  const runId = run.runId
  const done = run.nodes.filter((node) => node.state === "completed").length
  const out: PanelRow[] = [
    {
      text: truncateVisible(sanitizeTerminalText(`DAG  ${run.name}  ${done}/${run.nodes.length} ${run.status}`), width),
      color: "accent",
      action: { kind: "dag-run", runId },
    },
  ]
  if (budget === 1) return out
  const result = layoutDagRun(run)
  if (!result.ok) {
    out.push({ text: truncateVisible(result.error, width), color: "error", action: { kind: "dag-run", runId } })
    return out
  }
  const graph = result.graph
  const labelOf = (id: string): string => sanitizeTerminalText(graph.byId.get(id)?.label ?? id)
  const ordered = graph.layers.flat()
  for (const [index, node] of ordered.entries()) {
    const remaining = ordered.length - index
    const indent = Math.min(node.depth, 3) * 2
    const boxWidth = width - indent
    // A blank row separates a node from the one above it, so neighbouring boxes never share an edge.
    const gap = out.length > 1 ? 1 : 0
    const lines = (boxWidth >= DAG_MIN_BOX_COLUMNS ? 4 : 1) + gap
    // Keep one row back for the "+N more" line whenever nodes would be left over.
    const reserve = remaining > 1 ? 1 : 0
    if (out.length + lines > budget - reserve) {
      if (out.length < budget) {
        out.push({ text: truncateVisible(`+${remaining} more nodes · open graph`, width), color: "muted", action: { kind: "dag-run", runId } })
      }
      break
    }
    const activity = node.state === "running" ? input.activity(runId, node.id) : undefined
    const context = { now: input.now, ...(activity === undefined ? {} : { activity }) }
    if (gap === 1) out.push({ text: "" })
    out.push(...nodeRows(node, labelOf, context, boxWidth, indent, width, runId))
  }
  return out
}

function nodeRows(
  node: DagGraphNode,
  labelOf: (id: string) => string,
  context: { readonly now: number; readonly activity?: string },
  boxWidth: number,
  indent: number,
  width: number,
  runId: string,
): PanelRow[] {
  const action = { kind: "dag-node" as const, runId, nodeId: node.id }
  const pad = " ".repeat(indent)
  if (boxWidth < DAG_MIN_BOX_COLUMNS) {
    const style = stateStyle(node.state)
    const text = `${pad}${style.glyph} ${node.label} · ${nodeStatusText(node, context)}`
    return [{ text: truncateVisible(text, width), color: style.color, action }]
  }
  // Only the title is the click target: a link over the whole box underlines every border cell.
  const title = nodeTitle(node.label, boxWidth)
  const titleStart = indent + TITLE_OFFSET
  const titleSpan = { start: titleStart, end: titleStart + visibleWidth(title) }
  return buildNodeBox(node, labelOf, context, boxWidth, { selected: false }).map((line, index) => ({
    text: `${pad}${line.map((segment) => segment.text).join("")}`,
    // A box row is one colour in the column: the content colour on text lines, the border otherwise.
    color: line[1]?.color ?? line[0]?.color,
    ...(index === 0 ? { action, linkSpan: titleSpan } : {}),
  }))
}
