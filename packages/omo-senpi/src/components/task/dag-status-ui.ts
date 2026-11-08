import type { CapturedUi } from "./runtime-context"
import type { DagStatusRunSnapshot } from "./dag-status-row-format"
import { nodeIdOfPath, renderDagInline, visibleDagWorkers } from "./dag-status-inline"
import type { ThreadView } from "./subagent-ui/types"
import type { InlineInteraction, InlineWorker } from "./inline-interaction"
import { renderAgentTree as _unusedRenderAgentTree } from "./subagent-ui/widget"

export type {
  DagStatusNode,
  DagStatusRoute,
  DagStatusRunSnapshot,
  DagStatusWave,
} from "./dag-status-row-format"

// Own widget key: the DAG rows render BESIDE the existing "omo-task" widget, never over it.
export const DAG_STATUS_UI_KEY = "omo-dag"
const DEFAULT_DEBOUNCE_MS = 250
const LIVE_REFRESH_MS = 1_000

type TimerHandle = ReturnType<typeof setTimeout> | number

export interface DagStatusRunSummary {
  readonly runId: string
  readonly status: string
}

// The unsequenced live telemetry feed (DagActivityEvent): latest-wins per node, never accumulated.
export interface DagStatusActivityEvent {
  readonly runId: string
  readonly nodeId: string
  readonly taskId: string
  readonly activity: string
  readonly turns: number
}

// The read seam the widget needs from DagManager: session-scoped run list plus per-run snapshot.
export interface DagStatusUiManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly DagStatusRunSummary[]
  snapshot(runId: string, parentSessionId: string): DagStatusRunSnapshot
}

export interface DagStatusUiRuntime {
  ui(): CapturedUi | undefined
  sessionId(): string | undefined
  mode(): string | undefined
}

export interface DagStatusUiLogger {
  warn(message: string, details?: unknown): void
}

// Injectable timer seam so debounce and live refresh are deterministic under test.
export interface DagStatusUiTimers {
  set(callback: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface DagStatusUiDeps {
  readonly manager: DagStatusUiManager
  readonly runtime: DagStatusUiRuntime
  readonly debounceMs?: number
  readonly timers?: DagStatusUiTimers
  readonly logger?: DagStatusUiLogger
  // Visible terminal width seam; defaults to process.stdout.columns like the task widget.
  readonly terminalWidth?: () => number | undefined
  // Local rendering time for live node elapsed labels and deterministic tests.
  readonly now?: () => number
  // The one focus menu shared with the ordinary task widget: this widget owns the "dag" group of it.
  readonly interaction?: InlineInteraction
}

export interface DagStatusUi {
  // Debounced render, driven by dag events; collapses a burst into one paint.
  scheduleSync(): void
  // Immediate render.
  syncNow(): void
  // Live activity feed intake: latest-wins per node, ignored for runs this session cannot see.
  onActivity(event: DagStatusActivityEvent): void
  activity(runId: string, nodeId: string): string | undefined
  // Cancel pending timers so shutdown leaves no render scheduled past teardown.
  dispose(): void
}

const globalTimers: DagStatusUiTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

export function createDagStatusUi(deps: DagStatusUiDeps): DagStatusUi {
  const timers = deps.timers ?? globalTimers
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const now = deps.now ?? Date.now
  // runId -> nodeId -> latest activity text. Latest-wins: an entry is replaced, never appended to.
  const liveActivity = new Map<string, Map<string, string>>()
  let pending: TimerHandle | undefined
  let liveRefresh: TimerHandle | undefined
  const reportedRenderFaults = new Set<string>()
  function reportRenderFault(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (reportedRenderFaults.has(message)) return
    reportedRenderFaults.add(message)
    deps.logger?.warn("omo-dag status widget render failed; frame skipped", { error: message })
  }

  function containRenderFault(run: () => void): void {
    try {
      run()
    } catch (error) {
      reportRenderFault(error)
    }
  }

  function render(): void {
    const ui = deps.runtime.ui()
    // TUI only: no widget surface exists outside interactive mode, so skip the work entirely there.
    if (ui === undefined || deps.runtime.mode() !== "tui") {
      deps.interaction?.setGroup("dag", undefined, [])
      clearLiveRefresh()
      return
    }
    const runs = liveRuns()
    pruneActivity(runs)
    const workers: InlineWorker[] = visibleDagWorkers(runs, now()).map((worker) => ({ kind: "dag", runId: worker.runId, nodeId: worker.nodeId }))
    deps.interaction?.setGroup("dag", deps.runtime.sessionId(), workers)
    const subscribe = ui.onTerminalInput
    if (deps.interaction !== undefined && subscribe !== undefined) {
      deps.interaction.bindInput((handler) => subscribe.call(ui, handler))
    }
    if (runs.length === 0) {
      // Blanking is only honest when nothing is live. A run the manager still lists but whose
      // snapshot could not be projected (pruned mid-read, unreadable checkpoint, a session id that
      // moved under a fork/restart - see #7316) must NOT read as "the dag finished": clearing the
      // widget there is exactly what makes a working run look dead. Keep a minimal tracking line
      // and keep repainting so the next successful projection replaces it.
      const liveCount = countLiveRuns()
      if (liveCount === 0) {
        clearLiveRefresh()
        ui.setWidget(DAG_STATUS_UI_KEY, undefined)
        return
      }
      ui.setWidget(DAG_STATUS_UI_KEY, [trackingRow(liveCount)], { placement: "belowEditor" })
      scheduleLiveRefresh()
      return
    }
    // The rows come from the upstream agent widget, painted with the host theme at each frame. A frame
    // that throws is contained inside the factory so the host never sees the fault.
    const interaction = deps.interaction
    ui.setWidget(
      DAG_STATUS_UI_KEY,
      (tui, theme) => {
        interaction?.attach(tui)
        return {
          render: (width: number): string[] => {
            try {
              return renderDagInline(runs, liveActivity, theme, width, now(), {
                ...(interaction === undefined ? {} : { decorate: dagDecorator(interaction) }),
              })
            } catch (error) {
              reportRenderFault(error)
              return []
            }
          },
          invalidate: (): void => {},
        }
      },
      { placement: "belowEditor" },
    )
    if (runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status))) scheduleLiveRefresh()
    else clearLiveRefresh()
  }

