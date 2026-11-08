import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { prepareTrustDirectory, writeTrustGeneration } from "../../../../omo-native/trust-generation"
import { readUsernsView, USERNS_ROOTS_ENV } from "../../../../omo-native/trust-userns"
import { buildSandboxTransform } from "./sandbox"
import { probeBwrapUsability } from "./sandbox-bwrap-probe"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import type { ReflectionSpawnArgs } from "./worker/spawn"

const bwrap = process.platform === "linux" ? Bun.which("bwrap") : null
const bwrapUsable = bwrap !== null && (await probeBwrapUsability(bwrap)).usable
const trustGeneration = join(import.meta.dir, "..", "..", "..", "..", "omo-native", "trust-generation.ts")
const probeSource = `import { prepareTrustDirectory, trustDirectory, TrustStorageError, verifyTrustGeneration } from ${JSON.stringify(trustGeneration)}
try {
  if (process.argv[2] === "unattested") delete process.env.${USERNS_ROOTS_ENV}
  const result = process.argv[2] === "adopt"
    ? { verified: (await verifyTrustGeneration(JSON.parse(process.env.SENPI_ENGINE_TRUST ?? "null"))).malformed === false }
    : await prepareTrustDirectory(trustDirectory(process.env, "linux"), "linux")
  process.stdout.write(JSON.stringify({ ok: true, ...result }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error instanceof TrustStorageError ? error.code : null, message: String(error) }))
}
`

type Outcome = { ok: boolean; directory?: string; codes?: { code: string }[]; verified?: boolean; code?: string | null; message?: string }

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-sandbox-trust-")))
  roots.push(root)
  const worktree = join(root, "parent", "runtime", "worktree")
  const gitCommonDir = join(root, "parent", ".git")
  const payload = join(root, "payload", "transcript.json")
  // A host TMPDIR outside every writable bind is read-only inside the sandbox (EROFS), and one under /tmp is hidden by its tmpfs.
  const hostTmp = join(root, "host-tmp")
  // The fixture's own directories must look like a real private runtime root (0700). With the process
  // umask's group bit left on, prepareTrustDirectory refuses them as unsafe ancestors and silently
  // falls back to a temporary trust directory under the host OS temp dir - which the sandbox's private
  // tmpfs correctly hides, so a marker meant to live inside the declared worktree ends up out of it.
  for (const dir of [worktree, gitCommonDir, join(root, "payload"), hostTmp]) mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(payload, "payload")
  return { root, worktree, gitCommonDir, payload, hostTmp }
}

function spawnArgs(setup: ReturnType<typeof fixture>, env: NodeJS.ProcessEnv, args: string[]): ReflectionSpawnArgs {
  return {
    attempt: 1,
    hardDeadlineAt: Date.now() + 30_000,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    command: process.execPath,
    args,
    cwd: setup.worktree,
    env,
    detached: true,
    paths: {
      sessionDir: dirname(setup.worktree),
      worktree: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      transcript: setup.payload,
      persona: join(dirname(setup.worktree), "persona.md"),
      prompt: join(dirname(setup.worktree), "prompt.md"),
    },
  }
}

