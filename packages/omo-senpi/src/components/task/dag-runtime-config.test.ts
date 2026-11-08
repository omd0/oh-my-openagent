import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RunnerOutcome,
} from "@oh-my-opencode/senpi-task"
import * as dagEngine from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

const cleanupRoots: string[] = []
const engines: TaskEngine[] = []

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function within<T>(promise: Promise<T>, label: string, ms = 300): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

class ControlledRunner implements ManagedRunner {
  starts = 0
  readonly started = deferred<void>()
  readonly startReleased = deferred<void>()
  readonly outcome = deferred<RunnerOutcome>()

  async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.starts += 1
    this.started.resolve()
    await this.startReleased.promise
    return {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => this.outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
  }
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.lifecycle.dispose?.()
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("assembled DAG runtime configuration", () => {
  test("#given subscriber_ring is one #when the assembled runtime emits a burst #then the shipped RPC subscriber receives a durable overflow", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-ring-"))
    cleanupRoots.push(cwd)
    const overflowDelivered = deferred<Extract<dagEngine.DagRunEvent, { type: "dag.stream.overflow" }>>()
    const { createDagRuntime } = await import("./dag-runtime")
    const runner = new ControlledRunner()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: {
        emit: (name: string, data: unknown) => {
          const event = data as Partial<dagEngine.DagRunEvent>
          if (name === "omo.dag.event" && event.type === "dag.stream.overflow") {
            overflowDelivered.resolve(event as Extract<dagEngine.DagRunEvent, { type: "dag.stream.overflow" }>)
          }
        },
        handle: () => undefined,
      },
    })
    const baseConfig = loadOmoConfig({ cwd }).config
    const engine = composeTaskEngine({
      pi,
      omoConfig: {
        ...baseConfig,
        task: OmoTaskSettingsSchema.parse({ dag: { subscriber_ring: 1 } }),
      },
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engines.push(engine)
    const sessionId = "session-configured-ring"
    engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry(), sessionManager: { getSessionId: () => sessionId } })
    const runtime = createDagRuntime({
      pi,
      engine,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })
    await runtime.attach()

    // when
    const started = await runtime.manager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: {
        key: "configured-ring",
        name: "configured ring",
        nodes: [
          { id: "overflow-a", prompt: "overflow a", subagent_type: "explore", model: "omo-mock/mock-1" },
          { id: "overflow-b", prompt: "overflow b", subagent_type: "explore", model: "omo-mock/mock-1" },
        ],
      },
    })
    const completion = runtime.wait(started.snapshot.runId, sessionId)
    await within(runner.started.promise, "node start")
    // Both nodes become scheduled before admission awaits either controlled child. This creates a
    // test-owned journal burst, while the start gate keeps the scheduler at that boundary until
    // the shipped RPC subscriber has observed its durable overflow.
    const overflow = await within(overflowDelivered.promise, "configured subscriber overflow")
    runner.startReleased.resolve()
    runner.outcome.resolve({ status: "completed", finalResponse: "done" })
    await within(completion, "run completion")

    // then
    expect(overflow.droppedCount).toBeGreaterThan(0)
    expect(overflow.recoverAfterSeq).toBe(started.snapshot.lastSeq)
    expect(dagEngine.createDagFileStore({ project_dir: cwd }).readEvents(
      started.snapshot.runId,
      0,
      { limit: 100 },
    ).events).toContainEqual(overflow)
    runtime.dispose()
  })

  test("#given an agent the current routing does not know #when the engine routing learns it #then the earlier run failed without a child and the later run completes", async () => {
    // given
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-routing-live-"))
    cleanupRoots.push(cwd)
    const { createDagRuntime } = await import("./dag-runtime")
    const runner = new ControlledRunner()
    const pi = new FakeExtensionAPI()
    const baseConfig = loadOmoConfig({ cwd }).config
    const engine = composeTaskEngine({
      pi,
      omoConfig: baseConfig,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
    })
    engines.push(engine)
    const sessionId = "session-routing-live"
    engine.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry(), sessionManager: { getSessionId: () => sessionId } })
    const runtime = createDagRuntime({
      pi,
      engine,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })
    await runtime.attach()
    const definition = (key: string) => ({
      key,
      name: key,
      nodes: [{ id: "custom", prompt: "custom work", subagent_type: "custom-probe", model: "omo-mock/mock-1" }],
    })

    // when a node names an agent the routing has never seen, admission fails it
    // before any child starts rather than routing it to another family's model
    const unknown = await runtime.manager.start({ parentSessionId: sessionId, rootSessionId: sessionId, definition: definition("routing-unknown") })
    const failed = await within(runtime.wait(unknown.snapshot.runId, sessionId), "unknown run settles", 5_000)

    // then
    expect(failed.status).toBe("failed")
    const custom = failed.nodes.custom
    if (custom?.state !== "failed") throw new Error(`expected the unknown node to fail, received ${custom?.state ?? "missing"}`)
    expect(custom.error.message).toContain("custom-probe")
    expect(runner.starts).toBe(0)

    // when the engine routing learns the agent, the same node shape is admitted live
    engine.setRoutingConfig({
      ...baseConfig,
      agents: { ...(baseConfig.agents ?? {}), "custom-probe": { model: "omo-mock/mock-1" } },
    })
    const known = await runtime.manager.start({ parentSessionId: sessionId, rootSessionId: sessionId, definition: definition("routing-known") })
    const completion = runtime.wait(known.snapshot.runId, sessionId)
    await within(runner.started.promise, "known node start", 5_000)
    runner.startReleased.resolve()
    runner.outcome.resolve({ status: "completed", finalResponse: "done" })

    // then
    const result = await within(completion, "known run completion", 5_000)
    expect(result.status).toBe("completed")
    expect(result.nodes.custom).toEqual(expect.objectContaining({ state: "completed", output: "done" }))
    expect(runner.starts).toBe(1)
    runtime.dispose()
  })
})
