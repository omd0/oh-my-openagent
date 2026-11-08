import { readDagPanelFeed, subscribeDagPanelFeed } from "../task/dag-panel-feed"
import type { DagBridgeRunSnapshot } from "../task/dag-snapshot-payload"
import { DAG_REPAINT_COALESCE_MS } from "./constants"
import type { PanelTimerHandle, PanelTimers } from "./types"

const SETTLED_RUN = new Set(["completed", "failed", "cancelled"])

/**
 * The panel's one connection to a session's DAG runs. It holds the subscription, coalesces feed
 * changes into a single repaint, and reads the feed fail-closed: a feed that throws shows as an
 * empty graph, never as a broken frame. Dispose is the owner-safe cleanup: after it, no listener
 * reaches the surface.
 */
export interface DagBinding {
  /** Follows the session the panel is mounted for; a change of session drops the old subscription. */
  bind(sessionId: string | undefined): void
  /** Live runs first, in the order the feed gives them. */
  runs(): readonly DagBridgeRunSnapshot[]
  activity(runId: string, nodeId: string): string | undefined
  /** True while a node is running, which is when the column needs its live clock. */
  hasLive(): boolean
  /**
   * Runs once when the binding is disposed (session switch or shutdown), so an open overlay can
   * close with the session it shows. Already disposed: the listener runs at once. Returns a release.
   */
  onDispose(listener: () => void): () => void
  isDisposed(): boolean
  dispose(): void
}

export interface DagBindingDeps {
  readonly timers: PanelTimers
  readonly onChange: () => void
}

export function createDagBinding(deps: DagBindingDeps): DagBinding {
  let sessionId: string | undefined
  let unsubscribe: (() => void) | undefined
  let pending: PanelTimerHandle | undefined
  let disposed = false
  const disposeListeners = new Set<() => void>()

  const notify = (): void => {
    if (disposed || pending !== undefined) return
    pending = deps.timers.set(() => {
      pending = undefined
      if (!disposed) deps.onChange()
    }, DAG_REPAINT_COALESCE_MS)
  }

  const feed = () => (sessionId === undefined ? undefined : readDagPanelFeed(sessionId))
  const runs = (): readonly DagBridgeRunSnapshot[] => {
    try {
      const all = feed()?.runs() ?? []
      return all.toSorted((a, b) => Number(!SETTLED_RUN.has(b.status)) - Number(!SETTLED_RUN.has(a.status)))
    } catch {
      return []
    }
  }

  return {
    bind(next) {
      if (disposed || next === sessionId) return
      unsubscribe?.()
      unsubscribe = undefined
      sessionId = next
      if (next === undefined) return
      try {
        // Subscribing before the feed exists is allowed: the feed appears once the task engine attaches.
        unsubscribe = subscribeDagPanelFeed(next, notify)
      } catch {
        unsubscribe = undefined
      }
    },
    runs,
    activity(runId, nodeId) {
      try {
        return feed()?.activity(runId, nodeId)
      } catch {
        return undefined
      }
    },
    hasLive() {
      return runs().some((run) => run.nodes.some((node) => node.state === "running"))
    },
    onDispose(listener) {
      if (disposed) {
        listener()
        return () => {}
      }
      disposeListeners.add(listener)
      return () => {
        disposeListeners.delete(listener)
      }
    },
    isDisposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe?.()
      unsubscribe = undefined
      if (pending !== undefined) deps.timers.clear(pending)
      pending = undefined
      sessionId = undefined
      // Listeners run after the feed is detached, so an overlay repainting in response sees no session.
      for (const listener of [...disposeListeners]) listener()
      disposeListeners.clear()
    },
  }
}