async function runInSandbox(mode: "prepare" | "adopt" | "unattested", options: {
  readonly extraEnv?: (worktree: string) => Promise<Record<string, string>>
  readonly home?: string
  readonly extraMounts?: (root: string) => string[]
} = {}) {
  const setup = fixture()
  const probe = join(setup.worktree, "engine-trust-probe.ts")
  writeFileSync(probe, probeSource)
  const env = {
    PATH: process.env.PATH, HOME: options.home ?? process.env.HOME, TMPDIR: setup.hostTmp,
    ...await (options.extraEnv ?? (async () => ({})))(setup.worktree),
  }
  const transform = buildSandboxTransform({
    policy: "required",
    worktreeDir: setup.worktree,
    gitCommonDir: setup.gitCommonDir,
    payloadPaths: [setup.payload],
    command: process.execPath,
    env,
    platform: "linux",
  })
  const sandboxed = await transform(spawnArgs(setup, env, [probe, mode]))
  const separator = sandboxed.args.indexOf("--")
  const args = [...sandboxed.args.slice(0, separator), ...(options.extraMounts?.(setup.root) ?? []), ...sandboxed.args.slice(separator)]
  const child = Bun.spawn([sandboxed.command, ...args], {
    cwd: setup.worktree, env: sandboxed.env, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stderr, outcome: JSON.parse(stdout) as Outcome }
}

test.skipIf(!bwrapUsable)("#given the real Linux reflection sandbox #when the child prepares its engine trust directory #then it gets a private directory instead of an unsafe-ancestor crash", async () => {
  // given / when
  const home = process.env.HOME ?? "/"
  const { code, stderr, outcome } = await runInSandbox("prepare")

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: true })
  // A HOME under /tmp lives on the sandbox's own writable tmpfs, so its trust directory is used as is;
  // any other HOME is read-only inside the sandbox and falls back to mkdtemp under /tmp.
  if (home.startsWith("/tmp/")) expect(outcome).toMatchObject({ directory: join(home, ".omo", "engine-trust"), codes: [] })
  else expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
}, 60_000)

test.skipIf(!bwrapUsable)("#given a parent trust generation outside the child's trust directory #when the sandboxed child adopts it #then the inherited marker's ancestors are attested and the generation verifies", async () => {
  // given
  const marker = async (worktree: string) => {
    const requested = join(worktree, "parent-trust")
    const { directory, codes } = await prepareTrustDirectory(requested, "linux")
    roots.push(directory)
    // The scenario is a marker INSIDE the child's declared worktree grant. A silent fallback to the
    // host temp dir would move it outside every grant and make the assertion below untestable, so pin
    // the success here instead of discovering the fallback as an ENOENT from the child.
    expect({ directory, codes }).toEqual({ directory: requested, codes: [] })
    const generation = await writeTrustGeneration(directory, [], [], [])
    return { SENPI_ENGINE_TRUST: JSON.stringify({ file: generation.file, sha256: generation.sha256, user: generation.user }) }
  }

  // when
  const { code, stderr, outcome } = await runInSandbox("adopt", { extraEnv: marker })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toEqual({ ok: true, verified: true })
}, 60_000)

test.skipIf(!bwrapUsable)("#given a user namespace without the launcher's attestation #when the child prepares its trust directory #then it gets the named unattested refusal, not a crash", async () => {
  // given / when
  const { code, stderr, outcome } = await runInSandbox("unattested")

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: false, code: "trust-userns-unattested" })
}, 60_000)

test.skipIf(!bwrapUsable)("#given a user namespace whose overflow uid cannot be read #when the child prepares its trust directory #then it gets the named unattested refusal, not a crash", async () => {
  // given / when
  const { code, stderr, outcome } = await runInSandbox("prepare", {
    extraMounts: () => ["--ro-bind", "/dev/null", "/proc/sys/kernel/overflowuid"],
  })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: false, code: "trust-userns-unattested" })
}, 60_000)

test.skipIf(!bwrapUsable)("#given an existing private trust directory on a read-only mount #when the sandboxed child prepares it #then it falls back to a private temp directory with trust-dir-readonly", async () => {
  // given
  const readOnlyHome = (root: string) => {
    const home = join(root, "ro-home")
    mkdirSync(join(home, ".omo", "engine-trust"), { recursive: true })
    for (const dir of [home, join(home, ".omo"), join(home, ".omo", "engine-trust")]) chmodSync(dir, 0o700)
    return ["--ro-bind", home, "/tmp/ro-home"]
  }

  // when
  const { code, stderr, outcome } = await runInSandbox("prepare", { home: "/tmp/ro-home", extraMounts: readOnlyHome })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome.ok).toBe(true)
  expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
  expect(outcome.codes).toEqual([{ code: "trust-dir-readonly" }])
}, 60_000)

