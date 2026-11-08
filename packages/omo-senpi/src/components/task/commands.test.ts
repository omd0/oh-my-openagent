import { describe, expect, it } from "bun:test"

import type { CancelOutcome, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerTaskCommands, type CommandManager, type TaskWatchSeam } from "./commands"
import type { TaskSubagentWatch } from "./task-subagent-service"
import type { WatchHolder } from "./watch-mount"

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

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((rec) => ({ record: rec }))
}

function fakeManager(records: readonly TaskRecord[]): CommandManager & { cancelled: string[] } {
  const cancelled: string[] = []
  return {
    cancelled,
    list: (scope) => {
      if (scope.scope === "all") return listed(records)
      return listed(records.filter((rec) => rec.parent_session_id === scope.session_id || rec.root_session_id === scope.session_id))
    },
    cancelTask: (idOrName) => {
      cancelled.push(idOrName)
      const outcome: CancelOutcome = { kind: "cancelled", task_id: idOrName, previous_status: "running" }
      return Promise.resolve(outcome)
    },
  }
}

interface FakeCommandUi {
  readonly notifications: string[]
  readonly selectCalls: Array<{ title: string; options: string[] }>
  select: (title: string, options: string[]) => Promise<string | undefined>
  confirm: (title: string, message: string) => Promise<boolean>
  notify: (message: string) => void
}

function commandCtx(
  sessionId: string | undefined,
  mode: string,
  ui: {
    select?: (title: string, options: string[]) => Promise<string | undefined>
    confirm?: (title: string, message: string) => Promise<boolean>
  } = {},
): { ctx: unknown; ui: FakeCommandUi } {
  const notifications: string[] = []
  const selectCalls: Array<{ title: string; options: string[] }> = []
  const uiImpl: FakeCommandUi = {
    notifications,
    selectCalls,
    select: (title, options) => {
      selectCalls.push({ title, options })
      return (ui.select ?? (() => Promise.resolve(undefined)))(title, options)
    },
    confirm: ui.confirm ?? (() => Promise.resolve(true)),
    notify: (message) => notifications.push(message),
  }
  const ctx = {
    mode,
    hasUI: mode === "tui",
    ui: uiImpl,
    sessionManager: { getSessionId: () => sessionId ?? "unknown" },
  }
  return { ctx, ui: uiImpl }
}

async function invoke(pi: FakeExtensionAPI, name: string, args: string, ctx: unknown): Promise<void> {
  const command = pi.commands.find((entry) => entry.name === name)
  if (command === undefined) throw new Error(`command ${name} not registered`)
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, ctx)
}

describe("registerTaskCommands", () => {
  it("#given the component registers commands #when inspecting the api #then /tasks and /task-kill exist", () => {
    // given
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([]))

    // when
    const names = pi.commands.map((entry) => entry.name).sort()

    // then
    expect(names).toEqual(["task-kill", "tasks"])
  })

  it("#given tasks in two sessions #when /tasks runs #then only the current session's rows print", async () => {
    // given
    const mine = record({ task_id: "st_mine", status: "running" })
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([mine, other]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "", ctx)

    // then
    const printed = ui.notifications.join("\n")
    expect(printed).toContain("st_mine")
    expect(printed).not.toContain("st_other")
  })

  it("#given tasks in two sessions #when /tasks --all runs #then every session's rows print", async () => {
    // given
    const mine = record({ task_id: "st_mine", status: "running" })
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([mine, other]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "--all", ctx)

    // then
    const printed = ui.notifications.join("\n")
    expect(printed).toContain("st_mine")
    expect(printed).toContain("st_other")
  })

  it("#given tasks only in other sessions #when /tasks runs #then the empty answer names /tasks --all and the count elsewhere", async () => {
    // given
    const otherB = record({ task_id: "st_b", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const otherC = record({ task_id: "st_c", status: "completed", parent_session_id: "session-c", root_session_id: "session-c" })
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([otherB, otherC]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "", ctx)

    // then
    expect(ui.notifications).toEqual(["No tasks in this session. /tasks --all lists every session's tasks (2 in other sessions)."])
  })

  it("#given no tasks anywhere #when /tasks runs #then the empty answer still names /tasks --all without a count", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "", ctx)

    // then
    expect(ui.notifications).toEqual(["No tasks in this session. /tasks --all lists every session's tasks."])
  })

  it("#given no tasks anywhere #when /tasks --all runs #then it reports the empty store without a hint", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "--all", ctx)

    // then
    expect(ui.notifications).toEqual(["No tasks in all sessions."])
  })

  it.each(["running", "paused"] as const)("#given a %s task #when /task-kill selects it and confirms #then cancelTask runs for that id", async (status) => {
    // given a live task, or one its run's Stop paused (#12249)
    const running = record({ task_id: "st_kill", status })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx, ui } = commandCtx("session-a", "tui", {
      select: (_title, options) => Promise.resolve(options[0]),
      confirm: () => Promise.resolve(true),
    })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then the selector was shown and the chosen task cancelled
    expect(ui.selectCalls).toHaveLength(1)
    expect(manager.cancelled).toEqual(["st_kill"])
  })

  it("#given a task with a description #when /task-kill lists options #then the human label leads and the id trails", async () => {
    // given
    const running = record({ task_id: "st_kill", name: "task-1", description: "Audit the waiting line", status: "running" })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx, ui } = commandCtx("session-a", "tui", { select: () => Promise.resolve(undefined) })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(ui.selectCalls[0]?.options[0]).toBe("Audit the waiting line (st_kill) running")
  })

  it("#given a multi-word description #when /task-kill selects and confirms #then cancelTask runs for the task id, not a word of the label", async () => {
    // given
    const running = record({ task_id: "st_kill", name: "task-1", description: "Audit the waiting line", status: "running" })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx } = commandCtx("session-a", "tui", {
      select: (_title, options) => Promise.resolve(options[0]),
      confirm: () => Promise.resolve(true),
    })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(manager.cancelled).toEqual(["st_kill"])
  })

  it("#given the selector is dismissed #when /task-kill runs #then nothing is cancelled", async () => {
    // given a user who escapes the selector (undefined)
    const running = record({ task_id: "st_kill", status: "running" })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx } = commandCtx("session-a", "tui", { select: () => Promise.resolve(undefined) })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(manager.cancelled).toEqual([])
  })

  it("#given no cancellable tasks #when /task-kill runs #then it notifies and never opens the selector", async () => {
    // given only a terminal task
    const done = record({ task_id: "st_done", status: "completed" })
    const manager = fakeManager([done])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(ui.selectCalls).toHaveLength(0)
    expect(manager.cancelled).toEqual([])
    expect(ui.notifications.join("\n")).toContain("No cancellable")
  })
})

