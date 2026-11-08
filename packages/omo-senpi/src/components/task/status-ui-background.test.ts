import { describe, expect, it } from "bun:test"

import { createChildProgress, HOST_TURN_RESUMED_EVENT, type ListedTask, type TaskRecord, type TaskStatus } from "@oh-my-opencode/senpi-task"

import { Theme } from "../../senpi-test-runtime"
import type { CapturedUi, WidgetFactory } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((entry) => ({ record: entry }))
}

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

interface FakeUi extends CapturedUi {
  readonly statusCalls: Array<string | undefined>
  readonly widgetCalls: Array<{ content: string[] | WidgetFactory | undefined; placement: string | undefined }>
}

function fakeUi(): FakeUi {
  const statusCalls: Array<string | undefined> = []
  const widgetCalls: Array<{ content: string[] | WidgetFactory | undefined; placement: string | undefined }> = []
  return {
    statusCalls,
    widgetCalls,
    notify: () => undefined,
    setStatus: (_key, text) => statusCalls.push(text),
    setWidget: (_key, content, options) => widgetCalls.push({ content, placement: options?.placement }),
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

// The factory renders through the real host Theme (same truecolor stub shape as
// dag-status-ui.test.ts); assertions strip ANSI and read text behavior.
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

describe("createTaskStatusUi.background progress", () => {
  it("#given a completed resident team member #when syncing #then the widget shows a static completed row with no refresh timer", () => {
    // given
    const active = new Map<number, () => void>()
    const timers: StatusUiTimers = {
      set: (callback) => { active.set(1, callback); return 1 },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const member = record({
      task_id: "st_done",
      name: "team:12345678-1234-1234-1234-123456789abc:researcher",
      task_summary: "settled researcher",
      status: "completed",
    })
    const manager = {
      list: () => listed([member, record({ task_id: "st_ordinary", task_summary: "ordinary task", status: "completed" })]),
      wasBackground: () => true,
      residentTaskIds: () => [member.task_id, "st_ordinary"],
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when
    statusUi.syncNow()

    // then no live timer or subscription survives, and the finished rows stay
    // painted statically (the read-only tree retains finished workers)
    expect(active.size).toBe(0)
    const text = (renderedRows(ui) ?? []).join("\n")
    expect(text).toContain("settled researcher")
    expect(text).toContain("ordinary task")
    expect(text).toContain("[completed]")
    expect(text).toContain("0 live")
    expect(ui.statusCalls).toHaveLength(0)
  })

  it("#given only suspended background children #when syncing #then a still row paints and no repaint timer runs", () => {
    // given one background child that is parked, not running
    const active = new Map<number, () => void>()
    const timers: StatusUiTimers = {
      set: (callback) => { active.set(1, callback); return 1 },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const parked = record({ task_id: "st_parked", task_summary: "parked child", status: "running", residency_state: "persisted_only" })
    const manager = { list: () => listed([parked]), wasBackground: () => true }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when the widget syncs
    statusUi.syncNow()

    // then the row is painted once and nothing schedules a repaint
    const text = (renderedRows(ui) ?? []).join("\n")
    expect(text).toContain("parked child")
    expect(text).toContain("[paused]")
    expect(text).toContain("1 paused")
    expect(active.size).toBe(0)
  })

  it("#given an idle parent with a running background task #when time advances quietly #then the live timer refreshes without re-listing", () => {
    // given
    let currentTime = Date.parse("2026-07-07T00:00:00.000Z")
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const task = record({
      task_id: "st_idle",
      name: "Idle child",
      status: "running",
      category: "quick",
      created_at: new Date(currentTime).toISOString(),
    })
    let stats = { runtime_ms: 0, turns: 1, tool_calls: 2, tokens_per_second: 40 }
    let listCalls = 0
    const manager: StatusUiManager = {
      list: () => {
        listCalls += 1
        return listed([task])
      },
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
      runStatsSnapshot: () => stats,
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => currentTime,
    })
    statusUi.syncNow()
    const first = (renderedRows(ui) ?? []).join("\n")
    expect(listCalls).toBe(1)
    expect(first).toContain("Idle child")
    expect(first).toContain("[running]")

    // when
    currentTime += 1_000
    stats = { runtime_ms: 1_000, turns: 2, tool_calls: 3, tokens_per_second: 42 }
    expect(active.size).toBe(1)
    const writesBefore = ui.widgetCalls.length
    for (const callback of [...active.values()]) callback()
    const second = (renderedRows(ui) ?? []).join("\n")

    // then the refresh repainted without re-listing, and the live facts advanced
    expect(ui.widgetCalls.length).toBeGreaterThan(writesBefore)
    expect(second).toContain("turn 2 (3 tools)")
    expect(second).toContain("42 tok/s")
    expect(second).toContain("1s")
    expect(listCalls).toBe(1)
  })

  it("#given a child before its first turn #when a host reattach resumes its turn #then the reattach reaches the row and the footer line", () => {
    // given: no successful turn and no tool yet
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const task = record({ task_id: "st_reattached", name: "c0", status: "running", category: "quick" })
    const listeners = new Map<string, (event: { readonly type: string }) => void>()
    const manager: StatusUiManager = {
      list: () => listed([task]),
      wasBackground: () => true,
      subscribeChild: (taskId, listener) => {
        listeners.set(taskId, listener)
        return () => listeners.delete(taskId)
      },
      runStatsSnapshot: () => ({ runtime_ms: 11_000, turns: 0, tool_calls: 0 }),
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => Date.parse("2026-07-07T00:00:11.000Z"),
    })
    // The task tool's live progress line (the footer of a running task call) for the same child.
    const progress = createChildProgress("st_reattached", { category: "quick" }, 0, () => 11_000)
    statusUi.syncNow()
    const before = (renderedRows(ui, 140) ?? []).join("\n")
    expect(before).toContain("[running]")
    expect(before).toContain("starting")
    expect(progress.details().progress.activity).toEndWith("· starting")

    // when - the one event a reattach emits reaches both surfaces
    listeners.get("st_reattached")?.({ type: HOST_TURN_RESUMED_EVENT })
    progress.accept({ type: HOST_TURN_RESUMED_EVENT })
    for (const callback of [...active.values()]) callback()

    // then
    const row = (renderedRows(ui, 140) ?? []).join("\n")
    expect(row).toContain("[running]")
    expect(row).toContain("running")
    expect(row).not.toContain("starting")
    expect(progress.details().progress.activity).toEndWith("· running")
    expect(progress.details().turns).toBe(0)
    statusUi.dispose()
  })

  it("#given a live refresh timer #when the final background task completes #then the timer stops and the row reads completed", () => {
    // given
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    let task = record({ task_id: "st_finishing", status: "running" })
    const manager: StatusUiManager = {
      list: () => listed([task]),
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    statusUi.syncNow()
    expect(active.size).toBe(1)

    // when
    task = record({ task_id: "st_finishing", status: "completed" })
    statusUi.scheduleSync()
    for (const callback of [...active.values()]) callback()

    // then the timer is gone and the finished row stays painted statically
    expect(active.size).toBe(0)
    const text = (renderedRows(ui) ?? []).join("\n")
    expect(text).toContain("[completed]")
    expect(text).toContain("st_finishing")
  })

  it("#given two background children #when latest events arrive #then rows show identity, model, stats, activity, and elapsed time", () => {
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const first = record({
      task_id: "st_first",
      name: "Investigate the unexpectedly long background child description",
      status: "running",
      category: "quick",
      model: "requested/model",
      resolved_model: {
        source: "category",
        provider: "chatgpt-subscription",
        model_id: "gpt-5.6-luna-fast",
        display: "chatgpt-subscription/gpt-5.6-luna-fast",
        reasoning_effort: "high",
      },
      fallback_attempts: [
        {
          source: "category",
          provider: "anthropic",
          model_id: "claude-haiku-4-5",
          display: "anthropic/claude-haiku-4-5",
        },
        {
          source: "category",
          provider: "chatgpt-subscription",
          model_id: "gpt-5.6-luna-fast",
          display: "chatgpt-subscription/gpt-5.6-luna-fast",
          reasoning_effort: "high",
        },
      ],
    })
    const second = record({
      task_id: "st_second",
      name: "Review tests",
      status: "running",
      agent_type: "explore",
      model: "requested/model",
      resolved_model: {
        source: "agent",
        provider: "chatgpt-subscription",
        model_id: "gpt-5.6-luna-fast",
        display: "chatgpt-subscription/gpt-5.6-luna-fast",
      },
    })
    const listeners = new Map<string, (event: { readonly type: string; readonly toolName?: string; readonly args?: unknown }) => void>()
    const manager: StatusUiManager = {
      list: () => listed([first, second]),
      wasBackground: () => true,
      subscribeChild: (taskId, listener) => {
        listeners.set(taskId, listener)
        return () => listeners.delete(taskId)
      },
      runStatsSnapshot: (taskId) =>
        taskId === "st_first"
          ? { runtime_ms: 65_000, turns: 3, tool_calls: 7, tokens_per_second: 42 }
          : { runtime_ms: 65_000, turns: 1, tool_calls: 2 },
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => Date.parse("2026-07-07T00:01:05.000Z"),
    })

    statusUi.syncNow()
    listeners.get("st_first")?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    listeners.get("st_second")?.({ type: "tool_execution_start", toolName: "bash", args: { command: "bun test" } })
    expect(active.size).toBe(1)
    for (const callback of [...active.values()]) callback()

    const text = (renderedRows(ui, 220) ?? []).join("\n")
    // then the tree heading counts the live rows, each row carries its live state,
    // and the latest activity plus the elapsed clock show
    expect(text).toContain("2 live")
    expect(text).toContain("[running]")
    expect(text).toContain("read src/foo.ts")
    expect(text).toContain("bash bun test")
    expect(text).toContain("1m 5s")
    // and each row keeps its identity, model, fallback, turn and throughput facts
    expect(text).toContain("Investigate the unexpectedly long background child description")
    expect(text).toContain("Review tests")
    expect(text).toContain("gpt-5.6-luna-fast")
    expect(text).toContain("fallback:2")
    expect(text).toContain("turn 3 (7 tools)")
    expect(text).toContain("turn 1 (2 tools)")
    expect(text).toContain("42 tok/s")
    // C1: the duplicated footer task status line is gone; widget rows are the only task surface.
    expect(ui.statusCalls).toHaveLength(0)
  })
})
