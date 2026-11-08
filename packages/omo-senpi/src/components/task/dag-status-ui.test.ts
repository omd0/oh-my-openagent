import { describe, expect, it } from "bun:test"

import { Theme } from "../../senpi-test-runtime"
import type { CapturedUi, WidgetFactory } from "./runtime-context"
import {
  createDagStatusUi,
  DAG_STATUS_UI_KEY,
  type DagStatusActivityEvent,
  type DagStatusNode,
  type DagStatusRunSnapshot,
  type DagStatusUiManager,
  type DagStatusUiTimers,
} from "./dag-status-ui"
import { visibleDagWorkers } from "./dag-status-inline"

interface FakeUi extends CapturedUi {
  readonly widgetCalls: Array<{ key: string; content: string[] | WidgetFactory | undefined; placement: string | undefined }>
}

function fakeUi(): FakeUi {
  const widgetCalls: Array<{ key: string; content: string[] | WidgetFactory | undefined; placement: string | undefined }> = []
  return {
    widgetCalls,
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (key, content, options) => widgetCalls.push({ key, content, placement: options?.placement }),
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

// The factory renders through the real host Theme (same truecolor stub shape as
// message-renderers.test.ts); assertions strip ANSI and read text behavior.
const TEST_FG_COLORS = {
  accent: "#000000",
  bashMode: "#000000",
  border: "#000000",
  borderAccent: "#000000",
  borderMuted: "#000000",
  customMessageLabel: "#000000",
  customMessageText: "#000000",
  dim: "#000000",
  error: "#000000",
  mdCode: "#000000",
  mdCodeBlock: "#000000",
  mdCodeBlockBorder: "#000000",
  mdHeading: "#000000",
  mdHr: "#000000",
  mdLink: "#000000",
  mdLinkUrl: "#000000",
  mdListBullet: "#000000",
  mdQuote: "#000000",
  mdQuoteBorder: "#000000",
  muted: "#000000",
  success: "#000000",
  syntaxComment: "#000000",
  syntaxFunction: "#000000",
  syntaxKeyword: "#000000",
  syntaxNumber: "#000000",
  syntaxOperator: "#000000",
  syntaxPunctuation: "#000000",
  syntaxString: "#000000",
  syntaxType: "#000000",
  syntaxVariable: "#000000",
  text: "#000000",
  thinkingHigh: "#000000",
  thinkingLow: "#000000",
  thinkingMax: "#000000",
  thinkingMedium: "#000000",
  thinkingMinimal: "#000000",
  thinkingOff: "#000000",
  thinkingText: "#000000",
  thinkingXhigh: "#000000",
  toolDiffAdded: "#000000",
  toolDiffContext: "#000000",
  toolDiffRemoved: "#000000",
  toolOutput: "#000000",
  toolTitle: "#000000",
  userMessageText: "#000000",
  warning: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[0]
const TEST_BG_COLORS = {
  customMessageBg: "#000000",
  selectedBg: "#000000",
  toolErrorBg: "#000000",
  toolPendingBg: "#000000",
  toolSuccessBg: "#000000",
  userMessageBg: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[1]
const TEST_THEME = new Theme(TEST_FG_COLORS, TEST_BG_COLORS, "truecolor")

const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]/gu
const OSC_PATTERN = /\][^\u0007]*(?:\u0007|\\)/gu

function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, "").replace(OSC_PATTERN, "")
}

/**
 * The last widget write as painted text. A factory is invoked the way the host
 * does (theme in, rows out); a tracking line stays a string array; a cleared
 * widget stays undefined.
 */
function renderedRows(ui: FakeUi, width = 200): string[] | undefined {
  const content = ui.widgetCalls.at(-1)?.content
  if (content === undefined) return undefined
  if (Array.isArray(content)) return content
  return content(undefined, TEST_THEME).render(width).map(stripAnsi)
}

interface FakeTimers extends DagStatusUiTimers {
  readonly pending: Map<number, { callback: () => void; ms: number }>
  advance(ms: number): void
}

// Deterministic timer seam: no real sleeps, callbacks fire only when the test advances the clock.
function fakeTimers(): FakeTimers {
  const pending = new Map<number, { callback: () => void; ms: number }>()
  let nextHandle = 1
  let elapsed = 0
  const due = new Map<number, number>()
  return {
    pending,
    set: (callback, ms) => {
      const handle = nextHandle++
      pending.set(handle, { callback, ms })
      due.set(handle, elapsed + ms)
      return handle
    },
    clear: (handle) => {
      if (typeof handle !== "number") return
      pending.delete(handle)
      due.delete(handle)
    },
    advance: (ms) => {
      elapsed += ms
      for (const [handle, deadline] of [...due]) {
        if (deadline > elapsed) continue
        const entry = pending.get(handle)
        due.delete(handle)
        pending.delete(handle)
        entry?.callback()
      }
    },
  }
}

