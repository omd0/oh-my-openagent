import { describe, expect, it } from "bun:test"

import { TUI, type Terminal } from "@earendil-works/pi-tui"
import type { Theme as HostTheme } from "@code-yeongyu/senpi"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { Theme } from "../../senpi-test-runtime"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createWatchHolder, type WatchHolder } from "./watch-mount"
import type { DagWatchNode, DagWatchPort, DagWatchRun } from "./dag-subagent-service"
import {
  registerDagCommands,
  type DagCommandManager,
  type DagCommandNode,
  type DagCommandRunSnapshot,
  type DagCommandRunSummary,
  type DagCommandTaskRecord,
} from "./dag-commands"

interface FakeCommandUi {
  readonly notifications: Array<{ message: string; type?: string }>
  readonly selectCalls: Array<{ title: string; options: string[] }>
  select: (title: string, options: string[]) => Promise<string | undefined>
  confirm: (title: string, message: string) => Promise<boolean>
  notify: (message: string, type?: string) => void
}

function commandCtx(
  sessionId: string | undefined,
  select?: (title: string, options: string[]) => Promise<string | undefined>,
): { ctx: unknown; ui: FakeCommandUi } {
  const notifications: Array<{ message: string; type?: string }> = []
  const selectCalls: Array<{ title: string; options: string[] }> = []
  const uiImpl: FakeCommandUi = {
    notifications,
    selectCalls,
    select: (title, options) => {
      selectCalls.push({ title, options })
      return (select ?? (() => Promise.resolve(undefined)))(title, options)
    },
    confirm: () => Promise.resolve(true),
    notify: (message, type) => notifications.push({ message, type }),
  }
  const ctx = {
    mode: "tui",
    ui: uiImpl,
    sessionManager: { getSessionId: () => sessionId ?? "unknown" },
  }
  return { ctx, ui: uiImpl }
}

function node(overrides: Partial<DagCommandNode> & { id: string }): DagCommandNode {
  return {
    state: "completed",
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    attempt: 1,
    ...overrides,
  }
}

// A diamond: seed fans out to left/right, both feed join. left is the slow arm, so the critical
// path runs seed -> left -> join and left is the bottleneck blocking join.
function diamondSnapshot(): DagCommandRunSnapshot {
  return {
    runId: "dag_diamond",
    name: "release audit",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    nodes: [
      node({
        id: "seed",
        label: "collect inputs",
        state: "completed",
        route: { kind: "category", category: "quick" },
        taskId: "st_seed",
        startedAt: "2026-08-14T00:00:00.000Z",
        completedAt: "2026-08-14T00:00:02.000Z",
      }),
      node({
        id: "left",
        label: "deep review",
        state: "running",
        route: { kind: "agent", agent: "reviewer", model: "anthropic/claude-opus-4-1" },
        dependsOn: ["seed"],
        taskId: "st_left",
        attempt: 2,
        startedAt: "2026-08-14T00:00:02.000Z",
      }),
      node({
        id: "right",
        label: "quick lint",
        state: "failed",
        route: { kind: "category", category: "quick" },
        dependsOn: ["seed"],
        taskId: "st_right",
        startedAt: "2026-08-14T00:00:02.000Z",
        completedAt: "2026-08-14T00:00:03.000Z",
        error: { code: "task_error", message: "lint exited 1" },
      }),
      node({ id: "join", label: "merge report", state: "blocked", dependsOn: ["left", "right"] }),
    ],
    edges: [
      { from: "seed", to: "left" },
      { from: "seed", to: "right" },
      { from: "left", to: "join" },
      { from: "right", to: "join" },
    ],
    waves: [
      { index: 0, nodeIds: ["seed"] },
      { index: 1, nodeIds: ["left", "right"] },
      { index: 2, nodeIds: ["join"] },
    ],
    criticalPath: ["seed", "left", "join"],
    bottlenecks: [{ nodeId: "left", blockedCount: 1 }],
  }
}

