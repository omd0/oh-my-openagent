import { taskIdentityLabel } from "@oh-my-opencode/senpi-task"
import type { CancelOutcome, ListScope, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { sanitizeTerminalText } from "../side-panel/format/sanitize"
import type { TaskSubagentWatch } from "./task-subagent-service"
import { mountSubagentWatch, type WatchHolder, type WatchUi } from "./watch-mount"
import { formatTaskRow } from "./status-ui"

// Cancellable = anything still holding a live/resident child worth stopping, a run-paused one included (#12249).
const CANCELLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(["running", "pending", "interrupted", "paused"])

// The manager read/act seam the commands need: a scoped list plus cancellation.
export interface CommandManager {
  list(scope: ListScope): readonly ListedTask[]
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
}

export interface RoutingProfileCommandState {
  readonly availableProfiles: readonly string[]
  readonly currentProfile: () => string | undefined
  readonly select: (name: string) => Promise<boolean>
  readonly reset: () => Promise<void>
}

// Structural slice of senpi's ExtensionCommandContext the commands read. The real context satisfies it.
interface CommandContext {
  readonly mode?: string
  readonly ui?: CommandUi
  readonly sessionManager?: { getSessionId(): string }
}

interface CommandUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  select(title: string, options: string[]): Promise<string | undefined>
  confirm(title: string, message: string): Promise<boolean>
}

const KILL_REASON = "/task-kill"

// The interactive watch seam. Composition supplies the shared overlay holder (one open watch at a time,
// shared with /dag watch) and the factory that binds the nonUI task service to this session's manager.
export interface TaskWatchSeam {
  readonly holder: WatchHolder
  readonly createWatch: (parentSessionId: string, stillBound: () => boolean) => TaskSubagentWatch
}

export function registerTaskCommands(pi: SenpiExtensionAPI, manager: CommandManager, watch?: TaskWatchSeam): void {
  pi.registerCommand("tasks", {
    description: "List session tasks (--all for every session); /tasks watch [id-or-name] watches one.",
    handler: (args: string, ctx: CommandContext) => runTasksCommand(manager, args, ctx, watch),
  })
  pi.registerCommand("task-kill", {
    description: "Cancel a session task via selector.",
    handler: (_args: string, ctx: CommandContext) => runTaskKillCommand(manager, ctx),
  })
}

export function registerRoutingProfileCommand(pi: SenpiExtensionAPI, state: RoutingProfileCommandState): void {
  pi.registerCommand("routing", {
    description: "Select task routing for this session without changing the main model.",
    handler: async (args: string, ctx: CommandContext) => {
      const ui = ctx.ui
      const requested = args.trim()
      if (requested.length === 0) {
        const current = state.currentProfile() ?? "default"
        ui?.notify(`Task routing: ${current}. Available profiles: ${state.availableProfiles.join(", ") || "(none)"}.`, "info")
        return
      }
      if (requested === "default") {
        await state.reset()
        ui?.notify(`Task routing reset to ${state.currentProfile() ?? "default"}.`, "info")
        return
      }
      if (!state.availableProfiles.includes(requested) || !(await state.select(requested))) {
        ui?.notify(`Unknown task routing profile "${requested}". Available profiles: ${state.availableProfiles.join(", ") || "(none)"}.`, "warning")
        return
      }
      ui?.notify(`Task routing set to ${requested}.`, "info")
    },
  })
}

function scopeFor(ctx: CommandContext, allScope: boolean): ListScope | undefined {
  if (allScope) return { scope: "all" }
  const sessionId = ctx.sessionManager?.getSessionId()
  if (sessionId === undefined) return undefined
  return { scope: "parent-session", session_id: sessionId }
}

function collect(manager: CommandManager, scope: ListScope | undefined): readonly TaskRecord[] {
  if (scope === undefined) return []
  return manager.list(scope).map((entry) => entry.record)
}

async function runTasksCommand(manager: CommandManager, args: string, ctx: CommandContext, watch?: TaskWatchSeam): Promise<void> {
  const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0)
  if (tokens[0] === "watch") {
    await runTasksWatch(manager, tokens.slice(1), ctx, watch)
    return
  }
  const allScope = tokens.includes("--all")
  const records = collect(manager, scopeFor(ctx, allScope))
  let text: string
  if (records.length > 0) text = records.map(formatTaskRow).join("\n")
  else if (allScope) text = "No tasks in all sessions."
  else text = emptySessionTasksText(collect(manager, scopeFor(ctx, true)).length)
  ctx.ui?.notify(text, "info")
}