test("#given a stale inherited attestation #when the Linux transform wraps the child #then TMPDIR is the sandbox tmpfs and the attestation is the launcher's own", async () => {
  // given
  const setup = fixture()
  const env = { PATH: process.env.PATH, HOME: setup.root, [USERNS_ROOTS_ENV]: "stale" }
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: setup.worktree, gitCommonDir: setup.gitCommonDir, payloadPaths: [setup.payload],
    command: "/bin/sh", env, platform: "linux", which: () => "/usr/bin/bwrap", probe: () => ({ usable: true }),
  })

  // when
  const result = await transform({ ...spawnArgs(setup, env, ["-c", "exit 0"]), command: "/bin/sh" })

  // then
  expect(result.env.TMPDIR).toBe("/tmp")
  const attested = result.env[USERNS_ROOTS_ENV]
  expect(attested).not.toBe("stale")
  // On an initial-namespace Linux host "/" is always attested (the launcher
  // walks to the root), so a transform that drops the variable must fail here
  // instead of passing through the undefined guard (#12120, #12119). Inside a
  // user namespace the launcher writes nothing and undefined stays acceptable.
  const paths = attested === undefined ? undefined : (JSON.parse(attested) as [string, string][]).map(([path]) => path)
  const inInitialNamespace = process.platform === "linux" && !readUsernsView(process.env).namespaced
  if (inInitialNamespace) {
    expect(paths).toContain("/")
  } else if (paths !== undefined) {
    expect(paths).toContain("/")
  }
})

test("#given the macOS sandbox #when it wraps the child #then it never writes the Linux attestation", async () => {
  // given
  const setup = fixture()
  const env = { PATH: process.env.PATH, HOME: setup.root, [USERNS_ROOTS_ENV]: "inherited" }
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: setup.worktree, gitCommonDir: setup.gitCommonDir, payloadPaths: [setup.payload],
    command: "/bin/sh", env, platform: "darwin", which: () => "/usr/bin/sandbox-exec",
  })

  // when
  const result = await transform({ ...spawnArgs(setup, env, ["-c", "exit 0"]), command: "/bin/sh" })

  // then
  expect(result.env[USERNS_ROOTS_ENV]).toBe("inherited")
})

// The bwrap wrapper rebinds "/" read-only and then mounts a private tmpfs over /tmp, so a reflection
// child whose executable lives under /tmp is invisible to execvp ("bwrap: execvp ...: No such file or
// directory") unless the wrapper mounts that exact executable file. These cases pin the repair at the
// real boundary and, just as importantly, pin what it must NOT widen: only the executable leaf may
// appear, never its sibling files or its directory, and never with write access.

/** Resolved lazily: this file is imported on every platform, but the real-bwrap cases only run on Linux. */
function localShellBinary(): string {
  return realpathSync("/bin/sh")
}

/**
 * Every case runs a test-owned copy of the local /bin/sh, never `process.execPath`. The sandbox
 * contract is that the executable the transform was asked to run is the one it makes visible, so a
 * build that mounts the parent runtime instead must fail these cases rather than pass by coincidence.
 */
function executableFixture() {
  const setup = fixture()
  const runtimeDir = join(setup.root, "runtime-bin")
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
  const executable = join(runtimeDir, "runtime-sh")
  copyFileSync(localShellBinary(), executable)
  chmodSync(executable, 0o755)
  const secret = join(runtimeDir, "sibling-secret.txt")
  writeFileSync(secret, "sibling-secret-token")
  return { ...setup, runtimeDir, executable, secret }
}

