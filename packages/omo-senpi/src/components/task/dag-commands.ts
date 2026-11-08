import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

import type { SenpiExtensionAPI } from "../../extension/types"
import { createDagSubagentService, type DagWatchPort, type DagWatchSummary } from "./dag-subagent-service"
import { createWatchHolder, mountSubagentWatch, type WatchHolder, type WatchUi } from "./watch-mount"

const LIST_LIMIT = 20
const EMPTY_STATE = "No dag runs in this session."
const CRITICAL_MARKER = "*critical*"

// Structural mirrors of the dag domain contract (senpi-task/src/dag/types.ts), declared locally so
// the command stays a read-only consumer of whatever DagManager instance the extension wires in.
export type DagCommandRoute =
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "agent"; readonly agent: string; readonly model?: string }

export interface DagCommandNodeError {
  readonly code: string
  readonly message: string
}

export interface DagCommandNode {
  readonly id: string
  readonly label?: string
  readonly state: string
  readonly route: DagCommandRoute
  readonly dependsOn: readonly string[]
  readonly attempt: number
  readonly taskId?: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly error?: DagCommandNodeError
}

export interface DagCommandEdge {
  readonly from: string
  readonly to: string
}

export interface DagCommandWave {
  readonly index: number
  readonly nodeIds: readonly string[]
}

export interface DagCommandBottleneck {
  readonly nodeId: string
  readonly blockedCount: number
}

export interface DagCommandRunSnapshot {
  readonly runId: string
  readonly name: string
  readonly status: string
  readonly createdAt: string
  readonly nodes: readonly DagCommandNode[]
  readonly edges: readonly DagCommandEdge[]
  readonly waves: readonly DagCommandWave[]
  readonly criticalPath: readonly string[]
  readonly bottlenecks: readonly DagCommandBottleneck[]
  // One entry per accepted amendment; only the count is rendered. Absent means never amended.
  readonly amendHistory?: readonly unknown[]
}

export interface DagCommandRunCounts {
  readonly total: number
  readonly completed: number
  readonly running: number
  readonly failed: number
}

export interface DagCommandRunSummary {
  readonly runId: string
  readonly name: string
  readonly parentSessionId: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly counts: DagCommandRunCounts
}

// The resolved model lives on the task record a node attached to, never on the node itself.
export interface DagCommandTaskRecord {
  readonly model: string
  readonly resolved_model?: { readonly display: string }
}

// The read seam the command needs: session-scoped run list, per-run snapshot, task lookup.
export interface DagCommandManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly DagCommandRunSummary[]
  snapshot(runId: string, parentSessionId: string): DagCommandRunSnapshot
  taskRecord(taskId: string): DagCommandTaskRecord | undefined
}

interface DagCommandContext {
  readonly mode?: string
  readonly ui?: DagCommandUi
  readonly sessionManager?: { getSessionId(): string }
}

interface DagCommandUi extends WatchUi {
  select(title: string, options: string[]): Promise<string | undefined>
  confirm(title: string, message: string): Promise<boolean>
}

// The watch wiring is optional: a caller that passes only the read seam keeps the read-only /dag.
export interface DagWatchDeps {
  readonly port: DagWatchPort
  readonly stateDir: string
  // One overlay owner for the whole extension: /tasks watch and /dag watch share it, so only one watch is open.
  readonly holder?: WatchHolder
}

const WATCH_USAGE = "Usage: /dag watch [runId]"
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

export function registerDagCommands(pi: SenpiExtensionAPI, manager: DagCommandManager, watch?: DagWatchDeps): void {
  const holder: WatchHolder = watch?.holder ?? createWatchHolder()
  pi.registerCommand("dag", {
    description: "List dag runs, show one run's wave tree, or watch a run's nodes live (/dag watch [runId]).",
    handler: (args: string, ctx: DagCommandContext) => runDagCommand(manager, args, ctx, watch, holder),
  })
  // The open watch closes with its session, so no timer or terminal hook outlives the session.
  if (watch !== undefined) pi.on("session_shutdown", () => holder.current?.close())
}

async function runDagCommand(
  manager: DagCommandManager,
  args: string,
  ctx: DagCommandContext,
  watch: DagWatchDeps | undefined,
  holder: WatchHolder,
): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  const sessionId = ctx.sessionManager?.getSessionId()
  // Fail-closed: without a session id there is nothing to scope, so no run is queried.
  if (sessionId === undefined) {
    ui.notify(EMPTY_STATE, "info")
    return
  }
  const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0)
  if (tokens[0] === "watch") {
    await runDagWatch(watch, holder, tokens.slice(1), { ctx, ui, sessionId })
    return
  }
  const runId = tokens[0]
  if (runId === undefined) {
    renderList(manager, sessionId, ui)
    return
  }
  renderDetail(manager, runId, sessionId, ui)
}

