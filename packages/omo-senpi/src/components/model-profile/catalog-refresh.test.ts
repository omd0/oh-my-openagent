import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { StartupWork } from "../../extension/startup-deferral"
import { AuthStorage, ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import { createModelProfileComponent } from "./index"

describe("automatic model catalog discovery", () => {
  test("publishes a newly fetched model through the real registry after startup", async () => {
    const credentials = AuthStorage.inMemory({ openai: { type: "api_key", key: "catalog-test-key" } })
    let catalog: readonly unknown[] = []
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json(catalog, { headers: { "last-modified": "Thu, 01 Jan 2099 00:00:00 GMT" } }),
    })
    try {
      const runtime = await ModelRuntime.create({
        credentials,
        modelsPath: null,
        catalogBaseUrl: server.url.href,
      })
      const baseline = runtime.getModels("openai")[0]
      if (baseline === undefined) throw new Error("The pinned engine has no OpenAI baseline model")
      catalog = [{ ...baseline, id: "future-catalog-model", name: "New catalog model" }]
      const registry = new ModelRegistry(runtime, credentials)
      const pi = new FakeExtensionAPI()
      const work: StartupWork[] = []
      const ctx: ComponentContext = {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => undefined },
        deferStartupWork: (_label, task) => work.push(task),
      }
      createModelProfileComponent().register(pi, ctx)

      await pi.dispatch("session_start", { reason: "startup" }, { mode: "tui", modelRegistry: registry })
      expect(registry.find("openai", "future-catalog-model")).toBeUndefined()
      expect(work).toHaveLength(1)
      for (const task of work) await task()

      expect(registry.getAvailable()).toContainEqual(
        expect.objectContaining({ provider: "openai", id: "future-catalog-model" }),
      )
    } finally {
      await server.stop(true)
    }
  })

  test("never contacts providers in offline mode", async () => {
    const before = process.env.OMO_OFFLINE
    process.env.OMO_OFFLINE = "1"
    try {
      const pi = new FakeExtensionAPI()
      let requests = 0
      createModelProfileComponent().register(pi, {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => undefined },
        deferStartupWork: (_label, task) => {
          void task()
        },
      })

      await pi.dispatch("session_start", { reason: "startup" }, {
        mode: "tui",
        modelRegistry: {
          getAvailable: () => [{ provider: "openai" }],
          find: () => undefined,
          refresh: async () => {
            requests++
            return { aborted: false, errors: new Map() }
          },
        },
      })

      expect(requests).toBe(0)
    } finally {
      if (before === undefined) delete process.env.OMO_OFFLINE
      else process.env.OMO_OFFLINE = before
    }
  })
})
