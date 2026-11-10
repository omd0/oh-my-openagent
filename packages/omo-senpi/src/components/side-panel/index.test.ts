import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { OmoSidePanelSettingsSchema, type OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, SenpiAccountLimits } from "../../extension/types"

import {
  GIT_REFRESH_FLOOR_MS,
  MEMORY_REFRESH_FLOOR_MS,
  PI_TUI_LAYOUT_NODE,
  PI_TUI_VIEWPORT,
  SIDE_PANEL_ANCHOR_WIDGET_KEY,
  SIDE_PANEL_FLAG,
  SIDE_PANEL_OPEN_COMMAND,
} from "./constants"
import { createSidePanelComponent } from "./index"
import type { PanelMemory, PanelMemoryIdentity, PanelTimers } from "./types"
import { DAG_SECTION_ROW_FLOOR, SIDE_PANEL_DAG_COMMAND, SIDE_PANEL_DIFF_COMMAND, SIDE_PANEL_WIDGET_KEY } from "./constants"
import type { PanelTaskRecord } from "./data/task-records"
import { claimDagPanelFeed } from "../task/dag-panel-feed"
import { dagNode, dagRun } from "./dag-panel.test-support"
import { panelActionUrl } from "./links"
import type { PopupComponent } from "./popups/text-popup"
import type { PanelComponent } from "./types"
import { claimRegularModeNotice, REGULAR_MODE_NOTICE_MARKER } from "./regular-mode-notice"
import { testTempDir } from "../../../test-support/temp-dir"

interface WidgetCall {
  readonly key: string
  readonly content: unknown
}

function hostContext(widgets: WidgetCall[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(key: string, content: unknown) {
        widgets.push({ key, content })
      },
      notify() {},
    },
    ...overrides,
  }
}

function componentContext(pi: FakeExtensionAPI): ComponentContext {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  }
}

function settings(overrides: Partial<OmoSidePanelSettings> = {}): OmoSidePanelSettings {
  const parsed = OmoSidePanelSettingsSchema.parse({})
  // The usage section is the only one that reads credentials and reaches the network, so it is
  // off unless a test asks for it and hands over its own ports.
  // Clicks paint OSC 8 links over the rows and claim the host url hook, so they are off
  // unless a test asks for them: the row assertions here read plain text.
  return { ...parsed, clickable: false, sections: { ...parsed.sections, usage: false }, ...overrides }
}

describe("side panel component", () => {
  test("#given the panel is disabled #when a session starts #then nothing is mounted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: false }) }).register(pi, componentContext(pi))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets).toEqual([])
  })

  test("#given the panel is enabled in config #when a session starts #then the anchor widget is installed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.map((call) => call.key)).toEqual([SIDE_PANEL_ANCHOR_WIDGET_KEY])
  })

  test("#given the flag is registered #when read before any CLI override #then it reports no opinion", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    createSidePanelComponent({ loadSettings: () => settings() }).register(pi, componentContext(pi))

    // then
    const registration = pi.flags.find((flag) => flag.name === SIDE_PANEL_FLAG)
    expect(registration?.options.type).toBe("boolean")
    expect(registration?.options.default).toBeUndefined()
    expect(pi.getFlag(SIDE_PANEL_FLAG)).toBeUndefined()
  })

  // The CLI can only produce `true` for a boolean extension flag (senpi ignores any value that
  // follows it and rejects a `--no-` form), so this is the reachable override direction.
  test("#given the flag forces the panel on #when config says off #then the panel still mounts", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: false }) }).register(pi, componentContext(pi))
    pi.setFlag(SIDE_PANEL_FLAG, true)

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.map((call) => call.key)).toEqual([SIDE_PANEL_ANCHOR_WIDGET_KEY])
  })

  test("#given a false flag value from the host #when config says on #then nothing is mounted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    // Not reachable from the CLI, but the SDK carries flag values across session reloads.
    pi.setFlag(SIDE_PANEL_FLAG, false)

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets).toEqual([])
  })

  test("#given a host without a ui context #when a session starts #then the component stays dark", async () => {
    // given
    const pi = new FakeExtensionAPI()
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))

    // when
    const results = await pi.dispatch("session_start", {}, { mode: "tui", hasUI: true })

    // then
    expect(results).toEqual([undefined])
  })

  test("#given a mounted panel #when the session shuts down #then the anchor widget is cleared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // when
    await pi.dispatch("session_shutdown", {}, hostContext(widgets))

    // then
    const anchorCalls = widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)
    expect(anchorCalls).toHaveLength(2)
    expect(anchorCalls[1]?.content).toBeUndefined()
  })

  test("#given a second session_start #when the panel is already mounted #then it is not mounted twice", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)).toHaveLength(1)
  })
})