describe("registerTaskCommands /tasks watch", () => {
  interface WatchSetup {
    readonly pi: FakeExtensionAPI
    readonly ctx: unknown
    readonly holder: WatchHolder
    readonly notifications: string[]
    readonly createWatchCalls: Array<{ parentSessionId: string; stillBound: () => boolean }>
    readonly pathForCalls: string[]
    readonly customCalls: () => number
    readonly setSessionId: (next: string | undefined) => void
  }

  function watchSetup(
    records: readonly TaskRecord[],
    opts: { readonly mode?: string; readonly occupied?: boolean; readonly sessionId?: string } = {},
  ): WatchSetup {
    const notifications: string[] = []
    const createWatchCalls: WatchSetup["createWatchCalls"] = []
    const pathForCalls: string[] = []
    let customCalls = 0
    let sessionId: string | undefined = opts.sessionId === undefined ? "session-a" : opts.sessionId
    const holder: WatchHolder = { current: opts.occupied === true ? { close: () => undefined } : undefined }
    const watch: TaskWatchSeam = {
      holder,
      createWatch: (parentSessionId, stillBound): TaskSubagentWatch => {
        createWatchCalls.push({ parentSessionId, stillBound })
        return {
          service: {
            list: () => [],
            observeTranscript: () => Promise.reject(new Error("not under test")),
            steer: () => Promise.reject(new Error("not under test")),
          },
          pathFor: (taskId: string) => {
            pathForCalls.push(taskId)
            return `/root/${taskId}`
          },
        }
      },
    }
    const ui = {
      notify: (message: string) => notifications.push(message),
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(true),
      custom: async () => {
        customCalls += 1
      },
    }
    const ctx = {
      mode: opts.mode ?? "tui",
      ui,
      ...(sessionId === undefined ? {} : { sessionManager: { getSessionId: () => sessionId } }),
    }
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager(records), watch)
    return {
      pi,
      ctx,
      holder,
      notifications,
      createWatchCalls,
      pathForCalls,
      customCalls: () => customCalls,
      setSessionId: (next) => {
        sessionId = next
      },
    }
  }

  it("#given no watch seam #when /tasks watch runs #then it refuses without touching the manager list", async () => {
    // given a command registered without the interactive watch wiring
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([record({ task_id: "st_a", status: "running" })]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "watch", ctx)

    // then
    expect(ui.notifications).toEqual(["Watching tasks is not available in this session."])
  })

  it("#given two selectors #when /tasks watch runs #then it prints usage and mounts nothing", async () => {
    // given
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })])

    // when
    await invoke(setup.pi, "tasks", "watch a b", setup.ctx)

    // then
    expect(setup.notifications).toEqual(["Usage: /tasks watch [task-id-or-name]"])
    expect(setup.customCalls()).toBe(0)
    expect(setup.createWatchCalls).toHaveLength(0)
  })

  it("#given no session identity #when /tasks watch runs #then it refuses before listing", async () => {
    // given a context with no session manager at all
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })], { sessionId: undefined })
    const ctx = { mode: "tui", ui: (setup.ctx as { ui: unknown }).ui }

    // when
    await invoke(setup.pi, "tasks", "watch", ctx)

    // then
    expect(setup.notifications).toEqual(["Task watch needs this session's identity, so there is nothing to show."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a non-interactive mode #when /tasks watch runs #then it points at the read-only list", async () => {
    // given
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })], { mode: "rpc" })

    // when
    await invoke(setup.pi, "tasks", "watch", setup.ctx)

    // then
    expect(setup.notifications).toEqual(["Live watching needs the interactive terminal UI. Use /tasks to list tasks."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an open watch #when /tasks watch runs #then the second open is refused", async () => {
    // given the shared holder already holds a watch
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })], { occupied: true })

    // when
    await invoke(setup.pi, "tasks", "watch", setup.ctx)

    // then
    expect(setup.notifications).toEqual(["A watch is already open."])
    expect(setup.customCalls()).toBe(0)
    expect(setup.createWatchCalls).toHaveLength(0)
  })

  it("#given tasks only in other sessions #when /tasks watch runs #then it reports the empty scope with the --all hint", async () => {
    // given a sibling task under another parent but the same root: not a direct child
    const sibling = record({ task_id: "st_sib", status: "running", parent_session_id: "session-b", root_session_id: "session-a" })
    const setup = watchSetup([sibling])

    // when
    await invoke(setup.pi, "tasks", "watch", setup.ctx)

    // then
    expect(setup.notifications).toEqual(["No tasks in this session. /tasks --all lists every session's tasks."])
    expect(setup.customCalls()).toBe(0)
  })

  it("#given an unknown selector #when /tasks watch runs #then it refuses without naming another session's task", async () => {
    // given this session has a task, and another session has one named "elsewhere"
    const foreign = record({ task_id: "st_foreign", name: "elsewhere", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const setup = watchSetup([record({ task_id: "st_mine", status: "running" }), foreign])

    // when
    await invoke(setup.pi, "tasks", "watch elsewhere", setup.ctx)

    // then the refusal names the scope, never the foreign task
    expect(setup.notifications).toEqual(['No task named "elsewhere" in this session. /tasks lists them.'])
    expect(setup.createWatchCalls).toHaveLength(0)
    expect(setup.customCalls()).toBe(0)
  })

  it("#given a duplicated name #when /tasks watch runs #then it asks for the task id", async () => {
    // given two tasks sharing one name in this session
    const first = record({ task_id: "st_1", name: "dup", status: "running" })
    const second = record({ task_id: "st_2", name: "dup", status: "running" })
    const setup = watchSetup([first, second])

    // when
    await invoke(setup.pi, "tasks", "watch dup", setup.ctx)

    // then
    expect(setup.notifications).toEqual(['More than one task is named "dup" in this session. Use its task id.'])
    expect(setup.createWatchCalls).toHaveLength(0)
  })

  it("#given a task id #when /tasks watch runs #then the watch opens at that node and the holder is released", async () => {
    // given
    const setup = watchSetup([record({ task_id: "st_a", name: "shared", status: "running" })])

    // when
    await invoke(setup.pi, "tasks", "watch st_a", setup.ctx)

    // then the watch was bound to this session and mounted at the selected node
    expect(setup.createWatchCalls).toHaveLength(1)
    expect(setup.createWatchCalls[0]?.parentSessionId).toBe("session-a")
    expect(setup.pathForCalls).toEqual(["st_a"])
    expect(setup.customCalls()).toBe(1)
    expect(setup.holder.current).toBeUndefined()
  })

  it("#given no selector #when /tasks watch runs #then the tree opens at the root", async () => {
    // given
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })])

    // when
    await invoke(setup.pi, "tasks", "watch", setup.ctx)

    // then no node was pre-selected, but the watch still mounted
    expect(setup.pathForCalls).toEqual([])
    expect(setup.customCalls()).toBe(1)
    expect(setup.holder.current).toBeUndefined()
  })

  it("#given a mounted watch #when the session changes #then the bound check follows the live session", async () => {
    // given an open watch bound to session-a
    const setup = watchSetup([record({ task_id: "st_a", status: "running" })])
    await invoke(setup.pi, "tasks", "watch st_a", setup.ctx)
    const stillBound = setup.createWatchCalls[0]?.stillBound
    if (stillBound === undefined) throw new Error("createWatch was not called")

    // when the session switches under the open watch
    expect(stillBound()).toBe(true)
    setup.setSessionId("session-b")

    // then the same closure reports the watch as unbound
    expect(stillBound()).toBe(false)
  })
})
