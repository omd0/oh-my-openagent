import type { DagBridgeRunSnapshot } from "../task/dag-snapshot-payload"
import { DAG_OVERLAY_MIN_BOX_COLUMNS } from "./constants"
import { buildNodeBox, depsText, nodeStatusText, stateStyle, type DagLine, type DagSegment } from "./dag-box"
import { layoutDagRun, type DagGraph, type DagGraphNode, type DagGraphResult } from "./dag-graph"
import { sanitizeTerminalText } from "./format/sanitize"
import { padVisible, truncateVisible, wrapVisible } from "./format/truncate"
import type { PanelColor } from "./types"

const GAP = 2
const BOX_MAX = 34
const BOX_HEIGHT = 4
const PROMPT_ROWS = 6
const LABEL_COLUMNS = 8

export interface OverlayContentInput {
  readonly run: DagBridgeRunSnapshot
  readonly result: DagGraphResult
  readonly selectedId?: string
  readonly activity: (nodeId: string) => string | undefined
  readonly now: number
}

export interface OverlayContent {
  readonly lines: readonly DagLine[]
  /** Line range of the selected node's box, so the viewer can scroll it into view. */
  readonly selected?: { readonly start: number; readonly end: number }
}

/** Node ids in the order Tab walks them: layer by layer, as drawn. */
export function navigationOrder(result: DagGraphResult, run: DagBridgeRunSnapshot): readonly string[] {
  return result.ok ? result.graph.layers.flat().map((node) => node.id) : run.nodes.map((node) => node.id)
}

/**
 * The full graph for the overlay: a header, layered boxes side by side, connectors on the real
 * edges between neighbouring rows, then the selected node's details. Boxes are coloured per
 * segment, which a single column row cannot express.
 */
export function buildOverlayContent(input: OverlayContentInput, width: number): OverlayContent {
  const lines: DagLine[] = [headerLine(input.run, width)]
  if (!input.result.ok) {
    lines.push([{ text: truncateVisible(input.result.error, width), color: "error" }])
    return { lines }
  }
  const graph = input.result.graph
  const perRow = columnsPerRow(graph, width)
  const boxWidth = Math.min(BOX_MAX, Math.floor((width - GAP * (perRow - 1)) / perRow))
  const labelOf = (id: string): string => sanitizeTerminalText(graph.byId.get(id)?.label ?? id)
  let selected: OverlayContent["selected"]
  let previous: { readonly nodes: readonly DagGraphNode[]; readonly centers: ReadonlyMap<string, number> } | undefined

  for (const chunk of chunksOf(graph, perRow)) {
    const span = chunk.length * boxWidth + GAP * (chunk.length - 1)
    const left = Math.max(0, Math.floor((width - span) / 2))
    const centers = new Map(chunk.map((node, index) => [node.id, left + index * (boxWidth + GAP) + Math.floor(boxWidth / 2)] as const))
    if (previous !== undefined) lines.push(...connectors(previous, { nodes: chunk, centers }, graph, width))
    const boxes = chunk.map((node) => {
      const activity = node.state === "running" ? input.activity(node.id) : undefined
      return buildNodeBox(node, labelOf, { now: input.now, ...(activity === undefined ? {} : { activity }) }, boxWidth, {
        selected: node.id === input.selectedId,
      })
    })
    const start = lines.length
    for (let row = 0; row < BOX_HEIGHT; row++) {
      const segments: DagSegment[] = [{ text: " ".repeat(left) }]
      boxes.forEach((box, index) => {
        if (index > 0) segments.push({ text: " ".repeat(GAP) })
        segments.push(...(box[row] ?? []))
      })
      lines.push(segments)
    }
    if (chunk.some((node) => node.id === input.selectedId)) selected = { start, end: start + BOX_HEIGHT }
    previous = { nodes: chunk, centers }
  }

  const node = input.selectedId === undefined ? undefined : graph.byId.get(input.selectedId)
  if (node !== undefined) lines.push(...detailLines(node, labelOf, input, width))
  return selected === undefined ? { lines } : { lines, selected }
}

function headerLine(run: DagBridgeRunSnapshot, width: number): DagLine {
  const done = run.nodes.filter((node) => node.state === "completed").length
  const running = run.nodes.filter((node) => node.state === "running").length
  const failed = run.nodes.filter((node) => node.state === "failed").length
  const counts = [`${done}/${run.nodes.length} done`, running > 0 ? `${running} running` : "", failed > 0 ? `${failed} failed` : ""]
    .filter((part) => part !== "")
    .join(" · ")
  return [{ text: truncateVisible(sanitizeTerminalText(`${run.name}  ${run.status} · ${counts}`), width), color: "accent" }]
}