  // Live runs the manager still reports, independent of whether each one could be projected. This
  // is the discriminator between "nothing is running" and "something is running but unreadable".
  function countLiveRuns(): number {
    const sessionId = deps.runtime.sessionId()
    if (sessionId === undefined) return 0
    try {
      return deps.manager.list(sessionId).filter((summary) => !TERMINAL_RUN_STATUSES.has(summary.status)).length
    } catch {
      return 0
    }
  }

  function trackingRow(liveCount: number): string {
    return liveCount === 1 ? "◌ tracking 1 dag run" : `◌ tracking ${liveCount} dag runs`
  }

  function liveRuns(): readonly DagStatusRunSnapshot[] {
    const sessionId = deps.runtime.sessionId()
    // Fail-closed: without a session id there is nothing to scope, so no run is queried.
    if (sessionId === undefined) return []
    const snapshots: DagStatusRunSnapshot[] = []
    for (const summary of deps.manager.list(sessionId)) {
      if (TERMINAL_RUN_STATUSES.has(summary.status)) continue
      // A run pruned between list and snapshot is stale, not fatal: drop it and keep painting.
      const snapshot = readSnapshot(summary.runId, sessionId)
      if (snapshot === undefined) continue
      snapshots.push(snapshot)
    }
    return snapshots
  }

  function readSnapshot(runId: string, sessionId: string): DagStatusRunSnapshot | undefined {
    try {
      return deps.manager.snapshot(runId, sessionId)
    } catch {
      return undefined
    }
  }

  function pruneActivity(runs: readonly DagStatusRunSnapshot[]): void {
    const liveIds = new Set(runs.map((run) => run.runId))
    for (const runId of [...liveActivity.keys()]) {
      if (!liveIds.has(runId)) liveActivity.delete(runId)
    }
  }

  function scheduleSync(): void {
    // A live run already repaints at 1Hz; reuse that timer rather than stacking a second one.
    if (liveRefresh !== undefined) return
    if (pending !== undefined) timers.clear(pending)
    pending = timers.set(() => {
      pending = undefined
      containRenderFault(render)
    }, debounceMs)
  }

  function scheduleLiveRefresh(): void {
    if (liveRefresh !== undefined) return
    const handle = timers.set(() => {
      if (liveRefresh !== handle) return
      liveRefresh = undefined
      containRenderFault(render)
    }, LIVE_REFRESH_MS)
    liveRefresh = handle
  }

  function clearLiveRefresh(): void {
    if (liveRefresh === undefined) return
    timers.clear(liveRefresh)
    liveRefresh = undefined
  }

  return {
    scheduleSync,
    syncNow: () => containRenderFault(render),
    onActivity(event) {
      const perRun = liveActivity.get(event.runId) ?? new Map<string, string>()
      perRun.set(event.nodeId, event.activity)
      liveActivity.set(event.runId, perRun)
      scheduleSync()
    },
    activity(runId, nodeId) {
      return liveActivity.get(runId)?.get(nodeId)
    },
    dispose() {
      if (pending !== undefined) {
        timers.clear(pending)
        pending = undefined
      }
      clearLiveRefresh()
      liveActivity.clear()
      deps.interaction?.setGroup("dag", undefined, [])
    },
  }
}

// The per-row hook for a DAG worker row: the thread's run and node identify the worker to the shared menu.
function dagDecorator(interaction: InlineInteraction): (thread: ThreadView, line: string, width: number) => string {
  return (thread, line, width) => interaction.decorate({ kind: "dag", runId: thread.owner, nodeId: nodeIdOfPath(thread.path) }, line, width)
}
