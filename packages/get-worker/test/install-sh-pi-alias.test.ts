import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.sh"), "utf8")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function functionSource(name: string): string {
  const start = script.indexOf(`\n${name}() {`)
  const end = script.indexOf("\n}\n", start)
  if (start < 0 || end < 0) throw new Error(`install.sh has no ${name}()`)
  return script.slice(start + 1, end + 2)
}

function runBash(home: string, body: string): { status: number | null; stdout: string; stderr: string } {
  const program = [
    "set -euo pipefail",
    `HOME=${JSON.stringify(home)}`,
    'say() { printf "%s\\n" "$*" >&2; }',
    functionSource("sha256_of"),
    functionSource("receipt_owns_pi"),
    functionSource("install_pi_alias"),
    functionSource("write_receipt"),
    body,
  ].join("\n")
  return spawnSync("/bin/bash", ["-c", program], { encoding: "utf8" })
}

describe("install.sh pi alias ownership", () => {
  describe("#given a receipt recording the verified pi alias bytes", () => {
    test("#when the alias is reinstalled over the owned path #then it is replaced and the receipt keeps piPath", () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-install-pi-"))
      roots.push(root)
      const home = join(root, "home")
      const dir = join(home, ".local", "bin")

      // when
      const result = runBash(
        home,
        [
          `mkdir -p ${JSON.stringify(dir)} "$HOME/.omo"`,
          `printf 'launcher-bytes' > ${JSON.stringify(join(dir, "omo"))}`,
          `cp ${JSON.stringify(join(dir, "omo"))} ${JSON.stringify(join(dir, "pi"))}`,
          `write_receipt latest 9.9.9 omo-linux-x64 ${JSON.stringify(join(dir, "omo"))} "" ${JSON.stringify(join(dir, "pi"))}`,
          `install_pi_alias ${JSON.stringify(join(dir, "omo"))} ${JSON.stringify(join(dir, "pi"))} 0`,
          `test "$(cat ${JSON.stringify(join(dir, "pi"))})" = launcher-bytes`,
          `grep -q '"piPath"' "$HOME/.omo/install.json"`,
        ].join("\n"),
      )

      // then
      expect(result.status).toBe(0)
    })
  })

  describe("#given a foreign file occupying the pi alias path", () => {
    test("#when the alias install runs #then it refuses and leaves the file untouched", () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-install-pi-foreign-"))
      roots.push(root)
      const home = join(root, "home")
      const dir = join(home, ".local", "bin")

      // when
      const result = runBash(
        home,
        [
          `mkdir -p ${JSON.stringify(dir)}`,
          `printf 'launcher-bytes' > ${JSON.stringify(join(dir, "omo"))}`,
          `printf 'foreign-pi' > ${JSON.stringify(join(dir, "pi"))}`,
          `if install_pi_alias ${JSON.stringify(join(dir, "omo"))} ${JSON.stringify(join(dir, "pi"))} 0; then exit 3; fi`,
          `test "$(cat ${JSON.stringify(join(dir, "pi"))})" = foreign-pi`,
        ].join("\n"),
      )

      // then
      expect(result.status).toBe(0)
      expect(result.stderr).toContain("not a verified OmO alias")
    })
  })
})
