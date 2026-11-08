import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, loadOmoConfig, type LoadOmoConfigOptions, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import { createRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import {
  createTaskRecordStore,
  normalizeSenpiTeamSpec,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { loadSenpiOmoConfig } from "../config-resolution"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { createTaskComponent, wireEventBridge } from "./index"
import * as taskComponentModule from "./index"
import type { CapturedUi } from "./runtime-context"
import { createSessionTransitionBridge } from "./session-transition-bridge"
import { TASK_ROUTING_PROFILE_ENTRY } from "./routing-profile"

// This suite is not about job widgets: keep the task component off the real senpi job-widget host.
const noJobWidgetHost = async (): Promise<Record<string, never>> => ({})

const TASK_TOOL_NAMES = ["task", "task_send", "task_cancel", "task_output", "workflow", "workpool"]
const TEAM_TOOL_NAMES = [
  "team_create",
  "team_delete",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
]
const ALL_TOOL_NAMES = [...TASK_TOOL_NAMES, ...TEAM_TOOL_NAMES]
const TASK_EVENTS = [
  "context",
  "session_start",
  "session_hold_changed",
  "session_before_reload",
  "session_resumed",
  "session_before_switch",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
  "model_select",
  "before_agent_start",
  "agent_end",
]
const SKILL_INVOCATION_TRACKER_EVENTS = ["input", "tool_result", "session_start", "session_shutdown"]
const DAG_LIFECYCLE_EVENTS = ["session_start", "session_shutdown", "before_agent_start", "session_resumed", "session_shutdown"]
const TASK_COMMANDS = ["dag", "routing", "task-kill", "tasks", "watch"]

interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-task-"))
  tempRoots.push(dir)
  return dir
}

function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    warn: (message) => entries.push({ level: "warn", message }),
    error: (message) => entries.push({ level: "error", message }),
  }
}

function ctxFor(pi: FakeExtensionAPI, logger: ComponentLogger): ComponentContext {
  return {
    logger,
    config: { getFlag: (name) => pi.getFlag(name) },
    getCapturedTools: () => [],
  }
}

function fakeUi(): CapturedUi {
  return {
    notify: () => {},
    setStatus: () => {},
    setWidget: () => {},
    select: async () => undefined,
    confirm: async () => false,
  }
}

// File-private routing fixture: serves two named profiles over the real base config so the
// composition tests drive persist/restore/reset/invalid through the component's own loadConfig
// seam. No shared fixture is touched.
class AppendEntryFakeExtensionAPI extends FakeExtensionAPI {
  readonly appended: Array<{ customType: string; data: unknown }> = []

  appendEntry(customType: string, data?: unknown): void {
    this.appended.push({ customType, data })
  }
}
function routingLoadConfig(cwd: string, routed: OmoConfig): typeof loadSenpiOmoConfig {
  const base = loadSenpiOmoConfig({ cwd })
  const layered: SenpiOmoConfigResult = {
    ...base,
    layers: [
      ...base.layers,
      {
        config: { profiles: { alpha: {}, beta: {} } },
        source: { exists: false, loaded: false, path: "test-routing", scope: "project" },
      },
    ],
  }
  return (options: LoadOmoConfigOptions = {}): SenpiOmoConfigResult =>
    options.profile === undefined ? layered : { ...layered, config: routed }
}

function branchCtx(sessionId: string, profile?: string): {
  sessionManager: { getSessionId: () => string; getBranch: () => unknown[] }
} {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => profile === undefined
        ? []
        : [{ customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile } }],
    },
  }
}

function routingHandlerFor(pi: FakeExtensionAPI): (args: string, ctx: unknown) => Promise<unknown> {
  const entry = pi.commands.find((candidate) => candidate.name === "routing")
  if (entry === undefined) throw new Error("expected routing command")
  const handler = entry.options["handler"]
  if (typeof handler !== "function") throw new Error("expected routing handler")
  return handler as (args: string, ctx: unknown) => Promise<unknown>
}

