import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { readWatchTranscript, type WatchTranscript } from "./watch-transcript"
import type { SteerReport, WatchLabels, WatchRow, WatchSource, WatchTarget } from "./watch-source"

// Structural mirrors of the DAG runtime surface the watch reads and steers. Only the fields the watch
// shows are declared; the runtime's own types satisfy them. The run id is branded, so a user-typed id
// never reaches these calls uncast: it is matched against the session's own run list first.
export interface DagWatchRoute {
  readonly kind: string
  readonly category?: string
  readonly agent?: string
}

export interface DagWatchNode {
  readonly id: string
  readonly label?: string
  readonly state: string
  readonly route: DagWatchRoute
  readonly dependsOn: readonly string[]
  readonly attempt: number
  // Re-read on every refresh. A retry or a new execution attempt replaces it, so it is never cached.
  readonly taskId?: string
  // Bounded preview of a finished node's output; `outputBytes` is the full persisted size.
  readonly output?: string
  readonly outputBytes?: number
  readonly error?: { readonly message: string }
}

export interface DagWatchRun {
  readonly runId: DagRunId
  readonly name: string
  readonly status: string
  readonly nodes: readonly DagWatchNode[]
}

export interface DagWatchSummary {
  readonly runId: DagRunId
  readonly name: string
  readonly status: string
}

export interface DagWatchSendResult {
  readonly delivery: string
  readonly guidanceId?: string
  readonly effectId?: string
  readonly queuePosition?: number
}

export interface DagWatchPort {
  list(parentSessionId: string): readonly DagWatchSummary[]
  snapshot(runId: DagRunId, parentSessionId: string): DagWatchRun
  send(runId: DagRunId, nodeId: string, message: string): Promise<DagWatchSendResult>
}

export interface DagWatchSourceDeps {
  readonly port: DagWatchPort
  readonly runId: DagRunId
  readonly parentSessionId: string
  readonly stateDir: string
}

const TERMINAL_NODE_STATES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "skipped"])
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])
const NOT_STARTED_STATES: ReadonlySet<string> = new Set(["pending", "blocked", "scheduled"])

