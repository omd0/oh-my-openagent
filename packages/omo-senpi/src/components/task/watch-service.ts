import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { createDagSubagentService, threadState, type DagWatchPort, type DagWatchRun } from "./dag-subagent-service"
import { createTaskSubagentWatch, type TaskSubagentManager } from "./task-subagent-service"
import type { ThreadService, ThreadView, TranscriptListener, TranscriptObservation, TranscriptSnapshot } from "./subagent-ui/types"

const ROOT = "/root"
const WORKFLOW = "workflow"

export interface SessionWatchDeps {
  readonly manager: TaskSubagentManager
  readonly dag: DagWatchPort
  readonly parentSessionId: string
  readonly stillBound: () => boolean
  readonly stateDir: string
}

type PathKind =
  | { kind: "task"; taskId: string }
  | { kind: "group"; runId: DagRunId }
  | { kind: "node"; runId: DagRunId; nodeId: string }

function encode(segment: string): string {
  return encodeURIComponent(segment)
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

function parsePath(path: string): PathKind | undefined {
  const parts = path.split("/")
  if (parts[0] !== "" || parts[1] !== "root") return undefined
  if (parts.length === 3) {
    const taskId = decode(parts[2] ?? "")
    return taskId === undefined ? undefined : { kind: "task", taskId }
  }
  if (parts[2] !== WORKFLOW) return undefined
  if (parts.length === 4) {
    const runId = decode(parts[3] ?? "")
    return runId === undefined ? undefined : { kind: "group", runId: runId as DagRunId }
  }
  if (parts.length === 5) {
    const runId = decode(parts[3] ?? "")
    const nodeId = decode(parts[4] ?? "")
    return runId === undefined || nodeId === undefined ? undefined : { kind: "node", runId: runId as DagRunId, nodeId }
  }
  return undefined
}

function groupPath(runId: string): string {
  return `${ROOT}/${WORKFLOW}/${encode(runId)}`
}

function nodePath(runId: string, nodeId: string): string {
  return `${ROOT}/${WORKFLOW}/${encode(runId)}/${encode(nodeId)}`
}

function runState(status: string): ThreadView["state"] {
  return threadState(status)
}

export function createSessionWatchService(deps: SessionWatchDeps): ThreadService {
  const taskWatch = createTaskSubagentWatch({ ...deps, dagOwned: "exclude" })
  const dagServices = new Map<string, ThreadService>()

  const dagService = (runId: DagRunId): ThreadService | undefined => {
    if (!deps.stillBound()) return undefined
    let service = dagServices.get(runId)
    if (service === undefined) {
      try {
        service = createDagSubagentService({
          port: deps.dag,
          runId,
          parentSessionId: deps.parentSessionId,
          stillBound: deps.stillBound,
          stateDir: deps.stateDir,
        })
        dagServices.set(runId, service)
      } catch {
        return undefined
      }
    }
    return service
  }

  const rePathNode = (runId: string, view: ThreadView, nodes: readonly { id: string; dependsOn: readonly string[] }[]): ThreadView => {
    const group = groupPath(runId)
    const node = nodes.find((n) => n.id === view.path.slice(`${ROOT}/`.length))
    const dep = node?.dependsOn[0]
    return {
      ...view,
      path: nodePath(runId, node?.id ?? view.path.slice(`${ROOT}/`.length)),
      parent: dep === undefined ? group : nodePath(runId, dep),
    }
  }

  const groupView = (run: DagWatchRun): ThreadView => {
    const times = run.nodes.flatMap((n) => [Date.parse(n.createdAt), Date.parse(n.startedAt ?? ""), Date.parse(n.completedAt ?? "")]).filter((t) => Number.isFinite(t))
    return {
      path: groupPath(run.runId),
      parent: ROOT,
      owner: run.runId,
      type: "workflow",
      state: runState(run.status),
      task: run.name,
      status: `${run.nodes.length} nodes`,
      createdAt: times.length > 0 ? Math.min(...times) : 0,
      updatedAt: times.length > 0 ? Math.max(...times) : 0,
    }
  }

  return {
    list(): ThreadView[] {
      if (!deps.stillBound()) return []
      const tasks = taskWatch.service.list()
      const runs = deps.dag.list(deps.parentSessionId)
      const views: ThreadView[] = [...tasks]
      for (const summary of runs) {
        let run: DagWatchRun
        try {
          run = deps.dag.snapshot(summary.runId, deps.parentSessionId)
        } catch {
          continue
        }
        views.push(groupView(run))
        const service = dagService(summary.runId)
        if (service === undefined) continue
        for (const view of service.list()) {
          views.push(rePathNode(run.runId, view, run.nodes))
        }
      }
      return views
    },

    async observeTranscript(path: string, listener: TranscriptListener): Promise<TranscriptObservation> {
      const parsed = parsePath(path)
      if (parsed === undefined) throw new Error("This item is not part of the session watch.")
      if (parsed.kind === "task") return taskWatch.service.observeTranscript(taskWatch.pathFor(parsed.taskId), listener)
      if (parsed.kind === "node") {
        const service = dagService(parsed.runId)
        if (service === undefined) throw new Error("This workflow is no longer available.")
        const observation = await service.observeTranscript(`${ROOT}/${encode(parsed.nodeId)}`, listener)
        const original = observation.snapshot
        const wrapped: TranscriptSnapshot = {
          ...original,
          ...(original.thread !== undefined
            ? {
                thread: {
                  ...original.thread,
                  path: nodePath(parsed.runId, parsed.nodeId),
                  parent: original.thread.parent === ROOT ? groupPath(parsed.runId) : nodePath(parsed.runId, original.thread.parent?.slice(`${ROOT}/`.length) ?? ""),
                },
              }
            : {}),
        }
        listener(wrapped)
        return {
          snapshot: wrapped,
          unsubscribe: observation.unsubscribe,
        }
      }
      let run: DagWatchRun
      try {
        run = deps.dag.snapshot(parsed.runId, deps.parentSessionId)
      } catch {
        throw new Error("This workflow is no longer available.")
      }
      const gView = groupView(run)
      const summary = run.nodes.map((n) => `${n.label ?? n.id}: ${n.state}`).join("\n")
      const snapshot: TranscriptSnapshot = {
        revision: 1,
        generation: 0,
        messages: [{ role: "assistant", content: [{ type: "text", text: summary }] }],
        assistant: null,
        tools: [],
        inheritedCount: 0,
        thread: gView,
      }
      listener(snapshot)
      return { snapshot, unsubscribe: () => {} }
    },

    async steer(path: string, message?: string): Promise<ThreadView> {
      const parsed = parsePath(path)
      if (parsed === undefined) throw new Error("This item is not part of the session watch.")
      if (parsed.kind === "group") throw new Error("This is a workflow group. Pick a node to steer.")
      if (parsed.kind === "task") return taskWatch.service.steer(taskWatch.pathFor(parsed.taskId), message)
      const service = dagService(parsed.runId)
      if (service === undefined) throw new Error("This workflow is no longer available.")
      const view = await service.steer(`${ROOT}/${encode(parsed.nodeId)}`, message)
      let run: DagWatchRun
      try {
        run = deps.dag.snapshot(parsed.runId, deps.parentSessionId)
      } catch {
        return view
      }
      return rePathNode(parsed.runId, view, run.nodes)
    },
  }
}