describe("side panel session command", () => {
  test.each([true, false])("#given enabled=%s and a mounted panel #when off runs #then the original layout returns", async (enabled) => {
    const harness = mounted({ loadSettings: () => settings({ enabled }) })
    const originalRoot = harness.tui.layoutRoot
    await harness.pi.dispatch("session_start", {}, harness.host)
    if (!enabled) await runPanelCommand(harness, "")
    harness.attach()
    expect(harness.tui.layoutRoot).not.toBe(originalRoot)

    await runPanelCommand(harness, "off")

    expect(harness.tui.layoutRoot).toBe(originalRoot)
    expect(harness.widgets.at(-1)?.content).toBeUndefined()
    await harness.pi.dispatch("turn_end", {}, harness.host)
    expect(harness.tui.layoutRoot).toBe(originalRoot)
  })

  test("#given a panel closed by command #when opened again #then the column returns", async () => {
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    await runPanelCommand(harness, "off")
    const closedRoot = harness.tui.layoutRoot

    await runPanelCommand(harness, "")
    harness.attach()

    expect(harness.tui.layoutRoot).not.toBe(closedRoot)
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
  })

  test("#given the panel is already off #when off runs #then no runtime is loaded", async () => {
    let loads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: false }),
      loadRuntime: async () => {
        loads += 1
        return (await import("./runtime")).createSidePanelController
      },
    })
    await harness.pi.dispatch("session_start", {}, harness.host)

    await runPanelCommand(harness, "off")

    expect(loads).toBe(0)
    expect(harness.widgets).toEqual([])
  })

  test.each(["command", "session"])("#given a pending %s activation #when off runs #then late loading cannot mount", async (source) => {
    const gate = deferred<undefined>()
    const harness = mounted({
      loadSettings: () => settings({ enabled: source === "session" }),
      loadRuntime: async () => {
        await gate.promise
        return (await import("./runtime")).createSidePanelController
      },
    })
    const starting = source === "session"
      ? harness.rawDispatch("session_start", {}, harness.host)
      : runPanelCommand(harness, "")

    const stopping = runPanelCommand(harness, "off")
    gate.resolve(undefined)
    await Promise.all([starting, stopping])

    expect(harness.widgets.some((call) => call.content !== undefined)).toBe(false)
  })

  test.each(["command", "session"])("#given a %s activation reading data #when off runs #then late completion does not prevent reopening", async (source) => {
    const gate = deferred<undefined>()
    const reading = deferred<undefined>()
    const harness = mounted({
      loadSettings: () => settings({ enabled: source === "session" }),
      readTaskRecords: async () => {
        reading.resolve(undefined)
        await gate.promise
        return []
      },
    })
    const originalRoot = harness.tui.layoutRoot
    const starting = source === "session"
      ? harness.rawDispatch("session_start", {}, harness.host)
      : runPanelCommand(harness, "")
    await reading.promise

    await runPanelCommand(harness, "off")
    gate.resolve(undefined)
    await starting
    await runPanelCommand(harness, "")
    harness.attach()

    expect(harness.tui.layoutRoot).not.toBe(originalRoot)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
  })

  test("#given a regular TUI session #when /side-panel runs #then fullscreen is requested before anything mounts", async () => {
    // given: the host exposes the mode API and reports regular mode
    const events: string[] = []
    let liveWidgets: WidgetCall[] = []
    const harness = mounted({}, {}, "/repo", {
      getTuiMode: () => "regular",
      setTuiMode: (mode: string) => {
        events.push(`mode:${mode}:${liveWidgets.length}`)
        return true
      },
    })
    liveWidgets = harness.widgets

    // when
    await runPanelCommand(harness, "")

    // then: the switch happens with nothing mounted, so the anchor sees the rebuilt renderer
    expect(events).toEqual(["mode:fullscreen:0"])
    expect(harness.widgets.map((call) => call.key)).toEqual([SIDE_PANEL_ANCHOR_WIDGET_KEY])
  })

  test("#given a panel opened through the mode switch #when off runs #then the pre-command mode is restored", async () => {
    // given
    const events: string[] = []
    let liveWidgets: WidgetCall[] = []
    const harness = mounted({}, {}, "/repo", {
      getTuiMode: () => "regular",
      setTuiMode: (mode: string) => {
        events.push(`mode:${mode}:${liveWidgets.length}`)
        return true
      },
    })
    liveWidgets = harness.widgets
    await runPanelCommand(harness, "")

    // when
    await runPanelCommand(harness, "off")

    // then: the widget is cleared before the renderer goes back to the pre-command mode
    expect(events).toHaveLength(2)
    expect(events[0]).toBe("mode:fullscreen:0")
    expect(events[1]?.startsWith("mode:regular:")).toBe(true)
    expect(harness.widgets.at(-1)?.content).toBeUndefined()
  })

  test("#given a host that refuses the mode switch #when /side-panel runs #then nothing mounts and the user is told", async () => {
    // given
    const switches: string[] = []
    const harness = mounted({}, {}, "/repo", {
      getTuiMode: () => "regular",
      setTuiMode: (mode: string) => {
        switches.push(mode)
        return false
      },
    })

    // when
    await runPanelCommand(harness, "")

    // then
    expect(switches).toEqual(["fullscreen"])
    expect(harness.widgets).toEqual([])
    expect(harness.notices).toContain("Close open overlays first, then run /side-panel again.")
  })

  test("#given a widget-mode panel already mounted #when /side-panel runs #then it upgrades to the fullscreen column", async () => {
    // given: config mounted the panel before any mode switch, so the surface is the widget fallback
    const switches: string[] = []
    let upgraded = false
    const harness = mounted(
      { regularNoticeStateDir: testTempDir("omo-side-panel-upgrade-") },
      {},
      "/repo",
      {
        getTuiMode: () => (upgraded ? "fullscreen" : "regular"),
        setTuiMode: (mode: string) => {
          switches.push(mode)
          upgraded = true
          return true
        },
      },
    )
    await harness.pi.dispatch("session_start", {}, harness.host)
    const regular: Record<PropertyKey, unknown> = {
      requestRender() {},
      terminal: { columns: 200 },
    }
    harness.attachWith(regular)
    const anchorsBefore = harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length

    // when: the renderer is rebuilt with the layout seam and the command runs
    const transcriptRoot = { render: () => ["transcript"], invalidate: () => {} }
    regular["layoutRoot"] = transcriptRoot
    regular["setLayoutRoot"] = (component: unknown) => {
      regular["layoutRoot"] = component
    }
    regular[PI_TUI_VIEWPORT] = true
    await runPanelCommand(harness, "")

    // then: the panel reattaches through a fresh anchor and wraps the rebuilt root
    expect(switches).toEqual(["fullscreen"])
    expect(harness.notices).toContain("Side panel moved beside the transcript.")
    expect(harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length).toBe(anchorsBefore + 1)
    harness.attachWith(regular)
    expect(regular["layoutRoot"]).not.toBe(transcriptRoot)
  })
})

async function runPanelCommand(harness: ReturnType<typeof mounted>, args: string): Promise<void> {
  const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_OPEN_COMMAND)?.options["handler"]
  if (typeof handler !== "function") throw new Error("side panel command missing")
  await handler(args, harness.host)
}

// --- wiring: the whole chain from config to painted rows ---------------------------

interface FakeTui {
  layoutRoot: unknown
  readonly terminal: { columns: number }
  renders: number
  setLayoutRoot(component: unknown): void
  requestRender(): void
  openUrl?: (url: string) => void
  readonly [PI_TUI_VIEWPORT]: true
}

function fakeTui(columns = 200): FakeTui {
  const root = { render: () => ["transcript"], invalidate: () => {} }
  const tui: FakeTui = {
    layoutRoot: root,
    terminal: { columns },
    renders: 0,
    setLayoutRoot(component) {
      tui.layoutRoot = component
    },
    requestRender() {
      tui.renders += 1
    },
    [PI_TUI_VIEWPORT]: true,
  }
  return tui
}

interface ManualTimers extends PanelTimers {
  fire(): void
  pending(): number
}

function manualTimers(): ManualTimers {
  let queue: Array<() => void> = []
  return {
    set(callback) {
      queue.push(callback)
      return queue.length
    },
    clear() {
      queue = []
    },
    fire() {
      const due = queue
      queue = []
      for (const callback of due) callback()
    },
    pending: () => queue.length,
  }
}