// `/dag watch [runId]`: the run is looked up in this session's own list, so a foreign or unknown id is
// refused the same way for every caller. Without an id, a native picker lists the session's live runs.
async function runDagWatch(
  watch: DagWatchDeps | undefined,
  holder: WatchHolder,
  rest: readonly string[],
  scope: { readonly ctx: DagCommandContext; readonly ui: DagCommandUi; readonly sessionId: string },
): Promise<void> {
  const { ctx, ui, sessionId } = scope
  if (rest.length > 1) {
    ui.notify(`${WATCH_USAGE}. Pass one run id, or none to pick a live run.`, "warning")
    return
  }
  if (watch === undefined) {
    ui.notify("Live watching is not available in this session.", "warning")
    return
  }
  const interactive = ctx.mode === undefined || ctx.mode === "tui"
  if (!interactive || ui.custom === undefined) {
    ui.notify("Live watching needs the interactive terminal UI. Use /dag <runId> for the read-only node tree.", "info")
    return
  }
  if (holder.current !== undefined) {
    ui.notify("A dag watch is already open.", "info")
    return
  }
  // The slot is held while the picker is open, so a second /dag watch is refused and a session shutdown
  // during the picker cancels the pending mount instead of letting it open afterwards. Every exit
  // (refusal, cancel, throw, or handing the slot to the mount) goes through the one finally below.
  let cancelled = false
  const placeholder: { close(): void } = {
    close: () => {
      cancelled = true
    },
  }
  holder.current = placeholder
  const release = (): void => {
    if (holder.current === placeholder) holder.current = undefined
  }
  try {
    const listed = watch.port.list(sessionId)
    const requested = rest[0]
    let run: DagWatchSummary | undefined
    if (requested === undefined) {
      const live = listed.filter((entry) => !TERMINAL_RUN_STATUSES.has(entry.status))
      if (live.length === 0) {
        ui.notify("No live dag runs in this session. For ordinary task subagents use /tasks watch. /dag lists runs.", "info")
        return
      }
      const options = live.map((entry) => runOption(entry))
      const choice = await ui.select("Watch which run?", options)
      run = choice === undefined ? undefined : live[options.indexOf(choice)]
    } else {
      run = listed.find((entry) => entry.runId === requested)
      if (run === undefined) {
        ui.notify(`No dag run "${normalizeRendererText(requested)}" in this session.`, "warning")
        return
      }
    }
    // Re-check after the await: the session may have changed or shut down while the picker was open.
    // Nothing scoped to the old session is read or mounted past this point.
    if (run === undefined || cancelled || holder.current !== placeholder || ctx.sessionManager?.getSessionId() !== sessionId) return
    release()
    const service = createDagSubagentService({
      port: watch.port,
      runId: run.runId,
      parentSessionId: sessionId,
      stillBound: () => ctx.sessionManager?.getSessionId() === sessionId,
      stateDir: watch.stateDir,
    })
    await mountSubagentWatch(holder, {
      ui,
      service,
      parentId: sessionId,
      currentParentId: () => ctx.sessionManager?.getSessionId(),
    })
  } catch (error) {
    ui.notify(`Dag watch failed: ${normalizeRendererText(error instanceof Error ? error.message : String(error))}`, "error")
  } finally {
    // A no-op once the mount holds the slot: the mounted watch's own holder is never cleared from here.
    release()
  }
}

function runOption(summary: DagWatchSummary): string {
  return `${normalizeRendererText(summary.name)} (${normalizeRendererText(summary.runId)}) ${normalizeRendererText(summary.status)}`
}

function renderList(manager: DagCommandManager, sessionId: string, ui: DagCommandUi): void {
  const summaries = manager.list(sessionId, { limit: LIST_LIMIT })
  if (summaries.length === 0) {
    ui.notify(EMPTY_STATE, "info")
    return
  }
  ui.notify(summaries.map(summaryRow).join("\n"), "info")
}

function summaryRow(summary: DagCommandRunSummary): string {
  const counts = summary.counts
  const tokens = [`${normalizeRendererText(counts.completed.toString())}/${counts.total} done`]
  if (counts.running > 0) tokens.push(`${counts.running} running`)
  if (counts.failed > 0) tokens.push(`${counts.failed} failed`)
  return `${normalizeRendererText(summary.name)} (${normalizeRendererText(summary.runId)}) ${normalizeRendererText(summary.status)} ${tokens.join(", ")}`
}

function renderDetail(manager: DagCommandManager, runId: string, sessionId: string, ui: DagCommandUi): void {
  const snapshot = readSnapshot(manager, runId, sessionId)
  // A pruned, foreign, or mistyped run id is a user mistake, not a crash.
  if (snapshot === undefined) {
    ui.notify(`No dag run "${normalizeRendererText(runId)}" in this session.`, "warning")
    return
  }
  ui.notify(detailText(snapshot, manager).join("\n"), "info")
}

