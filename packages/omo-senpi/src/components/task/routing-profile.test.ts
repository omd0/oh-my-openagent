import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { EMPTY_SKILL_INVOCATIONS, type ManagedChildHandle, type ManagedRunner, type ManagedStartSpec, type RunnerOutcome } from "@oh-my-opencode/senpi-task"
import { loadOmoConfig, OmoConfigSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"
import {
  listTaskRoutingProfiles,
  projectTaskRoutingConfig,
  readTaskRoutingProfileOverride,
  TASK_ROUTING_PROFILE_ENTRY,
} from "./routing-profile"
import { installJobWidgetAuthor } from "./job-widget-author"
import type { JobWidgetAuthorResolver } from "./job-widget-host"
import { createSkillInvocationTracker } from "./skill-invocation-tracker"
import { createTeamService } from "./team-service"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"
import { registerWorkpoolTool } from "./workpool-tool"
import type { SenpiOmoConfigResult } from "../config-resolution"

const tempRoots: string[] = []
const engines: TaskEngine[] = []

afterEach(() => {
  for (const engine of engines.splice(0).reverse()) {
    for (const entry of engine.manager.list({ scope: "all" })) {
      engine.manager.forget(entry.record.task_id, { path: "end", reason: "target_gone" })
    }
    engine.manager.workpools?.dispose()
  }
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// An isolated HOME + project pair so the loader never reads the developer's real ~/.omo:
// the user layer is the temp home's empty omo.json and the only project layer is the temp
// project's empty omo.json (the walk stops at the temp home boundary).
function isolatedProject(): { readonly cwd: string; readonly env: { readonly HOME: string } } {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-routing-profile-"))
  tempRoots.push(root)
  const home = join(root, "home")
  const cwd = join(home, "project")
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.json"), "{}\n")
  writeFileSync(join(cwd, ".omo", "omo.json"), "{}\n")
  return { cwd, env: { HOME: home } }
}

function composeIsolatedEngine(): { readonly engine: TaskEngine; readonly cwd: string } {
  const { cwd, env } = isolatedProject()
  const engine = composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig: loadOmoConfig({ cwd, env }).config,
    cwd,
    env,
    sharedParentTools: () => [],
  })
  engines.push(engine)
  return { engine, cwd }
}

function fakeHost() {
  let current: JobWidgetAuthorResolver | undefined
  const host = {
    installs: 0,
    current: () => current,
    setAuthorResolver: (resolver: JobWidgetAuthorResolver | undefined) => {
      host.installs += 1
      current = resolver
      return () => {
        if (current === resolver) current = undefined
      }
    },
  }
  return host
}

function registry(models: readonly { provider: string; id: string }[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) => models.find((model) => model.provider === provider && model.id === modelId),
  }
}

function fakeManagedHandle(spec: ManagedStartSpec): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    pid: undefined,
    sessionId: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise<RunnerOutcome>(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
}

function routingFixture(): SenpiOmoConfigResult {
  return {
    config: OmoConfigSchema.parse({}),
    diagnostics: [],
    layers: [
      {
        config: { profiles: { zebra: {}, alpha: {} } },
        source: { exists: true, loaded: true, path: "/home/.omo/omo.json", scope: "user" },
      },
      {
        config: { profiles: { alpha: {}, mango: {} } },
        source: { exists: true, loaded: true, path: "/home/project/.omo/omo.json", scope: "project" },
      },
      {
        config: { profiles: ["not-an-object"] },
        source: { exists: true, loaded: true, path: "/home/other/.omo/omo.json", scope: "project" },
      },
      {
        config: {},
        source: { exists: false, loaded: false, path: "/home/empty/.omo/omo.json", scope: "project" },
      },
    ],
    sources: [],
  }
}

