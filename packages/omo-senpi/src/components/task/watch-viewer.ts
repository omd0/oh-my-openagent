import { sanitizeTerminalText } from "../side-panel/format/sanitize"
import type { SteerReport, WatchLabels, WatchRow, WatchSource, WatchTarget } from "./watch-source"
import type { WatchTranscript } from "./watch-transcript"

// One refresh per second, re-armed only after the previous tick finishes, so reads never overlap.
export const WATCH_REFRESH_MS = 1000

export type WatchScreen = "tree" | "watch"

export type WatchTimerHandle = ReturnType<typeof setTimeout>

export interface WatchTimers {
  set(run: () => void, ms: number): WatchTimerHandle
  clear(handle: WatchTimerHandle): void
}

export interface WatchViewerDeps {
  readonly source: WatchSource
  // The parent session this viewer was opened for. Every read and send is checked against it.
  readonly boundParentId: string
  readonly currentParentId: () => string | undefined
  readonly requestRender: () => void
  readonly close: () => void
  readonly notify: (message: string) => void
  readonly timers: WatchTimers
  readonly initialId?: string
}

// What the popup paints. The popup reads only this snapshot, never controller internals.
export interface WatchView {
  readonly screen: WatchScreen
  readonly labels: WatchLabels
  readonly rows: readonly WatchRow[]
  readonly selectedId: string | undefined
  readonly watchId: string | undefined
  readonly target: WatchTarget | undefined
  readonly gone: boolean
  readonly transcript: WatchTranscript | undefined
  readonly follow: boolean
  readonly editing: boolean
  readonly sending: boolean
  readonly steerStatus: SteerReport | undefined
  readonly failure: string | undefined
}

// The outcome of one send, attributed to the item it was sent to. `current` is true only while that
// item is still the one on the watch screen when the send settles; otherwise the outcome is not shown.
export interface SteerSubmission {
  readonly targetId: string
  readonly report: SteerReport
  readonly current: boolean
}

export interface WatchViewer {
  start(): void
  view(): WatchView
  setLayout(totalRows: number, bodyRows: number): void
  effectiveScroll(): number
  moveSelection(delta: number): void
  openSelected(): void
  openId(id: string): void
  backToTree(): void
  scrollWatch(delta: number): void
  scrollToStart(): void
  scrollToEnd(): void
  setEditing(editing: boolean): void
  toggleEditing(): void
  retry(): void
  submit(value: string): Promise<SteerSubmission | undefined>
  close(): void
  dispose(): void
}