function node(overrides: Partial<DagStatusNode> & { id: string; state: DagStatusNode["state"] }): DagStatusNode {
  return {
    label: overrides.id,
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    ...overrides,
  }
}

function snapshot(overrides: Partial<DagStatusRunSnapshot> & { runId: string }): DagStatusRunSnapshot {
  const nodes = overrides.nodes ?? []
  return {
    name: "ship-it",
    status: "running",
    waves: [{ index: 0, nodeIds: nodes.map((entry) => entry.id) }],
    ...overrides,
    nodes,
  }
}

interface FakeManager extends DagStatusUiManager {
  set(runs: readonly DagStatusRunSnapshot[]): void
  readonly snapshotCalls: string[]
}

function fakeManager(initial: readonly DagStatusRunSnapshot[], sessionId = "session-a"): FakeManager {
  let runs = initial
  const snapshotCalls: string[] = []
  return {
    snapshotCalls,
    set: (next) => { runs = next },
    list: (parentSessionId) =>
      parentSessionId !== sessionId ? [] : runs.map((run) => ({ runId: run.runId, status: run.status })),
    snapshot: (runId, parentSessionId) => {
      snapshotCalls.push(runId)
      const found = runs.find((run) => run.runId === runId)
      if (found === undefined || parentSessionId !== sessionId) throw new Error(`unknown dag run "${runId}"`)
      return found
    },
  }
}

function activity(overrides: Partial<DagStatusActivityEvent> & { runId: string; nodeId: string }): DagStatusActivityEvent {
  return {
    taskId: "st_1",
    activity: "running",
    turns: 1,
    ...overrides,
  }
}

function rowsOf(ui: FakeUi): string[] {
  return renderedRows(ui) ?? []
}

function rowFor(rows: readonly string[], nodeId: string): string {
  const row = rows.find((line) => line.includes(`/root/${nodeId}`))
  if (row === undefined) throw new Error(`expected a painted row for node "${nodeId}": ${JSON.stringify(rows)}`)
  return row
}