function fakeManager(
  summaries: readonly DagCommandRunSummary[],
  snapshots: Readonly<Record<string, DagCommandRunSnapshot>> = {},
  tasks: Readonly<Record<string, DagCommandTaskRecord>> = {},
): DagCommandManager {
  return {
    list: (parentSessionId) => summaries.filter((summary) => summary.parentSessionId === parentSessionId),
    snapshot: (runId, parentSessionId) => {
      const found = snapshots[runId]
      if (found === undefined) throw new Error(`unknown dag run "${runId}"`)
      const owner = summaries.find((summary) => summary.runId === runId)?.parentSessionId
      if (owner !== undefined && owner !== parentSessionId) throw new Error(`dag run "${runId}" belongs to another session`)
      return found
    },
    taskRecord: (taskId) => tasks[taskId],
  }
}

function summary(overrides: Partial<DagCommandRunSummary> & { runId: string }): DagCommandRunSummary {
  return {
    name: "run",
    parentSessionId: "session-a",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:05.000Z",
    counts: { total: 4, completed: 1, running: 1, failed: 0 },
    ...overrides,
  }
}

async function invoke(pi: FakeExtensionAPI, args: string, ctx: unknown): Promise<void> {
  const command = pi.commands.find((entry) => entry.name === "dag")
  if (command === undefined) throw new Error("command dag not registered")
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, ctx)
}