/** Render the panel column the way the layout engine would. */
function columnRows(tui: FakeTui, width = 52): string[] {
  const root = tui.layoutRoot
  if (typeof root !== "object" || root === null) throw new Error("no layout root")
  const accessor = (root as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
  if (typeof accessor !== "function") throw new Error("root is not a layout node")
  const node = accessor() as { entries: ReadonlyArray<{ component: { render(width: number): string[] } }> }
  const panel = node.entries[1]?.component
  if (panel === undefined) throw new Error("no panel entry")
  // The column paints a divider gutter the content assertions do not own: strip it here so the
  // wiring keeps asserting section facts, while the layout tests below own the raw frame.
  return panel.render(width).map((line) => stripColumnFrame(line))
}

/** Remove the column frame (divider + gutters) from one painted line. */
function stripColumnFrame(line: string): string {
  const trimmed = line.trimEnd()
  if (trimmed === "│" || trimmed === "") return ""
  if (trimmed.startsWith("│ ")) return trimmed.slice(2).trimEnd()
  if (trimmed.startsWith("│")) return trimmed.slice(1).trimEnd()
  if (trimmed.startsWith(" ")) return trimmed.slice(1).trimEnd()
  return trimmed
}

/** The raw painted frame, owned by the layout tests. */
function rawColumnRows(tui: FakeTui, width = 52): string[] {
  const root = tui.layoutRoot
  if (typeof root !== "object" || root === null) throw new Error("no layout root")
  const accessor = (root as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
  if (typeof accessor !== "function") throw new Error("root is not a layout node")
  const node = accessor() as { entries: ReadonlyArray<{ component: { render(width: number): string[] } }> }
  const panel = node.entries[1]?.component
  if (panel === undefined) throw new Error("no panel entry")
  return panel.render(width).map((line) => line.trimEnd())
}

function mounted(
  overrides: Partial<Parameters<typeof createSidePanelComponent>[0]> = {},
  hostExtras: Record<string, unknown> = {},
  cwd = "/repo",
  uiExtras: Record<string, unknown> = {},
) {
  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  const widgets: WidgetCall[] = []
  const timers = manualTimers()
  let clock = 100_000
  const pending: Promise<void>[] = []
  const component = createSidePanelComponent({
    loadSettings: () => settings({ enabled: true }),
    defer: (callback) => callback(),
    timers,
    now: () => clock,
    readTaskRecords: () => [],
    // Memory resolves a real identity from the developer's omo.json; only memory tests opt in.
    resolveMemory: () => undefined,
    // The panel starts its refreshes without the host waiting; the harness waits for them, so every
    // assertion after a dispatch reads what that event actually led to.
    track: (work) => {
      pending.push(work)
    },
    ...overrides,
  })
  component.register(pi, componentContext(pi))
  const rawDispatch = pi.dispatch.bind(pi)
  pi.dispatch = async (event, payload, ctx) => {
    const results = await rawDispatch(event, payload, ctx)
    while (pending.length > 0) await Promise.all(pending.splice(0))
    return results
  }
  const tui = fakeTui()
  const notices: string[] = []
  // The latest anchor: a remount registers a fresh one, and an earlier one is stale by design.
  const attachWith = (candidate: unknown): void => {
    const factory = [...widgets].reverse().find((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)?.content
    if (typeof factory !== "function") throw new Error("anchor factory missing")
    ;(factory as (tui: unknown, theme: unknown) => unknown)(candidate, undefined)
  }
  const host = hostContext(widgets, {
    model: { id: "anthropic/claude-opus-5" },
    getContextUsage: () => ({ tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getUsageTotals: () => ({ input: 12_300, output: 4_500, cacheRead: 0, cacheWrite: 0, cost: 1.2 }),
    },
    ui: {
      setWidget(key: string, content: unknown) {
        widgets.push({ key, content })
      },
      notify(message: string) {
        notices.push(message)
      },
      ...uiExtras,
    },
    ...hostExtras,
  })
  return {
    pi,
    rawDispatch,
    tui,
    host,
    timers,
    widgets,
    notices,
    advance: (ms: number) => {
      clock += ms
    },
    attach: (): void => attachWith(tui),
    attachWith,
  }
}

describe("side panel wiring", () => {
  test.each([
    { cwd: "/repo", location: "/repo" },
    {
      cwd: "/workspaces/long-nested-directory/another-directory/oh-my-openagent-test-worktree",
      location: "…/another-directory/oh-my-openagent-test-worktree",
    },
  ])("#given a mounted panel at $cwd #when the column renders #then it carries the session facts and the location", async ({ cwd, location }) => {
    // given
    const harness = mounted({}, {}, cwd)
    await harness.pi.dispatch("session_start", {}, harness.host)

    // when
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows[0]).toBe("SESSION  $1.20 · 16.8K")
    expect(rows).toContain("model   claude-opus-5")
    expect(rows).toContain("CONTEXT  29K/1M")
    expect(rows[rows.length - 1]).toBe(location)
  })

  test("#given a tool starts #when the column renders #then the tool row appears with its target", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("tool_execution_start", { toolName: "read", args: { file_path: "src/index.ts" } }, harness.host)
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("TOOLS  1")
    expect(rows).toContain("read  src/index.ts")
  })

  test("#given recorded tools #when the next user input arrives #then the tool section is cleared", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    await harness.pi.dispatch("tool_execution_start", { toolName: "read" }, harness.host)

    // when
    await harness.pi.dispatch("input", { text: "next" }, harness.host)
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("TOOLS"))).toBe(false)
  })

  test("#given a running child in the task store #when the column renders #then its row shows live elapsed time", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        {
          task_id: "t1",
          status: "running",
          created_at: new Date(40_000).toISOString(),
          parent_session_id: "session-1",
          task_summary: "map the seams",
        },
      ],
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("AGENTS  1 running · 0 done")
    expect(rows.some((row) => row.startsWith("● map the seams  1m00"))).toBe(true)
  })

  test("#given another session's child #when the column renders #then it is not shown", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t2", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "other" },
      ],
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given a running child #when the live timer fires #then the panel repaints and rearms", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t1", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "session-1" },
      ],
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const before = harness.tui.renders

    // when
    harness.timers.fire()

    // then
    expect(harness.tui.renders).toBeGreaterThan(before)
    expect(harness.timers.pending()).toBe(1)
  })

  test("#given no running children #when mounted #then no live timer is armed", async () => {
    // given
    const harness = mounted()

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(harness.timers.pending()).toBe(0)
  })

  test("#given a mounted panel #when the session shuts down #then the timer is cleared and the root restored", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t1", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "session-1" },
      ],
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // then
    expect(harness.timers.pending()).toBe(0)
    expect((harness.tui.layoutRoot as { render(width: number): string[] }).render(10)).toEqual(["transcript"])
  })
})

// --- git wiring -------------------------------------------------------------------

const GIT_STATUS = " M tracked.txt\u0000?? brand-new.txt\u0000"
const GIT_UNSTAGED = "2\t1\ttracked.txt\u0000"

function gitExec(calls: string[][] = []) {
  const exec = async (_command: string, args: string[]) => {
    calls.push(args)
    if (args[0] === "status") return { stdout: GIT_STATUS, stderr: "", code: 0 }
    if (args.includes("--cached")) return { stdout: "", stderr: "", code: 0 }
    return { stdout: GIT_UNSTAGED, stderr: "", code: 0 }
  }
  return { exec, calls }
}

describe("side panel git wiring", () => {
  test("#given a repository and a host exec #when the column renders #then changed files and the branch appear", async () => {
    // given
    const { exec } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => "feat/side-panel" })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("FILES  2 changed")
    expect(rows.some((row) => row.startsWith(" M tracked.txt") && row.endsWith("+2/-1"))).toBe(true)
    expect(rows).toContain("?? brand-new.txt")
    expect(rows[rows.length - 1]?.endsWith("· feat/side-panel")).toBe(true)
  })

  test("#given two tool ends inside the floor #when git refreshes #then only one read happens", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => undefined })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = calls.length

    // when
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(afterMount).toBe(3)
    expect(calls.length).toBe(afterMount)
  })

  test("#given the floor has passed #when a tool ends #then git is read again", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => undefined })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = calls.length

    // when
    harness.advance(GIT_REFRESH_FLOOR_MS + 1)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls.length).toBe(afterMount + 3)
  })

  test("#given a host without exec #when the column renders #then the files section stays empty", async () => {
    // given
    const harness = mounted({ exec: undefined, findGitRoot: () => "/repo", readGitBranch: () => "main" })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("FILES"))).toBe(false)
  })

  test("#given a directory outside any repository #when mounted #then git is never invoked", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => undefined })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(calls).toEqual([])
    expect(columnRows(harness.tui).some((row) => row.startsWith("FILES"))).toBe(false)
  })
})

