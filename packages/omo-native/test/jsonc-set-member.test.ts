import { describe, expect, test } from "bun:test"

import { setJsoncMember } from "../bin/lib/jsonc-edit.js"
import { parseJsonc } from "../bin/lib/jsonc.js"

describe("setJsoncMember", () => {
  describe("#given a commented document holding a provider block", () => {
    test("#when an existing member is replaced #then comments survive and the value parses back", () => {
      // given
      const text = `{\n  // the user's own note\n  "anthropicSubscriptionProvider": { "enabled": false }\n}\n`

      // when
      const next = setJsoncMember(text, ["anthropicSubscriptionProvider"], "enabled", true)

      // then
      expect(next).toContain("// the user's own note")
      expect(parseJsonc(next)).toEqual({ anthropicSubscriptionProvider: { enabled: true } })
    })
  })

  describe("#given a document missing the whole provider path", () => {
    test("#when a nested member is set #then the path is created and the value parses back", () => {
      // given
      const text = `{\n  "$schema": "https://example.test/omo.schema.json"\n}\n`

      // when
      const next = setJsoncMember(text, ["anthropicSubscriptionProvider"], "tokenInjection", "ambient")

      // then
      expect(parseJsonc(next)).toEqual({
        $schema: "https://example.test/omo.schema.json",
        anthropicSubscriptionProvider: { tokenInjection: "ambient" },
      })
    })
  })
})
