import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import { baseInput, bunTreePackage, legacyShim, POSIX_HOME, recorder } from "./bun-bin-shim.test-support"

describe("Bun shim pi alias surface", () => {
  describe("#given legacy wrappers at both omo and pi bin paths", () => {
    test("#when preparation runs #then both are repaired while the report stays omo-only", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const omoBin = join(bunRootDir, "bin", "omo")
      const piBin = join(bunRootDir, "bin", "pi")
      const omoModulesBin = join(bunRootDir, "install", "global", "node_modules", ".bin", "omo")
      const piModulesBin = join(bunRootDir, "install", "global", "node_modules", ".bin", "pi")
      const fs = recorder({
        [omoBin]: legacyShim(scriptPath, bunPath),
        [piBin]: legacyShim(scriptPath, bunPath),
        [omoModulesBin]: legacyShim(scriptPath, bunPath),
        [piModulesBin]: legacyShim(scriptPath, bunPath),
      })

      // when
      const result = ensureBunBinShim({ ...options, ...fs })

      // then
      expect(result.action).toBe("repaired")
      expect(result.entries.map((entry) => entry.label)).toEqual(["bin", "node-modules-bin"])
      expect(fs.linked.map((link) => link.path).join("\n")).toContain(piBin)
      expect(fs.linked.map((link) => link.path).join("\n")).toContain(piModulesBin)
    })
  })

  describe("#given a foreign file at the pi bin path", () => {
    test("#when preparation runs #then the foreign pi file survives and omo still repairs", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const omoBin = join(bunRootDir, "bin", "omo")
      const piBin = join(bunRootDir, "bin", "pi")
      const foreign = "#!/bin/sh\nexec something-else\n"
      const fs = recorder({ [omoBin]: legacyShim(scriptPath, bunPath), [piBin]: foreign })

      // when
      const result = ensureBunBinShim({ ...options, ...fs })

      // then
      expect(result.action).toBe("repaired")
      expect(fs.readFile(piBin)).toBe(foreign)
      expect(result.entries.map((entry) => entry.label)).toEqual(["bin", "node-modules-bin"])
    })
  })
})