describe("side panel usage wiring", () => {
  function engineLimits(initial: readonly SenpiAccountLimits[]) {
    let records = initial
    const listeners = new Set<(limits: SenpiAccountLimits) => void>()
    return {
      get: () => records,
      on: (listener: (limits: SenpiAccountLimits) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      report(next: SenpiAccountLimits) {
        records = [next]
        for (const listener of listeners) listener(next)
      },
    }
  }

  const claudeRecord = (account: string, usedPercent: number): SenpiAccountLimits => ({
    provider: "anthropic-subscription",
    account,
    windows: [{ id: "claude:5h", label: "5h", windowMinutes: 300, usedPercent }],
    reportedAt: new Date(100_000).toISOString(),
  })

  function withEngine(harness: ReturnType<typeof mounted>, engine: ReturnType<typeof engineLimits>) {
    harness.pi.getSubscriptionLimits = engine.get
    harness.pi.onSubscriptionLimits = engine.on
  }

  test("#given the usage section is off #when a session starts #then no credential is ever read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true }),
      usage: {
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
      },
    })
    withEngine(harness, engineLimits([claudeRecord("default", 44)]))

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(reads).toBe(0)
    expect(columnRows(harness.tui).some((row) => row.startsWith("USAGE"))).toBe(false)
  })

  test("#given the engine already holds an account's limits #when the panel mounts #then they are on screen at once", async () => {
    // given the engine polls before any turn (senpi#3684), so a fresh window starts with numbers
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: { readCredentials: () => ({ auth: {}, pool: undefined }) },
    })
    withEngine(harness, engineLimits([claudeRecord("default", 44)]))

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("USAGE"))).toBe(true)
    expect(rows.some((row) => row.includes("44%"))).toBe(true)
  })

  test("#given the engine reports new limits #when the record lands #then the column shows them", async () => {
    // given
    const engine = engineLimits([])
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: { readCredentials: () => ({ auth: {}, pool: undefined }) },
    })
    withEngine(harness, engine)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.startsWith("USAGE"))).toBe(false)

    // when
    engine.report(claudeRecord("default", 63))

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("63%"))).toBe(true)
  })

  test("#given a turn ends #when the panel refreshes #then the serving account is re-read for rotations", async () => {
    // given a pool rotation only shows up when credentials are re-read
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: {
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
      },
    })
    withEngine(harness, engineLimits([]))
    await harness.pi.dispatch("session_start", {}, harness.host)
    const afterMount = reads

    // when
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(afterMount).toBe(1)
    expect(reads).toBeGreaterThan(afterMount)
  })

  test("#given a host without subscription limits #when the section is on #then nothing is read and no section is drawn", async () => {
    // given an older senpi that predates pi.getSubscriptionLimits
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: {
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(reads).toBe(0)
    expect(columnRows(harness.tui).some((row) => row.startsWith("USAGE"))).toBe(false)
  })
})

function allSections(): OmoSidePanelSettings["sections"] {
  return OmoSidePanelSettingsSchema.parse({}).sections
}

describe("side panel goal wiring", () => {
  const GOAL_PATH = "/state/goal.json"
  const OBJECTIVE = "Extend the side panel with the subsystems omo gained since beta.53"
  const goal = {
    objective: OBJECTIVE,
    status: "active" as const,
    tokensUsed: 148_000,
    timeUsedSeconds: 8_040,
    consecutiveContinuations: 0,
    unattendedContinuations: 0,
  }

  test("#given a host that publishes no goal store #when mounted #then no goal block is drawn", async () => {
    // given most sessions carry no goal; the reader's own suite pins that an absent path costs no
    // filesystem call, so what the wiring owes is passing the host's absence through untouched
    const asked: (string | undefined)[] = []
    const harness = mounted({
      readGoal: (path) => {
        asked.push(path)
        return path === undefined ? undefined : goal
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL"))).toBe(false)
    expect(asked.every((path) => path === undefined)).toBe(true)
  })

  test("#given the host exposes a goal store #when mounted #then the goal is on screen", async () => {
    // given
    const harness = mounted({ readGoal: () => goal }, { goalStoreFile: GOAL_PATH })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("GOAL  active"))).toBe(true)
    expect(rows.some((row) => row.includes("Extend the side panel"))).toBe(true)
  })

  test("#given a turn ends #when the goal moved #then the column follows it", async () => {
    // given senpi publishes no goal event an extension can subscribe to, so the ordinary refresh
    // path is what keeps the block current
    let status: "active" | "complete" = "active"
    const harness = mounted({ readGoal: () => ({ ...goal, status }) }, { goalStoreFile: GOAL_PATH })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL  active"))).toBe(true)

    // when
    status = "complete"
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL  complete"))).toBe(true)
  })

  test("#given the goal row is clicked #when the host activates it #then the whole objective opens", async () => {
    // given the row shows a cut objective; the rest of it is the entire point of the click
    const harness = mounted(
      { readGoal: () => goal, loadSettings: () => settings({ enabled: true, clickable: true }) },
      { goalStoreFile: GOAL_PATH },
    )
    const foreign: string[] = []
    harness.tui.openUrl = (url) => foreign.push(url)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:goal/current")
    await Promise.resolve()
    await Promise.resolve()

    // then the host's own callback never sees our scheme, and the full text is delivered - the
    // viewer wraps it to its own column, so the text is compared with those breaks undone
    expect(foreign).toEqual([])
    const delivered = harness.notices.join("\n").replace(/\n/g, " ")
    expect(delivered).toContain(OBJECTIVE)
  })
})

describe("side panel memory wiring", () => {
  const identity: PanelMemoryIdentity = {
    id: "notwork-09334074",
    reflectionDir: "/mem/runtime/reflection",
    recallDir: "/mem/runtime/recall",
    factsQueueDir: "/mem/runtime/facts-queue",
    recallLedgerDir: "/mem/runtime/recall/ledger",
    recallPendingDir: "/mem/runtime/recall/pending",
  }
  const DETAIL = "bwrap: Creating new namespace failed: Operation not permitted"
  const parked: PanelMemory = {
    identity: identity.id,
    reflection: {
      streak: 3,
      parkedAt: "2026-09-21T09:00:00.000Z",
      nextProbeAt: "2026-09-21T15:00:00.000Z",
      reason: "reflection sandbox refused to start",
      detail: DETAIL,
    },
    factsQueued: 3,
    recallSurfaced: 12,
    recallPending: 0,
  }

  test("#given the memory section is off #when mounted #then the identity is never resolved", async () => {
    // given resolving an identity probes the filesystem; a section nobody asked for must not
    const resolved: string[] = []
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, memory: false } }),
      resolveMemory: (cwd) => {
        resolved.push(cwd)
        return identity
      },
      readMemory: () => Promise.resolve(parked),
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(resolved).toEqual([])
    expect(columnRows(harness.tui).some((row) => row.startsWith("MEMORY"))).toBe(false)
  })

  test("#given a resolved identity #when mounted #then the memory block is on screen", async () => {
    // given
    const harness = mounted({ resolveMemory: () => identity, readMemory: () => Promise.resolve(parked) })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("MEMORY  notwork-09334074"))).toBe(true)
    expect(rows.some((row) => row.startsWith("reflect") && row.includes("parked"))).toBe(true)
    expect(rows.some((row) => row.startsWith("facts") && row.includes("3 queued"))).toBe(true)
  })

  test("#given an identity that will not resolve #when mounted #then nothing is read and nothing is drawn", async () => {
    // given memory can be switched off in omo.json, and the resolver can simply fail
    let reads = 0
    const harness = mounted({
      resolveMemory: () => undefined,
      readMemory: () => {
        reads += 1
        return Promise.resolve(parked)
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(reads).toBe(0)
    expect(columnRows(harness.tui).some((row) => row.startsWith("MEMORY"))).toBe(false)
  })

  test("#given a burst of turns #when they land inside the floor #then memory is read once", async () => {
    // given the block costs a park read plus a readdir, and a turn boundary is not a park transition
    let reads = 0
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: () => {
        reads += 1
        return Promise.resolve(parked)
      },
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = reads

    // when
    await harness.pi.dispatch("turn_end", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(afterMount).toBe(1)
    expect(reads).toBe(afterMount)

    // and when the floor has passed
    harness.advance(MEMORY_REFRESH_FLOOR_MS + 1)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(afterMount + 1)
  })

  test("#given the memory row is clicked #when the host activates it #then the park detail opens", async () => {
    // given the row can only say "parked"; the failure that parked it is what the click is for
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: () => Promise.resolve(parked),
      loadSettings: () => settings({ enabled: true, clickable: true }),
    })
    const foreign: string[] = []
    harness.tui.openUrl = (url) => foreign.push(url)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:memory/current")
    await Promise.resolve()
    await Promise.resolve()

    // then
    expect(foreign).toEqual([])
    const delivered = harness.notices.join("\n").replace(/\n/g, " ")
    expect(delivered).toContain(DETAIL)
    expect(delivered).toContain("notwork-09334074")
  })
})

