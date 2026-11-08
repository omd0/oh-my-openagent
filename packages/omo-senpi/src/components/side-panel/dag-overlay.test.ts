import { describe, expect, test } from "bun:test"

import { claimDagPanelFeed } from "../task/dag-panel-feed"
import type { DagBridgeRunSnapshot } from "../task/dag-snapshot-payload"
import { createDagBinding } from "./dag-binding"
import { createDagOverlay } from "./dag-overlay"
import { dagNode, dagRun } from "./dag-panel.test-support"
import type { PopupComponent } from "./popups/text-popup"
import { popupBudget } from "./popups/viewport"
import type { PanelTimerHandle, PanelTimers } from "./types"

const NOW = Date.parse("2026-11-08T00:05:00.000Z")

let sequence = 0

interface OverlayHarness {
  readonly overlay: PopupComponent
  /** Lines joined for containment checks on dynamic ids, labels and payloads. */
  readonly text: (width?: number) => string
  readonly lines: (width?: number) => string[]
  readonly closed: () => number
  readonly setRuns: (next: readonly DagBridgeRunSnapshot[]) => void
  readonly setActivity: (next: (runId: string, nodeId: string) => string | undefined) => void
  readonly dispose: () => void
}

function timers(): PanelTimers {
  return {
    set: () => 0 as PanelTimerHandle,
    clear: () => undefined,
  }
}

function overlayFor(
  initial: readonly DagBridgeRunSnapshot[],
  target: { readonly runId?: string; readonly nodeId?: string } = {},
  terminalRows = 40,
): OverlayHarness {
  sequence += 1
  const session = `session-dag-overlay-${sequence}`
  let runs = initial
  let activity = (_runId: string, _nodeId: string): string | undefined => undefined
  let closed = 0
  const binding = createDagBinding({ timers: timers(), onChange: () => undefined })
  binding.bind(session)
  const claimed = claimDagPanelFeed(session, {}, {
    runs: () => runs,
    activity: (runId, nodeId) => activity(runId, nodeId),
  })
  const overlay = createDagOverlay({ terminal: { rows: terminalRows }, requestRender: () => undefined }, undefined, {
    binding,
    now: () => NOW,
    close: () => {
      closed += 1
    },
    ...target,
  })
  return {
    overlay,
    text: (width = 60) => overlay.render(width).join("\n"),
    lines: (width = 60) => overlay.render(width),
    closed: () => closed,
    setRuns: (next) => {
      runs = next
    },
    setActivity: (next) => {
      activity = next
    },
    dispose: () => {
      binding.dispose()
      claimed.dispose()
    },
  }
}

function twoStepRun(overrides: Partial<DagBridgeRunSnapshot> = {}): DagBridgeRunSnapshot {
  return dagRun({
    runId: "run-two-step",
    name: "two step",
    nodes: [
      dagNode({ id: "node-plan", label: "Plan step", state: "completed", startedAt: "2026-11-08T00:00:00.000Z", completedAt: "2026-11-08T00:01:00.000Z" }),
      dagNode({
        id: "node-build",
        label: "Build step",
        state: "running",
        dependsOn: ["node-plan"],
        prompt: "compile the workspace",
        taskId: "st_build_1",
        startedAt: "2026-11-08T00:02:00.000Z",
      }),
    ],
    edges: [{ from: "node-plan", to: "node-build" }],
    ...overrides,
  })
}

