import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { parseJsonc } from "../bin/lib/jsonc.js"
import { setupClaude } from "../bin/lib/setup-claude.js"

const roots: string[] = []

function makeAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-setup-claude-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  return agentDir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("setupClaude", () => {
  describe("#given an agent dir already carrying the enabled subscription route", () => {
    test("#when setup runs #then it leaves the file untouched without asking", async () => {
      // given
      const agentDir = makeAgentDir()
      const path = join(agentDir, "settings.json")
      const before = `{\n  "anthropicSubscriptionProvider": {\n    "enabled": true,\n    "tokenInjection": "ambient"\n  }\n}\n`
      writeFileSync(path, before)
      let confirmations = 0

      // when
      await setupClaude(agentDir, {
        dryRun: false,
        confirm: () => {
          confirmations += 1
          return Promise.resolve(true)
        },
      })

      // then
      expect(readFileSync(path, "utf8")).toBe(before)
      expect(confirmations).toBe(0)
    })
  })

  describe("#given an agent dir whose settings cannot be parsed", () => {
    test("#when setup runs #then it writes nothing and never asks", async () => {
      // given
      const agentDir = makeAgentDir()
      const path = join(agentDir, "settings.json")
      writeFileSync(path, "{ not json")
      mkdirSync(dirname(path), { recursive: true })
      let confirmations = 0

      // when
      await setupClaude(agentDir, {
        dryRun: false,
        confirm: () => {
          confirmations += 1
          return Promise.resolve(true)
        },
      })

      // then
      expect(readFileSync(path, "utf8")).toBe("{ not json")
      expect(confirmations).toBe(0)
    })
  })

  describe("#given a commented settings file missing the provider", () => {
    test("#when consent is given #then the provider is enabled and unrelated content survives", async () => {
      // given
      const agentDir = makeAgentDir()
      const path = join(agentDir, "settings.json")
      writeFileSync(path, `{\n  // the user's own note\n  "defaultModel": "keep-me"\n}\n`)

      // when
      await setupClaude(agentDir, {
        dryRun: false,
        confirm: () => Promise.resolve(true),
      })

      // then
      const next = readFileSync(path, "utf8")
      expect(next).toContain("// the user's own note")
      expect(parseJsonc(next)).toEqual({
        defaultModel: "keep-me",
        anthropicSubscriptionProvider: { enabled: true, tokenInjection: "ambient" },
      })
    })
  })
})