describe("registerDagCommands", () => {
  it("#given the component registers commands #when inspecting the api #then /dag exists", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    registerDagCommands(pi, fakeManager([]))

    // then
    expect(pi.commands.map((entry) => entry.name)).toEqual(["dag"])
  })

  it("#given runs in two sessions #when /dag runs with no argument #then this session's runs print with statuses", async () => {
    // given
    const mine = summary({ runId: "dag_mine", name: "release audit", status: "running" })
    const done = summary({ runId: "dag_done", name: "nightly sweep", status: "completed", counts: { total: 3, completed: 3, running: 0, failed: 0 } })
    const other = summary({ runId: "dag_other", name: "foreign", parentSessionId: "session-b" })
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([mine, done, other]))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "", ctx)

    // then
    const printed = ui.notifications.map((entry) => entry.message).join("\n")
    expect(printed).toContain("dag_mine")
    expect(printed).toContain("release audit")
    expect(printed).toContain("running")
    expect(printed).toContain("dag_done")
    expect(printed).toContain("completed")
    expect(printed).not.toContain("dag_other")
  })

  it("#given a diamond run #when /dag <id> runs #then waves group nodes with dependency annotations", async () => {
    // given
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond", name: "release audit" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then the tree is wave-grouped and every dependent node names what it waits on
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    const waveHeaders = lines.filter((line) => line.startsWith("wave "))
    expect(waveHeaders).toEqual(["wave 1/3", "wave 2/3", "wave 3/3"])
    const seedLine = lines.find((line) => line.includes("collect inputs"))
    const leftLine = lines.find((line) => line.includes("deep review"))
    const joinLine = lines.find((line) => line.includes("merge report"))
    expect(seedLine).not.toContain("after ")
    expect(leftLine).toContain("after seed")
    expect(joinLine).toContain("after left, right")
    // and node rows are indented under their wave header
    expect(leftLine?.startsWith("  ")).toBe(true)
  })

  it("#given a diamond run #when /dag <id> runs #then per-node state, route, model, attempt, duration and error render", async () => {
    // given
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    const tasks: Record<string, DagCommandTaskRecord> = {
      st_left: { model: "anthropic/claude-opus-4-1", resolved_model: { display: "opus-4.1-high" } },
    }
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }, tasks))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    const leftLine = lines.find((line) => line.includes("deep review")) ?? ""
    expect(leftLine).toContain("running")
    expect(leftLine).toContain("agent:reviewer")
    expect(leftLine).toContain("model:opus-4.1-high")
    expect(leftLine).toContain("x2")
    const seedLine = lines.find((line) => line.includes("collect inputs")) ?? ""
    expect(seedLine).toContain("category:quick")
    expect(seedLine).toContain("2.0s")
    const rightLine = lines.find((line) => line.includes("quick lint")) ?? ""
    expect(rightLine).toContain("error: task_error lint exited 1")
  })

  it("#given a diamond run #when /dag <id> runs #then the critical path and bottleneck are marked", async () => {
    // given the slow arm (left) carries the critical path and blocks join
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then only critical-path nodes carry the marker
    const printed = ui.notifications.map((entry) => entry.message).join("\n")
    const lines = printed.split("\n")
    expect(lines.find((line) => line.includes("deep review"))).toContain("*critical*")
    expect(lines.find((line) => line.includes("quick lint"))).not.toContain("*critical*")
    expect(printed).toContain("critical path: seed -> left -> join")
    expect(printed).toContain("bottleneck: left blocks 1")
  })

  it("#given a retried run #when /dag <id> runs #then only re-run nodes carry the xN badge and the failure line names its code", async () => {
    // given left is on attempt 2 after a retry, seed and right never re-ran
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: diamondSnapshot() }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    expect(lines.find((line) => line.includes("deep review"))).toContain("x2")
    expect(lines.find((line) => line.includes("collect inputs"))).not.toContain("x2")
    expect(lines.find((line) => line.includes("quick lint"))).toContain("error: task_error lint exited 1")
  })

  it("#given an amended run #when /dag <id> runs #then the header carries an amended xN marker", async () => {
    // given the definition was amended twice
    const snapshot = { ...diamondSnapshot(), amendHistory: [{ at: "2026-08-14T00:01:00.000Z" }, { at: "2026-08-14T00:02:00.000Z" }] }
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const header = ui.notifications.map((entry) => entry.message).join("\n").split("\n")[0] ?? ""
    expect(header).toContain("amended x2")
  })

  it("#given a run that was never amended #when /dag <id> runs #then no amended marker renders", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: { ...diamondSnapshot(), amendHistory: [] } }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    expect(ui.notifications.map((entry) => entry.message).join("\n")).not.toContain("amended")
  })

  it("#given an unknown run id #when /dag <id> runs #then it notifies instead of throwing", async () => {
    // given a manager that only knows another run
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_known" })], { dag_known: diamondSnapshot() }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_nope", ctx)

    // then
    expect(ui.notifications).toHaveLength(1)
    expect(ui.notifications[0]?.message).toContain("dag_nope")
    expect(ui.notifications[0]?.message).toContain("No dag run")
    expect(ui.notifications[0]?.type).toBe("warning")
  })

  it("#given a session with zero runs #when /dag runs #then the empty state prints", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_other", parentSessionId: "session-b" })]))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "", ctx)

    // then
    expect(ui.notifications).toHaveLength(1)
    expect(ui.notifications[0]?.message).toBe("No dag runs in this session.")
  })

  it("#given no session id #when /dag runs #then the empty state prints and the manager is never queried", async () => {
    // given a context whose session manager is missing entirely
    let listed = 0
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, {
      list: (parentSessionId) => {
        listed += 1
        void parentSessionId
        return []
      },
      snapshot: () => {
        throw new Error("unreachable")
      },
      taskRecord: () => undefined,
    })
    const notifications: string[] = []
    const ctx = { mode: "tui", ui: { notify: (message: string) => notifications.push(message), select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(true) } }

    // when
    await invoke(pi, "", ctx)

    // then
    expect(listed).toBe(0)
    expect(notifications).toEqual(["No dag runs in this session."])
  })
})

