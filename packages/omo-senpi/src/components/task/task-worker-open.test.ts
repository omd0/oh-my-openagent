import { describe, expect, it } from "bun:test"

import { TUI, type Terminal } from "@earendil-works/pi-tui"
import type { Theme as HostTheme } from "@code-yeongyu/senpi"
import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"
import type { DagNodeId, DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { Theme } from "../../senpi-test-runtime"
import type { DagWatchPort } from "./dag-subagent-service"
import { createTaskWorkerOpener, type TaskWorkerOpenDeps } from "./task-worker-open"
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

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: false,
    ...overrides,
  }
}

interface OpenerSetup {
  readonly open: (taskId: string) => Promise<void>
  readonly holder: WatchHolder
  readonly tui: TUI
  readonly notifications: string[]
  readonly customCalls: () => number
  readonly surfaces: unknown[]
  setSessionId(next: string | undefined): void
}

function openerSetup(
  records: readonly TaskRecord[],
  opts: { readonly occupied?: boolean; readonly invokeFactory?: boolean } = {},
): OpenerSetup {
  const notifications: string[] = []
  const surfaces: unknown[] = []
  let customCalls = 0
  let sessionId: string | undefined = "session-a"
  const holder: WatchHolder = { current: opts.occupied === true ? { close: () => undefined } : undefined }
  const tui = new TUI(new MemoryTerminal())
  const fakeTheme = TEST_THEME
  const deps: TaskWorkerOpenDeps = {
    manager: {
      list: (scope) => {
        if (scope.scope === "all") return records.map((entry) => ({ record: entry }))
        return records.filter((entry) => entry.parent_session_id === scope.session_id || entry.root_session_id === scope.session_id).map((entry) => ({ record: entry }) as ListedTask)
      },
      sendToTask: () => Promise.reject(new Error("not under test")),
    },
    dag: {
      list: () => [],
      snapshot: () => {
        throw new Error("no dag runs")
      },
      send: () => Promise.reject(new Error("not under test")),
      taskRecord: () => undefined,
    } as DagWatchPort,
    stateDir: "test-state",
    holder,
    sessionId: () => sessionId,
  }
  const open = createTaskWorkerOpener(deps)
  return {
    open: (taskId) => open(taskId, {
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

describe("createTaskWorkerOpener", () => {
  it("#given no session #when a task opens #then nothing opens", async () => {
    // given
    const setup = openerSetup([record({ task_id: "st_a", status: "running" })])
    setup.setSessionId(undefined)

    // when
    await setup.open("st_a")

    // then
    expect(setup.notifications).toEqual(["This task belongs to no session, so nothing opened."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an open watch #when a task opens #then the second open is refused", async () => {
    // given
    const setup = openerSetup([record({ task_id: "st_a", status: "running" })], { occupied: true })

    // when
    await setup.open("st_a")

    // then
    expect(setup.notifications).toEqual(["A watch is already open."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a task from another session #when it opens #then it is refused", async () => {
    // given a task whose parent is another session
    const setup = openerSetup([record({ task_id: "st_foreign", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })])

    // when
    await setup.open("st_foreign")

    // then
    expect(setup.notifications).toEqual(["That task is no longer in this session."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a DAG-owned task #when it opens through the task opener #then it is refused", async () => {
    // given a live task owned by a DAG run (it must open through the DAG opener)
    const setup = openerSetup([
      record({ task_id: "st_owned", status: "running", owner: { kind: "dag", runId: "dag_r" as DagRunId, nodeId: "n1" as DagNodeId, fingerprint: "f" } }),
    ])

    // when
    await setup.open("st_owned")

    // then no watch mounts: the same refusal as a missing task, never a cross-opener view
    expect(setup.notifications).toEqual(["That task is no longer in this session."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a direct child #when it opens #then the watch mounts and the holder is released", async () => {
    // given
    const setup = openerSetup([record({ task_id: "st_a", status: "running" })])

    // when
    await setup.open("st_a")

    // then
    expect(setup.customCalls()).toBe(1)
    expect(setup.holder.current).toBeUndefined()
    expect(setup.notifications).toHaveLength(0)
  })

  it("#given a mounted task watch #when the session switches #then input closes the watch and frees the holder", async () => {
    // given a mounted watch backed by a real surface
    const setup = openerSetup([record({ task_id: "st_a", status: "running" })], { invokeFactory: true })
    const opened = setup.open("st_a")
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