describe("task routing profiles", () => {
  test("#given layers with overlapping profile names #when listing #then names dedupe and sort, ignoring non-object profiles", () => {
    // when
    const names = listTaskRoutingProfiles(routingFixture())

    // then
    expect(names).toEqual(["alpha", "mango", "zebra"])
  })

  test("#given a base config and a routed profile #when projecting #then only categories and agents overlay, task settings stay on the base", () => {
    // given
    const base = { task: { default_concurrency: 3 }, categories: { quick: { model: "base/quick" } } } as unknown as OmoConfig
    const routed = {
      task: { default_concurrency: 9 },
      categories: { quick: { model: "routed/quick" } },
      agents: { scout: { description: "Scout", prompt: "Scout it." } },
    } as unknown as OmoConfig

    // when
    const projected = projectTaskRoutingConfig(base, routed)

    // then
    expect(projected.categories).toEqual(routed.categories)
    expect(projected.agents).toEqual(routed.agents)
    expect(projected.task).toEqual(base.task)
  })

  test("#given branch entries with string, null and malformed profiles #when reading the override #then the last well-formed entry wins", () => {
    // given
    const branch = [
      { customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: "first" } },
      { customType: "other-entry", data: { profile: "ignored" } },
      { customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: 42 } },
      { customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: null } },
      { customType: TASK_ROUTING_PROFILE_ENTRY, data: { profile: "second" } },
    ]
    const context = { sessionManager: { getBranch: () => branch } }

    // when
    const override = readTaskRoutingProfileOverride(context)

    // then
    expect(override).toEqual({ found: true, profile: "second" })
  })

  test("#given contexts without a branch #when reading the override #then it reports not found", () => {
    // given / when / then
    expect(readTaskRoutingProfileOverride(undefined)).toEqual({ found: false })
    expect(readTaskRoutingProfileOverride({})).toEqual({ found: false })
    expect(readTaskRoutingProfileOverride({ sessionManager: {} })).toEqual({ found: false })
    expect(readTaskRoutingProfileOverride({ sessionManager: { getBranch: () => "not-an-array" } })).toEqual({ found: false })
  })

  test("#given a composed engine #when setRoutingConfig runs #then omoConfig, agents and taskToolDeps track the routed view", () => {
    // given an engine on the isolated empty config
    const { engine } = composeIsolatedEngine()
    expect(engine.agents["scout"]).toBeUndefined()

    // when
    const routed = {
      ...engine.omoConfig,
      categories: { ...(engine.omoConfig.categories ?? {}), quick: { model: "omo-mock/routed-quick" } },
      agents: { scout: { description: "Project scout", prompt: "Scout the repo." } },
    } as unknown as OmoConfig
    engine.setRoutingConfig(routed)

    // then the live routing view follows the swap
    expect(engine.omoConfig).toBe(routed)
    expect(engine.agents["scout"]?.prompt).toBe("Scout the repo.")
    expect(engine.taskToolDeps(() => EMPTY_SKILL_INVOCATIONS).omoConfig).toBe(routed)
    expect(engine.taskToolDeps(() => EMPTY_SKILL_INVOCATIONS).agents["scout"]?.prompt).toBe("Scout the repo.")
  })

  test("#given a composed engine #when setRoutingConfig swaps routing #then task settings stay fixed", () => {
    // given
    const { engine } = composeIsolatedEngine()
    const settingsBefore = engine.settings

    // when
    engine.setRoutingConfig({ ...engine.omoConfig, task: { default_concurrency: 7 } } as unknown as OmoConfig)

    // then
    expect(engine.settings).toBe(settingsBefore)
    expect(engine.settings.default_concurrency).not.toBe(7)
  })

  test("#given a team service on the base routing #when updateRouting adds a category #then the same inline spec stops failing validation", async () => {
    // given an isolated engine whose spawns land on a stub runner
    const { cwd, env } = isolatedProject()
    const started: ManagedStartSpec[] = []
    const runner: ManagedRunner = {
      start: (spec) => {
        started.push(spec)
        return Promise.resolve(fakeManagedHandle(spec))
      },
    }
    const engine = composeTaskEngine({
      pi: new FakeExtensionAPI(),
      omoConfig: loadOmoConfig({ cwd, env }).config,
      cwd,
      env,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engines.push(engine)
    engine.runtime.captureFrom({
      modelRegistry: createTeamServiceTestModelRegistry(),
      sessionManager: { getSessionId: () => "lead-session" },
    })
    const omoConfig = engine.omoConfig
    const service = createTeamService({
      manager: engine.manager,
      destruction: engine.lifecycle,
      runtime: engine.runtime,
      settings: engine.settings,
      omoConfig,
      cwd,
      agentNames: new Set(Object.keys(engine.agents)),
    })
    let teamRunId: string | undefined
    try {
      // when the category is unknown
      const before = await service.createTeam({
        inlineSpec: { members: [{ name: "worker", kind: "category", category: "routed-x", prompt: "work" }] },
      }).then(
        () => "resolved",
        (error: unknown) => String((error as Error).message),
      )

      // then it is refused before any spawn
      expect(before).toContain("references unknown category 'routed-x'")
      expect(started.length).toBe(0)

      // when routing adds the category through the same order index.ts uses
      const routed = {
        ...omoConfig,
        categories: { ...(omoConfig.categories ?? {}), "routed-x": { model: "omo-mock/mock-1" } },
      } as unknown as OmoConfig
      engine.setRoutingConfig(routed)
      service.updateRouting(routed, new Set(Object.keys(engine.agents)))
      const created = await service.createTeam({
        inlineSpec: { name: "routed-team", members: [{ name: "worker", kind: "category", category: "routed-x", prompt: "work" }] },
      })

      // then validation passes and the spawn reaches the stub runner
      teamRunId = created.runtimeState.teamRunId
      expect(teamRunId.length).toBeGreaterThan(0)
      expect(started.length).toBeGreaterThan(0)
    } finally {
      if (teamRunId !== undefined) await service.deleteTeam({ teamRunId })
    }
  })

  test("#given a registered workpool tool #when its refresh runs #then the workpool tool is registered again", () => {
    // given an isolated engine with the workpool tool registered once
    const { engine } = composeIsolatedEngine()
    const pi = new FakeExtensionAPI()
    const skills = createSkillInvocationTracker(pi)
    const refresh = registerWorkpoolTool(pi, engine, skills)
    const registeredBefore = pi.tools.length
    expect(registeredBefore).toBeGreaterThan(0)

    // when the refresh closure runs (index.ts calls it on every routing swap)
    refresh()

    // then the workpool registration is re-issued against the engine's live deps
    expect(pi.tools.length).toBe(registeredBefore + 1)
    expect(pi.tools[pi.tools.length - 1]).toMatchObject({ name: "workpool" })
  })

  test("#given two sessions sharing one host #when routing updates one session #then only that session's author model changes", () => {
    // given two sessions on one host with different quick models
    const host = fakeHost()
    const models = registry([
      { provider: "omo-mock", id: "quick-a" },
      { provider: "omo-mock", id: "quick-b" },
      { provider: "omo-mock", id: "quick-c" },
    ])
    const configA = { categories: { quick: { model: "omo-mock/quick-a" } } } as unknown as OmoConfig
    const configB = { categories: { quick: { model: "omo-mock/quick-b" } } } as unknown as OmoConfig
    const releaseA = installJobWidgetAuthor(host, "/same-project", configA, () => "session-a")
    const releaseB = installJobWidgetAuthor(host, "/same-project", configB, () => "session-b")
    try {
      // when session-a routes to a third model neither session used before
      releaseA.update({ categories: { quick: { model: "omo-mock/quick-c" } } } as unknown as OmoConfig)

      // then the actual host route answers each session with its own model
      const route = host.current()
      expect(route?.({ cwd: "/same-project", sessionManager: { getSessionId: () => "session-a" }, modelRegistry: models })).toBe(
        models.find?.("omo-mock", "quick-c"),
      )
      expect(route?.({ cwd: "/same-project", sessionManager: { getSessionId: () => "session-b" }, modelRegistry: models })).toBe(
        models.find?.("omo-mock", "quick-b"),
      )
    } finally {
      releaseA()
      releaseB()
    }

    // then the last release withdraws the host route
    expect(host.current()).toBeUndefined()
  })
})