/** Columns that fit a row of boxes, at least one, never narrower than the box floor. */
function columnsPerRow(graph: DagGraph, width: number): number {
  const widest = graph.layers.reduce((max, layer) => Math.max(max, layer.length), 1)
  return Math.max(1, Math.min(widest, Math.floor((width + GAP) / (DAG_OVERLAY_MIN_BOX_COLUMNS + GAP))))
}

/** Nodes in display order, cut into rows of `perRow`. A layer that is wider than a row wraps. */
function chunksOf(graph: DagGraph, perRow: number): DagGraphNode[][] {
  const chunks: DagGraphNode[][] = []
  for (const layer of graph.layers) {
    for (let index = 0; index < layer.length; index += perRow) chunks.push(layer.slice(index, index + perRow))
  }
  return chunks
}

/**
 * Two dim rows joining a box row to the next one, drawn only for edges between the two rows.
 * An edge that skips a row has no line here; its target still lists it under its dependencies.
 */
function connectors(
  previous: { readonly nodes: readonly DagGraphNode[]; readonly centers: ReadonlyMap<string, number> },
  next: { readonly nodes: readonly DagGraphNode[]; readonly centers: ReadonlyMap<string, number> },
  graph: DagGraph,
  width: number,
): DagLine[] {
  const edges: Array<readonly [number, number]> = []
  for (const target of next.nodes) {
    const end = next.centers.get(target.id)
    for (const dep of graph.byId.get(target.id)?.deps ?? []) {
      const start = previous.centers.get(dep)
      if (start !== undefined && end !== undefined) edges.push([start, end] as const)
    }
  }
  if (edges.length === 0) return []
  const stem = Array.from({ length: width }, () => " ")
  const bar = Array.from({ length: width }, () => " ")
  for (const [start] of edges) stem[start] = "│"
  for (const [start, end] of edges) {
    for (let x = Math.min(start, end); x <= Math.max(start, end) && x < width; x++) {
      if (bar[x] === " ") bar[x] = "─"
    }
  }
  for (const [start] of edges) bar[start] = "┴"
  for (const [, end] of edges) bar[end] = "▼"
  return [[{ text: stem.join("").trimEnd(), color: "dim" }], [{ text: bar.join("").trimEnd(), color: "dim" }]]
}

/** The selected node in full: what it waits on, how far it got, why it failed, what it was asked. */
function detailLines(node: DagGraphNode, labelOf: (id: string) => string, input: OverlayContentInput, width: number): DagLine[] {
  const style = stateStyle(node.state)
  const activity = node.state === "running" ? input.activity(node.id) : undefined
  const rows: DagLine[] = [[{ text: "" }], [{ text: truncateVisible(node.label, width), color: "accent" }]]
  // Every detail row passes through here, so the sanitization boundary covers label and value alike.
  const field = (label: string, value: string, color: PanelColor): DagLine => [
    { text: truncateVisible(`${padVisible(sanitizeTerminalText(label), LABEL_COLUMNS)}${sanitizeTerminalText(value)}`, width), color },
  ]
  rows.push(field("state", nodeStatusText(node, { now: input.now, ...(activity === undefined ? {} : { activity }) }), style.color))
  rows.push(field("after", node.deps.length === 0 ? "nothing, starts first" : depsText(node, labelOf).replace(/^← /, ""), "muted"))
  rows.push(field("id", node.id, "dim"))
  if (node.source.taskId !== undefined) rows.push(field("task", sanitizeTerminalText(node.source.taskId), "dim"))
  const error = node.source.error
  if (error !== undefined) {
    wrapVisible(sanitizeTerminalText(`${error.code}: ${error.message}`), Math.max(1, width - LABEL_COLUMNS)).forEach((part, index) => {
      rows.push(field(index === 0 ? "error" : "", part, "error"))
    })
  }
  const prompt = wrapVisible(sanitizeTerminalText(node.source.prompt), Math.max(1, width - LABEL_COLUMNS))
  prompt.slice(0, PROMPT_ROWS).forEach((part, index) => {
    const more = index === PROMPT_ROWS - 1 && prompt.length > PROMPT_ROWS ? "…" : ""
    rows.push(field(index === 0 ? "prompt" : "", `${part}${more}`, "text"))
  })
  return rows
}
