import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { installLocalLauncher, localLauncherPath, uninstallLocalLauncher } from "./local-launcher"

const roots: string[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omo-local-pi-"))
  roots.push(home)
  return home
}

const BASE = { pluginPath: "/repo/packages/omo-senpi/plugin", senpiCliPath: "/repo/senpi/dist/cli.js", version: "9.9.9" }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("local launcher pi alias", () => {
  describe("#given an empty user bin directory", () => {
    test("#when the installed pi launcher runs #then it forwards argv and the canonical agent dir to the engine", () => {
      // given
      const home = makeHome()
      const capture = join(home, "capture.json")
      const stubCli = join(home, "stub-cli.mjs")
      const stubPlugin = join(home, "plugin")
      mkdirSync(stubPlugin, { recursive: true })
      writeFileSync(
        stubCli,
        `import { writeFileSync } from "node:fs"\nwriteFileSync(process.env.OMO_STUB_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), agentDir: process.env.OMO_CODING_AGENT_DIR, omoBin: process.env.OMO_BIN }))\n`,
      )

      // when
      const path = installLocalLauncher({
        pluginPath: stubPlugin,
        senpiCliPath: stubCli,
        version: "9.9.9",
        homeDir: home,
        platform: "linux",
      })
      const piPath = join(home, ".local", "bin", "pi")
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, OMO_STUB_CAPTURE: capture }
      delete env.OMO_CODING_AGENT_DIR
      delete env.SENPI_CODING_AGENT_DIR
      delete env.PI_CODING_AGENT_DIR
      const result = spawnSync(process.execPath, [piPath, "hello-pi"], { encoding: "utf8", env })

      // then
      expect(path).toBe(localLauncherPath(home))
      expect(result.status).toBe(0)
      const seen = JSON.parse(readFileSync(capture, "utf8"))
      expect(seen.agentDir).toBe(join(home, ".omo", "agent"))
      expect(seen.omoBin).toBe(piPath)
      expect(seen.argv.slice(0, 2)).toEqual(["--extension", stubPlugin])
      expect(seen.argv.at(-1)).toBe("hello-pi")
    })
  })

  describe("#given a foreign file at the pi alias path", () => {
    test("#when installed #then omo installs while the foreign pi file survives", () => {
      // given
      const home = makeHome()
      const piPath = join(home, ".local", "bin", "pi")
      mkdirSync(dirname(piPath), { recursive: true })
      writeFileSync(piPath, "#!/bin/sh\necho mine\n")

      // when
      const path = installLocalLauncher({ ...BASE, homeDir: home, platform: "linux" })

      // then
      expect(path).toBe(localLauncherPath(home))
      expect(readFileSync(piPath, "utf8")).toContain("echo mine")
      expect(existsSync(join(home, ".local", "bin", "omo"))).toBe(true)
    })
  })
})

describe("local launcher pi uninstall", () => {
  describe("#given both owned launchers installed", () => {
    test("#when uninstalled #then both paths are removed together", () => {
      // given
      const home = makeHome()
      installLocalLauncher({ ...BASE, homeDir: home, platform: "linux" })

      // when
      const removed = uninstallLocalLauncher(home)

      // then
      expect(removed).toBe(true)
      expect(existsSync(join(home, ".local", "bin", "omo"))).toBe(false)
      expect(existsSync(join(home, ".local", "bin", "pi"))).toBe(false)
    })
  })

  describe("#given a symlink standing in for the pi alias", () => {
    test("#when installed and uninstalled #then the link still resolves its original target", () => {
      // given
      const home = makeHome()
      const piPath = join(home, ".local", "bin", "pi")
      const target = join(home, "pi-target")
      mkdirSync(dirname(piPath), { recursive: true })
      writeFileSync(target, "target\n")
      symlinkSync(target, piPath)

      // when
      const installed = installLocalLauncher({ ...BASE, homeDir: home, platform: "linux" })
      const linkAfterInstall = readlinkSync(piPath)
      const removed = uninstallLocalLauncher(home)

      // then
      expect(installed).toBe(localLauncherPath(home))
      expect(lstatSync(piPath).isSymbolicLink()).toBe(true)
      expect(linkAfterInstall).toBe(target)
      expect(readlinkSync(piPath)).toBe(target)
      expect(readFileSync(target, "utf8")).toBe("target\n")
      expect(readFileSync(piPath, "utf8")).toBe("target\n")
      expect(removed).toBe(true)
    })
  })
})