describe("side panel session boundaries and section gates", () => {
  test("#given a child from the previous session #when the session switches #then the next session shows none of it", async () => {
    // given
    let records: PanelTaskRecord[] = [
        {
          task_id: "t1",
          status: "running",
          created_at: new Date(40_000).toISOString(),
          parent_session_id: "session-1",
          task_summary: "map the seams",
        },
    ]
    const harness = mounted({ readTaskRecords: () => records })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(true)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    records = []
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given the files section is off #when the panel mounts and refreshes #then git is never run", async () => {
    // given
    const calls: string[][] = []
    const sections = { ...OmoSidePanelSettingsSchema.parse({}).sections, files: false }
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections }),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      exec: async (command, args) => {
        calls.push([command, ...args])
        return { stdout: "", stderr: "", code: 0, killed: false }
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls).toEqual([])
  })

  test("#given the panel is off at load #when the component registers #then no diff command is offered", () => {
    // given / when
    const harness = mounted({ loadSettings: () => settings({ enabled: false }) })

    // then
    expect(harness.pi.commands.some((command) => command.name === SIDE_PANEL_DIFF_COMMAND)).toBe(false)
  })

  test("#given a mounted column #when the host rebuilds its renderer for a TUI mode switch #then the column is attached again", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).length).toBeGreaterThan(0)
    const anchorsBefore = harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length

    // when: the host clears the old root and mounts a fresh one, as switchTuiMode does
    harness.tui.setLayoutRoot({ render: () => ["transcript"], invalidate: () => {} })
    await harness.pi.dispatch("turn_end", {}, harness.host)
    harness.attach()

    // then: the host never calls a mounted factory again, so the panel must register a fresh anchor
    expect(harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length).toBe(anchorsBefore + 1)
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given a widget block because the renderer had no root yet #when a root appears #then the column replaces the block", async () => {
    // given: a fullscreen renderer that builds its root lazily, or the regular half of a mode switch
    const harness = mounted()
    harness.tui.setLayoutRoot(undefined)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(() => columnRows(harness.tui)).toThrow()
    const anchorsBefore = harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length

    // when
    harness.tui.setLayoutRoot({ render: () => ["transcript"], invalidate: () => {} })
    await harness.pi.dispatch("turn_end", {}, harness.host)
    harness.attach()

    // then: the host never calls a mounted factory again, so the panel must register a fresh anchor
    expect(harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length).toBe(anchorsBefore + 1)
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given the session ends before the deferred attach runs #when it finally runs #then nothing is installed", async () => {
    // given
    const queued: Array<() => void> = []
    const harness = mounted({ defer: (callback) => queued.push(callback) })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    for (const callback of queued) callback()

    // then
    expect(() => columnRows(harness.tui)).toThrow()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("side panel regular-mode notice", () => {
  test("#given the panel is on and the renderer exposes no layout seam #when the anchor attaches #then the notice shows once and the claim is install-wide", async () => {
    // given: regular TUI mode - the default tuiMode - hands the panel a renderer without the seam
    const stateDir = testTempDir("omo-10560-")
    const harness = mounted({ loadSettings: () => settings({ enabled: true }), regularNoticeStateDir: stateDir })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attachWith({ requestRender() {}, terminal: { columns: 200 } })

    // then
    expect(harness.notices).toHaveLength(1)
    expect(existsSync(join(stateDir, REGULAR_MODE_NOTICE_MARKER))).toBe(true)

    // when: the next session of the same install attaches the same regular renderer
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attachWith({ requestRender() {}, terminal: { columns: 200 } })

    // then: the claim is install-wide, so the notice never repeats
    expect(harness.notices).toHaveLength(1)
  })

  test("#given a fullscreen renderer with a layout root #when the anchor attaches #then no notice is shown and nothing is claimed", async () => {
    // given
    const stateDir = testTempDir("omo-10560-")
    const harness = mounted({ loadSettings: () => settings({ enabled: true }), regularNoticeStateDir: stateDir })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(harness.notices).toHaveLength(0)
    expect(existsSync(join(stateDir, REGULAR_MODE_NOTICE_MARKER))).toBe(false)
  })

  test("#given the panel is off #when a session starts #then no notice is shown", async () => {
    // given
    const stateDir = testTempDir("omo-10560-")
    const harness = mounted({ loadSettings: () => settings({ enabled: false }), regularNoticeStateDir: stateDir })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)

    // then
    expect(harness.notices).toHaveLength(0)
    expect(existsSync(join(stateDir, REGULAR_MODE_NOTICE_MARKER))).toBe(false)
  })

  test("#given the notice was already claimed for the install #when a regular session attaches #then the notice stays silent", async () => {
    // given
    const stateDir = testTempDir("omo-10560-")
    claimRegularModeNotice(stateDir)
    const harness = mounted({ loadSettings: () => settings({ enabled: true }), regularNoticeStateDir: stateDir })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attachWith({ requestRender() {}, terminal: { columns: 200 } })

    // then
    expect(harness.notices).toHaveLength(0)
  })
})