describe("createDagStatusUi.syncNow", () => {
  it("#given a run transitioning across node states #when syncing after each transition #then the rows track the states", () => {
    // given
    const manager = fakeManager([
      snapshot({
        runId: "dag_1",
        status: "pending",
        nodes: [
          node({ id: "plan", state: "pending" }),
          node({ id: "build", state: "pending", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()
    const pendingRows = rowsOf(ui)

    manager.set([
      snapshot({
        runId: "dag_1",
        status: "running",
        nodes: [
          node({ id: "plan", state: "running" }),
          node({ id: "build", state: "blocked", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    dagUi.syncNow()
    const runningRows = rowsOf(ui)

    manager.set([
      snapshot({
        runId: "dag_1",
        status: "running",
        nodes: [
          node({ id: "plan", state: "completed" }),
          node({ id: "build", state: "failed", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    dagUi.syncNow()
    const settledRows = rowsOf(ui)

    // then the factory paints one row per node with the live state badge, and the
    // heading tracks the live count as nodes settle
    expect(rowFor(pendingRows, "plan")).toContain("[starting]")
    expect(rowFor(pendingRows, "build")).toContain("[starting]")
    expect(pendingRows[0]).toContain("2 live")
    expect(rowFor(runningRows, "plan")).toContain("[running]")
    expect(rowFor(runningRows, "build")).toContain("[starting]")
    expect(rowFor(settledRows, "plan")).toContain("[completed]")
    expect(rowFor(settledRows, "build")).toContain("[failed]")
    expect(settledRows[0]).toContain("0 live")
  })

  it("#given a node re-run by retry #when syncing #then only the retried node carries an xN badge", () => {
    // given a node on its third attempt beside a first-attempt sibling and a legacy node with no
    // attempt on the record at all
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          nodes: [
            node({ id: "plan", state: "completed", attempt: 1 }),
            node({ id: "build", state: "running", attempt: 3 }),
            node({ id: "ship", state: "pending" }),
          ],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then only the retried row carries the attempt badge; the sibling rows do not
    const rows = rowsOf(ui)
    expect(rowFor(rows, "build")).toContain("x3")
    expect(rowFor(rows, "plan")).not.toContain("x")
    expect(rowFor(rows, "ship")).not.toContain("x")
  })

  it("#given skipped and paused nodes #when syncing #then each state renders its own icon", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          status: "paused",
          nodes: [node({ id: "a", state: "skipped" }), node({ id: "b", state: "cancelled" })],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then terminal-but-parked nodes share the stopped badge while the heading
    // shows no live work, instead of blanking the widget while the run is live
    const rows = rowsOf(ui)
    expect(rows[0]).toContain("0 live")
    expect(rowFor(rows, "a")).toContain("[stopped]")
    expect(rowFor(rows, "b")).toContain("[stopped]")
  })

  it("#given a run header #when syncing #then the header carries the node counts", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          nodes: [
            node({ id: "a", state: "completed" }),
            node({ id: "b", state: "running" }),
            node({ id: "c", state: "failed" }),
            node({ id: "d", state: "pending" }),
          ],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then the heading carries the live/paused counts and every node paints its
    // own state badge alongside its identity
    const rows = rowsOf(ui)
    expect(rows[0]).toContain("2 live")
    expect(rows[0]).toContain("0 paused")
    expect(rowFor(rows, "a")).toContain("[completed]")
    expect(rowFor(rows, "b")).toContain("[running]")
    expect(rowFor(rows, "c")).toContain("[failed]")
    expect(rowFor(rows, "d")).toContain("[starting]")
  })

  it("#given a non-tui run mode #when syncing #then nothing renders", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "rpc" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "read package.json" }))

    // then
    expect(ui.widgetCalls).toHaveLength(0)
  })

  it("#given every run terminal #when syncing #then the widget is cleared", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    expect(rowsOf(ui)).not.toHaveLength(0)

    // when
    manager.set([
      snapshot({ runId: "dag_1", status: "completed", nodes: [node({ id: "a", state: "completed" })] }),
    ])
    dagUi.syncNow()

    // then
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
    expect(ui.widgetCalls.at(-1)?.key).toBe(DAG_STATUS_UI_KEY)
    expect(timers.pending.size).toBe(0)
  })

  it("#given a live run #when the widget renders #then it uses the dag key below the editor", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running", startedAt: new Date(0).toISOString() })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(ui.widgetCalls.at(-1)?.key).toBe("omo-dag")
    expect(DAG_STATUS_UI_KEY).not.toBe("omo-task")
    expect(ui.widgetCalls.at(-1)?.placement).toBe("belowEditor")
  })

  it("#given a terminal width seam #when rendering the same run at two widths #then the row adapts and the node identity survives the narrow budget", () => {
    // given one running node whose live activity is long enough to need the width budget
    const manager = fakeManager([
      snapshot({
        runId: "dag_1",
        nodes: [node({ id: "wide-node", state: "running", startedAt: new Date(0).toISOString() })],
      }),
    ])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
      terminalWidth: () => 120,
      now: () => 95_000,
    })
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "wide-node", activity: "running bash grep -rn scheduler-claim packages and reporting the wave manifest drift" }))
    dagUi.syncNow()
    const content = ui.widgetCalls.at(-1)?.content
    if (typeof content !== "function") throw new Error("expected the live run to paint a themed factory")
    const wide = content(undefined, TEST_THEME).render(200).map(stripAnsi)
    const wideRow = rowFor(wide, "wide-node")

    // when the same run is painted for a narrow terminal
    const narrow = content(undefined, TEST_THEME).render(50).map(stripAnsi)
    const narrowRow = rowFor(narrow, "wide-node")

    // then the wide row carries the full activity, the narrow row drops it but
    // keeps the node identity and its live badge
    expect(wideRow).toContain("scheduler-claim")
    expect(narrowRow).toContain("/root/wide-node")
    expect(narrowRow).toContain("[running]")
    expect(narrowRow).not.toContain("scheduler-claim")
  })
})

describe("createDagStatusUi.scheduleSync", () => {
  it("#given a burst of scheduled syncs #when the debounce window elapses #then exactly one render happens", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      debounceMs: 250,
    })

    // when
    dagUi.scheduleSync()
    dagUi.scheduleSync()
    dagUi.scheduleSync()
    expect(ui.widgetCalls).toHaveLength(0)
    timers.advance(250)

    // then
    expect(ui.widgetCalls).toHaveLength(1)
    dagUi.dispose()
  })

  it("#given a nonterminal run #when the refresh interval elapses without input #then the widget repaints", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    const afterFirst = ui.widgetCalls.length

    // when
    timers.advance(1_000)

    // then
    expect(ui.widgetCalls.length).toBeGreaterThan(afterFirst)
    dagUi.dispose()
  })

  it("#given a disposed widget #when timers advance #then no further render happens", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    const rendered = ui.widgetCalls.length

    // when
    dagUi.dispose()
    timers.advance(10_000)

    // then
    expect(ui.widgetCalls).toHaveLength(rendered)
    expect(timers.pending.size).toBe(0)
  })
})

describe("createDagStatusUi.onActivity", () => {
  it("#given repeated activity for one node #when rendering #then only the latest activity shows", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })

    // when
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "read package.json" }))
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "edit manager.ts" }))
    timers.advance(250)

    // then the painted row carries only the latest activity for the node
    const nodeRow = rowFor(rowsOf(ui), "a")
    expect(nodeRow).toContain("edit manager.ts")
    expect(nodeRow).not.toContain("read package.json")
  })

  it("#given a completed node #when its stale activity is still known #then the row shows no activity text", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "edit manager.ts" }))
    timers.advance(250)

    // when
    manager.set([
      snapshot({
        runId: "dag_1",
        nodes: [node({ id: "a", state: "completed" }), node({ id: "b", state: "running" })],
      }),
    ])
    dagUi.syncNow()

    // then the live row leads and the completed row paints its badge with no
    // stale activity text
    const rows = rowsOf(ui)
    expect(rowFor(rows, "b")).toContain("[running]")
    expect(rowFor(rows, "a")).toContain("[completed]")
    expect(rowFor(rows, "a")).not.toContain("edit manager.ts")
    dagUi.dispose()
  })

  it("#given an activity event for an unknown run #when it arrives #then it is ignored without throwing", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })

    // when
    expect(() => dagUi.onActivity(activity({ runId: "dag_missing", nodeId: "ghost", activity: "wandering" }))).not.toThrow()
    timers.advance(250)

    // then the painted rows still cover only the known run with no trace of the stray text
    const rows = rowsOf(ui)
    expect(rowFor(rows, "a")).toContain("[running]")
    expect(rows.join("\n")).not.toContain("wandering")
    dagUi.dispose()
  })

  it("#given a run that disappears between list and snapshot #when syncing #then the run is skipped without throwing", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const listOnlyManager: DagStatusUiManager = {
      list: manager.list,
      snapshot: (runId, parentSessionId) => {
        if (runId === "dag_gone") throw new Error("run_not_found")
        return manager.snapshot(runId, parentSessionId)
      },
    }
    const dagUi = createDagStatusUi({
      manager: {
        list: (parentSessionId) => [
          ...listOnlyManager.list(parentSessionId),
          { runId: "dag_gone", status: "running" },
        ],
        snapshot: listOnlyManager.snapshot,
      },
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    expect(() => dagUi.syncNow()).not.toThrow()

    // then the surviving run still paints while the pruned one is skipped
    const rows = rowsOf(ui)
    expect(rowFor(rows, "a")).toContain("[running]")
    expect(rows.join("\n")).not.toContain("dag_gone")
  })

  it("#given no session id #when syncing #then no run is queried and nothing renders", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => undefined, mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(manager.snapshotCalls).toHaveLength(0)
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
  })
})


