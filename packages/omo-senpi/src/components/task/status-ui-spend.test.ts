import { describe, expect, it } from "bun:test"

import type { TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import { Theme } from "../../senpi-test-runtime"
import type { CapturedUi, WidgetFactory } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

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
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
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

function renderedRows(calls: Array<string[] | WidgetFactory | undefined>, width = 200): string[] | undefined {
  const content = calls.at(-1)
  if (content === undefined) return undefined
  if (Array.isArray(content)) return content
  return content(undefined, TEST_THEME).render(width).map(stripAnsi)
}

describe("createTaskStatusUi spend", () => {
  it("#given live solo and process-member rows with cost facts #when rendered #then cost sits with tps and without cache rate", () => {
    // given
    const timers: StatusUiTimers = {
      set: () => 1,
      clear: () => undefined,
    }
    const solo = record({ task_id: "st_solo", name: "Solo", status: "running", category: "quick" })
    const member = record({
      task_id: "st_member",
      name: "Member",
      status: "running",
      category: "quick",
      execution_mode: "process",
      pid: 4242,
    })
    const widgetCalls: Array<string[] | WidgetFactory | undefined> = []
    const ui: CapturedUi = {
      notify: () => undefined,
      setStatus: () => undefined,
      setWidget: (_key, content) => widgetCalls.push(content),
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
    }
    const manager: StatusUiManager = {
      list: () => [solo, member].map((task) => ({ record: task })),
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
      runStatsSnapshot: (taskId) =>
        taskId === "st_solo"
          ? {
              runtime_ms: 1_000,
              turns: 2,
              tool_calls: 1,
              tokens_per_second: 40,
              cost_usd: 0.4213,
              cache_hit_rate_last: 0.8712,
              cache_hit_rate_run: 0.4,
            }
          : {
              runtime_ms: 1_000,
              turns: 1,
              tool_calls: 0,
              tokens_per_second: 12,
              cost_usd: 0.017,
              cache_hit_rate_last: 0.5,
              cache_hit_rate_run: 0.1,
            },
    }
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => Date.parse("2026-07-07T00:00:01.000Z"),
    })

    // when
    statusUi.syncNow()

    // then each row keeps its spend next to its throughput, and cache rates stay out
    const text = (renderedRows(widgetCalls) ?? []).join("\n")
    expect(text).toContain("Solo")
    expect(text).toContain("Member")
    expect(text).toContain("$0.4213")
    expect(text).toContain("$0.0170")
    expect(text).toContain("40 tok/s")
    expect(text).toContain("12 tok/s")
    expect(text).not.toContain("CH:")
  })
})
