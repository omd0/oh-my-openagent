import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import {
  createDagWatchSource,
  describeDagSend,
  type DagWatchNode,
  type DagWatchPort,
  type DagWatchRun,
  type DagWatchSendResult,
} from "./dag-watch-source"

const RUN = "dag_run_a" as DagRunId
const PARENT = "session-a"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-dag-watch-source-"))
  tempRoots.push(dir)
  return dir
}

function node(overrides: Partial<DagWatchNode> & { id: string }): DagWatchNode {
  return {
    state: "running",
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    attempt: 1,
    ...overrides,
  }
}

function run(overrides: Partial<DagWatchRun> = {}): DagWatchRun {
  return { runId: RUN, name: "release audit", status: "running", nodes: [], ...overrides }
}

interface PortSpy {
  readonly port: DagWatchPort
  readonly snapshotCalls: Array<{ runId: DagRunId; parentSessionId: string }>
  readonly sends: Array<{ runId: DagRunId; nodeId: string; message: string }>
}

function spyPort(
  read: (runId: DagRunId, parentSessionId: string) => DagWatchRun,
  send: (runId: DagRunId, nodeId: string, message: string) => Promise<DagWatchSendResult> = async () => ({ delivery: "steer" }),
): PortSpy {
  const snapshotCalls: PortSpy["snapshotCalls"] = []
  const sends: PortSpy["sends"] = []
  return {
    snapshotCalls,
    sends,
    port: {
      list: () => [{ runId: RUN, name: "release audit", status: "running" }],
      snapshot: (runId, parentSessionId) => {
        snapshotCalls.push({ runId, parentSessionId })
        return read(runId, parentSessionId)
      },
      send: async (runId, nodeId, message) => {
        sends.push({ runId, nodeId, message })
        return send(runId, nodeId, message)
      },
    },
  }
}

