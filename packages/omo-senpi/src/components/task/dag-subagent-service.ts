import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { readChildTranscript } from "./child-session-messages"
import type { AgentMessage, ThreadService, ThreadState, ThreadView, TranscriptListener, TranscriptObservation, TranscriptSnapshot } from "./subagent-ui/types"

// Adapter from one owned DAG run to the vendored pi-subagent-manager screens. Each DAG node is one
// tree row: its path is /root/<node id>, and its parent is its first dependency (or /root). Nothing
// here starts, stops or resumes a child; the only write is the runtime's own send, which takes the
// bound run id and node id, and the runtime resolves the node's current task itself.

export const DAG_TREE_ROOT = "/root"
const POLL_MS = 1000

// Structural mirrors of the DAG runtime surface this adapter reads and steers. The runtime's own types
// satisfy them; only the fields shown in the watch are declared.
export interface DagWatchRoute {
  readonly kind: string
  readonly category?: string
  readonly agent?: string
  readonly model?: string
}

export interface DagWatchNode {
  readonly id: string
  readonly label?: string
  readonly state: string
  readonly route: DagWatchRoute
  readonly dependsOn: readonly string[]
  readonly attempt: number
  // Re-resolved on every read: a retry or a new execution attempt replaces it, so it is never cached.
  readonly taskId?: string
  readonly output?: string
  readonly outputBytes?: number
  readonly error?: { readonly message: string }
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
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

export interface DagWatchTaskRecord {
  readonly model: string
  readonly resolved_model?: { readonly display: string }
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
  taskRecord(taskId: string): DagWatchTaskRecord | undefined
}

export interface DagSubagentDeps {
  readonly port: DagWatchPort
  readonly runId: DagRunId
  // The parent session this run was chosen in. Every read goes through it, so the owner check fails closed.
  readonly parentSessionId: string
  // True only while the session this watch was opened in is still the active one. Checked before every
  // read, before every send and again after every await, so an old parent never reads or writes.
  readonly stillBound: () => boolean
  readonly stateDir: string
}

export type DagSubagentService = ThreadService

export function createDagSubagentService(deps: DagSubagentDeps): DagSubagentService {
  const readRun = (): DagWatchRun | undefined => {
    if (!deps.stillBound()) return undefined
    try {
      return deps.port.snapshot(deps.runId, deps.parentSessionId)
    } catch {
      return undefined
    }
  }

  const pathFor = (nodeId: string): string => `${DAG_TREE_ROOT}/${encodeURIComponent(nodeId)}`

  const nodeIdFor = (path: string): string | undefined => {
    if (!path.startsWith(`${DAG_TREE_ROOT}/`)) return undefined
    try {
      return decodeURIComponent(path.slice(DAG_TREE_ROOT.length + 1))
    } catch {
      return undefined
    }
  }

  const threadFor = (run: DagWatchRun, node: DagWatchNode): ThreadView => {
    const record = node.taskId === undefined ? undefined : deps.port.taskRecord(node.taskId)
    const createdAt = timeOf(node.createdAt) ?? 0
    const startedAt = timeOf(node.startedAt)
    const completedAt = timeOf(node.completedAt)
    const state = threadState(node.state)
    const live = state === "starting" || state === "running"
    const dependency = node.dependsOn[0]
    return {
      path: pathFor(node.id),
      parent: dependency === undefined ? DAG_TREE_ROOT : pathFor(dependency),
      owner: run.runId,
      type: node.route.agent ?? node.route.category ?? node.route.kind,
      model: record?.resolved_model?.display ?? record?.model ?? node.route.model,
      state,
      task: node.label ?? node.id,
      status: node.error !== undefined
        ? `error: ${node.error.message}`
        : node.dependsOn.length === 0
          ? "no dependencies"
          : `after ${node.dependsOn.join(", ")}`,
      output: node.output,
      error: node.error?.message,
      createdAt,
      updatedAt: completedAt ?? startedAt ?? createdAt,
      ...(live && startedAt !== undefined ? { startedAt } : {}),
      ...(startedAt !== undefined ? { lastStartedAt: startedAt } : {}),
      ...(startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt
        ? { elapsedMs: completedAt - startedAt }
        : {}),
    }
  }

  const findNode = (nodeId: string): { readonly run: DagWatchRun; readonly node: DagWatchNode } | undefined => {
    const run = readRun()
    const node = run?.nodes.find((entry) => entry.id === nodeId)
    return run !== undefined && node !== undefined ? { run, node } : undefined
  }

  // Builds the snapshot the transcript screen paints from. Structured messages come from the child's
  // session file; a finished node with no session file shows its saved output as one assistant message.
  const transcriptFor = (node: DagWatchNode): { readonly messages: readonly AgentMessage[]; readonly truncated: boolean } => {
    if (node.taskId === undefined) return { messages: [], truncated: false }
    const child = readChildTranscript(deps.stateDir, node.taskId)
    if (child.messages.length > 0 || node.output === undefined || node.output.length === 0) return child
    return {
      messages: [{ role: "assistant", content: [{ type: "text", text: node.output }] }],
      truncated: node.outputBytes !== undefined && node.outputBytes > Buffer.byteLength(node.output, "utf8"),
    }
  }

  return {
    list(): ThreadView[] {
      const run = readRun()
      if (run === undefined) return []
      return run.nodes.map((node) => threadFor(run, node))
    },

    async observeTranscript(path: string, listener: TranscriptListener): Promise<TranscriptObservation> {
      const nodeId = nodeIdFor(path)
      if (nodeId === undefined) throw new Error("This item is not part of the watched run.")
      let revision = 0
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        closed = true
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
      }
      // A failed sample becomes a structured snapshot error, so nothing thrown here reaches the timer.
      const sample = (): TranscriptSnapshot => {
        revision += 1
        const failed = (message: string): TranscriptSnapshot => ({
          revision,
          generation: 0,
          messages: [],
          assistant: null,
          tools: [],
          inheritedCount: 0,
          error: message,
        })
        if (!deps.stillBound()) return failed("This session changed, so the watch stopped.")
        try {
          const found = findNode(nodeId)
          if (found === undefined) return failed("This item is no longer part of the watched run.")
          const transcript = transcriptFor(found.node)
          return {
            revision,
            generation: 0,
            messages: transcript.messages,
            assistant: null,
            tools: [],
            inheritedCount: 0,
            thread: threadFor(found.run, found.node),
          }
        } catch (error) {
          return failed(`Transcript unavailable: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      // One bounded sampler per open view. Once the parent changed it stops without reading again; a
      // listener failure also stops it, so no timer survives a view that cannot take updates.
      const tick = (): void => {
        timer = undefined
        if (closed) return
        if (!deps.stillBound()) {
          stop()
          return
        }
        const snapshot = sample()
        try {
          listener(snapshot)
        } catch {
          stop()
          return
        }
        if (closed) return
        timer = setTimeout(tick, POLL_MS)
        timer.unref?.()
      }
      const first = sample()
      if (deps.stillBound()) {
        timer = setTimeout(tick, POLL_MS)
        timer.unref?.()
      } else {
        stop()
      }
      return { snapshot: first, unsubscribe: stop }
    },

    async steer(path: string, message?: string): Promise<ThreadView> {
      const nodeId = nodeIdFor(path)
      if (nodeId === undefined) throw new Error("This item is not part of the watched run.")
      if (message === undefined || message.trim().length === 0) throw new Error("Nothing to send.")
      // Nothing is sent once the parent changed. The check runs before the send only; the runtime's own
      // send remains the single writer, and it checks ownership of the run itself.
      if (!deps.stillBound()) throw new Error("This session changed, so nothing was sent.")
      const found = findNode(nodeId)
      if (found === undefined) throw new Error("This item is no longer part of the watched run.")
      const result = await deps.port.send(deps.runId, nodeId, message)
      requireAcceptedDelivery(result, nodeId)
      // The send has landed. A session change during the await is reported, and the old view reads nothing.
      if (!deps.stillBound()) throw new Error("The session changed while the message was delivered. Check the node output.")
      const after = findNode(nodeId)
      return threadFor(after?.run ?? found.run, after?.node ?? found.node)
    },
  }
}

// Read-only mapping of a DAG node state to the manager's thread state. Shared with the inline widget.
export function threadState(state: string): ThreadState {
  switch (state) {
    case "running":
      return "running"
    case "paused":
      return "paused"
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
    case "skipped":
      return "stopped"
    // pending, blocked and scheduled nodes have no child yet; the view shows them as starting.
    default:
      return "starting"
  }
}

// Accepted deliveries are the ones the runtime made: a running child took the message, a finished one
// was revived, the message was queued or held, or it was kept as guidance for a paused run. Anything
// else is a refusal and is thrown, so the vendored footer shows it and the draft is kept.
function requireAcceptedDelivery(result: DagWatchSendResult, nodeId: string): void {
  switch (result.delivery) {
    case "steer":
    case "revive":
    case "queued":
    case "held":
    case "guidance":
      return
    case "uncertain":
      throw new Error(`Delivery to ${nodeId} is unconfirmed (${result.effectId ?? "no effect id"}). Do not resend blindly.`)
    default:
      throw new Error(`Not sent to ${nodeId}: unrecognised delivery "${result.delivery}".`)
  }
}

function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