const noopStatusUi = { scheduleSync: () => {}, syncNow: () => {}, observeRecord: () => {}, dispose: () => {} }
const noopResumptionChannels = {
  emitSessionStart: () => Promise.resolve(),
  emitShutdown: () => Promise.resolve(),
}

// Build the real engine and wire its event bridge over a fake ExtensionAPI so tests can drive the
// registered handlers and observe the captured-ui bridge (todo 18: cleared on switch/shutdown).
function wiredBridge(onRecovered: () => void = () => {}): {
  pi: FakeExtensionAPI
  engine: ReturnType<typeof composeTaskEngine>
  reconcileCalls: { count: number }
  leadCalls: { ticks: number; shutdowns: number }
} {
  const cwd = tempProject()
  const pi = new FakeExtensionAPI()
  const logger = createLogger()
  const engine = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
  const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
  const reconcileCalls = { count: 0 }
  const leadCalls = { ticks: 0, shutdowns: 0 }
  wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
    reconcileTeamMailbox: () => {
      reconcileCalls.count += 1
      return Promise.resolve()
    },
    leadPollers: {
      tick: () => {
        leadCalls.ticks += 1
        onRecovered()
        return Promise.resolve()
      },
      shutdown: () => { leadCalls.shutdowns += 1 },
    },
    resumptionChannels: noopResumptionChannels,
  })
  return { pi, engine, reconcileCalls, leadCalls }
}

async function seedTeamRuntime(cwd: string, leadSessionId: string, memberName = "crash"): Promise<string> {
  const loaded = loadOmoConfig({ cwd }).config
  const settings = loaded.task ?? OmoTaskSettingsSchema.parse({})
  const stateDir = { project_dir: cwd }
  const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec({
    members: [{ name: memberName, kind: "category", category: "quick", prompt: "member" }],
  }, "liveness-test")
  const runtime = await createRuntimeState(spec, leadSessionId, "project", config)
  await transitionRuntimeState(runtime.teamRunId, (state) => ({ ...state, status: "active" }), config)
  return runtime.teamRunId
}

function terminalRecord(teamRunId: string, memberName = "crash"): TaskRecord {
  return {
    task_id: "st_00000009",
    name: `team:${teamRunId}:${memberName}`,
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "error",
    residency_state: "resident",
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:01.000Z",
    error_message: "RPC child exited with code 1",
    notification: { run_epoch: 0, notified_epoch: 0 },
    notify_on_terminal: false,
  }
}

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools
    .map((tool) => tool["name"])
    .filter((name): name is string => typeof name === "string")
    .sort()
}

