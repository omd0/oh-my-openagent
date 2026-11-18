import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

const bundledSnapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "test", sourceUrl: "test", models: {} })

describe("GPT-6.2 request compatibility", () => {
  test.each(["gpt-6.2-astra", "gpt-6.2-sol"])(
    "%s clamps rejected reasoning and sampling settings before a request",
    (modelID) => {
      expect(
        resolveCompatibleModelSettings({
          providerID: "openai",
          modelID,
          capabilities: getModelCapabilities({ providerID: "openai", modelID, bundledSnapshot }),
          desired: { reasoningEffort: "none", temperature: 0.5, maxTokens: 200000 },
        }),
      ).toMatchObject({ reasoningEffort: "low", temperature: undefined, maxTokens: 128000 })
    },
  )

  test("GPT-6.1 Terra keeps its supported non-reasoning mode and output ceiling", () => {
    expect(
      resolveCompatibleModelSettings({
        providerID: "openai",
        modelID: "gpt-6.1-terra",
        capabilities: getModelCapabilities({ providerID: "openai", modelID: "gpt-6.1-terra", bundledSnapshot }),
        desired: { reasoningEffort: "none", maxTokens: 200000 },
      }),
    ).toMatchObject({ reasoningEffort: "none", maxTokens: 128000 })
  })
})
