import { describe, expect, test } from "bun:test"

import { claimDagPanelFeed, type DagPanelFeed } from "../task/dag-panel-feed"
import type { DagBridgeRunSnapshot } from "../task/dag-snapshot-payload"
import { createDagBinding } from "./dag-binding"
import { dagNode, dagRun } from "./dag-panel.test-support"
import { DAG_REPAINT_COALESCE_MS } from "./constants"
import type { PanelTimerHandle, PanelTimers } from "./types"

let sequence = 0
function sessionId(label: string): string {
  sequence += 1
  return `session-dag-binding-${label}-${sequence}`
}

interface ManualTimers extends PanelTimers {
  fire(): void
  pending(): number
  delay(): number | undefined
}

function manualTimers(): ManualTimers {
  let queue: Array<{ readonly callback: () => void; readonly ms: number }> = []
  return {
    set(callback, ms) {
      queue.push({ callback, ms })
      return queue.length as PanelTimerHandle
    },
    clear() {
      queue = []
    },
    fire() {
      const due = queue
      queue = []
      for (const timer of due) timer.callback()
    },
    pending: () => queue.length,
    delay: () => queue[0]?.ms,
  }
}

function feedOf(runs: () => readonly DagBridgeRunSnapshot[]): DagPanelFeed {
  return { runs, activity: () => undefined }
}

describe("side panel dag binding", () => {
  test("#given a burst of feed changes #when the binding repaints #then one coalesced timer reaches the surface", () => {
    // given
    const session = sessionId("coalesce")
    const timers = manualTimers()
    let paints = 0
    const binding = createDagBinding({ timers, onChange: () => { paints += 1 } })
    binding.bind(session)
    const claimed = claimDagPanelFeed(session, {}, feedOf(() => [dagRun()]))

    // when
    claimed.notify()
    claimed.notify()

    // then
    expect(timers.pending()).toBe(1)
    expect(timers.delay()).toBe(DAG_REPAINT_COALESCE_MS)
    expect(paints).toBe(0)
    timers.fire()
    expect(paints).toBe(1)

    // when - the next change arrives after the repaint
    claimed.notify()

    // then - the coalescer re-arms instead of staying latched
    expect(timers.pending()).toBe(1)
    timers.fire()
    expect(paints).toBe(2)

    binding.dispose()
    claimed.dispose()
  })

  test("#given a binding for one session #when it follows another session #then the old subscription stops and the new one arms", () => {
    // given
    const first = sessionId("switch-a")
    const second = sessionId("switch-b")
    const timers = manualTimers()
    const binding = createDagBinding({ timers, onChange: () => undefined })
    binding.bind(first)
    const firstClaim = claimDagPanelFeed(first, {}, feedOf(() => [dagRun({ runId: "run-a" })]))
    timers.fire()

    // when
    binding.bind(second)
    firstClaim.notify()

    // then - the session the panel left no longer repaints it
    expect(timers.pending()).toBe(0)
    expect(binding.runs()).toEqual([])

    // when
    const secondClaim = claimDagPanelFeed(second, {}, feedOf(() => [dagRun({ runId: "run-b" })]))

    // then
    expect(timers.pending()).toBe(1)
    timers.fire()
    expect(binding.runs().map((run) => run.runId)).toEqual(["run-b"])

    binding.dispose()
    firstClaim.dispose()
    secondClaim.dispose()
  })

  test("#given a disposed binding #when the session feed changes #then no timer, no run and no subscription survives", () => {
    // given
    const session = sessionId("dispose")
    const timers = manualTimers()
    let paints = 0
    const binding = createDagBinding({ timers, onChange: () => { paints += 1 } })
    binding.bind(session)
    const claimed = claimDagPanelFeed(session, {}, feedOf(() => [dagRun()]))
    expect(timers.pending()).toBe(1)

    // when
    binding.dispose()

    // then - the pending repaint is cancelled and the feed is unsubscribed
    expect(timers.pending()).toBe(0)
    expect(binding.runs()).toEqual([])
    claimed.notify()
    expect(timers.pending()).toBe(0)
    expect(paints).toBe(0)

    // when - the panel is asked to follow a session after teardown
    binding.bind(session)

    // then - it stays inert rather than resurrecting the subscription
    claimed.notify()
    expect(timers.pending()).toBe(0)
    expect(binding.runs()).toEqual([])

    claimed.dispose()
  })

  test("#given a feed that throws #when the binding reads it #then the panel sees an empty graph rather than a fault", () => {
    // given
    const session = sessionId("fault")
    const timers = manualTimers()
    const binding = createDagBinding({ timers, onChange: () => undefined })
    binding.bind(session)
    const claimed = claimDagPanelFeed(session, {}, {
      runs: () => {
        throw new Error("feed read failed")
      },
      activity: () => {
        throw new Error("activity read failed")
      },
    })

    // when / then
    expect(binding.runs()).toEqual([])
    expect(binding.activity("run-dag", "build")).toBeUndefined()
    expect(binding.hasLive()).toBe(false)

    binding.dispose()
    claimed.dispose()
  })

  test("#given live and settled runs #when the binding lists them #then running work leads and ties keep feed order", () => {
    // given
    const session = sessionId("ordering")
    const timers = manualTimers()
    const binding = createDagBinding({ timers, onChange: () => undefined })
    binding.bind(session)
    const settled = dagRun({ runId: "settled", status: "completed" })
    const failed = dagRun({ runId: "failed", status: "failed" })
    const running = dagRun({ runId: "running", status: "running" })
    const claimed = claimDagPanelFeed(session, {}, feedOf(() => [settled, running, failed]))

    // when
    const listed = binding.runs()

    // then
    expect(listed.map((run) => run.runId)).toEqual(["running", "settled", "failed"])

    binding.dispose()
    claimed.dispose()
  })

  test("#given a run with a running node #when the binding reports live work #then the live clock is requested only while a node runs", () => {
    // given
    const session = sessionId("live")
    const timers = manualTimers()
    const binding = createDagBinding({ timers, onChange: () => undefined })
    binding.bind(session)
    const claimed = claimDagPanelFeed(session, {}, feedOf(() => [
      dagRun({ nodes: [dagNode({ id: "build", state: "running" })] }),
    ]))

    // when / then
    expect(binding.hasLive()).toBe(true)

    // when - the only node settles
    claimed.dispose()
    const settledClaim = claimDagPanelFeed(session, {}, feedOf(() => [
      dagRun({ nodes: [dagNode({ id: "build", state: "completed" })] }),
    ]))
    expect(binding.hasLive()).toBe(false)

    binding.dispose()
    settledClaim.dispose()
  })
})
