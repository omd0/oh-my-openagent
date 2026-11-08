import { describe, expect, test } from "bun:test"

import { OmoSidePanelSettingsSchema, type OmoSidePanelSections } from "@oh-my-opencode/omo-config-core"

import { buildPanelRows, type PanelRowsInput } from "./rows"
import { dagRun } from "./dag-panel.test-support"
import { createPanelStore } from "./store"

const allSections = (overrides: Partial<OmoSidePanelSections> = {}): OmoSidePanelSections => ({
  ...OmoSidePanelSettingsSchema.parse({}).sections,
  ...overrides,
})

function input(overrides: Partial<PanelRowsInput> = {}): PanelRowsInput {
  const store = createPanelStore(() => 1_000)
  return {
    sections: allSections(),
    facts: {},
    state: store.state(),
    location: { cwd: "/srv/app" },
    now: 1_000,
    toolRows: 4,
    fileRows: 8,
    ...overrides,
  }
}

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildPanelRows", () => {
  test("#given a session that knows nothing yet #when assembled #then only the location line remains", () => {
    // given
    const source = input()

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows).toEqual(["/srv/app"])
  })

  test("#given every section has content #when assembled #then blocks are separated by one blank row each", () => {
    // given
    const store = createPanelStore(() => 1_000)
    store.upsertChild({ id: "c1", name: "explore", status: "running", startedAt: 0 })
    store.recordTool({ name: "read", detail: "index.ts", at: 1 })
    const source = input({
      state: store.state(),
      facts: {
        model: "opus",
        usage: { tokens: 1_000, contextWindow: 100_000, percent: 1 },
        totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
      },
      startedAt: 0,
    })

    // when
    const rows = texts(buildPanelRows(source, 46))

    // then
    expect(rows.filter((row) => row === "")).toHaveLength(4)
    expect(rows[0]?.startsWith("SESSION")).toBe(true)
    expect(rows).toContain("CONTEXT  1K/100K")
    expect(rows.some((row) => row.startsWith("AGENTS"))).toBe(true)
    expect(rows.some((row) => row.startsWith("TOOLS"))).toBe(true)
    expect(rows[rows.length - 1]).toBe("/srv/app")
  })

  test("#given a disabled section #when assembled #then it contributes nothing at all", () => {
    // given
    const source = input({
      sections: allSections({ context: false }),
      facts: { usage: { tokens: 1_000, contextWindow: 100_000, percent: 1 } },
    })

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows.some((row) => row.startsWith("CONTEXT"))).toBe(false)
  })

  test("#given every section disabled #when assembled #then the location line still closes the column", () => {
    // given
    const source = input({
      sections: allSections({
        session: false,
        goal: false,
        context: false,
        usage: false,
        agents: false,
        tools: false,
        files: false,
        memory: false,
      }),
    })

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows).toEqual(["/srv/app"])
  })

  test("#given no width #when assembled #then nothing is produced", () => {
    // given
    const source = input()

    // when
    const rows = buildPanelRows(source, 0)

    // then
    expect(rows).toEqual([])
  })

  test("#given live DAG runs #when assembled #then the graph leads the column and the session block follows it", () => {
    // given
    const source = input({
      facts: { model: "opus" },
      dag: { runs: [dagRun({ runId: "run-lead", name: "lead run" })], activity: () => undefined, now: 1_000, rowCap: 10 },
    })

    // when
    const rows = buildPanelRows(source, 46)

    // then
    expect(rows[0]?.action).toEqual({ kind: "dag-run", runId: "run-lead" })
    const sessionIndex = rows.findIndex((row) => row.text.startsWith("SESSION"))
    expect(sessionIndex).toBeGreaterThan(0)
    expect(rows[rows.length - 1]?.text).toBe("/srv/app")
  })

  test("#given the dag section is off #when runs are supplied #then the graph contributes nothing", () => {
    // given
    const source = input({
      sections: allSections({ dag: false }),
      dag: { runs: [dagRun({ runId: "run-off" })], activity: () => undefined, now: 1_000, rowCap: 10 },
    })

    // when
    const rows = buildPanelRows(source, 46)

    // then
    expect(rows.some((row) => row.action?.kind === "dag-run" || row.action?.kind === "dag-node")).toBe(false)
  })

  test("#given the section is on but the session has no feed #when assembled #then the column carries no graph rows", () => {
    // given
    const source = input({ facts: { model: "opus" } })

    // when
    const rows = buildPanelRows(source, 46)

    // then
    expect(rows.some((row) => row.action?.kind === "dag-run" || row.action?.kind === "dag-node")).toBe(false)
    expect(rows[0]?.text.startsWith("SESSION")).toBe(true)
  })

  test("#given more files than the preview #when assembled #then the preview shows a Show more counter", () => {
    // given
    const files = Array.from({ length: 10 }, (_, index) => ({ xy: " M", path: `src/file-${index}.ts`, added: 2, removed: 1 }))
    const source = input({ git: { root: "/repo", files }, fileRows: 8, filesExpandable: true })

    // when
    const rows = texts(buildPanelRows(source, 60))

    // then: 8 files plus an exact remainder, other sections still close the column
    expect(rows).toContain("FILES  10 changed")
    expect(rows).toContain("Show more · +2 more")
    expect(rows[rows.length - 1]).toBe("/srv/app")
  })

  test("#given expanded Changes #when assembled #then every file shows and other sections step aside", () => {
    // given
    const files = Array.from({ length: 10 }, (_, index) => ({ xy: " M", path: `src/file-${index}.ts`, added: 2, removed: 1 }))
    const source = input({
      facts: { model: "opus" },
      git: { root: "/repo", files },
      fileRows: 8,
      filesExpanded: true,
      filesExpandable: true,
    })

    // when
    const rows = buildPanelRows(source, 60)

    // then: the list is the column, headed by a Show less control
    expect(rows[0]?.text).toBe("FILES  10 changed")
    expect(rows[1]?.text).toBe("Show less")
    expect(rows[1]?.action).toEqual({ kind: "files-less" })
    expect(rows.some((row) => row.text.startsWith("SESSION"))).toBe(false)
    expect(rows.filter((row) => row.action?.kind === "file")).toHaveLength(10)
  })

  test("#given expanded Changes without a clickable column #when assembled #then the preview stays", () => {
    // given: a widget block has no Show less control, so expansion cannot land there
    const files = Array.from({ length: 10 }, (_, index) => ({ xy: " M", path: `src/file-${index}.ts` }))
    const source = input({ git: { root: "/repo", files }, fileRows: 8, filesExpanded: true, filesExpandable: false })

    // when
    const rows = texts(buildPanelRows(source, 60))

    // then
    expect(rows).toContain("FILES  10 changed")
    expect(rows).toContain("+2 more")
    expect(rows.some((row) => row === "Show less")).toBe(false)
  })

  test("#given a refused file list #when assembled #then the warning replaces the exact total", () => {
    // given: the reader kept nothing and does not know the total
    const source = input({ git: { root: "/repo", files: [], tooLarge: true }, fileRows: 8 })

    // when
    const rows = texts(buildPanelRows(source, 60))

    // then: an empty refused list never reads as clean
    expect(rows).toContain("FILES")
    expect(rows.some((row) => row.includes("Changes too large"))).toBe(true)
    expect(rows.some((row) => row.includes("0 changed"))).toBe(false)
  })

  test("#given a capped file list #when assembled #then only the retained count is claimed", () => {
    // given
    const files = Array.from({ length: 3 }, (_, index) => ({ xy: " M", path: `src/kept-${index}.ts` }))
    const source = input({ git: { root: "/repo", files, tooLarge: true }, fileRows: 8 })

    // when
    const rows = texts(buildPanelRows(source, 60))

    // then
    expect(rows.some((row) => row.includes("3+ changed"))).toBe(true)
    expect(rows.some((row) => row.includes("total unknown"))).toBe(true)
  })

  test("#given hundreds of files beyond the row limit #when expanded #then the column caps at 500 with an omitted count", () => {
    // given: an enormous diff can never turn into an enormous column
    const files = Array.from({ length: 510 }, (_, index) => ({ xy: " M", path: `src/big-${index}.ts` }))
    const source = input({
      git: { root: "/repo", files },
      fileRows: 8,
      filesExpanded: true,
      filesExpandable: true,
    })

    // when
    const rows = buildPanelRows(source, 60)

    // then
    expect(rows.some((row) => row.text.includes("Changes too large") && row.text.includes("omitted"))).toBe(true)
    expect(rows.filter((row) => row.action?.kind === "file")).toHaveLength(500)
  })
})
