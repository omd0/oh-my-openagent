import {
  buildLiveStatsTokens,
  formatStatusTarget,
  selectLiveActivityVerb,
  type TaskRecord,
  type TaskRunStats,
} from "@oh-my-opencode/senpi-task"

import { isSuspended, isTerminal } from "./status-row-format"
import { taskStatusDescription } from "./status-row-format"
import type { ThreadState, ThreadView } from "./subagent-ui/types"

// Read-only presentation of ordinary task rows for the upstream agent widget. Each task becomes one
// ThreadView: the same shape the manager tree reads. Nothing here starts, steers or stops a task.

const TREE_ROOT = "/root"

export function taskPathOf(taskId: string): string {
  return `${TREE_ROOT}/${encodeURIComponent(taskId)}`
}

// The task id a painted row stands for, or undefined for a row that is not a task row.
export function taskIdOfPath(path: string): string | undefined {
  if (!path.startsWith(`${TREE_ROOT}/`)) return undefined
  try {
    return decodeURIComponent(path.slice(TREE_ROOT.length + 1))
  } catch {
    return undefined
  }
}

// Live activity per task and the run stats the manager reports for a live child. Both are optional:
// a value that is not known stays undefined and is omitted from the row, never shown as a measured zero.
export interface TaskInlineSource {
  readonly activity: ReadonlyMap<string, string>
  readonly statsOf: (taskId: string) => TaskRunStats | undefined
  readonly now: number
}

export function taskThreads(records: readonly TaskRecord[], source: TaskInlineSource): ThreadView[] {
  return records.map((record) => threadOf(record, source))
}

function threadOf(record: TaskRecord, source: TaskInlineSource): ThreadView {
  const state = taskThreadState(record)
  const running = state === "starting" || state === "running"
  // A child that has not started yet is timed from its creation, the same fallback the list uses.
  const created = timeOf(record.created_at)
  const startedAt = timeOf(record.started_at)
  const started = startedAt ?? created
  const terminal = timeOf(record.terminal_at)
  const stats = source.statsOf(record.task_id)
  const activity = source.activity.get(record.task_id)
  // The row's badge already names the single routing identity, so the target repeats it only when a
  // child was routed by both an agent and a category; that pair is the one identity worth spelling out.
  const routedBoth = record.agent_type !== undefined && record.category !== undefined
  const target = formatStatusTarget({
    category: routedBoth ? record.category : undefined,
    agentType: routedBoth ? record.agent_type : undefined,
    resolvedModel: record.resolved_model,
    effectiveModel: record.effective_model,
    model: record.model,
    fallbackCount: record.fallback_attempts?.length,
  })
  const facts = stats === undefined ? [] : statsFacts(stats)
  return {
    path: taskPathOf(record.task_id),
    parent: TREE_ROOT,
    owner: "task",
    type: record.agent_type ?? record.category ?? "task",
    model: record.resolved_model?.display ?? record.model,
    ...(target === undefined ? {} : { target }),
    ...(facts.length === 0 ? {} : { facts }),
    state,
    task: taskStatusDescription(record),
    status: taskStatusDescription(record),
    ...(running ? { summary: activity ?? liveVerb(stats) } : {}),
    createdAt: created ?? source.now,
    updatedAt: timeOf(record.updated_at) ?? created ?? source.now,
    ...(startedAt === undefined ? {} : { lastStartedAt: startedAt }),
    // Timing is measured on the injected snapshot clock. A running child's elapsed time is the time
    // since its start as of this snapshot; a finished child keeps its settled span; a parked one has
    // no clock to show, so it gets no elapsed value rather than a time that keeps moving.
    ...(running && started !== undefined ? { elapsedMs: Math.max(0, source.now - started) } : {}),
    ...(!running && started !== undefined && terminal !== undefined && terminal >= started
      ? { elapsedMs: terminal - started }
      : {}),
    ...(stats?.input_tokens === undefined ? {} : { inputTokens: stats.input_tokens }),
    ...(stats?.output_tokens === undefined ? {} : { outputTokens: stats.output_tokens }),
    ...(stats?.cost_usd === undefined ? {} : { costUsd: stats.cost_usd }),
  }
}

// The measured run counters, from the shared live-stats grammar. Spend is left to the cost column,
// so each fact is painted once. A counter the host did not report is omitted, never shown as zero.
function statsFacts(stats: TaskRunStats): string[] {
  const tokens = buildLiveStatsTokens(stats)
  return [tokens.turn, tokens.failed, tokens.throughput].filter((token): token is string => token !== undefined)
}

// The live verb when no child event has spoken yet. Without stats the child is alive but its turn
// facts are unknown here, so the plain "running" holds, the same fallback the footer rows use.
function liveVerb(stats: TaskRunStats | undefined): string {
  if (stats === undefined) return "running"
  return selectLiveActivityVerb({ turns: stats.turns, failedTurns: stats.failed_turns })
}

// A parked child is shown as paused, not running, because it is not doing work right now.
export function taskThreadState(record: TaskRecord): ThreadState {
  if (!isTerminal(record.status) && isSuspended(record)) return "paused"
  switch (record.status) {
    case "running":
      return "running"
    case "pending":
      return "starting"
    case "paused":
      return "paused"
    case "completed":
      return "completed"
    case "error":
      return "failed"
    default:
      return "stopped"
  }
}

function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
