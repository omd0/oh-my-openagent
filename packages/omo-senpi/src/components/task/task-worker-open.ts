import type { DagWatchPort } from "./dag-subagent-service"
import { createTaskSubagentWatch, type TaskSubagentManager } from "./task-subagent-service"
import { mountSubagentWatch, type WatchHolder, type WatchUi } from "./watch-mount"

// Opens the upstream watch on one ordinary task, from a link click or the inline keyboard focus. The task
// must be a direct child of this session in the manager's own list right now, and it must not be a DAG
// worker (those open through the DAG opener). Nothing here starts, steers or stops the task.

export interface TaskWorkerOpenDeps {
  readonly manager: TaskSubagentManager
  readonly dag: DagWatchPort
  readonly stateDir: string
  readonly holder: WatchHolder
  // The live session id; read on every check, so a switched session fails the open.
  readonly sessionId: () => string | undefined
}

export function createTaskWorkerOpener(deps: TaskWorkerOpenDeps): (taskId: string, ui: WatchUi) => Promise<void> {
  return async (taskId, ui) => {
    const parentId = deps.sessionId()
    if (parentId === undefined) {
      ui.notify("This task belongs to no session, so nothing opened.", "warning")
      return
    }
    if (deps.holder.current !== undefined) {
      ui.notify("A watch is already open.", "info")
      return
    }
    const record = deps.manager
      .list({ scope: "parent-session", session_id: parentId })
      .map((entry) => entry.record)
      .find((entry) => entry.task_id === taskId && entry.parent_session_id === parentId && entry.owner?.kind !== "dag")
    if (record === undefined) {
      ui.notify("That task is no longer in this session.", "warning")
      return
    }
    const watch = createTaskSubagentWatch({
      manager: deps.manager,
      dag: deps.dag,
      parentSessionId: parentId,
      stillBound: () => deps.sessionId() === parentId,
      stateDir: deps.stateDir,
    })
    await mountSubagentWatch(deps.holder, {
      ui,
      service: watch.service,
      parentId,
      currentParentId: () => deps.sessionId(),
      initialPath: watch.pathFor(taskId),
    })
  }
}
