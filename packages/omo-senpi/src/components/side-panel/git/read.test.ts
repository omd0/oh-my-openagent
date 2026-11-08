import { describe, expect, test } from "bun:test"

import { readGitStatus, type PanelExec, type PanelExecResult } from "./read"

const STATUS =
  " D gone.txt\u0000R  renamed-new.txt\u0000renamed.txt\u0000 M tracked.txt\u0000M  with space.txt\u0000?? brand-new.txt\u0000"
const UNSTAGED = "0\t1\tgone.txt\u00002\t1\ttracked.txt\u0000"
const STAGED = "0\t0\t\u0000renamed.txt\u0000renamed-new.txt\u00001\t0\twith space.txt\u0000"

interface Call {
  readonly args: string[]
  readonly cwd: string | undefined
  readonly timeout: number | undefined
}

function fakeExec(
  reply: (args: string[]) => PanelExecResult | Error,
  calls: Call[] = [],
): { exec: PanelExec; calls: Call[] } {
  const exec: PanelExec = async (_command, args, options) => {
    calls.push({ args, cwd: options?.cwd, timeout: options?.timeout })
    const result = reply(args)
    if (result instanceof Error) throw result
    return result
  }
  return { exec, calls }
}

const standardReply = (args: string[]) => {
  if (args[0] === "status") return { stdout: STATUS, code: 0 }
  if (args.includes("--cached")) return { stdout: STAGED, code: 0 }
  return { stdout: UNSTAGED, code: 0 }
}

describe("readGitStatus", () => {
  test("#given a working copy #when read #then states and line counts arrive merged", async () => {
    // given
    const { exec } = fakeExec(standardReply)

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.root).toBe("/repo")
    expect(status?.files.map((file) => [file.xy, file.path, file.added, file.removed])).toEqual([
      [" D", "gone.txt", 0, 1],
      ["R ", "renamed-new.txt", 0, 0],
      [" M", "tracked.txt", 2, 1],
      ["M ", "with space.txt", 1, 0],
      ["??", "brand-new.txt", undefined, undefined],
    ])
  })

  test("#given the reads #when issued #then each runs in the repository with a bounded timeout", async () => {
    // given
    const { exec, calls } = fakeExec(standardReply)

    // when
    await readGitStatus(exec, "/repo")

    // then
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.cwd === "/repo")).toBe(true)
    expect(calls.every((call) => typeof call.timeout === "number" && call.timeout > 0)).toBe(true)
  })

  test("#given status fails #when read #then the section gets nothing rather than a clean tree", async () => {
    // given
    const { exec } = fakeExec((args) => (args[0] === "status" ? { stdout: "", code: 128 } : { stdout: "", code: 0 }))

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status).toBeUndefined()
  })

  test("#given exec itself throws #when read #then the failure does not escape", async () => {
    // given
    const { exec } = fakeExec(() => new Error("spawn ENOENT"))

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status).toBeUndefined()
  })

  test("#given only the numstat reads fail #when read #then files still render without deltas", async () => {
    // given
    const { exec } = fakeExec((args) =>
      args[0] === "status" ? { stdout: STATUS, code: 0 } : new Error("interrupted"),
    )

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.files).toHaveLength(5)
    expect(status?.files[0]?.added).toBeUndefined()
  })
})

describe("readGitStatus bounds", () => {
  test("#given status output larger than the byte ceiling #when read #then it is refused as tooLarge without parsing", async () => {
    // given
    const oneEntry = " M a.txt\u0000"
    const overBytes = 1024 * 1024 + 64
    const repeats = Math.ceil(overBytes / Buffer.byteLength(oneEntry, "utf8"))
    const { exec } = fakeExec(() => ({ stdout: oneEntry.repeat(repeats), code: 0 }))

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.tooLarge).toBe(true)
    expect(status?.files).toEqual([])
  })

  test("#given more entries than the file cap #when read #then only the first 2000 are retained as tooLarge", async () => {
    // given
    const entries = Array.from({ length: 2005 }, (_, index) => ` M f${index}.txt\u0000`).join("")
    const { exec } = fakeExec((args) => (args[0] === "status" ? { stdout: entries, code: 0 } : { stdout: "", code: 0 }))

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.tooLarge).toBe(true)
    expect(status?.files).toHaveLength(2000)
    expect(status?.files[0]?.path).toBe("f0.txt")
    expect(status?.files[1999]?.path).toBe("f1999.txt")
  })

  test("#given a status read flagged tooLarge #when read #then the flag is honoured as tooLarge", async () => {
    // given: the bounded spawn cut the output, so the bytes on hand are untrustworthy
    const { exec } = fakeExec((args) =>
      args[0] === "status" ? { stdout: STATUS, code: 0, tooLarge: true } : { stdout: "", code: 0 },
    )

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.tooLarge).toBe(true)
    expect(status?.files).toEqual([])
  })

  test("#given a nonzero numstat read #when read #then the working copy is refused as tooLarge rather than clean", async () => {
    // given
    const { exec } = fakeExec((args) => {
      if (args[0] === "status") return { stdout: STATUS, code: 0 }
      if (args.includes("--cached")) return { stdout: STAGED, code: 0 }
      return { stdout: UNSTAGED, code: 1 }
    })

    // when
    const status = await readGitStatus(exec, "/repo")

    // then
    expect(status?.tooLarge).toBe(true)
    expect(status?.files).toEqual([])
  })
})