describe("side panel lifecycle and guards", () => {
  test("#given a mounted column #when a switch is only announced #then the column stays", async () => {
    // given: the host can still cancel a switch after session_before_switch
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_before_switch", {}, harness.host)

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given reads that never answer #when tool, message and turn events fire #then their handlers return at once", async () => {
    // given: every tool call queues behind these handlers in the host
    let hang = false
    const never = new Promise<never>(() => {})
    const harness = mounted({
      exec: async () => (hang ? await never : { stdout: "", code: 0 }),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      readTaskRecords: () => (hang ? never : []),
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    hang = true

    // when: each dispatch races the next turn of the event loop, which runs only once microtasks drain
    const settled: boolean[] = []
    const events = [["tool_execution_start", { toolName: "read" }], ["tool_execution_end", {}], ["message_end", {}], ["turn_end", {}]] as const
    for (const [event, payload] of events) {
      harness.advance(GIT_REFRESH_FLOOR_MS + 1)
      const idle = new Promise<boolean>((resolve) => setImmediate(() => resolve(false)))
      settled.push(await Promise.race([harness.rawDispatch(event, payload, harness.host).then(() => true), idle]))
    }

    // then
    expect(settled).toEqual([true, true, true, true])
  })

  test("#given the goal section is off #when mounted and refreshed #then the goal store is never read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, goal: false } }),
      readGoal: () => {
        reads += 1
        return undefined
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(0)
  })

  test("#given the agents and session sections are off #when mounted and refreshed #then task records are never read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, agents: false, session: false } }),
      readTaskRecords: () => {
        reads += 1
        return []
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(0)
  })

  test("#given a git read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      exec: async (_command, args) => {
        if (phase === 2) return { stdout: "", code: 128 }
        called.resolve()
        await gate.promise
        return { stdout: args[0] === "status" ? " M stale.ts\0" : "", code: 0 }
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("stale.ts"))).toBe(false)
  })

  test("#given a memory read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const identity: PanelMemoryIdentity = {
      id: "late-memory",
      reflectionDir: "/mem/reflection",
      recallDir: "/mem/recall",
      factsQueueDir: "/mem/facts-queue",
      recallLedgerDir: "/mem/recall/ledger",
      recallPendingDir: "/mem/recall/pending",
    }
    const stale: PanelMemory = {
      identity: identity.id,
      reflection: { streak: 3, parkedAt: "2026-09-21T09:00:00.000Z", nextProbeAt: "2026-09-21T15:00:00.000Z", reason: "stale park", detail: "stale" },
      factsQueued: 7,
      recallSurfaced: 0,
      recallPending: 0,
    }
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: async (): Promise<PanelMemory | undefined> => {
        if (phase === 2) return undefined
        called.resolve()
        await gate.promise
        return stale
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("7 queued"))).toBe(false)
  })

  test("#given a task-record read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      readTaskRecords: async (): Promise<PanelTaskRecord[]> => {
        if (phase === 2) return []
        called.resolve()
        await gate.promise
        return [
          { task_id: "t1", status: "running", created_at: new Date(40_000).toISOString(), parent_session_id: "session-1", task_summary: "late child" },
        ]
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given the implementation is still loading when the session ends #when it loads #then nothing is mounted", async () => {
    // given
    const gate = deferred<void>()
    const harness = mounted({
      loadRuntime: async () => {
        await gate.promise
        const runtime = await import("./runtime")
        return runtime.createSidePanelController
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    gate.resolve()
    await first

    // then
    expect(harness.widgets.some((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined)).toBe(false)
  })

  test("#given an ended session #when a tool finishes before the next one starts #then git is not run", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => "main" })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    calls.length = 0
    harness.advance(GIT_REFRESH_FLOOR_MS + 1)

    // when
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls).toEqual([])
  })

  test("#given files the last session showed #when the next session cannot read git #then they are gone", async () => {
    // given
    let failing = false
    const { exec: working } = gitExec()
    const harness = mounted({
      exec: async (command, args) => (failing ? { stdout: "", code: 128 } : await working(command, args)),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // when
    failing = true
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("tracked.txt"))).toBe(false)
  })

  test("#given the branch the last session showed #when the next session has files off #then the branch is gone", async () => {
    // given
    let filesOn = true
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, files: filesOn } }),
      exec: gitExec().exec,
      findGitRoot: () => "/repo",
      readGitBranch: () => "feat-x",
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // when
    filesOn = false
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("feat-x"))).toBe(false)
  })

  test("#given a file row clicked after the file left the list #when the notice is shown #then it carries no terminal controls", async () => {
    // given
    const { exec } = gitExec()
    const harness = mounted({
      exec,
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      loadSettings: () => settings({ enabled: true, clickable: true }),
    })
    harness.tui.openUrl = () => undefined
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:file/" + encodeURIComponent("gone\x1b]8;;x\x07.txt"))

    // then
    const notice = harness.notices.join("\n")
    expect(notice).not.toContain("\x1b")
    expect(notice).not.toContain("\x07")
    expect(notice).toContain("gone]8;;x.txt is no longer listed")
  })

  test("#given a default config #when the column is laid out #then it shows on a wide terminal and steps aside on a narrow one", async () => {
    // given
    const harness = mounted({ loadSettings: () => ({ ...OmoSidePanelSettingsSchema.parse({}), enabled: true }) })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const accessor = (harness.tui.layoutRoot as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
    if (typeof accessor !== "function") throw new Error("root is not a layout node")
    const node = accessor() as {
      type: string
      gap: number
      align: string
      entries: ReadonlyArray<{
        basis?: number | "auto"
        grow?: number
        shrink?: number
        minSize?: number
        visible?: (viewport: { width: number; height: number }) => boolean
        component: unknown
      }>
    }
    const panel = node.entries[1]
    const container = harness.tui.layoutRoot as { children: readonly unknown[] }

    // then: a quarter-ish column beside the transcript, and the classic layout on a small screen
    expect(node.type).toBe("hstack")
    expect(node.gap).toBe(0)
    expect(node.align).toBe("stretch")
    expect(node.entries).toHaveLength(2)
    // The transcript stays first with room to shrink, the panel never grows: the host scroll is untouched.
    expect(container.children[0]).toBe(node.entries[0]?.component)
    expect(node.entries[0]?.minSize).toBe(60)
    expect(node.entries[0]?.grow).toBe(1)
    expect(panel?.grow).toBe(0)
    expect(panel?.shrink).toBe(0)
    expect(panel?.visible?.({ width: 200, height: 50 })).toBe(true)
    expect(panel?.visible?.({ width: 100, height: 50 })).toBe(false)
    expect(panel?.basis ?? 0).toBeGreaterThanOrEqual(32)
    expect(panel?.basis ?? 0).toBeLessThan(100)
  })

  test("#given an installed column #when painted raw #then the divider frames the content", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const raw = rawColumnRows(harness.tui)

    // then: the fullscreen column carries its left rule, the content helper owns the stripped facts
    expect(raw.length).toBeGreaterThan(0)
    expect(raw.every((line) => line.startsWith("│") || line === "")).toBe(true)
    expect(raw.some((line) => line.startsWith("│ SESSION"))).toBe(true)
  })
})

describe("side panel Changes expansion", () => {
  const manyStatus = (total: number): string => Array.from({ length: total }, (_, index) => ` M file-${index}.ts\0`).join("")
  const manyNumstat = (total: number): string => Array.from({ length: total }, (_, index) => `2\t1\tfile-${index}.ts\0`).join("")

  function changesHarness(total: number, clickable = true) {
    const exec = async (_command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => {
      if (args[0] === "status") return { stdout: manyStatus(total), stderr: "", code: 0 }
      return { stdout: manyNumstat(total), stderr: "", code: 0 }
    }
    const harness = mounted(
      {
        exec,
        findGitRoot: () => "/repo",
        readGitBranch: () => "main",
        loadSettings: () => settings({ enabled: true, clickable }),
      },
      {},
      "/repo",
    )
    // The panel only claims the url hook when the host exposes one: hand it a callback to wrap.
    harness.tui.openUrl = () => undefined
    return harness
  }

  test("#given more files than the preview #when the column renders #then a Show more counter is shown", async () => {
    // given
    const harness = changesHarness(10)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const rows = columnRows(harness.tui)

    // then: the compact preview counts the exact remainder and keeps the other sections
    expect(rows).toContain("FILES  10 changed")
    expect(rows.join("\n")).toContain("+2 more")
    expect(rows.some((row) => row.includes("Show more") && row.includes("+2 more"))).toBe(true)
    expect(rows.some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given Show more activated #when the column renders #then Changes takes the column with a Show less head", async () => {
    // given
    const harness = changesHarness(10)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:files-more/current")
    await Promise.resolve()
    await Promise.resolve()
    const rows = columnRows(harness.tui)

    // then
    expect(rows[0]).toBe("FILES  10 changed")
    expect(rows[1]?.includes("Show less")).toBe(true)
    expect(rows.filter((row) => row.includes("file-")).length).toBe(10)
    expect(rows.some((row) => row.startsWith("SESSION"))).toBe(false)
  })

  test("#given expanded Changes #when Show less is activated #then the sections return", async () => {
    // given
    const harness = changesHarness(10)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    harness.tui.openUrl?.("omo-panel:files-more/current")
    await Promise.resolve()
    await Promise.resolve()

    // when
    harness.tui.openUrl?.("omo-panel:files-less/current")
    await Promise.resolve()
    await Promise.resolve()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("SESSION"))).toBe(true)
    expect(rows.some((row) => row.includes("Show more"))).toBe(true)
    expect(rows.some((row) => row.includes("Show less"))).toBe(false)
  })

  test("#given expanded Changes #when the session ends #then the next session starts collapsed", async () => {
    // given
    const harness = changesHarness(10)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    harness.tui.openUrl?.("omo-panel:files-more/current")
    await Promise.resolve()
    await Promise.resolve()
    expect(columnRows(harness.tui)[1]?.includes("Show less")).toBe(true)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("SESSION"))).toBe(true)
    expect(rows.some((row) => row.includes("Show more"))).toBe(true)
  })

  test("#given clicks off #when Show more arrives #then the column stays compact", async () => {
    // given: without clicks there is no Show less control to return from
    const harness = changesHarness(10, false)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:files-more/current")
    await Promise.resolve()
    await Promise.resolve()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("SESSION"))).toBe(true)
    expect(rows.some((row) => row.includes("Show less"))).toBe(false)
  })

  test("#given a widget fallback #when many files change #then the block stays compact with a muted remainder", async () => {
    // given: the regular-mode block has no Show less control
    const harness = changesHarness(10)
    harness.tui.setLayoutRoot(undefined)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const body = widgetBody(harness)

    // then
    expect(body.some((row) => row.includes("FILES"))).toBe(true)
    expect(body.some((row) => row.includes("+2 more"))).toBe(true)
    expect(body.some((row) => row.includes("Show less"))).toBe(false)
  })

  test("#given a refused file list #when the column renders #then the warning shows and never reads as clean", async () => {
    // given: the bounded reader kept nothing and does not know the total
    const harness = mounted({
      exec: async () => ({ stdout: "", stderr: "", code: 0, tooLarge: true }),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("FILES"))).toBe(true)
    expect(rows.some((row) => row.includes("Changes too large"))).toBe(true)
    expect(rows.some((row) => row.includes("0 changed"))).toBe(false)
  })
})

