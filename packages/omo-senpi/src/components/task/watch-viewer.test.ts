import { describe, expect, it } from "bun:test"

import type { WatchSource, WatchTarget } from "./watch-source"
import type { WatchTranscript } from "./watch-transcript"
import { createWatchViewer, type WatchTimerHandle, type WatchTimers, type WatchViewer } from "./watch-viewer"

const PARENT = "session-a"

interface RowDef {
  readonly id: string
  readonly terminal?: boolean
}

interface ViewerHarness {
  readonly viewer: WatchViewer
  readonly sent: Array<{ id: string; message: string }>
  readonly reads: string[]
  readonly notifications: string[]
  readonly closeCalls: () => number
  readonly renderCalls: () => number
  readonly rowReads: () => number
  parent: string | undefined
  live: boolean
  terminalIds: Set<string>
  targetOf: (id: string) => WatchTarget | undefined
  sendImpl: (id: string, message: string) => Promise<{ accepted: boolean; text: string }>
  throwOnRows?: Error
  rowsResult?: readonly RowDef[] | undefined
  gone: boolean
  tick(): void
  pending(): number
}

function harness(): ViewerHarness {
  let closeCount = 0
  let renders = 0
  let rowReads = 0
  const scheduled: Array<{ handle: WatchTimerHandle; run: () => void }> = []
  const state: {
    parent: string | undefined
    live: boolean
    gone: boolean
    terminalIds: Set<string>
    targetOf: (id: string) => WatchTarget | undefined
    sendImpl: (id: string, message: string) => Promise<{ accepted: boolean; text: string }>
    throwOnRows?: Error
    rowsResult?: readonly RowDef[] | undefined
  } = {
    parent: PARENT,
    live: true,
    gone: false,
    terminalIds: new Set(),
    targetOf: (id) => ({
      identity: id,
      state: state.terminalIds.has(id) ? "completed" : "running",
      summary: "no dependencies",
      meta: "quick",
      terminal: state.terminalIds.has(id),
    }),
    sendImpl: () => Promise.resolve({ accepted: true, text: "delivered" }),
  }
  const sent: Array<{ id: string; message: string }> = []
  const reads: string[] = []
  const notifications: string[] = []
  const timers: WatchTimers = {
    set: (run) => {
      const handle = {} as WatchTimerHandle
      scheduled.push({ handle, run })
      return handle
    },
    clear: (handle) => {
      const index = scheduled.findIndex((entry) => entry.handle === handle)
      if (index >= 0) scheduled.splice(index, 1)
    },
  }
  const source: WatchSource = {
    labels: () => ({ title: "DAG release audit", unit: "nodes", empty: "This run has no nodes yet." }),
    rows: () => {
      rowReads += 1
      if (state.gone) return undefined
      if (state.throwOnRows !== undefined) throw state.throwOnRows
      if (state.rowsResult !== undefined) return state.rowsResult.map((row) => ({ id: row.id, identity: row.id, state: "running", summary: "no dependencies", meta: "quick", indent: 0 }))
      return [
        { id: "seed", identity: "seed", state: "completed", summary: "no dependencies", meta: "quick", indent: 0 },
        { id: "build", identity: "build", state: "running", summary: "after seed", meta: "quick", indent: 1 },
      ]
    },
    target: (id) => state.targetOf(id),
    read: (id): WatchTranscript => {
      reads.push(id)
      return { kind: "ok", lines: [`output of ${id}`], truncated: false, recorded: true }
    },
    send: (id, message) => {
      sent.push({ id, message })
      return state.sendImpl(id, message)
    },
    live: () => state.live,
  }
  const viewer = createWatchViewer({
    source,
    boundParentId: PARENT,
    currentParentId: () => state.parent,
    requestRender: () => {
      renders += 1
    },
    close: () => {
      closeCount += 1
    },
    notify: (message) => notifications.push(message),
    timers,
  })
  return {
    viewer,
    sent,
    reads,
    notifications,
    closeCalls: () => closeCount,
    renderCalls: () => renders,
    rowReads: () => rowReads,
    get parent() {
      return state.parent
    },
    set parent(next) {
      state.parent = next
    },
    get live() {
      return state.live
    },
    set live(next) {
      state.live = next
    },
    get terminalIds() {
      return state.terminalIds
    },
    set terminalIds(next) {
      state.terminalIds = next
    },
    get targetOf() {
      return state.targetOf
    },
    set targetOf(next) {
      state.targetOf = next
    },
    get sendImpl() {
      return state.sendImpl
    },
    set sendImpl(next) {
      state.sendImpl = next
    },
    get throwOnRows() {
      return state.throwOnRows
    },
    set throwOnRows(next) {
      state.throwOnRows = next
    },
    get rowsResult() {
      return state.rowsResult
    },
    set rowsResult(next) {
      state.rowsResult = next
    },
    get gone() {
      return state.gone
    },
    set gone(next) {
      state.gone = next
    },
    tick: () => {
      const next = scheduled.shift()
      if (next === undefined) throw new Error("no refresh timer was armed")
      next.run()
    },
    pending: () => scheduled.length,
  }
}