describe("registerDagCommands /dag watch", () => {
  // The overlay host surface as the mount seam uses it. A real TUI over an
  // in-memory terminal: never touches stdin/stdout, writes buffer, start/stop
  // are no-ops, dimensions fixed. The TUI itself is never started.
  class MemoryTerminal implements Terminal {
    private readonly chunks: string[] = []
    start(): void {}
    stop(): void {}
    async drainInput(): Promise<void> {}
    write(data: string): void {
      this.chunks.push(data)
    }
    get columns(): number {
      return 80
    }
    get rows(): number {
      return 24
    }
    get kittyProtocolActive(): boolean {
      return false
    }
    moveBy(): void {}
    hideCursor(): void {}
    showCursor(): void {}
    clearLine(): void {}
    clearFromCursor(): void {}
    clearScreen(): void {}
    setTitle(): void {}
    setProgress(): void {}
  }

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

  interface DagWatchSetup {
    readonly pi: FakeExtensionAPI
    readonly ctx: unknown
    readonly holder: WatchHolder
    readonly tui: TUI
    readonly notifications: Array<{ message: string; type?: string }>
    readonly selectCalls: Array<{ title: string; options: string[] }>
    readonly snapshotCalls: Array<{ runId: string; parentSessionId: string }>
    readonly listCalls: string[]
    readonly customCalls: () => number
    readonly surfaces: unknown[]
    readonly setSessionId: (next: string) => void
  }

  function dagNode(overrides: Partial<DagWatchNode> & { id: string }): DagWatchNode {
    return {
      state: "running",
      route: { kind: "category", category: "quick" },
      dependsOn: [],
      attempt: 1,
      createdAt: "2026-08-14T00:00:00.000Z",
      ...overrides,
    }
  }

  function dagWatchSetup(
    opts: {
      readonly runs?: Readonly<Record<string, DagWatchRun>>
      readonly summaries?: readonly { runId: DagRunId; name: string; status: string; parentSessionId: string }[]
      readonly mode?: string
      readonly holder?: WatchHolder
      readonly select?: (title: string, options: string[]) => Promise<string | undefined>
      readonly invokeFactory?: boolean
    } = {},
  ): DagWatchSetup {
    const notifications: DagWatchSetup["notifications"] = []
    const selectCalls: DagWatchSetup["selectCalls"] = []
    const snapshotCalls: DagWatchSetup["snapshotCalls"] = []
    const listCalls: string[] = []
    const surfaces: unknown[] = []
    let customCalls = 0
    let sessionId = "session-a"
    const holder = opts.holder ?? createWatchHolder()
    const runs = opts.runs ?? {}
    const summaries = opts.summaries ?? [{ runId: "dag_live" as DagRunId, name: "release audit", status: "running", parentSessionId: "session-a" }]
    const port: DagWatchPort = {
      list: (parentSessionId) => {
        listCalls.push(parentSessionId)
        return summaries
          .filter((entry) => entry.parentSessionId === parentSessionId)
          .map((entry) => ({ runId: entry.runId, name: entry.name, status: entry.status }))
      },
      snapshot: (runId, parentSessionId) => {
        snapshotCalls.push({ runId, parentSessionId })
        const run = runs[runId]
        if (run === undefined) throw new Error(`unknown dag run "${runId}"`)
        return run
      },
      send: () => Promise.resolve({ delivery: "steer" }),
      taskRecord: () => undefined,
    }
    const tui = new TUI(new MemoryTerminal())
    const fakeTheme = TEST_THEME
    const ui = {
      notify: (message: string, type?: "info" | "warning" | "error") => notifications.push({ message, type }),
      select: (title: string, options: string[]) => {
        selectCalls.push({ title, options })
        return (opts.select ?? (() => Promise.resolve(undefined)))(title, options)
      },
      confirm: () => Promise.resolve(true),
      custom: async (factory: (tui: TUI, theme: HostTheme, keys: unknown, done: (value?: unknown) => void) => unknown) => {
        customCalls += 1
        if (opts.invokeFactory !== true) return
        await new Promise<void>((resolve) => {
          const surface = factory(tui, fakeTheme, {}, () => resolve())
          surfaces.push(surface)
        })
      },
    }
    const ctx = { mode: opts.mode ?? "tui", ui, sessionManager: { getSessionId: () => sessionId } }
    const manager: DagCommandManager = {
      list: (parentSessionId) =>
        summaries
          .filter((entry) => entry.parentSessionId === parentSessionId)
          .map((entry) => summary({ runId: entry.runId, name: entry.name, status: entry.status, parentSessionId: entry.parentSessionId })),
      snapshot: (runId) => {
        const known = summaries.find((entry) => entry.runId === runId)
        if (known === undefined) throw new Error("unknown")
        return diamondSnapshot()
      },
      taskRecord: () => undefined,
    }
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, manager, { port, stateDir: "test-state", holder })
    return {
      pi,
      ctx,
      holder,
      tui,
      notifications,
      selectCalls,
      snapshotCalls,
      listCalls,
      customCalls: () => customCalls,
      surfaces,
      setSessionId: (next) => {
        sessionId = next
      },
    }
  }

  function liveRun(): DagWatchRun {
    return {
      runId: "dag_live" as DagRunId,
      name: "release audit",
      status: "running",
      nodes: [dagNode({ id: "seed", label: "collect inputs", state: "completed" })],
    }
  }

  it("#given no watch wiring #when /dag watch runs #then it refuses without listing runs", async () => {
    // given a read-only /dag with no watch deps
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([]))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "watch", ctx)

    // then
    expect(ui.notifications).toHaveLength(1)
    expect(ui.notifications[0]?.message).toBe("Live watching is not available in this session.")
    expect(ui.notifications[0]?.type).toBe("warning")
  })

  it("#given a non-interactive mode #when /dag watch runs #then it points at the read-only tree", async () => {
    // given
    const setup = dagWatchSetup({ mode: "rpc", runs: { dag_live: liveRun() } })

    // when
    await invoke(setup.pi, "watch", setup.ctx)

    // then
    expect(setup.notifications).toEqual([
      { message: "Live watching needs the interactive terminal UI. Use /dag <runId> for the read-only node tree.", type: "info" },
    ])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an open watch #when /dag watch runs #then the second open is refused", async () => {
    // given the shared holder already holds a watch
    const setup = dagWatchSetup({ holder: { current: { close: () => undefined } }, runs: { dag_live: liveRun() } })

    // when
    await invoke(setup.pi, "watch dag_live", setup.ctx)

    // then
    expect(setup.notifications).toEqual([{ message: "A dag watch is already open.", type: "info" }])
    expect(setup.customCalls()).toBe(0)
    expect(setup.snapshotCalls).toHaveLength(0)
  })

  it("#given two run ids #when /dag watch runs #then it prints usage and reads nothing", async () => {
    // given
    const setup = dagWatchSetup({ runs: { dag_live: liveRun() } })

    // when
    await invoke(setup.pi, "watch a b", setup.ctx)

    // then
    expect(setup.notifications).toEqual([
      { message: "Usage: /dag watch [runId]. Pass one run id, or none to pick a live run.", type: "warning" },
    ])
    expect(setup.snapshotCalls).toHaveLength(0)
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an unknown run id #when /dag watch runs #then it refuses and every read stays in this session", async () => {
    // given only this session's live run is listed
    const setup = dagWatchSetup({ runs: { dag_live: liveRun() } })

    // when
    await invoke(setup.pi, "watch dag_nope", setup.ctx)

    // then
    expect(setup.notifications).toEqual([{ message: 'No dag run "dag_nope" in this session.', type: "warning" }])
    expect(setup.listCalls).toEqual(["session-a"])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a run id from another session #when /dag watch runs #then it is refused like an unknown id", async () => {
    // given the other session's run never appears in this session's list
    const setup = dagWatchSetup({
      runs: { dag_live: liveRun() },
      summaries: [
        { runId: "dag_live" as DagRunId, name: "release audit", status: "running", parentSessionId: "session-a" },
        { runId: "dag_foreign" as DagRunId, name: "foreign", status: "running", parentSessionId: "session-b" },
      ],
    })

    // when
    await invoke(setup.pi, "watch dag_foreign", setup.ctx)

    // then the same refusal as an unknown id, with no cross-session read
    expect(setup.notifications).toEqual([{ message: 'No dag run "dag_foreign" in this session.', type: "warning" }])
    expect(setup.snapshotCalls).toHaveLength(0)
    expect(setup.customCalls()).toBe(0)
  })

  it("#given only terminal runs #when /dag watch runs without an id #then the picker is refused", async () => {
    // given
    const setup = dagWatchSetup({
      runs: {},
      summaries: [{ runId: "dag_done" as DagRunId, name: "nightly", status: "completed", parentSessionId: "session-a" }],
    })

    // when
    await invoke(setup.pi, "watch", setup.ctx)

    // then
    expect(setup.notifications).toEqual([
      { message: "No live dag runs in this session. For ordinary task subagents use /tasks watch. /dag lists runs.", type: "info" },
    ])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given live runs #when /dag watch runs without an id #then the picker lists live runs and the choice mounts", async () => {
    // given a live run and a finished one (the picker must offer only the live one)
    const setup = dagWatchSetup({
      runs: { dag_live: liveRun() },
      summaries: [
        { runId: "dag_live" as DagRunId, name: "release audit", status: "running", parentSessionId: "session-a" },
        { runId: "dag_done" as DagRunId, name: "nightly", status: "completed", parentSessionId: "session-a" },
      ],
      select: (_title, options) => Promise.resolve(options[0]),
    })

    // when
    await invoke(setup.pi, "watch", setup.ctx)

    // then the picker named the live run with its status, and the mount was released afterwards
    expect(setup.selectCalls).toHaveLength(1)
    expect(setup.selectCalls[0]?.options).toEqual(["release audit (dag_live) running"])
    expect(setup.customCalls()).toBe(1)
    expect(setup.holder.current).toBeUndefined()
  })

  it("#given a dismissed picker #when /dag watch runs #then nothing mounts and the slot is released", async () => {
    // given the user escapes the run picker
    const setup = dagWatchSetup({ runs: { dag_live: liveRun() }, select: () => Promise.resolve(undefined) })

    // when
    await invoke(setup.pi, "watch", setup.ctx)

    // then
    expect(setup.selectCalls).toHaveLength(1)
    expect(setup.customCalls()).toBe(0)
    expect(setup.holder.current).toBeUndefined()
    expect(setup.notifications).toHaveLength(0)
  })

  it("#given a picker in flight #when a second /dag watch runs #then it is refused until the picker settles", async () => {
    // given a picker that stays open
    let resolveSelect!: (choice: string | undefined) => void
    const gate = new Promise<string | undefined>((resolve) => {
      resolveSelect = resolve
    })
    const setup = dagWatchSetup({ runs: { dag_live: liveRun() }, select: () => gate })
    const first = invoke(setup.pi, "watch", setup.ctx)
    await Promise.resolve()

    // when a second watch arrives while the slot is held
    await invoke(setup.pi, "watch dag_live", setup.ctx)

    // then it is refused and the first still owns the slot
    expect(setup.notifications).toEqual([{ message: "A dag watch is already open.", type: "info" }])
    expect(setup.holder.current).toBeDefined()

    // and settling the picker releases the slot without mounting
    resolveSelect(undefined)
    await first
    expect(setup.holder.current).toBeUndefined()
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a session change during the picker #when it settles #then nothing scoped to the old session mounts", async () => {
    // given the session switches while the picker is open
    const setup = dagWatchSetup({
      runs: { dag_live: liveRun() },
      select: (_title, options) => {
        setup.setSessionId("session-b")
        return Promise.resolve(options[0])
      },
    })

    // when
    await invoke(setup.pi, "watch", setup.ctx)

    // then the choice from the old session is dropped
    expect(setup.customCalls()).toBe(0)
    expect(setup.holder.current).toBeUndefined()
    expect(setup.notifications).toHaveLength(0)
  })

  it("#given an open dag watch #when the session shuts down #then the watch closes and the holder is released", async () => {
    // given a mounted watch backed by a real surface
    const setup = dagWatchSetup({
      runs: { dag_live: liveRun() },
      select: (_title, options) => Promise.resolve(options[0]),
      invokeFactory: true,
    })
    const opened = invoke(setup.pi, "watch dag_live", setup.ctx)
    for (let i = 0; i < 1000 && setup.surfaces.length === 0; i++) await Promise.resolve()
    expect(setup.surfaces).toHaveLength(1)
    expect(setup.holder.current).toBeDefined()

    // when the session shuts down
    await setup.pi.dispatch("session_shutdown", {})
    await opened

    // then the close propagates and the holder is free for the next session
    expect(setup.holder.current).toBeUndefined()
    setup.tui.stop()
  })
})
