import { describe, expect, test } from "bun:test"

import { boundedGitExec, GIT_EXEC_MAX_BUFFER_BYTES } from "./bounded-exec"

/**
 * The only production seam that really spawns git for the panel. Children are
 * `node -e` pipe writers, sleeps, and exit-code stubs: no repository is touched,
 * nothing is written anywhere, and every child is reaped by the exec itself.
 */
describe("boundedGitExec", () => {
  test("#given a child whose stdout exceeds the buffer #when run #then it is refused as tooLarge", async () => {
    // given
    const over = GIT_EXEC_MAX_BUFFER_BYTES * 2

    // when
    const result = await boundedGitExec(process.execPath, ["-e", `process.stdout.write("x".repeat(${over}))`], {})

    // then
    expect(result.tooLarge).toBe(true)
    expect(result.stdout).toBe("")
    expect(result.code).toBe(1)
  })

  test("#given a child that floods stderr only #when run #then both streams are bounded and no partial output leaks", async () => {
    // given: a small stdout line alongside a stderr flood past the buffer
    const over = GIT_EXEC_MAX_BUFFER_BYTES * 2

    // when
    const result = await boundedGitExec(
      process.execPath,
      ["-e", `process.stdout.write("ok"); process.stderr.write("e".repeat(${over}))`],
      {},
    )

    // then
    expect(result.tooLarge).toBe(true)
    expect(result.stdout).toBe("")
    expect(result.code).toBe(1)
  })

  test("#given a child that outlives its deadline #when run #then it is killed and reported as failed", async () => {
    // given
    const sleeping = `${process.execPath}`

    // when
    const result = await boundedGitExec(sleeping, ["-e", "setTimeout(() => {}, 15000)"], { timeout: 300 })

    // then
    expect(result.failed).toBe(true)
    expect(result.stdout).toBe("")
    expect(result.code).toBe(1)
  })

  test("#given exit 1 with output and exit 128 empty #when run #then codes pass through unnormalized", async () => {
    // given
    const noIndexLike = `${process.execPath}`
    const missingHead = `${process.execPath}`

    // when
    const [exit1, exit128] = await Promise.all([
      boundedGitExec(noIndexLike, ["-e", 'process.stdout.write("hello"); process.exit(1)'], {}),
      boundedGitExec(missingHead, ["-e", "process.exit(128)"], {}),
    ])

    // then
    expect(exit1).toEqual({ stdout: "hello", code: 1 })
    expect(exit128).toEqual({ stdout: "", code: 128 })
  })

  test("#given a command that cannot spawn #when run #then it is reported as failed, never as clean output", async () => {
    // given
    const missing = "omo-panel-no-such-command-xyz"

    // when
    const result = await boundedGitExec(missing, ["status"], {})

    // then
    expect(result.failed).toBe(true)
    expect(result.stdout).toBe("")
    expect(result.code).toBe(1)
  })
})
