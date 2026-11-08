import { createDagSubagentService, type DagWatchPort } from "./dag-subagent-service"
import type { DagVisibleWorker } from "./dag-status-inline"
import { mountSubagentWatch, type WatchHolder, type WatchUi } from "./watch-mount"

// Opens the upstream watch on one DAG worker, from a link click or the inline keyboard focus. The worker
// is validated against this session's own run list and the run's owned snapshot first, so a stale link or
// a worker from another session opens nothing. Control stays with the runtime: this only mounts a view.

export interface DagWorkerOpenDeps {
  readonly port: DagWatchPort
  readonly stateDir: string
  readonly holder: WatchHolder
  // The live session id; read on every check, so a switched session fails the open.
  readonly sessionId: () => string | undefined
}

export function createDagWorkerOpener(deps: DagWorkerOpenDeps): (worker: DagVisibleWorker, ui: WatchUi) => Promise<void> {
  return async (worker, ui) => {
    const parentId = deps.sessionId()
    if (parentId === undefined) {
      ui.notify("This worker belongs to no session, so nothing opened.", "warning")
      return
    }
    if (deps.holder.current !== undefined) {
      ui.notify("A watch is already open.", "info")
      return
    }
    const summary = deps.port.list(parentId).find((entry) => entry.runId === worker.runId)
    if (summary === undefined) {
      ui.notify("That worker is no longer in this session.", "warning")
      return
    }
    let run: ReturnType<DagWatchPort["snapshot"]>
    try {
      run = deps.port.snapshot(summary.runId, parentId)
    } catch {
      ui.notify("That worker's run is no longer available to this session.", "warning")
      return
    }
    const node = run.nodes.find((entry) => entry.id === worker.nodeId)
    if (node === undefined) {
      ui.notify("That worker is no longer part of its run.", "warning")
      return
    }
    // A node has no child until it starts; its id alone is not a watchable target.
    if (node.taskId === undefined) {
      ui.notify("That worker has not started yet, so there is nothing to watch.", "info")
      return
    }
    const service = createDagSubagentService({
      port: deps.port,
      runId: summary.runId,
      parentSessionId: parentId,
      stillBound: () => deps.sessionId() === parentId,
      stateDir: deps.stateDir,
    })
    await mountSubagentWatch(deps.holder, {
      ui,
      service,
      parentId,
      currentParentId: () => deps.sessionId(),
      initialPath: `/root/${encodeURIComponent(node.id)}`,
    })
  }
}