// --- DAG graph wiring --------------------------------------------------------------

/** The widget block the panel falls back to when the renderer has no layout seam. */
function widgetBody(harness: ReturnType<typeof mounted>, width = 52): string[] {
  const call = [...harness.widgets].reverse().find((candidate) => candidate.key === SIDE_PANEL_WIDGET_KEY)
  if (typeof call?.content !== "function") throw new Error("no widget block")
  const component = (call.content as () => PanelComponent)()
  return component.render(width)
}

function dagPanelRun(overrides: Parameters<typeof dagRun>[0] = {}) {
  return dagRun({
    runId: "run-panel",
    name: "panel run",
    nodes: [
      dagNode({ id: "node-panel", label: "Panel node", state: "running", startedAt: "2026-11-08T00:00:00.000Z" }),
    ],
    ...overrides,
  })
}

/**
 * The panel's DAG state lives in a process-wide registry keyed by session id, so each case mounts
 * its own session: a leftover claim from a failed case must not reach the next one.
 */
function dagHarness(
  name: string,
  overrides: Partial<Parameters<typeof createSidePanelComponent>[0]> = {},
  uiExtras: Record<string, unknown> = {},
) {
  const sessionId = `session-dag-panel-${name}`
  const harness = mounted(overrides, {
    sessionManager: {
      getSessionId: () => sessionId,
      getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
    },
  }, "/repo", uiExtras)
  return { harness, sessionId }
}