// An empty session scope is not an empty store: a restart, a second pane, or a run started
// elsewhere all land here, so name the --all escape hatch and how many tasks it would show.
function emptySessionTasksText(otherSessionCount: number): string {
  const hint = "/tasks --all lists every session's tasks"
  if (otherSessionCount === 0) return `No tasks in this session. ${hint}.`
  return `No tasks in this session. ${hint} (${otherSessionCount} in other sessions).`
}

async function runTaskKillCommand(manager: CommandManager, ctx: CommandContext): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  const cancellable = collect(manager, scopeFor(ctx, false)).filter((record) => CANCELLABLE_STATUSES.has(record.status))
  if (cancellable.length === 0) {
    ui.notify("No cancellable tasks.", "info")
    return
  }
  const options = cancellable.map(killOption)
  const choice = await ui.select("Cancel which task?", options)
  if (choice === undefined) return
  const selected = cancellable[options.indexOf(choice)]
  if (selected === undefined) return
  const taskId = selected.task_id
  const confirmed = await ui.confirm("Cancel task", `Cancel ${taskId}?`)
  if (!confirmed) return
  await manager.cancelTask(taskId, KILL_REASON)
  ui.notify(`Cancelled ${taskId}.`, "info")
}

function killOption(record: TaskRecord): string {
  const identity = taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description, taskSummary: record.task_summary })
  const idSuffix = identity === record.task_id ? "" : ` (${record.task_id})`
  return `${identity}${idSuffix} ${record.status}`
}

// `/tasks watch [id-or-name]`: the current session's tasks only. A selector is matched exactly, the id
// first and then the name. A missing or ambiguous selector is refused with the same message for every
// session, so a task in another session is never named. Without a selector the tree opens at the root.
async function runTasksWatch(manager: CommandManager, rest: readonly string[], ctx: CommandContext, watch: TaskWatchSeam | undefined): Promise<void> {
  const ui: WatchUi | undefined = ctx.ui
  if (ui === undefined) return
  if (watch === undefined) {
    ui.notify("Watching tasks is not available in this session.", "warning")
    return
  }
  if (rest.length > 1) {
    ui.notify("Usage: /tasks watch [task-id-or-name]", "warning")
    return
  }
  const parentId = ctx.sessionManager?.getSessionId()
  if (parentId === undefined) {
    ui.notify("Task watch needs this session's identity, so there is nothing to show.", "warning")
    return
  }
  const interactive = ctx.mode === undefined || ctx.mode === "tui"
  if (!interactive || ui.custom === undefined) {
    ui.notify("Live watching needs the interactive terminal UI. Use /tasks to list tasks.", "info")
    return
  }
  if (watch.holder.current !== undefined) {
    ui.notify("A watch is already open.", "info")
    return
  }
  // Direct children only: the parent-session list also carries root-session descendants and siblings,
  // which the watch service refuses. Filtering here keeps the empty check, the count and the selector
  // aligned with what the service can actually read and steer.
  const records = manager
    .list({ scope: "parent-session", session_id: parentId })
    .map((entry) => entry.record)
    .filter((record) => record.parent_session_id === parentId)
  if (records.length === 0) {
    ui.notify("No tasks in this session. /tasks --all lists every session's tasks.", "info")
    return
  }
  const selector = rest[0]
  let taskId: string | undefined
  if (selector !== undefined) {
    const selection = resolveTaskSelector(records, selector)
    const shown = sanitizeTerminalText(selector)
    if (selection.kind === "missing") {
      ui.notify(`No task named "${shown}" in this session. /tasks lists them.`, "warning")
      return
    }
    if (selection.kind === "ambiguous") {
      ui.notify(`More than one task is named "${shown}" in this session. Use its task id.`, "warning")
      return
    }
    taskId = selection.taskId
  }
  const stillBound = (): boolean => ctx.sessionManager?.getSessionId() === parentId
  const watchSet = watch.createWatch(parentId, stillBound)
  await mountSubagentWatch(watch.holder, {
    ui,
    service: watchSet.service,
    parentId,
    currentParentId: () => ctx.sessionManager?.getSessionId(),
    ...(taskId === undefined ? {} : { initialPath: watchSet.pathFor(taskId) }),
  })
}

type TaskSelection = { readonly kind: "match"; readonly taskId: string } | { readonly kind: "missing" } | { readonly kind: "ambiguous" }

// Exact matches only: a task id is unique and wins; a name must single out one task in the scope.
function resolveTaskSelector(records: readonly TaskRecord[], selector: string): TaskSelection {
  const byId = records.find((record) => record.task_id === selector)
  if (byId !== undefined) return { kind: "match", taskId: byId.task_id }
  const named = records.filter((record) => record.name === selector)
  const only = named[0]
  if (named.length === 1 && only !== undefined) return { kind: "match", taskId: only.task_id }
  if (named.length > 1) return { kind: "ambiguous" }
  return { kind: "missing" }
}
