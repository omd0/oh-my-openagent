import { describe, expect, it } from "bun:test"

import type { SendInput, SendOutcome, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"
import type { DagNodeId, DagRunId } from "@oh-my-opencode/senpi-task/dag"

import type { DagWatchPort, DagWatchRun } from "./dag-subagent-service"
import { createTaskSubagentWatch, type TaskSubagentManager } from "./task-subagent-service"

const PARENT = "session-a"
const RUN = "dag_r" as DagRunId

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: PARENT,
    root_session_id: PARENT,
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:01.000Z",
    notification: { run_epoch: 7, notified_epoch: -1 },
    notify_on_terminal: false,
    ...overrides,
  }
}

interface ServiceSetup {
  readonly watch: ReturnType<typeof createTaskSubagentWatch>
  readonly sent: SendInput[]
  readonly dagSends: Array<{ runId: DagRunId; nodeId: string; message: string }>
  readonly listCalls: unknown[]
  setBound(next: boolean): void
  setOutcome(next: SendOutcome): void
  setRecords(next: readonly TaskRecord[]): void
  setDagRun(next: DagWatchRun | undefined): void
}

function serviceSetup(initial: readonly TaskRecord[]): ServiceSetup {
  const sent: ServiceSetup["sent"] = []
  const dagSends: Array<{ runId: DagRunId; nodeId: string; message: string }> = []
  const listCalls: unknown[] = []
  const state = {
    bound: true,
    outcome: { kind: "steered" } as SendOutcome,
    records: initial,
    dagRun: {
      runId: RUN,
      name: "release audit",
      status: "running",
      nodes: [{ id: "n1", label: "first", state: "running", route: { kind: "category", category: "quick" }, dependsOn: [], attempt: 1, taskId: "st_dag", createdAt: "2026-08-14T00:00:00.000Z" }],
    } as DagWatchRun | undefined,
  }
  const manager: TaskSubagentManager = {
    list: (scope) => {
      listCalls.push(scope)
      return state.records.map((entry) => ({ record: entry }))
    },
    sendToTask: (input) => {
      sent.push(input)
      return Promise.resolve(state.outcome)
    },
  }
  const dag: DagWatchPort = {
    list: () => (state.dagRun === undefined ? [] : [{ runId: RUN, name: "release audit", status: "running" }]),
    snapshot: (runId, parentSessionId) => {
      if (state.dagRun === undefined || runId !== RUN || parentSessionId !== PARENT) throw new Error("unknown run")
      return state.dagRun
    },
    send: (runId, nodeId, message) => {
      dagSends.push({ runId, nodeId, message })
      return Promise.resolve({ delivery: "steer" })
    },
    taskRecord: () => undefined,
  }
  const watch = createTaskSubagentWatch({
    manager,
    dag,
    parentSessionId: PARENT,
    stillBound: () => state.bound,
    stateDir: "test-state",
  })
  return {
    watch,
    sent,
    dagSends,
    listCalls,
    setBound: (next) => {
      state.bound = next
    },
    setOutcome: (next) => {
      state.outcome = next
    },
    setRecords: (next) => {
      state.records = next
    },
    setDagRun: (next) => {
      state.dagRun = next
    },
  }
}

