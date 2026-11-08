import type { ListScope, ListedTask, SendInput, SendOutcome, TaskRecord } from "@oh-my-opencode/senpi-task"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { taskIdentityLabel } from "@oh-my-opencode/senpi-task"

import { readChildTranscript } from "./child-session-messages"
import type { DagWatchPort, DagWatchRun } from "./dag-subagent-service"
import type { AgentMessage, ThreadService, ThreadState, ThreadView, TranscriptListener, TranscriptObservation, TranscriptSnapshot } from "./subagent-ui/types"

const TREE_ROOT = "/root"
const POLL_MS = 1000

export interface TaskSubagentManager {
  list(scope: ListScope): readonly ListedTask[]
  sendToTask(input: SendInput): Promise<SendOutcome>
}

export interface TaskSubagentDeps {
  readonly manager: TaskSubagentManager
  readonly parentSessionId: string
  readonly stillBound: () => boolean
  readonly stateDir: string
  readonly dag: DagWatchPort
  /** When "exclude", DAG-owned records are omitted (the unified /watch shows them as DAG nodes instead). */
  readonly dagOwned?: "include" | "exclude"
}

export interface TaskSubagentWatch {
  readonly service: ThreadService
  readonly pathFor: (taskId: string) => string
}

export function createTaskSubagentWatch(deps: TaskSubagentDeps): TaskSubagentWatch {
  const pathFor = (taskId: string): string => `${TREE_ROOT}/${encodeURIComponent(taskId)}`
  const taskIdFor = (path: string): string | undefined => {
    if (!path.startsWith(`${TREE_ROOT}/`)) return undefined
    try {
      return decodeURIComponent(path.slice(TREE_ROOT.length + 1))
    } catch {
      return undefined
    }
  }
  const listRecords = (): readonly TaskRecord[] => {
    if (!deps.stillBound()) return []
    return deps.manager.list({ scope: "parent-session", session_id: deps.parentSessionId })
      .map(({ record }) => record)
      .filter((record) => record.parent_session_id === deps.parentSessionId)
      .filter((record) => {
        if (deps.dagOwned === "exclude") return record.owner?.kind !== "dag"
        return record.owner === undefined || dagRunFor(record) !== undefined
      })
  }
  const recordFor = (taskId: string): TaskRecord | undefined => listRecords().find((record) => record.task_id === taskId)
  const dagRunFor = (record: TaskRecord): { readonly runId: DagRunId; readonly run: DagWatchRun; readonly nodeId: string } | undefined => {
    const owner = record.owner
    if (owner === undefined || owner.kind !== "dag" || !deps.stillBound()) return undefined
    try {
      const runId = deps.dag.list(deps.parentSessionId).find((run) => run.runId === owner.runId)?.runId
      if (runId === undefined || !deps.stillBound()) return undefined
      const run = deps.dag.snapshot(runId, deps.parentSessionId)
      const node = run.nodes.find((candidate) => candidate.id === owner.nodeId)
      if (node?.taskId !== record.task_id) return undefined
      return { runId, run, nodeId: owner.nodeId }
    } catch {
      return undefined
    }
  }
  const viewFor = (record: TaskRecord): ThreadView => {
    const path = pathFor(record.task_id)
    const createdAt = timeOf(record.created_at) ?? 0
    const startedAt = timeOf(record.started_at)
    const updatedAt = timeOf(record.updated_at) ?? createdAt
    const status = record.status
    const state = recordState(status)
    const dag = record.owner === undefined ? undefined : dagRunFor(record)
    const node = dag?.run.nodes.find((candidate) => candidate.id === dag.nodeId)
    return {
      path,
      parent: TREE_ROOT,
      owner: record.parent_session_id,
      type: record.agent_type ?? record.category ?? record.execution_mode,
      model: record.effective_model?.display ?? record.resolved_model?.display ?? record.model,
      state: node === undefined ? state : recordState(node.state),
      task: taskIdentityLabel({
        taskId: record.task_id,
        name: record.name,
        description: record.description,
        taskSummary: record.task_summary,
      }),
      status: node?.error?.message ?? record.error_message ?? status,
      ...(record.final_response === undefined ? {} : { output: record.final_response }),
      ...(record.error_message === undefined ? {} : { error: record.error_message }),
      createdAt,
      updatedAt: timeOf(record.terminal_at) ?? updatedAt,
      ...(startedAt === undefined ? {} : { startedAt, lastStartedAt: startedAt }),
      ...(startedAt !== undefined && timeOf(record.terminal_at) !== undefined
        ? { elapsedMs: Math.max(0, (timeOf(record.terminal_at) ?? startedAt) - startedAt) }
        : {}),
    }
  }
  const transcriptFor = (record: TaskRecord, nodeOutput?: string): readonly AgentMessage[] => {
    const transcript = readChildTranscript(deps.stateDir, record.task_id)
    if (transcript.messages.length > 0 || nodeOutput === undefined || nodeOutput.length === 0) {
      if (transcript.messages.length > 0 || record.final_response === undefined) return transcript.messages
    }
    const output = nodeOutput ?? record.final_response
    return output === undefined || output.length === 0
      ? transcript.messages
      : [...transcript.messages, { role: "assistant", content: [{ type: "text", text: output }] }]
  }
  const failedSnapshot = (revision: number, error: string): TranscriptSnapshot => ({
    revision, generation: 0, messages: [], assistant: null, tools: [], inheritedCount: 0, error,
  })

  const service: ThreadService = {
    list(): ThreadView[] {
      return listRecords().map(viewFor)
    },

    async observeTranscript(path: string, listener: TranscriptListener): Promise<TranscriptObservation> {
      const taskId = taskIdFor(path)
      if (taskId === undefined) throw new Error("This item is not part of the task watch.")
      let revision = 0
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        closed = true
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
      }
      const sample = (): TranscriptSnapshot => {
        revision += 1
        if (!deps.stillBound()) return failedSnapshot(revision, "This session changed, so the watch stopped.")
        try {
          const record = recordFor(taskId)
          if (record === undefined) return failedSnapshot(revision, "This task is no longer part of this session.")
          let nodeOutput: string | undefined
          if (record.owner !== undefined) {
            const owned = dagRunFor(record)
            if (owned === undefined) return failedSnapshot(revision, "This DAG task is no longer owned by the current session.")
            nodeOutput = owned.run.nodes.find((node) => node.id === owned.nodeId)?.output
          }
          if (!deps.stillBound()) return failedSnapshot(revision, "This session changed, so the watch stopped.")
          return {
            revision,
            generation: 0,
            messages: transcriptFor(record, nodeOutput),
            assistant: null,
            tools: [],
            inheritedCount: 0,
            thread: viewFor(record),
          }
        } catch (error) {
          return failedSnapshot(revision, `Transcript unavailable: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const tick = (): void => {
        timer = undefined
        if (closed) return
        if (!deps.stillBound()) { stop(); return }
        const snapshot = sample()
        try { listener(snapshot) } catch { stop(); return }
        if (closed) return
        timer = setTimeout(tick, POLL_MS)
        timer.unref?.()
      }
      const first = sample()
      if (deps.stillBound()) {
        timer = setTimeout(tick, POLL_MS)
        timer.unref?.()
      } else stop()
      return { snapshot: first, unsubscribe: stop }
    },

    async steer(path: string, message?: string): Promise<ThreadView> {
      const taskId = taskIdFor(path)
      if (taskId === undefined) throw new Error("This item is not part of the task watch.")
      if (message === undefined || message.trim().length === 0) throw new Error("Nothing to send.")
      if (!deps.stillBound()) throw new Error("This session changed, so nothing was sent.")
      const record = recordFor(taskId)
      if (record === undefined) throw new Error("This task is no longer part of this session.")
      if (record.owner === undefined) {
        const outcome = await deps.manager.sendToTask({
          idOrName: record.task_id,
          message,
          deliverAs: "steer",
          callerSessionId: deps.parentSessionId,
          expectedRunEpoch: record.notification.run_epoch,
        })
        requireTaskAccepted(outcome)
      } else {
        const owned = dagRunFor(record)
        if (owned === undefined) throw new Error("This DAG task is no longer owned by the current session.")
        const result = await deps.dag.send(owned.runId, owned.nodeId, message)
        requireDagAccepted(result, owned.nodeId)
      }
      if (!deps.stillBound()) throw new Error("The session changed while the message was delivered. Check the child output.")
      const updated = recordFor(taskId)
      if (updated === undefined) throw new Error("The task changed while the message was delivered. Check its output.")
      if (updated.owner !== undefined && dagRunFor(updated) === undefined) {
        throw new Error("The DAG task changed while the message was delivered. Check its output.")
      }
      return viewFor(updated)
    },
  }
  return { service, pathFor }
}

function recordState(status: string): ThreadState {
  switch (status) {
    case "running": return "running"
    case "paused": return "paused"
    case "completed": return "completed"
    case "failed":
    case "error":
    case "lost": return "failed"
    case "cancelled":
    case "interrupted": return "stopped"
    default: return "starting"
  }
}

function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function requireTaskAccepted(outcome: SendOutcome): void {
  switch (outcome.kind) {
    case "steered":
    case "revived":
    case "queued":
    case "held": return
    case "uncertain":
    case "delivery_uncertain":
      throw new Error(`Delivery is unconfirmed${"effect_id" in outcome ? ` (${outcome.effect_id})` : ""}: ${outcome.reason}`)
    case "unresponsive":
    case "failed":
    case "capacity_deferred":
    case "stale":
    case "not_continuable":
    case "scope_denied": throw new Error(`Message not sent: ${outcome.reason}`)
    case "one_shot_agent": throw new Error(outcome.message)
    case "not_found": throw new Error(`Message not sent: ${outcome.reason}. ${outcome.suggestion}`)
    default: throw new Error(`Message not sent: unsupported task send outcome "${outcome.kind}".`)
  }
}

function requireDagAccepted(result: Awaited<ReturnType<DagWatchPort["send"]>>, nodeId: string): void {
  switch (result.delivery) {
    case "steer":
    case "revive":
    case "queued":
    case "held":
    case "guidance": return
    case "uncertain":
      throw new Error(`Delivery to ${nodeId} is unconfirmed (${result.effectId ?? "no effect id"}). Do not resend blindly.`)
    default: throw new Error(`Not sent to ${nodeId}: unrecognised delivery "${result.delivery}".`)
  }
}
