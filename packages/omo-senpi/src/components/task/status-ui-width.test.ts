import { describe, expect, it } from "bun:test"

import {
  rendererVisibleWidth,
  type ListedTask,
  type TaskRecord,
  type TaskRunStats,
} from "@oh-my-opencode/senpi-task"

import { Theme } from "../../senpi-test-runtime"
import type { CapturedUi, WidgetFactory } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager } from "./status-ui"

const task: TaskRecord = {
  task_id: "st_narrow",
  task_summary: "Plan the complete Spider-Man media library migration",
  parent_session_id: "session-a",
  root_session_id: "session-a",
  depth: 0,
  execution_mode: "in-process",
  model: "anthropic/claude-opus-5-5",
  status: "running",
  category: "unspecified-high",
  resolved_model: {
    provider: "anthropic",
    model_id: "claude-opus-5-5",
    display: "anthropic/claude-opus-5-5",
    reasoning_effort: "xhigh",
    source: "category",
  },
  residency_state: "resident",
  created_at: "2026-07-07T00:00:00.000Z",
  updated_at: "2026-07-07T00:01:00.000Z",
  notification: { run_epoch: 0, notified_epoch: -1 },
  notify_on_terminal: false,
}

const stats: TaskRunStats = {
  turns: 2,
  tool_calls: 4,
  runtime_ms: 60_000,
  cost_usd: 0.1303,
  cache_hit_rate_last: 0.89,
  tokens_per_second: 97,
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

const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]/gu
const OSC_PATTERN = /\][^\u0007]*(?:\u0007|\\)/gu

function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, "").replace(OSC_PATTERN, "")
}

function fakeUi(): CapturedUi & { readonly rows: Array<string[] | WidgetFactory | undefined> } {
  const rows: Array<string[] | WidgetFactory | undefined> = []
  return {
    rows,
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (_key, content) => {
      if (content !== undefined) rows.push(content)
    },
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

function renderedRows(calls: Array<string[] | WidgetFactory | undefined>, width: number): string[] {
  const content = calls.at(-1)
  if (content === undefined) return []
  if (Array.isArray(content)) return content
  return content(undefined, TEST_THEME).render(width).map(stripAnsi)
}

function manager(): StatusUiManager {
  const listed: ListedTask = { record: task }
  return {
    list: () => [listed],
    wasBackground: () => true,
    runStatsSnapshot: () => stats,
  }
}

describe("createTaskStatusUi terminal width", () => {
  it("#given a 120-column terminal #when the production widget renders #then every painted line fits and keeps identity, state and elapsed", () => {
    const ui = fakeUi()
    createTaskStatusUi({
      manager: manager(),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      now: () => Date.parse("2026-07-07T00:01:00.000Z"),
    }).syncNow()

    const rows = renderedRows(ui.rows, 120)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(120)
    const text = rows.join("\n")
    expect(text).toContain("Plan the")
    expect(text).toContain("[running]")
    expect(text).toContain("1m 0s")
  })
})