describe("createTaskSubagentWatch", () => {
  it("#given tasks across sessions and owners #when the tree lists #then only this session's direct and owned children show", () => {
    // given a direct child, an owned child, a sibling, and a root-descendant from another parent
    const setup = serviceSetup([
      record({ task_id: "st_a", status: "running" }),
      record({ task_id: "st_dag", status: "running", owner: { kind: "dag", runId: RUN, nodeId: "n1" as DagNodeId, fingerprint: "f" } }),
      record({ task_id: "st_sib", status: "running", parent_session_id: "session-b", root_session_id: "session-b" }),
      record({ task_id: "st_root", status: "running", parent_session_id: "session-b", root_session_id: PARENT }),
    ])

    // when
    const paths = setup.watch.service.list().map((view) => view.path)

    // then only the direct child and the owned child (whose run is known) show
    expect(paths).toEqual(["/root/st_a", "/root/st_dag"])
  })

  it("#given an owned child whose run is gone #when the tree lists #then it is excluded", () => {
    // given the DAG run this session knew is no longer listed
    const setup = serviceSetup([
      record({ task_id: "st_dag", status: "running", owner: { kind: "dag", runId: RUN, nodeId: "n1" as DagNodeId, fingerprint: "f" } }),
    ])
    setup.setDagRun(undefined)

    // when
    const views = setup.watch.service.list()

    // then the orphaned row never paints
    expect(views).toHaveLength(0)
  })

  it("#given an unbound watch #when the tree lists #then the manager is never read", () => {
    // given a watch whose session changed
    const setup = serviceSetup([record({ task_id: "st_a", status: "running" })])
    setup.setBound(false)

    // when
    const views = setup.watch.service.list()

    // then nothing of the old session is read
    expect(views).toHaveLength(0)
    expect(setup.listCalls).toHaveLength(0)
  })

  it("#given an ordinary child #when steering #then the manager send carries the session, epoch and steer mode", async () => {
    // given
    const setup = serviceSetup([record({ task_id: "st_a", status: "running" })])

    // when
    const view = await setup.watch.service.steer("/root/st_a", "keep going")

    // then the runtime's own send is the only writer: no session write, epoch-checked
    expect(setup.sent).toEqual([
      { idOrName: "st_a", message: "keep going", deliverAs: "steer", callerSessionId: PARENT, expectedRunEpoch: 7 },
    ])
    expect(setup.dagSends).toHaveLength(0)
    expect(view.path).toBe("/root/st_a")
  })

  it("#given rejected outcomes #when steering #then the send is reported, never silently dropped", async () => {
    // given
    const setup = serviceSetup([record({ task_id: "st_a", status: "running" })])

    // when a transport failure lands
    setup.setOutcome({ kind: "failed", reason: "transport lost" } as SendOutcome)
    await expect(setup.watch.service.steer("/root/st_a", "keep going")).rejects.toThrow("Message not sent: transport lost")

    // when delivery is unconfirmed
    setup.setOutcome({ kind: "uncertain", reason: "unknown" } as SendOutcome)
    await expect(setup.watch.service.steer("/root/st_a", "keep going")).rejects.toThrow("Delivery is unconfirmed")

    // when the task went stale
    setup.setOutcome({ kind: "stale", reason: "epoch moved" } as SendOutcome)
    await expect(setup.watch.service.steer("/root/st_a", "keep going")).rejects.toThrow("Message not sent: epoch moved")
  })

  it("#given a DAG-owned child #when steering #then the runtime send takes the bound run and node, never the manager", async () => {
    // given
    const setup = serviceSetup([
      record({ task_id: "st_dag", status: "running", owner: { kind: "dag", runId: RUN, nodeId: "n1" as DagNodeId, fingerprint: "f" } }),
    ])

    // when
    const view = await setup.watch.service.steer("/root/st_dag", "take the next step")

    // then routing used the bound run and node only
    expect(setup.dagSends).toEqual([{ runId: RUN, nodeId: "n1", message: "take the next step" }])
    expect(setup.sent).toHaveLength(0)
    expect(view.path).toBe("/root/st_dag")
  })

  it("#given bad steer input #when steering #then nothing is sent", async () => {
    // given
    const setup = serviceSetup([record({ task_id: "st_a", status: "running" })])

    // when the message is blank, the path is foreign, or the task is gone
    await expect(setup.watch.service.steer("/root/st_a", "   ")).rejects.toThrow("Nothing to send.")
    await expect(setup.watch.service.steer("/other/st_a", "keep going")).rejects.toThrow("This item is not part of the task watch.")
    setup.setRecords([])
    await expect(setup.watch.service.steer("/root/st_a", "keep going")).rejects.toThrow("This task is no longer part of this session.")

    // then the runtime was never touched
    expect(setup.sent).toHaveLength(0)
    expect(setup.dagSends).toHaveLength(0)
  })

  it("#given an unbound watch #when steering #then the message never leaves the old session", async () => {
    // given
    const setup = serviceSetup([record({ task_id: "st_a", status: "running" })])
    setup.setBound(false)

    // when
    await expect(setup.watch.service.steer("/root/st_a", "keep going")).rejects.toThrow("This session changed, so nothing was sent.")

    // then
    expect(setup.sent).toHaveLength(0)
  })

  it("#given a task id with separators and spaces #when steering #then the path round-trips to the same task", async () => {
    // given a task id that is not path-safe on its own
    const setup = serviceSetup([record({ task_id: "a/b c", status: "running" })])
    const path = setup.watch.pathFor("a/b c")
    expect(path).toBe(`/root/${encodeURIComponent("a/b c")}`)

    // when steering through that path
    await setup.watch.service.steer(path, "keep going")

    // then the same task id reached the runtime send
    expect(setup.sent).toEqual([
      { idOrName: "a/b c", message: "keep going", deliverAs: "steer", callerSessionId: PARENT, expectedRunEpoch: 7 },
    ])
  })
})
