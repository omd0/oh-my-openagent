import { describe, expect, test } from "bun:test"

import {
  DAG_COLUMN_RUN_LIMIT,
  DAG_SECTION_ROW_CAP,
  DAG_SECTION_ROW_FLOOR,
} from "../constants"
import { buildDagRows, dagRowCap, type DagColumnInput } from "./dag"
import { visibleWidth } from "../format/truncate"
import { dagNode, dagRun } from "../dag-panel.test-support"

function input(runs: DagColumnInput["runs"], overrides: Partial<DagColumnInput> = {}): DagColumnInput {
  return { runs, activity: () => undefined, now: 1_000_000, rowCap: DAG_SECTION_ROW_CAP, ...overrides }
}

function nodeActions(rows: ReturnType<typeof buildDagRows>): string[] {
  return rows.flatMap((row) => (row.action?.kind === "dag-node" ? [row.action.nodeId] : []))
}

describe("dagRowCap", () => {
  test("#given an unknown or unusable terminal height #when the cap is resolved #then the full section cap is used", () => {
    // when / then
    expect(dagRowCap(undefined)).toBe(DAG_SECTION_ROW_CAP)
    expect(dagRowCap(0)).toBe(DAG_SECTION_ROW_CAP)
    expect(dagRowCap(-1)).toBe(DAG_SECTION_ROW_CAP)
    expect(dagRowCap(Number.NaN)).toBe(DAG_SECTION_ROW_CAP)
  })

  test("#given a short terminal #when the cap is resolved #then the floor keeps the graph useful without taking the column", () => {
    // when / then
    expect(dagRowCap(10)).toBe(DAG_SECTION_ROW_FLOOR)
    expect(dagRowCap(DAG_SECTION_ROW_FLOOR)).toBe(DAG_SECTION_ROW_FLOOR)
  })

  test("#given a tall terminal #when the cap is resolved #then the section grows with height up to the hard cap", () => {
    // when
    const mid = dagRowCap(30)
    const tall = dagRowCap(400)

    // then
    expect(mid).toBeGreaterThan(DAG_SECTION_ROW_FLOOR)
    expect(mid).toBeLessThan(DAG_SECTION_ROW_CAP)
    expect(tall).toBe(DAG_SECTION_ROW_CAP)
  })
})

