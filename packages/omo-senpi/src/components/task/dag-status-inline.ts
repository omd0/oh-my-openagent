import type { Theme } from "@code-yeongyu/senpi"

import type { DagStatusNode, DagStatusRunSnapshot } from "./dag-status-row-format"
import { threadState } from "./dag-subagent-service"
import type { LoaderStyle, ThreadView } from "./subagent-ui/types"
import { renderAgentTree, visibleAgentPaths } from "./subagent-ui/widget"

// Read-only presentation of the DAG run widget through the upstream agent widget. Each DAG node becomes
// one ThreadView (the same shape the manager tree reads), and the upstream renderer lays it out with its
// own badge, path, state, activity and metrics. Nothing here starts, steers or stops a node.

// runId -> nodeId -> latest live activity text. The live feed is latest-wins and is never accumulated.
export type DagLiveActivity = ReadonlyMap<string, ReadonlyMap<string, string>>

export function dagRunThreads(run: DagStatusRunSnapshot, activity: ReadonlyMap<string, string> | undefined, now: number): ThreadView[] {
  return run.nodes.map((node) => threadOf(run, node, activity, now))
}

// The path is the row identity inside one run's tree; a DAG node id is unique within its run.
function pathOf(nodeId: string): string {
  return `/root/${encodeURIComponent(nodeId)}`
}

function threadOf(run: DagStatusRunSnapshot, node: DagStatusNode, activity: ReadonlyMap<string, string> | undefined, now: number): ThreadView {
  const state = threadState(node.state)
  const live = state === "starting" || state === "running"
  const started = timeOf(node.startedAt)
  const completed = timeOf(node.completedAt)
  const created = timeOf(node.createdAt) ?? now
  const dependency = node.dependsOn[0]
  const route = node.route
  return {
    path: pathOf(node.id),
    parent: dependency === undefined ? "/root" : pathOf(dependency),
    owner: run.runId,
    type: route.kind === "agent" ? route.agent : route.category,
    ...(route.kind === "agent" && route.model !== undefined ? { model: route.model } : {}),
    state,
    task: `${node.label ?? node.id}${typeof node.attempt === "number" && node.attempt > 1 ? ` · x${node.attempt}` : ""}`,
    // The live activity line replaces the status while a node is active, as the manager tree does.
    status: node.dependsOn.length === 0 ? "no dependencies" : `after ${node.dependsOn.join(", ")}`,
    ...(live && activity?.get(node.id) !== undefined ? { summary: activity.get(node.id) } : {}),
    createdAt: created,
    updatedAt: completed ?? started ?? created,
    ...(live && started !== undefined ? { startedAt: started } : {}),
    ...(started !== undefined ? { lastStartedAt: started } : {}),
    ...(started !== undefined && completed !== undefined && completed >= started ? { elapsedMs: completed - started } : {}),
  }
}

// One upstream tree per live run, in the order the snapshots arrive. Rows are fitted to the width the
// host gives the widget, so a narrow terminal keeps the upstream truncation rules.
export function renderDagInline(
  runs: readonly DagStatusRunSnapshot[],
  activity: DagLiveActivity,
  theme: Theme,
  width: number,
  now: number,
  options: { readonly loaderStyle?: LoaderStyle; readonly decorate?: (thread: ThreadView, line: string, width: number) => string } = {},
): string[] {
  const lines: string[] = []
  for (const run of runs) {
    lines.push(
      ...renderAgentTree(dagRunThreads(run, activity.get(run.runId), now), width, theme, {
        showBrowserHint: false,
        animate: true,
        loaderStyle: options.loaderStyle ?? "circle",
        ...(options.decorate === undefined ? {} : { decorate: options.decorate }),
      }),
    )
  }
  return lines
}

// A worker the inline widget paints, identified by its owning run and node. Keyboard focus and click
// both resolve to these, so both reach the same worker the row shows.
export interface DagVisibleWorker {
  readonly runId: string
  readonly nodeId: string
}

// The painted worker rows in paint order. Each run contributes its own visible rows, so the list always
// follows what is on screen rather than a stale index.
export function visibleDagWorkers(runs: readonly DagStatusRunSnapshot[], now: number): DagVisibleWorker[] {
  return runs.flatMap((run) =>
    visibleAgentPaths(dagRunThreads(run, undefined, now)).map((path) => ({ runId: run.runId, nodeId: nodeIdOfPath(path) })),
  )
}

export function nodeIdOfPath(path: string): string {
  try {
    return decodeURIComponent(path.slice("/root/".length))
  } catch {
    return path
  }
}

function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