describe("side panel DAG wiring", () => {
  test("#given a column mounted before its session feed exists #when the feed publishes and then reports activity #then the column repaints once per burst with the live graph", async () => {
    // given: session_start runs before the task engine claims the feed, as it does in a real start
    const { harness, sessionId } = dagHarness("publish")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.includes("panel run"))).toBe(false)
    let activity = "reading spec.md"
    const claimed = claimDagPanelFeed(sessionId, {}, {
      runs: () => [dagPanelRun()],
      activity: (_runId, nodeId) => (nodeId === "node-panel" ? activity : undefined),
    })
    const rendersBefore = harness.tui.renders

    // when - a burst of feed changes coalesces into one repaint
    claimed.notify()
    claimed.notify()
    expect(harness.timers.pending()).toBe(1)
    harness.timers.fire()

    // then
    expect(harness.tui.renders).toBe(rendersBefore + 1)
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.includes("panel run"))).toBe(true)
    expect(rows.some((row) => row.includes("Panel node"))).toBe(true)
    expect(rows.some((row) => row.includes("reading spec.md"))).toBe(true)

    // when - the node moves on under an open column
    activity = "compiling pkg/a"
    claimed.notify()
    harness.timers.fire()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("compiling pkg/a"))).toBe(true)

    claimed.dispose()
  })

  test("#given feeds for two sessions #when the other session publishes #then the mounted column keeps its own session's graph", async () => {
    // given
    const { harness, sessionId } = dagHarness("two-sessions")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const settled = (name: string) => dagPanelRun({ name, status: "completed", nodes: [dagNode({ id: "node-panel", label: "Panel node", state: "completed" })] })
    const own = claimDagPanelFeed(sessionId, {}, { runs: () => [settled("own run")], activity: () => undefined })
    harness.timers.fire()
    const other = claimDagPanelFeed(`${sessionId}-other`, {}, { runs: () => [settled("other run")], activity: () => undefined })

    // when
    const before = harness.timers.pending()
    other.notify()

    // then
    expect(before).toBe(0)
    expect(harness.timers.pending()).toBe(0)
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.includes("own run"))).toBe(true)
    expect(rows.some((row) => row.includes("other run"))).toBe(false)

    own.dispose()
    other.dispose()
  })

  test("#given a mounted column with a repaint pending #when the session shuts down #then the repaint is cancelled and the feed can no longer paint it", async () => {
    // given
    const { harness, sessionId } = dagHarness("teardown")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const claimed = claimDagPanelFeed(sessionId, {}, {
      runs: () => [dagPanelRun({ status: "completed", nodes: [dagNode({ id: "node-panel", state: "completed" })] })],
      activity: () => undefined,
    })
    expect(harness.timers.pending()).toBe(1)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    const renders = harness.tui.renders
    claimed.notify()

    // then
    expect(harness.timers.pending()).toBe(0)
    expect(harness.tui.renders).toBe(renders)

    claimed.dispose()
  })

  test("#given sections.dag is off #when the session feed publishes #then the column neither repaints nor draws a graph", async () => {
    // given
    const base = settings({ enabled: true })
    const { harness, sessionId } = dagHarness("dag-off", { loadSettings: () => ({ ...base, sections: { ...base.sections, dag: false } }) })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const claimed = claimDagPanelFeed(sessionId, {}, { runs: () => [dagPanelRun()], activity: () => undefined })

    // when
    claimed.notify()

    // then
    expect(harness.timers.pending()).toBe(0)
    expect(columnRows(harness.tui).some((row) => row.includes("panel run"))).toBe(false)

    claimed.dispose()
  })

  test("#given a regular-mode renderer without the layout seam #when the session feed publishes #then the widget block carries no graph", async () => {
    // given: the default TUI mode falls back to a block above the editor
    const { harness, sessionId } = dagHarness("regular")
    harness.tui.setLayoutRoot(undefined)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const claimed = claimDagPanelFeed(sessionId, {}, {
      runs: () => [dagPanelRun({ status: "completed", nodes: [dagNode({ id: "node-panel", state: "completed" })] })],
      activity: () => undefined,
    })

    // when
    claimed.notify()
    harness.timers.fire()

    // then
    const body = widgetBody(harness)
    expect(body.length).toBeGreaterThan(0)
    expect(body.some((row) => row.includes("panel run"))).toBe(false)

    claimed.dispose()
  })

  test("#given a short terminal and a tall one #when the same run is drawn #then the graph shrinks to its floor instead of taking the column", async () => {
    // given: twelve independent nodes, drawn in a column of either height
    const nodes = Array.from({ length: 12 }, (_unused, index) => dagNode({ id: `node-${index}`, label: `Step ${index}`, state: "completed" }))
    const run = dagRun({ runId: "run-height", name: "height run", status: "completed", nodes })
    const graphRows = async (terminalRows: number): Promise<string[]> => {
      const { harness, sessionId } = dagHarness(`height-${terminalRows}`, { terminalRows: () => terminalRows })
      await harness.pi.dispatch("session_start", {}, harness.host)
      harness.attach()
      const claimed = claimDagPanelFeed(sessionId, {}, { runs: () => [run], activity: () => undefined })
      harness.timers.fire()
      const rows = columnRows(harness.tui)
      claimed.dispose()
      return rows
    }

    // when
    const short = await graphRows(20)
    const tall = await graphRows(100)

    // then - the graph is the column's first block, and the short terminal caps it
    const shortBlock = short.findIndex((row) => row === "")
    const tallSession = tall.findIndex((row) => row.startsWith("SESSION"))
    const shortSession = short.findIndex((row) => row.startsWith("SESSION"))
    expect(shortBlock).toBeGreaterThan(0)
    expect(shortSession).toBeGreaterThan(0)
    expect(tallSession).toBeGreaterThan(shortSession)
    expect(shortBlock).toBeLessThanOrEqual(DAG_SECTION_ROW_FLOOR)
  })

  test("#given the panel can be on #when the component registers #then the dag command is offered, and not when the panel is off", () => {
    // given / when
    const enabled = mounted()
    const disabled = mounted({ loadSettings: () => settings({ enabled: false }) })

    // then
    expect(enabled.pi.commands.some((command) => command.name === SIDE_PANEL_DAG_COMMAND)).toBe(true)
    expect(disabled.pi.commands.some((command) => command.name === SIDE_PANEL_DAG_COMMAND)).toBe(false)
  })

  test("#given no mounted panel #when the dag command runs #then it refuses without opening an overlay", async () => {
    // given
    const harness = mounted()
    const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_DAG_COMMAND)?.options.handler
    if (typeof handler !== "function") throw new Error("dag command handler missing")
    const notices: string[] = []
    let opened = 0
    const ui = {
      notify: (message: string) => {
        notices.push(message)
      },
      custom: async () => {
        opened += 1
        return undefined
      },
    }

    // when
    await (handler as (args: string, ctx: unknown) => Promise<void>)("", { ui })

    // then
    expect(notices).toHaveLength(1)
    expect(opened).toBe(0)
  })

  test("#given a mounted column with a live run #when the dag command runs #then it opens the graph overlay on that run", async () => {
    // given
    const { harness, sessionId } = dagHarness("command")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const claimed = claimDagPanelFeed(sessionId, {}, { runs: () => [dagPanelRun()], activity: () => undefined })
    const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_DAG_COMMAND)?.options.handler
    if (typeof handler !== "function") throw new Error("dag command handler missing")
    const opened: PopupComponent[] = []
    const ui = {
      notify: () => undefined,
      custom: async (factory: (tui: unknown, theme: unknown, bindings: unknown, done: () => void) => unknown) => {
        opened.push(factory({ terminal: { rows: 40 }, requestRender: () => undefined }, undefined, undefined, () => undefined) as PopupComponent)
        return undefined
      },
    }

    // when
    await (handler as (args: string, ctx: unknown) => Promise<void>)("", { ui })

    // then
    expect(opened).toHaveLength(1)
    const painted = opened[0]?.render(60).join("\n") ?? ""
    expect(painted).toContain("Panel node")
    expect(painted).toContain("node-panel")

    claimed.dispose()
  })

  test("#given a headless host with no command ui #when the dag command runs #then it opens nothing", async () => {
    // given
    const harness = mounted()
    const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_DAG_COMMAND)?.options.handler
    if (typeof handler !== "function") throw new Error("dag command handler missing")

    // when / then
    await expect((handler as (args: string, ctx: unknown) => Promise<void>)("", {})).resolves.toBeUndefined()
    expect(harness.notices).toEqual([])
  })

  test("#given a host that exposes no overlay seam #when the dag command runs #then the graph is delivered as a notification", async () => {
    // given
    const { harness, sessionId } = dagHarness("no-overlay")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const claimed = claimDagPanelFeed(sessionId, {}, {
      runs: () => [dagPanelRun({ status: "completed" })],
      activity: () => undefined,
    })
    const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_DAG_COMMAND)?.options.handler
    if (typeof handler !== "function") throw new Error("dag command handler missing")
    const notices: string[] = []
    const ui = { notify: (message: string) => { notices.push(message) } }

    // when
    await (handler as (args: string, ctx: unknown) => Promise<void>)("", { ui })

    // then
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("Panel node")
    expect(notices[0]).toContain("panel run")

    claimed.dispose()
  })

  test("#given a mounted column with no runs #when the dag command runs #then it reports that and opens nothing", async () => {
    // given
    const { harness } = dagHarness("no-runs")
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const handler = harness.pi.commands.find((command) => command.name === SIDE_PANEL_DAG_COMMAND)?.options.handler
    if (typeof handler !== "function") throw new Error("dag command handler missing")
    let opened = 0
    const notices: string[] = []
    const ui = {
      notify: (message: string) => { notices.push(message) },
      custom: async () => { opened += 1; return undefined },
    }

    // when
    await (handler as (args: string, ctx: unknown) => Promise<void>)("", { ui })

    // then
    expect(notices).toHaveLength(1)
    expect(notices[0]?.length).toBeGreaterThan(0)
    expect(opened).toBe(0)
  })

  test("#given a clickable column #when a node row is activated #then the overlay opens with that node selected, not the running one", async () => {
    // given the host hands the panel a URL callback and an overlay seam
    let resolvePopup: (component: PopupComponent) => void = () => undefined
    const popupReady = new Promise<PopupComponent>((resolve) => {
      resolvePopup = resolve
    })
    const { harness, sessionId } = dagHarness(
      "click",
      { loadSettings: () => settings({ enabled: true, clickable: true }) },
      {
        custom: async (factory: (tui: unknown, theme: unknown, bindings: unknown, done: () => void) => unknown) => {
          resolvePopup(factory({ terminal: { rows: 40 }, requestRender: () => undefined }, undefined, undefined, () => undefined) as PopupComponent)
          return undefined
        },
      },
    )
    harness.tui.openUrl = () => undefined
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const run = dagPanelRun({
      nodes: [
        dagNode({ id: "node-idle", label: "Idle node", state: "completed" }),
        dagNode({ id: "node-panel", label: "Panel node", state: "running", dependsOn: ["node-idle"] }),
      ],
    })
    const claimed = claimDagPanelFeed(sessionId, {}, { runs: () => [run], activity: () => undefined })
    harness.timers.fire()

    // when - the host resolves a click on the idle node's row
    harness.tui.openUrl?.(panelActionUrl({ kind: "dag-node", runId: run.runId, nodeId: "node-idle" }))
    const painted = (await popupReady).render(60).join("\n")

    // then
    expect(painted).toContain("Idle node")
    expect(painted).toContain("node-idle")
    expect(painted).not.toContain("node-panel")

    claimed.dispose()
  })
})