function readSnapshot(manager: DagCommandManager, runId: string, sessionId: string): DagCommandRunSnapshot | undefined {
  try {
    return manager.snapshot(runId, sessionId)
  } catch {
    return undefined
  }
}

function detailText(snapshot: DagCommandRunSnapshot, manager: DagCommandManager): string[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node] as const))
  const critical = new Set(snapshot.criticalPath)
  const dependents = dependentsByNode(snapshot)
  const lines = [summaryHeader(snapshot)]
  const total = snapshot.waves.length
  for (const [position, wave] of snapshot.waves.entries()) {
    lines.push(`wave ${position + 1}/${total}`)
    for (const nodeId of wave.nodeIds) {
      const node = nodes.get(nodeId)
      // A wave naming a node the snapshot no longer carries is stale, not fatal: name it and move on.
      if (node === undefined) {
        lines.push(`  ${normalizeRendererText(nodeId)} missing`)
        continue
      }
      lines.push(`  ${nodeRow(node, manager, critical.has(node.id), dependents.get(node.id) ?? [])}`)
    }
  }
  if (snapshot.criticalPath.length > 0) {
    lines.push(`critical path: ${snapshot.criticalPath.map((id) => normalizeRendererText(id)).join(" -> ")}`)
  }
  for (const bottleneck of snapshot.bottlenecks) {
    lines.push(`bottleneck: ${normalizeRendererText(bottleneck.nodeId)} blocks ${bottleneck.blockedCount}`)
  }
  return lines
}

function summaryHeader(snapshot: DagCommandRunSnapshot): string {
  const amendCount = snapshot.amendHistory?.length ?? 0
  const amended = amendCount === 0 ? "" : `, amended x${amendCount}`
  return `${normalizeRendererText(snapshot.name)} (${normalizeRendererText(snapshot.runId)}) ${normalizeRendererText(snapshot.status)} ${snapshot.nodes.length} nodes, ${snapshot.waves.length} waves${amended}`
}

// Edges are rendered on the node that waits, so the wave tree carries the whole dependency graph
// without a second edge list. `dependsOn` is the authority; edges only add what it omits.
function dependentsByNode(snapshot: DagCommandRunSnapshot): Map<string, string[]> {
  const dependents = new Map<string, string[]>()
  for (const node of snapshot.nodes) dependents.set(node.id, [...node.dependsOn])
  for (const edge of snapshot.edges) {
    const known = dependents.get(edge.to)
    if (known === undefined) dependents.set(edge.to, [edge.from])
    else if (!known.includes(edge.from)) known.push(edge.from)
  }
  return dependents
}

function nodeRow(node: DagCommandNode, manager: DagCommandManager, isCritical: boolean, dependsOn: readonly string[]): string {
  const parts = [normalizeRendererText(node.label ?? node.id), normalizeRendererText(node.state), routeLabel(node.route)]
  const model = resolvedModel(node, manager)
  if (model !== undefined) parts.push(`model:${model}`)
  if (node.attempt > 1) parts.push(`x${node.attempt}`)
  const duration = durationLabel(node)
  if (duration !== undefined) parts.push(duration)
  if (dependsOn.length > 0) parts.push(`after ${dependsOn.map((id) => normalizeRendererText(id)).join(", ")}`)
  if (isCritical) parts.push(CRITICAL_MARKER)
  if (node.error !== undefined) {
    parts.push(`error: ${normalizeRendererText(node.error.code)} ${normalizeRendererText(node.error.message)}`)
  }
  return parts.join(" ")
}

function routeLabel(route: DagCommandRoute): string {
  if (route.kind === "agent") return `agent:${normalizeRendererText(route.agent)}`
  return `category:${normalizeRendererText(route.category)}`
}

// The route model is only what the caller asked for; the task record holds what actually ran, so
// the attached record wins whenever the node reached one.
function resolvedModel(node: DagCommandNode, manager: DagCommandManager): string | undefined {
  const record = node.taskId === undefined ? undefined : manager.taskRecord(node.taskId)
  const resolved = record?.resolved_model?.display ?? record?.model ?? (node.route.kind === "agent" ? node.route.model : undefined)
  return resolved === undefined ? undefined : normalizeRendererText(resolved)
}

// Duration is reported only for a settled span: a running node has no measured end, and inventing
// one from wall clock would report a number the snapshot never observed.
function durationLabel(node: DagCommandNode): string | undefined {
  if (node.startedAt === undefined || node.completedAt === undefined) return undefined
  const started = Date.parse(node.startedAt)
  const completed = Date.parse(node.completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined
  return `${((completed - started) / 1000).toFixed(1)}s`
}