export function createWatchViewer(deps: WatchViewerDeps): WatchViewer {
  const { source } = deps
  let screen: WatchScreen = "tree"
  let rows: readonly WatchRow[] = []
  let selectedId: string | undefined
  let watchId: string | undefined
  let target: WatchTarget | undefined
  let gone = false
  let transcript: WatchTranscript | undefined
  let settled = false
  let follow = true
  let scrollTop = 0
  let lastTotal = 0
  let lastBody = 0
  let editing = true
  let pendingId: string | undefined
  let steerStatus: SteerReport | undefined
  let failure: string | undefined
  let closed = false
  let timer: WatchTimerHandle | undefined

  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

  // Ends the viewer with a reason. Used when the parent changed or the owner vanished.
  const endWith = (message: string): void => {
    if (closed) return
    deps.notify(message)
    close()
  }

  // The parent check runs before every read and send, and again after every await.
  const bound = (): boolean => {
    if (closed) return false
    if (deps.currentParentId() === deps.boundParentId) return true
    endWith("Task watch closed: this session changed.")
    return false
  }

  const refresh = (): boolean => {
    const next = source.rows()
    if (next === undefined) {
      endWith("Task watch closed: the watched data is no longer available to this session.")
      return false
    }
    rows = next
    if (selectedId === undefined || !rows.some((row) => row.id === selectedId)) selectedId = rows[0]?.id
    if (watchId !== undefined) {
      target = source.target(watchId)
      gone = target === undefined
      if (target !== undefined && !target.terminal) settled = false
    }
    return true
  }

  const readWatch = (force: boolean): void => {
    if (watchId === undefined || gone) return
    if (settled && !force) return
    transcript = source.read(watchId)
    // One read after the terminal edge shows the final output; then nothing more is read.
    if (target?.terminal === true) settled = true
  }

  // Polling runs only while something can still change: the owner (tree) or the watched item (watch).
  const needsPolling = (): boolean => (screen === "tree" ? source.live() : !(settled || gone))

  const arm = (): void => {
    if (closed || timer !== undefined) return
    let poll: boolean
    try {
      poll = needsPolling()
    } catch (error) {
      failure = errorText(error)
      return
    }
    if (!poll) return
    timer = deps.timers.set(() => {
      timer = undefined
      tick()
    }, WATCH_REFRESH_MS)
  }

  const tick = (): void => {
    if (!bound()) return
    try {
      if (refresh() && screen === "watch") readWatch(false)
      failure = undefined
    } catch (error) {
      failure = errorText(error)
    }
    deps.requestRender()
    arm()
  }

  const effective = (): number => {
    const max = Math.max(0, lastTotal - lastBody)
    if (follow) return max
    return Math.min(Math.max(0, scrollTop), max)
  }

  const close = (): void => {
    if (closed) return
    dispose()
    deps.close()
  }

  const dispose = (): void => {
    closed = true
    if (timer !== undefined) deps.timers.clear(timer)
    timer = undefined
  }

  const openId = (id: string): void => {
    if (!bound()) return
    screen = "watch"
    watchId = id
    selectedId = id
    target = undefined
    gone = false
    transcript = undefined
    settled = false
    follow = true
    scrollTop = 0
    editing = true
    steerStatus = undefined
    failure = undefined
    try {
      if (refresh()) readWatch(true)
    } catch (error) {
      failure = errorText(error)
    }
    deps.requestRender()
    arm()
  }

  return {
    start(): void {
      if (closed || !bound()) return
      try {
        refresh()
        failure = undefined
      } catch (error) {
        failure = errorText(error)
      }
      if (deps.initialId !== undefined) openId(deps.initialId)
      else deps.requestRender()
      arm()
    },
    view(): WatchView {
      return {
        screen,
        labels: source.labels(),
        rows,
        selectedId,
        watchId,
        target,
        gone,
        transcript,
        follow,
        editing,
        sending: pendingId !== undefined && pendingId === watchId,
        steerStatus,
        failure,
      }
    },
    setLayout(totalRows: number, bodyRows: number): void {
      lastTotal = Math.max(0, totalRows)
      lastBody = Math.max(0, bodyRows)
    },
    effectiveScroll: effective,
    moveSelection(delta: number): void {
      if (screen !== "tree" || rows.length === 0) return
      const index = Math.max(0, rows.findIndex((row) => row.id === selectedId))
      const next = Math.min(rows.length - 1, Math.max(0, index + delta))
      selectedId = rows[next]?.id ?? selectedId
      deps.requestRender()
    },
    openSelected(): void {
      if (selectedId !== undefined) openId(selectedId)
    },
    openId,
    backToTree(): void {
      if (!bound()) return
      screen = "tree"
      watchId = undefined
      target = undefined
      transcript = undefined
      steerStatus = undefined
      deps.requestRender()
      arm()
    },
    scrollWatch(delta: number): void {
      const base = effective()
      follow = false
      scrollTop = Math.min(Math.max(0, base + delta), Math.max(0, lastTotal - lastBody))
      deps.requestRender()
    },
    scrollToStart(): void {
      follow = false
      scrollTop = 0
      deps.requestRender()
    },
    scrollToEnd(): void {
      follow = true
      deps.requestRender()
    },
    setEditing(value: boolean): void {
      editing = value
      deps.requestRender()
    },
    toggleEditing(): void {
      editing = !editing
      deps.requestRender()
    },
    retry(): void {
      if (!bound()) return
      try {
        if (refresh()) readWatch(true)
        failure = undefined
      } catch (error) {
        failure = errorText(error)
      }
      deps.requestRender()
      arm()
    },
    async submit(value: string): Promise<SteerSubmission | undefined> {
      // Steering is one line of human text: control characters go, surrounding space goes.
      const message = sanitizeTerminalText(value).trim()
      if (closed || pendingId !== undefined || screen !== "watch" || watchId === undefined || message.length === 0) return undefined
      if (!bound()) return undefined
      const id = watchId
      pendingId = id
      steerStatus = undefined
      deps.requestRender()
      let report: SteerReport
      try {
        if (!refresh() || gone) {
          report = { accepted: false, text: "Not sent: this item is no longer part of the watched data." }
        } else {
          report = await source.send(id, message)
        }
      } catch (error) {
        report = { accepted: false, text: `Not sent: ${errorText(error)}` }
      }
      pendingId = undefined
      // The send may have ended the viewer or changed the session while awaiting; check before painting.
      if (closed || !bound()) return undefined
      // Only the item still on screen takes the outcome. A send that settles after the user moved on
      // is reported to its caller, never shown against another item.
      const current = screen === "watch" && watchId === id
      if (current) {
        steerStatus = report
        try {
          refresh()
        } catch (error) {
          failure = errorText(error)
        }
      }
      deps.requestRender()
      arm()
      return { targetId: id, report, current }
    },
    close,
    dispose,
  }
}