describe("createDagWatchSource", () => {
  it("#given a run with dependencies #when the tree is built #then nodes are ordered by dependency depth and reads stay bound", () => {
    // given a seed feeding two arms that join
    const nodes = [
      node({ id: "join", dependsOn: ["left", "right"] }),
      node({ id: "right", dependsOn: ["seed"] }),
      node({ id: "seed" }),
      node({ id: "left", dependsOn: ["seed"] }),
    ]
    const spy = spyPort(() => run({ nodes }))
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when
    const rows = source.rows()

    // then the seed paints first and the join paints last, one level deeper per hop
    expect(rows?.map((row) => row.id)).toEqual(["seed", "right", "left", "join"])
    expect(rows?.map((row) => row.indent)).toEqual([0, 1, 1, 2])
    expect(rows?.find((row) => row.id === "left")?.summary).toBe("after seed")
    // and every runtime read went through the bound run and parent only
    expect(spy.snapshotCalls.length).toBeGreaterThan(0)
    for (const call of spy.snapshotCalls) expect(call).toEqual({ runId: RUN, parentSessionId: PARENT })
  })

  it("#given the runtime refuses the bound run #when the tree refreshes #then no rows are offered and nothing else is queried", () => {
    // given a run the runtime no longer serves to this session
    const spy = spyPort(() => {
      throw new Error("gone")
    })
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when
    const rows = source.rows()

    // then the viewer closes on undefined, and the only id ever asked for was the bound one
    expect(rows).toBeUndefined()
    expect(source.labels().title).toContain("unavailable")
    expect(source.live()).toBe(false)
    for (const call of spy.snapshotCalls) expect(call.runId).toBe(RUN)
  })

  it("#given a retry replaces the node's worker #when the node is read again #then the new output is shown without a cached task id", () => {
    // given a node whose retry replaced its child and its saved output
    let attempt = 0
    const spy = spyPort(() =>
      run({
        nodes: [
          node({ id: "left", state: "running", taskId: attempt === 0 ? "st_first" : "st_second", output: attempt === 0 ? "first attempt output" : "second attempt output" }),
        ],
      }),
    )
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when the node is read, retried, and read again
    const first = source.read("left")
    attempt = 1
    const second = source.read("left")

    // then each read followed the run's current task, never a cached one
    expect(first.kind).toBe("ok")
    expect(second.kind).toBe("ok")
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected readable transcripts")
    expect(first.lines.join("\n")).toContain("first attempt output")
    expect(second.lines.join("\n")).toContain("second attempt output")
  })

  it("#given a node with no child #when it is read #then an unrecorded result names why it has nothing to show", () => {
    // given a blocked node that never started and a paused one
    const spy = spyPort(() =>
      run({ nodes: [node({ id: "blocked", state: "blocked" }), node({ id: "held", state: "paused" })] }),
    )
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when
    const blocked = source.read("blocked")
    const held = source.read("held")
    const missing = source.read("ghost")

    // then nothing throws; each explains its own state and records nothing
    expect(blocked).toEqual({ kind: "ok", lines: [], truncated: false, recorded: false, note: "Not started yet. It starts once the nodes it waits on finish." })
    expect(held).toEqual({ kind: "ok", lines: [], truncated: false, recorded: false, note: "Paused with the run. Its child starts or resumes when the run continues." })
    expect(missing).toEqual({ kind: "ok", lines: [], truncated: false, recorded: false, note: "This node is no longer part of the run." })
  })

  it("#given a finished node whose transcript is gone #when its saved output is read #then the shown size is measured in UTF-8 bytes", () => {
    // given multi-byte output whose byte length exceeds its character count
    const text = "héllo\nwörld"
    const shownBytes = new TextEncoder().encode(text).byteLength
    expect(shownBytes).toBeGreaterThan(text.length)
    const spy = spyPort(() =>
      run({ nodes: [node({ id: "done", state: "completed", taskId: "st_gone", output: text, outputBytes: shownBytes + 40 })] }),
    )
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when
    const result = source.read("done")

    // then the truncation note counts bytes, and lines keep their breaks
    expect(result).toEqual({
      kind: "ok",
      lines: ["héllo", "wörld"],
      truncated: true,
      recorded: true,
      note: `Saved output of the finished node, ${shownBytes} of ${shownBytes + 40} bytes shown.`,
    })
  })

  it("#given each runtime delivery #when a message is steered #then only accepted deliveries count and routing stays bound", async () => {
    // given every delivery kind the runtime reports
    const deliveries: DagWatchSendResult[] = [
      { delivery: "steer" },
      { delivery: "revive" },
      { delivery: "queued", queuePosition: 3 },
      { delivery: "held" },
      { delivery: "guidance", guidanceId: "g-1" },
      { delivery: "uncertain", effectId: "e-9" },
      { delivery: "bogus" },
    ]
    for (const result of deliveries) {
      const spy = spyPort(() => run({ nodes: [node({ id: "left", taskId: "st_left" })] }), async () => result)
      const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

      // when
      const report = await source.send("left", "keep going")

      // then routing used the bound run and node only, and acceptance follows the delivery
      expect(spy.sends).toEqual([{ runId: RUN, nodeId: "left", message: "keep going" }])
      expect(report).toEqual(describeDagSend(result, "left"))
    }
    expect(describeDagSend({ delivery: "steer" }, "left").accepted).toBe(true)
    expect(describeDagSend({ delivery: "steer" }, "left").text).toBe("Steered left. Its child takes the message on the next step.")
    expect(describeDagSend({ delivery: "uncertain" }, "left").accepted).toBe(false)
    expect(describeDagSend({ delivery: "bogus" }, "left").accepted).toBe(false)
  })

  it("#given the runtime refuses the steer #when a message is steered #then the failure is reported as not delivered", async () => {
    // given a runtime that throws on send
    const spy = spyPort(() => run({ nodes: [node({ id: "left", taskId: "st_left" })] }), async () => {
      throw new Error("run is locked")
    })
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when
    const report = await source.send("left", "keep going")

    // then the watch shows the failure instead of throwing into the input
    expect(report).toEqual({ accepted: false, text: "Not sent to left: run is locked" })
  })

  it("#given node states #when targets are read #then only finished nodes are terminal", () => {
    // given
    const spy = spyPort(() =>
      run({
        nodes: [
          node({ id: "done", state: "completed" }),
          node({ id: "failed", state: "failed" }),
          node({ id: "live", state: "running" }),
          node({ id: "retry", state: "running", attempt: 2 }),
        ],
      }),
    )
    const source = createDagWatchSource({ port: spy.port, runId: RUN, parentSessionId: PARENT, stateDir: stateDir() })

    // when / then
    expect(source.target("done")?.terminal).toBe(true)
    expect(source.target("failed")?.terminal).toBe(true)
    expect(source.target("live")?.terminal).toBe(false)
    expect(source.target("retry")?.state).toBe("running attempt 2")
    expect(source.target("ghost")).toBeUndefined()
    expect(source.live()).toBe(true)
  })
})
