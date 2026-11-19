import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import manifest from "../package.json"

describe("nested LSP package builds", () => {
  test.each(["build:lsp-tools-mcp", "build:lsp-daemon"] as const)(
    "%s installs and builds locally when npm inherits global mode",
    (scriptName) => {
      // Given the real build command and an offline, dependency-free nested package.
      const root = mkdtempSync(join(tmpdir(), "omo-lsp-global-"))
      const packageName = scriptName.slice("build:".length)
      const packageDir = join(root, "packages", packageName)
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: packageName,
          version: "1.0.0",
          scripts: {
            build: `node -e "require('node:fs').writeFileSync('build-mode.txt', String(process.env.npm_config_global === 'true'))"`,
          },
        }),
      )
      writeFileSync(
        join(packageDir, "package-lock.json"),
        JSON.stringify({
          name: packageName,
          version: "1.0.0",
          lockfileVersion: 3,
          packages: { "": { name: packageName, version: "1.0.0" } },
        }),
      )

      try {
        // When invoked with the environment inherited from a global installation.
        const result = spawnSync(manifest.scripts[scriptName], {
          cwd: root,
          shell: true,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            npm_config_global: "true",
            npm_config_offline: "true",
            npm_config_audit: "false",
            npm_config_fund: "false",
          },
        })

        // Then npm ci succeeds and the build lifecycle also runs in local mode.
        expect(result.status, result.stderr).toBe(0)
        expect(readFileSync(join(packageDir, "build-mode.txt"), "utf8")).toBe("false")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