describe("omo-senpi task component wiring", () => {
  it("#given an empty project #when the task component registers and the session starts without task activity #then no state directory is created", async () => {
    const project = tempProject()
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => project }).register(pi, ctxFor(pi, logger))
    expect(readdirSync(project)).toEqual([])

    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, {})
    expect(readdirSync(project)).toEqual([])
  })

  it("#given an explicit team member process #when the task component registers #then no lead task surface is wired", async () => {
    // given
    const previousMember = process.env.SENPI_TASK_MEMBER
    process.env.SENPI_TASK_MEMBER = "11111111-1111-4111-8111-111111111111::alice"
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    try {
      // when
      await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))
    } finally {
      if (previousMember === undefined) delete process.env.SENPI_TASK_MEMBER
      else process.env.SENPI_TASK_MEMBER = previousMember
    }

    // then
    expect(toolNames(pi)).toEqual([])
    expect(pi.commands).toEqual([])
    expect(pi.messageRenderers).toEqual([])
    expect(pi.handlers).toEqual([])
  })

  it("#given a fake ExtensionAPI boot #when the task component registers #then tools, commands, the completion renderer, and event handlers are wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    expect(toolNames(pi)).toEqual([...ALL_TOOL_NAMES].sort())
    // placement contract (engine `ToolDefinition.runs`): subagent, workflow and team tools run on the loop side
    expect(pi.tools.filter((tool) => tool["runs"] !== "brain").map((tool) => tool["name"])).toEqual([])
    // the /tasks and /task-kill commands registered
    expect(pi.commands.map((entry) => entry.name).sort()).toEqual([...TASK_COMMANDS].sort())
    // Peer mail is a plain injected turn; completion, member liveness, and the dead-chain category
    // warning use structured renderers.
    expect(pi.messageRenderers.map((entry) => entry.customType)).toEqual([
      "senpi-task.completion",
      "senpi-task.team-member-liveness",
      "senpi-task.category-unavailable",
    ])
    // exactly the task event handlers (session lifecycle + transition-buffer edges), the
    // skill-invocation tracker subscriptions feeding the plan-gated agent gate, plus the
    // unconditional T16 hygiene sweep handler, which registers its own session_start listener,
    // plus the workpool aggregate attach-recovery listener (registerWorkpoolTool session_start
    // → workpools.attach, which rolls back accepted-without-ack and flushes on boot), plus the
    // host pre-warm's session_start (revival) plus its default `first-turn` edges (input, before_agent_start);
    // the pre-warm registers nothing on win32, where task children never use a host
    const prewarmEvents = process.platform === "win32" ? [] : ["session_start", "input", "before_agent_start"]
    // plus the routing-profile restore's session_start (re-applies the persisted profile on every
    // start) and the /dag watch holder's session_shutdown (closes an open watch with its session)
    const compositionEvents = ["session_start", "session_shutdown"]
    expect(pi.handlers.map((handler) => handler.event).sort()).toEqual(
      [...TASK_EVENTS, ...SKILL_INVOCATION_TRACKER_EVENTS, ...DAG_LIFECYCLE_EVENTS, "session_start", "session_shutdown", "session_start", ...compositionEvents, ...prewarmEvents].sort(),
    )
  })

  it("#given task and DAG lifecycle handlers #when startup and shutdown dispatch #then task reconciliation precedes DAG resume while DAG pause precedes task suspension and DAG disposal", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const order: string[] = []
    const wireDagLifecycle = Reflect.get(taskComponentModule, "wireDagLifecycle")
    expect(typeof wireDagLifecycle).toBe("function")
    if (typeof wireDagLifecycle !== "function") return
    const wired = wireDagLifecycle(pi, {
      attach: async () => { order.push("dag-resume") },
      detach: () => { order.push("dag-detach") },
      pauseForShutdown: async () => { order.push("dag-pause") },
      dispose: () => { order.push("dag-dispose") },
      resend: () => {},
    }, () => {
      pi.on("session_start", () => { order.push("task-reconcile") })
      pi.on("session_shutdown", () => { order.push("task-suspend") })
      return { afterSessionStartReconcile: () => Promise.resolve(true) }
    })

    // when
    await pi.dispatch("session_start", {})
    await wired.lastAttach()
    await pi.dispatch("session_before_switch", { reason: "resume" })
    expect(order).toEqual(["task-reconcile", "dag-resume"])
    await pi.dispatch("session_shutdown", {})

    // then
    expect(order).toEqual([
      "task-reconcile",
      "dag-resume",
      "dag-pause",
      "dag-detach",
      "task-suspend",
      "dag-dispose",
    ])
  })

  it("#given a fake ExtensionAPI boot #when the task component registers #then only injection-driven lead team tools are wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    const registered = toolNames(pi)
    for (const teamTool of TEAM_TOOL_NAMES) expect(registered).toContain(teamTool)
    expect(registered).not.toContain("team_wait")
  })

  it("#given the removed-tool hint capability #when the task component registers #then team_wait receives steer guidance", async () => {
    // given
    const pi = new FakeExtensionAPI() as FakeExtensionAPI & {
      registerRemovedToolHint: (name: string, hint: string) => void
    }
    const hints: Array<{ name: string; hint: string }> = []
    pi.registerRemovedToolHint = (name, hint) => hints.push({ name, hint })
    const logger = createLogger()

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then
    expect(hints).toEqual([{
      name: "team_wait",
      hint: "team_wait was removed - team messages arrive as steered notifications; send updates with task_send and end your turn.",
    }])
  })

  it("#given the omo-task flag is false #when the component registers #then only the unconditional hygiene sweep handler is wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    pi.setFlag("omo-task", false)

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then
    expect(pi.tools).toEqual([])
    expect(pi.handlers.map((handler) => handler.event)).toEqual(["session_start"])
    expect(pi.messageRenderers).toEqual([])
    expect(logger.entries).toContainEqual({ level: "info", message: "omo-senpi task component disabled by flag" })
  })

  it("#given a malformed omo.json #when the component registers #then it boots with defaults and still wires the tools", async () => {
    // given a project whose .omo/omo.json is invalid JSON
    const project = tempProject()
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(join(project, ".omo", "omo.json"), "{ not valid json ", "utf8")
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => project }).register(pi, ctxFor(pi, logger))

    // then it never crashed: all tools still registered
    expect(toolNames(pi)).toEqual([...ALL_TOOL_NAMES].sort())
    // diagnostics are surfaced once by the dedicated config-startup component on session_start.
    expect(logger.entries).toEqual([])
  })

  it("#given a wired bridge #when session_start fires repeatedly #then the team mailbox is reconciled on every start", async () => {
    // given
    const [first, second] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let completed = 0
    const { pi, reconcileCalls, leadCalls } = wiredBridge(() => [first, second][completed++]?.resolve())
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }

    // when the session starts twice
    await pi.dispatch("session_start", {}, liveCtx)
    await first.promise
    await pi.dispatch("session_start", {}, liveCtx)
    await second.promise

    // then
    expect(reconcileCalls.count).toBe(2)
    expect(leadCalls.ticks).toBe(2)
  })

  it("#given a session start #when reconciliation runs #then reattach, cleanup, mailbox reclaim, notification retry, and lead polling stay ordered", async () => {
    // given
    const cwd = tempProject()
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
    const order: string[] = []
    const recovered = Promise.withResolvers<void>()
    const engine: TaskEngine = {
      ...base,
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async (sessionId) => {
          order.push(`reattach:${sessionId}`)
          return { outcomes: [] }
        },
        cleanupExpiredRecords: async () => {
          order.push("cleanup")
          return { deleted: [], retained: [] }
        },
      },
      notifier: {
        ...base.notifier,
        reconcileUnnotifiedNotifications: () => { order.push("notify") },
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => {
        order.push("reclaim")
        return Promise.resolve()
      },
      leadPollers: {
        tick: () => {
          order.push("poll")
          recovered.resolve()
          return Promise.resolve()
        },
        shutdown: () => undefined,
      },
      resumptionChannels: noopResumptionChannels,
    })

    // when
    await pi.dispatch("session_start", {}, {
      ui: fakeUi(),
      mode: "tui",
      sessionManager: { getSessionId: () => "session-a" },
    })
    await recovered.promise

    // then
    expect(order).toEqual(["reattach:session-a", "reclaim", "notify", "cleanup", "poll"])
  })

  it("#given a terminal member owned by lead A #when lead B reconciles then lead A reconciles #then only the owning lead receives replay", async () => {
    let recovered = Promise.withResolvers<void>()
    const cwd = tempProject()
    const teamRunId = await seedTeamRuntime(cwd, "lead-a")
    const terminal = terminalRecord(teamRunId)
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
    const engine: TaskEngine = {
      ...base,
      manager: {
        ...base.manager,
        get: () => terminal,
        list: (scope) => base.manager.list(scope),
      },
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async () => ({ outcomes: [{ task_id: terminal.task_id, kind: "resumed" }] }),
        cleanupExpiredRecords: async () => ({ deleted: [], retained: [] }),
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => Promise.resolve(),
      leadPollers: { tick: async () => { recovered.resolve() }, shutdown: () => undefined },
      resumptionChannels: noopResumptionChannels,
    })

    await pi.dispatch("session_start", {}, {
      sessionManager: { getSessionId: () => "lead-b" },
    })
    await recovered.promise
    expect(pi.messages).toEqual([])

    recovered = Promise.withResolvers<void>()
    await pi.dispatch("session_start", {}, {
      sessionManager: { getSessionId: () => "lead-a" },
    })
    await recovered.promise
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message.customType).toBe("senpi-task.team-member-liveness")
  })

  it("#given a liveness send before host persistence #when the process crashes and restarts #then no early ack suppresses replay and agent_end later commits the exact persisted marker", async () => {
    const recovered = Promise.withResolvers<void>()
    const cwd = tempProject()
    const teamRunId = await seedTeamRuntime(cwd, "lead-session")
    const terminal = terminalRecord(teamRunId)
    const store = createTaskRecordStore({ project_dir: cwd })
    store.save(terminal)

    const firstPi = new FakeExtensionAPI()
    const firstEngine = composeTaskEngine({
      pi: firstPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    firstEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => "lead-session" } })
    await firstEngine.notifyOwnedMemberLiveness(terminal)
    expect(firstPi.messages).toHaveLength(1)
    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBeUndefined()

    const replayPi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({
      pi: replayPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    const engine: TaskEngine = {
      ...base,
      manager: {
        ...base.manager,
        get: () => store.load(terminal.task_id) ?? undefined,
        list: (scope) => base.manager.list(scope),
      },
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async () => ({ outcomes: [{ task_id: terminal.task_id, kind: "resumed" }] }),
        cleanupExpiredRecords: async () => ({ deleted: [], retained: [] }),
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(replayPi, ctxFor(replayPi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => Promise.resolve(),
      leadPollers: { tick: async () => { recovered.resolve() }, shutdown: () => undefined },
      resumptionChannels: noopResumptionChannels,
    })
    const sessionFile = join(cwd, "lead-session.jsonl")
    const liveContext = {
      sessionManager: {
        getSessionId: () => "lead-session",
        getSessionFile: () => sessionFile,
      },
    }

    await replayPi.dispatch("session_start", {}, liveContext)
    await recovered.promise
    expect(replayPi.messages).toHaveLength(1)
    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBeUndefined()

    const replayMessage = replayPi.messages[0]?.message
    if (replayMessage === undefined) throw new Error("expected replay liveness message")
    writeFileSync(sessionFile, `${JSON.stringify({ type: "custom_message", ...replayMessage })}\n`, "utf8")
    await replayPi.dispatch("agent_end", {}, liveContext)

    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBe(0)
  })

  it("#given a captured ui #when session_before_switch fires #then the ui bridge is cleared", async () => {
    // given a wired event bridge over a real engine with a ui captured on session_start
    const { pi, engine } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }
    await pi.dispatch("session_start", {}, liveCtx)
    expect(engine.runtime.ui()).toBeDefined()

    // when a switch fires while a still-live ui context is present (the real ExtensionContext.ui is
    // non-optional, so captureFrom would otherwise re-capture it)
    await pi.dispatch("session_before_switch", {}, { ...liveCtx, ui: fakeUi() })

    // then the bridge is cleared, so store-driven syncs no-op until the next re-capture
    expect(engine.runtime.ui()).toBeUndefined()
  })

  it("#given a captured ui #when session_shutdown fires #then the ui bridge is cleared", async () => {
    // given a wired event bridge with a ui captured on session_start
    const { pi, engine, leadCalls } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }
    await pi.dispatch("session_start", {}, liveCtx)
    expect(engine.runtime.ui()).toBeDefined()

    // when the session shuts down
    await pi.dispatch("session_shutdown", {}, { ...liveCtx, ui: fakeUi() })

    // then the bridge is cleared
    expect(engine.runtime.ui()).toBeUndefined()
    expect(leadCalls.shutdowns).toBe(1)
  })

  it("#given an ExtensionAPI missing registerMessageRenderer #when the component registers #then it skips with one warning and never crashes", async () => {
    // given a pi whose registerMessageRenderer capability is absent
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    ;(pi as { registerMessageRenderer?: unknown }).registerMessageRenderer = undefined

    // when
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then no tools wired; only the unconditional hygiene sweep handler remains
    expect(pi.tools).toEqual([])
    expect(pi.handlers.map((handler) => handler.event)).toEqual(["session_start"])
    const skipWarnings = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.includes("missing ExtensionAPI capabilities"),
    )
    expect(skipWarnings).toHaveLength(1)
  })

  it("#given routing profiles #when /routing selects one #then the choice persists, the surfaces re-register, and a new session restores it", async () => {
    // given a component whose profile switch routes a new agent
    const project = tempProject()
    const routed = {
      ...loadOmoConfig({ cwd: project }).config,
      agents: {
        scout: { description: "Routed scout", prompt: "Scout the routed tree." },
      },
    } as unknown as OmoConfig
    const pi = new AppendEntryFakeExtensionAPI()
    const appended = pi.appended
    const notifies: Array<{ message: string; type?: string }> = []
    const ui = { notify: (message: string, type?: "info" | "warning" | "error"): void => {
      notifies.push({ message, type })
    } }
    await createTaskComponent({
      loadJobWidgetHost: noJobWidgetHost,
      resolveCwd: () => project,
      loadConfig: routingLoadConfig(project, routed),
    }).register(pi, ctxFor(pi, createLogger()))
    const routing = routingHandlerFor(pi)
    const count = (name: string): number => pi.tools.filter((tool) => tool["name"] === name).length
    const taskDescriptions = (): string[] => pi.tools
      .filter((tool) => tool["name"] === "task")
      .map((tool) => String(tool["description"] ?? ""))
    const beforeTask = count("task")
    const beforeTeamCreate = count("team_create")
    expect(taskDescriptions()[0]).not.toContain("scout")

    // when /routing selects the profile
    await routing("alpha", { ui })

    // then the choice persists and every routing surface re-registers
    expect(notifies.at(-1)).toMatchObject({ message: "Task routing set to alpha.", type: "info" })
    expect(appended).toEqual([{ customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: "alpha" } }])
    expect(count("task")).toBe(beforeTask + 1)
    expect(count("team_create")).toBe(beforeTeamCreate + 1)
    // the re-registered model-facing description carries the routed agent
    expect(taskDescriptions().at(-1)).toContain("scout")

    // when a new session starts carrying the persisted branch entry
    await pi.dispatch("session_start", {}, branchCtx("session-a", "alpha"))

    // then the restore applies the same routing again without another persist
    expect(count("task")).toBe(beforeTask + 2)
    expect(appended).toHaveLength(1)
    await routing("", { ui })
    expect(notifies.at(-1)?.message).toContain("alpha")
  })

  it("#given an active routing profile #when /routing resets #then the default returns and a bare session does not leak the selection", async () => {
    // given a selected profile
    const project = tempProject()
    const routed = {
      ...loadOmoConfig({ cwd: project }).config,
      agents: {
        scout: { description: "Routed scout", prompt: "Scout the routed tree." },
      },
    } as unknown as OmoConfig
    const pi = new AppendEntryFakeExtensionAPI()
    const appended = pi.appended
    const notifies: Array<{ message: string; type?: string }> = []
    const ui = { notify: (message: string, type?: "info" | "warning" | "error"): void => {
      notifies.push({ message, type })
    } }
    await createTaskComponent({
      loadJobWidgetHost: noJobWidgetHost,
      resolveCwd: () => project,
      loadConfig: routingLoadConfig(project, routed),
    }).register(pi, ctxFor(pi, createLogger()))
    const routing = routingHandlerFor(pi)
    await routing("alpha", { ui })
    expect(appended).toHaveLength(1)

    // when /routing resets to the default
    await routing("default", { ui })

    // then the reset persists the null marker and re-applies the base routing
    expect(notifies.at(-1)?.message).toContain("default")
    expect(appended.at(-1)).toEqual({ customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: null } })

    // when a bare session (no branch override) starts afterwards
    await pi.dispatch("session_start", {}, branchCtx("session-b"))

    // then it reads the default, not the previous session's selection
    await routing("", { ui })
    expect(notifies.at(-1)?.message).toMatch(/^Task routing: default\./)
  })

  it("#given an unknown profile #when /routing selects it and a session restores it #then both refuse without crashing", async () => {
    // given
    const project = tempProject()
    const pi = new AppendEntryFakeExtensionAPI()
    const appended = pi.appended
    const notifies: Array<{ message: string; type?: string }> = []
    const ui = { notify: (message: string, type?: "info" | "warning" | "error"): void => {
      notifies.push({ message, type })
    } }
    await createTaskComponent({
      loadJobWidgetHost: noJobWidgetHost,
      resolveCwd: () => project,
      loadConfig: routingLoadConfig(project, loadOmoConfig({ cwd: project }).config),
    }).register(pi, ctxFor(pi, createLogger()))
    const routing = routingHandlerFor(pi)
    const taskCount = (): number => pi.tools.filter((tool) => tool["name"] === "task").length
    const toolsBefore = taskCount()

    // when an unknown profile is selected
    await routing("nope", { ui })

    // then it warns, persists nothing, and re-registers nothing
    expect(notifies.at(-1)).toMatchObject({ type: "warning" })
    expect(notifies.at(-1)?.message).toContain("nope")
    expect(appended).toEqual([])
    expect(taskCount()).toBe(toolsBefore)

    // when a session restores the same unknown profile from its branch
    await pi.dispatch("session_start", {}, branchCtx("session-a", "nope"))

    // then startup falls back to the default instead of crashing
    await routing("", { ui })
    expect(notifies.at(-1)?.message).toContain("default")
    expect(notifies.at(-1)?.message).not.toContain("nope")
  })

  it("#given full registration #when both watches run headless #then each rides its composed watch seam and shutdown resets cleanly", async () => {
    // given a fully registered component
    const project = tempProject()
    const pi = new FakeExtensionAPI()
    await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => project })
      .register(pi, ctxFor(pi, createLogger()))
    const command = (name: string): ((args: string, ctx: unknown) => Promise<unknown>) => {
      const entry = pi.commands.find((candidate) => candidate.name === name)
      if (entry === undefined) throw new Error(`expected ${name} command`)
      const handler = entry.options["handler"]
      if (typeof handler !== "function") throw new Error(`expected ${name} handler`)
      return handler as (args: string, ctx: unknown) => Promise<unknown>
    }
    const headless = (sessionId: string): unknown => ({
      ui: {
        notify: (message: string, type?: string): void => {
          headlessNotifies.push({ message, type })
        },
      },
      mode: "rpc",
      sessionManager: { getSessionId: () => sessionId },
    })
    const headlessNotifies: Array<{ message: string; type?: string }> = []

    // when /tasks watch runs without an interactive terminal
    await command("tasks")("watch", headless("session-a"))

    // then it reaches the composed task watch seam, not the unavailable fallback
    expect(headlessNotifies).toHaveLength(1)
    expect(headlessNotifies[0]).toMatchObject({ type: "info" })

    // when /dag watch runs without an interactive terminal
    await command("dag")("watch", headless("session-a"))

    // then it reaches the composed DAG watch seam, not the unavailable fallback
    expect(headlessNotifies).toHaveLength(2)
    expect(headlessNotifies[1]).toMatchObject({ type: "info" })

    // when the session shuts down and a new one starts
    await pi.dispatch("session_shutdown", {}, headless("session-a"))
    await pi.dispatch("session_start", {}, {
      ui: fakeUi(),
      mode: "tui",
      sessionManager: { getSessionId: () => "session-a", getBranch: () => [] },
    })

    // then the lifecycle closes and resets without throwing
    expect(headlessNotifies).toHaveLength(2)
  })
})