describe("buildDagRows", () => {
  const small = dagRun({
    runId: "run-small",
    name: "small",
    nodes: [dagNode({ id: "a" }), dagNode({ id: "b", dependsOn: ["a"] })],
  })
  const threeNodes = (index: number) =>
    dagRun({
      runId: `run-${index}`,
      name: `run ${index}`,
      nodes: [0, 1, 2].map((node) => dagNode({ id: `n${node}`, dependsOn: node === 0 ? [] : [`n${node - 1}`] })),
    })

  test("#given any row cap #when rows are built #then the graph never exceeds the budget, including zero and tiny caps", () => {
    // given: caps the column can actually pass, and caps no run shape fits inside
    const caps = [0, 1, 2, 3, 4, 5, 6, 8, 12, DAG_SECTION_ROW_CAP]
    const shapes = [
      [small],
      [threeNodes(0), threeNodes(1), threeNodes(2)],
      [dagRun({ runId: "wide", nodes: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => dagNode({ id: `w${index}` })) })],
    ]

    // when
    for (const cap of caps) {
      for (const runs of shapes) {
        for (const width of [20, 52]) {
          // then
          expect(buildDagRows(input(runs, { rowCap: cap }), width).length).toBeLessThanOrEqual(cap)
        }
      }
    }
  })

  test("#given a zero row cap #when rows are built #then the section draws nothing at all", () => {
    // given / when / then
    expect(buildDagRows(input([small], { rowCap: 0 }), 52)).toEqual([])
  })

  test("#given more runs than the column draws #when rows are built #then the extra runs are counted and reachable by click", () => {
    // given
    const runs = [threeNodes(0), threeNodes(1), threeNodes(2)]

    // when
    const rows = buildDagRows(input(runs), 52)

    // then
    const drawn = new Set(rows.flatMap((row) => (row.action?.kind === "dag-run" ? [row.action.runId] : [])))
    expect(drawn.has("run-0")).toBe(true)
    expect(drawn.has("run-1")).toBe(true)
    // the overflow row exists for the runs the column refused to draw, and only it names them
    const overflow = rows.filter((row) => row.action?.kind === "dag-run" && row.action.runId === "run-2")
    expect(overflow).toHaveLength(1)
    expect(nodeActions(rows).length).toBeGreaterThan(0)
    expect(runs.length).toBeGreaterThan(DAG_COLUMN_RUN_LIMIT)
  })

  test("#given labels wider than the column, CJK and control bytes #when rows are built #then every row fits the width and carries no terminal control", () => {
    // given
    const run = dagRun({
      runId: "run-wide",
      name: "构建 \u001b[31mrun\u0007",
      nodes: [
        dagNode({ id: "wide-1", label: "构建步骤\u0007\u001b[0m" }),
        dagNode({ id: "wide-2", label: "очень длинное имя шага", dependsOn: ["wide-1"] }),
      ],
    })

    // when
    for (const width of [8, 16, 24, 52]) {
      const rows = buildDagRows(input([run]), width)

      // then
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(visibleWidth(row.text)).toBeLessThanOrEqual(width)
        expect(row.text.includes("\u001b")).toBe(false)
        expect(row.text.includes("\u0007")).toBe(false)
        expect(row.text.includes("\n")).toBe(false)
      }
    }
  })

  test("#given a run with no width #when rows are built #then the section draws nothing", () => {
    // given / when / then
    expect(buildDagRows(input([small]), 0)).toEqual([])
  })

  test("#given a run #when rows are built #then each node carries a click action naming its run and node", () => {
    // given / when
    const rows = buildDagRows(input([small]), 52)

    // then
    expect(rows[0]?.action).toEqual({ kind: "dag-run", runId: "run-small" })
    expect([...new Set(nodeActions(rows))].sort()).toEqual(["a", "b"])
    for (const row of rows) {
      if (row.action?.kind === "dag-node") expect(row.action.runId).toBe("run-small")
    }
  })

  test("#given a run whose dependencies cycle #when rows are built #then the run is reported instead of drawn", () => {
    // given
    const run = dagRun({
      runId: "run-cycle",
      nodes: [dagNode({ id: "ping", dependsOn: ["pong"] }), dagNode({ id: "pong", dependsOn: ["ping"] })],
    })

    // when
    const rows = buildDagRows(input([run]), 52)

    // then
    expect(nodeActions(rows)).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[1]?.action).toEqual({ kind: "dag-run", runId: "run-cycle" })
    expect(rows[1]?.color).toBe("error")
  })

  test("#given a running node with live activity #when rows are built #then the activity reaches its row, and a settled node drops it", () => {
    // given
    const running = dagRun({
      runId: "run-live",
      nodes: [dagNode({ id: "live", state: "running", startedAt: "2026-11-08T00:00:00.000Z" })],
    })
    const activity = (runId: string, nodeId: string): string | undefined =>
      runId === "run-live" && nodeId === "live" ? "reading spec.md" : undefined

    // when
    const liveRows = buildDagRows(input([running], { activity, now: Date.parse("2026-11-08T00:01:00.000Z") }), 52)
    const settledRows = buildDagRows(
      input(
        [{ ...running, nodes: [dagNode({ id: "live", state: "completed", startedAt: "2026-11-08T00:00:00.000Z" })] }],
        { activity },
      ),
      52,
    )

    // then
    expect(liveRows.some((row) => row.text.includes("reading spec.md"))).toBe(true)
    expect(settledRows.some((row) => row.text.includes("reading spec.md"))).toBe(false)
  })
})