// The one bound owner: a single run of this parent session. Every read goes back through the port with
// the bound run id and parent, and a node is looked up only inside that run, so a node id that exists in
// another run can never be reached from this watch.
export function createDagWatchSource(deps: DagWatchSourceDeps): WatchSource {
  const snapshotNow = (): DagWatchRun | undefined => {
    try {
      return deps.port.snapshot(deps.runId, deps.parentSessionId)
    } catch {
      return undefined
    }
  }
  const nodeNow = (nodeId: string): DagWatchNode | undefined => snapshotNow()?.nodes.find((node) => node.id === nodeId)

  return {
    labels(): WatchLabels {
      const run = snapshotNow()
      const name = run?.name ?? deps.runId
      return { title: `DAG ${name} · ${run?.status ?? "unavailable"}`, unit: "nodes", empty: "This run has no nodes yet." }
    },
    rows(): readonly WatchRow[] | undefined {
      const run = snapshotNow()
      if (run === undefined) return undefined
      const depth = depthByNode(run.nodes)
      const ordered = [...run.nodes].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0))
      return ordered.map((node) => ({
        id: node.id,
        identity: node.label ?? node.id,
        state: node.attempt > 1 ? `${node.state} attempt ${node.attempt}` : node.state,
        summary: rowSummary(node),
        meta: routeText(node.route),
        indent: depth.get(node.id) ?? 0,
      }))
    },
    target(id: string): WatchTarget | undefined {
      const node = nodeNow(id)
      if (node === undefined) return undefined
      return {
        identity: node.label ?? node.id,
        state: node.attempt > 1 ? `${node.state} attempt ${node.attempt}` : node.state,
        summary: rowSummary(node),
        meta: routeText(node.route),
        terminal: TERMINAL_NODE_STATES.has(node.state),
      }
    },
    read(id: string): WatchTranscript {
      const node = nodeNow(id)
      if (node === undefined) return { kind: "ok", lines: [], truncated: false, recorded: false, note: "This node is no longer part of the run." }
      if (node.taskId === undefined) {
        return { kind: "ok", lines: [], truncated: false, recorded: false, note: notStartedNote(node) }
      }
      const transcript = readWatchTranscript(deps.stateDir, node.taskId)
      if (transcript.kind === "ok" && transcript.recorded) return transcript
      // The child's transcript is gone or unreadable, but a finished node keeps its own output preview.
      const output = node.output
      if (output !== undefined && output.length > 0) {
        // `outputBytes` counts UTF-8 bytes, so the shown size is measured the same way, never in characters.
        const shownBytes = utf8ByteLength(output)
        const bytes = node.outputBytes ?? shownBytes
        const truncated = shownBytes < bytes
        const note = truncated
          ? `Saved output of the finished node, ${shownBytes} of ${bytes} bytes shown.`
          : "Saved output of the finished node."
        return { kind: "ok", lines: output.split("\n"), truncated, recorded: true, note }
      }
      return transcript
    },
    async send(id: string, message: string): Promise<SteerReport> {
      // The runtime re-reads the owned record and resolves the node's current task itself. The watch
      // hands it the bound run and the node id only, never a task id.
      try {
        const result = await deps.port.send(deps.runId, id, message)
        return describeDagSend(result, id)
      } catch (error) {
        return { accepted: false, text: `Not sent to ${id}: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
    live(): boolean {
      const run = snapshotNow()
      return run !== undefined && !TERMINAL_RUN_STATUSES.has(run.status)
    },
  }
}

// Maps a runtime delivery to what the user reads. Only the delivery kinds the runtime actually
// returns are listed; anything unrecognised is shown as-is and is not counted as delivered.
export function describeDagSend(result: DagWatchSendResult, nodeId: string): SteerReport {
  switch (result.delivery) {
    case "steer":
      return { accepted: true, text: `Steered ${nodeId}. Its child takes the message on the next step.` }
    case "revive":
      return { accepted: true, text: `Revived ${nodeId}. Its child runs again with your message.` }
    case "queued":
      return { accepted: true, text: `Queued for ${nodeId} behind earlier messages (position ${result.queuePosition ?? "?"}).` }
    case "held":
      return { accepted: true, text: `Held for ${nodeId}. The run is stopped, so the message is delivered when it resumes.` }
    case "guidance":
      return { accepted: true, text: `Saved as guidance for the paused run (${result.guidanceId ?? "recorded"}). It applies when the run resumes.` }
    case "uncertain":
      return { accepted: false, text: `Delivery to ${nodeId} is unconfirmed (${result.effectId ?? "no effect id"}). Do not resend blindly.` }
    default:
      return { accepted: false, text: `Not sent to ${nodeId}: unrecognised delivery "${result.delivery}".` }
  }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function notStartedNote(node: DagWatchNode): string {
  if (NOT_STARTED_STATES.has(node.state)) return "Not started yet. It starts once the nodes it waits on finish."
  if (node.state === "paused") return "Paused with the run. Its child starts or resumes when the run continues."
  return "No child was started for this node."
}

function rowSummary(node: DagWatchNode): string {
  if (node.error !== undefined) return `error: ${node.error.message}`
  if (node.dependsOn.length === 0) return node.taskId === undefined ? "no dependencies, not started" : "no dependencies"
  return `after ${node.dependsOn.join(", ")}`
}

function routeText(route: DagWatchRoute): string {
  if (route.kind === "agent" && route.agent !== undefined) return route.agent
  if (route.category !== undefined) return route.category
  return route.kind
}

// Dependency depth: a node with no predecessors is 0, otherwise one more than its deepest predecessor.
// A cycle cannot be built by the definition validator; the visiting guard only keeps a bad record finite.
function depthByNode(nodes: readonly DagWatchNode[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    const node = byId.get(id)
    if (node === undefined || visiting.has(id)) return 0
    visiting.add(id)
    const value = node.dependsOn.length === 0 ? 0 : 1 + Math.max(...node.dependsOn.map(depthOf))
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  for (const node of nodes) depthOf(node.id)
  return depth
}