describe("side panel dag overlay", () => {
  test("#given a run whose second node is running #when the overlay paints #then it shows the graph and that node's details", () => {
    // given
    const harness = overlayFor([twoStepRun()])
    harness.setActivity((_runId, nodeId) => (nodeId === "node-build" ? "compiling pkg/a" : undefined))

    // when
    const text = harness.text()

    // then
    expect(text).toContain("Plan step")
    expect(text).toContain("Build step")
    expect(text).toContain("compile the workspace")
    expect(text).toContain("st_build_1")
    expect(text).toContain("compiling pkg/a")
    // the dependency between the two layers is drawn, not only listed in the details
    expect(text).toContain("\u25bc")
    // the details belong to the running node, not the first one in the graph
    expect(text).toContain("node-build")
    expect(text).not.toContain("node-plan")

    harness.dispose()
  })

  test("#given an explicit node target #when the overlay opens #then that node is selected even while another node runs", () => {
    // given / when
    const harness = overlayFor([twoStepRun()], { runId: "run-two-step", nodeId: "node-plan" })
    const text = harness.text()

    // then
    expect(text).toContain("node-plan")
    expect(text).not.toContain("node-build")

    harness.dispose()
  })

  test("#given an open overlay #when the user walks the nodes #then tab and shift-tab move the selection and the paint keeps it by node id", () => {
    // given
    const harness = overlayFor([twoStepRun()])
    expect(harness.text()).toContain("node-build")

    // when
    harness.overlay.handleInput("\t")

    // then
    expect(harness.text()).toContain("node-plan")
    expect(harness.text()).not.toContain("node-build")

    // when - the run moves on under the overlay
    harness.setRuns([twoStepRun({ nodes: [
      dagNode({ id: "node-plan", label: "Plan step", state: "completed" }),
      dagNode({ id: "node-build", label: "Build step", state: "completed", dependsOn: ["node-plan"] }),
    ] })])

    // then - a repaint does not move the cursor onto the node that just finished
    expect(harness.text()).toContain("node-plan")

    // when
    harness.overlay.handleInput("\x1b[Z")

    // then
    expect(harness.text()).toContain("node-build")

    harness.dispose()
  })

  test("#given more graph than the viewport holds #when the user scrolls #then the window moves, clamps at both ends and never paints past the budget", () => {
    // given
    const nodes = Array.from({ length: 12 }, (_unused, index) => dagNode({ id: `node-${index}`, label: `Step ${index}` }))
    const harness = overlayFor([dagRun({ runId: "run-long", name: "long run", nodes })], {}, 20)
    const budget = popupBudget(20, 0.9)
    const first = harness.lines()
    expect(first.length).toBeLessThanOrEqual(budget.total)

    // when
    harness.overlay.handleInput("\x1b[6~")

    // then
    const scrolled = harness.lines()
    expect(scrolled.length).toBeLessThanOrEqual(budget.total)
    expect(scrolled[2]).not.toBe(first[2])

    // when - the user scrolls past the top
    for (let step = 0; step < 8; step += 1) harness.overlay.handleInput("\x1b[5~")

    // then - the window stops at the header row and further scrolling changes nothing
    const top = harness.lines()
    expect(top[2]).toContain("long run")
    harness.overlay.handleInput("\x1b[5~")
    expect(harness.lines()).toEqual(top)

    // when - the user overscrolls the end
    for (let step = 0; step < 8; step += 1) harness.overlay.handleInput("\x1b[6~")
    const end = harness.lines()

    // then
    harness.overlay.handleInput("\x1b[6~")
    expect(harness.lines()).toEqual(end)
    expect(end.length).toBeLessThanOrEqual(budget.total)

    harness.dispose()
  })

  test("#given a native wheel over the overlay #when it arrives #then the viewport moves, is claimed, and invalid input leaves it alone", () => {
    // given
    const nodes = Array.from({ length: 12 }, (_unused, index) => dagNode({ id: `node-${index}`, label: `Step ${index}` }))
    const harness = overlayFor([dagRun({ runId: "run-long", name: "long run", nodes })], {}, 20)
    const before = harness.lines().join("\n")

    // when
    const result = harness.overlay.handleMouse({ type: "wheel", wheelDelta: 3 })

    // then the host routes no wheel to the layout behind the overlay
    expect(result).toEqual({ handled: true })
    expect(harness.lines().join("\n")).not.toBe(before)

    // when unusable wheels arrive they are ignored and the view does not move
    const settled = harness.lines().join("\n")
    expect(harness.overlay.handleMouse({ type: "wheel" })).toBeUndefined()
    expect(harness.overlay.handleMouse({ type: "wheel", wheelDelta: Number.NaN })).toBeUndefined()
    expect(harness.overlay.handleMouse({ type: "click", wheelDelta: 3 })).toBeUndefined()
    expect(harness.lines().join("\n")).toBe(settled)

    harness.dispose()
  })

  test("#given line and page keys #when pressed #then the overlay window moves one row and one page", () => {
    // given
    const nodes = Array.from({ length: 12 }, (_unused, index) => dagNode({ id: `node-${index}`, label: `Step ${index}` }))
    const harness = overlayFor([dagRun({ runId: "run-long", name: "long run", nodes })], {}, 20)
    const first = harness.lines().join("\n")

    // when
    harness.overlay.handleInput("\x1b[6~")
    const afterPage = harness.lines().join("\n")
    harness.overlay.handleInput("\x1b[A")
    const afterLineUp = harness.lines().join("\n")

    // then
    expect(afterPage).not.toBe(first)
    expect(afterLineUp).not.toBe(afterPage)

    harness.dispose()
  })

  test("#given close keys #when pressed #then the overlay closes, and an unbound key leaves it open", () => {
    // given
    const keys = ["q", "\x1b", "\x1b[27u"]
    const closes = keys.map((key) => {
      const harness = overlayFor([twoStepRun()])
      harness.overlay.handleInput(key)
      const closed = harness.closed()
      harness.dispose()
      return closed
    })

    // when / then
    expect(closes).toEqual([1, 1, 1])

    // when - navigation and scrolling must not close the viewer
    const open = overlayFor([twoStepRun()])
    open.overlay.handleInput("\t")
    open.overlay.handleInput("\x1b[B")
    open.overlay.handleInput("r")

    // then
    expect(open.closed()).toBe(0)
    open.dispose()
  })

  test("#given two runs #when the user cycles runs #then the next run is drawn with its own first node selected", () => {
    // given
    const alpha = dagRun({ runId: "run-alpha", name: "alpha run", nodes: [dagNode({ id: "alpha-node", label: "Alpha step" })] })
    const beta = dagRun({ runId: "run-beta", name: "beta run", nodes: [dagNode({ id: "beta-node", label: "Beta step" })] })
    const harness = overlayFor([alpha, beta])

    // then - the overlay opens on the first run
    expect(harness.text()).toContain("alpha run")
    expect(harness.text()).toContain("alpha-node")

    // when
    harness.overlay.handleInput("r")

    // then
    expect(harness.text()).toContain("beta run")
    expect(harness.text()).toContain("beta-node")
    expect(harness.text()).not.toContain("alpha-node")

    harness.dispose()
  })

  test("#given the selected node fails while the overlay is open #when it repaints #then the failure replaces the live activity", () => {
    // given
    const harness = overlayFor([twoStepRun()])
    harness.setActivity((_runId, nodeId) => (nodeId === "node-build" ? "compiling pkg/a" : undefined))
    expect(harness.text()).toContain("compiling pkg/a")

    // when
    harness.setRuns([twoStepRun({ nodes: [
      dagNode({ id: "node-plan", label: "Plan step", state: "completed" }),
      dagNode({
        id: "node-build",
        label: "Build step",
        state: "failed",
        dependsOn: ["node-plan"],
        attempt: 2,
        error: { code: "task_error", message: "child exited 7" },
      }),
    ] })])

    // then
    const text = harness.text()
    expect(text).toContain("child exited 7")
    expect(text).toContain("task_error")
    expect(text).not.toContain("compiling pkg/a")
    expect(text).toContain("node-build")

    harness.dispose()
  })

  test("#given no runs in the session #when the overlay paints #then it closes a frame without any node detail", () => {
    // given
    const harness = overlayFor([])

    // when
    const lines = harness.lines()

    // then
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(popupBudget(40, 0.9).total)
    expect(harness.text()).not.toContain("node-")
    expect(harness.closed()).toBe(0)

    harness.dispose()
  })

  test("#given a run whose dependencies cycle #when the overlay paints #then it reports the problem and stays usable", () => {
    // given
    const harness = overlayFor([
      dagRun({ runId: "run-cycle", nodes: [dagNode({ id: "ping", dependsOn: ["pong"] }), dagNode({ id: "pong", dependsOn: ["ping"] })] }),
    ])

    // when
    const lines = harness.lines()

    // then
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes("│"))).toBe(true)
    harness.overlay.handleInput("\t")
    expect(harness.closed()).toBe(0)

    harness.dispose()
  })
})
