import { describe, expect, it } from "bun:test"

import { TUI, type Terminal } from "@earendil-works/pi-tui"
import type { Theme as HostTheme } from "@code-yeongyu/senpi"
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { Theme } from "../../senpi-test-runtime"
import type { DagVisibleWorker } from "./dag-status-inline"
import type { DagWatchNode, DagWatchPort, DagWatchRun } from "./dag-subagent-service"
import { createDagWorkerOpener, type DagWorkerOpenDeps } from "./dag-worker-open"
import type { WatchHolder } from "./watch-mount"

// A real TUI over an in-memory terminal: never touches stdin/stdout, writes
// buffer, start/stop are no-ops, dimensions fixed. The TUI itself is never started.
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

const RUN = "dag_r" as DagRunId

function node(overrides: Partial<DagWatchNode> & { id: string }): DagWatchNode {
  return {
    state: "running",
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    attempt: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  }
}

function run(nodes: readonly DagWatchNode[]): DagWatchRun {
  return { runId: RUN, name: "release audit", status: "running", nodes }
}

interface OpenerSetup {
  readonly open: (worker: DagVisibleWorker) => Promise<void>
  readonly holder: WatchHolder
  readonly tui: TUI
  readonly notifications: string[]
  readonly customCalls: () => number
  readonly surfaces: unknown[]
  setSessionId(next: string | undefined): void
}

function openerSetup(
  runs: Readonly<Record<string, DagWatchRun>>,
  opts: { readonly occupied?: boolean; readonly invokeFactory?: boolean; readonly snapshotThrows?: boolean } = {},
): OpenerSetup {
  const notifications: string[] = []
  const surfaces: unknown[] = []
  let customCalls = 0
  let sessionId: string | undefined = "session-a"
  const holder: WatchHolder = { current: opts.occupied === true ? { close: () => undefined } : undefined }
  const tui = new TUI(new MemoryTerminal())
  const fakeTheme = TEST_THEME
  const port: DagWatchPort = {
    list: (parentSessionId) => (parentSessionId === "session-a" ? [{ runId: RUN, name: "release audit", status: "running" }] : []),
    snapshot: (runId, parentSessionId) => {
      if (opts.snapshotThrows === true) throw new Error("pruned")
      const found = runs[runId]
      if (found === undefined || parentSessionId !== "session-a") throw new Error("unknown")
      return found
    },
    send: () => Promise.resolve({ delivery: "steer" }),
    taskRecord: () => undefined,
  }
  const deps: DagWorkerOpenDeps = { port, stateDir: "test-state", holder, sessionId: () => sessionId }
  const openWorker = createDagWorkerOpener(deps)
  return {
    open: (worker) =>
      openWorker(worker, {
        notify: (message) => notifications.push(message),
        custom: async (factory: (tui: TUI, theme: HostTheme, keys: unknown, done: (value?: unknown) => void) => unknown) => {
          customCalls += 1
          if (opts.invokeFactory !== true) return
          await new Promise<void>((resolve) => {
            const surface = factory(tui, fakeTheme, {}, () => resolve())
            surfaces.push(surface)
          })
        },
      }),
    holder,
    tui,
    notifications,
    customCalls: () => customCalls,
    surfaces,
    setSessionId: (next) => {
      sessionId = next
    },
  }
}

describe("createDagWorkerOpener", () => {
  it("#given no session #when a worker opens #then nothing opens", async () => {
    // given
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) })
    setup.setSessionId(undefined)

    // when
    await setup.open({ runId: "dag_r", nodeId: "n1" })

    // then
    expect(setup.notifications).toEqual(["This worker belongs to no session, so nothing opened."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an open watch #when a worker opens #then the second open is refused", async () => {
    // given
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) }, { occupied: true })

    // when
    await setup.open({ runId: "dag_r", nodeId: "n1" })

    // then
    expect(setup.notifications).toEqual(["A watch is already open."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a worker from another session's run #when it opens #then it is refused", async () => {
    // given this session lists only its own run
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) })

    // when a worker naming an unlisted run opens
    await setup.open({ runId: "dag_other", nodeId: "n1" })

    // then
    expect(setup.notifications).toEqual(["That worker is no longer in this session."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a pruned run #when its worker opens #then it is refused as unavailable", async () => {
    // given a snapshot the runtime no longer serves
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) }, { snapshotThrows: true })

    // when
    await setup.open({ runId: "dag_r", nodeId: "n1" })

    // then
    expect(setup.notifications).toEqual(["That worker's run is no longer available to this session."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a stale worker link #when it opens #then it is refused", async () => {
    // given a run whose node left
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) })

    // when
    await setup.open({ runId: "dag_r", nodeId: "gone" })

    // then
    expect(setup.notifications).toEqual(["That worker is no longer part of its run."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a node that never started #when it opens #then there is nothing to watch", async () => {
    // given a node with no child yet
    const setup = openerSetup({ dag_r: run([node({ id: "n1", state: "blocked" })]) })

    // when
    await setup.open({ runId: "dag_r", nodeId: "n1" })

    // then steering or viewing an unborn child is refused, not mounted empty
    expect(setup.notifications).toEqual(["That worker has not started yet, so there is nothing to watch."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a started worker #when it opens #then the watch mounts and the holder is released", async () => {
    // given
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) })

    // when
    await setup.open({ runId: "dag_r", nodeId: "n1" })

    // then
    expect(setup.customCalls()).toBe(1)
    expect(setup.holder.current).toBeUndefined()
    expect(setup.notifications).toHaveLength(0)
  })

  it("#given a mounted dag watch #when the session switches #then input closes the watch and frees the holder", async () => {
    // given a mounted watch backed by a real surface
    const setup = openerSetup({ dag_r: run([node({ id: "n1", taskId: "st_1" })]) }, { invokeFactory: true })
    const opened = setup.open({ runId: "dag_r", nodeId: "n1" })
    for (let i = 0; i < 1000 && setup.surfaces.length === 0; i++) await Promise.resolve()
    expect(setup.surfaces).toHaveLength(1)
    expect(setup.holder.current).toBeDefined()
    const surface = setup.surfaces[0] as { handleInput(data: string): void }

    // when the session switches under the open watch and input arrives
    setup.setSessionId("session-b")
    surface.handleInput("x")
    await opened

    // then the watch closed and the shared holder is free
    expect(setup.holder.current).toBeUndefined()
    setup.tui.stop()
  })
})