describe("createWatchViewer", () => {
  it("#given a tree #when one node opens and the screen returns #then its transcript is read once and cleared on the way back", () => {
    // given a started tree
    const testHarness = harness()
    testHarness.viewer.start()
    expect(testHarness.viewer.view().screen).toBe("tree")

    // when the node opens
    testHarness.viewer.openId("build")

    // then its transcript is read for that node
    expect(testHarness.reads).toEqual(["build"])
    expect(testHarness.viewer.view().screen).toBe("watch")
    expect(testHarness.viewer.view().transcript).toEqual({ kind: "ok", lines: ["output of build"], truncated: false, recorded: true })

    // when the screen returns to the tree
    testHarness.viewer.backToTree()

    // then the transcript is cleared, not kept against the next node
    expect(testHarness.viewer.view().screen).toBe("tree")
    expect(testHarness.viewer.view().transcript).toBeUndefined()
  })

  it("#given a live tree #when a refresh is requested #then only one timer is ever armed and a close clears it", () => {
    // given a started live tree
    const testHarness = harness()
    testHarness.viewer.start()
    const armed = testHarness.pending()
    expect(armed).toBe(1)

    // when one tick runs
    testHarness.tick()

    // then no second timer stacked behind it
    expect(testHarness.pending()).toBe(1)

    // when the viewer closes
    testHarness.viewer.close()

    // then the timer is gone
    expect(testHarness.pending()).toBe(0)
    expect(testHarness.closeCalls()).toBe(1)
  })

  it("#given a watched node that is already terminal #when it opens #then it is read once and nothing keeps polling", () => {
    // given a finished run whose watched node is terminal
    const testHarness = harness()
    testHarness.live = false
    testHarness.terminalIds = new Set(["seed"])
    testHarness.viewer.start()

    // when it opens
    testHarness.viewer.openId("seed")

    // then one final read lands and no refresh timer follows it
    expect(testHarness.reads).toEqual(["seed"])
    expect(testHarness.pending()).toBe(0)
  })

  it("#given blank or control-only input #when a steer is submitted #then nothing is sent", async () => {
    // given an open watch
    const testHarness = harness()
    testHarness.viewer.start()
    testHarness.viewer.openId("build")

    // when blank, empty and control-only lines are submitted, plus one from the tree screen
    const blank = await testHarness.viewer.submit("   ")
    const empty = await testHarness.viewer.submit("")
    const controls = await testHarness.viewer.submit("\n\t")
    testHarness.viewer.backToTree()
    const fromTree = await testHarness.viewer.submit("not on the watch screen")

    // then none of them reached the runtime
    expect([blank, empty, controls, fromTree]).toEqual([undefined, undefined, undefined, undefined])
    expect(testHarness.sent).toHaveLength(0)
  })

  it("#given a watched node #when a steer settles #then the send is attributed to that node and its outcome is shown", async () => {
    // given an open watch
    const testHarness = harness()
    testHarness.viewer.start()
    testHarness.viewer.openId("build")

    // when a steer settles
    const submission = await testHarness.viewer.submit("focus on the failing test")

    // then the runtime got exactly that node and message, and the outcome shows on screen
    expect(testHarness.sent).toEqual([{ id: "build", message: "focus on the failing test" }])
    expect(submission).toEqual({ targetId: "build", report: { accepted: true, text: "delivered" }, current: true })
    expect(testHarness.viewer.view().steerStatus).toEqual({ accepted: true, text: "delivered" })
  })

  it("#given a steer in flight #when another node opens before it settles #then the outcome is not painted against the new node", async () => {
    // given a steer that has not settled yet
    const testHarness = harness()
    let resolveSend!: (report: { accepted: boolean; text: string }) => void
    testHarness.sendImpl = () => new Promise((resolve) => {
      resolveSend = resolve
    })
    testHarness.viewer.start()
    testHarness.viewer.openId("build")
    const submission = testHarness.viewer.submit("applies to the first node")

    // when the user moves to another node first
    testHarness.viewer.openId("seed")
    resolveSend({ accepted: true, text: "late" })
    const result = await submission

    // then the outcome is reported to the caller, never shown against the new node
    expect(result).toEqual({ targetId: "build", report: { accepted: true, text: "late" }, current: false })
    expect(testHarness.viewer.view().watchId).toBe("seed")
    expect(testHarness.viewer.view().steerStatus).toBeUndefined()
  })

  it("#given the session changed or vanished #when the next refresh ticks #then the viewer closes without reading the old owner's data", () => {
    // given a started viewer
    const testHarness = harness()
    testHarness.viewer.start()
    const readsBefore = testHarness.rowReads()

    // when the session changes under it and the armed timer fires
    testHarness.parent = "session-b"
    testHarness.tick()

    // then it closes instead of refreshing the old owner's rows
    expect(testHarness.closeCalls()).toBe(1)
    expect(testHarness.notifications).toEqual(["Task watch closed: this session changed."])
    expect(testHarness.rowReads()).toBe(readsBefore)
  })

  it("#given the session changed #when a steer is submitted #then the message is never sent", async () => {
    // given an open watch whose session changed
    const testHarness = harness()
    testHarness.viewer.start()
    testHarness.viewer.openId("build")
    testHarness.parent = "session-b"

    // when a steer is submitted
    const result = await testHarness.viewer.submit("must not leave the session")

    // then nothing was sent and the viewer closed
    expect(result).toBeUndefined()
    expect(testHarness.sent).toHaveLength(0)
    expect(testHarness.closeCalls()).toBe(1)
  })

  it("#given the owner's data disappeared #when the viewer starts #then it closes instead of throwing", () => {
    // given a source whose owner is gone
    const testHarness = harness()
    testHarness.gone = true

    // when the viewer starts
    testHarness.viewer.start()

    // then it closes with a reason instead of painting an empty owner
    expect(testHarness.closeCalls()).toBe(1)
    expect(testHarness.notifications).toEqual(["Task watch closed: the watched data is no longer available to this session."])
  })

  it("#given a source that throws while polling #when the tree refreshes #then the failure is reported on screen and the watch stays open", () => {
    // given a started viewer whose next refresh throws
    const testHarness = harness()
    testHarness.viewer.start()
    testHarness.throwOnRows = new Error("boom")

    // when the armed timer refreshes
    testHarness.tick()

    // then the failure shows on screen and the watch stays open
    expect(testHarness.viewer.view().failure).toBe("boom")
    expect(testHarness.closeCalls()).toBe(0)
  })

  it("#given the watched node disappears from the run #when a refresh runs #then the watch reports it gone and stops reading", () => {
    // given an open watch whose node leaves the run
    const testHarness = harness()
    testHarness.viewer.start()
    testHarness.viewer.openId("build")
    testHarness.targetOf = () => undefined
    const readsBefore = testHarness.reads.length

    // when the armed timer refreshes
    testHarness.tick()

    // then the watch is marked gone and no further transcript read happens
    expect(testHarness.viewer.view().gone).toBe(true)
    expect(testHarness.reads.length).toBe(readsBefore)
    expect(testHarness.pending()).toBe(0)
  })
})