async function runExecutableInSandbox(setup: ReturnType<typeof executableFixture>, executable: string, script: string) {
  const env = { PATH: process.env.PATH, HOME: setup.root, TMPDIR: setup.hostTmp }
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: setup.worktree, gitCommonDir: setup.gitCommonDir, payloadPaths: [setup.payload],
    command: executable, env, platform: "linux",
  })
  const sandboxed = await transform({ ...spawnArgs(setup, env, ["-c", script]), command: executable })
  const child = Bun.spawn([sandboxed.command, ...sandboxed.args], {
    cwd: setup.worktree, env: sandboxed.env, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

describe("reflection sandbox executable visibility across the private tmpfs", () => {
  test.skipIf(!bwrapUsable)("#given the child executable lives under the sandbox's private tmpfs #when the child starts #then that exact executable file is mounted and runs", async () => {
    // given: the defect only exists for a child executable the private /tmp tmpfs hides
    const setup = executableFixture()
    expect(setup.executable.startsWith("/tmp/")).toBe(true)
    expect(setup.executable).not.toBe(process.execPath)

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, setup.executable, "printf 'runtime-ok'")

    // then
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "runtime-ok", stderr: "" })
  }, 60_000)

  test.skipIf(!bwrapUsable)("#given a secret beside the private-tmpfs executable #when the child looks for it #then only the executable leaf is visible and the sibling stays hidden", async () => {
    // given
    const setup = executableFixture()
    const script = `printf 'runtime-ok\\n'; if [ -e ${JSON.stringify(setup.secret)} ]; then printf 'secret-visible\\n'; else printf 'secret-hidden\\n'; fi`

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, setup.executable, script)

    // then: a directory grant (the tempting repair) would expose this sibling file to the child
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(stdout).toBe("runtime-ok\nsecret-hidden\n")
    // The secret exists where the child looked, so "hidden" is the private tmpfs, not a fixture miss.
    expect(readFileSync(setup.secret, "utf8")).toBe("sibling-secret-token")
  }, 60_000)

  test.skipIf(!bwrapUsable)("#given the private-tmpfs executable #when the child tries to change it #then the mount is read-only and the host file is unchanged", async () => {
    // given: chmod (not a write) is used because writing a running executable fails with ETXTBSY
    // regardless of the mount, which would pass for the wrong reason. chmod succeeds on a host file
    // and fails with EROFS only when the mount really is read-only.
    const setup = executableFixture()
    const before = readFileSync(setup.executable)
    const script = `printf 'runtime-ok\\n'; if chmod 0700 "$0" 2>/dev/null; then printf 'runtime-writable\\n'; else printf 'runtime-readonly\\n'; fi`

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, setup.executable, script)

    // then
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(stdout).toBe("runtime-ok\nruntime-readonly\n")
    expect(readFileSync(setup.executable).equals(before)).toBe(true)
    expect(statSync(setup.executable).mode & 0o777).toBe(0o755)
  }, 60_000)

  test.skipIf(!bwrapUsable)("#given the private-tmpfs executable and the declared worktree grant #when the child writes inside the worktree #then the write still succeeds", async () => {
    // given
    const setup = executableFixture()
    const target = join(setup.worktree, "child-write.txt")
    const script = `printf 'runtime-ok\\n'; printf 'granted' > ${JSON.stringify(target)} && printf 'wrote\\n'`

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, setup.executable, script)

    // then: the executable mount must not disturb the existing writable grants
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(stdout).toBe("runtime-ok\nwrote\n")
    expect(readFileSync(target, "utf8")).toBe("granted")
  }, 60_000)

  test.skipIf(!bwrapUsable)("#given a private-tmpfs command path that links to an executable outside the tmpfs #when the child starts #then the link path is mounted from the canonical target and runs", async () => {
    // given: the lexical path is hidden by the tmpfs while its real file is not
    const setup = executableFixture()
    const link = join(setup.runtimeDir, "runtime-link")
    const target = localShellBinary()
    symlinkSync(target, link)
    expect(link.startsWith("/tmp/")).toBe(true)
    expect(target.startsWith("/tmp/")).toBe(false)

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, link, "printf 'runtime-ok'")

    // then
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "runtime-ok", stderr: "" })
  }, 60_000)

  test.skipIf(!bwrapUsable)("#given a private-tmpfs command path that links to another file inside the tmpfs #when the child starts #then both the link and its target resolve and the sibling stays hidden", async () => {
    // given: lexical and canonical paths are both under the private tmpfs
    const setup = executableFixture()
    const link = join(setup.runtimeDir, "runtime-link")
    symlinkSync(setup.executable, link)
    const script = `printf 'runtime-ok\\n'; if [ -e ${JSON.stringify(setup.secret)} ]; then printf 'secret-visible\\n'; else printf 'secret-hidden\\n'; fi`

    // when
    const { code, stdout, stderr } = await runExecutableInSandbox(setup, link, script)

    // then
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(stdout).toBe("runtime-ok\nsecret-hidden\n")
  }, 60_000)
})