describe("createDagStatusUi activity coexistence", () => {
  it("#given live activity for a running node #when reading the accessor and painting the inline watcher #then all three agree on the latest text", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })

    // when
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "read package.json" }))
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "edit manager.ts" }))

    // then the accessor holds the latest text and nothing for unknown nodes
    expect(dagUi.activity("dag_1", "a")).toBe("edit manager.ts")
    expect(dagUi.activity("dag_1", "ghost")).toBeUndefined()
    expect(dagUi.activity("dag_missing", "a")).toBeUndefined()

    // and the painted factory rows carry that same latest text
    dagUi.syncNow()
    const rows = rowsOf(ui)
    const nodeRow = rowFor(rows, "a")
    expect(nodeRow).toContain("[running]")
    expect(nodeRow).toContain("edit manager.ts")
    expect(nodeRow).not.toContain("read package.json")

    // and the inline watcher worker list covers exactly the painted node
    const live = manager.snapshot("dag_1", "session-a")
    expect(visibleDagWorkers([live], Date.now())).toEqual([{ runId: "dag_1", nodeId: "a" }])
    dagUi.dispose()
  })
})


// #7316: a live run whose snapshot projection fails (or whose session filter yields nothing) used
// to clear the widget outright, which reads to the user as "the DAG died".
describe("createDagStatusUi live-run visibility", () => {
  it("#given a live run whose snapshot throws #when syncing #then the widget is not cleared to undefined", () => {
    // given a manager that lists one running run but cannot project it
    const manager: DagStatusUiManager = {
      list: () => [{ runId: "dag_x", status: "running" }],
      snapshot: () => {
        throw new Error("checkpoint unreadable")
      },
    }
    const ui = fakeUi()
    const statusUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
    })

    // when
    statusUi.syncNow()

    // then the widget was never blanked while the run is still live
    const cleared = ui.widgetCalls.filter((call) => call.key === DAG_STATUS_UI_KEY && call.content === undefined)
    expect(cleared).toEqual([])
    statusUi.dispose()
  })
})
