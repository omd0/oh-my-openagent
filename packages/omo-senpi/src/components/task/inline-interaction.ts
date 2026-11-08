import { getKeybindings, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui"

// One focus menu and one click path for every inline worker row: ordinary task rows and DAG worker rows.
// Both end in the same `open` callback. Nothing here starts, steers or stops a worker; it only names a
// worker the widget is currently painting.

export type InlineWorker = { readonly kind: "task"; readonly taskId: string } | { readonly kind: "dag"; readonly runId: string; readonly nodeId: string }

// Each widget owns one group and replaces only that group, so the two widgets never wipe each other's rows.
export type InlineGroup = "task" | "dag"

// A private scheme that names a worker and nothing else (ids are percent-encoded). It is not the side
// panel's `omo-panel:` scheme, so the side panel's click callback never claims these links.
export const WORKER_SCHEME = "omo-subagent:"

export function workerKey(worker: InlineWorker): string {
  return worker.kind === "task"
    ? `task/${encodeURIComponent(worker.taskId)}`
    : `dag/${encodeURIComponent(worker.runId)}/${encodeURIComponent(worker.nodeId)}`
}

export function workerUrl(worker: InlineWorker): string {
  return `${WORKER_SCHEME}${workerKey(worker)}`
}

export function isPrivateWorkerUrl(url: string): boolean {
  return url.startsWith(WORKER_SCHEME)
}

// Anything that is not exactly one of the two shapes is not a worker: the caller swallows it when it is
// ours, and never hands it to a browser.
export function parseWorkerUrl(url: string): InlineWorker | undefined {
  if (!isPrivateWorkerUrl(url)) return undefined
  const [kind, first, second, extra] = url.slice(WORKER_SCHEME.length).split("/")
  if (extra !== undefined || first === undefined) return undefined
  try {
    if (kind === "task" && second === undefined) {
      const taskId = decodeURIComponent(first)
      return taskId === "" ? undefined : { kind: "task", taskId }
    }
    if (kind === "dag" && second !== undefined) {
      const runId = decodeURIComponent(first)
      const nodeId = decodeURIComponent(second)
      return runId === "" || nodeId === "" ? undefined : { kind: "dag", runId, nodeId }
    }
  } catch {
    return undefined
  }
  return undefined
}

// Wrapped AFTER the width math: an OSC 8 sequence has no printable width, so measuring it would
// truncate the row early.
export function workerLink(text: string, worker: InlineWorker): string {
  return `\u001b]8;;${workerUrl(worker)}\u0007${text}\u001b]8;;\u0007`
}

export type InputResult = { readonly consume?: boolean; readonly data?: string } | undefined
export type InputHandler = (data: string) => InputResult
export type InputSubscribe = (handler: InputHandler) => () => void

export interface InlineInteractionDeps {
  // Mounts the watch for one worker. Called from the keyboard and from a link click alike.
  readonly open: (worker: InlineWorker) => void
  // True while a watch overlay is open: the overlay owns input, so this surface yields it.
  readonly busy: () => boolean
  // The live session id. A group keeps the session it was painted for; a different live session claims nothing.
  readonly sessionId: () => string | undefined
}

export interface InlineInteraction {
  // Claims the renderer's link callback once. Idempotent across repaints.
  attach(candidate: unknown): void
  // Replaces one widget's worker rows, in that widget's paint order. An empty list releases the group.
  setGroup(group: InlineGroup, sessionId: string | undefined, workers: readonly InlineWorker[]): void
  // The subscription to raw terminal input. It is held only while some worker row is visible.
  bindInput(subscribe: InputSubscribe): void
  // Per-row hook for the upstream widget: the focus marker, then the worker link, after width math.
  decorate(worker: InlineWorker, line: string, width: number): string
  dispose(): void
}

const PAGE_ROWS = 5

export function createInlineInteraction(deps: InlineInteractionDeps): InlineInteraction {
  const groups: Record<InlineGroup, readonly InlineWorker[]> = { task: [], dag: [] }
  let groupSession: string | undefined
  let repaint: ((force?: boolean) => void) | undefined
  let subscribeInput: InputSubscribe | undefined
  let unsubscribe: (() => void) | undefined
  let hookInstalled = false
  let active = false
  let selectedKey: string | undefined
  let disposed = false

  // Paint order: the task group, then the DAG group. Focus moves over exactly this list.
  const visible = (): readonly InlineWorker[] => [...groups.task, ...groups.dag]
  const ownedNow = (): boolean => groupSession !== undefined && deps.sessionId() === groupSession
  const requestPaint = (): void => repaint?.(false)

  const ensureSelection = (): void => {
    const list = visible()
    if (list.some((worker) => workerKey(worker) === selectedKey)) return
    const first = list[0]
    selectedKey = first === undefined ? undefined : workerKey(first)
  }

  const selectedIndex = (): number => Math.max(0, visible().findIndex((worker) => workerKey(worker) === selectedKey))

  const moveTo = (index: number): void => {
    const list = visible()
    const target = list[Math.min(list.length - 1, Math.max(0, index))]
    if (target !== undefined) selectedKey = workerKey(target)
  }

  const leave = (): void => {
    if (!active) return
    active = false
    requestPaint()
  }

  // The subscription follows the rows: held while a worker is visible, released when none is, so a
  // cleared widget (session switch, shutdown) leaves no input claim behind.
  const syncSubscription = (): void => {
    const wanted = !disposed && subscribeInput !== undefined && visible().length > 0
    if (wanted && unsubscribe === undefined) unsubscribe = subscribeInput?.(onInput)
    if (!wanted && unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
  }

  // Keyboard focus. Alt+Down claims the chord only while worker rows are visible and no watch is open.
  // While focus is active, the keys it owns are consumed; any other key leaves focus and reaches the editor.
  const onInput: InputHandler = (data) => {
    if (disposed || !ownedNow() || deps.busy()) {
      leave()
      return undefined
    }
    if (!active) {
      if (visible().length > 0 && matchesKey(data, Key.alt("down"))) {
        active = true
        ensureSelection()
        requestPaint()
        return { consume: true }
      }
      return undefined
    }
    if (visible().length === 0) {
      leave()
      return undefined
    }
    const keys = getKeybindings()
    if (keys.matches(data, "tui.select.up")) {
      moveTo(selectedIndex() - 1)
      requestPaint()
      return { consume: true }
    }
    if (keys.matches(data, "tui.select.down")) {
      moveTo(selectedIndex() + 1)
      requestPaint()
      return { consume: true }
    }
    if (matchesKey(data, Key.pageUp)) {
      moveTo(selectedIndex() - PAGE_ROWS)
      requestPaint()
      return { consume: true }
    }
    if (matchesKey(data, Key.pageDown)) {
      moveTo(selectedIndex() + PAGE_ROWS)
      requestPaint()
      return { consume: true }
    }
    if (matchesKey(data, Key.home)) {
      moveTo(0)
      requestPaint()
      return { consume: true }
    }
    if (matchesKey(data, Key.end)) {
      moveTo(visible().length - 1)
      requestPaint()
      return { consume: true }
    }
    if (keys.matches(data, "tui.select.confirm")) {
      const worker = visible().find((entry) => workerKey(entry) === selectedKey)
      leave()
      if (worker !== undefined) deps.open(worker)
      return { consume: true }
    }
    if (keys.matches(data, "tui.select.cancel") || matchesKey(data, Key.alt("up"))) {
      leave()
      return { consume: true }
    }
    leave()
    return undefined
  }

  // A link click. Our own private URLs open only for a worker in the CURRENT visible rows of the session
  // that painted them, and never while a watch is open. Anything else is ours to swallow, never a browser.
  // Every other URL goes to the callback the host had before this surface was installed.
  const onUrl = (url: string, previous: unknown): void => {
    if (!isPrivateWorkerUrl(url)) {
      if (typeof previous === "function") previous(url)
      return
    }
    const requested = parseWorkerUrl(url)
    if (disposed || requested === undefined || !ownedNow() || deps.busy()) return
    const target = visible().find((worker) => workerKey(worker) === workerKey(requested))
    if (target === undefined) return
    selectedKey = workerKey(target)
    leave()
    deps.open(target)
  }

  return {
    attach(candidate: unknown): void {
      if (disposed || typeof candidate !== "object" || candidate === null) return
      if (repaint === undefined && "requestRender" in candidate) {
        const requestRender = candidate.requestRender
        if (typeof requestRender === "function") repaint = (force) => requestRender.call(candidate, force)
      }
      // Claimed once per surface and never restored. A host proxy returns fresh function objects on every
      // read, so this surface cannot prove it still owns the callback; restoring the saved one could clobber
      // a newer wrapper. With no worker visible, or after dispose, the installed callback only delegates.
      if (hookInstalled || !("openUrl" in candidate)) return
      const previous = candidate.openUrl
      if (typeof previous !== "function") return
      hookInstalled = true
      candidate.openUrl = (url: string): void => onUrl(url, previous)
    },
    setGroup(group, sessionId, workers): void {
      groups[group] = disposed ? [] : workers
      if (workers.length > 0 && sessionId !== undefined) groupSession = sessionId
      if (visible().length === 0) groupSession = undefined
      ensureSelection()
      if (visible().length === 0) active = false
      syncSubscription()
    },
    bindInput(subscribe): void {
      subscribeInput = subscribe
      syncSubscription()
    },
    decorate(worker, line, width): string {
      const focused = active && workerKey(worker) === selectedKey
      const text = active ? truncateToWidth(`${focused ? "› " : "  "}${line}`, width, "") : line
      // A row paints a link only once the link callback is actually claimed, so no row claims a click the host
      // would never deliver.
      return hookInstalled ? workerLink(text, worker) : text
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      groups.task = []
      groups.dag = []
      groupSession = undefined
      unsubscribe?.()
      unsubscribe = undefined
      subscribeInput = undefined
      repaint = undefined
      active = false
      selectedKey = undefined
    },
  }
}
